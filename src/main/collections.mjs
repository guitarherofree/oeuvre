// Portfolio, setlists and score attachments (collections.json).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import config from '../config.mjs';
import { JsonFile } from './store.mjs';

const run = promisify(execFile);
const rid = (prefix) => prefix + crypto.randomBytes(6).toString('hex');
const PDF_EXTS = new Set(config.scores.pdfExtensions);
const IMAGE_EXTS = new Set(config.scores.imageExtensions);
const NEEDS_CONVERSION = new Set(['heic', 'heif']);

/** Simple lists of pieces: Portfolio (exports MP3) and Project (exports WAV). */
export const LISTS = ['portfolio', 'project'];

export function scoreKindFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export class Collections extends EventEmitter {
  constructor({ file, scoresDir }) {
    super();
    this.scoresDir = scoresDir;
    this.store = new JsonFile(file, { version: 1, portfolio: [], project: [], setlists: [], scores: {}, refs: {} });
    for (const name of LISTS) if (!Array.isArray(this.store.data[name])) this.store.data[name] = [];
    fs.mkdirSync(scoresDir, { recursive: true });
    this.timer = null;
  }

  get data() { return this.store.data; }

  snapshot() { return this.data; }

  #changed() {
    this.store.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emit('changed', this.snapshot()), 30);
  }

  /** Remember a title/path for pieces in collections so they still read sensibly if their file goes missing. */
  #remember(pieces) {
    for (const p of pieces) {
      if (!p) continue;
      this.data.refs[p.id] = { title: p.title, path: p.path, duration: p.duration, ext: p.ext };
    }
  }

  // ---------------------------------------------------------------- Portfolio and Project

  #list(name) {
    if (!LISTS.includes(name)) throw new Error(`Unknown collection ${name}`);
    return this.data[name];
  }

  listAdd(name, pieces) {
    const list = this.#list(name);
    const have = new Set(list.map((e) => e.pieceId));
    let added = 0;
    for (const p of pieces) {
      if (!p || have.has(p.id)) continue;
      list.push({ pieceId: p.id, addedAt: Date.now() });
      have.add(p.id);
      added++;
    }
    this.#remember(pieces);
    this.#changed();
    return added;
  }

  listRemove(name, pieceIds) {
    const list = this.#list(name);
    const drop = new Set(pieceIds);
    const kept = list.filter((e) => !drop.has(e.pieceId));
    this.data[name] = kept;
    this.#changed();
    return list.length - kept.length;
  }

  listHas(name, pieceId) {
    return this.#list(name).some((e) => e.pieceId === pieceId);
  }

  portfolioAdd(pieces) { return this.listAdd('portfolio', pieces); }
  portfolioRemove(pieceIds) { return this.listRemove('portfolio', pieceIds); }

  // ---------------------------------------------------------------- setlists

  setlistCreate({ name, date = '', venue = '', notes = '' } = {}) {
    const setlist = {
      id: rid('sl_'),
      name: (name || '').trim() || 'New Setlist',
      date, venue, notes,
      createdAt: Date.now(),
      items: [],
    };
    this.data.setlists.push(setlist);
    this.#changed();
    return setlist;
  }

  #setlist(id) {
    const s = this.data.setlists.find((x) => x.id === id);
    if (!s) throw new Error('Setlist not found');
    return s;
  }

  setlistUpdate(id, patch) {
    const s = this.#setlist(id);
    for (const key of ['name', 'date', 'venue', 'notes']) {
      if (key in patch) s[key] = String(patch[key] ?? '');
    }
    if (!s.name.trim()) s.name = 'Untitled Setlist';
    this.#changed();
    return s;
  }

  setlistDelete(id) {
    this.data.setlists = this.data.setlists.filter((x) => x.id !== id);
    this.#changed();
  }

  setlistAdd(id, pieces, atIndex = null) {
    const s = this.#setlist(id);
    const items = pieces.filter(Boolean).map((p) => ({ id: rid('it_'), pieceId: p.id }));
    if (atIndex === null || atIndex < 0 || atIndex > s.items.length) s.items.push(...items);
    else s.items.splice(atIndex, 0, ...items);
    this.#remember(pieces);
    this.#changed();
    return items.length;
  }

  setlistRemoveItems(id, itemIds) {
    const s = this.#setlist(id);
    const drop = new Set(itemIds);
    s.items = s.items.filter((it) => !drop.has(it.id));
    this.#changed();
  }

  setlistReorder(id, itemIds) {
    const s = this.#setlist(id);
    const byId = new Map(s.items.map((it) => [it.id, it]));
    const next = itemIds.map((iid) => byId.get(iid)).filter(Boolean);
    // Keep anything the renderer didn't mention (shouldn't happen) at the end.
    for (const it of s.items) if (!itemIds.includes(it.id)) next.push(it);
    s.items = next;
    this.#changed();
  }

  // ---------------------------------------------------------------- scores

  scoresFor(pieceId) { return this.data.scores[pieceId] || []; }

  findScore(scoreId) {
    for (const [pieceId, list] of Object.entries(this.data.scores)) {
      const entry = list.find((s) => s.id === scoreId);
      if (entry) return { pieceId, entry };
    }
    return null;
  }

  scoreFilePath(entry, { display = false } = {}) {
    const rel = display && entry.displayFile ? entry.displayFile : entry.file;
    return path.join(this.scoresDir, path.basename(rel));
  }

  /** Copy score files into Oeuvre's own storage and attach them to a piece. */
  async importScores(piece, filePaths) {
    const list = this.data.scores[piece.id] || (this.data.scores[piece.id] = []);
    const added = [];
    for (const src of filePaths) {
      const ext = path.extname(src).toLowerCase();
      const id = rid('sc_');
      const fileName = id + ext;
      await fsp.copyFile(src, path.join(this.scoresDir, fileName));
      let kind = scoreKindFor(src);
      let displayFile = null;
      if (kind === 'image' && NEEDS_CONVERSION.has(ext.slice(1))) {
        displayFile = await this.#convertForDisplay(path.join(this.scoresDir, fileName), id);
        if (!displayFile) kind = 'other';
      }
      const entry = {
        id,
        name: path.basename(src),
        kind,
        file: fileName,
        displayFile,
        size: (await fsp.stat(src)).size,
        importedAt: Date.now(),
      };
      list.push(entry);
      added.push(entry);
    }
    this.#remember([piece]);
    this.#changed();
    return added;
  }

  async #convertForDisplay(file, id) {
    // HEIC/HEIF isn't drawn by Chromium; macOS's built-in `sips` makes a JPEG copy.
    if (process.platform !== 'darwin') return null;
    const out = id + '.display.jpg';
    try {
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', file, '--out', path.join(this.scoresDir, out)]);
      return out;
    } catch (err) {
      console.warn('[scores] HEIC conversion failed:', err.message);
      return null;
    }
  }

  renameScore(scoreId, name) {
    const hit = this.findScore(scoreId);
    if (!hit) return;
    hit.entry.name = String(name || '').trim() || hit.entry.name;
    this.#changed();
  }

  reorderScores(pieceId, scoreIds) {
    const list = this.data.scores[pieceId];
    if (!list) return;
    const byId = new Map(list.map((s) => [s.id, s]));
    this.data.scores[pieceId] = scoreIds.map((id) => byId.get(id)).filter(Boolean)
      .concat(list.filter((s) => !scoreIds.includes(s.id)));
    this.#changed();
  }

  async removeScore(scoreId) {
    const hit = this.findScore(scoreId);
    if (!hit) return;
    const list = this.data.scores[hit.pieceId];
    list.splice(list.indexOf(hit.entry), 1);
    if (!list.length) delete this.data.scores[hit.pieceId];
    // These are Oeuvre's own copies; the file you imported from is untouched.
    for (const f of [hit.entry.file, hit.entry.displayFile]) {
      if (f) await fsp.rm(path.join(this.scoresDir, path.basename(f)), { force: true });
    }
    this.#changed();
  }

  // ---------------------------------------------------------------- relinking

  /** A piece's file moved or was renamed: point every reference at its new id. */
  relink(map) {
    let touched = false;
    for (const name of LISTS) for (const e of this.data[name]) if (map[e.pieceId]) { e.pieceId = map[e.pieceId]; touched = true; }
    for (const s of this.data.setlists) for (const it of s.items) if (map[it.pieceId]) { it.pieceId = map[it.pieceId]; touched = true; }
    for (const [oldId, newId] of Object.entries(map)) {
      if (this.data.scores[oldId]) {
        this.data.scores[newId] = (this.data.scores[newId] || []).concat(this.data.scores[oldId]);
        delete this.data.scores[oldId];
        touched = true;
      }
      if (this.data.refs[oldId]) { this.data.refs[newId] = this.data.refs[oldId]; delete this.data.refs[oldId]; }
    }
    if (touched) this.#changed();
  }

  close() { this.store.flush(); }
}
