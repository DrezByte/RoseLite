// Community feed sources for the home news feed. Fetches run in main — the
// file:// renderer would hit CORS, same reason the RoseUtil market API lives
// in main.js. Every source normalizes to { source, title, date(ms), url,
// thumb? } so the overlay renders cards uniformly, whatever produced them.
const CACHE_MS = 15 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PATCH_NOTE_ORIGIN = 'https://forum.roseonlinegame.com';

function safePatchNoteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === PATCH_NOTE_ORIGIN ? url.href : null;
  } catch {
    return null;
  }
}

// A YouTube channel's uploads are a public Atom feed — no API key.
// ponytail: regex parse, no XML lib for one well-formed feed.
const unent = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function parseYouTubeRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)</) || [])[1];
    if (!YOUTUBE_VIDEO_ID.test(id || '')) continue;
    out.push({
      source: 'youtube',
      title: unent((e.match(/<title>([^<]*)</) || [, ''])[1]),
      date: Date.parse((e.match(/<published>([^<]+)</) || [])[1]) || 0,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  }
  return out;
}

const httpGet = (url) => new Promise((resolve) => {
  const { net } = require('electron');   // lazy: keeps the `node src/feeds.js` self-check electron-free
  let settled = false;
  const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
  const req = net.request(url);
  // Chromium's ClientRequest has no default deadline (see main.js's rawGet, same
  // fix). Without one, a stalled connection leaves this promise pending forever,
  // and since the cache below only updates on success, every later feed load
  // re-awaits the same hung request.
  const timer = setTimeout(() => { try { req.abort(); } catch {} finish(''); }, 15000);
  req.on('response', (res) => {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      try { req.abort(); } catch {}
      finish('');
      return;
    }
    let body = '';
    let bytes = 0;
    res.on('data', (c) => {
      bytes += Buffer.byteLength(c);
      if (bytes > MAX_RESPONSE_BYTES) {
        try { req.abort(); } catch {}
        finish('');
        return;
      }
      body += c;
    });
    res.on('end', () => finish(res.statusCode === 200 ? body : ''));
  });
  req.on('error', () => finish(''));
  req.end();
});

let cache = { at: 0, items: [] };
async function fetchYouTube(channelIds) {
  if (!channelIds || !channelIds.length) return [];
  if (Date.now() - cache.at < CACHE_MS) return cache.items;
  const xmls = await Promise.all(channelIds.map((id) =>
    httpGet(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`)));
  const items = xmls.flatMap(parseYouTubeRss).sort((a, b) => b.date - a.date);
  if (items.length) cache = { at: Date.now(), items };   // don't cache an offline miss
  return items;
}

// Latest patch note from the forum's per-forum RSS (IPS exposes each forum as
// /forum/<id>.xml/). The Patch Notes forum also carries item-mall posts, so
// filter to titles containing "Patch Notes". Feed is newest-first → first match
// wins. ponytail: regex parse, one well-formed feed, same as YouTube.
const PATCHNOTES_RSS = 'https://forum.roseonlinegame.com/forum/36-patch-notes.xml/';
let pnCache = { at: 0, item: null };
function parsePatchNote(xml) {
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const e = m[1];
    const title = unent((e.match(/<title>([^<]*)</) || [, ''])[1]);
    if (!/patch notes/i.test(title)) continue;
    const url = safePatchNoteUrl(unent((e.match(/<link>([^<]+)</) || [, ''])[1]));
    if (!url) continue;
    return {
      source: 'patchnote',
      title,
      url,
      date: Date.parse((e.match(/<pubDate>([^<]+)</) || [])[1]) || 0,
    };
  }
  return null;
}
async function fetchPatchNote() {
  if (Date.now() - pnCache.at < CACHE_MS && pnCache.item) return pnCache.item;
  const item = parsePatchNote(await httpGet(PATCHNOTES_RSS));
  if (item) pnCache = { at: Date.now(), item };   // keep last good on an offline miss
  return pnCache.item;
}

// Discord source: deferred until a bot token exists. Drop-in contract when it
// does — given { discordToken, discordChannel } from config, GET
// https://discord.com/api/v10/channels/{id}/messages with header
// `Authorization: Bot <token>`, map each message to { source:'discord',
// title: content first line, date: Date.parse(timestamp), url: message link }.

module.exports = { parseYouTubeRss, fetchYouTube, parsePatchNote, fetchPatchNote };

// Self-check: node src/feeds.js
if (require.main === module) {
  const sample = `<?xml version="1.0"?><feed>
    <entry><yt:videoId>abc123XYZ_-</yt:videoId><title>Luau Event &amp; Guide</title><published>2026-07-01T12:00:00+00:00</published></entry>
    <entry><yt:videoId>def456</yt:videoId><title>Clan war recap</title><published>2026-06-20T08:30:00+00:00</published></entry>
  </feed>`;
  const v = parseYouTubeRss(sample);
  console.assert(v.length === 2, 'two entries parsed');
  console.assert(v[0].title === 'Luau Event & Guide', 'entities decoded');
  console.assert(v[0].url === 'https://www.youtube.com/watch?v=abc123XYZ_-', 'watch url');
  console.assert(v[0].thumb.includes('abc123XYZ_-'), 'thumb from id');
  console.assert(v[0].date === Date.parse('2026-07-01T12:00:00+00:00'), 'published parsed');
  console.assert(parseYouTubeRss('<feed></feed>').length === 0, 'empty feed → []');
  const rss = `<rss><channel>
    <item><title>July 2026 Item Mall Update</title><link>https://forum.roseonlinegame.com/topic/1/</link><pubDate>Sun, 28 Jun 2026 01:52:57 +0000</pubDate></item>
    <item><title>Patch Notes - 2026-07-01 (Fixes)</title><link>https://forum.roseonlinegame.com/topic/2/</link><pubDate>Wed, 01 Jul 2026 15:50:29 +0000</pubDate></item>
  </channel></rss>`;
  const pn = parsePatchNote(rss);
  console.assert(pn.title === 'Patch Notes - 2026-07-01 (Fixes)', 'skips non-patch-note items');
  console.assert(pn.url === 'https://forum.roseonlinegame.com/topic/2/', 'patch note link');
  console.assert(parsePatchNote('<rss><item><title>Patch Notes</title><link>javascript:alert(1)</link></item></rss>') === null, 'unsafe patch note link is dropped');
  console.assert(parsePatchNote('<rss></rss>') === null, 'no patch note → null');
  console.log('feeds.js self-check OK');
}
