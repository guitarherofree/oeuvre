// Bundles the window's code into src/renderer/dist (and copies pdf.js's worker and data).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src/renderer/dist');
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const pdfjs = path.join(root, 'node_modules/pdfjs-dist');
fs.copyFileSync(path.join(pdfjs, 'build/pdf.worker.min.mjs'), path.join(out, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = path.join(pdfjs, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, 'pdfjs', dir), { recursive: true });
}

const options = {
  entryPoints: [path.join(root, 'src/renderer/main.jsx')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome140'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: production,
  sourcemap: production ? false : 'linked',
  legalComments: 'none',
  logLevel: 'info',
  alias: { react: 'preact/compat', 'react-dom': 'preact/compat' },
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
