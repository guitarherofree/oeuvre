import { useState, useRef, useEffect, useLayoutEffect } from 'preact/hooks';
import { Play, Pause, Shuffle, Search, X, Briefcase, Download, Archive, Plus, Trash2, FolderPlus, CalendarDays, MapPin, ListMusic, EyeOff, ArrowDownUp, AudioWaveform, ImagePlus } from 'lucide-preact';
import {
  library, libraryPieces, filters, setFilter, collections, setlistsById, pieceOrRef, invoke,
  filterPieces, modal, route, navigate, selection, listDescending, saveUi, LISTS, projectsById, isDescending, api, toast,
} from '../lib/store.js';
import config from '../../config.mjs';
import { player, playContext, togglePlay } from '../lib/player.js';
import { sortByTitle, fmtTotal, fmtShowDate, plural } from '../lib/format.js';
import { addSourceFolders, addToSetlist, addToList, exportPieces, removeFromList, addToProject, removeFromProject } from '../lib/actions.js';
import { TrackList } from './TrackList.jsx';
import { LogoMark, Mosaic, Artwork } from './Common.jsx';

// ---------------------------------------------------------------- shared pieces

function Header({ kind, title, meta, art, children, titleEditor }) {
  return (
    <header class="view-header">
      <div class="view-header-art">{art}</div>
      <div class="view-header-text">
        <div class="view-kind">{kind}</div>
        {titleEditor || <h1 class={`view-title ${title.length > 22 ? 'is-long' : ''}`}>{title}</h1>}
        <div class="view-meta">{meta}</div>
        {children}
      </div>
    </header>
  );
}

function PlayButton({ isThis, onPlay, disabled, label = 'Play' }) {
  const showPause = isThis && player.playing.value;
  return (
    <button
      type="button"
      class="big-play"
      disabled={disabled}
      aria-label={showPause ? 'Pause' : label}
      title={showPause ? 'Pause' : label}
      onClick={() => (isThis && player.current.value ? togglePlay() : onPlay())}
    >
      {showPause ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
    </button>
  );
}

function FilterBox({ fkey, placeholder }) {
  const value = filters.value[fkey] || '';
  const [open, setOpen] = useState(!!value);
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  return (
    <div class={`filter-box ${open || value ? 'is-open' : ''}`}>
      <button type="button" class="icon-btn" aria-label="Search" title="Search (⌘F)" onClick={() => setOpen(true)}>
        <Search size={18} />
      </button>
      <input
        ref={ref}
        data-search={fkey}
        type="search"
        value={value}
        placeholder={placeholder}
        spellcheck={false}
        onInput={(e) => setFilter(fkey, e.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setFilter(fkey, ''); e.currentTarget.blur(); setOpen(false); }
          if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector('.tracklist')?.focus(); }
        }}
      />
      {value ? (
        <button type="button" class="icon-btn filter-clear" aria-label="Clear search" onClick={() => { setFilter(fkey, ''); ref.current?.focus(); }}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function Empty({ icon, title, body, children }) {
  return (
    <div class="empty">
      {icon ? <div class="empty-icon">{icon}</div> : null}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}

const totalDuration = (pieces) => pieces.reduce((t, p) => t + (p.duration || 0), 0);
const isContext = (type, id) => player.context.value?.type === type && (id === undefined || player.context.value?.id === id);

// ---------------------------------------------------------------- Oeuvre

export function OeuvreView() {
  const { sources } = library.value;
  const q = filters.value.oeuvre || '';
  const all = libraryPieces.value;
  const list = filterPieces(all, q);
  const hidden = sources.filter((s) => !s.visible).length;
  const shownSources = sources.filter((s) => s.visible && !s.missing).length;
  const scanning = sources.some((s) => s.scanning);

  if (!sources.length) {
    return (
      <div class="view">
        <div class="welcome">
          <LogoMark size={88} />
          <h1>Welcome to Oeuvre</h1>
          <p>Add the folders on your Mac where your music lives. Oeuvre plays MP3, AAC/M4A, WAV and FLAC files and never moves or changes them.</p>
          <button type="button" class="primary-btn" onClick={addSourceFolders}><FolderPlus size={18} /> Add Folder…</button>
          <p class="hint">You can also drag folders from Finder into this window.</p>
        </div>
      </div>
    );
  }

  const rows = list.map((p) => ({ key: p.id, piece: p }));
  const ctx = { type: 'oeuvre', name: 'Oeuvre' };
  const play = (i) => playContext({ ...ctx, ids: list.map((p) => p.id) }, i);

  return (
    <div class="view">
      <Header
        kind="Library"
        title="Oeuvre"
        art={<div class="mosaic mosaic-glyph mosaic-oeuvre"><LogoMark size={128} /></div>}
        meta={
          <>
            <span>{plural(all.length, 'piece')}</span>
            <span>{fmtTotal(totalDuration(all))}</span>
            <span>{plural(shownSources, 'folder')}{hidden ? ` (${hidden} hidden)` : ''}</span>
            {scanning ? <span class="scanning">Scanning…</span> : null}
          </>
        }
      />
      <div class="action-row">
        <PlayButton isThis={isContext('oeuvre')} disabled={!list.length} onPlay={() => play(0)} />
        <button type="button" class="icon-btn action-icon" title="Shuffle play" aria-label="Shuffle play" disabled={!list.length}
          onClick={() => playContext({ ...ctx, ids: list.map((p) => p.id) }, 0, { shuffleStart: true })}>
          <Shuffle size={26} />
        </button>
        <div class="action-spacer" />
        <FilterBox fkey="oeuvre" placeholder="Search your oeuvre" />
      </div>
      <TrackList
        rows={rows}
        columns={['index', 'title', 'folder', 'format', 'modified', 'duration']}
        sort={{ column: 'title', descending: config.library.sortDescending, hint: config.library.sortDescending ? 'Sorted by name, newest first (2026 before 2014)' : 'Sorted by name' }}
        selectKey="oeuvre"
        context={ctx}
        onPlayRow={play}
        emptyState={
          q ? <Empty title={`No pieces match “${q}”`} body="Check the spelling, or search by folder or format." />
            : hidden && !shownSources ? (
              <Empty icon={<EyeOff size={28} />} title="All source folders are hidden" body="Check a folder in Sources to show its pieces.">
                <button type="button" class="pill-btn" onClick={() => invoke('library:setAllVisible', true)}>Show All Folders</button>
              </Empty>
            ) : scanning ? <Empty title="Scanning your folders…" />
              : <Empty title="No audio files found" body="Oeuvre looks for MP3, M4A, AAC, WAV and FLAC files in your source folders." />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- Portfolio and projects

/** The square at the top of a collection: click to choose artwork, or drop an image on it. */
function CollectionArt({ project, pieces }) {
  const [over, setOver] = useState(false);
  const report = (r) => { if (r?.error) toast(r.error); };
  const choose = async () => report(await invoke('project:chooseArtwork', project.id));
  const onDrop = async (e) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    report(await invoke('project:setArtworkFile', project.id, api.pathForFile(file)));
  };
  return (
    <div
      class={`art-editor ${over ? 'is-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button type="button" class="art-editor-button" onClick={choose} title="Choose artwork, or drop an image here">
        {project.artKey
          ? <Artwork piece={{ id: project.id, title: project.name, artKey: project.artKey }} size={200} radius={6} class="mosaic" />
          : <Mosaic pieces={pieces} size={200} glyph={pieces.length < 4 ? <AudioWaveform size={84} strokeWidth={1.5} /> : null} />}
        <span class="art-editor-overlay">
          <ImagePlus size={40} strokeWidth={1.5} />
          <span>{project.artKey ? 'Change artwork' : 'Choose artwork'}</span>
        </span>
      </button>
      {project.artKey ? (
        <button type="button" class="art-editor-remove" title="Remove artwork" aria-label="Remove artwork"
          onClick={() => invoke('project:removeArtwork', project.id)}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

/** A multi-line field that grows with its text and saves as you type. */
function NotesField({ label, value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value || '');
  const ref = useRef(null);
  const timer = useRef(null);
  useEffect(() => { if (document.activeElement !== ref.current) setDraft(value || ''); }, [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = (v) => {
    clearTimeout(timer.current);
    if (v !== (value || '')) onSave(v);
  };
  return (
    <label class="notes-field">
      <span class="notes-label">{label}</span>
      <textarea
        ref={ref}
        rows={3}
        value={draft}
        placeholder={placeholder}
        spellcheck
        onInput={(e) => {
          const v = e.currentTarget.value;
          setDraft(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onSave(v), 700);
        }}
        onBlur={(e) => save(e.currentTarget.value)}
      />
    </label>
  );
}

function CollectionNotes({ project }) {
  const update = (patch) => invoke('project:update', project.id, patch);
  return (
    <section class="collection-notes">
      <h2>About this collection</h2>
      <NotesField label="Description" value={project.description} placeholder="What this collection is, where it's going, anything worth remembering."
        onSave={(description) => update({ description })} />
      <NotesField label="Credits" value={project.credits} placeholder={'Composition, performance, recording, mixing, mastering, artwork…\ne.g. Recorded by …, Mastered by …'}
        onSave={(credits) => update({ credits })} />
    </section>
  );
}

/**
 * Portfolio (one list, exports MP3) and projects (many lists, export WAV) share this page.
 *   <ListView name="portfolio" />   or   <ListView name="project" id={projectId} />
 */
export function ListView({ name, id }) {
  const isProject = name === 'project';
  const project = isProject ? projectsById.value.get(id) : null;
  const [checked, setChecked] = useState(() => new Set());

  if (isProject && !project) {
    return (
      <div class="view">
        <Empty title="This project no longer exists">
          <button type="button" class="pill-btn" onClick={() => navigate({ view: 'oeuvre' }, { replace: true })}>Go to Oeuvre</button>
        </Empty>
      </div>
    );
  }

  const label = isProject ? project.name : LISTS.portfolio.label;
  const format = isProject ? 'wav' : LISTS.portfolio.format;
  const FORMAT = format.toUpperCase();
  const key = isProject ? project.id : 'portfolio';
  const viewKey = isProject ? `project:${project.id}` : 'portfolio';
  const entries = isProject ? project.items : collections.value.portfolio;
  const add = (ids) => (isProject ? addToProject(project.id, ids) : addToList('portfolio', ids));
  const remove = (ids) => (isProject ? removeFromProject(project.id, ids) : removeFromList('portfolio', ids));

  const descending = isDescending(key);
  const pieces = sortByTitle(entries.map((e) => pieceOrRef(e.pieceId)), descending);
  const flip = () => { listDescending.value = { ...listDescending.value, [key]: !descending }; saveUi(); };
  const q = filters.value[viewKey] || '';
  const list = filterPieces(pieces, q);
  const valid = new Set(pieces.map((p) => p.id));
  const exportable = [...checked].filter((pid) => valid.has(pid) && !pieceOrRef(pid).missing);
  const toConvert = exportable.filter((pid) => pieceOrRef(pid).ext !== format).length;

  const onCheck = (ids, on) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const pid of ids) on ? next.add(pid) : next.delete(pid);
      return next;
    });
  };

  const ctx = isProject ? { type: 'project', id: project.id, name: project.name } : { type: 'portfolio', name: 'Portfolio' };
  const playable = list.filter((p) => !p.missing);
  const play = (i) => {
    const target = list[i];
    playContext({ ...ctx, ids: playable.map((p) => p.id) }, Math.max(0, playable.indexOf(target)));
  };
  const convertNote = toConvert ? `${plural(toConvert, 'piece')} will be converted to ${FORMAT}` : `All selected pieces are already ${FORMAT}`;
  const target = { label, format };
  const glyph = isProject ? <AudioWaveform size={84} strokeWidth={1.5} /> : <Briefcase size={84} strokeWidth={1.5} />;

  return (
    <div class="view">
      <Header
        kind={isProject ? 'Project' : 'Collection'}
        title={label}
        titleEditor={isProject ? <EditableTitle value={project.name} onSave={(n) => invoke('project:rename', project.id, n)} /> : null}
        art={isProject ? <CollectionArt project={project} pieces={pieces} /> : <Mosaic pieces={pieces} size={200} glyph={pieces.length < 4 ? glyph : null} />}
        meta={
          <>
            <span>{plural(pieces.length, isProject ? 'piece' : LISTS.portfolio.noun)}</span>
            <span>{fmtTotal(totalDuration(pieces))}</span>
            <span>Exports {FORMAT}</span>
          </>
        }
      />
      <div class="action-row">
        <PlayButton isThis={isContext(ctx.type, isProject ? project.id : undefined)} disabled={!playable.length} onPlay={() => play(0)} />
        <div class="export-group">
          <button type="button" class="pill-btn" disabled={!exportable.length} onClick={() => exportPieces(exportable, 'folder', target)}
            title={toConvert ? convertNote : `Copy the ${FORMAT} files to a folder`}>
            <Download size={16} /> Export {exportable.length ? exportable.length : ''} as {FORMAT}s…
          </button>
          <button type="button" class="pill-btn" disabled={!exportable.length} onClick={() => exportPieces(exportable, 'zip', target)}
            title={toConvert ? convertNote : `One ZIP of ${FORMAT} files`}>
            <Archive size={16} /> Export as ZIP…
          </button>
          <span class="export-hint">
            {exportable.length ? convertNote : pieces.length ? 'Check pieces to export them' : ''}
          </span>
        </div>
        {isProject ? (
          <button type="button" class="icon-btn action-icon" title="Delete project" aria-label="Delete project"
            onClick={async () => { if (await invoke('project:delete', project.id)) navigate({ view: 'oeuvre' }, { replace: true }); }}>
            <Trash2 size={20} />
          </button>
        ) : null}
        <div class="action-spacer" />
        <button type="button" class="sort-toggle" onClick={flip} disabled={pieces.length < 2}
          title={descending ? 'Showing newest first. Click to show oldest first.' : 'Showing oldest first. Click to show newest first.'}>
          <span>{descending ? 'Newest first' : 'Oldest first'}</span>
          <ArrowDownUp size={16} />
        </button>
        <FilterBox fkey={viewKey} placeholder={`Search ${label}`} />
      </div>
      <TrackList
        rows={list.map((p) => ({ key: p.id, piece: p }))}
        columns={['check', 'index', 'title', 'folder', 'format', 'duration', 'remove']}
        sort={{ column: 'title', descending, onFlip: flip, hint: descending ? 'Newest first. Click to flip.' : 'Oldest first. Click to flip.' }}
        selectKey={viewKey}
        context={ctx}
        onPlayRow={play}
        checked={checked}
        onCheck={onCheck}
        onRemoveRows={(rows) => remove(rows.map((r) => r.piece.id))}
        onDropPieces={(ids) => add(ids)}
        emptyState={
          q ? <Empty title={`Nothing in ${label} matches “${q}”`} />
            : isProject ? (
              <Empty icon={<AudioWaveform size={28} />} title={`${label} is empty`}
                body="Drag pieces here or onto this project in the sidebar, or right-click a piece and choose Add to Project. Check pieces to export them as WAV files." />
            ) : (
              <Empty icon={<Briefcase size={28} />} title="Your Portfolio is empty"
                body="Collect your best work samples here. Right-click a piece and choose Add to Portfolio, or drag pieces onto Portfolio in the sidebar." />
            )
        }
      />
      {isProject ? <CollectionNotes key={project.id} project={project} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Setlist

function EditableTitle({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing) {
    return (
      <h1 class={`view-title is-editable ${value.length > 22 ? 'is-long' : ''}`} title="Click to rename" onClick={() => setEditing(true)}>
        {value}
      </h1>
    );
  }
  const commit = () => { setEditing(false); if (draft.trim() && draft !== value) onSave(draft.trim()); else setDraft(value); };
  return (
    <input
      class="view-title-input"
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
    />
  );
}

function InlineField({ icon, type = 'text', value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  return (
    <label class="inline-field">
      {icon}
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onChange={(e) => onSave(e.currentTarget.value)}
        onBlur={() => draft !== (value || '') && onSave(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </label>
  );
}

export function SetlistView({ id }) {
  const s = setlistsById.value.get(id);
  if (!s) {
    return (
      <div class="view">
        <Empty title="This setlist no longer exists">
          <button type="button" class="pill-btn" onClick={() => navigate({ view: 'oeuvre' }, { replace: true })}>Go to Oeuvre</button>
        </Empty>
      </div>
    );
  }
  const items = s.items.map((it) => ({ key: it.id, itemId: it.id, piece: pieceOrRef(it.pieceId) }));
  const pieces = items.map((r) => r.piece);
  const q = filters.value[`setlist:${id}`] || '';
  const rows = q ? items.filter((r) => filterPieces([r.piece], q).length) : items;
  const ctx = { type: 'setlist', id: s.id, name: s.name };
  const update = (patch) => invoke('setlist:update', s.id, patch);

  const play = (i) => {
    // Play the whole setlist in running order, starting from the chosen piece.
    const all = items.map((r) => r.piece.id);
    const start = items.indexOf(rows[i]);
    playContext({ ...ctx, ids: all }, Math.max(0, start));
  };

  const reorder = (rowKeys, at) => {
    const moving = new Set(rowKeys);
    const keys = items.map((r) => r.key);
    const before = keys.slice(0, at).filter((k) => !moving.has(k));
    const after = keys.slice(at).filter((k) => !moving.has(k));
    const movingInOrder = keys.filter((k) => moving.has(k));
    invoke('setlist:reorder', s.id, [...before, ...movingInOrder, ...after]);
  };

  return (
    <div class="view">
      <Header
        kind="Setlist"
        title={s.name}
        titleEditor={<EditableTitle value={s.name} onSave={(name) => update({ name })} />}
        art={<Mosaic pieces={pieces} size={200} glyph={pieces.filter((p) => p.artKey).length === 0 ? <ListMusic size={84} strokeWidth={1.5} /> : null} />}
        meta={
          <>
            <span>{plural(items.length, 'piece')}</span>
            <span>{fmtTotal(totalDuration(pieces))}</span>
            {s.date ? <span>{fmtShowDate(s.date)}</span> : null}
          </>
        }
      >
        <div class="setlist-fields">
          <InlineField icon={<CalendarDays size={15} />} type="date" value={s.date} placeholder="Show date" onSave={(date) => update({ date })} />
          <InlineField icon={<MapPin size={15} />} value={s.venue} placeholder="Venue" onSave={(venue) => update({ venue })} />
        </div>
      </Header>
      <div class="action-row">
        <PlayButton isThis={isContext('setlist', s.id)} disabled={!items.length} onPlay={() => play(0)} label="Play setlist" />
        <button type="button" class="pill-btn" onClick={() => { modal.value = { type: 'addPieces', setlistId: s.id }; }}>
          <Plus size={16} /> Add Pieces
        </button>
        <button type="button" class="icon-btn action-icon" title="Delete setlist" aria-label="Delete setlist"
          onClick={async () => { if (await invoke('setlist:delete', s.id)) navigate({ view: 'oeuvre' }, { replace: true }); }}>
          <Trash2 size={20} />
        </button>
        <div class="action-spacer" />
        <FilterBox fkey={`setlist:${id}`} placeholder="Search this setlist" />
      </div>
      <TrackList
        rows={rows}
        columns={['grip', 'index', 'title', 'score', 'start', 'duration', 'remove']}
        selectKey={`setlist:${s.id}`}
        context={ctx}
        onPlayRow={play}
        reorderable={!q}
        onReorder={reorder}
        onDropPieces={(ids, at) => addToSetlist(s.id, ids, at)}
        onRemoveRows={(rs) => {
          invoke('setlist:removeItems', s.id, rs.map((r) => r.itemId));
          selection.value = { key: null, ids: [], anchor: null };
        }}
        emptyState={
          q ? <Empty title={`Nothing in this setlist matches “${q}”`} />
            : (
              <Empty icon={<ListMusic size={28} />} title="Build your running order" body="Drag pieces here from Oeuvre, Portfolio or a project, then drag rows by their handle to set the running order. Attach a score to any piece to open it while you practice.">
                <button type="button" class="pill-btn" onClick={() => { modal.value = { type: 'addPieces', setlistId: s.id }; }}><Plus size={16} /> Add Pieces</button>
              </Empty>
            )
        }
      />
    </div>
  );
}

export { route };
