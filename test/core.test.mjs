import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Library, pieceIdFor } from '../src/main/library.mjs';
import { Collections } from '../src/main/collections.mjs';
import { exportPieces, safeFileName } from '../src/main/exporter.mjs';
import { compareVersions } from '../src/main/updater.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = process.env.FFMPEG || require('ffmpeg-static');
const fixtures = path.resolve('test/.tmp/fixtures');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oeuvre-test-'));
const once = (em, ev) => new Promise((r) => em.once(ev, r));

test('library scans sources, skips packages, reads tags and artwork', async (t) => {
  const dir = tmp();
  const lib = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  t.after(() => lib.close());
  const { added } = lib.addSources([path.join(fixtures, 'Music'), path.join(fixtures, 'Live Recordings')]);
  assert.equal(added.length, 2);
  // nested folder inside an existing source is refused
  const again = lib.addSources([path.join(fixtures, 'Music', 'Studies')]);
  assert.equal(again.added.length, 0);
  assert.match(again.skipped[0].reason, /already included/);
  await lib.scanAll();
  const snap = lib.snapshot();
  const titles = snap.pieces.map((p) => p.title).sort();
  assert.deepEqual(titles, ['Atlanta, March (live)', 'Encore Sketch', 'Harmonic Field', 'Night Window', 'Pianissimo for Feldman', 'Silence Between (draft)', 'Tapping Etude No. 10', 'Tapping Etude No. 2']);
  assert.ok(!snap.pieces.some((p) => p.path.includes('.logicx')), 'logic package skipped');
  const etude = snap.pieces.find((p) => p.title === 'Tapping Etude No. 10');
  assert.equal(etude.ext, 'flac');
  assert.equal(etude.sampleRate, 96000);
  assert.ok(Math.abs(etude.duration - 30) < 0.5, `duration ${etude.duration}`);
  assert.equal(etude.folder, 'Studies');
  const night = snap.pieces.find((p) => p.title === 'Night Window');
  assert.ok(night.artKey, 'embedded art saved');
  const encore = snap.pieces.find((p) => p.title === 'Encore Sketch');
  assert.ok(encore.artKey, 'folder cover.png used');
  assert.ok(fs.existsSync(lib.artPath(encore.artKey)));
  const live = snap.sources.find((s) => s.name === 'Live Recordings');
  assert.equal(live.count, 2);
  lib.setVisible(live.id, false);
  assert.equal(lib.snapshot().sources.find((s) => s.id === live.id).visible, false);
  lib.close();

  // reload from disk: cache is reused, visibility persisted
  const lib2 = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  assert.equal(lib2.sources.find((s) => s.name === 'Live Recordings').visible, false);
  assert.equal(Object.keys(lib2.pieces).length, 8);
  lib2.close();
});

test('renamed files keep their links (relink) and removing a source keeps files', async () => {
  const dir = tmp();
  const src = path.join(dir, 'src');
  fs.cpSync(path.join(fixtures, 'Live Recordings'), src, { recursive: true });
  const lib = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  const col = new Collections({ file: path.join(dir, 'collections.json'), scoresDir: path.join(dir, 'scores') });
  lib.on('relink', (m) => col.relink(m));
  lib.addSources([src]);
  await lib.scanAll();
  const piece = Object.values(lib.pieces).find((p) => p.fileName === 'encore.wav');
  col.portfolioAdd([piece]);
  const sl = col.setlistCreate({ name: 'Eddie\'s Attic' });
  col.setlistAdd(sl.id, [piece]);
  await col.importScores(piece, [path.join(fixtures, 'Scores', 'Tapping Etude No. 2.pdf')]);
  fs.mkdirSync(path.join(src, 'moved'));
  fs.renameSync(path.join(src, 'encore.wav'), path.join(src, 'moved', 'encore.wav'));
  await lib.scanSource(lib.sources[0].id);
  const newId = pieceIdFor(path.join(src, 'moved', 'encore.wav'));
  assert.ok(lib.pieces[newId]);
  assert.equal(col.data.portfolio[0].pieceId, newId);
  assert.equal(col.data.setlists[0].items[0].pieceId, newId);
  assert.equal(col.scoresFor(newId).length, 1);
  assert.equal(col.scoresFor(newId)[0].kind, 'pdf');
  lib.removeSource(lib.sources[0].id);
  assert.equal(Object.keys(lib.pieces).length, 0);
  assert.ok(fs.existsSync(path.join(src, 'moved', 'encore.wav')), 'files untouched');
  lib.close(); col.close();
});

test('export converts non-MP3s to 320k MP3, copies MP3s, and zips', async () => {
  const dir = tmp();
  const lib = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  lib.addSources([path.join(fixtures, 'Music')]);
  await lib.scanAll();
  const pieces = Object.values(lib.pieces);
  const out = path.join(dir, 'out');
  const progress = [];
  const res = await exportPieces({ pieces, mode: 'folder', dest: out, ffmpeg, bitrate: 320, onProgress: (p) => progress.push(p) });
  assert.equal(res.failed.length, 0, JSON.stringify(res.failed));
  assert.equal(fs.readdirSync(out).length, pieces.length);
  for (const f of fs.readdirSync(out)) assert.match(f, /\.mp3$/);
  // MP3 originals are byte-identical copies
  const night = pieces.find((p) => p.title === 'Night Window');
  assert.ok(fs.readFileSync(night.path).equals(fs.readFileSync(path.join(out, 'Night Window.mp3'))));
  assert.ok(progress.some((p) => p.phase === 'converting'));
  // exporting again into the same folder never overwrites
  const res2 = await exportPieces({ pieces: [night], mode: 'folder', dest: out, ffmpeg, bitrate: 320 });
  assert.deepEqual(res2.written, ['Night Window (2).mp3']);
  // zip
  const zip = path.join(dir, 'Portfolio.zip');
  const rz = await exportPieces({ pieces, mode: 'zip', dest: zip, ffmpeg, bitrate: 320 });
  assert.equal(rz.written.length, pieces.length);
  const list = execFileSync('unzip', ['-l', zip]).toString();
  assert.match(list, /Pianissimo for Feldman\.mp3/);
  assert.match(list, /Harmonic Field\.mp3/);
  lib.close();
});

test('converted MP3 is 320 kbps with the title tag and a legal sample rate', async () => {
  const dir = tmp();
  const lib = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  lib.addSources([path.join(fixtures, 'Music')]);
  await lib.scanAll();
  const hi = Object.values(lib.pieces).find((p) => p.sampleRate === 96000);
  const out = path.join(dir, 'o');
  await exportPieces({ pieces: [hi], mode: 'folder', dest: out, ffmpeg, bitrate: 320 });
  const { parseFile } = await import('music-metadata');
  const m = await parseFile(path.join(out, `${hi.title}.mp3`));
  assert.equal(m.format.codec, 'MPEG 1 Layer 3');
  assert.equal(m.format.bitrate, 320000);
  assert.equal(m.format.sampleRate, 48000);
  assert.equal(m.common.title, hi.title);
  lib.close();
});

test('helpers', () => {
  assert.equal(safeFileName('A/B: "c"?'), 'A-B- -c--');
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('v2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
});

test('Oeuvre order: by name, newest first (years descending, natural numbers)', async () => {
  const { sortByTitle } = await import('../src/renderer/lib/format.js');
  const list = ['2014 First Light', '2026 Tapping Etude', '2021-03 Night Window', '2021-11 Dawn', '2026 Tapping Etude No. 2', '2026 Tapping Etude No. 10']
    .map((title, i) => ({ title, path: `/m/${i}` }));
  assert.deepEqual(sortByTitle(list, true).map((p) => p.title), [
    '2026 Tapping Etude No. 10', '2026 Tapping Etude No. 2', '2026 Tapping Etude', '2021-11 Dawn', '2021-03 Night Window', '2014 First Light',
  ]);
  assert.deepEqual(sortByTitle(list, false).map((p) => p.title)[0], '2014 First Light');
});

test('Project export: WAV copied as-is, lossless keeps depth and rate, lossy decodes to 24-bit', async () => {
  const dir = tmp();
  const lib = new Library({ file: path.join(dir, 'library.json'), artDir: path.join(dir, 'art') });
  lib.addSources([path.join(fixtures, 'Music')]);
  await lib.scanAll();
  const pieces = Object.values(lib.pieces);
  const byT = (t) => pieces.find((p) => p.title === t);
  const out = path.join(dir, 'wav');
  const res = await exportPieces({ pieces, mode: 'folder', format: 'wav', dest: out, ffmpeg, bitrate: 320, wavLossyBits: 24 });
  assert.equal(res.failed.length, 0, JSON.stringify(res.failed));
  assert.equal(res.format, 'wav');
  assert.deepEqual(fs.readdirSync(out).filter((f) => !f.endsWith('.wav')), []);
  const { parseFile } = await import('music-metadata');
  // WAV source: byte-identical copy
  const wav = byT('Tapping Etude No. 2');
  assert.ok(fs.readFileSync(wav.path).equals(fs.readFileSync(path.join(out, 'Tapping Etude No. 2.wav'))));
  // FLAC 96 kHz: same rate and bit depth
  const flac = byT('Tapping Etude No. 10');
  const mf = await parseFile(path.join(out, 'Tapping Etude No. 10.wav'));
  assert.equal(mf.format.container, 'WAVE');
  assert.equal(mf.format.sampleRate, 96000);
  assert.equal(mf.format.bitsPerSample, flac.bitsPerSample);
  assert.equal(mf.common.title, 'Tapping Etude No. 10');
  // MP3 and AAC: decoded at their own rate to 24-bit
  for (const t of ['Night Window', 'Harmonic Field']) {
    const m = await parseFile(path.join(out, `${t}.wav`));
    assert.equal(m.format.bitsPerSample, 24, t);
    assert.equal(m.format.sampleRate, byT(t).sampleRate, t);
    assert.ok(Math.abs(m.format.duration - byT(t).duration) < 0.2, `${t} duration`);
  }
  const zip = path.join(dir, 'Project.zip');
  const rz = await exportPieces({ pieces: [flac, wav], mode: 'zip', format: 'wav', dest: zip, ffmpeg, bitrate: 320 });
  assert.deepEqual(rz.written.sort(), ['Tapping Etude No. 10.wav', 'Tapping Etude No. 2.wav']);
  lib.close();
});

test('Projects: Collection 001, 002… numbered after the highest existing one', async () => {
  const { nextProjectName } = await import('../src/main/collections.mjs');
  const named = (...names) => names.map((name) => ({ name }));
  assert.equal(nextProjectName([]), 'Collection 001');
  assert.equal(nextProjectName(named('Collection 001', 'Collection 002')), 'Collection 003');
  assert.equal(nextProjectName(named('Collection 001', 'Spring Demos')), 'Collection 002');
  assert.equal(nextProjectName(named('Collection 009')), 'Collection 010');
  assert.equal(nextProjectName(named('Collection 999')), 'Collection 1000');
  assert.equal(nextProjectName(named('My Collection 5')), 'Collection 001');
  // The renderer's copy (shown as "Next: …" in the sidebar) agrees.
  const { nextProjectName: shown } = await import('../src/renderer/lib/format.js');
  for (const list of [[], named('Collection 001', 'Spring Demos'), named('Collection 041', 'Collection 007')]) {
    assert.equal(shown(list), nextProjectName(list));
  }
});

test('Projects: create, add, remove, rename, delete, relink', () => {
  const dir = tmp();
  const col = new Collections({ file: path.join(dir, 'collections.json'), scoresDir: path.join(dir, 'scores') });
  const a = { id: 'p_a', title: 'A', path: '/a.wav' };
  const b = { id: 'p_b', title: 'B', path: '/b.wav' };
  const p1 = col.projectCreate();
  const p2 = col.projectCreate({ pieces: [a] });
  assert.equal(p1.name, 'Collection 001');
  assert.equal(p2.name, 'Collection 002');
  assert.equal(col.projectAdd(p1.id, [a, b]), 2);
  assert.equal(col.projectAdd(p1.id, [a]), 0);
  assert.ok(col.projectHasAll(p1.id, ['p_a', 'p_b']));
  assert.ok(!col.projectHasAll(p2.id, ['p_a', 'p_b']));
  assert.equal(col.data.portfolio.length, 0, 'projects are separate from Portfolio');
  col.relink({ p_b: 'p_c' });
  assert.deepEqual(col.data.projects[0].items.map((e) => e.pieceId), ['p_a', 'p_c']);
  assert.equal(col.projectRemove(p1.id, ['p_a']), 1);
  col.projectRename(p2.id, 'Spring Demos');
  assert.equal(col.projectCreate().name, 'Collection 002');
  col.projectDelete(p1.id);
  assert.deepEqual(col.data.projects.map((p) => p.name), ['Spring Demos', 'Collection 002']);
  col.close();
  const again = new Collections({ file: path.join(dir, 'collections.json'), scoresDir: path.join(dir, 'scores') });
  assert.deepEqual(again.data.projects.map((p) => p.name), ['Spring Demos', 'Collection 002']);
  again.close();
});

test('1.2.0 Project tab moves into Collection 001', () => {
  const dir = tmp();
  const file = path.join(dir, 'collections.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, portfolio: [{ pieceId: 'p_x' }], project: [{ pieceId: 'p_a', addedAt: 1 }, { pieceId: 'p_b', addedAt: 2 }], setlists: [], scores: {}, refs: {} }));
  const col = new Collections({ file, scoresDir: path.join(dir, 'scores') });
  assert.equal(col.data.project, undefined);
  assert.equal(col.data.projects.length, 1);
  assert.equal(col.data.projects[0].name, 'Collection 001');
  assert.deepEqual(col.data.projects[0].items.map((e) => e.pieceId), ['p_a', 'p_b']);
  assert.deepEqual(col.data.portfolio.map((e) => e.pieceId), ['p_x']);
  col.close();
  // An empty 1.2.0 Project tab doesn't create a collection.
  const file2 = path.join(dir, 'c2.json');
  fs.writeFileSync(file2, JSON.stringify({ version: 1, portfolio: [], project: [], setlists: [] }));
  const col2 = new Collections({ file: file2, scoresDir: path.join(dir, 'scores') });
  assert.equal(col2.data.projects.length, 0);
  col2.close();
});
