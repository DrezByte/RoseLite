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
assert.match(html, /<button[^>]+disabled="disabled"[^>]+aria-disabled="true"/);
assert.doesNotMatch(html, /href=["'][^"']*\.(?:exe|msi)(?:[?"'])/i, 'download must remain unavailable');
assert.doesNotMatch(html, /github\.com/i, 'private repository links must not be published');

console.log('site checks passed');
