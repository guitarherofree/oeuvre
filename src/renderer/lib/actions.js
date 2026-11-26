// User actions shared by menus, buttons, shortcuts and drag-and-drop.
import {
  invoke, navigate, toast, modal, collections, setlistsById, portfolioIds, piecesById, scoresFor,
  exportState, updateStatus, route, libraryPieces, pieceOrRef, LISTS, projectsById, isDescending,
} from './store.js';
import { plural, sortByTitle } from './format.js';
import { addToQueue, playNext, playContext } from './player.js';

export async function addSourceFolders() {
  await invoke('library:addSources');
}

export async function addToList(name, ids) {
  const { label } = LISTS[name];
  const added = await invoke('collection:add', name, ids);
  if (added) toast(`Added ${plural(added, 'piece')} to ${label}`, { action: 'View', onAction: () => navigate({ view: name }) });
  else toast(ids.length === 1 ? `Already in ${label}` : `Those pieces are already in ${label}`);
}

export async function removeFromList(name, ids) {
  const n = await invoke('collection:remove', name, ids);
  if (n) toast(`Removed ${plural(n, 'piece')} from ${LISTS[name].label}`);
}

export const addToPortfolio = (ids) => addToList('portfolio', ids);
export const removeFromPortfolio = (ids) => removeFromList('portfolio', ids);

/** Creates "Collection 00N" (optionally with pieces) and opens it. */
export async function createProject(pieceIds = []) {
  const p = await invoke('project:create', { pieceIds });
  navigate({ view: 'project', id: p.id });
  toast(pieceIds.length ? `Created “${p.name}” with ${plural(pieceIds.length, 'piece')}` : `Created “${p.name}”`);
  return p;
}

export async function addToProject(id, ids) {
  const name = projectsById.value.get(id)?.name || 'project';
  const added = await invoke('project:add', id, ids);
  if (added) toast(`Added ${plural(added, 'piece')} to ${name}`, { action: 'View', onAction: () => navigate({ view: 'project', id }) });
  else toast(ids.length === 1 ? `Already in ${name}` : `Those pieces are already in ${name}`);
}

export async function removeFromProject(id, ids) {
  const n = await invoke('project:remove', id, ids);
  if (n) toast(`Removed ${plural(n, 'piece')} from ${projectsById.value.get(id)?.name || 'the project'}`);
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

/** target: { label, format } — Portfolio is { 'Portfolio', 'mp3' }, a project is { its name, 'wav' }. */
export async function exportPieces(ids, mode, { label = 'Portfolio', format = 'mp3' } = {}) {
  if (!ids.length) {
    toast(`Select the ${label} pieces to export first.`);
    return;
  }
  const result = await invoke('export:start', { pieceIds: ids, mode, format, label });
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
    case 'listAdd': return addToList(arg, ids);
    case 'listRemove': return removeFromList(arg, ids);
    case 'projectNew': return createProject(ids);
    case 'projectToggle': return arg.hasAll ? removeFromProject(arg.id, ids) : addToProject(arg.id, ids);
    case 'projectRemove': return removeFromProject(arg, ids);
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
  if (LISTS[r.view]) {
    const ids = sortByTitle(collections.value[r.view].map((e) => pieceOrRef(e.pieceId)), isDescending(r.view))
      .filter((p) => !p.missing).map((p) => p.id);
    if (ids.length) playContext({ type: r.view, name: LISTS[r.view].label, ids }, 0);
    return;
  }
  if (r.view === 'project') {
    const p = projectsById.value.get(r.id);
    const ids = p ? sortByTitle(p.items.map((e) => pieceOrRef(e.pieceId)), isDescending(p.id)).filter((x) => !x.missing).map((x) => x.id) : [];
    if (ids.length) playContext({ type: 'project', id: p.id, name: p.name, ids }, 0);
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
