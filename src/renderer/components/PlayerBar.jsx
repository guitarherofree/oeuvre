import { useState } from 'preact/hooks';
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume, Volume1, Volume2, VolumeX,
  ListMusic, FileMusic, Briefcase, X,
} from 'lucide-preact';
import {
  queueOpen, route, navigate, portfolioIds, scoresFor, sourceName, saveUi, pieceOrRef, toast,
} from '../lib/store.js';
import {
  player, currentPiece, togglePlay, next, previous, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat,
  upcoming, jumpToQueueItem, jumpToUpcoming, removeFromQueue, clearQueue,
} from '../lib/player.js';
import { addToPortfolio, removeFromPortfolio, openScore, playCurrentPage, showPieceMenu } from '../lib/actions.js';
import { fmtTime, formatDetail } from '../lib/format.js';
import { Artwork, IconButton, EqualizerBars } from './Common.jsx';

/** Range slider that fills with the accent on hover, and only seeks on release. */
function Slider({ value, max, onCommit, onLive, label, class: cls = '' }) {
  const [drag, setDrag] = useState(null);
  const v = drag ?? value;
  const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
  return (
    <input
      type="range"
      class={`slider ${drag !== null ? 'is-dragging' : ''} ${cls}`}
      min={0}
      max={max || 1}
      step="any"
      value={v}
      aria-label={label}
      style={{ '--fill': `${pct}%` }}
      onInput={(e) => { const n = Number(e.currentTarget.value); setDrag(n); onLive?.(n); }}
      onChange={(e) => { onCommit(Number(e.currentTarget.value)); setDrag(null); }}
      onPointerUp={() => setTimeout(() => setDrag(null), 0)}
    />
  );
}

function contextRoute(ctx) {
  if (!ctx) return null;
  if (ctx.type === 'oeuvre') return { view: 'oeuvre' };
  if (ctx.type === 'portfolio') return { view: 'portfolio' };
  if (ctx.type === 'project') return { view: 'project', id: ctx.id };
  if (ctx.type === 'setlist') return { view: 'setlist', id: ctx.id };
  return null;
}

export function PlayerBar() {
  const p = currentPiece.value;
  const playing = player.playing.value;
  const dur = player.duration.value || p?.duration || 0;
  const [scrub, setScrub] = useState(null);
  const vol = player.muted.value ? 0 : player.volume.value;
  const VolIcon = vol === 0 ? VolumeX : vol < 0.34 ? Volume : vol < 0.67 ? Volume1 : Volume2;
  const inPortfolio = p && portfolioIds.value.has(p.id);
  const hasScore = p && scoresFor(p.id).length > 0;
  const scoreOpen = route.value.view === 'score' && route.value.pieceId === p?.id;
  const ctxRoute = contextRoute(player.context.value);

  return (
    <footer class="player-bar">
      <div class="np">
        {p ? (
          <>
            <button type="button" class="np-art" onClick={() => ctxRoute && navigate(ctxRoute)} title={player.context.value ? `Playing from ${player.context.value.name}` : ''}
              onContextMenu={(e) => { e.preventDefault(); showPieceMenu([p.id], null); }}>
              <Artwork piece={p} size={56} radius={6} />
            </button>
            <div class="np-text">
              <button type="button" class="np-title" onClick={() => ctxRoute && navigate(ctxRoute)}>{p.title}</button>
              <div class="np-sub">{p.artist || [sourceName(p), p.folder].filter(Boolean).join(' / ') || formatDetail(p)}</div>
            </div>
            <IconButton
              icon={Briefcase}
              label={inPortfolio ? 'Remove from Portfolio' : 'Add to Portfolio'}
              active={inPortfolio}
              class="np-portfolio"
              size={17}
              onClick={() => (inPortfolio ? removeFromPortfolio([p.id]) : addToPortfolio([p.id]))}
            />
          </>
        ) : <div class="np-empty">Nothing playing</div>}
      </div>

      <div class="transport">
        <div class="transport-buttons">
          <IconButton icon={Shuffle} label={player.shuffle.value ? 'Shuffle on' : 'Shuffle off'} active={player.shuffle.value} onClick={toggleShuffle} class="dot-when-active" />
          <IconButton icon={SkipBack} label="Previous (⌘←)" onClick={previous} disabled={!p} size={20} />
          <button type="button" class="play-btn" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={() => { if (!togglePlay()) playCurrentPage(); }}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" class="play-nudge" />}
          </button>
          <IconButton icon={SkipForward} label="Next (⌘→)" onClick={() => next()} disabled={!p} size={20} />
          <IconButton
            icon={player.repeat.value === 'one' ? Repeat1 : Repeat}
            label={player.repeat.value === 'off' ? 'Repeat off' : player.repeat.value === 'all' ? 'Repeat all' : 'Repeat one'}
            active={player.repeat.value !== 'off'}
            onClick={cycleRepeat}
            class="dot-when-active"
          />
        </div>
        <div class="progress">
          <span class="time">{fmtTime(scrub ?? player.position.value)}</span>
          <Slider value={player.position.value} max={dur} label="Seek" onLive={setScrub} onCommit={(t) => { seek(t); setScrub(null); }} class="seek" />
          <span class="time">{fmtTime(dur)}</span>
        </div>
      </div>

      <div class="extras">
        <IconButton icon={FileMusic} label={hasScore ? 'Show score (⌥⌘S)' : 'Attach a score to this piece'} active={scoreOpen} disabled={!p}
          onClick={() => {
            if (scoreOpen) navigate(route.value.from || { view: 'oeuvre' });
            else if (p) openScore(p.id);
          }} class={hasScore ? 'has-score' : ''} />
        <IconButton icon={ListMusic} label="Queue (⌥⌘Q)" active={queueOpen.value} onClick={() => { queueOpen.value = !queueOpen.value; saveUi(); }} />
        <div class="volume">
          <IconButton icon={VolIcon} label={player.muted.value ? 'Unmute' : 'Mute'} onClick={toggleMute} />
          <Slider value={vol} max={1} label="Volume" onLive={setVolume} onCommit={setVolume} class="vol" />
        </div>
      </div>
    </footer>
  );
}

function QueueRow({ piece, onPlay, onRemove, current }) {
  return (
    <div class={`q-row ${current ? 'is-current' : ''} ${piece.missing ? 'is-missing' : ''}`} onDblClick={onPlay}
      onContextMenu={(e) => { e.preventDefault(); if (!piece.missing) showPieceMenu([piece.id], null); }}>
      <button type="button" class="q-art" onClick={onPlay} aria-label={`Play ${piece.title}`} disabled={piece.missing}>
        <Artwork piece={piece} size={40} />
        <span class="q-art-play"><Play size={16} fill="currentColor" /></span>
      </button>
      <div class="q-text">
        <div class="q-title">{current && player.playing.value ? <EqualizerBars /> : null}{piece.title}</div>
        <div class="q-sub">{fmtTime(piece.duration)}{piece.missing ? ' · unavailable' : ''}</div>
      </div>
      {onRemove ? <IconButton icon={X} label="Remove from queue" onClick={onRemove} size={15} class="q-remove" /> : null}
    </div>
  );
}

export function QueuePanel() {
  const cur = currentPiece.value;
  const queue = player.queue.value;
  const up = upcoming.value.slice(0, 200);
  const ctx = player.context.value;
  return (
    <aside class="panel queue-panel">
      <div class="queue-head">
        <h2>Queue</h2>
        <IconButton icon={X} label="Close queue" onClick={() => { queueOpen.value = false; saveUi(); }} />
      </div>
      <div class="queue-scroll">
        {cur ? (
          <section>
            <h3>Now playing</h3>
            <QueueRow piece={cur} current onPlay={togglePlay} />
          </section>
        ) : null}
        {queue.length ? (
          <section>
            <h3>Next in queue <button type="button" class="link-btn" onClick={() => { clearQueue(); toast('Queue cleared'); }}>Clear</button></h3>
            {queue.map((q) => <QueueRow key={q.key} piece={pieceOrRef(q.id)} onPlay={() => jumpToQueueItem(q.key)} onRemove={() => removeFromQueue(q.key)} />)}
          </section>
        ) : null}
        {up.length ? (
          <section>
            <h3>Next from: {ctx?.name}</h3>
            {up.map((u) => <QueueRow key={u.key} piece={pieceOrRef(u.id)} onPlay={() => jumpToUpcoming(u.orderPos)} />)}
          </section>
        ) : null}
        {!cur && !queue.length ? (
          <div class="queue-empty">
            <ListMusic size={28} />
            <p>Your queue is empty.</p>
            <p class="hint">Right-click a piece and choose Play Next or Add to Queue.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
