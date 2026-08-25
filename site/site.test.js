'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Discover every local src/href instead of maintaining a hand-written asset list.
// This catches a renamed or newly added image, icon, script, or stylesheet.
const localReferences = new Set();
for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
  const reference = match[1];
  if (
    reference.startsWith('#') ||
    reference.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(reference)
  ) continue;

  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/^\.\//, '');
  if (clean) localReferences.add(clean);
}
assert.ok(localReferences.size >= 3, 'expected the page to reference local website assets');
for (const reference of localReferences) {
  const file = path.resolve(root, reference.replace(/^\//, ''));
  assert.ok(
    file === root || file.startsWith(`${root}${path.sep}`),
    `local website reference escapes site/: ${reference}`,
  );
  assert.ok(fs.existsSync(file), `missing local website asset: ${reference}`);
  assert.ok(fs.statSync(file).isFile(), `local website asset is not a file: ${reference}`);
}

assert.match(html, /<title>RoseLite/);
assert.match(html, /id="download"/);
assert.doesNotMatch(html, /<\/a>a>/i, 'stray text must not follow a closing anchor');

// The download must point at GitHub's permanent "latest release" alias, never a
// versioned filename — the page is static and would otherwise rot on every release.
const DL = 'https://github.com/DrezByte/RoseLite/releases/latest/download/RoseLite-Setup.exe';
assert.ok(html.includes(`href="${DL}"`), 'the download link must use the latest/download alias');
assert.doesNotMatch(html, /releases\/download\/v/i, 'no pinned per-version download URLs');
assert.doesNotMatch(html, /<button[^>]+disabled="disabled"/, 'the download button is available');
assert.doesNotMatch(html, /coming soon|not yet available|not public yet/i, 'pre-release copy must be gone');

// Public copy must describe the shipped build and its local/online boundary.
assert.match(html, /Progress stays on this PC/);
assert.match(html, /Market prices, news and update checks require an internet connection/);
assert.match(html, /not affiliated with, endorsed by, or sponsored by/i);
assert.match(html, /King Respawn Timers/);
assert.doesNotMatch(
  html,
  /Drop Tracker|DPS meter|Party finder|Connected ·|kills, drops per hour|client memory|injection|network capture|protocol/i,
  'the public page must not advertise unavailable tracking or implementation details',
);

// The site and repository are public; private backup/repository references are not.
assert.doesNotMatch(
  html,
  /RoseLite[-_\s]?private|private\s+(?:backup|repo(?:sitory)?)/i,
  'never reference a private backup or repository',
);

console.log(`site checks passed (${localReferences.size} local assets verified)`);
