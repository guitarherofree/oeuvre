// App-wide state for the window, mirrored from the main process.
import { signal, computed, batch } from '@preact/signals';
import config from '../../config.mjs';
import { sortByTitle, matchesQuery } from './format.js';

export const api = window.oeuvre;
export const invoke = (channel, ...args) => api.invoke(channel, ...args);

export const ready = signal(false);
export const appInfo = signal({ version: '', platform: '', isPackaged: false });
export const library = signal({ sources: [], pieces: [] });
export const collections = signal({ portfolio: [], setlists: [], scores: {}, refs: {} });
export const route = signal({ view: 'oeuvre' });
export const queueOpen = signal(false);
export const filters = signal({});
export const selection = signal({ key: null, ids: [], anchor: null });
export const modal = signal(null);
export const toasts = signal([]);
export const exportState = signal(null);
export const updateStatus = signal(null);
export const sourcesMenuOpen = signal(false);
// Portfolio is a single list that exports MP3. Projects are many lists that export WAV.
export const LISTS = {
  portfolio: { name: 'portfolio', label: 'Portfolio', format: 'mp3', noun: 'work sample' },
};
// Sort direction per list: 'portfolio' or a project id. Missing ids use the config default.
export const listDescending = signal({ portfolio: config.portfolio.sortDescending });
export function isDescending(key) {
  const v = listDescending.value[key];
  return typeof v === 'boolean' ? v : (key === 'portfolio' ? config.portfolio.sortDescending : config.projects.sortDescending);
}
export const dragging = signal(null); // { ids, from }

const back = signal([]);
const forward = signal([]);
export const canGoBack = computed(() => back.value.length > 0);
export const canGoForward = computed(() => forward.value.length > 0);

// ---------------------------------------------------------------- derived

export const piecesById = computed(() => new Map(library.value.pieces.map((p) => [p.id, p])));
export const sourcesById = computed(() => new Map(library.value.sources.map((s) => [s.id, s])));
export const visibleSourceIds = computed(() => new Set(library.value.sources.filter((s) => s.visible && !s.missing).map((s) => s.id)));
export const libraryPieces = computed(() => sortByTitle(library.value.pieces.filter((p) => visibleSourceIds.value.has(p.sourceId)), config.library.sortDescending));
export const listIds = computed(() => Object.fromEntries(
  Object.keys(LISTS).map((name) => [name, new Set((collections.value[name] || []).map((e) => e.pieceId))]),
));
export const portfolioIds = computed(() => listIds.value.portfolio);
export const setlistsById = computed(() => new Map(collections.value.setlists.map((s) => [s.id, s])));
export const projectsById = computed(() => new Map((collections.value.projects || []).map((p) => [p.id, p])));

export function isAvailable(id) {
  const p = piecesById.value.get(id);
  if (!p) return false;
  const s = sourcesById.value.get(p.sourceId);
  return !!s && !s.missing;
}

export function isVisible(id) {
  const p = piecesById.value.get(id);
  return !!p && visibleSourceIds.value.has(p.sourceId);
}

/** A piece, or a stand-in built from what collections remember about a missing one. */
export function pieceOrRef(id) {
  const p = piecesById.value.get(id);
  if (p) return p;
  const ref = collections.value.refs[id];
  return { id, title: ref?.title || 'Missing piece', path: ref?.path || '', duration: ref?.duration || 0, ext: ref?.ext || '', missing: true };
}

export function scoresFor(id) {
  return collections.value.scores[id] || [];
}

export function sourceName(piece) {
  return sourcesById.value.get(piece?.sourceId)?.name || '';
}

export function filterPieces(list, q) {
  if (!q) return list;
  return list.filter((p) => matchesQuery(p, sourceName(p), q));
}

export function viewKey(r = route.value) {
  return r.view === 'setlist' || r.view === 'project' ? `${r.view}:${r.id}` : r.view;
}

export function setFilter(key, text) {
  filters.value = { ...filters.value, [key]: text };
}

// ---------------------------------------------------------------- navigation

export function navigate(next, { replace = false } = {}) {
  const cur = route.value;
  if (JSON.stringify(cur) === JSON.stringify(next)) return;
  batch(() => {
    if (!replace) {
      back.value = [...back.value.slice(-49), cur];
      forward.value = [];
    }
    route.value = next;
    selection.value = { key: null, ids: [], anchor: null };
  });
  document.querySelector('.main-scroll')?.scrollTo(0, 0);
  saveUi();
}

export function goBack() {
  const stack = back.value;
  if (!stack.length) return;
  batch(() => {
    forward.value = [route.value, ...forward.value];
    route.value = stack[stack.length - 1];
    back.value = stack.slice(0, -1);
  });
  saveUi();
}

export function goForward() {
  const [next, ...rest] = forward.value;
  if (!next) return;
  batch(() => {
    back.value = [...back.value, route.value];
    route.value = next;
    forward.value = rest;
  });
  saveUi();
}

let uiTimer;
export function saveUi() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    const r = route.value.view === 'score' ? { view: 'oeuvre' } : route.value;
    invoke('state:save', { ui: { route: r, queueOpen: queueOpen.value, listDescending: listDescending.value } });
  }, 300);
}

// ---------------------------------------------------------------- toasts

let toastSeq = 0;
export function toast(message, { action, onAction, timeout = 3800 } = {}) {
  const id = ++toastSeq;
  toasts.value = [...toasts.value.slice(-2), { id, message, action, onAction }];
  setTimeout(() => dismissToast(id), timeout);
}
export function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
