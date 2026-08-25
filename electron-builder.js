// Build config. Production artifacts are deliberately source-independent:
// local-only live-source files and native helpers must never enter a package.
// Tag CI publishes immediately; a local `npm run release` defaults to a draft
// so an accidental manual invocation cannot ship before it has been reviewed.
const releaseType = process.env.ROSELITE_RELEASE_TYPE === 'release' ? 'release' : 'draft';

module.exports = {
  appId: 'org.roselite.app',
  productName: 'RoseLite',
  // electron-updater reads this provider from resources/app-update.yml. A
  // published GitHub release must include the installer, blockmap and latest.yml.
  publish: [{ provider: 'github', owner: 'DrezByte', repo: 'RoseLite', releaseType }],
  // Runtime allowlist: ignored developer files and local audit material must
  // never enter an installer merely because they exist in the working tree.
  // electron-builder adds production dependencies from node_modules itself.
  files: [
    'package.json', 'config.json', 'LICENSE', 'NOTICE',
    'RoseData/**/*', 'mods/**/*', 'overlay/**/*', 'plugins/**/*', 'sounds/**/*', 'src/**/*',
    '!overlay/**/*.test.js', '!src/**/*.test.js', '!overlay/**/_src{,/**/*}',
    '!src/livesource.js',
  ],
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
