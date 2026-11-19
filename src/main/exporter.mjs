// Portfolio export: individual MP3 files into a folder, or one ZIP of MP3s.
// Pieces that aren't MP3 are converted with the bundled FFmpeg (LAME encoder).
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

function uniqueName(base, taken) {
  let name = `${base}.mp3`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).mp3`;
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
 * @param {Array<{id,title,path,ext,sampleRate,duration}>} o.pieces
 * @param {'folder'|'zip'} o.mode
 * @param {string} o.dest      folder (mode=folder) or .zip file path (mode=zip)
 * @param {string} o.ffmpeg    path to ffmpeg binary
 * @param {number} o.bitrate   kbps
 */
export async function exportPieces({ pieces, mode, dest, ffmpeg, bitrate, onProgress, signal }) {
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
    onProgress?.({ index, total, overall: total ? (index + fraction) / total : 1, ...extra });
  };

  const prepared = []; // { name, file }
  try {
    for (let i = 0; i < pieces.length; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Export cancelled'), { cancelled: true });
      const p = pieces[i];
      const name = uniqueName(safeFileName(p.title), taken);
      const isMp3 = (p.ext || path.extname(p.path).slice(1)).toLowerCase() === 'mp3';
      report(i, 0, { title: p.title, phase: isMp3 ? 'copying' : 'converting' });
      try {
        await fsp.access(p.path, fs.constants.R_OK);
        if (mode === 'folder') {
          const out = path.join(dest, name);
          if (isMp3) await fsp.copyFile(p.path, out, fs.constants.COPYFILE_EXCL);
          else {
            const part = path.join(work, name);
            await transcodeToMp3({
              ffmpeg, src: p.path, out: part, bitrate, sampleRate: p.sampleRate, title: p.title,
              duration: p.duration, signal, onFraction: (f) => report(i, f, { title: p.title, phase: 'converting' }),
            });
            await fsp.copyFile(part, out, fs.constants.COPYFILE_EXCL);
            await fsp.rm(part, { force: true });
          }
          written.push(name);
        } else {
          let file = p.path;
          if (!isMp3) {
            file = path.join(work, name);
            await transcodeToMp3({
              ffmpeg, src: p.path, out: file, bitrate, sampleRate: p.sampleRate, title: p.title,
              duration: p.duration, signal, onFraction: (f) => report(i, f, { title: p.title, phase: 'converting' }),
            });
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
      onProgress?.({ index: total, total, overall: 1, phase: 'zipping' });
      const part = `${dest}.part`;
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        const out = fs.createWriteStream(part);
        out.on('close', resolve);
        out.on('error', reject);
        zip.outputStream.on('error', reject).pipe(out);
        for (const { name, file } of prepared) zip.addFile(file, name, { compress: false });
        zip.end();
        signal?.addEventListener('abort', () => { out.destroy(); reject(Object.assign(new Error('Export cancelled'), { cancelled: true })); }, { once: true });
      });
      await fsp.rename(part, dest);
      written.push(...prepared.map((p) => p.name));
    }
    onProgress?.({ index: total, total, overall: 1, phase: 'finished' });
    return { dest, mode, written, failed };
  } catch (err) {
    if (mode === 'zip') await fsp.rm(`${dest}.part`, { force: true });
    throw err;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}
