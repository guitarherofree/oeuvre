// Bridge between the window and the main process. Only these calls are exposed.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = new Set([
  'app:init', 'state:save', 'ui:confirm', 'shell:openExternal',
  'library:addSources', 'library:addPaths', 'library:removeSource', 'library:setVisible', 'library:setAllVisible', 'library:rescan',
  'piece:reveal', 'piece:contextMenu',
  'collection:add', 'collection:remove',
  'project:create', 'project:rename', 'project:add', 'project:remove', 'project:delete',
  'setlist:create', 'setlist:update', 'setlist:delete', 'setlist:add', 'setlist:removeItems', 'setlist:reorder',
  'score:attach', 'score:attachFiles', 'score:read', 'score:open', 'score:remove', 'score:rename', 'score:reorder',
  'export:start', 'export:cancel', 'export:reveal',
  'updates:status', 'updates:check', 'updates:download', 'updates:install', 'updates:setToken',
  'updates:clearToken', 'updates:hasToken', 'updates:skip',
]);
const EVENTS = new Set(['library:changed', 'collections:changed', 'export:progress', 'updates:status', 'menu:command']);

contextBridge.exposeInMainWorld('oeuvre', {
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, callback) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const listener = (_e, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  playerState(s) {
    ipcRenderer.send('menu:playerState', s);
  },
  pathForFile(file) {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
