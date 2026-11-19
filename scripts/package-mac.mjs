// Builds Oeuvre.app for macOS (Apple silicon by default) into out/.
//
//   npm run dist:mac                 → out/Oeuvre-darwin-arm64/Oeuvre.app
//   ARCH=x64 npm run dist:mac        → Intel build (needs an x64 ffmpeg, see README)
//
// On a Mac the app is then ad-hoc signed and zipped as
// out/Oeuvre-<version>-mac-<arch>.zip, the file the in-app updater looks for.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const arch = process.env.ARCH || 'arm64';
// PLATFORM=linux builds the same bundle layout for Linux; used only to test packaging off a Mac.
const platform = process.env.PLATFORM || 'darwin';
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');

execFileSync(process.execPath, [path.join(root, 'scripts/build-renderer.mjs'), '--production'], { stdio: 'inherit' });

const keep = [
  /^\/package\.json$/,
  /^\/src$/, /^\/src\/config\.mjs$/,
  /^\/src\/main(\/|$)/, /^\/src\/preload(\/|$)/,
  /^\/src\/renderer$/, /^\/src\/renderer\/(index\.html|theme\.css|styles\.css)$/, /^\/src\/renderer\/dist(\/|$)/,
  /^\/node_modules(\/|$)/,
];

const [appDir] = await packager({
  dir: root,
  name: 'Oeuvre',
  executableName: 'Oeuvre',
  platform,
  arch,
  out: path.join(root, 'out'),
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.join(root, 'build/icon.icns'),
  appBundleId: 'com.guitarherofree.oeuvre',
  appCategoryType: 'public.app-category.music',
  appVersion: pkg.version,
  buildVersion: pkg.version,
  appCopyright: `© ${new Date().getFullYear()} Freeman Edwards`,
  darwinDarkModeSupport: true,
  extraResource: [ffmpeg],
  extendInfo: {
    LSMinimumSystemVersion: '12.0',
    // Shown by macOS when Oeuvre first reads music or scores in these places.
    NSDesktopFolderUsageDescription: 'Oeuvre plays music and opens scores from folders you add.',
    NSDocumentsFolderUsageDescription: 'Oeuvre plays music and opens scores from folders you add.',
    NSDownloadsFolderUsageDescription: 'Oeuvre plays music and opens scores from folders you add.',
    NSRemovableVolumesUsageDescription: 'Oeuvre plays music from folders you add on external drives.',
    NSNetworkVolumesUsageDescription: 'Oeuvre plays music from folders you add on network drives.',
    NSHumanReadableCopyright: `© ${new Date().getFullYear()} Freeman Edwards`,
  },
  ignore: (file) => {
    if (!file) return false;
    if (file.endsWith('.map')) return true;
    return !keep.some((re) => re.test(file));
  },
});

if (platform !== 'darwin') {
  console.log(`Built ${appDir} (test build)`);
  process.exit(0);
}

// The bundled encoder must be named exactly "ffmpeg".
const resources = path.join(appDir, 'Oeuvre.app', 'Contents', 'Resources');
const copied = path.join(resources, path.basename(ffmpeg));
if (path.basename(ffmpeg) !== 'ffmpeg') fs.renameSync(copied, path.join(resources, 'ffmpeg'));
fs.chmodSync(path.join(resources, 'ffmpeg'), 0o755);

const app = path.join(appDir, 'Oeuvre.app');
console.log(`Built ${app}`);

if (process.platform === 'darwin') {
  // Ad-hoc signature: required for Apple silicon to run the app and the bundled ffmpeg.
  execFileSync('codesign', ['--force', '--sign', '-', path.join(resources, 'ffmpeg')], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  const zip = path.join(root, 'out', `Oeuvre-${pkg.version}-mac-${arch}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], { stdio: 'inherit' });
  console.log(`Zipped ${zip}`);
} else {
  console.log('Not on macOS: skipping signing and zipping (the GitHub Actions workflow does this on a Mac).');
}
