// Playback engine: one <audio> element, a play context (the list you started from),
// a user queue ("Play Next" / "Add to Queue") that plays first, shuffle and repeat.
import { signal, computed, effect, batch } from '@preact/signals';
import config from '../../config.mjs';
import { api, invoke, piecesById, isAvailable, isVisible, toast } from './store.js';

const audio = new Audio();
audio.preload = 'auto';

export const player = {
  current: signal(null),
  playing: signal(false),
  position: signal(0),
  duration: signal(0),
  volume: signal(0.8),
  muted: signal(false),
  shuffle: signal(false),
  repeat: signal('off'), // 'off' | 'all' | 'one'
  context: signal(null), // { type, id, name, ids }
  order: signal([]),     // play order: indices into context.ids
  pos: signal(-1),       // position in order of the current context item
  queue: signal([]),     // [{ key, id }]
  fromQueue: signal(false),
};

let queueSeq = 0;
let pendingSeek = null;
let errorStreak = 0;

const mediaUrl = (id) => `oeuvre-media://piece/${encodeURIComponent(id)}`;
export const artUrl = (key) => (key ? `oeuvre-art://art/${encodeURIComponent(key)}` : null);

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function playable(id) {
  if (!isAvailable(id)) return false;
  // Pieces from unchecked folders are skipped when playing through the library itself.
  if (player.context.value?.type === 'oeuvre' && !isVisible(id)) return false;
  return true;
}

export const currentPiece = computed(() => piecesById.value.get(player.current.value) || null);

export const upcoming = computed(() => {
  const ctx = player.context.value;
  if (!ctx) return [];
  const order = player.order.value;
  const start = player.pos.value + 1;
  return order.slice(start).map((idx, n) => ({ key: `c${start + n}`, orderPos: start + n, id: ctx.ids[idx] }));
});

// ---------------------------------------------------------------- loading

function load(id, { autoplay = true, at = 0 } = {}) {
  const piece = piecesById.value.get(id);
  batch(() => {
    player.current.value = id;
    player.position.value = at;
    player.duration.value = piece?.duration || 0;
  });
  pendingSeek = at > 0 ? at : null;
  audio.src = mediaUrl(id);
  if (autoplay) audio.play().catch(() => {});
  updateMediaSession();
  persistSoon();
}

/**
 * Start playing a list.
 * @param {{type: string, id?: string, name: string, ids: string[]}} context
 * @param {number} startIndex index into context.ids (ignored with { shuffleStart: true })
 */
export function playContext(context, startIndex = 0, { shuffleStart = false } = {}) {
  const ids = context.ids;
  if (!ids.length) return;
  if (shuffleStart) {
    player.shuffle.value = true;
    const ok = ids.map((_, i) => i).filter((i) => isAvailable(ids[i]));
    startIndex = ok.length ? ok[Math.floor(Math.random() * ok.length)] : 0;
  }
  let order = ids.map((_, i) => i);
  let pos = startIndex;
  if (player.shuffle.value) {
    order = [startIndex, ...shuffled(order.filter((i) => i !== startIndex))];
    pos = 0;
  }
  batch(() => {
    player.context.value = context;
    player.order.value = order;
    player.pos.value = pos;
    player.fromQueue.value = false;
  });
  errorStreak = 0;
  if (!playable(ids[startIndex])) return next();
  load(ids[startIndex]);
}

export function togglePlay() {
  if (!player.current.value) return false;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  return true;
}

export function pause() { audio.pause(); }

export function next({ auto = false } = {}) {
  if (auto && player.repeat.value === 'one' && player.current.value) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  // Your queue plays before the rest of the list.
  let q = player.queue.value;
  while (q.length) {
    const [item, ...rest] = q;
    q = rest;
    if (isAvailable(item.id)) {
      batch(() => { player.queue.value = rest; player.fromQueue.value = true; });
      load(item.id);
      return;
    }
  }
  player.queue.value = [];

  const ctx = player.context.value;
  if (!ctx) return stopAtEnd();
  let order = player.order.value;
  let pos = player.pos.value;
  for (let tries = 0; tries <= ctx.ids.length; tries++) {
    pos += 1;
    if (pos >= order.length) {
      if (player.repeat.value !== 'all') return stopAtEnd();
      if (player.shuffle.value) order = shuffled(order);
      pos = 0;
    }
    const id = ctx.ids[order[pos]];
    if (playable(id)) {
      batch(() => {
        player.order.value = order;
        player.pos.value = pos;
        player.fromQueue.value = false;
      });
      load(id);
      return;
    }
  }
  stopAtEnd();
}

function stopAtEnd() {
  // Like most players: stop, and cue the first piece of the list.
  audio.pause();
  const ctx = player.context.value;
  const order = player.order.value;
  const firstPos = ctx ? order.findIndex((i) => playable(ctx.ids[i])) : -1;
  if (firstPos >= 0) {
    batch(() => { player.pos.value = firstPos; player.fromQueue.value = false; });
    load(ctx.ids[order[firstPos]], { autoplay: false });
  } else {
    batch(() => { player.playing.value = false; player.position.value = 0; });
  }
}

export function previous() {
  if (!player.current.value) return;
  if (audio.currentTime > config.playback.previousRestartsAfterSeconds) {
    audio.currentTime = 0;
    return;
  }
  const ctx = player.context.value;
  if (ctx && player.fromQueue.value && player.pos.value >= 0) {
    // Step back out of the queue to the list piece that was playing before it.
    player.fromQueue.value = false;
    load(ctx.ids[player.order.value[player.pos.value]]);
    return;
  }
  if (!ctx) { audio.currentTime = 0; return; }
  const order = player.order.value;
  for (let pos = player.pos.value - 1; pos >= 0; pos--) {
    const id = ctx.ids[order[pos]];
    if (playable(id)) {
      player.pos.value = pos;
      load(id);
      return;
    }
  }
  if (player.repeat.value === 'all') {
    for (let pos = order.length - 1; pos > player.pos.value; pos--) {
      const id = ctx.ids[order[pos]];
      if (playable(id)) { player.pos.value = pos; load(id); return; }
    }
  }
  audio.currentTime = 0;
}

export function seek(seconds) {
  if (!player.current.value) return;
  const d = audio.duration || player.duration.value || 0;
  const t = Math.max(0, Math.min(seconds, d ? d - 0.05 : seconds));
  audio.currentTime = t;
  player.position.value = t;
  persistSoon();
}

export function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  batch(() => {
    player.volume.value = v;
    if (v > 0) player.muted.value = false;
  });
}

export function toggleMute() { player.muted.value = !player.muted.value; }

export function toggleShuffle() { setShuffle(!player.shuffle.value); }

export function setShuffle(on) {
  const ctx = player.context.value;
  batch(() => {
    player.shuffle.value = on;
    if (!ctx) return;
    const curIdx = player.pos.value >= 0 ? player.order.value[player.pos.value] : 0;
    if (on) {
      player.order.value = [curIdx, ...shuffled(ctx.ids.map((_, i) => i).filter((i) => i !== curIdx))];
      player.pos.value = 0;
    } else {
      player.order.value = ctx.ids.map((_, i) => i);
      player.pos.value = curIdx;
    }
  });
  persistSoon();
}

export function cycleRepeat() {
  const order = ['off', 'all', 'one'];
  player.repeat.value = order[(order.indexOf(player.repeat.value) + 1) % order.length];
  persistSoon();
}

export function setRepeat(mode) {
  if (['off', 'all', 'one'].includes(mode)) player.repeat.value = mode;
  persistSoon();
}

// ---------------------------------------------------------------- queue

export function addToQueue(ids) {
  player.queue.value = [...player.queue.value, ...ids.map((id) => ({ key: `q${++queueSeq}`, id }))];
  persistSoon();
}

export function playNext(ids) {
  player.queue.value = [...ids.map((id) => ({ key: `q${++queueSeq}`, id })), ...player.queue.value];
  persistSoon();
}

export function removeFromQueue(key) {
  player.queue.value = player.queue.value.filter((q) => q.key !== key);
  persistSoon();
}

export function clearQueue() {
  player.queue.value = [];
  persistSoon();
}

export function moveQueueItem(fromIndex, toIndex) {
  const q = player.queue.value.slice();
  const [item] = q.splice(fromIndex, 1);
  q.splice(toIndex, 0, item);
  player.queue.value = q;
  persistSoon();
}

export function jumpToQueueItem(key) {
  const q = player.queue.value;
  const i = q.findIndex((x) => x.key === key);
  if (i < 0) return;
  batch(() => {
    player.queue.value = q.slice(i + 1);
    player.fromQueue.value = true;
  });
  load(q[i].id);
}

export function jumpToUpcoming(orderPos) {
  const ctx = player.context.value;
  if (!ctx) return;
  batch(() => { player.pos.value = orderPos; player.fromQueue.value = false; });
  load(ctx.ids[player.order.value[orderPos]]);
}

/** Drop pieces that no longer exist from the queue and context (e.g. a source was removed). */
export function pruneMissing() {
  const q = player.queue.value.filter((x) => piecesById.value.has(x.id));
  if (q.length !== player.queue.value.length) player.queue.value = q;
}

// ---------------------------------------------------------------- audio events

audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) player.duration.value = audio.duration;
  if (pendingSeek !== null) {
    try { audio.currentTime = pendingSeek; } catch {}
    pendingSeek = null;
  }
});
audio.addEventListener('timeupdate', () => { player.position.value = audio.currentTime; });
audio.addEventListener('play', () => { player.playing.value = true; errorStreak = 0; });
audio.addEventListener('playing', () => { player.playing.value = true; });
audio.addEventListener('pause', () => { player.playing.value = false; persistSoon(); });
audio.addEventListener('ended', () => next({ auto: true }));
audio.addEventListener('error', () => {
  if (!audio.src || !player.current.value) return;
  const piece = piecesById.value.get(player.current.value);
  errorStreak++;
  toast(`Couldn't play “${piece?.title || 'this piece'}”.`);
  player.playing.value = false;
  if (errorStreak < 3) setTimeout(() => next({ auto: false }), 700);
});

effect(() => {
  audio.volume = player.muted.value ? 0 : player.volume.value ** 1.6; // perceptual curve
});

effect(() => {
  api.playerState({ playing: player.playing.value, shuffle: player.shuffle.value, repeat: player.repeat.value });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.current.value ? (player.playing.value ? 'playing' : 'paused') : 'none';
});

// ---------------------------------------------------------------- Now Playing / media keys

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const p = currentPiece.value;
  if (!p) return;
  const art = artUrl(p.artKey);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: p.title,
    artist: p.artist || 'Oeuvre',
    album: player.context.value?.name || p.album || '',
    artwork: art ? [{ src: art, sizes: '640x640', type: 'image/jpeg' }] : [],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play().catch(() => {}));
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', () => previous());
  ms.setActionHandler('nexttrack', () => next());
  ms.setActionHandler('seekto', (d) => seek(d.seekTime));
  ms.setActionHandler('seekbackward', (d) => seek(audio.currentTime - (d.seekOffset || 10)));
  ms.setActionHandler('seekforward', (d) => seek(audio.currentTime + (d.seekOffset || 10)));
}

// ---------------------------------------------------------------- persistence

let persistTimer;
export function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 800);
}

function persistNow() {
  invoke('state:save', {
    player: {
      current: player.current.value,
      position: player.position.value,
      volume: player.volume.value,
      muted: player.muted.value,
      shuffle: player.shuffle.value,
      repeat: player.repeat.value,
      context: player.context.value,
      order: player.order.value,
      pos: player.pos.value,
      queue: player.queue.value.map((q) => q.id),
      fromQueue: player.fromQueue.value,
    },
  });
}

setInterval(() => { if (player.playing.value) persistNow(); }, 5000);
window.addEventListener('beforeunload', persistNow);

export function restore(saved) {
  if (!saved) return;
  batch(() => {
    if (typeof saved.volume === 'number') player.volume.value = saved.volume;
    player.muted.value = !!saved.muted;
    player.shuffle.value = !!saved.shuffle;
    player.repeat.value = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
    if (saved.context?.ids?.length) {
      player.context.value = saved.context;
      const valid = Array.isArray(saved.order) && saved.order.length === saved.context.ids.length;
      player.order.value = valid ? saved.order : saved.context.ids.map((_, i) => i);
      player.pos.value = Number.isInteger(saved.pos) ? saved.pos : -1;
    }
    player.queue.value = (saved.queue || []).map((id) => ({ key: `q${++queueSeq}`, id }));
    player.fromQueue.value = !!saved.fromQueue;
  });
  if (saved.current && isAvailable(saved.current)) load(saved.current, { autoplay: false, at: saved.position || 0 });
}
