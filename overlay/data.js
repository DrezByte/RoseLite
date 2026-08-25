// RoseData layer: item catalog (the linking hub), quests, lazy recipe details,
// icon resolution, and item-name linkifying. Read at runtime from ../RoseData
// (nodeIntegration is on). No build step — see ensureRecipes for the one lazy
// 12MB parse. Everything the overlay renders about game data comes from here.
const fs = require('fs');
const path = require('path');

const CRAFTS = path.join(__dirname, '../RoseData/crafts');
const ITEMS_FILE = path.join(__dirname, '../RoseData/list_items.json');
const NPC_FILE = path.join(__dirname, '../RoseData/list_npc.json');
const ZONE_FILE = path.join(__dirname, '../RoseData/zones.json');
const QUESTS_FILE = path.join(__dirname, '../RoseData/quests/quests.json');
const CONTENT = path.join(__dirname, 'content');   // cleaned guide/event fragments

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Browse category order (type.name from list_items). Types not listed fall to
// the end, alpha.
const CAT_ORDER = ['Weapon', 'Armor', 'Headgear', 'Gauntlets', 'Boots', 'Shield',
  'Back', 'Face Item', 'Accessory', 'Gem', 'Cart', 'Mount', 'Consumable', 'Material'];

// ── Catalog: the full item list (list_items.json, ~19.5k items). Eager: it's
// the browse index + link index + material/recipe + type/number lookup. ──────
const itemsById = new Map();
const itemsByName = new Map();          // lowercased name → item (first wins)
const itemsByTypeNum = new Map();       // "itemType:gameItemId" → item (game identity)
const catMap = new Map();               // type.name → items[]
for (const it of JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'))) {
  if (!it.icon) continue;   // ponytail: hide icon-less items for now; drop this line to show them again
  if (!itemsById.has(it.id)) itemsById.set(it.id, it);
  const key = it.name.toLowerCase();
  if (!itemsByName.has(key)) itemsByName.set(key, it);
  if (it.item_type_id != null && it.game_item_id != null) {
    const tn = `${it.item_type_id}:${it.game_item_id}`;
    if (!itemsByTypeNum.has(tn)) itemsByTypeNum.set(tn, it);
  }
  const cat = (it.type && it.type.name) || 'Other';
  if (!catMap.has(cat)) catMap.set(cat, []);
  catMap.get(cat).push(it);
}
const categories = [...catMap.entries()]                 // [{ label, items }]
  .sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a[0]), ib = CAT_ORDER.indexOf(b[0]);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a[0].localeCompare(b[0]);
  })
  .map(([label, items]) => ({ label, items }));

// Gear stats for the item page: prefer the pretty `stats` block (craftables
// carry it); otherwise build a readable one from the raw `item_stat` numbers.
// Range/attack_speed are omitted — their raw units don't map to the client's
// displayed values (axe range 250 shows as "2m" in-game).
const STAT_LABELS = [
  ['attack_power', 'Attack Power'], ['defense', 'Defense'], ['magic_defense', 'Magic Defense'],
  ['dodge_rate', 'Dodge'], ['block_rate', 'Block'],
  ['offhand_defense', 'Off-hand Def'], ['offhand_magic_defense', 'Off-hand M.Def'],
  ['pvm_atk', 'PvM Atk'], ['pvm_def', 'PvM Def'], ['pvp_atk', 'PvP Atk'], ['pvp_def', 'PvP Def'],
  ['durability', 'Durability'], ['quality', 'Quality'], ['weight', 'Weight'],
  ['level_requirement', 'Req. Level'],   // price shown in the dedicated NPC/market block
];
function displayStats(it) {
  if (it.stats) return it.stats;
  const s = it.item_stat;
  if (!s) return null;
  const out = {};
  for (const [k, label] of STAT_LABELS) if (s[k] != null) out[label] = s[k];
  if (s.stat_requirement) out['Stat Req'] = `${s.stat_requirement.stat_name} ${s.stat_requirement.value}`;
  if (s.options && s.options.length)
    out['Bonus'] = s.options.map((o) => `${o.type_name} ${o.value}${o.is_percentage ? '%' : ''}`);
  return Object.keys(out).length ? out : null;
}
// The game identifies an item by (item_type, item_number); drop/loot frames carry
// those, this resolves them to the catalog entry (name + icon).
const itemByTypeNum = (type, num) => itemsByTypeNum.get(`${type}:${num}`) || null;

// ── Monsters: npcId → name (list_npc.json, ~2.2k). 'spawn' frames carry the
// npcId, kill/drop frames repeat it, this is what turns it into a name. ────────
const npcNames = JSON.parse(fs.readFileSync(NPC_FILE, 'utf8'));
const npcCardsById = new Map(Object.entries(npcNames).map(([id, name]) => [Number(id), {
  id: Number(id),
  name,
  category: /\(NPC\)(?:\s|$)/i.test(name) ? 'NPC' : 'Monster',
  icon: '../RoseData/game-icons/useitem/candle_ghost.png',
}]));
const npcName = (id) => npcNames[id] || null;

// ── Drops: mob → the items it drops (drops.json, keyed by the same list_npc row;
// values are list_items ids, so the catalog above supplies every name/icon/price).
// Scraped from roseutils out of band — the game ships no drop
// table. Lazy like ensureRecipes, and a missing file degrades to an empty list
// (RoseData is synced out of band) instead of blanking the section.
const DROPS_FILE = path.join(__dirname, '../RoseData/drops.json');
let mobList = null;
function mobs() {
  if (mobList) return mobList;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(DROPS_FILE, 'utf8')); } catch { /* not synced yet */ }
  mobList = Object.entries(raw).map(([id, m]) => {
    const full = npcNames[id] || `#${id}`;
    // list_npc names carry the rank in parens, sometimes with a zone after it:
    // "Jelly Nut (Basic)", "Astarot King (King-Fighter) [Luna Clan Field]". Three
    // rows have a literal "(null)" rank.
    const rank = /\(([^)]+)\)\s*(\[[^\]]*\])?\s*$/.exec(full);
    return {
      id: Number(id),
      name: rank ? `${full.slice(0, rank.index).trim()} ${rank[2] || ''}`.trim() : full,
      rank: rank && rank[1] !== 'null' ? rank[1] : null,
      level: m.lvl != null ? m.lvl : null,
      items: m.d.map((i) => itemsById.get(i)).filter(Boolean),   // icon-less items are out of the catalog
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return mobList;
}

// Reverse of the above: item id → the mobs that drop it, lowest level first (the
// cheapest place to farm it is the answer the item page wants). Built once off
// mobs(), so the first item page pays the same lazy parse the Monstres list does.
let dropIndex = null;
function droppedBy(itemId) {
  if (!dropIndex) {
    dropIndex = new Map();
    for (const m of [...mobs()].sort((a, b) => (a.level || 0) - (b.level || 0)))
      for (const it of m.items) {
        if (!dropIndex.has(it.id)) dropIndex.set(it.id, []);
        dropIndex.get(it.id).push(m);
      }
  }
  return dropIndex.get(itemId) || [];
}

// ── Zones: zoneNo → map name (zones.json, 81 named rows). Same STB row keying as
// list_npc (row = CSV line − 2). The server sends zoneNo in gsv_SELECT_CHAR /
// gsv_TELEPORT_REPLY; this names it for the character HUD. RoseData is synced
// out of band, so a missing zones.json must degrade (HUD shows "Zone n"), not
// blank the whole panel. ─────────────────────────────────────────────────────
const zoneNames = fs.existsSync(ZONE_FILE) ? JSON.parse(fs.readFileSync(ZONE_FILE, 'utf8')) : {};
const zoneName = (id) => zoneNames[id] || null;

// ── Quests ──────────────────────────────────────────────────────────────────
// game_quest_id 0 is the STB type row leaking in (name: "string"), 1–8 are dead
// "(Tutorial Quest)" rows the game no longer gives out. 9 = "Visitor Look?" is the
// first quest a player can actually get, so the catalog starts there.
const FIRST_REAL_QUEST = 9;
const quests = JSON.parse(fs.readFileSync(QUESTS_FILE, 'utf8'))
  .filter((q) => q.game_quest_id >= FIRST_REAL_QUEST)
  .sort((a, b) => a.game_quest_id - b.game_quest_id);   // default order: quest ID, not A-Z
const questsByGameId = new Map();       // game_quest_id (number) → quest
for (const q of quests) questsByGameId.set(q.game_quest_id, q);

// Planet enrichment: list_of_quests.html is a forum outline grouped under
// "<PLANET> PLANET" headers, with quest names in &quot;…&quot;. Walk it in
// document order, carry the current planet, and tag matching quests. ~145 of
// 1060 quests match by name (the rest — Hero/Repeatable/Event — stay planet-
// less and simply don't match a planet filter). ponytail: runtime regex pass,
// no build step / generated file to keep in sync.
const QUEST_GUIDE = path.join(__dirname, '../RoseData/guides/list_of_quests.html');
const PLANETS = ['Junon', 'Luna', 'Eldeon', 'Orlo'];
// Lazy like ensureRecipes: this is a full regex walk of the guide HTML, only
// needed for the Quêtes section's planet filter, so it shouldn't cost every
// boot — call ensurePlanets() before reading q.planet (renderQuests does).
let planetsAttached = false;
function ensurePlanets() {
  if (planetsAttached) return;
  planetsAttached = true;
  let html;
  try { html = fs.readFileSync(QUEST_GUIDE, 'utf8'); } catch { return; }
  const name2planet = new Map();
  let planet = null;
  const re = /\b([A-Z]{3,}) PLANET\b|&quot;([^&]+)&quot;/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { const p = PLANETS.find((x) => x.toUpperCase() === m[1]); if (p) planet = p; }
    else if (m[2] && planet) { const n = m[2].trim().toLowerCase(); if (!name2planet.has(n)) name2planet.set(n, planet); }
  }
  for (const q of quests) { const p = name2planet.get(q.name.toLowerCase()); if (p) q.planet = p; }
}

// item_stat.job_requirement is a class-restriction id that clusters by ROSE's
// four base classes across gear tiers (41/51 + 11/12 → Soldier, 42/52 + 13/14
// → Muse, …); 68 = Artisan crafting tools. Most items are class-agnostic (null).
const JOB_BY_REQ = {
  41: 'Soldier', 51: 'Soldier', 11: 'Soldier', 12: 'Soldier',
  42: 'Muse', 52: 'Muse', 13: 'Muse', 14: 'Muse',
  43: 'Hawker', 53: 'Hawker', 15: 'Hawker', 16: 'Hawker',
  44: 'Dealer', 54: 'Dealer', 17: 'Dealer', 18: 'Dealer',
  68: 'Artisan',
};
const itemJob = (it) => { const j = it.item_stat && it.item_stat.job_requirement; return j != null ? (JOB_BY_REQ[j] || null) : null; };
const itemLevel = (it) => (it.item_stat && it.item_stat.level_requirement != null ? it.item_stat.level_requirement : null);

// ── Icons (relative URL for <img>; missing → inline placeholder) ────────────
const ICON_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9a7468" stroke-width="1.5">' +
  '<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M5 7l7 4 7-4M12 11v10"/></svg>');

function iconUrl(item) {
  if (!item || !item.icon) return null;
  // 6 catalog rows use "materials/" instead of the actual "material/" folder.
  return `../RoseData/game-icons/${item.icon.replace(/^materials\//, 'material/')}`;
}
// <img> string used everywhere an item icon appears; swaps to fallback if the
// file is absent (e.g. material/ icons the user drops in later).
function itemImg(item, cls = 'item-icon') {
  const url = iconUrl(item);
  return `<img class="${cls}" alt="" loading="lazy" src="${url ? esc(url) : ICON_FALLBACK}" ` +
    `onerror="this.onerror=null;this.src='${ICON_FALLBACK}'">`;
}

// ── Lazy recipe details (12MB all_recipes.json parsed once, then GC-able) ───
let recipeDetail = null;                // id → { skill, materials, itemStat, stats }
let usedInIndex = null;                 // materialId → [craftable ids]
// The catalog carries a placeholder "Chemical" row (no game_item_id behind it,
// no stats, no market price) where every Gem Cutting / Alchemy recipe really
// consumes Low Essence. Remap on load so the id is the one you can click,
// price and count. ponytail: drop this when RoseData fixes the row upstream.
const MATERIAL_ALIAS = new Map([[18589, 17204]]);
const aliasMaterial = (m) => {
  const real = itemsById.get(MATERIAL_ALIAS.get(m.id));
  return real ? { id: real.id, name: real.name, icon: real.icon } : m;
};
function ensureRecipes() {
  if (recipeDetail) return;
  const t = Date.now();
  const rec = JSON.parse(fs.readFileSync(path.join(CRAFTS, 'all_recipes.json'), 'utf8'));
  recipeDetail = new Map();
  usedInIndex = new Map();
  for (const r of rec) {
    const mats = (r.crafting_materials || []).map((m) => {
      const a = aliasMaterial(m);
      return { id: a.id, name: a.name, icon: a.icon, amount: m.pivot ? m.pivot.amount : 1 };
    });
    recipeDetail.set(r.id, {
      skill: r.craft_skill_type,
      craftType: r.craft_item_type,
      stats: r.stats,
      itemStat: r.item_stat || null,
      materials: mats,
    });
    for (const m of mats) {
      if (!usedInIndex.has(m.id)) usedInIndex.set(m.id, []);
      usedInIndex.get(m.id).push(r.id);
    }
  }
  console.log(`[data] parsed all_recipes.json (${rec.length}) in ${Date.now() - t}ms`);
  // ponytail: one-time parse; pre-slim to a generated recipes.json if it drags
}
// ponytail: 63/1154 recipe materials aren't in list_items — they still show in a
// recipe (name+icon come from all_recipes) but aren't clickable / reverse-indexed.
function recipeFor(id) { ensureRecipes(); return recipeDetail.get(id) || null; }
function usedIn(id) { ensureRecipes(); return (usedInIndex.get(id) || []).map((i) => itemsById.get(i)).filter(Boolean); }
// Craftable items grouped by craft skill, for the Recipes section.
function recipesBySkill() {
  ensureRecipes();
  const groups = new Map();
  for (const [id, r] of recipeDetail) {
    if (!r.materials.length) continue;
    const it = itemsById.get(id);
    if (!it) continue;
    if (!groups.has(r.skill)) groups.set(r.skill, []);
    groups.get(r.skill).push(it);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ── Linkify: wrap catalog item names in text with clickable anchors ─────────
let itemRegex = null;
function buildRegex() {
  const names = [...itemsByName.keys()]
    .filter((n) => n.length >= 4)                 // ponytail: skip <4-char names to cut false matches
    .sort((a, b) => b.length - a.length)          // longest first: "Iron Short Sword" beats "Iron"
    .map(escRe);
  itemRegex = new RegExp(`\\b(${names.join('|')})\\b`, 'gi');
}
function linkText(t) {
  return t.replace(itemRegex, (m) => {
    const it = itemsByName.get(m.toLowerCase());
    return it ? `<a class="item-link" data-item-id="${it.id}">${m}</a>` : m;
  });
}
// Accepts already-escaped plain text OR an HTML fragment; only linkifies text,
// never the inside of a tag (would corrupt href/src attributes).
function linkifyItems(html) {
  if (!itemRegex) buildRegex();
  if (!html.includes('<')) return linkText(html);
  return html.replace(/>([^<]+)</g, (_, t) => '>' + linkText(t) + '<');
}

// ── Cleaned guide/event content (fragments + index, generated offline) ──────
const guidesIndex = JSON.parse(fs.readFileSync(path.join(CONTENT, 'guides', 'index.json'), 'utf8'));
const eventsIndex = JSON.parse(fs.readFileSync(path.join(CONTENT, 'events', 'index.json'), 'utf8'));
const loadFragment = (kind, file) => fs.readFileSync(path.join(CONTENT, kind, file), 'utf8');

module.exports = {
  itemsById, itemsByName, itemByTypeNum, npcName, npcCardsById, zoneName, categories, quests, questsByGameId,
  itemJob, itemLevel, mobs, droppedBy,
  iconUrl, itemImg, ICON_FALLBACK, displayStats,
  recipeFor, usedIn, recipesBySkill, ensureRecipes,
  ensurePlanets,
  linkifyItems, guidesIndex, eventsIndex, loadFragment,
};

// ── Self-check: `node overlay/data.js` ──────────────────────────────────────
if (require.main === module) {
  const assert = require('assert');
  assert(itemsById.size > 3000, 'catalog loaded');
  assert(quests.length > 1000, 'quests loaded');
  // planet enrichment + item job/level accessors
  ensurePlanets();
  const withPlanet = quests.filter((q) => q.planet);
  assert(withPlanet.length > 50, 'quests tagged with a planet: ' + withPlanet.length);
  assert(PLANETS.includes(withPlanet[0].planet), 'planet value is valid');
  const classed = [...itemsById.values()].find((i) => itemJob(i));
  assert(classed && ['Soldier', 'Muse', 'Hawker', 'Dealer', 'Artisan'].includes(itemJob(classed)), 'itemJob maps a class');
  assert([...itemsById.values()].some((i) => itemLevel(i) > 0), 'itemLevel reads level_requirement');
  console.log('planets:', withPlanet.length, 'quests · sample', withPlanet[0].name, '→', withPlanet[0].planet);
  // materials/ normalization
  const bad = [...itemsById.values()].find((i) => i.icon && i.icon.startsWith('materials/'));
  if (bad) assert(iconUrl(bad).includes('/material/'), 'materials/ → material/');
  // name lookup + linkify on real quest text
  const q = quests.find((x) => x.description && /Asper Venom/.test(x.description));
  if (q) {
    const named = itemsByName.has('asper venom');
    console.log('quest links a known item:', named, '→', named ? linkifyItems(esc(q.description)).includes('item-link') : 'name not in catalog');
  }
  const sword = [...itemsById.values()].find((i) => /Adamantium Axe/.test(i.name));
  assert(recipeFor(sword.id).materials.length > 0, 'recipe materials resolve');
  // raw item_stat → readable gear stats for a non-craftable item (no pretty `stats`)
  const gear = [...itemsById.values()].find((i) => !i.stats && i.item_stat && i.item_stat.attack_power && i.item_stat.options);
  const ds = displayStats(gear);
  assert(ds && ds['Attack Power'] && ds['Bonus'], 'item_stat renders: ' + gear.name);
  // zones: STB row keying — 1/2 are the two starter towns, unknown ids stay null
  if (fs.existsSync(ZONE_FILE)) assert(zoneName(1) === 'Canyon City of Zant' && zoneName(2) === 'City of Junon Polis', 'zoneName keys by STB row');
  assert(zoneName(99999) === null, 'zoneName: unknown id → null');
  // drops: mobs resolve to catalog items (skipped when RoseData has no drops.json yet)
  const ms = mobs();
  if (ms.length) {
    assert(ms.every((m) => m.items.length), 'every listed mob drops something');
    const jelly = ms.find((m) => m.id === 3);
    if (jelly) assert(jelly.name === 'Jelly Nut' && jelly.rank === 'Basic' && jelly.level > 0, 'mob name/rank/level: ' + JSON.stringify([jelly.name, jelly.rank, jelly.level]));
    const common = ms[0].items[0];
    const by = droppedBy(common.id);
    assert(by.length && by.some((m) => m.items.includes(common)), 'droppedBy is the reverse of mobs()');
    assert(by.every((m, i) => !i || (m.level || 0) >= (by[i - 1].level || 0)), 'droppedBy sorts by level');
    assert(!droppedBy(-1).length, 'droppedBy: unknown item → []');
    console.log('mobs:', ms.length, '· drops', ms.reduce((n, m) => n + m.items.length, 0),
      '·', common.name, 'dropped by', by.length);
  } else console.log('mobs: no drops.json in RoseData — drop lists disabled');
  console.log('OK — items', itemsById.size, 'quests', quests.length, 'categories', categories.map((c) => `${c.label}:${c.items.length}`).join(' '));
}
