// Music library: source folders, scanning, metadata cache, folder watching.
//
// Audio files are only ever read. Removing or hiding a source changes what
// Oeuvre shows; nothing on disk is moved, renamed or edited.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseFile } from 'music-metadata';
import config from '../config.mjs';
import { JsonFile } from './store.mjs';

const AUDIO_EXTS = new Set(config.library.audioExtensions);
const ART_NAMES = new Set(config.library.folderArtworkNames);
const ART_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
// Folders that are really documents (Logic projects, app bundles, …): never scanned inside.
const PACKAGE_EXTS = new Set([
  '.app', '.logicx', '.band', '.photoslibrary', '.musiclibrary', '.bundle', '.framework',
  '.plugin', '.component', '.vst', '.vst3', '.sparsebundle', '.dmg', '.git',
]);
// Bump when the stored piece shape changes so cached metadata is re-read.
const SCAN_VERSION = 3;
const PARSE_CONCURRENCY = 4;

export function pieceIdFor(absPath) {
  return 'p_' + crypto.createHash('sha1').update(absPath.normalize('NFC')).digest('hex').slice(0, 16);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

function titleFromFilename(file) {
  return path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
}

async function isDirectory(p) {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

async function walk(root, excludeDirs) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (PACKAGE_EXTS.has(path.extname(ent.name).toLowerCase())) continue;
        if (excludeDirs.some((d) => d === full)) continue;
        stack.push(full);
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        if (!AUDIO_EXTS.has(extOf(ent.name))) continue;
        try {
          const st = await fsp.stat(full);
          if (!st.isFile()) continue;
          out.push({ path: full, size: st.size, mtimeMs: Math.round(st.mtimeMs), birthtimeMs: Math.round(st.birthtimeMs || st.ctimeMs) });
        } catch {}
      }
    }
  }
  return out;
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class Library extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.file   library.json path
   * @param {string} opts.artDir directory for cached artwork
   * @param {(buf: Buffer, mime: string) => {data: Buffer, ext: string}} [opts.processArt]
   *        optional resizer for artwork (main process passes one built on nativeImage)
   */
  constructor({ file, artDir, processArt }) {
    super();
    this.store = new JsonFile(file, { version: 1, sources: [], pieces: {} });
    this.artDir = artDir;
    this.processArt = processArt;
    this.watchers = new Map();
    this.scanning = new Set();
    this.inflight = new Map();
    this.rescanRequested = new Set();
    this.closed = false;
    this.pendingRescans = new Map();
    this.changedTimer = null;
    fs.mkdirSync(artDir, { recursive: true });
  }

  get sources() { return this.store.data.sources; }
  get pieces() { return this.store.data.pieces; }

  snapshot() {
    const counts = {};
    for (const p of Object.values(this.pieces)) counts[p.sourceId] = (counts[p.sourceId] || 0) + 1;
    return {
      sources: this.sources.map((s) => ({ ...s, count: counts[s.id] || 0, scanning: this.scanning.has(s.id) })),
      pieces: Object.values(this.pieces),
    };
  }

  getPiece(id) { return this.pieces[id] || null; }

  artPath(key) {
    if (!/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(key)) return null;
    return path.join(this.artDir, key);
  }

  #changed() {
    clearTimeout(this.changedTimer);
    this.changedTimer = setTimeout(() => this.emit('changed', this.snapshot()), 80);
  }

  // ---------------------------------------------------------------- sources

  addSources(paths) {
    const added = [];
    const skipped = [];
    for (const raw of paths) {
      const p = path.resolve(raw);
      const same = this.sources.find((s) => s.path === p);
      if (same) { skipped.push({ path: p, reason: `“${same.name}” is already a source.` }); continue; }
      const parent = this.sources.find((s) => isInside(p, s.path));
      if (parent) { skipped.push({ path: p, reason: `It's already included in “${parent.name}”.` }); continue; }
      const source = {
        id: 's_' + crypto.randomBytes(6).toString('hex'),
        path: p,
        name: path.basename(p) || p,
        visible: true,
        missing: false,
        addedAt: Date.now(),
      };
      this.sources.push(source);
      added.push(source);
    }
    if (added.length) {
      this.sources.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      this.store.save();
      this.#changed();
      for (const s of added) {
        // Pieces now covered by the new (more specific or broader) source get reassigned on scan.
        this.scanSource(s.id).then(() => this.#watch(s));
      }
    }
    return { added, skipped };
  }

  removeSource(id) {
    const idx = this.sources.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    const [removed] = this.sources.splice(idx, 1);
    this.#unwatch(id);
    for (const [pid, p] of Object.entries(this.pieces)) if (p.sourceId === id) delete this.pieces[pid];
    this.store.save();
    this.#changed();
    // A parent source should now pick up the files the removed child covered.
    for (const s of this.sources) if (isInside(removed.path, s.path)) this.scanSource(s.id);
    return true;
  }

  setVisible(id, visible) {
    const s = this.sources.find((x) => x.id === id);
    if (!s) return false;
    s.visible = !!visible;
    this.store.save();
    this.#changed();
    return true;
  }

  setAllVisible(visible) {
    for (const s of this.sources) s.visible = !!visible;
    this.store.save();
    this.#changed();
  }

  // ---------------------------------------------------------------- scanning

  async start() {
    await this.scanAll();
    for (const s of this.sources) this.#watch(s);
  }

  async scanAll() {
    await Promise.all(this.sources.map((s) => this.scanSource(s.id)));
  }

  async rescanMissing() {
    const missing = this.sources.filter((s) => s.missing);
    for (const s of missing) {
      if (await isDirectory(s.path)) {
        await this.scanSource(s.id);
        this.#watch(s);
      }
    }
  }

  /** Scan one source. Calls made while a scan is running wait for a follow-up scan. */
  scanSource(id) {
    if (this.inflight.has(id)) {
      this.rescanRequested.add(id);
      return this.inflight.get(id);
    }
    const job = this.#scan(id).finally(() => {
      this.inflight.delete(id);
      if (this.rescanRequested.delete(id) && !this.closed) return this.scanSource(id);
    });
    this.inflight.set(id, job);
    return job;
  }

  async #scan(id) {
    const source = this.sources.find((s) => s.id === id);
    if (!source) return;
    this.scanning.add(id);
    this.#changed();
    try {
      if (!(await isDirectory(source.path))) {
        source.missing = true;
        this.store.save();
        return;
      }
      source.missing = false;
      const childSources = this.sources.filter((s) => s.id !== id && isInside(s.path, source.path)).map((s) => s.path);
      const files = await walk(source.path, childSources);

      const before = new Map();
      for (const [pid, p] of Object.entries(this.pieces)) if (p.sourceId === id) before.set(pid, p);

      const seen = new Set();
      const fresh = [];
      for (const f of files) {
        const pid = pieceIdFor(f.path);
        seen.add(pid);
        const existing = this.pieces[pid];
        const rel = path.relative(source.path, path.dirname(f.path));
        if (existing && existing.size === f.size && existing.mtimeMs === f.mtimeMs && existing.scanVersion === SCAN_VERSION) {
          if (existing.sourceId !== id || existing.folder !== rel) {
            existing.sourceId = id;
            existing.folder = rel;
          }
          continue;
        }
        fresh.push({ ...f, pid, rel, wasKnown: !!existing });
      }

      const folderArtCache = new Map();
      await pool(fresh, PARSE_CONCURRENCY, async (f) => {
        const meta = await this.#readMeta(f.path);
        let artKey = meta.artKey;
        if (!artKey) artKey = await this.#folderArt(path.dirname(f.path), folderArtCache);
        const prev = this.pieces[f.pid];
        this.pieces[f.pid] = {
          id: f.pid,
          path: f.path,
          fileName: path.basename(f.path),
          sourceId: id,
          folder: f.rel,
          ext: extOf(f.path),
          size: f.size,
          mtimeMs: f.mtimeMs,
          birthtimeMs: f.birthtimeMs,
          addedAt: prev?.addedAt || Date.now(),
          scanVersion: SCAN_VERSION,
          ...meta,
          artKey,
        };
      });

      // Pieces that vanished from this source.
      const removed = [];
      for (const [pid, p] of before) {
        if (!seen.has(pid) && this.pieces[pid]?.sourceId === id) {
          removed.push(p);
          delete this.pieces[pid];
        }
      }

      // A file that was renamed or moved inside the source keeps its Portfolio,
      // setlist and score links: match it by size + file name, then size + mtime.
      const relinks = {};
      if (removed.length) {
        const candidates = fresh.filter((f) => !f.wasKnown);
        for (const old of removed) {
          const match =
            candidates.find((f) => f.size === old.size && path.basename(f.path) === old.fileName) ||
            candidates.find((f) => f.size === old.size && f.mtimeMs === old.mtimeMs);
          if (match) {
            relinks[old.id] = match.pid;
            candidates.splice(candidates.indexOf(match), 1);
            if (this.pieces[match.pid]) this.pieces[match.pid].addedAt = old.addedAt;
          }
        }
      }

      this.store.save();
      if (Object.keys(relinks).length) this.emit('relink', relinks);
    } catch (err) {
      console.error('[library] scan failed for', source.path, err);
    } finally {
      this.scanning.delete(id);
      this.#changed();
    }
  }

  async #readMeta(file) {
    try {
      const meta = await parseFile(file, { duration: true, skipCovers: false });
      const c = meta.common;
      const fmt = meta.format;
      let artKey = null;
      const pic = c.picture && c.picture[0];
      if (pic && pic.data?.length) artKey = await this.#saveArt(Buffer.from(pic.data), pic.format);
      return {
        title: (c.title || '').trim() || titleFromFilename(file),
        artist: c.artist || c.albumartist || '',
        album: c.album || '',
        year: c.year || null,
        genre: (c.genre && c.genre[0]) || '',
        comment: (c.comment && c.comment[0] && (c.comment[0].text ?? c.comment[0])) || '',
        duration: Number.isFinite(fmt.duration) ? fmt.duration : 0,
        sampleRate: fmt.sampleRate || null,
        bitsPerSample: fmt.bitsPerSample || null,
        bitrate: fmt.bitrate ? Math.round(fmt.bitrate) : null,
        channels: fmt.numberOfChannels || null,
        codec: fmt.codec || '',
        container: fmt.container || '',
        lossless: !!fmt.lossless,
        artKey,
        error: null,
      };
    } catch (err) {
      return {
        title: titleFromFilename(file), artist: '', album: '', year: null, genre: '', comment: '',
        duration: 0, sampleRate: null, bitsPerSample: null, bitrate: null, channels: null,
        codec: '', container: '', lossless: false, artKey: null, error: String(err.message || err),
      };
    }
  }

  async #saveArt(buf, mime) {
    try {
      let data = buf;
      let ext = /png/i.test(mime || '') ? 'png' : 'jpg';
      if (this.processArt) {
        const processed = this.processArt(buf, mime);
        if (processed) { data = processed.data; ext = processed.ext; }
      }
      const key = crypto.createHash('sha1').update(data).digest('hex') + '.' + ext;
      const dest = path.join(this.artDir, key);
      if (!fs.existsSync(dest)) await fsp.writeFile(dest, data);
      return key;
    } catch (err) {
      console.warn('[library] artwork not saved:', err.message);
      return null;
    }
  }

  async #folderArt(dir, cache) {
    if (cache.has(dir)) return cache.get(dir);
    const job = (async () => {
      let entries = [];
      try { entries = await fsp.readdir(dir); } catch { return null; }
      const hit = entries.find((n) => ART_NAMES.has(path.basename(n, path.extname(n)).toLowerCase()) && ART_EXTS.has(extOf(n)));
      if (!hit) return null;
      try {
        const buf = await fsp.readFile(path.join(dir, hit));
        return await this.#saveArt(buf, extOf(hit) === 'png' ? 'image/png' : 'image/jpeg');
      } catch { return null; }
    })();
    cache.set(dir, job);
    return job;
  }

  // ---------------------------------------------------------------- watching

  #watch(source) {
    if (this.closed || this.watchers.has(source.id) || source.missing) return;
    try {
      const w = fs.watch(source.path, { recursive: true }, (_evt, filename) => {
        if (filename && filename.split(path.sep).some((part) => part.startsWith('.'))) return;
        this.#scheduleRescan(source.id);
      });
      w.on('error', () => {
        this.#unwatch(source.id);
        this.#scheduleRescan(source.id);
      });
      this.watchers.set(source.id, w);
    } catch (err) {
      console.warn('[library] cannot watch', source.path, err.message);
    }
  }

  #unwatch(id) {
    const w = this.watchers.get(id);
    if (w) { try { w.close(); } catch {} }
    this.watchers.delete(id);
    clearTimeout(this.pendingRescans.get(id));
    this.pendingRescans.delete(id);
  }

  #scheduleRescan(id) {
    clearTimeout(this.pendingRescans.get(id));
    this.pendingRescans.set(id, setTimeout(() => {
      this.pendingRescans.delete(id);
      this.scanSource(id);
    }, config.library.rescanDelaySeconds * 1000));
  }

  close() {
    this.closed = true;
    clearTimeout(this.changedTimer);
    for (const id of [...this.watchers.keys()]) this.#unwatch(id);
    this.store.flush();
  }
}
