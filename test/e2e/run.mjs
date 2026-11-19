// Runs the end-to-end walkthrough against a throwaway data folder.
//   npm run test:e2e        (on Linux it uses xvfb-run when available)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oeuvre-e2e-'));
spawnSync(process.execPath, [path.join(root, 'test/make-fixtures.mjs'), path.join(tmp, 'fixtures')], { stdio: 'inherit' });

const env = {
  ...process.env,
  OEUVRE_E2E: '1',
  OEUVRE_USER_DATA: path.join(tmp, 'data'),
  OEUVRE_UPDATE_API: 'http://127.0.0.1:47123',
  OEUVRE_SCREENSHOT_DIR: path.join(root, 'test/.tmp/shots'),
  OEUVRE_FIXTURES: path.join(tmp, 'fixtures'),
};
let cmd = electron;
let args = [root];
if (process.platform === 'linux') {
  args = ['--no-sandbox', '--disable-gpu', root];
  if (!process.env.DISPLAY) { cmd = 'xvfb-run'; args = ['-a', '-s', '-screen 0 1600x1000x24', electron, ...args]; }
}
const r = spawnSync(cmd, args, { env, stdio: 'inherit' });
console.log(`Screenshots: ${env.OEUVRE_SCREENSHOT_DIR}`);
process.exit(r.status ?? 1);
