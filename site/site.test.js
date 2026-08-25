'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const file of ['support.js', 'assets/logo.webp', 'assets/rose-hero.jpg', 'assets/faust.png']) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing website asset: ${file}`);
}

assert.match(html, /<title>RoseLite/);
assert.match(html, /id="download"/);
// The download must point at GitHub's permanent "latest release" alias, never a
// versioned filename — the page is static and would otherwise rot on every release.
const DL = 'https://github.com/DrezByte/RoseLite/releases/latest/download/RoseLite-Setup.exe';
assert.ok(html.includes(`href="${DL}"`), 'the download link must use the latest/download alias');
assert.doesNotMatch(html, /releases\/download\/v/i, 'no pinned per-version download URLs');
assert.doesNotMatch(html, /<button[^>]+disabled="disabled"/, 'the download button is live now');
assert.doesNotMatch(html, /coming soon|not yet available|not public yet/i, 'pre-release copy must be gone');
// The site is public and so is the repo, but the private one must never be linked.
assert.doesNotMatch(html, /RoseLite-private/i, 'never link the private repository');

console.log('site checks passed');
