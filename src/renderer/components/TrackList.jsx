import { useRef, useState, useEffect, useLayoutEffect } from 'preact/hooks';
import { Play, Clock3, X, GripVertical, FileMusic, Image as ImageIcon, FileText, Paperclip, ArrowDown, ArrowUp } from 'lucide-preact';
import { selection, dragging, scoresFor, sourceName, invoke } from '../lib/store.js';
import { player } from '../lib/player.js';
import { fmtTime, fmtDate, formatLabel, formatDetail, plural } from '../lib/format.js';
import { showPieceMenu, openScore, attachScore } from '../lib/actions.js';
import { Artwork, EqualizerBars, Checkbox } from './Common.jsx';
import { DRAG_TYPE } from './Sidebar.jsx';

const COLS = {
  check: { width: '36px', label: '' },
  grip: { width: '20px', label: '' },
  index: { width: '44px', label: '#' },
  title: { width: 'minmax(220px, 5fr)', label: 'Title' },
  folder: { width: 'minmax(120px, 2.4fr)', label: 'Folder' },
  format: { width: '84px', label: 'Format' },
  modified: { width: '118px', label: 'Modified' },
  score: { width: '136px', label: 'Score' },
  start: { width: '72px', label: 'Starts' },
  duration: { width: '70px', label: <Clock3 size={15} /> },
  remove: { width: '40px', label: '' },
};

function useElementWidth(ref) {
  const [w, setW] = useState(1000);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

function ScoreCell({ piece }) {
  const list = scoresFor(piece.id);
  if (!list.length) {
    return (
      <button type="button" class="score-attach" onClick={(e) => { e.stopPropagation(); attachScore(piece.id); }} onDblClick={(e) => e.stopPropagation()}>
        <Paperclip size={14} /> Attach…
      </button>
    );
  }
  const pdfs = list.filter((s) => s.kind === 'pdf').length;
  const images = list.filter((s) => s.kind === 'image').length;
  const label = list.length === 1
    ? (pdfs ? 'PDF' : images ? 'Image' : 'File')
    : [pdfs && plural(pdfs, 'PDF'), images && plural(images, 'image'), (list.length - pdfs - images) && plural(list.length - pdfs - images, 'file')].filter(Boolean).join(', ');
  const Icon = pdfs ? FileMusic : images ? ImageIcon : FileText;
  return (
    <button type="button" class="score-chip" title="Open score" onClick={(e) => { e.stopPropagation(); openScore(piece.id); }} onDblClick={(e) => e.stopPropagation()}>
      <Icon size={14} /> <span>{label}</span>
    </button>
  );
}

/**
 * A Spotify-style list of pieces.
 * rows: [{ key, piece, itemId? }]
 */
export function TrackList({
  rows, columns, selectKey, context, onPlayRow, onRemoveRows,
  reorderable = false, onReorder, onDropPieces,
  checked, onCheck, emptyState, sort,
}) {
  const listRef = useRef(null);
  const width = useElementWidth(listRef);
  const [dropIndex, setDropIndex] = useState(null);
  const sel = selection.value.key === selectKey ? selection.value : { key: selectKey, ids: [], anchor: null };
  const selected = new Set(sel.ids);
  const current = player.current.value;
  const playing = player.playing.value;

  // Narrow windows drop the least important columns.
  let cols = columns;
  if (width < 900) cols = cols.filter((c) => c !== 'modified');
  if (width < 760) cols = cols.filter((c) => c !== 'folder' && c !== 'start');
  if (width < 600) cols = cols.filter((c) => c !== 'format');
  const template = cols.map((c) => COLS[c].width).join(' ');

  let elapsed = 0;
  const starts = rows.map((r) => { const s = elapsed; elapsed += r.piece.duration || 0; return s; });

  const setSel = (ids, anchor) => { selection.value = { key: selectKey, ids, anchor }; };

  function onRowClick(e, i) {
    const key = rows[i].key;
    if (e.shiftKey && sel.anchor !== null) {
      const a = rows.findIndex((r) => r.key === sel.anchor);
      const [lo, hi] = a < i ? [a, i] : [i, a];
      setSel(rows.slice(lo, hi + 1).map((r) => r.key), sel.anchor);
    } else if (e.metaKey || e.ctrlKey) {
      setSel(selected.has(key) ? sel.ids.filter((k) => k !== key) : [...sel.ids, key], key);
    } else {
      setSel([key], key);
    }
  }

  function selectedRows(i) {
    const key = rows[i]?.key;
    if (key && !selected.has(key)) { setSel([key], key); return [rows[i]]; }
    return rows.filter((r) => selected.has(r.key));
  }

  function onContext(e, i) {
    e.preventDefault();
    const picked = selectedRows(i).filter((r) => !r.piece.missing || context?.type !== 'oeuvre');
    if (!picked.length) return;
    showPieceMenu(picked.map((r) => r.piece.id), { ...context, itemIds: picked.map((r) => r.itemId).filter(Boolean) });
  }

  function onKeyDown(e) {
    if (!rows.length) return;
    const idx = rows.findIndex((r) => r.key === sel.ids[sel.ids.length - 1]);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && reorderable && onReorder && sel.ids.length) {
      // ⌥↑ / ⌥↓ move the selected rows one place.
      e.preventDefault();
      const picked = rows.map((r, i) => (selected.has(r.key) ? i : -1)).filter((i) => i >= 0);
      const first = picked[0];
      const last = picked[picked.length - 1];
      if (e.key === 'ArrowUp' && first > 0) onReorder(picked.map((i) => rows[i].key), first - 1);
      if (e.key === 'ArrowDown' && last < rows.length - 1) onReorder(picked.map((i) => rows[i].key), last + 2);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey && sel.anchor) {
        const a = rows.findIndex((r) => r.key === sel.anchor);
        const [lo, hi] = a < n ? [a, n] : [n, a];
        setSel(rows.slice(lo, hi + 1).map((r) => r.key), sel.anchor);
      } else setSel([rows[n].key], rows[n].key);
      listRef.current?.querySelector(`[data-row="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault();
      onPlayRow(idx);
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && onRemoveRows && sel.ids.length) {
      e.preventDefault();
      onRemoveRows(rows.filter((r) => selected.has(r.key)));
    } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setSel(rows.map((r) => r.key), rows[0].key);
    }
  }

  // ---- drag and drop
  function onDragStart(e, i) {
    const picked = selectedRows(i);
    const payload = { ids: picked.map((r) => r.piece.id), rowKeys: picked.map((r) => r.key), itemIds: picked.map((r) => r.itemId).filter(Boolean), from: selectKey };
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = picked.length === 1 ? picked[0].piece.title : plural(picked.length, 'piece');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 16, 16);
    setTimeout(() => ghost.remove(), 0);
    dragging.value = payload;
  }

  function rowDropIndex(e, i) {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? i : i + 1;
  }

  function onRowDragOver(e, i) {
    if (!(reorderable || onDropPieces) || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragging.value?.from === selectKey ? 'move' : 'copy';
    setDropIndex(rowDropIndex(e, i));
  }

  function onListDragOver(e) {
    if (!(reorderable || onDropPieces) || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    if (e.target === e.currentTarget || e.target.classList.contains('tracklist-end')) setDropIndex(rows.length);
  }

  function onDrop(e) {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    const at = dropIndex ?? rows.length;
    setDropIndex(null);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    const payload = JSON.parse(raw);
    if (payload.from === selectKey && reorderable) onReorder?.(payload.rowKeys, at);
    else onDropPieces?.(payload.ids, at);
  }

  useEffect(() => {
    const end = () => { setDropIndex(null); dragging.value = null; };
    window.addEventListener('dragend', end);
    return () => window.removeEventListener('dragend', end);
  }, []);

  return (
    <div
      class={`tracklist ${dropIndex !== null ? 'is-dropping' : ''} ${reorderable ? 'is-reorderable' : ''}`}
      ref={listRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={onListDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropIndex(null); }}
      onDrop={onDrop}
      style={{ '--cols': template }}
    >
      <div class="tl-row tl-head" role="row">
        {cols.map((c) => (
          <div key={c} class={`tl-cell col-${c}`}>
            {c === 'check' && checked ? (
              <Checkbox
                checked={rows.length > 0 && rows.every((r) => checked.has(r.piece.id))}
                indeterminate={rows.some((r) => checked.has(r.piece.id)) && !rows.every((r) => checked.has(r.piece.id))}
                label="Select all"
                onChange={(v) => onCheck(rows.map((r) => r.piece.id), v)}
              />
            ) : sort?.column === c ? (
              sort.onFlip ? (
                <button type="button" class="sort-head" title={sort.hint} onClick={sort.onFlip}>
                  {COLS[c].label} {sort.descending ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                </button>
              ) : (
                <span class="sort-head" title={sort.hint}>{COLS[c].label} {sort.descending ? <ArrowDown size={14} /> : <ArrowUp size={14} />}</span>
              )
            ) : COLS[c].label}
          </div>
        ))}
      </div>

      {rows.length === 0 ? emptyState : null}

      {rows.map((row, i) => {
        const p = row.piece;
        const isCurrent = p.id === current;
        const isSel = selected.has(row.key);
        return (
          <div
            key={row.key}
            data-row={i}
            role="row"
            class={`tl-row ${isSel ? 'is-selected' : ''} ${isCurrent ? 'is-current' : ''} ${p.missing ? 'is-missing' : ''} ${dropIndex === i ? 'drop-before' : ''}`}
            draggable={!p.missing || reorderable}
            onClick={(e) => onRowClick(e, i)}
            onDblClick={() => !p.missing && onPlayRow(i)}
            onContextMenu={(e) => onContext(e, i)}
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => onRowDragOver(e, i)}
          >
            {cols.map((c) => {
              switch (c) {
                case 'check':
                  return <div key={c} class="tl-cell col-check"><Checkbox checked={checked?.has(p.id)} label={`Select ${p.title}`} onChange={(v) => onCheck([p.id], v)} /></div>;
                case 'grip':
                  return <div key={c} class="tl-cell col-grip" title="Drag to reorder (or select and press ⌥↑ / ⌥↓)"><GripVertical size={16} /></div>;
                case 'index':
                  return (
                    <div key={c} class="tl-cell col-index">
                      {isCurrent && playing ? <EqualizerBars /> : <span class="tl-num">{i + 1}</span>}
                      <button type="button" class="tl-play" aria-label={`Play ${p.title}`} disabled={p.missing}
                        onClick={(e) => { e.stopPropagation(); onPlayRow(i); }} onDblClick={(e) => e.stopPropagation()}>
                        <Play size={15} fill="currentColor" />
                      </button>
                    </div>
                  );
                case 'title':
                  return (
                    <div key={c} class="tl-cell col-title">
                      <Artwork piece={p} size={40} />
                      <div class="tl-title-text">
                        <div class="tl-title">{p.title}</div>
                        <div class="tl-sub">
                          {p.missing ? <span class="badge badge-warn">Unavailable</span> : null}
                          {p.missing ? (p.path ? p.path.split('/').pop() : '') : (p.artist || formatDetail(p))}
                        </div>
                      </div>
                    </div>
                  );
                case 'folder':
                  return <div key={c} class="tl-cell col-folder" title={p.path}>{p.missing ? '' : [sourceName(p), p.folder].filter(Boolean).join(' / ')}</div>;
                case 'format':
                  return <div key={c} class="tl-cell col-format">{p.ext ? <span class="format-badge" title={formatDetail(p)}>{formatLabel(p)}</span> : null}</div>;
                case 'modified':
                  return <div key={c} class="tl-cell col-modified">{fmtDate(p.mtimeMs)}</div>;
                case 'score':
                  return <div key={c} class="tl-cell col-score"><ScoreCell piece={p} /></div>;
                case 'start':
                  return <div key={c} class="tl-cell col-start">{fmtTime(starts[i])}</div>;
                case 'duration':
                  return <div key={c} class="tl-cell col-duration">{p.duration ? fmtTime(p.duration) : '–'}</div>;
                case 'remove':
                  return (
                    <div key={c} class="tl-cell col-remove">
                      <button type="button" class="tl-remove" title="Remove" aria-label={`Remove ${p.title}`}
                        onClick={(e) => { e.stopPropagation(); onRemoveRows?.([row]); }} onDblClick={(e) => e.stopPropagation()}>
                        <X size={15} />
                      </button>
                    </div>
                  );
                default:
                  return null;
              }
            })}
          </div>
        );
      })}
      {(reorderable || onDropPieces) && rows.length ? <div class={`tracklist-end ${dropIndex === rows.length ? 'drop-before' : ''}`} /> : null}
    </div>
  );
}

export { invoke };
