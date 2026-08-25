// Drives the official rose-updater in headless mode and streams its NDJSON
// progress to onEvent. The updater already lives in every player's game dir (it
// self-updates), so RoseLite spawns that copy rather than bundling one — the
// same "consume official infra" bet the whole project is built on.
//
// Events straight from `rose-updater --headless`:
//   progress {stage,current,max} · done {repaired?} · updater-updated · error {code?,message,details}
// Plus two we synthesize for the caller:
//   missing      — no updater exe present, or spawn failed (behave like today)
//   unsupported  — an old updater that rejects --headless (clap exit 2) → GUI fallback
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Pure: split a rolling buffer on newlines into complete frames + the leftover
// partial line. Lives here because updater.js is the only NDJSON consumer that
// ships publicly; the local-only data source imports it from here.
function splitFrames(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop();              // last piece: partial line, or '' if buffer ended on \n
  return { frames: lines.filter(Boolean), rest };
}

// Pure: what does a process exit mean, given whether the child already emitted a
// terminal NDJSON event? Kept separate so it's testable (see self-check).
//   'respawn'     (exit 10) updater self-updated → run the new exe once more
//   'unsupported' (exit 2)  clap usage error = old updater, no --headless
//   'done'        (exit 0, no terminal line) synthesize success
//   'error'       (other, no terminal line)  the child crashed without saying so
//   'none'        the child already emitted the terminal event; nothing to add
function classifyExit(code, sawTerminal) {
  if (code === 10) return 'respawn';
  if (code === 2) return 'unsupported';
  if (code === 0) return sawTerminal ? 'none' : 'done';
  return sawTerminal ? 'none' : 'error';
}

// Dev/macOS affordance (like ROSELITE_FAKEWIN): drive the renderer with no exe.
function fakeRun(variant, onEvent) {
  if (variant === 'old') { onEvent({ event: 'unsupported' }); return () => {}; }
  const frames = [];
  for (let i = 0; i <= 100; i += 20) frames.push({ event: 'progress', stage: 'checking-files', current: i, max: 100 });
  for (let i = 0; i <= 100; i += 10) frames.push({ event: 'progress', stage: 'downloading-updates', current: i, max: 100 });
  frames.push(variant === 'error'
    ? { event: 'error', code: 100, message: '[ROSE-100] Failed to check for updates', details: 'fake' }
    : { event: 'done' });
  let i = 0;
  const t = setInterval(() => { i < frames.length ? onEvent(frames[i++]) : clearInterval(t); }, 120);
  return () => clearInterval(t);
}

// Returns a cancel function. onEvent is called with each event above.
function runUpdater({ gameDir, verify, url }, onEvent) {
  const fake = process.env.ROSELITE_FAKEUPDATE;
  if (fake) return fakeRun(fake, onEvent);

  const exeName = process.platform === 'win32' ? 'rose-updater.exe' : 'rose-updater';
  const exe = path.join(gameDir || '', exeName);
  if (!gameDir || !fs.existsSync(exe)) { onEvent({ event: 'missing' }); return () => {}; }

  // --skip-updater: don't let the run self-update rose-updater.exe. Until the
  // headless mode ships upstream, a self-update REPLACES a locally-built
  // headless exe with the official (headless-less) one and every later run
  // exits 2. ponytail: drop this flag once upstream ships headless, so the
  // updater keeps itself fresh again (exit-10 respawn already handles it).
  const args = ['--headless', '--skip-updater', '--output', gameDir];
  if (verify) args.push('--verify');
  if (url) args.push('--url', url);

  let child, respawns = 0, killed = false;
  const go = () => {
    let buffer = '', stderrTail = '', sawTerminal = false;
    child = spawn(exe, args, { cwd: gameDir, windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const line of frames) {
        let f; try { f = JSON.parse(line); } catch { continue; }   // skip a corrupt line
        if (f.event === 'done' || f.event === 'error' || f.event === 'updater-updated') sawTerminal = true;
        if (f.event === 'updater-updated') continue;   // internal: the caller sees the respawn's result instead
        onEvent(f);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c).slice(-2048); });
    child.on('error', () => { if (!killed) onEvent({ event: 'missing' }); });   // ENOENT/EACCES
    child.on('exit', (code) => {
      if (killed) return;
      const verb = classifyExit(code, sawTerminal);
      if (verb === 'respawn') return (++respawns < 2) ? go() : onEvent({ event: 'error', message: 'updater kept self-updating' });
      if (verb === 'done') onEvent({ event: 'done' });
      else if (verb === 'unsupported') onEvent({ event: 'unsupported' });
      else if (verb === 'error') onEvent({ event: 'error', message: stderrTail.trim() || `updater exited with code ${code}` });
      // 'none' → the child already emitted the terminal event
    });
  };
  go();
  return () => { killed = true; if (child) child.kill(); };
}

module.exports = { runUpdater, classifyExit, splitFrames };

// self-check: the exit-code → meaning mapping is the whole cross-repo contract.
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(classifyExit(10, false), 'respawn');       // self-updated
  assert.strictEqual(classifyExit(2, false), 'unsupported');    // old binary
  assert.strictEqual(classifyExit(0, false), 'done');           // clean exit, no NDJSON → success
  assert.strictEqual(classifyExit(0, true), 'none');            // child already said done
  assert.strictEqual(classifyExit(1, true), 'none');            // child already emitted error
  assert.strictEqual(classifyExit(1, false), 'error');          // crash with no NDJSON
  // a frame split across two chunks must survive the buffer boundary
  let buf = '';
  const feed = (chunk) => { buf += chunk; const r = splitFrames(buf); buf = r.rest; return r.frames; };
  assert.deepStrictEqual(feed('{"a":1}\n{"b":'), ['{"a":1}']);   // partial 2nd frame held back
  assert.deepStrictEqual(feed('2}\n'), ['{"b":2}']);             // completed by next chunk
  assert.deepStrictEqual(feed('{"c":3}'), []);                   // no newline yet → nothing emitted
  console.log('updater.js self-check ok');
}
