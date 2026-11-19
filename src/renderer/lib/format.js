export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const byTitle = (a, b) => collator.compare(a.title || '', b.title || '') || collator.compare(a.path || '', b.path || '');
export const byTitleDesc = (a, b) => byTitle(b, a);
export const sortByTitle = (list, descending) => list.slice().sort(descending ? byTitleDesc : byTitle);

const pad = (n) => String(n).padStart(2, '0');

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtTotal(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h} hr ${m} min`;
  if (m) return s && m < 10 ? `${m} min ${s} sec` : `${m} min`;
  return `${s} sec`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export function fmtDate(ms) {
  if (!ms) return '';
  return dateFmt.format(new Date(ms));
}

export function fmtShowDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export function plural(n, word, many = `${word}s`) {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

export function formatLabel(p) {
  if (!p) return '';
  if (p.ext === 'm4a') return /alac/i.test(p.codec || '') ? 'ALAC' : 'AAC';
  return (p.ext || '').toUpperCase();
}

export function formatDetail(p) {
  if (!p) return '';
  const parts = [formatLabel(p)];
  if (p.sampleRate) parts.push(`${+(p.sampleRate / 1000).toFixed(1)} kHz`);
  if (p.lossless && p.bitsPerSample) parts.push(`${p.bitsPerSample}-bit`);
  else if (p.bitrate) parts.push(`${Math.round(p.bitrate / 1000)} kbps`);
  return parts.join(' · ');
}

export function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function matchesQuery(piece, sourceName, q) {
  if (!q) return true;
  const hay = `${piece.title} ${piece.artist || ''} ${piece.album || ''} ${piece.folder || ''} ${sourceName || ''} ${piece.fileName || ''} ${formatLabel(piece)} ${piece.year || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

export function initials(title) {
  const words = String(title || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || '♪';
}

// Deterministic hue offset so pieces without artwork get distinct but on-theme tiles.
export function tileHue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 120 + (h % 70) - 25; // greens through teals
}
