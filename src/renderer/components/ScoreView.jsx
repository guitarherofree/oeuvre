import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import {
  ChevronLeft, ZoomIn, ZoomOut, ExternalLink, Trash2, Plus, FileMusic, Image as ImageIcon, FileText, Play, Pause, MoveHorizontal,
  ChevronUp, ChevronDown,
} from 'lucide-preact';
import * as pdfjs from 'pdfjs-dist';
import { route, navigate, pieceOrRef, scoresFor, invoke, setlistsById, toast, api } from '../lib/store.js';
import { player, playContext, togglePlay } from '../lib/player.js';
import { attachScore } from '../lib/actions.js';
import { fmtBytes } from '../lib/format.js';
import { Artwork, IconButton } from './Common.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', import.meta.url).href;
const PDF_ASSETS = new URL('pdfjs/', import.meta.url).href;

const KIND_ICON = { pdf: FileMusic, image: ImageIcon, other: FileText };
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Renders every page of a PDF; pages are drawn when they scroll near the viewport. */
function PdfPages({ scoreId, zoom, width, onPageCount, scroller }) {
  const [doc, setDoc] = useState(null);
  const [sizes, setSizes] = useState([]);
  const [error, setError] = useState(null);
  const canvases = useRef([]);
  const rendered = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    let task = null;
    setDoc(null); setSizes([]); setError(null);
    rendered.current = new Map();
    (async () => {
      try {
        const res = await invoke('score:read', scoreId);
        if (!res) throw new Error('Score file not found');
        task = pdfjs.getDocument({
          data: res.data,
          cMapUrl: `${PDF_ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDF_ASSETS}standard_fonts/`,
          wasmUrl: `${PDF_ASSETS}wasm/`,
          iccUrl: `${PDF_ASSETS}iccs/`,
        });
        const loaded = await task.promise;
        const s = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const page = await loaded.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          s.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) return;
        setSizes(s);
        setDoc(loaded);
        onPageCount(loaded.numPages);
      } catch (err) {
        if (!cancelled) setError(String(err.message || err));
      }
    })();
    return () => {
      cancelled = true;
      try { task?.destroy(); } catch {}
    };
  }, [scoreId]);

  const scaleFor = (i) => {
    const s = sizes[i];
    return s ? ((width - 48) / s.w) * zoom : 1;
  };

  const renderPage = useCallback(async (i) => {
    if (!doc) return;
    const canvas = canvases.current[i];
    if (!canvas) return;
    const scale = scaleFor(i);
    const key = scale.toFixed(3);
    const prev = rendered.current.get(i);
    if (prev?.key === key) return;
    prev?.task?.cancel();
    const page = await doc.getPage(i + 1);
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * dpr });
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width);
    off.height = Math.floor(vp.height);
    const task = page.render({ canvas: off, viewport: vp, background: '#ffffff' });
    rendered.current.set(i, { key, task });
    try {
      await task.promise;
      // Swap in the finished bitmap so zooming never flashes blank pages.
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d').drawImage(off, 0, 0);
    } catch {}
  }, [doc, zoom, width, sizes]);

  useEffect(() => {
    if (!doc || !scroller.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) renderPage(Number(e.target.dataset.page));
    }, { root: scroller.current, rootMargin: '800px 0px' });
    canvases.current.forEach((c) => c && io.observe(c));
    return () => io.disconnect();
  }, [doc, renderPage]);

  if (error) return <div class="score-error">Couldn't open this PDF: {error}</div>;
  if (!sizes.length) return <div class="score-loading">Opening score…</div>;
  return (
    <div class="pdf-pages">
      {sizes.map((s, i) => {
        const scale = scaleFor(i);
        return (
          <canvas
            key={i}
            data-page={i}
            class="score-page"
            ref={(el) => { canvases.current[i] = el; }}
            style={{ width: `${Math.round(s.w * scale)}px`, height: `${Math.round(s.h * scale)}px` }}
          />
        );
      })}
    </div>
  );
}

export function ScoreView({ r }) {
  const piece = pieceOrRef(r.pieceId);
  const list = scoresFor(r.pieceId);
  const score = list.find((s) => s.id === r.scoreId) || list[0];
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(900);
  const scroller = useRef(null);

  useEffect(() => {
    if (!scroller.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setPage(1); setPages(score?.kind === 'image' ? 1 : 0); scroller.current?.scrollTo(0, 0); }, [score?.id]);

  // Track which page is showing.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const pagesEls = el.querySelectorAll('.score-page');
    const mid = el.scrollTop + el.clientHeight * 0.35;
    let n = 1;
    pagesEls.forEach((p, i) => { if (p.offsetTop <= mid) n = i + 1; });
    setPage(n);
  };

  const goToPage = (n) => {
    const el = scroller.current;
    const target = el?.querySelectorAll('.score-page')[n - 1];
    if (target) el.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
  };

  const zoomBy = (dir) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 4 : i) + dir))]);
  };

  // Page keys for practicing: ←/→, PageUp/PageDown, and ⌘ +/−/0 for zoom.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.metaKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1); return; }
      if (e.metaKey && e.key === '-') { e.preventDefault(); zoomBy(-1); return; }
      if (e.metaKey && e.key === '0') { e.preventDefault(); setZoom(1); return; }
      if (e.metaKey || e.altKey) return;
      if (['ArrowRight', 'PageDown'].includes(e.key) && pages > 1) { e.preventDefault(); goToPage(Math.min(pages, page + 1)); }
      if (['ArrowLeft', 'PageUp'].includes(e.key) && pages > 1) { e.preventDefault(); goToPage(Math.max(1, page - 1)); }
      if (e.key === 'Escape') navigate(r.from || { view: 'oeuvre' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isCurrent = player.current.value === piece.id;
  const playThis = () => {
    if (isCurrent) return togglePlay();
    const from = r.from;
    if (from?.view === 'setlist') {
      const s = setlistsById.value.get(from.id);
      const ids = s?.items.map((it) => it.pieceId) || [];
      const i = ids.indexOf(piece.id);
      if (i >= 0) return playContext({ type: 'setlist', id: s.id, name: s.name, ids }, i);
    }
    playContext({ type: 'selection', name: piece.title, ids: [piece.id] }, 0);
  };

  // Drop score files straight onto the viewer to attach them.
  const onDrop = async (e) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    const added = await invoke('score:attachFiles', piece.id, paths);
    if (added?.length) {
      toast(`Attached ${added.length === 1 ? `“${added[0].name}”` : `${added.length} files`}`);
      navigate({ ...r, scoreId: added[0].id }, { replace: true });
    }
  };

  const removeScore = async () => {
    if (!score) return;
    if (await invoke('score:remove', score.id)) {
      const rest = list.filter((s) => s.id !== score.id);
      if (rest.length) navigate({ ...r, scoreId: rest[0].id }, { replace: true });
      else navigate(r.from || { view: 'oeuvre' }, { replace: true });
    }
  };

  return (
    <div class="score-view" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      <div class="score-bar">
        <IconButton icon={ChevronLeft} label="Back" onClick={() => navigate(r.from || { view: 'oeuvre' })} size={20} />
        <Artwork piece={piece} size={44} />
        <div class="score-title">
          <div class="view-kind">Score</div>
          <div class="score-piece">{piece.title}</div>
        </div>
        <button type="button" class={`score-play ${isCurrent && player.playing.value ? 'is-playing' : ''}`} onClick={playThis} disabled={piece.missing}
          title={isCurrent && player.playing.value ? 'Pause' : 'Play this piece'}>
          {isCurrent && player.playing.value ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          <span>{isCurrent && player.playing.value ? 'Pause' : 'Play'}</span>
        </button>
        <div class="score-tools">
          {score && score.kind !== 'other' ? (
            <>
              {pages > 1 ? (
                <span class="page-nav">
                  <IconButton icon={ChevronUp} label="Previous page (←)" onClick={() => goToPage(Math.max(1, page - 1))} disabled={page <= 1} />
                  <span class="page-indicator">{page} / {pages}</span>
                  <IconButton icon={ChevronDown} label="Next page (→)" onClick={() => goToPage(Math.min(pages, page + 1))} disabled={page >= pages} />
                </span>
              ) : null}
              <IconButton icon={ZoomOut} label="Zoom out (⌘−)" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} />
              <button type="button" class="zoom-label" title="Fit width (⌘0)" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <IconButton icon={ZoomIn} label="Zoom in (⌘+)" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} />
              <IconButton icon={MoveHorizontal} label="Fit width" onClick={() => setZoom(1)} />
            </>
          ) : null}
          {score ? <IconButton icon={ExternalLink} label="Open in its default app" onClick={() => invoke('score:open', score.id)} /> : null}
          {score ? <IconButton icon={Trash2} label="Remove this score" onClick={removeScore} /> : null}
        </div>
      </div>

      {list.length > 0 ? (
        <div class="score-tabs" role="tablist">
          {list.map((s) => {
            const Icon = KIND_ICON[s.kind] || FileText;
            return (
              <button type="button" role="tab" key={s.id} aria-selected={s.id === score?.id} class={`score-tab ${s.id === score?.id ? 'is-active' : ''}`}
                onClick={() => navigate({ ...r, scoreId: s.id }, { replace: true })} title={s.name}>
                <Icon size={14} /> <span>{s.name}</span>
              </button>
            );
          })}
          <button type="button" class="score-tab score-tab-add" onClick={() => attachScore(piece.id)} title="Attach another score (PDF, image or any file)">
            <Plus size={14} /> Attach
          </button>
        </div>
      ) : null}

      <div class="score-scroll" ref={scroller} onScroll={onScroll}>
        {!score ? (
          <div class="score-other">
            <FileMusic size={40} />
            <h2>No score attached</h2>
            <p>Attach a PDF, images of pages, or any other file. You can also drop files here.</p>
            <button type="button" class="primary-btn" onClick={() => attachScore(piece.id)}><Plus size={18} /> Attach Score…</button>
          </div>
        ) : score.kind === 'pdf' ? (
          <PdfPages key={score.id} scoreId={score.id} zoom={zoom} width={width} onPageCount={setPages} scroller={scroller} />
        ) : score.kind === 'image' ? (
          <div class="pdf-pages">
            <img class="score-page score-image" src={`oeuvre-score://score/${encodeURIComponent(score.id)}`} alt={score.name}
              style={{ width: `${Math.round((width - 48) * zoom)}px` }} draggable={false} />
          </div>
        ) : (
          <div class="score-other">
            <FileText size={40} />
            <h2>{score.name}</h2>
            <p>{fmtBytes(score.size)} · Opens in the app your Mac uses for this kind of file.</p>
            <button type="button" class="primary-btn" onClick={async () => {
              const err = await invoke('score:open', score.id);
              if (err) toast(err);
            }}><ExternalLink size={18} /> Open</button>
          </div>
        )}
      </div>
    </div>
  );
}

export { route };
