// Build config. Conditional, so it can't live as static JSON in package.json's
// "build" field: a machine with a local data source (src/livesource.js, not part
// of the repo) also bundles its native/ helpers, everything else ships the
// overlay alone with the live sections disabled.
const fs = require('fs'), nodePath = require('path');
const local = fs.existsSync(nodePath.join(__dirname, 'src', 'livesource.js'));
// Tag CI publishes immediately; a local `npm run release` defaults to a draft
// so an accidental manual invocation cannot ship before it has been reviewed.
const releaseType = process.env.ROSELITE_RELEASE_TYPE === 'release' ? 'release' : 'draft';

module.exports = {
  appId: 'org.roselite.app',
  productName: 'RoseLite',
  // electron-updater reads this provider from resources/app-update.yml. A
  // published GitHub release must include the installer, blockmap and latest.yml.
  publish: [{ provider: 'github', owner: 'DrezByte', repo: 'RoseLite', releaseType }],
  // Everything after `**/*` is weight the runtime never loads and the player
  // downloads anyway: `_src` is the pre-cutout frame art (~7 MB), and docs/,
  // site/ and the *.test.js self-checks add more. Nothing outside a comment
  // references any of them.
  files: ['**/*', '!scripts', '!**/_src', '!docs', '!site',
    '!**/*.test.js', ...(local ? [] : ['!native'])],
  // A native helper can't run from inside app.asar — unpack it to disk so it has
  // a real path (app.asar.unpacked/native/...).
  asarUnpack: local ? ['native/**'] : [],
  // One source of truth: build/icon.png (1024², transparent). electron-builder
  // generates the .ico and .icns from it.
  win: { target: 'nsis', icon: 'build/icon.png' },
  mac: { target: 'dmg', icon: 'build/icon.png', category: 'public.app-category.games' },
  nsis: {
    // No version in the filename, so
    // github.com/DrezByte/RoseLite/releases/latest/download/RoseLite-Setup.exe is a
    // permanent URL the website can hardcode. electron-updater doesn't care either
    // way — it reads the real name out of latest.yml.
    artifactName: 'RoseLite-Setup.exe',
    oneClick: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
  },
};
