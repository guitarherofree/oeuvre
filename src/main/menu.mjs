// macOS menu bar, including the Sources menu with a check mark per folder.
import { app, Menu, shell } from 'electron';
import config from '../config.mjs';

export function buildAppMenu({ library, player = {}, send, actions }) {
  const sources = library.sources;
  const sep = { type: 'separator' };
  const cmd = (name, arg) => () => send(name, arg);

  const sourceItems = sources.length
    ? sources.map((s) => ({
        label: s.missing ? `${s.name}  (not found)` : s.name,
        type: 'checkbox',
        checked: !!s.visible,
        toolTip: s.path,
        click: (item) => actions.setVisible(s.id, item.checked),
      }))
    : [{ label: 'No Source Folders', enabled: false }];

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `About ${app.name}` },
        { label: 'Check for Updates…', click: cmd('checkUpdates') },
        sep,
        { role: 'services' },
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Source Folder…', accelerator: 'CmdOrCtrl+O', click: () => actions.addSources() },
        { label: 'New Setlist', accelerator: 'CmdOrCtrl+N', click: cmd('newSetlist') },
        { label: 'Add Project', accelerator: 'Shift+CmdOrCtrl+N', click: cmd('newProject') },
        sep,
        { label: 'Export Portfolio as ZIP…', click: cmd('exportCollection', { name: 'portfolio', mode: 'zip' }) },
        { label: 'Export Portfolio as MP3 Files…', click: cmd('exportCollection', { name: 'portfolio', mode: 'folder' }) },
        { label: 'Export Current Project as ZIP…', click: cmd('exportCollection', { name: 'project', mode: 'zip' }) },
        { label: 'Export Current Project as WAV Files…', click: cmd('exportCollection', { name: 'project', mode: 'folder' }) },
        sep,
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Sources',
      submenu: [
        ...sourceItems,
        sep,
        { label: 'Show All Sources', enabled: sources.some((s) => !s.visible), click: () => actions.setAllVisible(true) },
        { label: 'Add Source Folder…', click: () => actions.addSources() },
        {
          label: 'Remove Source',
          enabled: sources.length > 0,
          submenu: sources.length ? sources.map((s) => ({ label: `${s.name}…`, click: () => actions.removeSource(s.id) })) : [{ label: 'None', enabled: false }],
        },
        sep,
        { label: 'Rescan Folders', click: () => actions.rescan() },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        { label: player.playing ? 'Pause' : 'Play', click: cmd('togglePlay') },
        { label: 'Next', accelerator: 'CmdOrCtrl+Right', click: cmd('next') },
        { label: 'Previous', accelerator: 'CmdOrCtrl+Left', click: cmd('previous') },
        sep,
        { label: 'Volume Up', accelerator: 'CmdOrCtrl+Up', click: cmd('volumeUp') },
        { label: 'Volume Down', accelerator: 'CmdOrCtrl+Down', click: cmd('volumeDown') },
        sep,
        { label: 'Shuffle', type: 'checkbox', checked: !!player.shuffle, accelerator: 'CmdOrCtrl+S', click: cmd('toggleShuffle') },
        {
          label: 'Repeat',
          submenu: [
            { label: 'Off', type: 'radio', checked: !player.repeat || player.repeat === 'off', click: cmd('setRepeat', 'off') },
            { label: 'All', type: 'radio', checked: player.repeat === 'all', click: cmd('setRepeat', 'all') },
            { label: 'One', type: 'radio', checked: player.repeat === 'one', click: cmd('setRepeat', 'one') },
          ],
        },
        { label: 'Cycle Repeat Mode', accelerator: 'CmdOrCtrl+R', click: cmd('cycleRepeat') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Oeuvre', accelerator: 'CmdOrCtrl+1', click: cmd('navigate', { view: 'oeuvre' }) },
        { label: 'Portfolio', accelerator: 'CmdOrCtrl+2', click: cmd('navigate', { view: 'portfolio' }) },
        sep,
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: cmd('focusSearch') },
        { label: 'Show Queue', accelerator: 'Alt+CmdOrCtrl+Q', click: cmd('toggleQueue') },
        { label: 'Show Score for Current Piece', accelerator: 'Alt+CmdOrCtrl+S', click: cmd('showCurrentScore') },
        sep,
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [sep, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Oeuvre Releases on GitHub', click: () => shell.openExternal(`https://github.com/${config.updates.owner}/${config.updates.repo}/releases`) },
        { label: 'Show Oeuvre Data in Finder', click: () => shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: player.playing ? 'Pause' : 'Play', click: cmd('togglePlay') },
      { label: 'Next', click: cmd('next') },
      { label: 'Previous', click: cmd('previous') },
    ]));
  }
}

/** Native right-click menu for one or more pieces. Resolves with the chosen action (or null). */
export function pieceContextMenu(win, { pieces, setlists, projects = [], inLists = {}, context, hasScore }) {
  return new Promise((resolve) => {
    const pick = (action, arg) => () => resolve({ action, arg });
    const many = pieces.length > 1;
    const items = [
      { label: many ? `Play ${pieces.length} Pieces` : 'Play', click: pick('play') },
      { label: 'Play Next', click: pick('playNext') },
      { label: 'Add to Queue', click: pick('addToQueue') },
      { type: 'separator' },
      inLists.portfolio
        ? { label: 'Remove from Portfolio', click: pick('listRemove', 'portfolio') }
        : { label: 'Add to Portfolio', click: pick('listAdd', 'portfolio') },
      {
        label: 'Add to Project',
        submenu: [
          { label: 'New Project', click: pick('projectNew') },
          ...(projects.length ? [{ type: 'separator' }] : []),
          // A check mark means every selected piece is already in that project; choosing it removes them.
          ...projects.map((p) => ({ label: p.name, type: 'checkbox', checked: p.hasAll, click: pick('projectToggle', { id: p.id, hasAll: p.hasAll }) })),
        ],
      },
      {
        label: 'Add to Setlist',
        submenu: [
          { label: 'New Setlist…', click: pick('setlistNew') },
          ...(setlists.length ? [{ type: 'separator' }] : []),
          ...setlists.map((s) => ({ label: s.name, click: pick('setlistAdd', s.id) })),
        ],
      },
    ];
    if (context?.type === 'project' && context.id) {
      items.push({ label: 'Remove from This Project', click: pick('projectRemove', context.id) });
    }
    if (context?.type === 'setlist') {
      items.push({ label: many ? 'Remove from This Setlist' : 'Remove from This Setlist', click: pick('setlistRemove') });
    }
    if (!many) {
      items.push(
        { type: 'separator' },
        { label: hasScore ? 'Open Score' : 'Attach Score…', click: pick(hasScore ? 'openScore' : 'attachScore') },
      );
      if (hasScore) items.push({ label: 'Attach Another Score…', click: pick('attachScore') });
      items.push({ type: 'separator' }, { label: 'Show in Finder', click: pick('reveal') });
    }
    // Depending on platform the click can arrive just after the close callback.
    Menu.buildFromTemplate(items).popup({ window: win, callback: () => setTimeout(() => resolve(null), 150) });
  });
}
