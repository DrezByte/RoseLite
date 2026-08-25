// Live player HUD, driven by 'player' frames. A pure api.on subscriber — no
// data-source knowledge, so it keeps working unchanged when the source swaps to
// the official API.
// The k/v rows are .stat-grid's direct children (index.html): the grid owns the
// two columns AND the mono face. They used to be wrapped one-per-.stat-row — a
// class that is defined nowhere, so the spans fell out of the grid and rendered
// inline ("Level42"), and the 1Hz clock below ticked in the proportional body
// face, which is the exact bug the Tabular rule (DESIGN §3) names.
// Frame: { type:'player', [name], hp, [maxhp], [mp], [lvl], [zone], [x], [y],
// [zuly] } — fields arrive piecemeal from the source, so anything missing
// renders as —. zone is a zoneNo; data.js names it.
const D = require('../overlay/data.js');

module.exports = (api) => {
  const el = api.addWidget(`
    <div class="widget">
      <div class="widget-head">
        <span class="widget-title" data-role="name">Player</span>
        <span class="pill pill--idle" data-role="status">waiting</span>
      </div>
      <div class="widget-value dim" data-role="hp">—</div>
      <div class="progress"><div class="progress-fill" data-role="bar" style="width:0%"></div></div>
      <div class="stat-grid">
        <span class="stat-k">Level</span><span class="stat-v" data-role="lvl">—</span>
        <span class="stat-k">Map</span><span class="stat-v" data-role="zone">—</span>
        <span class="stat-k">Coords</span><span class="stat-v" data-role="pos">—</span>
        <span class="stat-k">Zuly/h</span><span class="stat-v" data-role="zph">—</span>
        <span class="stat-k">Time</span><span class="stat-v" data-role="clock">—</span>
      </div>
    </div>`, 'character');

  const q = (r) => el.querySelector(`[data-role="${r}"]`);
  const status = q('status'), name = q('name'), hp = q('hp'), bar = q('bar');
  const lvl = q('lvl'), zone = q('zone'), pos = q('pos'), zph = q('zph'), clock = q('clock');

  // Producers send fields as they learn them; -1 / '-1' / '' are "unknown" sentinels.
  const has = (v) => v !== undefined && v !== null && v !== -1 && v !== '-1' && v !== '';
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const pad = (n) => String(n).padStart(2, '0');

  // Local clock + date, its own ticker — no game data needed, the OS has it.
  const tick = () => {
    const d = new Date();
    clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  tick();
  api.every(1000, tick);

  // Zuly/h = NET rate since the overlay opened: the server tells us the current
  // balance (gsv_SET_MONEY_ONLY), so spending counts against you the same way
  // looting counts for you. Held back until a minute has passed — before that the
  // extrapolation is nonsense (one 500k drop at t=3s reads as 600M/h).
  // ponytail: session starts at plugin load; add a reset button when someone asks.
  const MIN_MS = 60_000;
  let firstZuly = null, firstAt = 0;
  function renderZph(zuly) {
    if (!has(zuly)) return;
    if (firstZuly === null) { firstZuly = zuly; firstAt = Date.now(); return; }
    const ms = Date.now() - firstAt;
    if (ms < MIN_MS) return;
    const rate = Math.round((zuly - firstZuly) / (ms / 3.6e6));
    zph.textContent = `${fmt(rate)} z/h`;
  }
  console.assert(pad(7) === '07' && fmt(1234567) === '1,234,567', 'hud formatters');

  api.on('player', (p) => {
    status.textContent = 'live';
    status.className = 'pill pill--ready';
    name.textContent = has(p.name) ? p.name : 'Player';
    hp.textContent = has(p.hp) ? (has(p.maxhp) ? `${p.hp} / ${p.maxhp}` : `${p.hp}`) : '—';
    if (has(p.hp)) hp.className = 'widget-value';
    bar.style.width = (has(p.hp) && has(p.maxhp)) ? Math.round((p.hp / p.maxhp) * 100) + '%' : '0%';
    lvl.textContent = has(p.lvl) ? p.lvl : '—';
    zone.textContent = has(p.zone) ? (D.zoneName(p.zone) || `Zone ${p.zone}`) : '—';
    pos.textContent = (has(p.x) && has(p.y)) ? `${p.x}, ${p.y}` : '—';
    renderZph(p.zuly);
  });
};
