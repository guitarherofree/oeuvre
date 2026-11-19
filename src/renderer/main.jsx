import { render } from 'preact';
import { ChevronLeft, ChevronRight, CircleArrowUp } from 'lucide-preact';
import {
  api, invoke, ready, appInfo, library, collections, route, queueOpen, updateStatus, exportState, modal,
  navigate, goBack, goForward, canGoBack, canGoForward, setlistsById, sourcesMenuOpen, toast, scoresFor,
  listDescending, LISTS,
} from './lib/store.js';
import {
  player, restore, togglePlay, next, previous, setVolume, toggleShuffle, setRepeat, cycleRepeat, pruneMissing,
} from './lib/player.js';
import { promptNewSetlist, playCurrentPage, openScore, checkForUpdates, exportPieces } from './lib/actions.js';
import { Sidebar } from './components/Sidebar.jsx';
import { OeuvreView, ListView, SetlistView } from './components/Views.jsx';
import { ScoreView } from './components/ScoreView.jsx';
import { PlayerBar, QueuePanel } from './components/PlayerBar.jsx';
import { Modals, Toasts } from './components/Modals.jsx';
import { IconButton } from './components/Common.jsx';

function TopBar() {
  const st = updateStatus.value;
  return (
    <div class="top-bar drag-region">
      <div class="nav-arrows no-drag">
        <IconButton icon={ChevronLeft} label="Back" onClick={goBack} disabled={!canGoBack.value} class="round-btn dark" size={20} />
        <IconButton icon={ChevronRight} label="Forward" onClick={goForward} disabled={!canGoForward.value} class="round-btn dark" size={20} />
      </div>
      <div class="top-spacer" />
      {st?.state === 'available' && modal.value?.type !== 'update' ? (
        <button type="button" class="update-pill no-drag" onClick={() => { modal.value = { type: 'update' }; }}>
          <CircleArrowUp size={16} /> Update to {st.latest?.version}
        </button>
      ) : null}
    </div>
  );
}

function onMainScroll(e) {
  e.currentTarget.parentElement.classList.toggle('is-scrolled', e.currentTarget.scrollTop > 40);
}

function Main() {
  const r = route.value;
  if (r.view === 'score') return <ScoreView r={r} />;
  return (
    <>
      <TopBar />
      <div class="main-scroll" onScroll={onMainScroll}>
        {LISTS[r.view] ? <ListView name={r.view} key={r.view} />
          : r.view === 'setlist' ? <SetlistView id={r.id} key={r.id} />
            : <OeuvreView />}
      </div>
    </>
  );
}

function App() {
  if (!ready.value) return <div class="boot" />;
  return (
    <div class={`app ${queueOpen.value ? 'with-queue' : ''}`}>
      <Sidebar />
      <main class={`panel main ${route.value.view === 'score' ? 'is-score' : ''}`}>
        <Main />
      </main>
      {queueOpen.value ? <QueuePanel /> : null}
      <PlayerBar />
      <Modals />
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------- menu commands & shortcuts

function runCommand(cmd, arg) {
  switch (cmd) {
    case 'togglePlay': if (!togglePlay()) playCurrentPage(); break;
    case 'next': next(); break;
    case 'previous': previous(); break;
    case 'volumeUp': setVolume(player.volume.value + 0.1); break;
    case 'volumeDown': setVolume(player.volume.value - 0.1); break;
    case 'toggleShuffle': toggleShuffle(); break;
    case 'setRepeat': setRepeat(arg); break;
    case 'cycleRepeat': cycleRepeat(); break;
    case 'navigate': navigate(arg); break;
    case 'newSetlist': promptNewSetlist(); break;
    case 'toggleQueue': queueOpen.value = !queueOpen.value; break;
    case 'checkUpdates': checkForUpdates(); break;
    case 'focusSearch': {
      if (route.value.view === 'score') navigate(route.value.from || { view: 'oeuvre' });
      setTimeout(() => {
        const btn = document.querySelector('.filter-box .icon-btn');
        const input = document.querySelector('.filter-box input');
        if (input && getComputedStyle(input).width === '0px') btn?.click();
        input?.focus();
        input?.select();
      }, 30);
      break;
    }
    case 'showCurrentScore': {
      const id = player.current.value;
      if (!id) { toast('Nothing is playing.'); break; }
      if (scoresFor(id).length) openScore(id);
      else toast('No score attached to this piece.', { action: 'Attach…', onAction: () => openScore(id) });
      break;
    }
    case 'exportCollection': {
      navigate({ view: arg.name });
      const ids = collections.value[arg.name].map((e) => e.pieceId);
      if (!ids.length) toast(`Your ${LISTS[arg.name].label} is empty.`);
      else exportPieces(ids, arg.mode, arg.name);
      break;
    }
    default:
  }
}

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !isTyping(e.target) && !e.metaKey && !modal.value) {
    e.preventDefault();
    runCommand('togglePlay');
  } else if (e.key === 'Escape' && !modal.value) {
    if (sourcesMenuOpen.value) sourcesMenuOpen.value = false;
    else if (queueOpen.value && route.value.view !== 'score') queueOpen.value = false;
  } else if (e.metaKey && e.key === '[') {
    goBack();
  } else if (e.metaKey && e.key === ']') {
    goForward();
  }
});

// Mouse back/forward buttons and trackpad swipes.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) goBack();
  if (e.button === 4) goForward();
});

// Folders dragged in from Finder become sources (score files are handled by the score view).
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  if (route.value.view === 'score') return;
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  const res = await invoke('library:addPaths', paths);
  if (res?.added?.length) toast(`Added ${res.added.map((s) => `“${s.name}”`).join(', ')} to Sources`);
  else if (res?.notFolders) toast('Drop folders here to add them as sources. To attach a score, open the piece\'s score view first.');
});

// ---------------------------------------------------------------- boot

async function boot() {
  const init = await invoke('app:init');
  appInfo.value = { version: init.version, platform: init.platform, isPackaged: init.isPackaged };
  library.value = init.library;
  collections.value = init.collections;
  updateStatus.value = init.updateStatus;
  if (init.ui?.route) {
    const r = init.ui.route;
    if (r.view !== 'setlist' || init.collections.setlists.some((s) => s.id === r.id)) route.value = r;
  }
  queueOpen.value = !!init.ui?.queueOpen;
  const savedOrder = { ...(init.ui?.listDescending || {}) };
  if (typeof init.ui?.portfolioDescending === 'boolean') savedOrder.portfolio ??= init.ui.portfolioDescending; // 1.1.0
  for (const name of Object.keys(LISTS)) if (typeof savedOrder[name] === 'boolean') listDescending.value = { ...listDescending.value, [name]: savedOrder[name] };
  restore(init.player);
  document.documentElement.dataset.platform = init.platform;

  api.on('library:changed', (snap) => { library.value = snap; pruneMissing(); });
  api.on('collections:changed', (snap) => { collections.value = snap; });
  api.on('export:progress', (p) => {
    if (exportState.value?.phase === 'finished') return;
    exportState.value = { ...(exportState.value || {}), ...p };
  });
  api.on('updates:status', (s) => {
    updateStatus.value = s;
    if (s.manual && !modal.value) modal.value = { type: 'update' };
    else if (s.state === 'available' && !s.manual && !modal.value) modal.value = { type: 'update' };
  });
  api.on('menu:command', runCommand);
  ready.value = true;
}

render(<App />, document.getElementById('app'));
boot();

export { setlistsById };
