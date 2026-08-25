// Tracks the game window's on-screen bounds.
// Win32 via koffi FFI — external polling only, nothing an anticheat cares about.

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
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');

  const RECT = koffi.struct('RECT', {
    left: 'long', top: 'long', right: 'long', bottom: 'long'
  });
  const FindWindowW = user32.func('void* FindWindowW(str16 cls, str16 title)');
  const GetWindowRect = user32.func('bool GetWindowRect(void* hwnd, _Out_ RECT* rect)');
  const IsWindow = user32.func('bool IsWindow(void* hwnd)');
  const IsIconic = user32.func('bool IsIconic(void* hwnd)');
  const GetForegroundWindow = user32.func('void* GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)');

  let hwnd = null;

  // Returns { x, y, width, height } in physical pixels, or null if the
  // game window is closed or minimized.
  module.exports.getBounds = (title) => {
    if (!hwnd || !IsWindow(hwnd)) hwnd = FindWindowW(null, title);
    if (!hwnd || IsIconic(hwnd)) return null;
    const r = {};
    if (!GetWindowRect(hwnd, r)) { hwnd = null; return null; }
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  };

  // True when the game window exists but is minimized — getBounds returns null
  // for both "closed" and "minimized", and the overlay must not fall back to
  // the launcher while the game is merely iconic.
  module.exports.isMinimized = (title) => {
    if (!hwnd || !IsWindow(hwnd)) hwnd = FindWindowW(null, title);
    return !!hwnd && !!IsIconic(hwnd);
  };

  const pidOf = (h) => { const p = [0]; GetWindowThreadProcessId(h, p); return p[0]; };
  // True when the foreground window belongs to the game — or to us (so clicking
  // the panel doesn't count as "another app"). Lets the overlay float above ROSE
  // only, staying out of the way of any other window the player switches to.
  module.exports.isForeground = (title) => {
    const fg = GetForegroundWindow();
    if (!fg) return false;
    if (pidOf(fg) === process.pid) return true; // our own overlay windows
    if (!hwnd || !IsWindow(hwnd)) hwnd = FindWindowW(null, title);
    return !!hwnd && pidOf(fg) === pidOf(hwnd);
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
