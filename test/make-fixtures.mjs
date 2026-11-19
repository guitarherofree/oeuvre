// Generates a small library of tagged test audio + scores with the system/bundled ffmpeg.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = process.env.FFMPEG || require('ffmpeg-static');
const root = path.resolve(process.argv[2] || 'test/.tmp/fixtures');
fs.rmSync(root, { recursive: true, force: true });
const music = path.join(root, 'Music');
const run = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const cover = path.join(root, 'cover-src.png');
fs.mkdirSync(root, { recursive: true });
run('-f', 'lavfi', '-i', 'gradients=s=800x800:c0=0x0b3d2a:c1=0x34e089:d=1', '-frames:v', '1', cover);

const pieces = [
  ['Studies/Tapping Etude No. 10.flac', 'Tapping Etude No. 10', 220, 30, 96000],
  ['Studies/Tapping Etude No. 2.wav', 'Tapping Etude No. 2', 330, 22, 48000],
  ['Studies/Harmonic Field.m4a', 'Harmonic Field', 440, 18, 44100, true],
  ['Studies/Drafts/Silence Between (draft).mp3', 'Silence Between (draft)', 262, 12, 44100],
  ['Pianissimo for Feldman.flac', 'Pianissimo for Feldman', 196, 40, 48000],
  ['Night Window.mp3', null, 523, 15, 44100, true],
];
for (const [rel, title, freq, dur, rate, art] of pieces) {
  const out = path.join(music, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=${rate}:duration=${dur}`];
  if (art) args.push('-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', out.endsWith('.mp3') ? 'png' : 'png', '-disposition:v', 'attached_pic');
  args.push('-ac', '2');
  if (title) args.push('-metadata', `title=${title}`);
  args.push('-metadata', 'artist=Freeman Edwards');
  if (out.endsWith('.m4a')) args.push('-c:a', 'aac', '-b:a', '192k');
  if (out.endsWith('.mp3')) args.push('-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3');
  if (out.endsWith('.wav')) args.push('-c:a', 'pcm_s24le');
  args.push(out);
  run(...args);
}
// A second source folder
const live = path.join(root, 'Live Recordings');
fs.mkdirSync(live, { recursive: true });
run('-f', 'lavfi', '-i', 'sine=frequency=349:sample_rate=44100:duration=25', '-ac', '2', '-metadata', 'title=Atlanta, March (live)', '-c:a', 'libmp3lame', '-b:a', '256k', path.join(live, 'atl-march.mp3'));
run('-f', 'lavfi', '-i', 'sine=frequency=392:sample_rate=48000:duration=20', '-ac', '2', '-metadata', 'title=Encore Sketch', path.join(live, 'encore.wav'));
// Folder artwork for the live folder
fs.copyFileSync(cover, path.join(live, 'cover.png'));
// A logic project that must be skipped
fs.mkdirSync(path.join(music, 'Session.logicx', 'Audio Files'), { recursive: true });
run('-f', 'lavfi', '-i', 'sine=frequency=100:duration=1', path.join(music, 'Session.logicx', 'Audio Files', 'take1.wav'));
// Scores
const scores = path.join(root, 'Scores');
fs.mkdirSync(scores, { recursive: true });
run('-f', 'lavfi', '-i', 'color=c=white:s=1240x1754:d=1', '-frames:v', '1', path.join(scores, 'Etude page 1.png'));
run('-f', 'lavfi', '-i', 'color=c=0xf4f1ea:s=1240x1754:d=1', '-frames:v', '1', path.join(scores, 'Etude page 2.jpg'));
fs.writeFileSync(path.join(scores, 'Harmonic Field.musx'), 'not a real finale file');
writeScorePdf(path.join(scores, 'Tapping Etude No. 2.pdf'), 'Tapping Etude No. 2', 3);

/** A small, valid multi-page PDF with staff lines, written by hand so tests need no PDF library. */
function writeScorePdf(file, title, pageCount) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>');
  const kids = [];
  for (let p = 0; p < pageCount; p++) {
    let ops = '';
    if (p === 0) ops += `BT /F1 24 Tf 190 720 Td (${title}) Tj ET\n`;
    for (let y = 660, row = 0; y > 100; y -= 80, row++) {
      for (let l = 0; l < 5; l++) ops += `60 ${y - l * 7} m 552 ${y - l * 7} l S\n`;
      for (let x = 90; x < 540; x += 30) {
        const ny = y - ((x * 7 + row * 13 + p * 5) % 9) * 3.5;
        ops += `${x - 4} ${ny - 3} 8 6 re f ${x + 4} ${ny} m ${x + 4} ${ny + 24} l S\n`;
      }
    }
    ops += `BT /F1 10 Tf 300 40 Td (${p + 1}) Tj ET\n`;
    const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, pdf);
}
console.log(root);
