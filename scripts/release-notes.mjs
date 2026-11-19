// Prints the CHANGELOG.md section for a version (used as GitHub release notes).
import fs from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
const text = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf8') : '';
const lines = text.split('\n');
const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
if (start < 0) {
  console.log(`Oeuvre ${version}`);
} else {
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  console.log((end < 0 ? rest : rest.slice(0, end)).join('\n').trim() || `Oeuvre ${version}`);
}
