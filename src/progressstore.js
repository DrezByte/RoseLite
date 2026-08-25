'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Versions 2-4 carried fields that v5 no longer supports. Older on-disk
// documents still load; normalization retains only the current allowlist and
// drops deprecated or unknown keys.
const STORAGE_FORMAT = 'roselite-storage';
// The shape an exported backup file carries (Settings → Export).
const VERSION = 5;
const ACCEPTED_VERSIONS = new Set([2, 3, 4, 5]);
const DATA_KEYS = Object.freeze([
  'itemsPinned', 'itemsUnpinned', 'questsDone', 'questsUndone', 'gemTargets', 'kings', 'accountsDeleted',
  'dungeonRuns', 'dungeonMe', 'loot', 'dps', 'calendarNotes', 'shouts'
]);
// Removal tombstone maps (id -> removedAt), same shape/semantics as
// accountsDeleted: itemsPinned/questsDone are bare-id arrays with no per-add
// timestamp, so a plain union can't tell "removed here" from "never added
// there" — the tombstone is what lets a removal survive a merge with a stale
// copy that still has the id. See mergeIdSet below.
const SET_TOMBSTONES = { itemsPinned: 'itemsUnpinned', questsDone: 'questsUndone' };
const PLAY_SESSIONS_CAP = 500;
const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;
const LIMITS = Object.freeze({
  accounts: 100,
  ids: 5000,
  stamps: 5000,
  gemTargets: 100,
  gemOwned: 32,
  dungeonRuns: 1000,
  dungeonRows: 24,
  lootMobs: 2000,
  lootDrops: 1000,
  lootEntries: 10000,
  lootPrices: 2000,
  trackerSessions: 200,
  calendarNotes: 5000,
  shouts: 200
});
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SHOUT_CHANNELS = new Set(['', '/s ', '/t ', '/p ', '/nc ', '/nz ', '!']);
const DUNGEON_STATS = Object.freeze(['deaths', 'kills', 'dmgIn', 'dmgRcv', 'healIn', 'healRcv', 'reflect', 'block']);
const INVALID = Symbol('invalid');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function isDangerousKey(value) {
  return typeof value === 'string' && DANGEROUS_KEYS.has(value.toLowerCase());
}

function ownValue(source, key) {
  if (!isObject(source) || isDangerousKey(key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function ownEntries(value, cap = Infinity) {
  if (!isObject(value)) return [];
  const entries = [];
  for (const key of Object.keys(value)) {
    if (entries.length >= cap) break;
    if (isDangerousKey(key)) continue;
    const entryValue = ownValue(value, key);
    if (entryValue !== undefined) entries.push([key, entryValue]);
  }
  return entries;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function boundedString(value, max, { trim = false, allowNewlines = false } = {}) {
  if (typeof value !== 'string') return null;
  let result = trim ? value.trim() : value;
  const controls = allowNewlines
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
    : /[\u0000-\u001F\u007F]/;
  if (controls.test(result)) return null;
  if (result.length > max) result = result.slice(0, max);
  return result;
}

function displayString(value, max, options = {}) {
  const result = boundedString(value, max, options);
  if (result === null || /[<>]/.test(result) || /\bon[a-z]+\s*=|javascript\s*:/i.test(result)) return null;
  return result;
}

function attributeString(value, max, options = {}) {
  const result = displayString(value, max, options);
  return result !== null && !result.includes('"') ? result : null;
}

function finiteNumber(value, { min = -MAX_SAFE_COUNT, max = MAX_SAFE_COUNT, integer = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return null;
  return number;
}

function optionalFiniteField(source, key, fallback, options) {
  const value = ownValue(source, key);
  if (value === undefined) return fallback;
  const number = finiteNumber(value, options);
  return number === null ? INVALID : number;
}

function isValidEmail(value) {
  if (typeof value !== 'string' || !value || value.length > 120 || /[<>"\s]/.test(value)) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value)
    && !value.includes('..');
}

function normalizeEmail(value) {
  const email = boundedString(value, 120, { trim: true });
  if (email === null) return null;
  const normalized = email.toLowerCase();
  return isValidEmail(normalized) && !isDangerousKey(normalized) ? normalized : null;
}

function normalizeIcon(value) {
  const icon = boundedString(value, 240, { trim: true });
  if (icon === null || !icon) return '';
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(icon)) return '';
  return icon.split('/').some((part) => part === '.' || part === '..') ? '' : icon;
}

function normalizeId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const id = boundedString(value, 128, { trim: true });
  if (id === null || !id || isDangerousKey(id) || !/^[A-Za-z0-9_.:+/-]+$/.test(id)) return null;
  return id;
}

function normalizeIdKey(value) {
  const id = normalizeId(value);
  return id === null ? null : String(id);
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (result.length >= LIMITS.ids) break;
    const id = normalizeId(raw);
    if (id === null || seen.has(String(id))) continue;
    seen.add(String(id));
    result.push(id);
  }
  return result;
}

function normalizeStampMap(value, keyNormalizer = normalizeIdKey) {
  const result = {};
  for (const [rawKey, rawStamp] of ownEntries(value, LIMITS.stamps)) {
    const key = keyNormalizer(rawKey);
    const stamp = finiteNumber(rawStamp, { min: 0 });
    if (key === null || isDangerousKey(key) || stamp === null) continue;
    if (!Object.hasOwn(result, key) || stamp > result[key]) result[key] = stamp;
  }
  return result;
}

function normalizeGemTargets(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (result.length >= LIMITS.gemTargets) break;
    const source = asObject(raw);
    const id = normalizeId(ownValue(source, 'id'));
    const qty = finiteNumber(ownValue(source, 'qty'), { min: 1, max: 1000000, integer: true });
    if (id === null || qty === null || seen.has(String(id))) continue;
    const owned = {};
    for (const [rawRank, rawCount] of ownEntries(ownValue(source, 'owned'), LIMITS.gemOwned)) {
      const rank = finiteNumber(rawRank, { min: 1, max: 99, integer: true });
      const count = finiteNumber(rawCount, { min: 0, max: 1000000, integer: true });
      if (rank === null || count === null) continue;
      owned[String(rank)] = count;
    }
    seen.add(String(id));
    result.push({ id, qty, owned });
  }
  return result;
}

function normalizeDungeonRow(value) {
  const source = asObject(value);
  const name = attributeString(ownValue(source, 'name'), 40, { trim: true });
  if (!name || !/^[\p{L}\p{N}_-]+$/u.test(name)) return null;
  const cls = displayString(ownValue(source, 'cls'), 64, { trim: true });
  if (cls === null) return null;
  const row = { name, cls: cls || '—' };
  for (const key of DUNGEON_STATS) {
    const number = optionalFiniteField(source, key, 0, { min: 0, integer: true });
    if (number === INVALID) return null;
    row[key] = number;
  }
  return row;
}

function normalizeDungeonRuns(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (result.length >= LIMITS.dungeonRuns) break;
    const source = asObject(raw);
    const id = normalizeId(ownValue(source, 'id'));
    const dungeon = boundedString(ownValue(source, 'dungeon'), 64, { trim: true });
    const at = finiteNumber(ownValue(source, 'at'), { min: 0 });
    const seconds = finiteNumber(ownValue(source, 'seconds'), { min: 0, max: 2592000, integer: true });
    const rawRows = ownValue(source, 'rows');
    if (id === null || seen.has(String(id)) || dungeon === null || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(dungeon)
      || at === null || seconds === null || !Array.isArray(rawRows)) continue;
    const rows = rawRows.slice(0, LIMITS.dungeonRows).map(normalizeDungeonRow).filter(Boolean);
    if (!rows.length) continue;
    const rawMe = ownValue(source, 'me');
    const me = rawMe === undefined ? '' : attributeString(rawMe, 40, { trim: true });
    if (me === null || (me && !/^[\p{L}\p{N}_-]+$/u.test(me))) continue;
    seen.add(String(id));
    result.push({ id, dungeon, at, seconds, me, rows });
  }
  return result;
}

function normalizeItemKey(value) {
  const key = boundedString(value, 32, { trim: true });
  return key !== null && /^\d{1,4}:\d{1,9}$/.test(key) ? key : null;
}

function normalizePrice(value) {
  const source = asObject(value);
  const name = displayString(ownValue(source, 'name'), 128, { trim: true });
  if (!name) return null;
  const result = { name };
  for (const key of ['npc', 'market']) {
    const raw = ownValue(source, key);
    if (raw === null || raw === undefined) result[key] = null;
    else {
      const number = finiteNumber(raw, { min: 0 });
      if (number === null) return null;
      result[key] = number;
    }
  }
  result.npcOnly = ownValue(source, 'npcOnly') === true;
  return result;
}

function normalizePrices(value) {
  const result = {};
  for (const [rawKey, rawPrice] of ownEntries(value, LIMITS.lootPrices)) {
    const key = normalizeItemKey(rawKey);
    const price = normalizePrice(rawPrice);
    if (key !== null && price) result[key] = price;
  }
  return result;
}

function normalizeLootEntries(value, prices) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const raw of value) {
    if (result.length >= LIMITS.lootEntries) break;
    const source = asObject(raw);
    const at = finiteNumber(ownValue(source, 'at'), { min: 0 });
    const key = normalizeItemKey(ownValue(source, 'key'));
    if (at !== null && key !== null && Object.hasOwn(prices, key)) result.push({ at, key });
  }
  return result;
}

function normalizeLootSession(value, saved) {
  if (!isObject(value)) return null;
  const prices = normalizePrices(ownValue(value, 'prices'));
  const entries = normalizeLootEntries(ownValue(value, 'entries'), prices);
  const rawStart = ownValue(value, 'startAt');
  const startAt = rawStart === null || rawStart === undefined ? null : finiteNumber(rawStart, { min: 0 });
  if (startAt === null && rawStart !== null && rawStart !== undefined) return null;
  const result = { startAt, entries, prices };
  if (saved) {
    const name = displayString(ownValue(value, 'name'), 40, { trim: true });
    const savedAt = finiteNumber(ownValue(value, 'savedAt'), { min: 0 });
    if (!name || savedAt === null) return null;
    result.name = name;
    result.savedAt = savedAt;
  }
  return result;
}

function normalizeLoot(value) {
  const source = asObject(value);
  const result = {};
  const rawMobs = ownValue(source, 'mobs');
  if (isObject(rawMobs)) {
    const mobs = {};
    for (const [rawId, rawMob] of ownEntries(rawMobs, LIMITS.lootMobs)) {
      if (!/^\d{1,10}$/.test(rawId)) continue;
      const mob = asObject(rawMob);
      const name = displayString(ownValue(mob, 'name'), 128, { trim: true });
      const kills = finiteNumber(ownValue(mob, 'kills'), { min: 0, integer: true });
      if (!name || kills === null) continue;
      const drops = {};
      for (const [rawKey, rawCount] of ownEntries(ownValue(mob, 'drops'), LIMITS.lootDrops)) {
        const key = normalizeItemKey(rawKey);
        const count = finiteNumber(rawCount, { min: 0, integer: true });
        if (key !== null && count !== null) drops[key] = count;
      }
      mobs[rawId] = { name, kills, drops };
    }
    result.mobs = mobs;
  }
  const session = normalizeLootSession(ownValue(source, 'session'), false);
  if (session) result.session = session;
  const rawSessions = ownValue(source, 'sessions');
  if (Array.isArray(rawSessions)) result.sessions = rawSessions.slice(0, LIMITS.trackerSessions)
    .map((entry) => normalizeLootSession(entry, true)).filter(Boolean);
  return result;
}

function normalizeDpsSession(value, saved) {
  if (!isObject(value)) return null;
  const startRaw = ownValue(value, 'startAt');
  const startAt = startRaw === null || startRaw === undefined ? null : finiteNumber(startRaw, { min: 0 });
  if (startAt === null && startRaw !== null && startRaw !== undefined) return null;
  const result = { startAt };
  for (const key of ['lastAt', 'combatMs', 'out', 'best']) {
    const number = optionalFiniteField(value, key, 0, { min: 0 });
    if (number === INVALID) return null;
    result[key] = number;
  }
  if (saved) {
    const name = displayString(ownValue(value, 'name'), 40, { trim: true });
    const savedAt = finiteNumber(ownValue(value, 'savedAt'), { min: 0 });
    if (!name || savedAt === null) return null;
    result.name = name;
    result.savedAt = savedAt;
  }
  return result;
}

function normalizeDps(value) {
  const source = asObject(value);
  const result = {};
  const session = normalizeDpsSession(ownValue(source, 'session'), false);
  if (session) result.session = session;
  const rawSessions = ownValue(source, 'sessions');
  if (Array.isArray(rawSessions)) result.sessions = rawSessions.slice(0, LIMITS.trackerSessions)
    .map((entry) => normalizeDpsSession(entry, true)).filter(Boolean);
  return result;
}

function normalizeCalendarNotes(value) {
  const result = {};
  for (const [key, rawNote] of ownEntries(value, LIMITS.calendarNotes)) {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
    if (!match) continue;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1970 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    const note = boundedString(rawNote, 10000, { allowNewlines: true });
    if (note !== null && note.trim()) result[key] = note;
  }
  return result;
}

function normalizeShouts(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const raw of value) {
    if (result.length >= LIMITS.shouts) break;
    const source = asObject(raw);
    const name = displayString(ownValue(source, 'name'), 40, { trim: true });
    const text = boundedString(ownValue(source, 'text'), 1000, { trim: true, allowNewlines: true });
    const rawChannel = ownValue(source, 'channel');
    const channel = rawChannel === undefined || rawChannel === null ? '' : boundedString(rawChannel, 8);
    if (!name || !text || channel === null || !SHOUT_CHANNELS.has(channel)) continue;
    result.push({ name, text, ...(channel ? { channel } : {}) });
  }
  return result;
}

function emptyData() {
  return {
    itemsPinned: [], itemsUnpinned: {}, questsDone: [], questsUndone: {}, gemTargets: [], kings: {},
    accountsDeleted: {}, dungeonRuns: [], dungeonMe: '', loot: {}, dps: {},
    calendarNotes: {}, shouts: []
  };
}

function cleanData(value) {
  const source = asObject(value);
  const dungeonMe = attributeString(ownValue(source, 'dungeonMe'), 40, { trim: true });
  return {
    itemsPinned: normalizeIdArray(ownValue(source, 'itemsPinned')),
    itemsUnpinned: normalizeStampMap(ownValue(source, 'itemsUnpinned')),
    questsDone: normalizeIdArray(ownValue(source, 'questsDone')),
    questsUndone: normalizeStampMap(ownValue(source, 'questsUndone')),
    gemTargets: normalizeGemTargets(ownValue(source, 'gemTargets')),
    kings: normalizeStampMap(ownValue(source, 'kings')),
    accountsDeleted: normalizeStampMap(ownValue(source, 'accountsDeleted'), normalizeEmail),
    dungeonRuns: normalizeDungeonRuns(ownValue(source, 'dungeonRuns')),
    dungeonMe: dungeonMe && /^[\p{L}\p{N}_-]+$/u.test(dungeonMe) ? dungeonMe : '',
    loot: normalizeLoot(ownValue(source, 'loot')),
    dps: normalizeDps(ownValue(source, 'dps')),
    calendarNotes: normalizeCalendarNotes(ownValue(source, 'calendarNotes')),
    shouts: normalizeShouts(ownValue(source, 'shouts'))
  };
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const token = JSON.stringify(value);
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  }).map(clone);
}

function deduplicateById(first, second) {
  const result = [];
  const seen = new Set();
  for (const value of [...first, ...second]) {
    const token = isObject(value) && value.id !== undefined
      ? `id:${String(value.id)}`
      : `value:${JSON.stringify(value)}`;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(clone(value));
  }
  return result;
}

// Shared shape for every id/email -> timestamp map (accountsDeleted, kings,
// achievements, the unpin/undone tombstones below): union both sides, keeping
// whichever timestamp `isBetter` prefers on a collision.
function mergeStampMap(local, incoming, isBetter) {
  const result = { ...local };
  for (const [key, incomingValue] of ownEntries(incoming)) {
    if (isDangerousKey(key)) continue;
    const hasLocal = Object.hasOwn(result, key);
    const localValue = hasLocal ? result[key] : undefined;
    if (!hasLocal) { result[key] = clone(incomingValue); continue; }
    const localNumber = Number(localValue);
    const incomingNumber = Number(incomingValue);
    if (Number.isFinite(incomingNumber) && (!Number.isFinite(localNumber) || isBetter(incomingNumber, localNumber))) {
      result[key] = clone(incomingValue);
    }
  }
  return result;
}

// itemsPinned/questsDone are bare-id arrays: a plain union can never remove an
// id, because a side that un-pinned/un-marked it looks identical to a side
// that never had it. The paired tombstone map (itemsUnpinned/questsUndone)
// records removals so they stick; an id with a tombstone is dropped from the
// merged array UNLESS both sides currently list it (both independently
// re-added it after the tombstone — see the toggle code in overlay.js, which
// clears the tombstone on re-add so this case is rare in practice).
function mergeIdSet(local, incoming, localTomb, incomingTomb) {
  const tomb = mergeStampMap(localTomb, incomingTomb, (inc, loc) => inc > loc);
  const localSet = new Set(local.map(String));
  const incomingSet = new Set(incoming.map(String));
  const list = uniqueValues([...local, ...incoming]).filter((value) => {
    if (!Object.hasOwn(tomb, String(value))) return true;
    return localSet.has(String(value)) && incomingSet.has(String(value));
  });
  return { list, tomb };
}

function mergeData(localValue, incomingValue) {
  const local = cleanData(localValue);
  const incoming = cleanData(incomingValue);
  const result = emptyData();

  for (const [key, tombKey] of Object.entries(SET_TOMBSTONES)) {
    const merged = mergeIdSet(local[key], incoming[key], local[tombKey], incoming[tombKey]);
    result[key] = merged.list;
    result[tombKey] = merged.tomb;
  }
  result.dungeonRuns = deduplicateById(local.dungeonRuns, incoming.dungeonRuns);
  // Account delete tombstones union latest-wins, same as kings below.
  result.accountsDeleted = mergeStampMap(local.accountsDeleted, incoming.accountsDeleted, (inc, loc) => inc > loc);
  result.kings = mergeStampMap(local.kings, incoming.kings, (inc, loc) => inc > loc);
  result.gemTargets = incoming.gemTargets.length ? clone(incoming.gemTargets) : clone(local.gemTargets);
  result.dungeonMe = incoming.dungeonMe || local.dungeonMe;
  for (const key of ['loot', 'dps', 'calendarNotes']) result[key] = { ...local[key], ...incoming[key] };
  result.shouts = uniqueValues([...local.shouts, ...incoming.shouts]);
  return cleanData(result);
}

function cleanAccountEntry(value) {
  const source = asObject(value);
  const email = normalizeEmail(ownValue(source, 'email'));
  if (!email) return null;
  const rawNick = ownValue(source, 'nick');
  const normalizedNick = rawNick === undefined ? '' : attributeString(rawNick, 40, { trim: true });
  const entry = {
    email,
    nick: normalizedNick || '',
    icon: normalizeIcon(ownValue(source, 'icon'))
  };
  // See presentAccounts / data.accountsDeleted: addedAt lets a re-add beat an
  // earlier delete tombstone. Absent/0 on legacy entries is fine (a tombstone
  // always beats 0), so it's only stored when set.
  const addedAt = finiteNumber(ownValue(source, 'addedAt'), { min: Number.MIN_VALUE });
  if (addedAt !== null) entry.addedAt = addedAt;
  return entry;
}

// Drop accounts whose delete tombstone (data.accountsDeleted) is at least as new
// as their addedAt. No tombstone → present; re-add (addedAt > tombstone) → present.
function presentAccounts(accounts, deletedMap) {
  const deleted = asObject(deletedMap);
  return accounts.filter((account) => {
    const deletedAt = Object.hasOwn(deleted, account.email) ? deleted[account.email] : undefined;
    return !Number.isFinite(Number(deletedAt)) || (Number(account.addedAt) || 0) > Number(deletedAt);
  });
}

function cleanAccounts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (result.length >= LIMITS.accounts) break;
    const entry = cleanAccountEntry(raw);
    if (!entry || seen.has(entry.email)) continue;
    seen.add(entry.email);
    result.push(entry);
  }
  return result;
}

function normalizeProgressPayload(value) {
  const source = asObject(value);
  return {
    accounts: cleanAccounts(ownValue(source, 'accounts')),
    data: cleanData(ownValue(source, 'data'))
  };
}

function mergeAccounts(local, incoming) {
  const byEmail = new Map();
  for (const account of cleanAccounts(local)) byEmail.set(account.email, { ...account });
  for (const account of cleanAccounts(incoming)) {
    const existing = byEmail.get(account.email);
    if (!existing) byEmail.set(account.email, { ...account });
    else {
      const merged = {
        email: existing.email,
        nick: existing.nick || account.nick,
        icon: existing.icon || account.icon
      };
      const addedAt = Math.max(Number(existing.addedAt) || 0, Number(account.addedAt) || 0);
      if (addedAt > 0) merged.addedAt = addedAt;
      byEmail.set(account.email, merged);
    }
  }
  return [...byEmail.values()];
}

function cleanSession(value) {
  const source = asObject(value);
  const id = normalizeId(ownValue(source, 'id'));
  const startedAt = finiteNumber(ownValue(source, 'startedAt'), { min: 0 });
  const rawEndedAt = ownValue(source, 'endedAt');
  const endedAt = rawEndedAt === null || rawEndedAt === undefined ? null : finiteNumber(rawEndedAt, { min: 0 });
  const durationMs = finiteNumber(ownValue(source, 'durationMs'), { min: 0 });
  const rawReason = ownValue(source, 'reason');
  const reason = rawReason === undefined ? 'unknown' : displayString(rawReason, 64, { trim: true });
  if (id === null || startedAt === null || (endedAt === null && rawEndedAt !== null && rawEndedAt !== undefined)
    || durationMs === null || reason === null) return null;
  return {
    id: String(id),
    startedAt,
    endedAt,
    durationMs,
    reason: reason || 'unknown',
    ...(ownValue(source, 'synthetic') === true ? { synthetic: true } : {})
  };
}

function cleanSessions(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(-PLAY_SESSIONS_CAP).map(cleanSession).filter(Boolean);
}

function validateStorageDocument(value) {
  if (!isObject(value) || ownValue(value, 'format') !== STORAGE_FORMAT || !ACCEPTED_VERSIONS.has(ownValue(value, 'version'))) {
    throw new Error('Unsupported or malformed RoseLite storage document');
  }
  const device = ownValue(value, 'device');
  if (!isObject(device) || normalizeId(ownValue(device, 'id')) === null) {
    throw new Error('RoseLite storage document has no valid device id');
  }
}

function normalizeDocument(value) {
  validateStorageDocument(value);
  const device = ownValue(value, 'device');
  const payload = normalizeProgressPayload(value);
  return {
    format: STORAGE_FORMAT,
    version: VERSION,
    device: {
      id: String(normalizeId(ownValue(device, 'id'))),
      createdAt: finiteNumber(ownValue(device, 'createdAt'), { min: 0 }) ?? 0
    },
    accounts: payload.accounts,
    data: payload.data,
    playSessions: cleanSessions(ownValue(value, 'playSessions')),
    updatedAt: finiteNumber(ownValue(value, 'updatedAt'), { min: 0 }) ?? 0
  };
}

function writeAtomic(file, document) {
  const temporary = `${file}.tmp`;
  const backup = `${file}.bak`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  // ponytail: fsync is best-effort. 'r+' because Windows FlushFileBuffers needs write
  // access, but AV / Controlled Folder Access / OneDrive can still EPERM — losing
  // durability on a power cut beats crashing the app. Ceiling: no torn-write guarantee;
  // the .bak rename below is the real safety net.
  try {
    const handle = fs.openSync(temporary, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  } catch {}

  try {
    if (fs.existsSync(file)) {
      fs.rmSync(backup, { force: true });
      fs.renameSync(file, backup);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (!fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file);
    throw error;
  }
}

function createProgressStore({ file, now = Date.now, id = () => crypto.randomUUID() } = {}) {
  if (typeof file !== 'string' || !file) throw new TypeError('createProgressStore requires a file path');
  const clock = typeof now === 'function' ? now : () => now;
  const makeId = typeof id === 'function' ? id : () => id;
  let document = null;
  let dirty = false;
  let activeSession = null;

  function timestamp() {
    const value = Number(clock());
    if (!Number.isFinite(value)) throw new Error('Progress store clock returned an invalid timestamp');
    return value;
  }

  function nextId() {
    const value = String(makeId());
    if (!value) throw new Error('Progress store id generator returned an empty id');
    return value;
  }

  function newDocument() {
    const createdAt = timestamp();
    return {
      format: STORAGE_FORMAT,
      version: VERSION,
      device: { id: nextId(), createdAt },
      accounts: [],
      data: emptyData(),
      playSessions: [],
      updatedAt: createdAt
    };
  }

  function ensureLoaded() {
    if (!document) load();
  }

  function readDocument(candidate) {
    return normalizeDocument(JSON.parse(fs.readFileSync(candidate, 'utf8')));
  }

  function load() {
    const backup = `${file}.bak`;
    if (!fs.existsSync(file)) {
      if (fs.existsSync(backup)) {
        try {
          document = readDocument(backup);
          dirty = true;
          return snapshot();
        } catch (error) {
          throw new Error(`RoseLite storage backup is unreadable: ${error.message}`);
        }
      }
      document = newDocument();
      dirty = true;
      return snapshot();
    }

    try {
      document = readDocument(file);
      dirty = false;
      return snapshot();
    } catch (primaryError) {
      if (!fs.existsSync(backup)) {
        throw new Error(`RoseLite storage is unreadable: ${primaryError.message}`);
      }
      try {
        document = readDocument(backup);
        dirty = true;
        return snapshot();
      } catch (backupError) {
        throw new Error(`RoseLite storage and backup are unreadable: ${primaryError.message}; ${backupError.message}`);
      }
    }
  }

  function snapshot() {
    ensureLoaded();
    return clone(document);
  }

  // The renderer holds canonical localStorage state; this ingests its flat
  // snapshot into the main-side durable mirror on every boot. Merge (not
  // overwrite) so a main-side file that's behind — or a renderer state that's
  // behind the last flush — never clobbers the other.
  function ingestLocal(payload) {
    ensureLoaded();
    const source = normalizeProgressPayload(payload);
    document.data = mergeData(document.data, source.data);
    document.accounts = presentAccounts(mergeAccounts(document.accounts, source.accounts), document.data.accountsDeleted);
    document = normalizeDocument(document);
    document.updatedAt = timestamp();
    dirty = true;
    return snapshot();
  }

  function startPlaySession() {
    ensureLoaded();
    if (activeSession) return clone(activeSession);
    const startedAt = timestamp();
    activeSession = {
      id: nextId(),
      startedAt,
      checkpointAt: startedAt,
      durationMs: 0
    };
    return clone(activeSession);
  }

  function checkpointPlaySession() {
    if (!activeSession) return null;
    const checkpointAt = timestamp();
    activeSession.durationMs += Math.max(0, checkpointAt - activeSession.checkpointAt);
    activeSession.checkpointAt = checkpointAt;
    return clone(activeSession);
  }

  function endPlaySession(reason = 'ended') {
    if (!activeSession) return null;
    checkpointPlaySession();
    const session = {
      id: activeSession.id,
      startedAt: activeSession.startedAt,
      endedAt: activeSession.checkpointAt,
      durationMs: activeSession.durationMs,
      reason: typeof reason === 'string' ? reason : 'ended'
    };
    document.playSessions.push(session);
    document.playSessions = document.playSessions.slice(-PLAY_SESSIONS_CAP);
    activeSession = null;
    document.updatedAt = timestamp();
    dirty = true;
    return clone(session);
  }


  function flush() {
    ensureLoaded();
    if (!dirty) return false;
    writeAtomic(file, document);
    dirty = false;
    return true;
  }

  return {
    load,
    snapshot,
    ingestLocal,
    startPlaySession,
    checkpointPlaySession,
    endPlaySession,
    flush
  };
}

module.exports = {
  createProgressStore,
  normalizeProgressPayload,
  STORAGE_FORMAT,
  VERSION,
  DATA_KEYS
};
