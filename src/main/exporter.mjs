// Export for Portfolio (MP3) and Project (WAV): individual files into a folder,
// or one ZIP. Pieces already in the target format are copied byte-for-byte;
// anything else is converted with the bundled FFmpeg.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import yazl from 'yazl';

export function safeFileName(title) {
  const cleaned = String(title || 'Untitled')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'Untitled';
}

function uniqueName(base, taken, ext = 'mp3') {
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

function targetSampleRate(rate) {
  if (!rate || (rate >= 32000 && rate <= 48000)) return null;
  return rate % 11025 === 0 ? 44100 : 48000;
}

function parseTime(s) {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

/** PCM codec for a WAV export: lossless sources keep their bit depth; lossy ones use `lossyBits`. */
export function wavCodecFor(piece, lossyBits = 24) {
  const bits = piece.lossless && piece.bitsPerSample ? piece.bitsPerSample : lossyBits;
  if (bits <= 16) return 'pcm_s16le';
  if (bits <= 24) return 'pcm_s24le';
  return 'pcm_s32le';
}

function runFfmpeg(ffmpeg, args, { duration, signal, onFraction }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      tail = (tail + s).slice(-4000);
      const t = parseTime(s);
      if (t !== null && duration > 0) onFraction?.(Math.min(1, t / duration));
    });
    child.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(Object.assign(new Error('Export cancelled'), { cancelled: true }));
      if (code === 0) return resolve();
      reject(new Error(tail.trim().split('\n').filter(Boolean).pop() || `ffmpeg exited with code ${code}`));
    });
  });
}

export async function transcodeToWav({ ffmpeg, piece, out, title, lossyBits = 24, signal, onFraction }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-i', piece.path, '-map', '0:a:0', '-c:a', wavCodecFor(piece, lossyBits),
    '-map_metadata', '0', '-rf64', 'auto'];
  if (title) args.push('-metadata', `title=${title}`);
  args.push('-f', 'wav', out);
  try {
    await runFfmpeg(ffmpeg, args, { duration: piece.duration, signal, onFraction });
  } catch (err) {
    await fsp.rm(out, { force: true });
    throw err;
  }
}

export function transcodeToMp3({ ffmpeg, src, out, bitrate, sampleRate, title, duration, withArt = true, signal, onFraction }) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-y', '-i', src, '-map', '0:a:0'];
    if (withArt) args.push('-map', '0:v:0?', '-c:v', 'copy');
    args.push('-c:a', 'libmp3lame', '-b:a', `${bitrate}k`);
    const ar = targetSampleRate(sampleRate);
    if (ar) args.push('-ar', String(ar));
    args.push('-map_metadata', '0', '-id3v2_version', '3', '-write_id3v1', '1');
    if (title) args.push('-metadata', `title=${title}`);
    args.push('-f', 'mp3', out);

    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      tail = (tail + s).slice(-4000);
      const t = parseTime(s);
      if (t !== null && duration > 0) onFraction?.(Math.min(1, t / duration));
    });
    child.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    child.on('close', async (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(Object.assign(new Error('Export cancelled'), { cancelled: true }));
      if (code === 0) return resolve();
      await fsp.rm(out, { force: true });
      if (withArt) {
        // Some files carry artwork streams the MP3 muxer can't take; try again without art.
        return transcodeToMp3({ ffmpeg, src, out, bitrate, sampleRate, title, duration, withArt: false, signal, onFraction }).then(resolve, reject);
      }
      const lastLine = tail.trim().split('\n').filter(Boolean).pop() || `ffmpeg exited with code ${code}`;
      reject(new Error(lastLine));
    });
  });
}

/**
 * @param {object} o
 * @param {Array<{id,title,path,ext,sampleRate,bitsPerSample,lossless,duration}>} o.pieces
 * @param {'folder'|'zip'} o.mode
 * @param {'mp3'|'wav'} [o.format]
 * @param {string} o.dest      folder (mode=folder) or .zip file path (mode=zip)
 * @param {string} o.ffmpeg    path to ffmpeg binary
 * @param {number} o.bitrate   MP3 kbps
 * @param {number} [o.wavLossyBits] bit depth for WAVs decoded from MP3/AAC
 */
export async function exportPieces({ pieces, mode, format = 'mp3', dest, ffmpeg, bitrate, wavLossyBits = 24, onProgress, signal }) {
  const total = pieces.length;
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'oeuvre-export-'));
  const written = [];
  const failed = [];
  const taken = new Set();
  if (mode === 'folder') {
    await fsp.mkdir(dest, { recursive: true });
    for (const n of await fsp.readdir(dest)) taken.add(n.toLowerCase());
  }

  const report = (index, fraction, extra = {}) => {
    onProgress?.({ index, total, overall: total ? (index + fraction) / total : 1, format, ...extra });
  };

  const convert = (p, out, onFraction) => (format === 'wav'
    ? transcodeToWav({ ffmpeg, piece: p, out, title: p.title, lossyBits: wavLossyBits, signal, onFraction })
    : transcodeToMp3({ ffmpeg, src: p.path, out, bitrate, sampleRate: p.sampleRate, title: p.title, duration: p.duration, signal, onFraction }));

  const prepared = []; // { name, file }
  try {
    for (let i = 0; i < pieces.length; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Export cancelled'), { cancelled: true });
      const p = pieces[i];
      const name = uniqueName(safeFileName(p.title), taken, format);
      const alreadyThere = (p.ext || path.extname(p.path).slice(1)).toLowerCase() === format;
      report(i, 0, { title: p.title, phase: alreadyThere ? 'copying' : 'converting' });
      const onFraction = (f) => report(i, f, { title: p.title, phase: 'converting' });
      try {
        await fsp.access(p.path, fs.constants.R_OK);
        if (mode === 'folder') {
          const out = path.join(dest, name);
          if (alreadyThere) await fsp.copyFile(p.path, out, fs.constants.COPYFILE_EXCL);
          else {
            const part = path.join(work, name);
            await convert(p, part, onFraction);
            await fsp.copyFile(part, out, fs.constants.COPYFILE_EXCL);
            await fsp.rm(part, { force: true });
          }
          written.push(name);
        } else {
          let file = p.path;
          if (!alreadyThere) {
            file = path.join(work, name);
            await convert(p, file, onFraction);
          }
          prepared.push({ name, file });
        }
      } catch (err) {
        if (err.cancelled) throw err;
        taken.delete(name.toLowerCase());
        failed.push({ title: p.title, error: err.code === 'ENOENT' ? 'File not found' : String(err.message || err) });
      }
      report(i, 1, { title: p.title, phase: 'done-file' });
    }

    if (mode === 'zip') {
      if (!prepared.length) throw new Error('Nothing could be exported.');
      onProgress?.({ index: total, total, overall: 1, format, phase: 'zipping' });
      const part = `${dest}.part`;
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        const out = fs.createWriteStream(part);
        out.on('close', resolve);
        out.on('error', reject);
        zip.outputStream.on('error', reject).pipe(out);
        // Audio is already compressed (MP3) or barely compressible (WAV): store it.
        for (const { name, file } of prepared) zip.addFile(file, name, { compress: false });
        zip.end();
        signal?.addEventListener('abort', () => { out.destroy(); reject(Object.assign(new Error('Export cancelled'), { cancelled: true })); }, { once: true });
      });
      await fsp.rename(part, dest);
      written.push(...prepared.map((p) => p.name));
    }
    onProgress?.({ index: total, total, overall: 1, format, phase: 'finished' });
    return { dest, mode, format, written, failed };
  } catch (err) {
    if (mode === 'zip') await fsp.rm(`${dest}.part`, { force: true });
    throw err;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
