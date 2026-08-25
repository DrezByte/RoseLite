// Named-pipe NDJSON client. Connects, parses one JSON object per line, and
// reconnects forever on drop — same find-or-retry spirit as gamewindow.js
// re-finding the hwnd. It knows nothing about what is on the other end.
const net = require('net');

function splitFrames(buffer) {
  const lines = buffer.split('\n');
  const rest = lines.pop();              // last piece: partial line, or '' if buffer ended on \n
  return { frames: lines.filter(Boolean), rest };
}

function startReader(pipeName, onFrame, retryMs = 1000) {
  const connect = () => {
    let buffer = '';
    let done = false;                     // guard: 'error' then 'close' must not double-schedule
    const retry = () => { if (done) return; done = true; setTimeout(connect, retryMs); };

    const sock = net.connect({ path: pipeName });
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buffer += chunk;
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const line of frames) {
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }   // skip a corrupt line, keep the stream
        onFrame(frame);
      }
    });
    sock.on('error', retry);              // pipe not up yet, or dropped
    sock.on('close', retry);
  };
  connect();
}

module.exports = { startReader, splitFrames };

if (require.main === module) {
  const assert = require('assert');
  let buf = '';
  const feed = (chunk) => { buf += chunk; const r = splitFrames(buf); buf = r.rest; return r.frames; };
  assert.deepStrictEqual(feed('{"a":1}\n{"b":'), ['{"a":1}']);   // partial 2nd frame held back
  assert.deepStrictEqual(feed('2}\n'), ['{"b":2}']);             // completed by next chunk
  assert.deepStrictEqual(feed('{"c":3}'), []);                   // no newline yet → nothing emitted
  console.log('reader.js self-check ok');
}
