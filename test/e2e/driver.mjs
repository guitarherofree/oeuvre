// End-to-end walkthrough used during development: drives the real app, checks
// behaviour through the DOM, and saves screenshots. Loaded only when OEUVRE_E2E=1.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { dialog } from 'electron';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = path.resolve(process.env.OEUVRE_SCREENSHOT_DIR || 'test/.tmp/shots');
const fixtures = path.resolve(process.env.OEUVRE_FIXTURES || 'test/.tmp/fixtures');
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------------------ mock GitHub
function startMockGitHub(port, zipPath) {
  const TOKEN = 'github_pat_test';
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    if (req.url === '/repos/guitarherofree/oeuvre/releases/latest') {
      if (auth !== `Bearer ${TOKEN}`) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"Not Found"}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        tag_name: 'v1.1.0',
        name: 'Oeuvre 1.1.0',
        published_at: '2026-11-20T15:00:00Z',
        html_url: 'https://github.com/guitarherofree/oeuvre/releases/tag/v1.1.0',
        body: '## What\'s new\n\n- Setlists show each piece\'s **start time**\n- Faster scanning of large folders\n- Fixed: PDF scores remember their zoom\n\n<script>alert(1)</script>',
        assets: [{ id: 42, name: 'Oeuvre-1.1.0-mac-x64.zip', size: fs.statSync(zipPath).size, url: `http://127.0.0.1:${port}/asset/42` },
          { id: 43, name: 'Oeuvre-1.1.0-mac-arm64.zip', size: fs.statSync(zipPath).size, url: `http://127.0.0.1:${port}/asset/42` }],
      }));
    }
    if (req.url === '/asset/42') {
      if (auth !== `Bearer ${TOKEN}`) { res.writeHead(404); return res.end(); }
      // Like GitHub: redirect to storage, which must not get the token.
      res.writeHead(302, { location: `http://127.0.0.1:${port}/storage/42` });
      return res.end();
    }
    if (req.url === '/storage/42') {
      if (auth) { res.writeHead(400); return res.end('token leaked to storage'); }
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': fs.statSync(zipPath).size });
      return fs.createReadStream(zipPath).pipe(res);
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, '127.0.0.1');
  return { server, TOKEN };
}

function makeFakeUpdateZip(dir) {
  const app = path.join(dir, 'Oeuvre.app', 'Contents');
  fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key>\n<string>com.guitarherofree.oeuvre</string><key>CFBundleShortVersionString</key><string>1.1.0</string></dict></plist>');
  fs.writeFileSync(path.join(app, 'MacOS', 'Oeuvre'), '#!/bin/sh\n');
  const zip = path.join(dir, 'update.zip');
  execFileSync('zip', ['-qry', zip, 'Oeuvre.app'], { cwd: dir });
  return zip;
}

// ------------------------------------------------------------------ driver
export async function run({ app, win, library, collections, updater, state }) {
  fs.mkdirSync(out, { recursive: true });
  const w = win();
  const errors = [];
  w.webContents.on('console-message', (e, lvl, msg) => {
    const level = e.level ?? lvl;
    const message = e.message ?? msg;
    if (level === 'error' || level === 3) errors.push(message);
  });
  if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
  await sleep(1200);
  const js = (code) => w.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    await sleep(350);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
  };
  const cmd = (c, arg) => w.webContents.send('menu:command', c, arg);
  const waitFor = async (code, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await js(code)) return true;
      await sleep(150);
    }
    return false;
  };

  try {
    state.data.updates.tokenPrompted = true;
    check('welcome screen shows with no sources', await waitFor(`!!document.querySelector('.welcome')`));
    await shot('01-welcome');

    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(fixtures, 'Music'), path.join(fixtures, 'Live Recordings')] });
    await js(`document.querySelector('.welcome .primary-btn').click()`);
    check('library lists 8 pieces', await waitFor(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head)').length === 8`, 15000));
    const titles = await js(`[...document.querySelectorAll('.tl-title')].map(e => e.textContent)`);
    check('sorted by title (natural order)', JSON.stringify(titles) === JSON.stringify(['Atlanta, March (live)', 'Encore Sketch', 'Harmonic Field', 'Night Window', 'Pianissimo for Feldman', 'Silence Between (draft)', 'Tapping Etude No. 2', 'Tapping Etude No. 10']), titles.join(' | '));
    await shot('02-oeuvre');

    // Search
    await js(`(() => { const i = document.querySelector('.filter-box input'); i.value = 'etude'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    check('search filters', await waitFor(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head)').length === 2`));
    await shot('03-search');
    await js(`(() => { const i = document.querySelector('.filter-box input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    // Playback: double-click "Harmonic Field" (row 3)
    await js(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head)')[2].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    check('playing after double-click', await waitFor(`document.querySelector('.play-btn')?.getAttribute('aria-label') === 'Pause'`));
    await sleep(1500);
    const t1 = await js(`document.querySelector('.progress .time').textContent`);
    check('position advances', t1 !== '0:00', t1);
    check('now playing title', (await js(`document.querySelector('.np-title').textContent`)) === 'Harmonic Field');
    // seek
    await js(`(() => { const s = document.querySelector('.slider.seek'); s.value = 10; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(600);
    const t2 = await js(`document.querySelector('.progress .time').textContent`);
    check('seek works', t2 === '0:10' || t2 === '0:11', t2);
    cmd('next');
    check('next goes to following piece', await waitFor(`document.querySelector('.np-title').textContent === 'Night Window'`));
    cmd('toggleQueue');
    await sleep(400);
    await shot('04-playing-queue');
    cmd('toggleShuffle');
    await sleep(200);
    check('shuffle toggles', await js(`document.querySelector('.transport-buttons .icon-btn').classList.contains('is-active')`));
    cmd('toggleShuffle');
    cmd('cycleRepeat');
    await sleep(200);
    check('repeat toggles', await js(`document.querySelectorAll('.transport-buttons .icon-btn')[3].classList.contains('is-active')`));
    cmd('cycleRepeat'); cmd('cycleRepeat');
    cmd('togglePlay');
    check('pause', await waitFor(`document.querySelector('.play-btn').getAttribute('aria-label') === 'Play'`));
    cmd('toggleQueue');

    // Sources menu + hiding a folder
    await js(`document.querySelector('.sources-button').click()`);
    await sleep(300);
    await shot('05-sources-menu');
    const live = library.sources.find((s) => s.name === 'Live Recordings');
    await js(`[...document.querySelectorAll('.source-row')].find(r => r.textContent.includes('Live Recordings')).click()`);
    check('unchecking a folder hides its pieces', await waitFor(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head)').length === 6`));
    check('…without removing the source', library.sources.some((s) => s.id === live.id) && live.visible === false);
    await shot('06-folder-hidden');
    await js(`document.querySelector('.sources-button').click()`);

    // Portfolio
    const pieces = Object.values(library.pieces);
    const byTitle = (t) => pieces.find((p) => p.title === t);
    collections.portfolioAdd(['Pianissimo for Feldman', 'Tapping Etude No. 10', 'Night Window', 'Harmonic Field', 'Encore Sketch'].map(byTitle));
    cmd('navigate', { view: 'portfolio' });
    check('portfolio shows 5', await waitFor(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head)').length === 5`));
    check('hidden-folder pieces stay in portfolio', await js(`[...document.querySelectorAll('.tl-title')].some(e => e.textContent === 'Encore Sketch')`));
    await js(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head) .checkbox')[0].click(); document.querySelectorAll('.tracklist .tl-row:not(.tl-head) .checkbox')[3].click();`);
    await sleep(200);
    check('two pieces checked', (await js(`document.querySelectorAll('.tracklist .tl-row:not(.tl-head) .checkbox.is-checked').length`)) === 2);
    check('export buttons enabled after checking', await js(`!document.querySelector('.export-group .pill-btn').disabled`));
    await shot('07-portfolio');

    // Real export through the UI (save dialog stubbed)
    const zipOut = path.join(out, 'Portfolio export.zip');
    fs.rmSync(zipOut, { force: true });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: zipOut });
    await js(`[...document.querySelectorAll('.export-group .pill-btn')][1].click()`);
    check('export summary shows', await waitFor(`!!document.querySelector('.export-summary')`, 20000));
    await shot('08-export-done');
    const listing = execFileSync('unzip', ['-l', zipOut]).toString();
    check('zip has converted MP3s', /Encore Sketch\.mp3/.test(listing) && /Pianissimo for Feldman\.mp3/.test(listing), listing.split('\n').slice(3, 6).join(' '));
    await js(`document.querySelector('.dialog .primary-btn').click()`);
    await sleep(200);

    // Setlist + scores
    const setlist = collections.setlistCreate({ name: 'Eddie\'s Attic — December' });
    collections.setlistUpdate(setlist.id, { date: '2026-12-12', venue: 'Eddie\'s Attic, Decatur' });
    collections.setlistAdd(setlist.id, ['Tapping Etude No. 2', 'Pianissimo for Feldman', 'Harmonic Field', 'Silence Between (draft)', 'Tapping Etude No. 10'].map(byTitle));
    await collections.importScores(byTitle('Tapping Etude No. 2'), [path.join(fixtures, 'Scores', 'Tapping Etude No. 2.pdf')]);
    await collections.importScores(byTitle('Pianissimo for Feldman'), [path.join(fixtures, 'Scores', 'Etude page 1.png'), path.join(fixtures, 'Scores', 'Etude page 2.jpg')]);
    await collections.importScores(byTitle('Harmonic Field'), [path.join(fixtures, 'Scores', 'Harmonic Field.musx')]);
    await sleep(200);
    cmd('navigate', { view: 'setlist', id: setlist.id });
    check('setlist shows 5 in running order', await waitFor(`[...document.querySelectorAll('.tl-title')].map(e => e.textContent).join('|') === 'Tapping Etude No. 2|Pianissimo for Feldman|Harmonic Field|Silence Between (draft)|Tapping Etude No. 10'`));
    check('start times accumulate', (await js(`[...document.querySelectorAll('.col-start')].slice(1).map(e => e.textContent).join(',')`)) === '0:00,0:22,1:02,1:20,1:32');
    await shot('09-setlist');

    // Reorder by drag and drop: move row 5 to the top
    const reordered = await js(`(() => {
      const rows = document.querySelectorAll('.tracklist .tl-row:not(.tl-head)');
      const dt = new DataTransfer();
      rows[4].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const r = rows[0].getBoundingClientRect();
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 }));
      return new Promise(res => setTimeout(() => { rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 })); res(true); }, 50));
    })()`);
    check('drag reorder dispatched', reordered);
    check('drag reorder applied', await waitFor(`document.querySelector('.tl-title').textContent === 'Tapping Etude No. 10'`));

    // Score views
    await js(`[...document.querySelectorAll('.tracklist .tl-row')].find(r => r.textContent.includes('Tapping Etude No. 2')).querySelector('.score-chip').click()`);
    check('PDF score renders pages', await waitFor(`document.querySelectorAll('canvas.score-page').length === 3 && document.querySelector('canvas.score-page').width > 300`, 15000));
    await sleep(1200);
    check('page indicator', (await js(`document.querySelector('.page-indicator')?.textContent`)) === '1 / 3');
    await shot('10-score-pdf');
    // Start playing from the score view
    await js(`document.querySelector('.score-play').click()`);
    check('play from score view uses setlist order', await waitFor(`document.querySelector('.np-title').textContent === 'Tapping Etude No. 2'`));
    await sleep(700);
    await shot('11-score-playing');
    cmd('togglePlay');
    await js(`document.querySelector('.score-bar .icon-btn').click()`);
    const backOk = await waitFor(`document.querySelectorAll('.tracklist .score-chip').length === 3`);
    if (!backOk) { await shot('fail-back'); console.log('DEBUG', await js(`JSON.stringify({chips: document.querySelectorAll('.score-chip').length, view: document.querySelector('.view-kind')?.textContent, html: document.querySelector('.main').className})`)); }
    check('back returns to setlist', backOk);
    await js(`[...document.querySelectorAll('.tracklist .tl-row')].find(r => r.textContent.includes('Pianissimo')).querySelector('.score-chip').click()`);
    check('image score shows', await waitFor(`document.querySelector('img.score-image')?.naturalWidth > 0`, 8000));
    check('two image tabs', (await js(`document.querySelectorAll('.score-tab:not(.score-tab-add)').length`)) === 2);
    await shot('12-score-image');
    await js(`document.querySelector('.score-bar .icon-btn').click()`);
    await waitFor(`document.querySelectorAll('.tracklist .score-chip').length === 3`);
    await js(`[...document.querySelectorAll('.tracklist .tl-row')].find(r => r.textContent.includes('Harmonic Field')).querySelector('.score-chip').click()`);
    check('other file offers Open', await waitFor(`!!document.querySelector('.score-other .primary-btn')`));
    await shot('13-score-other');
    await js(`document.querySelector('.score-bar .icon-btn').click()`);
    await waitFor(`!!document.querySelector('.action-row')`);

    // New setlist dialog
    cmd('newSetlist');
    await sleep(300);
    await shot('14-new-setlist');
    await js(`document.querySelector('.dialog .ghost-btn').click()`);

    // Add pieces dialog
    await js(`[...document.querySelectorAll('.action-row .pill-btn')].find(b => b.textContent.includes('Add Pieces')).click()`);
    await sleep(300);
    await shot('15-add-pieces');
    await js(`document.querySelector('.dialog .ghost-btn').click()`);

    // Updates against a mock GitHub
    const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'oeuvre-upd-'));
    const zip = makeFakeUpdateZip(tmp);
    const { server, TOKEN } = startMockGitHub(Number(new URL(updater.apiBase).port), zip);
    cmd('checkUpdates');
    check('private repo asks for a token', await waitFor(`!!document.querySelector('.token-form')`));
    await shot('16-update-token');
    await updater.setToken(TOKEN);
    check('update available shown', await waitFor(`!!document.querySelector('.release-notes')`));
    check('release notes escape raw HTML', !(await js(`!!document.querySelector('.release-notes script')`)));
    await shot('17-update-available');
    await js(`[...document.querySelectorAll('.dialog-foot .primary-btn')].pop().click()`);
    check('download + unpack completes', await waitFor(`[...document.querySelectorAll('.dialog-foot .primary-btn')].some(b => b.textContent.includes('Restart'))`, 15000));
    check('token not sent to storage host', updater.status.state === 'ready', updater.status.error || '');
    await shot('18-update-ready');
    await js(`document.querySelector('.dialog-foot .ghost-btn').click()`);
    server.close();

    // Narrow window
    w.setSize(1000, 700);
    cmd('navigate', { view: 'oeuvre' });
    await sleep(500);
    await shot('19-narrow');

    check('no console errors', errors.length === 0, errors.slice(0, 5).join(' / '));
  } catch (err) {
    check('driver crashed', false, err.stack);
  } finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    app.exit(failed ? 1 : 0);
  }
}
