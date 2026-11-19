// In-app updates from GitHub Releases.
//
// Check:   GET /repos/{owner}/{repo}/releases/latest (token sent when one is saved)
// Install: download the matching Oeuvre-<version>-mac-<arch>.zip, unpack it with
//          /usr/bin/ditto, then a small background script swaps the app bundle once
//          Oeuvre has quit and reopens it. No Terminal window is involved.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.mjs';

const run = promisify(execFile);
const KEYCHAIN_SERVICE = 'Oeuvre GitHub Token';
const KEYCHAIN_ACCOUNT = 'oeuvre-updates';
export const BUNDLE_ID = 'com.guitarherofree.oeuvre';

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

// ------------------------------------------------------------------ token storage

class TokenStore {
  constructor(fallbackFile) { this.fallbackFile = fallbackFile; }

  async get() {
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w']);
        return stdout.trim() || null;
      } catch { return null; }
    }
    try { return (await fsp.readFile(this.fallbackFile, 'utf8')).trim() || null; } catch { return null; }
  }

  async set(token) {
    if (process.platform === 'darwin') {
      await run('/usr/bin/security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-l', KEYCHAIN_SERVICE, '-w', token]);
      return;
    }
    await fsp.writeFile(this.fallbackFile, token, { mode: 0o600 });
  }

  async clear() {
    if (process.platform === 'darwin') {
      try { await run('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT]); } catch {}
      return;
    }
    await fsp.rm(this.fallbackFile, { force: true });
  }
}

// ------------------------------------------------------------------ updater

export class Updater extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./store.mjs').JsonFile} o.state   state.json store (uses data.updates)
   * @param {string} o.workDir        where downloads are unpacked (same volume as the app)
   * @param {string} o.currentVersion
   * @param {boolean} o.isPackaged
   * @param {() => void} o.quit       called after the install script is launched
   */
  constructor({ state, workDir, currentVersion, isPackaged, quit, apiBase }) {
    super();
    this.state = state;
    this.workDir = workDir;
    this.currentVersion = currentVersion;
    this.isPackaged = isPackaged;
    this.quit = quit;
    this.apiBase = (apiBase || process.env.OEUVRE_UPDATE_API || 'https://api.github.com').replace(/\/$/, '');
    this.tokens = new TokenStore(path.join(workDir, '..', 'github-token'));
    this.status = { state: 'idle', current: currentVersion };
    this.latest = null;
    this.extractedApp = null;
    this.busy = false;
    if (!state.data.updates) state.data.updates = { lastCheck: 0, skippedVersion: null, tokenPrompted: false };
  }

  get prefs() { return this.state.data.updates; }
  get repoSlug() { return `${config.updates.owner}/${config.updates.repo}`; }

  #set(status) {
    this.status = { current: this.currentVersion, repo: this.repoSlug, ...status };
    this.emit('status', this.status);
    return this.status;
  }

  async #headers(extra = {}) {
    const h = {
      'User-Agent': `Oeuvre/${this.currentVersion}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
      ...extra,
    };
    const token = await this.tokens.get();
    if (token) h.Authorization = `Bearer ${token}`;
    return { headers: h, hasToken: !!token };
  }

  async hasToken() { return !!(await this.tokens.get()); }

  async setToken(token) {
    token = String(token || '').trim();
    if (!token) { await this.tokens.clear(); return this.check({ manual: true }); }
    await this.tokens.set(token);
    return this.check({ manual: true });
  }

  async clearToken() {
    await this.tokens.clear();
    return this.#set({ state: 'needs-token' });
  }

  skip(version) {
    this.prefs.skippedVersion = version;
    this.state.save();
    return this.#set({ state: 'idle' });
  }

  // ---------------------------------------------------------------- check

  async check({ manual = false } = {}) {
    if (this.busy) return this.status;
    if (manual) this.#set({ state: 'checking', manual });
    let res;
    let hasToken = false;
    try {
      const h = await this.#headers();
      hasToken = h.hasToken;
      res = await fetch(`${this.apiBase}/repos/${this.repoSlug}/releases/latest`, { headers: h.headers, signal: AbortSignal.timeout(20000) });
    } catch (err) {
      return this.#report({ state: 'error', manual, error: `Couldn't reach GitHub (${err.cause?.code || err.message}).` });
    }
    this.prefs.lastCheck = Date.now();
    this.state.save();

    if (res.status === 404) {
      // GitHub answers 404 for a private repo without a token, and for a repo with no releases yet.
      if (!hasToken) return this.#report({ state: 'needs-token', manual });
      const repoRes = await fetch(`${this.apiBase}/repos/${this.repoSlug}`, { headers: (await this.#headers()).headers }).catch(() => null);
      if (repoRes && repoRes.ok) return this.#report({ state: 'up-to-date', manual, note: 'No releases have been published yet.' });
      return this.#report({ state: 'bad-token', manual, error: `This token can't see ${this.repoSlug}.` });
    }
    if (res.status === 401) return this.#report({ state: 'bad-token', manual, error: 'GitHub rejected the saved token (expired or revoked).' });
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get('x-ratelimit-reset');
      const when = reset ? ` Try again after ${new Date(+reset * 1000).toLocaleTimeString()}.` : '';
      return this.#report({ state: 'error', manual, error: `GitHub is rate-limiting update checks.${when}` });
    }
    if (!res.ok) return this.#report({ state: 'error', manual, error: `GitHub returned ${res.status}.` });

    const rel = await res.json();
    const version = String(rel.tag_name || rel.name || '').replace(/^v/, '');
    if (!parseVersion(version)) return this.#report({ state: 'error', manual, error: `Latest release tag “${rel.tag_name}” isn't a version number.` });

    const arch = process.arch === 'x64' ? 'x64' : 'arm64';
    const wanted = config.updates.assetPattern(version, arch).toLowerCase();
    const assets = rel.assets || [];
    const asset =
      assets.find((a) => a.name.toLowerCase() === wanted) ||
      assets.find((a) => /\.zip$/i.test(a.name) && /mac/i.test(a.name) && a.name.toLowerCase().includes(arch));
    this.latest = {
      version,
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      notes: rel.body || '',
      publishedAt: rel.published_at,
      htmlUrl: rel.html_url,
      asset: asset ? { id: asset.id, name: asset.name, size: asset.size, url: asset.url } : null,
    };

    if (compareVersions(version, this.currentVersion) <= 0) return this.#report({ state: 'up-to-date', manual, latest: this.latest });
    if (!manual && this.prefs.skippedVersion === version) return this.#report({ state: 'up-to-date', manual, latest: this.latest, silent: true });
    if (!asset) return this.#report({ state: 'error', manual, latest: this.latest, error: `Release ${version} has no ${wanted} download attached.` });
    return this.#report({ state: 'available', manual, latest: this.latest });
  }

  /** Automatic checks stay quiet unless there's something you'd act on. */
  #report(status) {
    if (status.manual) return this.#set(status);
    if (status.state === 'available') return this.#set(status);
    if (status.state === 'needs-token' && !this.prefs.tokenPrompted) {
      this.prefs.tokenPrompted = true;
      this.state.save();
      return this.#set({ ...status, manual: true });
    }
    this.status = { current: this.currentVersion, repo: this.repoSlug, ...status, quiet: true };
    return this.status;
  }

  startAutomaticChecks() {
    if (!config.updates.checkAutomatically) return;
    const every = config.updates.checkEveryHours * 3600 * 1000;
    setTimeout(() => this.check({ manual: false }), config.updates.checkOnLaunchAfterSeconds * 1000);
    this.interval = setInterval(() => {
      if (Date.now() - (this.prefs.lastCheck || 0) >= every) this.check({ manual: false });
    }, 15 * 60 * 1000);
  }

  // ---------------------------------------------------------------- download

  async download() {
    if (this.busy) return this.status;
    const latest = this.latest;
    if (!latest?.asset) return this.#set({ state: 'error', manual: true, error: 'Check for updates first.' });
    this.busy = true;
    const dir = path.join(this.workDir, latest.version);
    try {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.mkdir(dir, { recursive: true });
      const zipPath = path.join(dir, latest.asset.name);
      this.#set({ state: 'downloading', manual: true, latest, progress: 0 });

      const { headers } = await this.#headers({ Accept: 'application/octet-stream' });
      let res = await fetch(latest.asset.url, { headers, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        // Asset downloads redirect to signed storage URLs, which must not receive the token.
        res = await fetch(res.headers.get('location'), { headers: { 'User-Agent': headers['User-Agent'] } });
      }
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
      const total = Number(res.headers.get('content-length')) || latest.asset.size || 0;
      const out = fs.createWriteStream(zipPath);
      let received = 0;
      let lastEmit = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - lastEmit > 120) {
          lastEmit = Date.now();
          this.#set({ state: 'downloading', manual: true, latest, progress: total ? received / total : 0, received, total });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

      this.#set({ state: 'downloading', manual: true, latest, progress: 1, phase: 'unpacking' });
      const unpackDir = path.join(dir, 'unpacked');
      await fsp.mkdir(unpackDir, { recursive: true });
      if (process.platform === 'darwin') await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpackDir]);
      else await run('unzip', ['-q', zipPath, '-d', unpackDir]);
      await fsp.rm(zipPath, { force: true });

      const appName = (await fsp.readdir(unpackDir)).find((n) => n.endsWith('.app'));
      if (!appName) throw new Error('The download doesn\'t contain an app.');
      const appPath = path.join(unpackDir, appName);
      const plist = await fsp.readFile(path.join(appPath, 'Contents', 'Info.plist'), 'utf8').catch(() => '');
      const id = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
      if (id && id !== BUNDLE_ID) throw new Error(`The download is a different app (${id}).`);
      this.extractedApp = appPath;
      return this.#set({ state: 'ready', manual: true, latest });
    } catch (err) {
      return this.#set({ state: 'error', manual: true, latest, error: String(err.message || err) });
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- install

  currentBundlePath() {
    // …/Oeuvre.app/Contents/MacOS/Oeuvre → …/Oeuvre.app
    return path.resolve(path.dirname(process.execPath), '..', '..');
  }

  async install() {
    if (!this.extractedApp) return this.#set({ state: 'error', manual: true, error: 'Download the update first.' });
    if (!this.isPackaged || process.platform !== 'darwin') {
      return this.#set({ state: 'error', manual: true, latest: this.latest, error: 'Updates can only be installed by the packaged Mac app.' });
    }
    const dest = this.currentBundlePath();
    if (!dest.endsWith('.app')) return this.#set({ state: 'error', manual: true, error: `Unexpected app location: ${dest}` });
    if (dest.includes('/AppTranslocation/')) {
      return this.#set({ state: 'error', manual: true, latest: this.latest, error: 'macOS is running Oeuvre from a temporary location. Move Oeuvre into your Applications folder, open it from there, and try again.' });
    }
    try {
      await fsp.access(path.dirname(dest), fs.constants.W_OK);
    } catch {
      return this.#set({ state: 'error', manual: true, latest: this.latest, error: `Oeuvre can't write to ${path.dirname(dest)}. Move Oeuvre to your Applications folder and try again.` });
    }

    const script = path.join(this.workDir, 'install-update.sh');
    const log = path.join(this.workDir, 'install-update.log');
    await fsp.writeFile(script, `#!/bin/bash
# Written by Oeuvre to finish installing an update after the app quits.
PID="$1"; NEW="$2"; DEST="$3"
exec >>"${log}" 2>&1
echo "$(date) installing $NEW -> $DEST"
for i in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
BACKUP="\${DEST%.app}.previous-$$.app"
if ! mv "$DEST" "$BACKUP"; then echo "could not move old app"; open "$DEST"; exit 1; fi
if mv "$NEW" "$DEST" || /usr/bin/ditto "$NEW" "$DEST"; then
  rm -rf "$BACKUP"
else
  echo "install failed, restoring previous version"
  rm -rf "$DEST"; mv "$BACKUP" "$DEST"
fi
/usr/bin/xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
/usr/bin/open "$DEST"
`, { mode: 0o755 });

    this.#set({ state: 'installing', manual: true, latest: this.latest });
    const child = spawn('/bin/bash', [script, String(process.pid), this.extractedApp, dest], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => this.quit(), 300);
    return this.status;
  }
}
