// Mod manager. A mod is a folder in mods/ whose contents mirror the game's
// 3DDATA tree (e.g. mods/Foo/EFFECT/x.dds → <gameDir>/3DDATA/EFFECT/x.dds).
// The client reads loose 3DDATA files as overrides over rose.vfs, so originals
// are never touched: enable = copy the tree in, disable = delete it. If a loose
// file already exists at a target (manual install, another mod), it's kept as
// <file>.roselite-bak and restored on disable.
// ponytail: enabled-state = "every target file matches the mod's copy" — no
// registry to drift, and a pre-existing loose file doesn't read as enabled.
const fs = require('fs');
const path = require('path');

const MODS_DIR = path.join(__dirname, '../mods');   // ponytail: repo-relative; move to userData if/when the app is packaged
const BAK = '.roselite-bak';

// Where a mod file lands in the game dir. Most mods mirror the 3DDATA tree
// (folder = LUNAR/, ITEM/, EFFECT/…), so they're prefixed with 3DDATA. RLMUI
// theme mods live in a sibling tree at the game root (data/ui/…); their top
// segment names that root directly, so no prefix.
const ROOT_TREES = new Set(['data']);
const gamePath = (gameDir, f) =>
  ROOT_TREES.has(f.split(path.sep)[0].toLowerCase())
    ? path.join(gameDir, f)
    : path.join(gameDir, '3DDATA', f);

const sameFile = (a, b) => {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch { return false; }
};

// Relative paths of every file in the mod folder. README.html (in-panel guide)
// and mod.json (option manifest) live at the mod root, not in the game — never
// copied to the game dir.
// Dot-entries (.impeccable/, .DS_Store, …) are tooling litter, never game files.
const NON_GAME = new Set(['readme.html', 'mod.json']);
const modFiles = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)))
    .filter((f) => !f.split(path.sep).some((seg) => seg.startsWith('.')))
    .filter((f) => !NON_GAME.has(f.toLowerCase()) && !NON_GAME.has(path.basename(f).toLowerCase()));

// Optional mod.json: { options: [{ label, paths: ["ITEM/di68", ...] }] }.
// Each option is an independently-toggleable subset of the mod's files, shaped
// like a mod ({ dir, files }) so setEnabled/enabled logic is reused as-is.
const fwd = (p) => p.split(path.sep).join('/');
function modOptions(dir, files, gameDir) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')); }
  catch { return null; }
  if (!manifest.options) return null;
  return manifest.options.map((o) => {
    const under = files.filter((f) => o.paths.some((p) => fwd(f) === p || fwd(f).startsWith(p + '/')));
    return {
      label: o.label, dir, files: under,
      enabled: under.length > 0 && under.every((f) => sameFile(path.join(dir, f), gamePath(gameDir, f)))
    };
  });
}

function listMods(gameDir, modsDir = MODS_DIR) {
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(modsDir, d.name);
      const files = modFiles(dir);
      return {
        name: d.name, dir, files,
        options: modOptions(dir, files, gameDir),   // null unless the mod ships a mod.json
        enabled: files.length > 0 && files.every((f) => sameFile(path.join(dir, f), gamePath(gameDir, f)))
      };
    });
}

function setEnabled(gameDir, mod, on) {
  for (const f of mod.files) {
    const target = gamePath(gameDir, f);
    if (on) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // ponytail: a half-enabled mod re-enabled will back up its own copy; harmless, self-heals on next disable+enable
      if (fs.existsSync(target) && !fs.existsSync(target + BAK)) fs.renameSync(target, target + BAK);
      fs.copyFileSync(path.join(mod.dir, f), target);
    } else {
      // ponytail: empty dirs are left behind on disable; the client ignores them
      fs.rmSync(target, { force: true });
      if (fs.existsSync(target + BAK)) fs.renameSync(target + BAK, target);
    }
  }
}

module.exports = { listMods, setEnabled };

// Self-check: round-trip a fake mod through a sandbox game dir. `node overlay/mods.js`
if (require.main === module) {
  const os = require('os');
  const assert = require('assert');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roselite-mods-'));
  const game = path.join(root, 'game'), mods = path.join(root, 'mods');
  fs.mkdirSync(path.join(game, '3DDATA', 'EFFECT'), { recursive: true });
  fs.mkdirSync(path.join(mods, 'TestMod', 'EFFECT'), { recursive: true });
  fs.writeFileSync(path.join(mods, 'TestMod', 'EFFECT', 'a.dds'), 'modded');
  fs.writeFileSync(path.join(mods, 'TestMod', 'README.html'), '<p>guide</p>');
  fs.mkdirSync(path.join(mods, 'TestMod', '.impeccable'));
  fs.writeFileSync(path.join(mods, 'TestMod', '.impeccable', 'hook.cache.json'), '{}');
  fs.writeFileSync(path.join(game, '3DDATA', 'EFFECT', 'a.dds'), 'loose-original');

  let [m] = listMods(game, mods);
  assert.deepStrictEqual(m.files, [path.join('EFFECT', 'a.dds')]);   // README.html + dot-entries excluded
  assert.strictEqual(m.enabled, false);
  setEnabled(game, m, true);
  assert.strictEqual(fs.readFileSync(path.join(game, '3DDATA', 'EFFECT', 'a.dds'), 'utf8'), 'modded');
  assert.strictEqual(fs.readFileSync(path.join(game, '3DDATA', 'EFFECT', 'a.dds' + BAK), 'utf8'), 'loose-original');
  assert.strictEqual(listMods(game, mods)[0].enabled, true);
  setEnabled(game, m, false);
  assert.strictEqual(fs.readFileSync(path.join(game, '3DDATA', 'EFFECT', 'a.dds'), 'utf8'), 'loose-original');
  assert.strictEqual(listMods(game, mods)[0].enabled, false);

  // Options: a mod.json splits files into independently-toggleable subsets.
  fs.mkdirSync(path.join(mods, 'Opt', 'ITEM', 'x'), { recursive: true });
  fs.mkdirSync(path.join(mods, 'Opt', 'ITEM', 'y'), { recursive: true });
  fs.writeFileSync(path.join(mods, 'Opt', 'ITEM', 'x', 'x.zms'), 'X');
  fs.writeFileSync(path.join(mods, 'Opt', 'ITEM', 'y', 'y.zms'), 'Y');
  fs.writeFileSync(path.join(mods, 'Opt', 'mod.json'),
    JSON.stringify({ options: [{ label: 'X', paths: ['ITEM/x'] }, { label: 'Y', paths: ['ITEM/y'] }] }));
  const opt = listMods(game, mods).find((o) => o.name === 'Opt');
  assert.strictEqual(opt.options.length, 2);
  assert.strictEqual(opt.options[0].enabled, false);
  setEnabled(game, opt.options[0], true);   // enable only X
  const opt2 = listMods(game, mods).find((o) => o.name === 'Opt');
  assert.strictEqual(opt2.options[0].enabled, true);
  assert.strictEqual(opt2.options[1].enabled, false);
  assert.strictEqual(fs.existsSync(path.join(game, '3DDATA', 'ITEM', 'y', 'y.zms')), false);

  // Root-tree mod: files under data/ land at the game root, not under 3DDATA.
  fs.mkdirSync(path.join(mods, 'Theme', 'data', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(mods, 'Theme', 'data', 'ui', 'skin.dds'), 'THEME');
  const theme = listMods(game, mods).find((o) => o.name === 'Theme');
  setEnabled(game, theme, true);
  assert.strictEqual(fs.readFileSync(path.join(game, 'data', 'ui', 'skin.dds'), 'utf8'), 'THEME');
  assert.strictEqual(fs.existsSync(path.join(game, '3DDATA', 'data')), false);
  assert.strictEqual(listMods(game, mods).find((o) => o.name === 'Theme').enabled, true);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('mods.js self-check OK');
}
