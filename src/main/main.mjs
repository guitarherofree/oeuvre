// Oeuvre — main process.
import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import config from '../config.mjs';
import { JsonFile } from './store.mjs';
import { Library } from './library.mjs';
import { Collections } from './collections.mjs';
import { exportPieces } from './exporter.mjs';
import { Updater } from './updater.mjs';
import { registerSchemes, handleSchemes } from './protocol.mjs';
import { buildAppMenu, pieceContextMenu } from './menu.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

app.setName(config.appName);
if (process.env.OEUVRE_USER_DATA) app.setPath('userData', path.resolve(process.env.OEUVRE_USER_DATA));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

registerSchemes();

const userData = app.getPath('userData');
const state = new JsonFile(path.join(userData, 'state.json'), { version: 1, window: null, player: null, ui: null, updates: null });
let library;
let collections;
let updater;
let win = null;
let playerState = { playing: false, shuffle: false, repeat: 'off' };
let exportAbort = null;
let quitting = false;

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function ffmpegPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'ffmpeg');
  return require('ffmpeg-static');
}

function processArt(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width } = img.getSize();
  const out = width > 640 ? img.resize({ width: 640, quality: 'best' }) : img;
  return { data: out.toJPEG(88), ext: 'jpg' };
}

// ---------------------------------------------------------------- menu actions

const actions = {
  async addSources() {
    const res = await dialog.showOpenDialog(win, {
      title: 'Add Source Folders',
      buttonLabel: 'Add',
      properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { added: [], skipped: [] };
    const result = library.addSources(res.filePaths);
    if (result.skipped.length) {
      dialog.showMessageBox(win, {
        type: 'info',
        message: result.skipped.length === 1 ? 'That folder wasn\'t added.' : 'Some folders weren\'t added.',
        detail: result.skipped.map((s) => `${path.basename(s.path)}: ${s.reason}`).join('\n'),
      });
    }
    return result;
  },
  async removeSource(id) {
    const s = library.sources.find((x) => x.id === id);
    if (!s) return false;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Remove', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `Remove “${s.name}” from Oeuvre?`,
      detail: 'Its pieces will disappear from your library. Nothing is deleted from your Mac, and Portfolio, setlist and score links come back if you add the folder again.',
    });
    if (response !== 0) return false;
    return library.removeSource(id);
  },
  setVisible: (id, visible) => library.setVisible(id, visible),
  setAllVisible: (visible) => library.setAllVisible(visible),
  rescan: () => library.scanAll(),
};

function rebuildMenu() {
  buildAppMenu({ library, player: playerState, send: (cmd, arg) => send('menu:command', cmd, arg), actions });
}

// ---------------------------------------------------------------- window

function createWindow() {
  const saved = state.data.window;
  const bounds = { width: 1320, height: 860 };
  if (saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width && saved.y < a.y + a.height;
  })) Object.assign(bounds, { x: saved.x, y: saved.y, width: saved.width, height: saved.height });

  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: config.appName,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 22, y: 33 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (saved?.maximized) win.maximize();

  win.loadURL('oeuvre-app://app/index.html');
  win.once('ready-to-show', () => win.show());

  let boundsTimer;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const maximized = win.isMaximized();
      const b = maximized ? (state.data.window || win.getNormalBounds()) : win.getBounds();
      state.data.window = { ...b, maximized };
      state.save();
    }, 400);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('focus', () => library.rescanMissing());
  // Closing the window hides it so music keeps playing (like Spotify); Quit ends playback.
  win.on('close', (e) => {
    if (!quitting && process.platform === 'darwin') {
      e.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else win.hide();
    }
  });
  win.on('closed', () => { win = null; });

  // Keep the window on Oeuvre's own page; real links open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('oeuvre-app://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------- IPC

function piecesFor(ids) {
  return (ids || []).map((id) => library.getPiece(id)).filter(Boolean);
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('app:init', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    library: library.snapshot(),
    collections: collections.snapshot(),
    player: config.playback.restoreSessionOnLaunch ? state.data.player : null,
    ui: state.data.ui,
    updateStatus: updater.status,
  }));

  handle('state:save', (partial) => {
    for (const key of ['player', 'ui']) if (partial && key in partial) state.data[key] = partial[key];
    state.save();
  });

  ipcMain.on('menu:playerState', (_e, s) => {
    const changed = s.playing !== playerState.playing || s.shuffle !== playerState.shuffle || s.repeat !== playerState.repeat;
    playerState = { ...playerState, ...s };
    if (changed) rebuildMenu();
  });

  handle('ui:confirm', async ({ message, detail, confirmLabel = 'OK', destructive = false }) => {
    const { response } = await dialog.showMessageBox(win, {
      type: destructive ? 'warning' : 'question',
      buttons: [confirmLabel, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message,
      detail,
    });
    return response === 0;
  });

  handle('shell:openExternal', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  // library
  handle('library:addSources', () => actions.addSources());
  handle('library:addPaths', (paths) => {
    const dirs = (paths || []).filter((p) => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isDirectory());
    if (!dirs.length) return { added: [], skipped: [], notFolders: true };
    const result = library.addSources(dirs);
    if (result.skipped.length) {
      dialog.showMessageBox(win, {
        type: 'info',
        message: result.skipped.length === 1 ? 'That folder wasn\'t added.' : 'Some folders weren\'t added.',
        detail: result.skipped.map((x) => `${path.basename(x.path)}: ${x.reason}`).join('\n'),
      });
    }
    return result;
  });
  handle('library:removeSource', (id) => actions.removeSource(id));
  handle('library:setVisible', (id, visible) => library.setVisible(id, visible));
  handle('library:setAllVisible', (visible) => library.setAllVisible(visible));
  handle('library:rescan', () => library.scanAll());
  handle('piece:reveal', (id) => {
    const p = library.getPiece(id);
    if (p) shell.showItemInFolder(p.path);
  });
  handle('piece:contextMenu', ({ pieceIds, context }) => {
    const ids = pieceIds || [];
    const inPortfolio = ids.length > 0 && ids.every((id) => collections.data.portfolio.some((e) => e.pieceId === id));
    return pieceContextMenu(win, {
      pieces: ids,
      setlists: collections.data.setlists,
      inPortfolio,
      context,
      hasScore: ids.length === 1 && collections.scoresFor(ids[0]).length > 0,
    });
  });

  // portfolio + setlists
  const piecesOrRefs = (ids) => (ids || []).map((id) => library.getPiece(id) || (collections.data.refs[id] && { id, ...collections.data.refs[id] })).filter(Boolean);
  handle('portfolio:add', (ids) => collections.portfolioAdd(piecesOrRefs(ids)));
  handle('portfolio:remove', (ids) => collections.portfolioRemove(ids));
  handle('setlist:create', ({ name, pieceIds } = {}) => {
    const s = collections.setlistCreate({ name });
    if (pieceIds?.length) collections.setlistAdd(s.id, piecesOrRefs(pieceIds));
    return s;
  });
  handle('setlist:update', (id, patch) => collections.setlistUpdate(id, patch));
  handle('setlist:delete', async (id) => {
    const s = collections.data.setlists.find((x) => x.id === id);
    if (!s) return false;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Delete the setlist “${s.name}”?`,
      detail: 'The pieces and their scores stay in your library.',
    });
    if (response !== 0) return false;
    collections.setlistDelete(id);
    return true;
  });
  handle('setlist:add', (id, ids, atIndex) => collections.setlistAdd(id, piecesOrRefs(ids), atIndex ?? null));
  handle('setlist:removeItems', (id, itemIds) => collections.setlistRemoveItems(id, itemIds));
  handle('setlist:reorder', (id, itemIds) => collections.setlistReorder(id, itemIds));

  // scores
  handle('score:attach', async (pieceId) => {
    const piece = library.getPiece(pieceId) || (collections.data.refs[pieceId] && { id: pieceId, ...collections.data.refs[pieceId] });
    if (!piece) return [];
    const imageExts = config.scores.imageExtensions;
    const res = await dialog.showOpenDialog(win, {
      title: `Attach Score to “${piece.title}”`,
      buttonLabel: 'Attach',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Scores (PDF, images, any file)', extensions: ['*'] },
        { name: 'PDF', extensions: config.scores.pdfExtensions },
        { name: 'Images', extensions: imageExts },
      ],
    });
    if (res.canceled || !res.filePaths.length) return [];
    return collections.importScores(piece, res.filePaths);
  });
  handle('score:attachFiles', async (pieceId, filePaths) => {
    const piece = library.getPiece(pieceId) || (collections.data.refs[pieceId] && { id: pieceId, ...collections.data.refs[pieceId] });
    const files = (filePaths || []).filter((f) => typeof f === 'string' && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!piece || !files.length) return [];
    return collections.importScores(piece, files);
  });
  handle('score:read', async (scoreId) => {
    const hit = collections.findScore(scoreId);
    if (!hit) return null;
    const data = await fs.promises.readFile(collections.scoreFilePath(hit.entry));
    return { entry: hit.entry, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  });
  handle('score:open', async (scoreId) => {
    const hit = collections.findScore(scoreId);
    if (!hit) return 'Score not found';
    return shell.openPath(collections.scoreFilePath(hit.entry));
  });
  handle('score:remove', async (scoreId) => {
    const hit = collections.findScore(scoreId);
    if (!hit) return false;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Remove', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Remove “${hit.entry.name}” from this piece?`,
      detail: 'This removes Oeuvre\'s copy of the score. The file you imported it from isn\'t affected.',
    });
    if (response !== 0) return false;
    await collections.removeScore(scoreId);
    return true;
  });
  handle('score:rename', (scoreId, name) => collections.renameScore(scoreId, name));
  handle('score:reorder', (pieceId, ids) => collections.reorderScores(pieceId, ids));

  // export
  handle('export:start', async ({ pieceIds, mode }) => {
    const pieces = piecesFor(pieceIds);
    if (!pieces.length) return { error: 'None of the selected pieces are available.' };
    let dest;
    const stamp = new Date().toISOString().slice(0, 10);
    if (mode === 'zip') {
      const res = await dialog.showSaveDialog(win, {
        title: 'Export Portfolio as ZIP',
        defaultPath: path.join(app.getPath('downloads'), `Oeuvre Portfolio ${stamp}.zip`),
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      dest = res.filePath.endsWith('.zip') ? res.filePath : `${res.filePath}.zip`;
    } else {
      const res = await dialog.showOpenDialog(win, {
        title: 'Export Portfolio as MP3 Files',
        message: 'Choose a folder for the MP3 files.',
        buttonLabel: 'Export Here',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: app.getPath('downloads'),
      });
      if (res.canceled || !res.filePaths.length) return { canceled: true };
      dest = res.filePaths[0];
    }
    exportAbort = new AbortController();
    send('export:progress', { phase: 'starting', index: 0, total: pieces.length, overall: 0, mode, dest });
    try {
      const result = await exportPieces({
        pieces, mode, dest,
        ffmpeg: ffmpegPath(),
        bitrate: config.export.mp3BitrateKbps,
        signal: exportAbort.signal,
        onProgress: (p) => send('export:progress', { ...p, mode, dest }),
      });
      return result;
    } catch (err) {
      return err.cancelled ? { canceled: true } : { error: String(err.message || err) };
    } finally {
      exportAbort = null;
    }
  });
  handle('export:cancel', () => exportAbort?.abort());
  handle('export:reveal', (p) => {
    if (typeof p === 'string' && fs.existsSync(p)) {
      if (fs.statSync(p).isDirectory()) shell.openPath(p);
      else shell.showItemInFolder(p);
    }
  });

  // updates
  handle('updates:status', () => updater.status);
  handle('updates:check', () => updater.check({ manual: true }));
  handle('updates:download', () => updater.download());
  handle('updates:install', () => updater.install());
  handle('updates:setToken', (token) => updater.setToken(token));
  handle('updates:clearToken', () => updater.clearToken());
  handle('updates:hasToken', () => updater.hasToken());
  handle('updates:skip', (version) => updater.skip(version));
}

// ---------------------------------------------------------------- lifecycle

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  library = new Library({ file: path.join(userData, 'library.json'), artDir: path.join(userData, 'Cache', 'artwork'), processArt });
  collections = new Collections({ file: path.join(userData, 'collections.json'), scoresDir: path.join(userData, 'scores') });
  updater = new Updater({
    state,
    workDir: path.join(userData, 'Updates'),
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    quit: () => app.quit(),
  });

  library.on('changed', (snap) => { send('library:changed', snap); rebuildMenu(); });
  library.on('relink', (map) => collections.relink(map));
  collections.on('changed', (snap) => send('collections:changed', snap));
  updater.on('status', (s) => send('updates:status', s));

  app.setAboutPanelOptions({
    applicationName: config.appName,
    applicationVersion: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} Freeman Edwards`,
  });

  handleSchemes({ library, collections, appRoot: path.join(__dirname, '..', 'renderer') });
  registerIpc();
  rebuildMenu();
  createWindow();

  library.start();
  updater.startAutomaticChecks();

  if (process.env.OEUVRE_E2E) {
    const driver = await import(process.env.OEUVRE_E2E_DRIVER || path.join(__dirname, '..', '..', 'test', 'e2e', 'driver.mjs'));
    driver.run({ app, win: () => win, library, collections, updater, state });
  }

  app.on('activate', () => {
    if (!win) createWindow();
    else win.show();
  });
});

app.on('window-all-closed', () => {
  // Like most Mac apps, Oeuvre keeps running with its window closed; quit from the menu.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  try {
    library?.close();
    collections?.close();
    state.flush();
  } catch (err) {
    console.error(err);
  }
});
