// User actions shared by menus, buttons, shortcuts and drag-and-drop.
import {
  invoke, navigate, toast, modal, collections, setlistsById, portfolioIds, piecesById, scoresFor,
  exportState, updateStatus, route, libraryPieces, pieceOrRef,
} from './store.js';
import { plural, byTitle } from './format.js';
import { addToQueue, playNext, playContext } from './player.js';

export async function addSourceFolders() {
  await invoke('library:addSources');
}

export async function addToPortfolio(ids) {
  const added = await invoke('portfolio:add', ids);
  if (added) toast(`Added ${plural(added, 'piece')} to Portfolio`, { action: 'View', onAction: () => navigate({ view: 'portfolio' }) });
  else toast(ids.length === 1 ? 'Already in Portfolio' : 'Those pieces are already in Portfolio');
}

export async function removeFromPortfolio(ids) {
  const n = await invoke('portfolio:remove', ids);
  if (n) toast(`Removed ${plural(n, 'piece')} from Portfolio`);
}

export function promptNewSetlist(pieceIds = []) {
  modal.value = { type: 'newSetlist', pieceIds };
}

export async function createSetlist(name, pieceIds = []) {
  const s = await invoke('setlist:create', { name, pieceIds });
  navigate({ view: 'setlist', id: s.id });
  return s;
}

export async function addToSetlist(setlistId, ids, atIndex = null) {
  const n = await invoke('setlist:add', setlistId, ids, atIndex);
  const s = setlistsById.value.get(setlistId);
  if (n) toast(`Added ${plural(n, 'piece')} to ${s?.name || 'setlist'}`, { action: 'View', onAction: () => navigate({ view: 'setlist', id: setlistId }) });
}

export async function attachScore(pieceId, { open = true } = {}) {
  const added = await invoke('score:attach', pieceId);
  if (added?.length && open) openScore(pieceId, added[0].id);
  return added;
}

export function openScore(pieceId, scoreId = null) {
  const list = scoresFor(pieceId);
  if (!list.length) return attachScore(pieceId);
  const from = route.value.view === 'score' ? route.value.from : route.value;
  navigate({ view: 'score', pieceId, scoreId: scoreId || list[0].id, from });
}

export async function exportPieces(ids, mode) {
  if (!ids.length) {
    toast('Select the Portfolio pieces to export first.');
    return;
  }
  const result = await invoke('export:start', { pieceIds: ids, mode });
  if (result?.canceled) { exportState.value = null; return; }
  if (result?.error) {
    exportState.value = null;
    modal.value = { type: 'message', title: 'Export didn\'t finish', body: result.error };
    return;
  }
  exportState.value = { ...(exportState.value || {}), phase: 'finished', result };
}

export function checkForUpdates() {
  modal.value = { type: 'update' };
  invoke('updates:check').then((s) => { updateStatus.value = s; });
}

/** Handles a choice from the native right-click menu for one or more pieces. */
export async function runPieceAction(choice, ids, context) {
  if (!choice) return;
  const { action, arg } = choice;
  switch (action) {
    case 'play':
      playContext({ type: 'selection', name: context?.name || 'Selection', ids }, 0);
      break;
    case 'playNext':
      playNext(ids);
      toast(ids.length === 1 ? `“${pieceOrRef(ids[0]).title}” plays next` : `${plural(ids.length, 'piece')} play next`);
      break;
    case 'addToQueue':
      addToQueue(ids);
      toast(`Added ${plural(ids.length, 'piece')} to the queue`);
      break;
    case 'portfolioAdd': return addToPortfolio(ids);
    case 'portfolioRemove': return removeFromPortfolio(ids);
    case 'setlistNew': return promptNewSetlist(ids);
    case 'setlistAdd': return addToSetlist(arg, ids);
    case 'setlistRemove':
      if (context?.type === 'setlist' && context.itemIds?.length) await invoke('setlist:removeItems', context.id, context.itemIds);
      break;
    case 'attachScore': return attachScore(ids[0]);
    case 'openScore': return openScore(ids[0]);
    case 'reveal': return invoke('piece:reveal', ids[0]);
    default:
  }
}

export async function showPieceMenu(ids, context) {
  const choice = await invoke('piece:contextMenu', { pieceIds: ids, context: context ? { type: context.type, id: context.id } : null });
  return runPieceAction(choice, ids, context);
}

/** Play whatever the current page shows (used by Space when nothing is loaded yet). */
export function playCurrentPage() {
  const r = route.value;
  if (r.view === 'portfolio') {
    const ids = collections.value.portfolio.map((e) => e.pieceId).map(pieceOrRef).sort(byTitle).map((p) => p.id);
    if (ids.length) playContext({ type: 'portfolio', name: 'Portfolio', ids }, 0);
    return;
  }
  if (r.view === 'setlist') {
    const s = setlistsById.value.get(r.id);
    if (s?.items.length) playContext({ type: 'setlist', id: s.id, name: s.name, ids: s.items.map((i) => i.pieceId) }, 0);
    return;
  }
  const ids = libraryPieces.value.map((p) => p.id);
  if (ids.length) playContext({ type: 'oeuvre', name: 'Oeuvre', ids }, 0);
}

export { portfolioIds, piecesById };
