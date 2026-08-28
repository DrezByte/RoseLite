// Tracks the game window's on-screen bounds.
// Win32 via koffi FFI — external polling only, nothing an anticheat cares about.

// Which client to track when several are open (multi-boxing is the norm): the
// focused one. When focus is elsewhere — another app, our own panel — stay on
// the last one tracked instead of hopping, unless it went minimized. Pure and
// handle-agnostic so the self-check at the bottom can exercise it anywhere.
function chooseClient(list, fg, last, iconic) {
  if (!list.length) return null;
  const focused = list.find((h) => h === fg);
  if (focused) return focused;
  const kept = list.find((h) => h === last);
  if (kept && !iconic(kept)) return kept;
  return list.find((h) => !iconic(h)) || kept || list[0];
}

// Win32 basics every mode below needs — the fake-window dev aid included, because
// main asks "is one of my own windows in front?" even when game tracking is faked.
const win32 = process.platform === 'win32' ? (() => {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  return { koffi, user32, GetForegroundWindow: user32.func('void* GetForegroundWindow()') };
})() : null;

// True when `buf` — a BrowserWindow.getNativeWindowHandle() — is the foreground
// window. Electron's own isFocused() goes stale on our frameless transparent
// windows (it kept reporting the launcher focused after another app took over),
// so ask the OS. Off Windows there's no overlay layer to arbitrate: always false.
module.exports.isForegroundHandle = (buf) => {
  if (!win32 || !buf || !buf.length) return false;
  const fg = win32.GetForegroundWindow();
  const h = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  return !!fg && String(win32.koffi.address(fg)) === String(h);
};

// Dev aid: ROSELITE_FAKEWIN=1 pretends a game window is on screen so the docked
// panel can be built/tested (macOS included) without launching trose. Optional
// "x,y,w,h" overrides the default rect. Skips all real tracking.
if (process.env.ROSELITE_FAKEWIN) {
  const parts = process.env.ROSELITE_FAKEWIN.split(',').map(Number);
  const rect = parts.length === 4 && parts.every(Number.isFinite)
    ? { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
    : { x: 100, y: 100, width: 1280, height: 720 };
  module.exports.getBounds = () => rect;
  module.exports.isForeground = () => true;
} else if (process.platform === 'win32') {
  const { koffi, user32, GetForegroundWindow } = win32;

  const RECT = koffi.struct('RECT', {
    left: 'long', top: 'long', right: 'long', bottom: 'long'
  });
  const FindWindowExW = user32.func('void* FindWindowExW(void* parent, void* after, str16 cls, str16 title)');
  const GetWindowRect = user32.func('bool GetWindowRect(void* hwnd, _Out_ RECT* rect)');
  const IsIconic = user32.func('bool IsIconic(void* hwnd)');
  const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)');

  // Every client shares one window title, so FindWindowW would always hand back
  // the same (arbitrary) one. FindWindowExW with parent=NULL walks top-level
  // siblings, so feeding back the previous hit enumerates them all — no
  // EnumWindows callback thunk needed. ponytail: capped at 32 clients.
  const addr = (h) => (h ? String(koffi.address(h)) : null);
  function clients(title) {
    const byAddr = new Map();
    let h = null;
    while ((h = FindWindowExW(null, h, null, title)) && byAddr.size < 32) byAddr.set(addr(h), h);
    return byAddr;
  }

  let tracked = null;   // address of the client we're currently attached to
  function pick(title) {
    const byAddr = clients(title);
    tracked = chooseClient([...byAddr.keys()], addr(GetForegroundWindow()), tracked,
      (a) => !!IsIconic(byAddr.get(a)));
    return tracked ? byAddr.get(tracked) : null;
  }

  // Returns { x, y, width, height } in physical pixels, or null if the
  // game window is closed or minimized.
  module.exports.getBounds = (title) => {
    const h = pick(title);
    if (!h || IsIconic(h)) return null;
    const r = {};
    if (!GetWindowRect(h, r)) return null;
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  };

  // True when the tracked client exists but is minimized — getBounds returns null
  // for both "closed" and "minimized", and the play session must keep running
  // while the game is merely iconic.
  module.exports.isMinimized = (title) => {
    const h = pick(title);
    return !!h && !!IsIconic(h);
  };

  const pidOf = (h) => { const p = [0]; GetWindowThreadProcessId(h, p); return p[0]; };
  // True when the foreground window is the tracked client — or one of ours (so
  // clicking the panel doesn't count as "another app"; main filters the launcher
  // window back out). Lets the overlay float above ROSE only, staying out of the
  // way of any other window the player switches to.
  module.exports.isForeground = (title) => {
    const fg = GetForegroundWindow();
    if (!fg) return false;
    if (pidOf(fg) === process.pid) return true; // our own overlay windows
    return addr(pick(title)) === addr(fg);
  };
  // ── Prototype A+B (ROSELITE_OWNERATTACH=1 in main) ────────────────────────
  // HWNDs are pointer-sized integers; shipped Electron is x64-only, so passing
  // them as uint64 dodges koffi pointer round-trips.
  const GWLP_HWNDPARENT = -8;
  const SetWindowLongPtrW = user32.func('uint64 SetWindowLongPtrW(uint64 hwnd, int idx, uint64 val)');
  const bufHwnd = (buf) => (buf && buf.length
    ? (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))) : null);

  // A: make the tracked client the OWNER of our window. Not SetParent — nothing
  // touches the client's window tree; the single write is on OUR window. The OS
  // then keeps us above the game, sinks us with it behind other apps, and hides
  // us while it's minimized — replacing the topmost band + raise dance in main.
  // Re-asserting the same owner is a harmless word-write, so callers may call
  // this every tick; returns the owner's address (string) so main can detect a
  // multi-box switch, or null when no client is tracked.
  module.exports.attachOwner = (buf) => {
    const h = bufHwnd(buf);
    if (!h || !tracked) return null;
    SetWindowLongPtrW(h, GWLP_HWNDPARENT, BigInt(tracked));
    return tracked;
  };
  // Detach before the owner window can die (game closed) or when the overlay
  // becomes a standalone window — a dangling owner is undefined-behavior land.
  module.exports.detachOwner = (buf) => {
    const h = bufHwnd(buf);
    if (h) SetWindowLongPtrW(h, GWLP_HWNDPARENT, 0n);
  };

  // B: event-driven tracking. SetWinEventHook in OUTOFCONTEXT mode (flags=0) is
  // the no-injection variant — the OS posts events to our thread and Chromium's
  // message pump delivers them; it's the same channel screen readers use.
  // onChange fires for anything that could move/hide/replace a client window;
  // main coalesces and re-runs track(). Hooks live for the process lifetime.
  const WinEventProc = koffi.proto('void WinEventProc(void* hook, uint32 event, void* hwnd, int32 obj, int32 child, uint32 tid, uint32 time)');
  const SetWinEventHook = user32.func('void* SetWinEventHook(uint32 min, uint32 max, void* mod, WinEventProc* cb, uint32 pid, uint32 tid, uint32 flags)');
  let eventCb = null;   // module-held: a GC'd registered callback = native crash
  module.exports.watchEvents = (onChange) => {
    if (eventCb) return;
    eventCb = koffi.register((_h, event, hwnd, obj) => {
      if (obj !== 0) return;   // OBJID_WINDOW only — skips cursor/caret spam
      // LOCATIONCHANGE storms during any drag; only the tracked client's counts.
      if (event === 0x800B && addr(hwnd) !== tracked) return;
      onChange(event);
    }, koffi.pointer(WinEventProc));
    // FOREGROUND · MINIMIZESTART/END · DESTROY+SHOW · LOCATIONCHANGE
    [[0x0003, 0x0003], [0x0016, 0x0017], [0x8001, 0x8002], [0x800B, 0x800B]]
      .forEach(([lo, hi]) => SetWinEventHook(lo, hi, null, eventCb, 0, 0, 0));
  };
} else if (process.platform === 'darwin') {
  // Real tracking on macOS via the Quartz window list, so the overlay can be
  // tested locally against the native trose client. CGWindowListCopyWindowInfo
  // needs NO permission for owner + bounds (only window *titles* would need
  // Screen Recording) — unlike the System Events/AppleScript scan this replaced,
  // which silently returned nothing until you granted Accessibility by hand.
  //
  // Matches any process whose name contains "trose" (trose, trose_d, trose.exe
  // under Wine, ...), so the Windows-only `windowTitle` config is ignored here.
  // Layer 0 skips the menu bar / Dock / shadow layers. Bounds are already points
  // == Electron DIPs and share Electron's top-left origin, so no convert.
  const { execFile } = require('child_process');
  const SCRIPT = `ObjC.import('CoreGraphics'); ObjC.import('Foundation');
function windows(opt) {
  return ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(opt, 0)))
    .filter(function (w) { return w.kCGWindowLayer === 0 && String(w.kCGWindowOwnerName || '').toLowerCase().indexOf('trose') >= 0; });
}
(function () {
  var on = windows(17);   // OnScreenOnly | ExcludeDesktopElements — minimized windows drop out
  if (on.length) { var b = on[0].kCGWindowBounds; return [b.X, b.Y, b.Width, b.Height].join(','); }
  return windows(0).length ? 'min' : 'null';   // still listed off-screen => minimized, not closed
})();`;
  // One osascript spawn is ~65ms; running it synchronously every pollMs starved
  // the main event loop (the "slow then freeze"). Poll async, serve the last value.
  let inflight = false, last = null, minimized = false;
  function poll() {
    if (inflight) return;
    inflight = true;
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { encoding: 'utf8' }, (e, stdout) => {
      inflight = false;
      const out = e ? 'null' : stdout.trim();
      minimized = out === 'min';
      if (out === 'min' || out === 'null') { last = null; return; }
      const [x, y, width, height] = out.split(',').map(Number);
      last = Number.isFinite(x) && width > 0 ? { x, y, width, height } : null;
    });
  }
  setInterval(poll, 500).unref();
  poll();
  module.exports.getBounds = () => last;
  module.exports.isMinimized = () => minimized;
  // ponytail: foreground gating is Windows-only (where players run); macOS is dev.
  module.exports.isForeground = () => true;
} else {
  // ponytail: Linux dev fallback — fixed rectangle so the overlay UI can be
  // built without the game. Real tracking is Windows + macOS only.
  module.exports.getBounds = () => ({ x: 100, y: 100, width: 1280, height: 720 });
  module.exports.isForeground = () => true;
}

// Prototype A+B is real-Windows only; everywhere else (fakewin, mac, Linux)
// these are inert so main can call them unconditionally.
module.exports.attachOwner ||= () => null;
module.exports.detachOwner ||= () => {};
module.exports.watchEvents ||= () => {};

// ── Self-check: `node src/gamewindow.js` ────────────────────────────────────
if (require.main === module) {
  const assert = require('assert');
  const none = () => false, all = () => true;
  assert.strictEqual(chooseClient([], 'a', null, none), null, 'no client running');
  assert.strictEqual(chooseClient(['a', 'b'], 'b', 'a', none), 'b', 'follows the focused client');
  assert.strictEqual(chooseClient(['a', 'b'], 'x', 'b', none), 'b', 'focus elsewhere keeps the tracked client');
  assert.strictEqual(chooseClient(['a', 'b'], 'x', 'b', (h) => h === 'b'), 'a', 'tracked client minimized -> next visible');
  assert.strictEqual(chooseClient(['a'], 'x', null, all), 'a', 'all minimized still reports one (isMinimized needs it)');
  console.log('gamewindow: client selection ok');
}
