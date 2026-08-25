# RoseLite

A free, open-source companion for **ROSE Online** — a RuneLite-style overlay
that attaches itself to the game window and keeps your timers, item data and
notes one glance away.

No memory reading, no DLL injection, nothing that touches the client process:
RoseLite is a transparent, click-through, always-on-top window that finds the
game by plain window polling and follows it around.

It is also **local-only** — no account, no sign-in, no server. Everything it
tracks stays on your PC, and Settings exports it to a file you carry yourself.

## Download

Grab the latest Windows installer from
**[Releases](https://github.com/DrezByte/RoseLite/releases/latest)**, run it,
and launch RoseLite. It sits beside the game as a docked panel, folds into an
icon rail when there is no room, or runs fullscreen on a second screen.

Packaged Windows installs check for a newer RoseLite on launch and download it
in the background; you can restart right away or let it install on exit. Set
`ROSELITE_NOUPDATE=1` to skip that check.

If RoseLite does not find your game, open **Settings** and check the window
title. A game patch occasionally renames the window; the current default is
`ROSE Online (Early Access)`.

## What's in it

| | |
|---|---|
| **Rois** | Respawn tracker for 100 field bosses — tap on kill, get a countdown and a toast. Works with no game data feed at all. |
| **Objets** | The full item catalog (~15k) — stats, NPC and live market price, price sparkline, in-game chat links, pins. |
| **Marché** | A price board over the community market snapshot: sorts, trending, watchlist, 7/30/90-day charts. |
| **Quêtes** | Quest list, filters, chain view and done-toggles, with planet tags. |
| **Recettes / Gems** | Recipes by craft skill, and a gem calculator that expands a target into a flat shopping list minus what you own. |
| **Journaux** | Dungeon-run logger — paste the scoreboard, get per-dungeon best times and your DPS. |
| **Guides / Événements** | Cleaned in-panel guides and a month calendar of seasonal and weekly events. |
| **Cris** | Saved shouts, copied to the clipboard in one click. |
| **Extensions** | Mod manager for client-file mods: enable copies files in, disable restores the originals. |

Sections that need a **live game-state feed** (Personnage, Butin, DPS,
Monstres) stay disabled. RoseLite ships no data source of its own and reads
nothing out of the client; they light up on their own once a source exists.
Plugins are written against the `api` object, never against where the data came
from — so when an official client API ships, existing plugins keep working.

## Progress and backup

Shouts, quest progress, gem targets, king timers, dungeon logs, calendar notes
and your saved ROSE game accounts (nickname and icon — never the password) live
in this install. They are shared across every ROSE account you launch from it
and never leave the machine.

Two local copies exist: the renderer's `localStorage`, which is authoritative,
and a mirror in the main process (`progress-v2.json` in the app's userData
folder) that survives a wiped browser store. ROSE passwords are separate,
encrypted with the OS keychain in `accounts.dat`, and never enter either.

**Settings → Progress & backup** writes a `roselite-backup-<date>.json` and
reads one back. An import **merges** rather than replaces — pins, kills and
completed quests union, deletes carry a tombstone — so importing an older file
cannot undo newer progress.

## Run from source

1. **Install Node.js LTS** ([nodejs.org](https://nodejs.org), or `winget
   install OpenJS.NodeJS.LTS`). **Then reopen your terminal / VS Code** — a
   shell opened before the install keeps a stale PATH and won't find `node`
   (`export PATH="$PATH:/c/Program Files/nodejs"` fixes an already-open bash).
   `koffi` is a native module: install it on the machine you run on, don't copy
   `node_modules` across platforms.

2. **Set the window title.** Launch the game (windowed or borderless), then:
   ```powershell
   Get-Process trose* | Select-Object ProcessName, MainWindowTitle
   ```
   Put that `MainWindowTitle` in `config.json` (`windowTitle`). `RoseData/` is
   tracked, so item, quest, recipe and icon content works straight after
   cloning.

3. **Double-click `run.bat`** — the first run installs deps, then starts the
   overlay. (`npm install && npm start` does the same by hand.)

> Launching from an IDE-spawned shell instead of double-clicking? VS Code sets
> `ELECTRON_RUN_AS_NODE=1`, which crashes Electron with `Cannot read properties
> of undefined (reading 'whenReady')`. Clear it first: `set ELECTRON_RUN_AS_NODE=`.

**macOS** (development only): the `trose_*` client is tracked via System Events,
`windowTitle` is ignored and any GUI process named `*trose*` matches.
Double-click `run.command`, or `npm start`. On first run grant **Accessibility**
in System Settings → Privacy & Security, or it cannot read the game window.
(Linux: fixed-rect fallback, overlay UI only.)

`ROSELITE_FAKEWIN=1 npm start` fakes a game window so the panel can be worked on
with no game running, on any OS. There is no test framework — modules carry
runnable self-checks: `node overlay/data.js`, `node overlay/kings.test.js`,
`node overlay/gems-calc.test.js`, `node overlay/mods.js`, `node src/feeds.js`,
`node src/updater.js`, `node src/appupdater.js`, `node src/progressstore.test.js`,
`node src/accountstore.js`, `node site/site.test.js`. Run the ones you touched.

## Writing a plugin

Drop a file in `plugins/`:

```js
module.exports = (api) => {
  const el = api.addWidget(`<div class="widget">hello</div>`);
  api.every(1000, () => { el.textContent = new Date().toLocaleTimeString(); });
  api.on('spawn', (f) => api.notify({ title: `mob ${f.npcId} spawned`, sound: true }));
};
```

The API is deliberately tiny and grows only on need:

| method | what it does |
|---|---|
| `api.addWidget(html, slot?)` | add a widget (default slot, or `'character'`/`'butin'`), returns its element |
| `api.every(ms, fn)` | repeating tick |
| `api.on(type, cb)` | subscribe to data-source frames (`spawn`, `hp`, …) |
| `api.notify({ title, body?, tone?, sound?, onClick? })` | toast + optional named sound, logged in the header bell |
| `api.sound(name)` / `api.soundSelect(cur, onChange)` | play a named alert / build a sound-picker `<select>` |

## How attach works

`src/gamewindow.js` polls the game window's bounds every 250 ms and repositions
a transparent, frameless, focus-less Electron window over it — on Windows via
`FindWindowW` + `GetWindowRect` ([koffi](https://koffi.dev), prebuilt FFI, so
players need no build tools); on macOS via `osascript`/System Events.
`setIgnoreMouseEvents(true, { forward: true })` keeps it click-through while
still delivering hover events, so widgets can opt into interactivity.

## Releasing

`.github/workflows/release.yml` builds and publishes the Windows installer when
a `v*.*.*` tag is pushed. It checks the tag against `package.json`, verifies the
tracked `RoseData/` payload, runs every self-check, and uploads the NSIS
installer, its blockmap and `latest.yml` as a GitHub Release — which is what
installed copies read on their next launch. Never rename or omit `latest.yml`,
and never move a published tag.

```
npm version patch --no-git-tag-version
git commit -am "Release v<version>"
git tag v<version>
git push origin main v<version>
```

Optional repository secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`
sign the executable; unsigned builds work but trip Windows SmartScreen. As a
manual fallback, set `GH_TOKEN` and run `npm run release` on Windows — manual
runs produce a *draft* release for review. `npm run dist` builds locally without
publishing.

The landing page is [`site/`](site/README.md), a static Vercel deployment with
nothing behind it.

## License

[MIT](LICENSE) for RoseLite's own code. Game data in `RoseData/`, the community
mods in `mods/` and the bundled fonts belong to their authors — see
[NOTICE](NOTICE). RoseLite is unofficial and not affiliated with Rednim Games
or the ROSE Online team.
