const { app, BrowserWindow, screen, ipcMain, net, dialog, safeStorage, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getBounds, isForeground, isMinimized = () => false } = require('./gamewindow');
const { applyAccountSet } = require('./accountstore');
const { createProgressStore } = require('./progressstore');
const { startAppUpdater } = require('./appupdater');
const config = require('../config.json');

// Packaged builds get name+icon from electron-builder (productName / build/icon.*).
// In dev, `electron .` would otherwise show "Electron" + the Electron logo in the
// dock/taskbar. Must run before whenReady — it also moves userData to .../RoseLite.
app.setName('RoseLite');
const APP_ICON = path.join(__dirname, '..', 'build', 'icon.png');

let overlay;
let toastWin;    // transparent click-through toast layer, glued to the game window's top-center
let mode = null;   // 'launcher' | 'standalone' (fullscreen, no game) | 'game'
let gameDir = config.gameDir;   // overridable from the renderer's folder picker ('game-dir')
// The client/updater binaries drop the .exe off Windows (the mac dev client ships
// plain `trose`). ponytail: two names, no per-platform config knob.
const EXE = process.platform === 'win32' ? '.exe' : '';
const gameExe = () => path.join(gameDir || '', 'trose' + EXE);
let updaterBusy = false;        // an update/repair run is in flight (dedupe + block launch)
let lastUpdateEvent = null;     // last event sent to the renderer, re-sent after a reload
let pendingLaunch = null;       // email queued to launch once an in-flight check finishes
let progressStore;
let progressCheckpoint = null;
let stopAppUpdater = () => {};

// Account passwords live in the main process only — encrypted at rest with the
// OS keychain (safeStorage: Keychain on macOS, DPAPI on Windows) and never sent
// to the renderer. The renderer holds only the email list; on launch, main looks
// up + decrypts the password itself. File: { email: base64(ciphertext) }.
// ponytail: one JSON file, no DB. If the OS keychain is unavailable (headless
// Linux, no keyring) we skip storage and launch email-only — same as before.
const pwFile = () => path.join(app.getPath('userData'), 'accounts.dat');
const loadPw = () => { try { return JSON.parse(fs.readFileSync(pwFile(), 'utf8')); } catch { return {}; } };
const savePw = (o) => { try { fs.writeFileSync(pwFile(), JSON.stringify(o)); } catch (e) { console.error('[accounts] save failed:', e.message); } };

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    icon: APP_ICON,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      // ponytail: nodeIntegration on — overlay loads only local files and local
      // plugins, no remote content ever. Revisit if plugins get a marketplace.
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  // 'screen-saver' level keeps us above a borderless-fullscreen game.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // Click-through by default; forward:true still delivers mousemove to the
  // page so widgets can detect hover and ask to become interactive.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  // The renderer is local, but it renders remote feed URLs. It must never
  // navigate away from the trusted file:// shell or create a remote window.
  overlay.webContents.on('will-navigate', (event) => event.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.loadFile(path.join(__dirname, '../overlay/index.html'));

  // The "white bar" bug: when the focused overlay is deactivated (click panel →
  // click back into the game), DefWindowProc's WM_NCACTIVATE(FALSE) handling
  // paints a classic ghost caption (white title bar) into the frameless
  // window's DWM surface, and it sticks — page repaints don't clear it, only a
  // fresh hide→show composite does (same trick as the launcher→game attach in
  // track(); it's also why alt-tab never shows it). Recomposite shortly AFTER
  // the paint moment — delayed, because the deactivation click races both the
  // paint and the foreground switch; checked at fire time. Rail mode only:
  // that's where the bar shows up, and the cycle feels weird on the big panel.
  const recomposite = () => {
    if (placement !== 'rail' || !overlay.isVisible()) return;
    if (!isForeground(config.windowTitle)) return;   // focus left for another app → track() hides us anyway
    overlay.hide();
    overlay.showInactive();
    // hide/show drops the forwarded-mousemove flag on Windows, which is what lets
    // a click-through rail detect hover and ask to become interactive — without it
    // the rail goes dead and the panel can't be reopened. Re-assert it.
    overlay.setIgnoreMouseEvents(true, { forward: true });
  };
  const clearGhostCaption = () => setTimeout(recomposite, 5);
  if (process.platform === 'win32') {
    // WM_NCACTIVATE (0x0086), wParam FALSE = deactivating — the exact message
    // whose default handling paints the ghost caption. Catches deactivations
    // that never produce an Electron blur event.
    overlay.hookWindowMessage(0x0086, (wParam) => {
      const active = Buffer.isBuffer(wParam) ? wParam.readUInt32LE(0) : Number(wParam);
      if (!active) clearGhostCaption();
    });
  }
  overlay.on('blur', () => {
    if (mode !== 'game' || userLayout === 'full') return;
    // Drop hover-interactivity: the click-away means the mouse is in the game
    // now, and the collapse snap can swallow the mouseleave that resets it.
    overlay.setIgnoreMouseEvents(true, { forward: true });
    clearGhostCaption();
  });

  ipcMain.on('interactive', (_e, on) => {
    // launcher + fullscreen are fully interactive windows; the hover click-through
    // toggle is only for the overlay layouts (docked / on-top / rail).
    if (mode === 'launcher' || userLayout === 'full') return;
    overlay.setIgnoreMouseEvents(!on, { forward: true });
  });
  // Notifications drop down over the game, not inside the panel (which docks
  // outside the game window). If the toast layer isn't up — launcher, or the
  // player alt-tabbed away — fall back to a toast in the panel itself.
  ipcMain.on('toast', (e, t) => {
    if (toastWin && !toastWin.isDestroyed() && toastWin.isVisible()) toastWin.webContents.send('toast', t);
    else e.sender.send('toast-panel', t);
  });
  ipcMain.on('quit', () => app.quit());
  // Minimize to the taskbar — only meaningful for the launcher / fullscreen
  // standalone window (the overlay layouts skip the taskbar and can't restore).
  ipcMain.on('minimize', () => overlay.minimize());
  // Double-click the fullscreen header to fill the work area / restore (mac zooms
  // on title double-click natively; a transparent frameless window can't use
  // native maximize on Windows, so drive the bounds ourselves like the grips do).
  let preMaxBounds = null;
  ipcMain.on('toggle-maximize', () => {
    if (userLayout !== 'full') return;
    const work = screen.getDisplayMatching(overlay.getBounds()).workArea;
    if (preMaxBounds) { overlay.setBounds(preMaxBounds); preMaxBounds = null; }
    else { preMaxBounds = overlay.getBounds(); overlay.setBounds({ x: work.x, y: work.y, width: work.width, height: work.height }); }
  });
  // In-panel layout override: 'rail' (icon column), 'panel' (docked/on-top panel),
  // 'full' (standalone window), or null = auto. Re-lay-out immediately.
  ipcMain.on('set-layout', (_e, l) => { userLayout = ['rail', 'panel', 'full'].includes(l) ? l : null; track(); });
  // Edge-drag resize for the launcher / fullscreen window. A transparent
  // frameless window can't be resized by the native border on Windows, so the
  // renderer's edge grips drive it: 'resize-start' captures the window rect and
  // the mouse's screen position, each 'resize-move' recomputes bounds from the
  // absolute delta (screenX/Y are CSS px = DIP, same space as setBounds).
  let resizeDrag = null;
  ipcMain.on('resize-start', (_e, { edges, x, y } = {}) => {
    if (mode !== 'launcher' && userLayout !== 'full') return;   // overlay layouts stay fixed
    resizeDrag = { edges: edges || [], x, y, start: overlay.getBounds() };
  });
  ipcMain.on('resize-move', (_e, { x, y } = {}) => {
    if (!resizeDrag) return;
    const MINW = 480, MINH = 360;
    const dx = x - resizeDrag.x, dy = y - resizeDrag.y;
    let { x: bx, y: by, width: bw, height: bh } = resizeDrag.start;
    const e = resizeDrag.edges;
    if (e.includes('right')) bw = Math.max(MINW, bw + dx);
    if (e.includes('bottom')) bh = Math.max(MINH, bh + dy);
    if (e.includes('left')) { const nw = Math.max(MINW, bw - dx); bx += bw - nw; bw = nw; }
    if (e.includes('top')) { const nh = Math.max(MINH, bh - dy); by += bh - nh; bh = nh; }
    overlay.setBounds({ x: Math.round(bx), y: Math.round(by), width: Math.round(bw), height: Math.round(bh) });
  });
  ipcMain.on('resize-end', () => { resizeDrag = null; });

  // Launch ROSE for a saved account (from the home launcher). Args are passed as
  // an array (no shell), so the email can't inject. The game window appears a few
  // seconds later and track() flips to the docked panel automatically.
  ipcMain.on('launch', (_e, email) => {
    if (!email || typeof email !== 'string') return;
    // Mirror the official updater: verify/repair files before launching. If a
    // check is running, or trose.exe is missing, queue the launch and fire it
    // when the check finishes — never spawn into a missing/half-patched game.
    if (updaterBusy || !fs.existsSync(gameExe())) {
      pendingLaunch = email;
      runGameUpdate(false);   // no-op if already running (updaterBusy dedupes)
      return;
    }
    doLaunch(email);
  });

  // Store / update an account's password (encrypted, main-process only). A blank
  // password keeps the existing one (the edit form shows an empty field and never
  // the real secret, so blank = "unchanged"). `oldEmail` renames: the entry moves,
  // carrying its ciphertext when the password itself isn't changed.
  ipcMain.on('account-set', (_e, msg = {}) => {
    if (msg.password && !safeStorage.isEncryptionAvailable()) msg = { ...msg, password: '' };   // no keychain → don't store plaintext
    savePw(applyAccountSet(loadPw(), msg, (p) => safeStorage.encryptString(p).toString('base64')));
  });
  ipcMain.on('account-remove', (_e, email) => {
    if (!email || typeof email !== 'string') return;
    const store = loadPw();
    delete store[email];
    savePw(store);
  });

  // On first paint, tell the renderer which mode to show (track() may have fired
  // before the page finished loading, so that message could have been dropped).
  // Also re-send the current placement: it's main-process state that outlives a
  // renderer reload (account switch reloads the page), but track() short-circuits
  // on an unchanged placement so the fresh DOM would otherwise never learn it's
  // fullscreen — leaving side-panel layout in a fullscreen-sized window.
  overlay.webContents.on('did-finish-load', () => {
    overlay.webContents.send('mode', mode || 'launcher');
    if (placement) overlay.webContents.send('placement', placement);
    // The launcher reloads to re-namespace per-account stores; re-send the last
    // update event so a reload mid-update doesn't lose the Play-button gate.
    if (lastUpdateEvent) overlay.webContents.send('update-progress', lastUpdateEvent);
  });

  // Update / repair triggers from the launcher. 'update-run' starts a headless
  // updater pass (verify=true → full repair); 'update-gui' is the fallback for an
  // old updater that can't run headless — just launch its own window.
  ipcMain.on('update-run', (_e, verify) => runGameUpdate(!!verify));
  ipcMain.on('update-gui', () => {
    const exe = path.join(gameDir || '', 'rose-updater' + EXE);
    try { spawn(exe, [], { cwd: gameDir, detached: true, stdio: 'ignore' }).unref(); }
    catch (e) { console.error('[updater] gui launch failed:', e.message); }
  });
  // Live panel width from the Settings slider (persisted renderer-side, re-sent
  // on boot). Next track() tick re-docks at the new width.
  ipcMain.on('panel-width', (_e, w) => {
    const n = +w;
    if (Number.isFinite(n) && n >= 120 && n <= 800) panelWidth = n;
  });

  // Folder pickers (Settings / launcher). 'pick-dir' opens the native directory
  // dialog; 'game-dir' carries the chosen game install so launch() uses it (the
  // renderer persists both to localStorage and re-sends game-dir on boot).
  ipcMain.handle('pick-dir', async () => {
    const r = await dialog.showOpenDialog(overlay, { properties: ['openDirectory'] });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.on('game-dir', (_e, p) => { if (typeof p === 'string' && p) gameDir = p; });

  // Local-first progress store. The renderer holds canonical localStorage
  // state and sends an allowlisted flat snapshot here on every boot, because
  // Chromium localStorage is not readable from the main process. Passwords
  // remain in accounts.dat and never enter this store.
  ipcMain.on('progress-snapshot', (e) => { e.returnValue = progressStore.snapshot(); });
  ipcMain.handle('progress-sync-local', (_e, payload) => {
    const snapshot = progressStore.ingestLocal(payload);
    if (mode === 'game') {
      progressStore.startPlaySession();
      clearInterval(progressCheckpoint);
      progressCheckpoint = setInterval(() => progressStore.checkpointPlaySession(), 60000);
    }
    progressStore.flush();
    return snapshot;
  });

  // RoseUtil market API. Fetched here in main (not the file:// renderer) so it
  // dodges CORS. Auth is a static Bearer token (config.roseutilsToken), which
  // replaced the old Discord-OAuth session cookie — no login window needed.
  // roseutilsBase is overridable so the API owner can drop a shared cache/proxy
  // in front later (see the cross-user note below) without a client change.
  const ROSE_BASE = config.roseutilsBase || 'https://roseutils.com';
  const rawGet = (path) => new Promise((resolve) => {
    const maxBytes = 8 * 1024 * 1024;
    let req, timer, settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    try { req = net.request(`${ROSE_BASE}${path}`); }
    catch { finish({ ok: false, status: 0, data: null }); return; }
    req.setHeader('Accept', 'application/json');
    if (config.roseutilsToken) req.setHeader('Authorization', `Bearer ${config.roseutilsToken}`);
    // Chromium's ClientRequest has no default deadline. Without one, a half-open
    // connection leaves the Market section breathing forever and pins `inflight`.
    timer = setTimeout(() => { try { req.abort(); } catch {} finish({ ok: false, status: 0, data: null }); }, 15000);
    req.on('response', (res) => {
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        try { req.abort(); } catch {}
        finish({ ok: false, status: res.statusCode || 0, data: null });
        return;
      }
      let body = '';
      let bytes = 0;
      res.on('data', (c) => {
        bytes += Buffer.byteLength(c);
        if (bytes > maxBytes) {
          try { req.abort(); } catch {}
          finish({ ok: false, status: res.statusCode || 0, data: null });
          return;
        }
        body += c;
      });
      res.on('error', () => finish({ ok: false, status: res.statusCode || 0, data: null }));
      res.on('end', () => {
        let data = null; try { data = JSON.parse(body); } catch { /* non-JSON error page */ }
        finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
      });
    });
    req.on('error', () => finish({ ok: false, status: 0, data: null }));
    req.end();
  });
  // Be a good citizen to the API owner: cache every GET + coalesce concurrent
  // duplicates. main is the single choke point — the overlay's item pages, the
  // Market section and every plugin route through the IPC handlers below, so one
  // cache here throttles a user's whole session. Market data is ~daily-granular,
  // so multi-minute TTLs are safe; failures get a short negative TTL so a blip
  // recovers without hammering. ponytail: a Map, no LRU — the key space is small
  // (one snapshot route + one history/quantity route per viewed item).
  //   NOTE: this de-spams ONE user. 1000 users = 1000 separate app processes, so
  //   the only way to spare the API owner at scale is a shared cache/proxy in
  //   front of roseutils (set config.roseutilsBase to it) — a server change, not
  //   something a client can do alone.
  const cache = new Map();          // path -> { at, ttl, value }
  const inflight = new Map();       // path -> in-flight Promise (dedup)
  const DEFAULT_TTL = 10 * 60 * 1000;
  const NEG_TTL = 30 * 1000;        // don't re-hit a failing endpoint for 30s
  const roseGet = (path, ttl = DEFAULT_TTL) => {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
    if (inflight.has(path)) return inflight.get(path);   // coalesce a stampede into one request
    const p = rawGet(path).then((r) => {
      inflight.delete(path);
      cache.set(path, { at: Date.now(), ttl: r.ok ? ttl : NEG_TTL, value: r });
      return r;
    });
    inflight.set(path, p);
    return p;
  };
  // {type}/{id} routes validate their two numeric args; return status 0 on bad input.
  const itemRoute = (suffix, ttl) => (_e, type, num) => {
    const t = parseInt(type, 10), n = parseInt(num, 10);
    if (!Number.isFinite(t) || !Number.isFinite(n)) return Promise.resolve({ ok: false, status: 0, data: null });
    return roseGet(`/api/market/prices/${t}/${n}/${suffix}`, ttl);
  };

  // Kept as 'market' so existing callers (overlay, loot-tracker) need no change.
  // History/quantity are daily series → 30-min cache; the snapshot 10 min; the
  // date list changes at most daily → 1 h.
  ipcMain.handle('market', itemRoute('history?is_selling=1', 30 * 60 * 1000));
  ipcMain.handle('market-quantity', itemRoute('quantity-history', 30 * 60 * 1000));
  // per_page unbounded: the whole market snapshot (~3.2k items) in one page — the
  // Market section prices its board/trending/watchlist off this single fetch.
  ipcMain.handle('market-prices', () => roseGet('/api/market/prices?per_page=10000', 10 * 60 * 1000));
  ipcMain.handle('market-dates', () => roseGet('/api/market/available-dates', 60 * 60 * 1000));

  // Home news feed: YouTube uploads via public RSS (config.youtubeChannels).
  // Cached in feeds.js; degrades to [] offline so the feed stays local-only.
  ipcMain.handle('feed-youtube', () => require('./feeds').fetchYouTube(config.youtubeChannels));
  ipcMain.handle('feed-patchnote', () => require('./feeds').fetchPatchNote());

  // Optional local data source: src/livesource.js is not part of the repo. When
  // it's there it streams frames over IPC to the overlay, where the api dispatches
  // them to subscribed plugins; when it isn't, the live-fed sections render a
  // notice instead (the overlay asks via sendSync 'is-live', resolved before first
  // paint). The producer behind it is swappable — plugins never see it.
  // ROSELITE_NOLIVE=1 forces it off so the shipped look can be previewed in dev.
  let live = null;
  try { live = require('./livesource'); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('[live]', e.message); }
  const LIVE = !!live && !process.env.ROSELITE_NOLIVE;
  ipcMain.on('is-live', (e) => { e.returnValue = LIVE; });
  if (LIVE) live.start((f) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('gamedata', f);
  });

  setInterval(track, config.pollMs || 250);
}

// The toast layer: a transparent, click-through window over the game's top-center.
// Never focusable, never interactive — a toast must not be able to eat a game click.
const TOAST_W = 340, TOAST_H = 260;
function createToastWin() {
  toastWin = new BrowserWindow({
    show: false, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.setIgnoreMouseEvents(true);
  joinAllSpaces(toastWin, true);   // toasts follow the game onto its fullscreen Space
  toastWin.loadFile(path.join(__dirname, '../overlay/toast.html'));
}

// Glue the toast layer to the top-center of the game window (called every tick,
// after the game rect is in DIPs). Hidden whenever the panel itself is hidden.
function placeToasts(g) {
  if (!toastWin || toastWin.isDestroyed()) return;
  if (!g) { if (toastWin.isVisible()) toastWin.hide(); return; }
  const b = { x: Math.round(g.x + (g.width - TOAST_W) / 2), y: g.y + 12, width: TOAST_W, height: TOAST_H };
  const cur = toastWin.getBounds();
  if (cur.x !== b.x || cur.y !== b.y) toastWin.setBounds(b);
  if (!toastWin.isVisible()) toastWin.showInactive();
  toastWin.setAlwaysOnTop(false);              // same z-order re-insert trick as raiseOverlay()
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.moveTop();
}

// RuneLite-style docked side panel. Width is live-adjustable (Settings slider → 'panel-width').
let panelWidth = config.panelWidth || 260;
const RAIL_W = 52;        // collapsed icon-rail width (the visible icon column)
const RAIL_TIP_W = 150;   // transparent, click-through gutter left of the rail for hover tooltips
// Layout override from the in-panel toggle: null = auto (rail when the panel
// can't dock exterior, full panel when it can); 'rail'|'panel'|'full' force it.
let userLayout = process.env.ROSELITE_LAYOUT || null;   // QA hook: boot straight into 'rail'|'panel'|'full'
let placement = null;     // 'docked' | 'rail' | 'ontop' | 'full' — last value sent to the renderer
function setPlacement(p) {
  if (p === placement) return;
  placement = p;
  overlay.webContents.send('placement', p);
}

// Force the overlay above the game window. moveTop alone loses to a game that
// muscled into the topmost band during its startup; dropping out of always-on-top
// and jumping back in re-inserts us at the top of that band (the standard Win32
// z-order trick). Only ever called while the game is the foreground app.
function raiseOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setAlwaysOnTop(false);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.moveTop();
}

// macOS puts a natively-fullscreened game on its own Space, and a normal window
// stays behind on the desktop Space — always-on-top or not, it simply never draws
// over the game. Join every Space (fullscreen ones included) while we're the
// overlay layer, and drop back to a single-Space window for launcher/fullscreen.
// skipTransformProcessType keeps us out of the UIElement/Foreground churn that
// otherwise blinks the app out of the Dock on every transition.
const joinAllSpaces = (win, on) => {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return;
  win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on, skipTransformProcessType: true });
};

// Overlay-layer window flags (click-through, above fullscreen game, off-taskbar)
// vs. a normal focusable standalone window used by fullscreen mode.
function overlayFlags(full) {
  joinAllSpaces(overlay, !full);
  if (full) {
    overlay.setIgnoreMouseEvents(false);
    overlay.setAlwaysOnTop(false);
    overlay.setSkipTaskbar(false);
    overlay.setResizable(true);
  } else {
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setSkipTaskbar(true);
    overlay.setResizable(false);
  }
}

// Default fullscreen/standalone window: centred, most of the work area.
function centeredFullBounds(work) {
  const w = Math.min(1500, Math.round(work.width * 0.94));
  const h = Math.min(940, Math.round(work.height * 0.94));
  return { x: Math.round(work.x + (work.width - w) / 2), y: Math.round(work.y + (work.height - h) / 2), width: w, height: h };
}

// Snap the window bounds in one move; the renderer animates the surface swap
// in CSS (index.html `.pop`). Tweening the bounds here (the old approach) did
// a native resize of the transparent layered window + a full panel relayout
// every 16ms step — that's the stutter, and no interval tuning fixes it. One
// snap plus a compositor-driven fade/slide is smooth by construction.
function setBoundsSnapped(target) {
  const from = overlay.getBounds();
  overlay.setBounds(target);
  // Windows keeps the transparent window's old (larger) DWM layered bitmap
  // after a shrink, so a leftover strip of it gets composited over the game
  // on the next redraw (the white bar after a collapse). Force a full repaint
  // so DWM replaces the stale surface with the new, smaller one.
  if (process.platform === 'win32' && (target.width < from.width || target.height < from.height))
    overlay.webContents.invalidate();
}

// Spawn trose.exe for an account. Split out of the 'launch' IPC so a queued
// launch (deferred behind a file check) can reuse the exact same path.
function doLaunch(email) {
  const exe = gameExe();
  const server = config.loginServer || 'connect.roseonlinegame.com';
  const args = ['--login', '--server', server, '--username', email];
  // Append the stored password if we have one (decrypted here, in main only).
  try {
    const enc = loadPw()[email];
    if (enc && safeStorage.isEncryptionAvailable())
      args.push('--password', safeStorage.decryptString(Buffer.from(enc, 'base64')));
  } catch (e) { console.error('[accounts] decrypt failed:', e.message); }
  try {
    const child = spawn(exe, args, { cwd: gameDir, detached: true, stdio: 'ignore' });
    child.on('error', (err) => overlay && !overlay.isDestroyed() && overlay.webContents.send('launch-error', err.message));
    child.unref();
  } catch (err) {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('launch-error', err.message);
  }
}

function sendUpdate(evt) {
  lastUpdateEvent = evt;
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('update-progress', evt);
}

// Fire a launch that was queued behind a file check — or tell the launcher why
// it can't, so a missing/wrong gameDir shows an error instead of nothing.
function drainPendingLaunch(ok) {
  if (!pendingLaunch) return;
  const email = pendingLaunch; pendingLaunch = null;
  if (!fs.existsSync(gameExe())) {
    if (overlay && !overlay.isDestroyed())
      overlay.webContents.send('launch-error', `trose${EXE} not found in ${gameDir || '(no folder set)'}`);
  } else if (ok) doLaunch(email);
}

// Run the official updater headlessly and stream its progress to the launcher.
// win32 only — on the dev mac there's no updater, so we report 'missing' and the
// renderer just keeps Play enabled (unless ROSELITE_FAKEUPDATE fakes a run).
// updaterBusy dedupes: a re-check on every launcher return is a cheap no-op.
function runGameUpdate(verify = false) {
  if (updaterBusy) return;
  if (process.platform !== 'win32' && !process.env.ROSELITE_FAKEUPDATE) {
    // No updater off Windows: there's no check to wait for, so a queued launch
    // must fire (or report) right here — otherwise Play silently does nothing.
    drainPendingLaunch(true);
    return sendUpdate({ event: 'missing' });
  }
  updaterBusy = true;
  sendUpdate({ event: 'start' });   // gate Play in the renderer *now*, before the first child frame
  require('./updater').runUpdater({ gameDir, verify, url: config.updaterUrl }, (evt) => {
    if (['done', 'error', 'unsupported', 'missing'].includes(evt.event)) {
      updaterBusy = false;
      // A launch waiting on this check fires only when the check *passed* —
      // or when no check is possible (no updater / no headless support), which
      // is pre-updater behavior. A failed check drops the queued launch: the
      // update pass deletes changed XML files before re-downloading them, so a
      // half-run install boots into XML errors. The renderer shows the error +
      // Retry; clicking Play again (updater now idle) launches anyway — the
      // player's explicit call, not ours.
      drainPendingLaunch(evt.event !== 'error');
    }
    sendUpdate(evt);
  });
}

function endGameSession(reason = 'game-closed') {
  if (mode !== 'game' || !progressStore) return;
  clearInterval(progressCheckpoint);
  progressCheckpoint = null;
  progressStore.endPlaySession(reason);
  progressStore.flush();
}

// No game running → show the centered account launcher (add accounts, pick one,
// launch the game). Sized to the launcher card and made click-interactive.
function showLauncher() {
  placeToasts(null);   // no game window → no toast layer; toasts fall back into the panel
  if (mode !== 'launcher') {
    endGameSession();
    mode = 'launcher';
    setPlacement(null);   // renderer must forget stale fullscreen state before the next launcher open
    overlay.setIgnoreMouseEvents(false);
    // No game running → behave like a normal app window: drop out of the
    // always-on-top overlay layer and show in the taskbar so it can be minimized.
    overlay.setAlwaysOnTop(false);
    overlay.setSkipTaskbar(false);
    joinAllSpaces(overlay, false);
    const wa = screen.getPrimaryDisplay().workArea;
    const w = 1040, h = 620;
    overlay.setBounds({ x: Math.round(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + (wa.height - h) / 2), width: w, height: h });
    overlay.webContents.send('mode', 'launcher');
    // The update check is NOT triggered here: at boot this fires before the
    // renderer has pushed the persisted gameDir ('game-dir' IPC), so the check
    // would run against an empty folder and silently no-op. The renderer
    // requests it ('update-run') on entering launcher mode instead — renderer
    // IPC is ordered, so game-dir always lands first.
  }
  // Don't fight a user-minimized launcher (isVisible() is false while minimized).
  if (!overlay.isVisible() && !overlay.isMinimized()) overlay.show();
}

// Fullscreen tools remain usable when ROSE is closed. This is still a normal,
// focusable standalone window, but renderer mode stays distinct from `game` so
// playtime and Collection Zuly pause until game-window detection resumes.
function showStandalone() {
  placeToasts(null);
  endGameSession();
  const entering = mode !== 'standalone';
  mode = 'standalone';
  if (entering) overlay.webContents.send('mode', 'standalone');
  if (placement !== 'full') {
    overlayFlags(true);
    overlay.setBounds(centeredFullBounds(screen.getPrimaryDisplay().workArea));
    setPlacement('full');
  }
  if (overlay.isMinimized()) overlay.restore();
  if (!overlay.isVisible()) overlay.show();
}

function track() {
  // The poll interval outlives the window during quit — bail before touching a
  // destroyed overlay (was the "Object has been destroyed" crash on close).
  if (!overlay || overlay.isDestroyed()) return;
  let g = getBounds(config.windowTitle);
  if (!g) {
    // Minimized ≠ closed: the game is still running, so don't round-trip
    // through the launcher (that reflag/resize left the rail stale on
    // restore). Hide like the alt-tab path and wait for the window back.
    if (mode === 'game' && userLayout !== 'full' && isMinimized(config.windowTitle)) {
      placeToasts(null);
      if (overlay.isVisible()) overlay.hide();
      return;
    }
    return userLayout === 'full' ? showStandalone() : showLauncher();
  }
  // Win32 gives physical pixels; Electron positions in DIPs.
  if (process.platform === 'win32') g = screen.screenToDipRect(overlay, g);
  // A bogus window rect (fullscreen/DPI transition) can make the DIP convert
  // yield nothing; skip this tick rather than crash the main process.
  if (!g) return;
  const entering = mode !== 'game';
  if (entering) {   // leaving the launcher → back into the game overlay
    mode = 'game';
    if (progressStore) {
      progressStore.startPlaySession();
      clearInterval(progressCheckpoint);
      progressCheckpoint = setInterval(() => progressStore.checkpointPlaySession(), 60000);
    }
    if (overlay.isMinimized()) overlay.restore();
    overlay.webContents.send('mode', 'game');
    // The game keeps re-asserting foreground/topmost for a second or two after
    // its window first appears, so a single raise on this tick loses. Re-raise
    // on a short schedule, guarded so we only fire while it's still foreground.
    [300, 900, 1800, 3000].forEach((ms) => setTimeout(() => {
      if (mode === 'game' && userLayout !== 'full' && isForeground(config.windowTitle)) raiseOverlay();
    }, ms));
  }
  const work = screen.getDisplayMatching(g).workArea;
  // Toast layer: only while ROSE is the foreground app (same rule as the overlay —
  // an always-on-top toast must not float over whatever the player switched to).
  const fg = isForeground(config.windowTitle);
  placeToasts(fg ? g : null);

  // Fullscreen: a centred, focusable, taskbar-visible standalone window. Positioned
  // once on entry (then user-resizable); later ticks just keep it shown.
  if (userLayout === 'full') {
    if (placement !== 'full') {
      overlayFlags(true);
      overlay.setBounds(centeredFullBounds(work));
      setPlacement('full');
    }
    // Don't fight a user-minimized window (isVisible() is false while minimized).
    if (entering || (!overlay.isVisible() && !overlay.isMinimized())) overlay.show();
    return;
  }

  // On top of ROSE only: when the player switches to another app, get out of its
  // way (setAlwaysOnTop 'screen-saver' would otherwise float above everything).
  if (!fg) {
    if (overlay.isVisible()) overlay.hide();
    return;
  }

  // Overlay layouts (docked / on-top / rail): re-enter the click-through overlay
  // layer when arriving from the launcher (placement null) or from fullscreen.
  if (placement === null || placement === 'full') overlayFlags(false);
  // Dock a fixed-width panel to the exterior right edge of the game window.
  const exteriorX = g.x + g.width;
  const fits = exteriorX + panelWidth <= work.x + work.width;
  // Auto default: rail when the panel can't dock exterior, full panel when it can.
  // The in-panel toggle (userLayout 'rail'/'panel') overrides in either direction.
  const collapsed = userLayout === 'rail' ? true : userLayout === 'panel' ? false : !fits;
  let b;
  if (collapsed) {
    // Collapsed icon rail on the game's right edge, in the middle 30% band so it
    // clears the game's own HUD (minimap top, skill/chat bottom). An icon expands.
    const h = Math.round(g.height * 0.30);
    // Sit the rail just inside the visible right edge — whichever comes first, the
    // game's edge or the monitor's. The 10px margin clears Windows' invisible
    // resize-border frame (GetWindowRect overshoots the visible edge by ~7px),
    // which otherwise pushes the rail a hair too far right on a windowed client.
    const railRight = Math.min(exteriorX, work.x + work.width) - 10;
    // Window spans the tooltip gutter + the icon column; the icons stay pinned to
    // the right edge (CSS anchors #rail right), the gutter is transparent/click-through.
    b = { x: railRight - RAIL_W - RAIL_TIP_W, y: Math.round(g.y + g.height * 0.35) - 15, width: RAIL_W + RAIL_TIP_W, height: h };
    setPlacement('rail');
  } else {
    // Docked exterior, or (on-top) the expanded panel tucked inside the right edge.
    const x = fits ? exteriorX : exteriorX - panelWidth;
    // ponytail: the window rect overshoots the visible bottom edge by a couple px
    // (same invisible resize-border the rail trims on the right). Bump if it still
    // peeks under the game — pure display calibration, no logic depends on it.
    // Bottom also clamps to the work area so the panel never covers the taskbar.
    const bottom = Math.min(g.y + g.height, work.y + work.height);
    b = { x, y: g.y, width: panelWidth, height: bottom - g.y - 2 };
    setPlacement(fits ? 'docked' : 'ontop');
  }
  const cur = overlay.getBounds();
  if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) {
    setBoundsSnapped(b);
  }
  // On the launcher→game transition the window is a normal, visible launcher
  // window that we just reflagged into a transparent topmost overlay. On
  // Windows that transparent layered surface stays stale — it neither
  // repaints over the game nor restacks — until a full hide→show cycle forces
  // DWM to recomposite it. That's exactly what the manual minimize/restore
  // does (SW_RESTORE); do it ourselves here so the overlay attaches on first
  // launch. showInactive keeps focus on the game.
  if (entering && overlay.isVisible()) overlay.hide();
  if (entering || !overlay.isVisible()) overlay.showInactive();
  // Keep us above the game on every tick (it re-asserts topmost during load
  // and on alt-tab back). We only get here while the game is foreground, so
  // this can't yank the overlay over another app. Click-through, so invisible.
  raiseOverlay();
}

app.whenReady().then(() => {
  progressStore = createProgressStore({ file: path.join(app.getPath('userData'), 'progress-v2.json') });
  progressStore.load();
  progressStore.flush();
  // macOS dev only: the dock icon comes from the .icns in a packaged .app.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock.setIcon(APP_ICON);
  createOverlay(); createToastWin();
  stopAppUpdater = startAppUpdater({ app, dialog, getWindow: () => overlay });
});
app.on('before-quit', () => {
  stopAppUpdater();
  clearInterval(progressCheckpoint);
  if (progressStore) {
    progressStore.endPlaySession('app-quit');
    progressStore.flush();
  }
});
app.on('window-all-closed', () => app.quit());
