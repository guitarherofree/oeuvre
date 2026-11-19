import { useState, useRef, useEffect } from 'preact/hooks';
import { Play, Pause, Shuffle, Search, X, Briefcase, Download, Archive, Plus, Trash2, FolderPlus, CalendarDays, MapPin, ListMusic, EyeOff, ArrowDownUp } from 'lucide-preact';
import {
  library, libraryPieces, filters, setFilter, collections, setlistsById, pieceOrRef, invoke,
  filterPieces, modal, route, navigate, selection, portfolioDescending, saveUi,
} from '../lib/store.js';
import config from '../../config.mjs';
import { player, playContext, togglePlay } from '../lib/player.js';
import { sortByTitle, fmtTotal, fmtShowDate, plural } from '../lib/format.js';
import { addSourceFolders, addToSetlist, addToPortfolio, exportPieces, removeFromPortfolio } from '../lib/actions.js';
import { TrackList } from './TrackList.jsx';
import { LogoMark, Mosaic } from './Common.jsx';

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

// ---------------------------------------------------------------- Portfolio

export function PortfolioView() {
  const entries = collections.value.portfolio;
  const descending = portfolioDescending.value;
  const pieces = sortByTitle(entries.map((e) => pieceOrRef(e.pieceId)), descending);
  const flip = () => { portfolioDescending.value = !descending; saveUi(); };
  const q = filters.value.portfolio || '';
  const list = filterPieces(pieces, q);
  const [checked, setChecked] = useState(() => new Set());
  const valid = new Set(pieces.map((p) => p.id));
  const checkedIds = [...checked].filter((id) => valid.has(id));
  const exportable = checkedIds.filter((id) => !pieceOrRef(id).missing);
  const nonMp3 = exportable.filter((id) => pieceOrRef(id).ext !== 'mp3').length;

  const onCheck = (ids, on) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const ctx = { type: 'portfolio', name: 'Portfolio' };
  const playable = list.filter((p) => !p.missing);
  const play = (i) => {
    const target = list[i];
    playContext({ ...ctx, ids: playable.map((p) => p.id) }, Math.max(0, playable.indexOf(target)));
  };

  return (
    <div class="view">
      <Header
        kind="Collection"
        title="Portfolio"
        art={<Mosaic pieces={pieces} size={200} glyph={pieces.length < 4 ? <Briefcase size={84} strokeWidth={1.5} /> : null} />}
        meta={
          <>
            <span>{plural(pieces.length, 'work sample')}</span>
            <span>{fmtTotal(totalDuration(pieces))}</span>
          </>
        }
      />
      <div class="action-row">
        <PlayButton isThis={isContext('portfolio')} disabled={!playable.length} onPlay={() => play(0)} />
        <div class="export-group">
          <button type="button" class="pill-btn" disabled={!exportable.length} onClick={() => exportPieces(exportable, 'folder')}
            title={nonMp3 ? `${plural(nonMp3, 'piece')} will be converted to MP3` : 'Copy the MP3 files to a folder'}>
            <Download size={16} /> Export {exportable.length ? exportable.length : ''} as MP3s…
          </button>
          <button type="button" class="pill-btn" disabled={!exportable.length} onClick={() => exportPieces(exportable, 'zip')}
            title={nonMp3 ? `${plural(nonMp3, 'piece')} will be converted to MP3` : 'One ZIP of MP3 files'}>
            <Archive size={16} /> Export as ZIP…
          </button>
          <span class="export-hint">
            {exportable.length
              ? (nonMp3 ? `${plural(nonMp3, 'piece')} will be converted to MP3` : 'All selected pieces are already MP3')
              : pieces.length ? 'Check pieces to export them' : ''}
          </span>
        </div>
        <div class="action-spacer" />
        <button type="button" class="sort-toggle" onClick={flip} disabled={pieces.length < 2}
          title={descending ? 'Showing newest first. Click to show oldest first.' : 'Showing oldest first. Click to show newest first.'}>
          <span>{descending ? 'Newest first' : 'Oldest first'}</span>
          <ArrowDownUp size={16} />
        </button>
        <FilterBox fkey="portfolio" placeholder="Search Portfolio" />
      </div>
      <TrackList
        rows={list.map((p) => ({ key: p.id, piece: p }))}
        columns={['check', 'index', 'title', 'folder', 'format', 'duration', 'remove']}
        sort={{ column: 'title', descending, onFlip: flip, hint: descending ? 'Newest first. Click to flip.' : 'Oldest first. Click to flip.' }}
        selectKey="portfolio"
        context={ctx}
        onPlayRow={play}
        checked={checked}
        onCheck={onCheck}
        onRemoveRows={(rows) => removeFromPortfolio(rows.map((r) => r.piece.id))}
        onDropPieces={(ids) => addToPortfolio(ids)}
        emptyState={
          q ? <Empty title={`Nothing in Portfolio matches “${q}”`} />
            : <Empty icon={<Briefcase size={28} />} title="Your Portfolio is empty" body="Collect your best work samples here. Right-click a piece and choose Add to Portfolio, or drag pieces onto Portfolio in the sidebar." />
        }
      />
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
              <Empty icon={<ListMusic size={28} />} title="Build your running order" body="Drag pieces here from Oeuvre or Portfolio, then drag rows by their handle to set the running order. Attach a score to any piece to open it while you practice.">
                <button type="button" class="pill-btn" onClick={() => { modal.value = { type: 'addPieces', setlistId: s.id }; }}><Plus size={16} /> Add Pieces</button>
              </Empty>
            )
        }
      />
    </div>
  );
}

export { route };
