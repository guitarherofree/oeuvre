import { initials, tileHue } from '../lib/format.js';
import { artUrl } from '../lib/player.js';

/** Oeuvre's mark: a ring with a ligature, drawn so it scales cleanly. */
export function LogoMark({ size = 28 }) {
  return (
    <svg class="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="var(--accent)" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="var(--accent-ink)" stroke-width="3" opacity="0.18" />
      <text x="32" y="44" text-anchor="middle" font-family="var(--font-mark)" font-size="34" font-weight="700" fill="var(--accent-ink)">Œ</text>
    </svg>
  );
}

export function Logo() {
  return (
    <div class="logo">
      <LogoMark size={30} />
      <span class="logo-word">Oeuvre</span>
    </div>
  );
}

/** Square artwork, or a generated tile with the piece's initials. */
export function Artwork({ piece, size = 40, radius = 4, class: cls = '' }) {
  const url = piece?.artKey ? artUrl(piece.artKey) : null;
  const style = { width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` };
  if (url) return <img class={`artwork ${cls}`} src={url} style={style} alt="" draggable={false} loading="lazy" />;
  const hue = tileHue(piece?.id || piece?.title || '');
  return (
    <div
      class={`artwork artwork-tile ${cls}`}
      style={{
        ...style,
        background: `linear-gradient(135deg, hsl(${hue} 55% 22%), hsl(${hue + 18} 60% 9%))`,
        fontSize: `${Math.max(10, size * 0.32)}px`,
      }}
    >
      <span>{initials(piece?.title)}</span>
    </div>
  );
}

/** Up to four artworks in a 2×2 grid (setlists), or a single glyph tile. */
export function Mosaic({ pieces, size = 200, glyph }) {
  const withArt = pieces.filter((p) => p && !p.missing);
  if (glyph || withArt.length === 0) {
    return (
      <div class="mosaic mosaic-glyph" style={{ width: `${size}px`, height: `${size}px` }}>
        {glyph}
      </div>
    );
  }
  if (withArt.length < 4) return <Artwork piece={withArt[0]} size={size} radius={6} class="mosaic" />;
  const half = size / 2;
  return (
    <div class="mosaic mosaic-grid" style={{ width: `${size}px`, height: `${size}px` }}>
      {withArt.slice(0, 4).map((p) => <Artwork key={p.id} piece={p} size={half} radius={0} />)}
    </div>
  );
}

export function EqualizerBars({ paused }) {
  return (
    <span class={`eq ${paused ? 'eq-paused' : ''}`} aria-label="Now playing">
      <i /><i /><i /><i />
    </span>
  );
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, size = 18, class: cls = '', ...rest }) {
  return (
    <button
      type="button"
      class={`icon-btn ${active ? 'is-active' : ''} ${cls}`}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : !!active}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      <Icon size={size} strokeWidth={2} />
    </button>
  );
}

export function Checkbox({ checked, indeterminate, onChange, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : !!checked}
      aria-label={label}
      class={`checkbox ${checked ? 'is-checked' : ''} ${indeterminate ? 'is-mixed' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      onDblClick={(e) => e.stopPropagation()}
    >
      {checked && !indeterminate ? (
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      ) : null}
      {indeterminate ? <span class="checkbox-dash" /> : null}
    </button>
  );
}
