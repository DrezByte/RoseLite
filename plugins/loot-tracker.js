// Loot + kill tracker, OSRS-style. Driven by two data-source events:
//   'kill'  → { exp, gained, entityId, npcId }  — bumps that mob's kills
//   'drop'  → { itemType, itemNumber, npcId }   — adds a loot icon to it
// Layout: a SEARCH bar over the live Session card. Per-mob history is data only —
// no card row. Type a monster you've killed → opens its page (kills + loot grid).
// The Session card owns the chronological loot log (one timestamped line per
// drop, newest first, never stacked), zuly/h, and the only reset. Reset offers
// to SAVE the session under a name into a Past-sessions dropdown; a saved
// session opens read-only with a CSV Download. npcId 0 / unknown (a mob the
// source never named) counts toward the Session log but gets no per-mob page.
// Mobs, the live session, and saved sessions persist via localStorage.
// Pure api.on subscriber — no data-source knowledge.
const D = require('../overlay/data.js');
// Loot/kill history belongs to the RoseLite account, shared across every ROSE
// account launched from it — same key regardless of which one is active.
const STORE = 'roselite.loot';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();

// OSRS loot-card styling (rosewood tokens + a gold qty badge), injected once.
if (!document.getElementById('loot-style')) {
  const s = document.createElement('style');
  s.id = 'loot-style';
  s.textContent = `
    .loot-list{display:flex;flex-direction:column;gap:8px}
    .loot-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
    .loot-mob{font-weight:600;color:var(--parchment)}
    .loot-zph{font-variant-numeric:tabular-nums;font-weight:700;color:var(--questgold)}
    .loot-results .rows{margin-top:2px}
    .loot-grid{display:flex;flex-wrap:wrap;gap:6px}
    .loot-slot{position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;
      background:var(--widget);border:1px solid var(--hairline);border-radius:var(--r-sm)}
    .loot-slot--link{cursor:pointer;transition:border-color 150ms var(--ease),background 150ms var(--ease)}
    .loot-slot--link:hover{background:var(--widget-hover);border-color:var(--hairline-strong)}
    .loot-slot .loot-icon{width:32px;height:32px;object-fit:contain}
    .loot-qty{position:absolute;left:2px;bottom:0;font-size:var(--text-micro);line-height:1;font-weight:700;
      color:var(--questgold);text-shadow:0 0 2px #000,0 1px 1px #000;pointer-events:none}
    .loot-log{display:flex;flex-direction:column;gap:3px;font-size:var(--text-sm)}
    /* tabular-nums: the value column is right-aligned and the whole log re-renders
       on every drop, so proportional digits made the column jitter (Tabular rule). */
    .loot-log-row{display:flex;justify-content:space-between;gap:8px;font-variant-numeric:tabular-nums}
    .loot-log-name{color:var(--faded);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .loot-val--y{color:var(--questgold)}
    .loot-val--b{color:#6ba7e0}
    .loot-val--p{color:#b57edc}
    .loot-total{margin-top:6px;padding-top:6px;border-top:1px solid var(--hairline);
      display:flex;justify-content:space-between;gap:8px;font-weight:700;color:var(--parchment);
      font-variant-numeric:tabular-nums}
    .loot-reset{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);width:24px;height:24px;cursor:pointer;font-family:inherit;font-size:13px;line-height:1;padding:0}
    .loot-reset:hover{background:var(--widget-hover);color:var(--parchment)}
    .loot-ghost{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);padding:8px 10px;cursor:pointer;font-family:inherit;font-size:var(--text-sm)}
    .loot-ghost:hover{color:var(--parchment)}
    .loot-save{margin:8px 0;display:flex;flex-direction:column;gap:6px}
    .loot-save-btns{display:flex;gap:6px}
    .loot-save-btns .btn,.loot-save-btns .loot-ghost{flex:1;width:auto}
    .loot-select{width:100%;font-family:inherit}
    .loot-back{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);padding:6px 10px;margin-bottom:8px;cursor:pointer;font-family:inherit;font-size:var(--text-sm)}
    .loot-back:hover{color:var(--parchment)}
    .loot-dl{width:auto;padding:6px 10px}
    .loot-time{color:var(--faded);font-variant-numeric:tabular-nums}
    .loot-alert{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
    .loot-alert-txt{display:flex;align-items:center;gap:6px;font-size:var(--text-sm);color:var(--faded);white-space:nowrap}
    .loot-thresh{width:92px}
    .loot-alert select{flex:1;min-width:88px}`;
  document.head.appendChild(s);
}

const attr = (s) => String(s).replace(/"/g, '&quot;');   // names like "I Survived!" → safe title
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
// Market colour tiers (per the drop log spec); below 200k stays default.
const mkClass = (v) => v == null ? '' : v >= 5e6 ? ' loot-val--p' : v >= 1e6 ? ' loot-val--b' : v >= 2e5 ? ' loot-val--y' : '';
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`; };
const csvCell = (c) => `"${String(c).replace(/"/g, '""')}"`;
console.assert(csvCell('a"b') === '"a""b"' && csvCell(5) === '"5"', 'csvCell escapes quotes');

// ── What a drop is worth. prices: Map key→{name,npc,market,npcOnly} ────────
// Worn gear is valued at its NPC sell price and never the market: gear listings
// are thin, so one gouging seller becomes that day's min_price and inflates
// zuly/h. The exception is the unique-weapon block (LIST_WEAPON rows 901-999,
// the ones right after "Unique Weapon Fragment" — Faust, Crystal Wand, Fearless
// Vengeance, Remorseless Echo…): those are market goods, their NPC price is
// meaningless. Gems / consumables / materials keep the old max(market, npc).
const GEAR = new Set(['Weapon', 'Armor', 'Headgear', 'Gauntlets', 'Boots', 'Shield', 'Back', 'Face Item', 'Accessory']);
const isUnique = (it) => it.item_type_id === 8 && it.game_item_id >= 901 && it.game_item_id <= 999;
// Non-gear items that are vendor trash by design — you sell them to an NPC, so a
// market listing for one is noise. "type:number" game identity.
const NPC_ALWAYS = new Set(['12:131', '12:132', '12:133']);   // Ancient Copper / Silver / Gold Coin
const npcOnly = (it) => !!it
  && (NPC_ALWAYS.has(`${it.item_type_id}:${it.game_item_id}`)
    || (GEAR.has(it.type && it.type.name) && !isUnique(it)));
// Market value = median of the last 14 daily min_prices, not the latest point.
// A spike day is one point among fourteen, so the median ignores it outright —
// no "over 5× the norm" cutoff to tune.
const marketValue = (h) => {
  const v = h.slice(-14).map((e) => e.min_price).filter((n) => n > 0).sort((a, b) => a - b);
  return v.length ? Math.round(v[(v.length - 1) >> 1]) : null;   // lower middle on even counts
};
const priceOf = (prices, key) => {
  const p = prices.get(key);
  if (p == null) return null;
  if (p.npcOnly) return p.npc;
  return p.market == null && p.npc == null ? null : Math.max(p.market || 0, p.npc || 0);
};
console.assert(npcOnly({ type: { name: 'Armor' } })
  && npcOnly({ type: { name: 'Weapon' }, item_type_id: 8, game_item_id: 146 })    // Adamantium Axe → npc
  && !npcOnly({ type: { name: 'Weapon' }, item_type_id: 8, game_item_id: 961 })   // Faust → market
  && npcOnly({ type: { name: 'Material' }, item_type_id: 12, game_item_id: 133 })  // Ancient Gold Coin → npc
  && !npcOnly({ type: { name: 'Material' }, item_type_id: 12, game_item_id: 258 }) // other materials → market
  && !npcOnly({ type: { name: 'Gem' } }), 'gear + listed trash → npc price, unique weapons + non-gear → market');
console.assert(marketValue([{ min_price: 100 }, { min_price: 110 }, { min_price: 9e6 }, { min_price: 105 }]) === 105
  && marketValue([{ min_price: 250 }]) === 250 && marketValue([]) === null, 'marketValue: median shrugs off a spike day');
// Valuable-drop alert: a sound (no toast) when one drop's value crosses a
// configurable zuly threshold. Config is global (like the master sound switch);
// threshold 0/empty = off. Fires at drop time on the price known then (npc is
// immediate; market re-checks once when its late fetch lands — see fetchMarket).
const overThreshold = (v, th) => !!th && v != null && v >= th;
console.assert(overThreshold(2e6, 1e6) && !overThreshold(5e5, 1e6) && !overThreshold(2e6, 0) && !overThreshold(null, 1e6), 'drop alert: fires only at/over a positive threshold');
// A loot log's rows + running total, newest first, DOM-capped at 100 rows.
// ponytail: 100-row cap, lift it if a session log ever needs full scrollback.
function buildLog(entries, prices) {
  const total = entries.reduce((s, e) => s + (priceOf(prices, e.key) || 0), 0);
  const rows = entries.slice(-100).reverse().map((e) => {
    const v = priceOf(prices, e.key);
    const vHtml = v != null ? `<span class="loot-val${mkClass(v)}">${fmt(v)}</span>` : '';
    return `<div class="loot-log-row"><span class="loot-log-name">` +
      `<span class="loot-time">(${hhmm(e.at)})</span> ${esc(prices.get(e.key).name)} ×1</span>${vHtml}</div>`;
  }).join('');
  const html = rows +
    (total ? `<div class="loot-total"><span>Total</span><span class="loot-val${mkClass(total)}">${fmt(total)} z</span></div>` : '');
  return { html, total };
}
// A loot-icon grid for a drop map (mob page), most-dropped first. Empty → ''.
function gridHtml(drops) {
  if (!drops.size) return '';
  return `<div class="loot-grid">` + [...drops.values()].sort((a, b) => b.count - a.count).map((r) => {
    const link = r.item ? ` loot-slot--link" data-item-id="${r.item.id}` : '';
    return `<div class="loot-slot${link}" title="${attr(r.name)} ×${r.count}">` +
      `${r.item ? D.itemImg(r.item, 'loot-icon') : `<img class="loot-icon" alt="" src="${D.ICON_FALLBACK}">`}` +
      `<span class="loot-qty">${r.count}</span></div>`;
  }).join('') + `</div>`;
}

module.exports = (api) => {
  const root = api.addWidget(`
    <div class="loot-root">
      <div class="loot-list" data-role="list">
        <div class="loot-alert">
          <span class="loot-alert-txt">🔔 Alert &gt; <input class="inp loot-thresh" data-role="thresh" type="number" min="0" step="100000" placeholder="off"> z</span>
          <span data-role="soundpick"></span>
        </div>
        <input class="inp search" data-role="search" placeholder="Search a monster you killed…">
        <div class="loot-results" data-role="results" hidden></div>
        <div class="widget loot-summary">
          <div class="loot-head">
            <span class="loot-mob">Session</span>
            <span style="display:flex;align-items:center;gap:6px">
              <span class="loot-zph" data-role="zph">—</span>
              <button class="loot-reset" data-role="reset" title="Reset session">⟳</button>
            </span>
          </div>
          <div class="loot-save" data-role="save" hidden>
            <p class="section-note" style="padding-top:0">Save this session before clearing?</p>
            <input class="inp" data-role="save-name" placeholder="Session name…" maxlength="40">
            <div class="loot-save-btns">
              <button class="btn" data-role="save-yes">Save</button>
              <button class="loot-ghost" data-role="save-no">Discard</button>
              <button class="loot-ghost" data-role="save-cancel">Cancel</button>
            </div>
          </div>
          <div class="loot-log" data-role="log"></div>
          <p class="section-note" data-role="empty">No loot yet.</p>
        </div>
        <div class="loot-sessions" data-role="sessions" hidden>
          <select class="inp loot-select" data-role="session-pick"></select>
        </div>
      </div>
      <div data-role="page" hidden></div>
    </div>`, 'butin');

  const listEl = root.querySelector('[data-role="list"]');
  const page = root.querySelector('[data-role="page"]');

  // ── Valuable-drop alert config (threshold + pickable sound) ───────────────
  let alertThreshold = +localStorage.getItem('roselite-drop-threshold') || 0;
  let alertSound = localStorage.getItem('roselite-drop-sound') || 'coin';
  let lastAlert = 0;
  function alertIfValuable(value) {
    if (!overThreshold(value, alertThreshold)) return;
    if (Date.now() - lastAlert < 1500) return;   // one beep per burst of stacked drops
    lastAlert = Date.now();
    api.sound(alertSound);
  }
  const threshEl = listEl.querySelector('[data-role="thresh"]');
  threshEl.value = alertThreshold || '';
  threshEl.addEventListener('input', () => {
    alertThreshold = +threshEl.value || 0;
    localStorage.setItem('roselite-drop-threshold', alertThreshold);
  });
  listEl.querySelector('[data-role="soundpick"]').appendChild(
    api.soundSelect(alertSound, (v) => { alertSound = v; localStorage.setItem('roselite-drop-sound', v); }));

  // ── Per-mob history (data only; the page renders it on demand) ────────────
  const mobs = new Map();   // npcId → { name, kills, drops: Map(key → {item,name,count}) }
  if (saved.mobs) for (const [id, m] of Object.entries(saved.mobs)) {
    const drops = new Map();
    for (const [key, count] of Object.entries(m.drops || {})) {
      const [t, n] = key.split(':').map(Number);
      const item = D.itemByTypeNum(t, n);
      drops.set(key, { item, name: item ? item.name : `Item ${key}`, count });
    }
    mobs.set(Number(id), { name: m.name, kills: m.kills || 0, drops });
  }
  // Find-or-create the mob for a KNOWN npcId; null for 0 / unknown id (no page).
  function mobData(npcId) {
    if (!npcId) return null;
    const raw = D.npcName(npcId);
    if (!raw) return null;
    let m = mobs.get(npcId);
    if (!m) { m = { name: raw.replace(/\s*\([^)]*\)/g, '').trim(), kills: 0, drops: new Map() }; mobs.set(npcId, m); }
    return m;
  }
  function mobsSnapshot() {
    const o = {};
    for (const [id, m] of mobs) { const dr = {}; for (const [k, r] of m.drops) dr[k] = r.count; o[id] = { name: m.name, kills: m.kills, drops: dr }; }
    return o;
  }

  // ── Saved (past) sessions ─────────────────────────────────────────────────
  const sessions = saved.sessions || [];   // [{ name, savedAt, startAt, entries, prices }]
  const sessionsWrap = listEl.querySelector('[data-role="sessions"]');
  const pickEl = listEl.querySelector('[data-role="session-pick"]');
  const fmtDate = (ms) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm(ms)}`; };
  function renderSessions() {
    sessionsWrap.hidden = sessions.length === 0;
    pickEl.innerHTML = `<option value="">Past sessions…</option>` +
      sessions.map((s, i) => `<option value="${i}">${esc(s.name)} — ${esc(fmtDate(s.savedAt))}</option>`).join('');
  }
  pickEl.addEventListener('change', () => { const i = pickEl.value; if (i !== '') openSessionPage(sessions[+i]); pickEl.value = ''; });
  renderSessions();

  // ── Detail page (mob or saved session), swaps the list out ────────────────
  let pageMob = null;
  function showPage(html) {
    page.innerHTML = `<button class="loot-back" data-role="back">‹ Back</button>` + html;
    page.querySelector('[data-role="back"]').addEventListener('click', closePage);
    listEl.hidden = true; page.hidden = false;
  }
  function closePage() { page.hidden = true; listEl.hidden = false; pageMob = null; }
  function renderMobPage(m) {
    showPage(`<div class="widget"><div class="loot-head"><span class="loot-mob">${esc(m.name)}</span>` +
      `<span class="pill pill--ready">×${m.kills}</span></div>` +
      (gridHtml(m.drops) || `<p class="section-note">No loot yet.</p>`) + `</div>`);
  }
  function openMobPage(m) { pageMob = m; renderMobPage(m); }
  function openSessionPage(s) {
    pageMob = null;
    const prices = new Map(Object.entries(s.prices || {}));
    const entries = s.entries || [];
    const { html } = buildLog(entries, prices);
    showPage(`<div class="widget"><div class="loot-head"><span class="loot-mob">${esc(s.name)}</span>` +
      `<button class="btn loot-dl" data-role="dl">Download</button></div>` +
      (entries.length ? `<div class="loot-log">${html}</div>` : `<p class="section-note">Empty session.</p>`) + `</div>`);
    page.querySelector('[data-role="dl"]').addEventListener('click', () => downloadSession(s, prices));
  }
  // CSV export (time, item, value) — human-readable, opens in any spreadsheet.
  function downloadSession(s, prices) {
    const rows = [['time', 'item', 'value'], ...(s.entries || []).map((e) => {
      const v = priceOf(prices, e.key);
      return [new Date(e.at).toISOString(), (prices.get(e.key) || {}).name || e.key, v == null ? '' : v];
    })];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${(s.name || 'session').replace(/[^\w -]/g, '_')}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ── Search over killed mobs → mob page ────────────────────────────────────
  const searchEl = listEl.querySelector('[data-role="search"]');
  const resultsEl = listEl.querySelector('[data-role="results"]');
  let query = '';
  function refreshResults() {
    if (!query) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    const hits = [...mobs.entries()].filter(([, m]) => m.name.toLowerCase().includes(query))
      .sort((a, b) => b[1].kills - a[1].kills).slice(0, 20);
    resultsEl.hidden = false;
    resultsEl.innerHTML = hits.length
      ? `<ul class="rows">` + hits.map(([id, m]) =>
          `<li><button class="row" data-mob="${id}"><span class="row-name">${esc(m.name)}</span><span class="row-meta">×${m.kills}</span></button></li>`).join('') + `</ul>`
      : `<p class="section-note">No monster matches.</p>`;
    resultsEl.querySelectorAll('[data-mob]').forEach((b) => b.addEventListener('click', () => openMobPage(mobs.get(+b.dataset.mob))));
  }
  searchEl.addEventListener('input', () => { query = searchEl.value.trim().toLowerCase(); refreshResults(); });

  // ── Live Session card: zuly/h + chronological loot log + reset/save ───────
  // Pricing (npc/market) is cached per item so a late market fetch repaints
  // every affected line + the running total.
  const session = (() => {
    const zph = listEl.querySelector('[data-role="zph"]');
    const log = listEl.querySelector('[data-role="log"]');
    const empty = listEl.querySelector('[data-role="empty"]');
    const prices = new Map();   // "type:number" → { name, npc, market }
    const entries = [];         // { at, key } — one per drop, chronological
    let startAt = null, total = 0;

    // Restore a persisted session (entries + cached prices + clock).
    const sInit = saved.session || {};
    // npcOnly is re-derived, not trusted: a session persisted before the gear
    // rule existed has none, and would keep valuing its gear off the market.
    if (sInit.prices) for (const [k, v] of Object.entries(sInit.prices)) {
      const [t, n] = k.split(':').map(Number);
      v.npcOnly = npcOnly(D.itemByTypeNum(t, n));
      prices.set(k, v);
    }
    if (sInit.entries) entries.push(...sInit.entries);
    startAt = sInit.startAt || null;

    function renderLog() {
      empty.hidden = entries.length > 0;
      const r = buildLog(entries, prices); total = r.total; log.innerHTML = r.html;
      renderZph();
    }
    function renderZph() {
      const hrs = startAt ? (Date.now() - startAt) / 3.6e6 : 0;
      zph.textContent = hrs > 0 ? `${fmt(Math.round(total / hrs))} z/h` : '—';
    }
    api.every(5000, renderZph);   // keep the rate current between drops

    // roseutils market value (median of the recent daily series — see marketValue),
    // fetched once per item, then repaint. Never called for npcOnly gear.
    // key set only for a live drop (not the restore re-fetch) → alert once when
    // a late market price reveals the drop was over threshold.
    async function fetchMarket(row, item, key) {
      const r = await api.market(item.item_type_id, item.game_item_id);
      const h = r && r.ok && r.data && r.data.history;
      const v = h && h.length ? marketValue(h) : null;
      if (v != null) { row.market = v; renderLog(); persist(); if (key) alertIfValuable(priceOf(prices, key)); }
    }

    // Repaint restored rows now; re-fetch any market price we didn't persist.
    if (entries.length) {
      renderLog();
      for (const [key, p] of prices) if (p.market == null && !p.npcOnly) {
        const [t, n] = key.split(':').map(Number);
        const item = D.itemByTypeNum(t, n);
        if (item && item.item_type_id != null && item.game_item_id != null) fetchMarket(p, item);
      }
    }

    return {
      hasEntries: () => entries.length > 0,
      snapshot: () => ({ startAt, entries: entries.slice(), prices: Object.fromEntries(prices) }),
      clear() { entries.length = 0; prices.clear(); startAt = null; total = 0; log.innerHTML = ''; zph.textContent = '—'; empty.hidden = false; persist(); },
      drop(d) {
        const key = `${d.itemType}:${d.itemNumber}`;
        startAt = startAt || Date.now();
        if (!prices.has(key)) {
          const item = D.itemByTypeNum(d.itemType, d.itemNumber);
          const price = item && item.item_stat && item.item_stat.price;
          // NPC sell value is catalog price ÷ 2.5 (same divisor as the item page).
          const p = { name: item ? item.name : `Item ${key}`,
            npc: price != null ? Math.round(price / 2.5) : null, market: null, npcOnly: npcOnly(item) };
          prices.set(key, p);
          if (!p.npcOnly && item && item.item_type_id != null && item.game_item_id != null) fetchMarket(p, item, key);
        }
        entries.push({ at: Date.now(), key });
        renderLog();
        alertIfValuable(priceOf(prices, key));
      },
    };
  })();

  // Reset → offer to save the session under a name before clearing.
  const saveBox = listEl.querySelector('[data-role="save"]');
  const saveName = listEl.querySelector('[data-role="save-name"]');
  const hideSave = () => { saveBox.hidden = true; saveName.value = ''; };
  listEl.querySelector('[data-role="reset"]').addEventListener('click', () => {
    if (!session.hasEntries()) return session.clear();
    saveBox.hidden = false; saveName.focus();
  });
  listEl.querySelector('[data-role="save-yes"]').addEventListener('click', () => {
    const snap = JSON.parse(JSON.stringify(session.snapshot()));   // frozen copy, decoupled from the live session
    sessions.push({ name: saveName.value.trim() || `Session ${fmtDate(Date.now())}`, savedAt: Date.now(), ...snap });
    renderSessions(); session.clear(); hideSave();
  });
  listEl.querySelector('[data-role="save-no"]').addEventListener('click', () => { session.clear(); hideSave(); });
  listEl.querySelector('[data-role="save-cancel"]').addEventListener('click', hideSave);
  saveName.addEventListener('keydown', (e) => { if (e.key === 'Enter') listEl.querySelector('[data-role="save-yes"]').click(); });

  // Debounced write of mobs + live session + saved sessions to localStorage.
  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify({ mobs: mobsSnapshot(), session: session.snapshot(), sessions })); } catch {}
    }, 800);
  }

  api.on('kill', (k) => { const m = mobData(k.npcId | 0); if (m) { m.kills++; if (pageMob === m) renderMobPage(m); refreshResults(); persist(); } });
  api.on('drop', (d) => {
    const m = mobData(d.npcId | 0);
    if (m) {
      const key = `${d.itemType}:${d.itemNumber}`;
      let r = m.drops.get(key);
      if (!r) { const item = D.itemByTypeNum(d.itemType, d.itemNumber); r = { item, name: item ? item.name : `Item ${key}`, count: 0 }; m.drops.set(key, r); }
      r.count++;
      if (pageMob === m) renderMobPage(m);
    }
    session.drop(d);   // counts toward the session log even for an unknown npcId
    persist();
  });
};
