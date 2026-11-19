import { useState, useEffect, useRef } from 'preact/hooks';
import { marked } from 'marked';
import { X, Search, CheckCircle2, CircleAlert, Download, KeyRound, FolderOpen, RefreshCw } from 'lucide-preact';
import {
  modal, toasts, dismissToast, exportState, updateStatus, invoke, libraryPieces, filterPieces, setlistsById, appInfo,
} from '../lib/store.js';
import { createSetlist, addToSetlist } from '../lib/actions.js';
import { fmtTime, fmtDate, plural, formatDetail } from '../lib/format.js';
import { Artwork, Checkbox, IconButton } from './Common.jsx';

function Dialog({ title, onClose, children, footer, wide, class: cls = '' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div class={`dialog ${wide ? 'is-wide' : ''} ${cls}`} role="dialog" aria-modal="true" aria-label={title}>
        <div class="dialog-head">
          <h2>{title}</h2>
          {onClose ? <IconButton icon={X} label="Close" onClick={onClose} /> : null}
        </div>
        <div class="dialog-body">{children}</div>
        {footer ? <div class="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

const close = () => { modal.value = null; };

// ---------------------------------------------------------------- new setlist

function NewSetlistDialog({ pieceIds }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    const s = await createSetlist(name.trim() || 'New Setlist', pieceIds || []);
    if (date || venue) await invoke('setlist:update', s.id, { date, venue });
    close();
  };
  return (
    <Dialog
      title="New Setlist"
      onClose={close}
      footer={<><button type="button" class="ghost-btn" onClick={close}>Cancel</button><button type="submit" form="new-setlist" class="primary-btn">Create</button></>}
    >
      <form id="new-setlist" class="form" onSubmit={submit}>
        <label>Name<input autoFocus value={name} placeholder="e.g. Eddie's Attic — December" onInput={(e) => setName(e.currentTarget.value)} /></label>
        <div class="form-row">
          <label>Show date <span class="optional">optional</span><input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
          <label>Venue <span class="optional">optional</span><input value={venue} placeholder="Venue" onInput={(e) => setVenue(e.currentTarget.value)} /></label>
        </div>
        {pieceIds?.length ? <p class="form-note">Starts with {plural(pieceIds.length, 'piece')}.</p> : null}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- add pieces to a setlist

function AddPiecesDialog({ setlistId }) {
  const s = setlistsById.value.get(setlistId);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const inSetlist = new Set(s?.items.map((i) => i.pieceId));
  const list = filterPieces(libraryPieces.value, q);
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const add = async () => { await addToSetlist(setlistId, picked); close(); };
  return (
    <Dialog
      title={`Add to ${s?.name || 'Setlist'}`}
      onClose={close}
      wide
      footer={
        <>
          <span class="dialog-foot-note">{picked.length ? `${plural(picked.length, 'piece')} selected, added in the order you picked them` : 'Pick pieces in the order you want them'}</span>
          <button type="button" class="ghost-btn" onClick={close}>Cancel</button>
          <button type="button" class="primary-btn" disabled={!picked.length} onClick={add}>Add {picked.length || ''}</button>
        </>
      }
    >
      <div class="picker-search">
        <Search size={16} />
        <input autoFocus type="search" placeholder="Search your oeuvre" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="picker-list">
        {list.map((p) => {
          const n = picked.indexOf(p.id);
          return (
            <div key={p.id} class={`picker-row ${n >= 0 ? 'is-picked' : ''}`} onClick={() => toggle(p.id)}>
              <Checkbox checked={n >= 0} label={`Pick ${p.title}`} onChange={() => toggle(p.id)} />
              <Artwork piece={p} size={36} />
              <div class="picker-text">
                <div class="picker-title">{p.title}</div>
                <div class="picker-sub">{formatDetail(p)}{inSetlist.has(p.id) ? ' · already in this setlist' : ''}</div>
              </div>
              <span class="picker-order">{n >= 0 ? n + 1 : ''}</span>
              <span class="picker-dur">{fmtTime(p.duration)}</span>
            </div>
          );
        })}
        {!list.length ? <div class="menu-empty">No pieces match.</div> : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- export progress

function ExportDialog() {
  const st = exportState.value;
  if (!st) return null;
  const done = st.phase === 'finished' && st.result;
  const pct = Math.round((st.overall || 0) * 100);
  const finish = () => { exportState.value = null; };
  if (done) {
    const r = st.result;
    return (
      <Dialog
        title={r.failed.length ? 'Export finished with problems' : 'Export complete'}
        onClose={finish}
        footer={<><button type="button" class="ghost-btn" onClick={() => invoke('export:reveal', r.dest)}><FolderOpen size={16} /> Show in Finder</button><button type="button" class="primary-btn" onClick={finish}>Done</button></>}
      >
        <div class="export-summary">
          <CheckCircle2 size={36} class="ok-icon" />
          <div>
            <p><strong>{plural(r.written.length, 'MP3')}</strong> {r.mode === 'zip' ? 'saved in' : 'saved to'} <span class="mono">{r.dest.split('/').pop()}</span></p>
            {r.failed.length ? (
              <ul class="export-failed">
                {r.failed.map((f) => <li key={f.title}><CircleAlert size={14} /> {f.title}: {f.error}</li>)}
              </ul>
            ) : null}
          </div>
        </div>
      </Dialog>
    );
  }
  const verb = st.phase === 'zipping' ? 'Writing ZIP…' : st.phase === 'converting' ? 'Converting to MP3' : 'Copying';
  return (
    <Dialog title={st.mode === 'zip' ? 'Exporting ZIP' : 'Exporting MP3s'}
      footer={<button type="button" class="ghost-btn" onClick={() => invoke('export:cancel')}>Cancel</button>}>
      <div class="export-progress">
        <div class="export-line">
          <span>{st.phase === 'zipping' ? verb : `${verb}${st.title ? ` “${st.title}”` : ''}`}</span>
          <span>{Math.min(st.total, (st.index || 0) + 1)} of {st.total}</span>
        </div>
        <div class="bar"><div class="bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- updates

const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
function notesHtml(md) {
  return marked.parse(md || '_No release notes._', { renderer, gfm: true, breaks: true });
}

function TokenForm({ status }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    updateStatus.value = await invoke('updates:setToken', token);
    setBusy(false);
  };
  return (
    <form class="form token-form" onSubmit={save}>
      <div class="token-intro">
        <KeyRound size={22} />
        <div>
          <p><strong>{status.repo}</strong> is a private repository, so Oeuvre needs a GitHub token to read its releases.</p>
          <ol>
            <li>On GitHub, open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Settings › Developer settings › Fine-grained tokens</a>.</li>
            <li>Under <em>Repository access</em> choose <em>Only select repositories</em> › <strong>{status.repo}</strong>.</li>
            <li>Under <em>Permissions</em> set <em>Contents</em> to <strong>Read-only</strong>, generate it, and paste it here.</li>
          </ol>
          <p class="form-note">The token is saved in your macOS Keychain.</p>
        </div>
      </div>
      {status.state === 'bad-token' ? <p class="form-error"><CircleAlert size={14} /> {status.error}</p> : null}
      <div class="token-row">
        <input type="password" autoFocus placeholder="github_pat_…" value={token} onInput={(e) => setToken(e.currentTarget.value)} spellcheck={false} />
        <button type="submit" class="primary-btn" disabled={!token.trim() || busy}>{busy ? 'Checking…' : 'Save & Check'}</button>
      </div>
    </form>
  );
}

function UpdateDialog() {
  const st = updateStatus.value || { state: 'checking' };
  const latest = st.latest;
  const closeUpdate = () => { modal.value = null; };
  let body;
  let footer = <button type="button" class="primary-btn" onClick={closeUpdate}>OK</button>;

  switch (st.state) {
    case 'idle':
    case 'checking':
      body = <div class="update-status"><RefreshCw size={22} class="spin" /> Checking GitHub for a newer version…</div>;
      footer = null;
      break;
    case 'up-to-date':
      body = (
        <div class="update-status">
          <CheckCircle2 size={26} class="ok-icon" />
          <div>
            <p><strong>Oeuvre {st.current} is the latest version.</strong></p>
            {st.note ? <p class="muted">{st.note}</p> : null}
          </div>
        </div>
      );
      footer = <><button type="button" class="ghost-btn" onClick={async () => { updateStatus.value = await invoke('updates:clearToken'); }}>Change Token…</button><button type="button" class="primary-btn" onClick={closeUpdate}>OK</button></>;
      break;
    case 'needs-token':
    case 'bad-token':
      body = <TokenForm status={st} />;
      footer = <button type="button" class="ghost-btn" onClick={closeUpdate}>Not Now</button>;
      break;
    case 'available':
      body = (
        <div class="update-available">
          <p class="update-versions">Oeuvre <strong>{latest.version}</strong> is available — you have {st.current}.{latest.publishedAt ? ` Released ${fmtDate(Date.parse(latest.publishedAt))}.` : ''}</p>
          <div class="release-notes" dangerouslySetInnerHTML={{ __html: notesHtml(latest.notes) }}
            onClick={(e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); invoke('shell:openExternal', a.href); } }} />
        </div>
      );
      footer = (
        <>
          <button type="button" class="ghost-btn" onClick={async () => { updateStatus.value = await invoke('updates:skip', latest.version); closeUpdate(); }}>Skip This Version</button>
          <span class="action-spacer" />
          <button type="button" class="ghost-btn" onClick={closeUpdate}>Later</button>
          <button type="button" class="primary-btn" onClick={async () => { updateStatus.value = await invoke('updates:download'); }}><Download size={16} /> Download & Install</button>
        </>
      );
      break;
    case 'downloading':
      body = (
        <div class="export-progress">
          <div class="export-line">
            <span>{st.phase === 'unpacking' ? 'Unpacking…' : `Downloading Oeuvre ${latest?.version}…`}</span>
            <span>{Math.round((st.progress || 0) * 100)}%</span>
          </div>
          <div class="bar"><div class="bar-fill" style={{ width: `${Math.round((st.progress || 0) * 100)}%` }} /></div>
        </div>
      );
      footer = null;
      break;
    case 'ready':
      body = <div class="update-status"><CheckCircle2 size={26} class="ok-icon" /><p>Oeuvre {latest?.version} is ready. Oeuvre will quit, install the update, and reopen.</p></div>;
      footer = (
        <>
          <button type="button" class="ghost-btn" onClick={closeUpdate}>Install Later</button>
          <button type="button" class="primary-btn" onClick={async () => { updateStatus.value = await invoke('updates:install'); }}>Restart & Install</button>
        </>
      );
      break;
    case 'installing':
      body = <div class="update-status"><RefreshCw size={22} class="spin" /> Installing… Oeuvre will reopen in a moment.</div>;
      footer = null;
      break;
    case 'error':
    default:
      body = (
        <div class="update-status">
          <CircleAlert size={26} class="warn-icon" />
          <div><p><strong>Couldn't update.</strong></p><p class="muted">{st.error}</p></div>
        </div>
      );
      footer = <><button type="button" class="ghost-btn" onClick={closeUpdate}>Close</button><button type="button" class="primary-btn" onClick={async () => { updateStatus.value = { state: 'checking' }; updateStatus.value = await invoke('updates:check'); }}>Try Again</button></>;
  }

  const title = st.state === 'available' || st.state === 'downloading' || st.state === 'ready' ? 'Update Available'
    : st.state === 'needs-token' || st.state === 'bad-token' ? 'Connect to GitHub' : 'Software Update';
  return <Dialog title={title} onClose={st.state === 'installing' || st.state === 'downloading' ? null : closeUpdate} footer={footer} wide={st.state === 'available' || st.state === 'needs-token' || st.state === 'bad-token'}>{body}</Dialog>;
}

function MessageDialog({ title, body }) {
  return <Dialog title={title} onClose={close} footer={<button type="button" class="primary-btn" onClick={close}>OK</button>}><p>{body}</p></Dialog>;
}

export function Modals() {
  const m = modal.value;
  return (
    <>
      {m?.type === 'newSetlist' ? <NewSetlistDialog pieceIds={m.pieceIds} /> : null}
      {m?.type === 'addPieces' ? <AddPiecesDialog setlistId={m.setlistId} /> : null}
      {m?.type === 'update' ? <UpdateDialog /> : null}
      {m?.type === 'message' ? <MessageDialog title={m.title} body={m.body} /> : null}
      <ExportDialog />
    </>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class="toast">
          <span>{t.message}</span>
          {t.action ? <button type="button" class="toast-action" onClick={() => { t.onAction?.(); dismissToast(t.id); }}>{t.action}</button> : null}
        </div>
      ))}
    </div>
  );
}

export { appInfo };
