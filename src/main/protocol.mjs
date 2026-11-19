// Custom URL schemes so the window can stream local files by id (never by raw path).
//   oeuvre-app://app/…               the interface itself (files under src/renderer)
//   oeuvre-media://piece/<pieceId>   audio, with HTTP Range support for seeking
//   oeuvre-art://art/<key>           cached artwork
//   oeuvre-score://score/<scoreId>   imported score images
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json', svg: 'image/svg+xml',
  wasm: 'application/wasm', ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2', pfb: 'application/octet-stream',
  bcmap: 'application/octet-stream', icc: 'application/octet-stream',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf',
};

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'oeuvre-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } },
    { scheme: 'oeuvre-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'oeuvre-art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: 'oeuvre-score', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

function notFound() {
  return new Response('Not found', { status: 404 });
}

export async function serveFile(file, request, { cache = false } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return notFound(); }
  const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache ? 'max-age=31536000, immutable' : 'no-cache',
  };
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
    if (start >= st.size || end < start) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    end = Math.min(end, st.size - 1);
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(file));
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
}

export function handleSchemes({ library, collections, appRoot }) {
  protocol.handle('oeuvre-app', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(appRoot, rel);
    if (!file.startsWith(appRoot + path.sep)) return notFound();
    return serveFile(file, request);
  });
  protocol.handle('oeuvre-media', (request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const piece = library.getPiece(id);
    return piece ? serveFile(piece.path, request) : notFound();
  });
  protocol.handle('oeuvre-art', (request) => {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const file = library.artPath(key);
    return file ? serveFile(file, request, { cache: true }) : notFound();
  });
  protocol.handle('oeuvre-score', (request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const hit = collections.findScore(id);
    return hit ? serveFile(collections.scoreFilePath(hit.entry, { display: true }), request, { cache: true }) : notFound();
  });
}
