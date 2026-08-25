// DPS meter, Driven by one data-source event:
//   'damage' → { amount }
// Frames are already filtered to damage WE dealt, so every one counts.
//
// Two deliberate choices:
//  - DPS is measured over ACTIVE COMBAT TIME, not wall clock — the same way WoW
//    meters do it. Idle gaps longer than COMBAT_GAP don't count, so walking to the
//    next pull doesn't sink your number.
//  - Damage output only: no per-ability breakdown, no damage taken, no hit/crit
//    counts. The frame carries crit and dead flags if that ever changes.
// Session save / past-sessions / CSV mirror the Loot section's flow on purpose.
// ponytail: that flow is COPIED, not abstracted — loot aggregates timestamped
// entries, this aggregates counters. Factor out only if a third section wants it.

// DPS history belongs to the RoseLite account, shared across every ROSE
// account launched from it.
const STORE = 'roselite.dps';
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();

// A pull ends after this long with no damage. Details! uses ~5s.
const COMBAT_GAP = 5000;

if (!document.getElementById('dps-style')) {
  const s = document.createElement('style');
  s.id = 'dps-style';
  s.textContent = `
    .dps-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
    .dps-title{font-weight:600;color:var(--parchment)}
    .dps-big{font-variant-numeric:tabular-nums;font-weight:700;font-size:var(--text-xl);color:var(--questgold)}
    .dps-reset{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);width:24px;height:24px;cursor:pointer;font-family:inherit;font-size:13px;line-height:1;padding:0}
    .dps-reset:hover{background:var(--widget-hover);color:var(--parchment)}
    .dps-ghost{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);padding:8px 10px;cursor:pointer;font-family:inherit;font-size:var(--text-sm)}
    .dps-ghost:hover{color:var(--parchment)}
    .dps-save{margin:8px 0;display:flex;flex-direction:column;gap:6px}
    .dps-save-btns{display:flex;gap:6px}
    .dps-save-btns .btn,.dps-save-btns .dps-ghost{flex:1;width:auto}
    .dps-select{width:100%;font-family:inherit}
    .dps-back{background:var(--widget);border:1px solid var(--hairline);color:var(--faded);
      border-radius:var(--r-sm);padding:6px 10px;margin-bottom:8px;cursor:pointer;font-family:inherit;font-size:var(--text-sm)}
    .dps-back:hover{color:var(--parchment)}
    .dps-dl{width:auto;padding:6px 10px}`;
  document.head.appendChild(s);
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => Number(n).toLocaleString('en-US');
const csvCell = (c) => `"${String(c).replace(/"/g, '""')}"`;

// A blank session. `lastAt` is the clock the gap logic runs on; `combatMs` only
// ever grows by gaps we were actually fighting through.
const blank = () => ({ startAt: null, lastAt: 0, combatMs: 0, out: 0, best: 0 });

// Active combat time INCLUDING the still-running gap since the last hit — so the
// live DPS decays while you stand there, then freezes once the pull is over.
function activeMs(s, now) {
  if (!s.lastAt) return s.combatMs;
  const pending = now - s.lastAt;
  return s.combatMs + (pending <= COMBAT_GAP ? pending : 0);
}
// Damage per second over that window. null (→ '—') before any time has elapsed.
const rate = (total, ms) => (ms > 0 ? total / (ms / 1000) : null);

// Fold one damage frame into a session. Returns the session (mutated).
function apply(s, d, now) {
  const amount = Math.max(0, Number(d.amount) || 0);
  if (!amount) return s;
  if (!s.startAt) s.startAt = now;
  if (s.lastAt && now - s.lastAt <= COMBAT_GAP) s.combatMs += now - s.lastAt;
  s.lastAt = now;
  s.out += amount;
  if (amount > s.best) s.best = amount;
  return s;
}

// self-checks: the gap rule is the whole meter, so pin it.
(() => {
  const s = blank();
  apply(s, { amount: 100 }, 1000);            // first hit: starts the clock, adds no time
  console.assert(s.combatMs === 0 && s.out === 100, 'first hit starts the pull');
  apply(s, { amount: 100 }, 3000);            // +2s inside the gap → counts
  console.assert(s.combatMs === 2000 && s.out === 200, 'in-gap time counts');
  apply(s, { amount: 300 }, 60000);           // 57s idle → does NOT count
  console.assert(s.combatMs === 2000 && s.best === 300, 'idle time is excluded');
  console.assert(Math.round(rate(500, 2000)) === 250, 'dps = damage / active seconds');
  console.assert(rate(500, 0) === null, 'no elapsed time → no dps');
  console.assert(activeMs({ lastAt: 0, combatMs: 7 }, 9e9) === 7, 'no hits yet → no pending gap');
})();

const mmss = (ms) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const fmtDate = (ms) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`; };

// Summary rows, shared by the live card and a saved session's page. The pairs are
// .stat-grid's direct children — it owns the columns and the mono face; the old
// per-row .stat-row wrapper was a class defined nowhere (see player-hud.js).
function statsHtml(s, now) {
  const row = (k, v) => `<span class="stat-k">${k}</span><span class="stat-v">${v}</span>`;
  return `<div class="stat-grid">` +
    row('Damage done', fmt(s.out)) +
    row('Best hit', s.best ? fmt(s.best) : '—') +
    row('Combat time', mmss(activeMs(s, now))) +
    `</div>`;
}

module.exports = (api) => {
  const root = api.addWidget(`
    <div class="dps-root">
      <div data-role="list">
        <div class="widget">
          <div class="dps-head">
            <span class="dps-title">Session</span>
            <span style="display:flex;align-items:center;gap:8px">
              <span class="dps-big" data-role="dps">—</span>
              <button class="dps-reset" data-role="reset" title="Reset session">⟳</button>
            </span>
          </div>
          <div class="dps-save" data-role="save" hidden>
            <p class="section-note" style="padding-top:0">Save this session before clearing?</p>
            <input class="inp" data-role="save-name" placeholder="Session name…" maxlength="40">
            <div class="dps-save-btns">
              <button class="btn" data-role="save-yes">Save</button>
              <button class="dps-ghost" data-role="save-no">Discard</button>
              <button class="dps-ghost" data-role="save-cancel">Cancel</button>
            </div>
          </div>
          <div data-role="stats"></div>
          <p class="section-note" data-role="empty">No damage yet — hit something.</p>
        </div>
        <div data-role="sessions" hidden><select class="inp dps-select" data-role="session-pick"></select></div>
      </div>
      <div data-role="page" hidden></div>
    </div>`, 'dps');

  const listEl = root.querySelector('[data-role="list"]');
  const page = root.querySelector('[data-role="page"]');
  const q = (r) => listEl.querySelector(`[data-role="${r}"]`);
  const dpsEl = q('dps'), statsEl = q('stats'), emptyEl = q('empty');

  let session = Object.assign(blank(), saved.session || {});
  const sessions = saved.sessions || [];

  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify({ session, sessions })); } catch {}
    }, 800);
  }

  function render() {
    const now = Date.now();
    emptyEl.hidden = session.out > 0;
    statsEl.innerHTML = session.out > 0 ? statsHtml(session, now) : '';
    const d = rate(session.out, activeMs(session, now));
    dpsEl.textContent = d == null ? '—' : `${fmt(Math.round(d))} dps`;
  }
  api.every(500, render);   // the pending-gap term makes DPS decay live

  // ── Past sessions ─────────────────────────────────────────────────────────
  const sessionsWrap = q('sessions'), pickEl = q('session-pick');
  function renderSessions() {
    sessionsWrap.hidden = sessions.length === 0;
    pickEl.innerHTML = `<option value="">Past sessions…</option>` +
      sessions.map((s, i) => `<option value="${i}">${esc(s.name)} — ${esc(fmtDate(s.savedAt))}</option>`).join('');
  }
  pickEl.addEventListener('change', () => { const i = pickEl.value; if (i !== '') openSessionPage(sessions[+i]); pickEl.value = ''; });
  renderSessions();

  function showPage(html) {
    page.innerHTML = `<button class="dps-back" data-role="back">‹ Back</button>` + html;
    page.querySelector('[data-role="back"]').addEventListener('click', () => { page.hidden = true; listEl.hidden = false; });
    listEl.hidden = true; page.hidden = false;
  }
  // A saved session is frozen: render it at its own end time, never Date.now().
  function openSessionPage(s) {
    const d = rate(s.out, activeMs(s, s.lastAt));
    showPage(`<div class="widget"><div class="dps-head"><span class="dps-title">${esc(s.name)}</span>` +
      `<span style="display:flex;align-items:center;gap:8px"><span class="dps-big">${d == null ? '—' : fmt(Math.round(d))} dps</span>` +
      `<button class="btn dps-dl" data-role="dl">Download</button></span></div>${statsHtml(s, s.lastAt)}</div>`);
    page.querySelector('[data-role="dl"]').addEventListener('click', () => downloadSession(s));
  }
  function downloadSession(s) {
    const ms = activeMs(s, s.lastAt);
    const rows = [['metric', 'value'],
      ['saved', new Date(s.savedAt).toISOString()],
      ['combat_seconds', Math.round(ms / 1000)],
      ['damage_done', s.out],
      ['dps', Math.round(rate(s.out, ms) || 0)],
      ['best_hit', s.best]];
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${(s.name || 'dps').replace(/[^\w -]/g, '_')}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ── Reset → offer to save first (same flow as the Loot section) ────────────
  const saveBox = q('save'), saveName = q('save-name');
  const hideSave = () => { saveBox.hidden = true; saveName.value = ''; };
  const clear = () => { session = blank(); persist(); render(); };
  q('reset').addEventListener('click', () => {
    if (!session.out) return clear();
    saveBox.hidden = false; saveName.focus();
  });
  q('save-yes').addEventListener('click', () => {
    sessions.push({ name: saveName.value.trim() || `Session ${fmtDate(Date.now())}`, savedAt: Date.now(), ...session });
    renderSessions(); clear(); hideSave();
  });
  q('save-no').addEventListener('click', () => { clear(); hideSave(); });
  q('save-cancel').addEventListener('click', hideSave);
  saveName.addEventListener('keydown', (e) => { if (e.key === 'Enter') q('save-yes').click(); });

  api.on('damage', (d) => { apply(session, d, Date.now()); render(); persist(); });
  render();
};
