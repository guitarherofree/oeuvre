// Small JSON persistence layer: atomic writes, debounced saves, sync flush on quit.
import fs from 'node:fs';
import path from 'node:path';

export class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.timer = null;
    this.data = this.#load();
  }

  #load() {
    const base = structuredClone(this.defaults);
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...base, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep a copy of an unreadable file instead of silently overwriting it.
        try { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch {}
        console.error(`[store] could not read ${this.file}:`, err.message);
      }
      return base;
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
