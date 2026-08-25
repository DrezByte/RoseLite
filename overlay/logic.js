// Pure logic shared by overlay.js (renderer) and the node self-checks
// (kings.test.js, gems-calc.test.js). No DOM, no Electron, no data reads —
// requireable from plain node, so the tests exercise the real code instead of
// mirroring it.

// ── Kings (Rois) ────────────────────────────────────────────────────────────
// due(king) = when it respawns, or null if never killed. kills: { id: killedAtMs }.
const kingDue = (kills, k) => kills[k.id] ? kills[k.id] + k.secs * 1000 : null;

// Countdown format: "8:04", "1:06:35", "21d 5h".
const kFmt = (s) => s >= 86400
  ? `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`
  : s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Wall-clock spawn time in the player's own timezone — a "12d 4h" countdown says
// nothing about whether that lands mid-raid. Same-day → just the clock.
const kWhen = (due) => {
  const d = new Date(due);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? t
    : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${t}`;
};

// "Next spawn" comparator: up first, then running by soonest, then idle alpha.
const kingCompare = (kills, now) => {
  const rank = (k) => { const d = kingDue(kills, k); if (d === null) return 2; return d <= now ? 0 : 1; };
  const key = (k) => { const d = kingDue(kills, k); return d === null ? 0 : d; };
  return (a, b) => rank(a) - rank(b) || key(a) - key(b) || a.name.localeCompare(b.name);
};

// ── Gems ────────────────────────────────────────────────────────────────────
// Gem Cutting outputs → Map base → [{ rank, item }] sorted by rank
// ("Ruby [4]" → base "Ruby", rank 4; unranked names are skipped).
function gemTypes(items) {
  const byType = new Map();
  for (const it of items) {
    const m = it.name.match(/^(.+?)\s*\[(\d+)\]$/);
    if (!m) continue;
    if (!byType.has(m[1])) byType.set(m[1], []);
    byType.get(m[1]).push({ rank: +m[2], item: it });
  }
  for (const arr of byType.values()) arr.sort((a, b) => a.rank - b.rank);
  return byType;
}

// Recursive expansion → sorted [{ id, name, count }] of leaf (non-gem) materials.
// Owned lower-rank gems are consumed globally across every target before their
// own materials are ever counted. recipeFor(id) → { skill, materials } | null.
function gemExpand(targets, byType, recipeFor) {
  const owned = {};                 // gem itemId → still-available count
  for (const t of targets)
    for (const { rank, item } of byType.get(t.base) || [])
      if (t.owned[rank]) owned[item.id] = (owned[item.id] || 0) + (t.owned[rank] | 0);
  const raws = new Map();
  const go = (id, name, qty) => {
    const have = owned[id] || 0;
    if (have > 0) { const u = Math.min(have, qty); owned[id] = have - u; qty -= u; }
    if (qty <= 0) return;
    const rec = recipeFor(id);
    if (!rec || rec.skill !== 'Gem Cutting') {           // leaf: a base material to buy/gather
      const e = raws.get(id) || { id, name, count: 0 };
      e.count += qty; raws.set(id, e);
      return;
    }
    for (const m of rec.materials) go(m.id, m.name, m.amount * qty);
  };
  for (const t of targets) go(t.item.id, t.item.name, t.qty | 0);
  return [...raws.values()].sort((a, b) => b.count - a.count);
}

module.exports = { kingDue, kFmt, kWhen, kingCompare, gemTypes, gemExpand };
