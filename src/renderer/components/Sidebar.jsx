import { useEffect, useRef } from 'preact/hooks';
import { Briefcase, Plus, FolderOpen, ChevronDown, FolderPlus, RefreshCw, Minus, ListMusic, CircleAlert, AudioWaveform } from 'lucide-preact';
import {
  route, navigate, collections, library, sourcesMenuOpen, invoke, dragging, piecesById, libraryPieces,
} from '../lib/store.js';
import { player } from '../lib/player.js';
import { addToList, addToSetlist, promptNewSetlist, addSourceFolders, createProject, addToProject } from '../lib/actions.js';
import { fmtShowDate, plural, nextProjectName } from '../lib/format.js';
import { Logo, LogoMark, Mosaic, Checkbox } from './Common.jsx';

const DRAG_TYPE = 'application/x-oeuvre-pieces';

function dropProps(onDropIds) {
  return {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('is-drop-target');
    },
    onDragLeave: (e) => e.currentTarget.classList.remove('is-drop-target'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('is-drop-target');
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      const { ids } = JSON.parse(raw);
      if (ids?.length) onDropIds(ids);
    },
  };
}

function NavItem({ active, icon, label, sub, onClick, drop, playing }) {
  return (
    <button type="button" class={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick} {...(drop ? dropProps(drop) : {})}>
      <span class="nav-icon">{icon}</span>
      <span class="nav-text">
        <span class={`nav-label ${playing ? 'is-playing' : ''}`}>{label}</span>
        {sub ? <span class="nav-sub">{sub}</span> : null}
      </span>
    </button>
  );
}

export function SourcesMenu() {
  const ref = useRef(null);
  const sources = library.value.sources;
  const visibleCount = sources.filter((s) => s.visible).length;

  useEffect(() => {
    if (!sourcesMenuOpen.value) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) sourcesMenuOpen.value = false;
    };
    const esc = (e) => { if (e.key === 'Escape') sourcesMenuOpen.value = false; };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [sourcesMenuOpen.value]);

  return (
    <div class="sources" ref={ref}>
      <button
        type="button"
        class={`sources-button ${sourcesMenuOpen.value ? 'is-open' : ''}`}
        onClick={() => { sourcesMenuOpen.value = !sourcesMenuOpen.value; }}
        aria-haspopup="menu"
        aria-expanded={sourcesMenuOpen.value}
      >
        <FolderOpen size={18} />
        <span class="sources-label">Sources</span>
        <span class="sources-count">{sources.length ? `${visibleCount} of ${sources.length}` : 'None'}</span>
        <ChevronDown size={16} class="sources-chevron" />
      </button>
      {sourcesMenuOpen.value ? (
        <div class="menu sources-menu" role="menu">
          <div class="menu-heading">Show pieces from</div>
          {sources.length === 0 ? <div class="menu-empty">No source folders yet.</div> : null}
          {sources.map((s) => (
            <div class="source-row" role="menuitemcheckbox" aria-checked={s.visible} key={s.id} title={s.path}
              onClick={() => invoke('library:setVisible', s.id, !s.visible)}>
              <Checkbox checked={s.visible} label={`Show ${s.name}`} onChange={(v) => invoke('library:setVisible', s.id, v)} />
              <div class="source-text">
                <div class="source-name">
                  {s.name}
                  {s.missing ? <span class="badge badge-warn"><CircleAlert size={11} /> Not found</span> : null}
                  {s.scanning ? <RefreshCw size={12} class="spin source-spin" /> : null}
                </div>
                <div class="source-path">{`\u200E${s.path.replace(/^\/Users\/[^/]+/, '~')}\u200E`}</div>
              </div>
              <span class="source-count">{s.count}</span>
              <button type="button" class="source-remove" title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`}
                onClick={(e) => { e.stopPropagation(); invoke('library:removeSource', s.id); }}>
                <Minus size={14} />
              </button>
            </div>
          ))}
          <div class="menu-sep" />
          <button type="button" class="menu-item" onClick={() => { sourcesMenuOpen.value = false; addSourceFolders(); }}>
            <FolderPlus size={16} /> Add Folder…
          </button>
          {sources.some((s) => !s.visible) ? (
            <button type="button" class="menu-item" onClick={() => invoke('library:setAllVisible', true)}>
              <span class="menu-item-pad" /> Show All
            </button>
          ) : null}
          <button type="button" class="menu-item" disabled={!sources.length} onClick={() => invoke('library:rescan')}>
            <RefreshCw size={16} /> Rescan Folders
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectsSection({ r, col, playingIn }) {
  const projects = col.projects || [];
  const next = nextProjectName(projects);
  return (
    <section class="library-section">
      <div class="setlists-head">
        <span class="setlists-title"><AudioWaveform size={18} /> Projects</span>
        <button type="button" class="icon-btn round-btn" title={`Add Project (⇧⌘N): creates ${next}`} aria-label="Add Project" onClick={() => createProject()}>
          <Plus size={16} />
        </button>
      </div>
      <div class="setlists-list">
        <button type="button" class="setlist-item add-project" onClick={() => createProject()} title="Drop pieces here to start a project with them"
          {...dropProps((ids) => createProject(ids))}>
          <span class="add-tile"><Plus size={20} /></span>
          <span class="nav-text">
            <span class="nav-label">Add Project</span>
            <span class="nav-sub">Next: {next}</span>
          </span>
        </button>
        {projects.map((p) => {
          const pieces = p.items.slice(0, 4).map((it) => piecesById.value.get(it.pieceId)).filter(Boolean);
          return (
            <button
              type="button"
              key={p.id}
              class={`setlist-item ${r.view === 'project' && r.id === p.id ? 'is-active' : ''}`}
              onClick={() => navigate({ view: 'project', id: p.id })}
              {...dropProps((ids) => addToProject(p.id, ids))}
            >
              <Mosaic pieces={pieces} size={44} glyph={pieces.length < 4 ? <AudioWaveform size={20} /> : null} />
              <span class="nav-text">
                <span class={`nav-label ${playingIn('project', p.id) ? 'is-playing' : ''}`}>{p.name}</span>
                <span class="nav-sub">{plural(p.items.length, 'piece')} · WAV</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Sidebar() {
  const r = route.value;
  const col = collections.value;
  const ctx = player.context.value;
  const playingIn = (type, id) => player.current.value && ctx?.type === type && (id === undefined || ctx.id === id);

  return (
    <aside class="sidebar">
      <div class="panel nav-panel">
        <div class="drag-region sidebar-top">
          <Logo />
        </div>
        <NavItem
          active={r.view === 'oeuvre'}
          icon={<LogoMark size={22} />}
          label="Oeuvre"
          sub={plural(libraryPieces.value.length, 'piece')}
          playing={playingIn('oeuvre')}
          onClick={() => navigate({ view: 'oeuvre' })}
        />
        <NavItem
          active={r.view === 'portfolio'}
          icon={<span class="nav-glyph"><Briefcase size={15} /></span>}
          label="Portfolio"
          sub={plural(col.portfolio.length, 'work sample')}
          playing={playingIn('portfolio')}
          onClick={() => navigate({ view: 'portfolio' })}
          drop={(ids) => addToList('portfolio', ids)}
        />
        <SourcesMenu />
      </div>

      <div class="panel setlists-panel">
        <div class="library-scroll">
          <ProjectsSection r={r} col={col} playingIn={playingIn} />

          <section class="library-section">
            <div class="setlists-head">
              <span class="setlists-title"><ListMusic size={18} /> Setlists</span>
              <button type="button" class="icon-btn round-btn" title="New Setlist (⌘N)" aria-label="New Setlist" onClick={() => promptNewSetlist()}>
                <Plus size={16} />
              </button>
            </div>
            <div class="setlists-list" {...dropProps((ids) => promptNewSetlist(ids))}>
              {col.setlists.length === 0 ? (
                <div class="setlists-empty">
                  <p>Build a setlist for your next show.</p>
                  <button type="button" class="pill-btn" onClick={() => promptNewSetlist()}>New Setlist</button>
                </div>
              ) : null}
              {col.setlists.map((s) => {
                const pieces = s.items.slice(0, 4).map((it) => piecesById.value.get(it.pieceId)).filter(Boolean);
                const sub = [fmtShowDate(s.date), s.venue].filter(Boolean).join(' · ') || plural(s.items.length, 'piece');
                return (
                  <button
                    type="button"
                    key={s.id}
                    class={`setlist-item ${r.view === 'setlist' && r.id === s.id ? 'is-active' : ''}`}
                    onClick={() => navigate({ view: 'setlist', id: s.id })}
                    {...dropProps((ids) => addToSetlist(s.id, ids))}
                    onDrop={(e) => {
                      e.stopPropagation();
                      e.currentTarget.classList.remove('is-drop-target');
                      const raw = e.dataTransfer.getData(DRAG_TYPE);
                      if (!raw) return;
                      e.preventDefault();
                      addToSetlist(s.id, JSON.parse(raw).ids);
                    }}
                  >
                    <Mosaic pieces={pieces} size={44} />
                    <span class="nav-text">
                      <span class={`nav-label ${playingIn('setlist', s.id) ? 'is-playing' : ''}`}>{s.name}</span>
                      <span class="nav-sub">{sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}

export { DRAG_TYPE, dragging };
