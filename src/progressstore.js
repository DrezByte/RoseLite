'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// v2: one RoseLite account (Discord login) tracks one set of progress, shared
// across every ROSE game account launched from it. `device` is local-only
// identity (never leaves this PC).
// v3/v4 folded the Collection and the profile INTO the envelope; v5 takes both
// back out — the card game moved to its own project and the profile went with
// it. An old on-disk document still loads; cleanData drops what it no longer
// knows, so those keys disappear on the next normalize.
const STORAGE_FORMAT = 'roselite-storage';
// The shape an exported backup file carries (Settings → Export).
const VERSION = 5;
const ACCEPTED_VERSIONS = new Set([2, 3, 4, 5]);
const DATA_KEYS = Object.freeze([
  'itemsPinned', 'itemsUnpinned', 'questsDone', 'questsUndone', 'gemTargets', 'kings', 'accountsDeleted',
  'dungeonRuns', 'dungeonMe', 'loot', 'dps', 'calendarNotes', 'shouts'
]);
const ARRAY_KEYS = new Set(['itemsPinned', 'questsDone', 'gemTargets', 'dungeonRuns', 'shouts']);
// Removal tombstone maps (id -> removedAt), same shape/semantics as
// accountsDeleted: itemsPinned/questsDone are bare-id arrays with no per-add
// timestamp, so a plain union can't tell "removed here" from "never added
// there" — the tombstone is what lets a removal survive a merge with a stale
// copy that still has the id. See mergeIdSet below.
const SET_TOMBSTONES = { itemsPinned: 'itemsUnpinned', questsDone: 'questsUndone' };
const PLAY_SESSIONS_CAP = 500;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isValidEmail(value) {
  if (typeof value !== 'string' || !value || value.length > 254) return false;
  const at = value.indexOf('@');
  return at > 0 && at < value.length - 1 && at === value.lastIndexOf('@');
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
  const result = emptyData();
  for (const key of DATA_KEYS) {
    if (!(key in source)) continue;
    if (ARRAY_KEYS.has(key)) result[key] = Array.isArray(source[key]) ? clone(source[key]) : [];
    else if (key === 'dungeonMe') result[key] = typeof source[key] === 'string' ? source[key] : '';
    else result[key] = clone(asObject(source[key]));
  }
  return result;
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
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const localValue = result[key];
    if (localValue === undefined) { result[key] = clone(incomingValue); continue; }
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
    if (!(String(value) in tomb)) return true;
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
  return result;
}

function cleanAccountEntry(value) {
  const source = asObject(value);
  const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return null;
  const entry = {
    email,
    nick: typeof source.nick === 'string' ? source.nick : '',
    icon: typeof source.icon === 'string' ? source.icon : ''
  };
  // See presentAccounts / data.accountsDeleted: addedAt lets a re-add beat an
  // earlier delete tombstone. Absent/0 on legacy entries is fine (a tombstone
  // always beats 0), so it's only stored when set.
  const addedAt = Number(source.addedAt);
  if (Number.isFinite(addedAt) && addedAt > 0) entry.addedAt = addedAt;
  return entry;
}

// Drop accounts whose delete tombstone (data.accountsDeleted) is at least as new
// as their addedAt. No tombstone → present; re-add (addedAt > tombstone) → present.
function presentAccounts(accounts, deletedMap) {
  const deleted = asObject(deletedMap);
  return accounts.filter((account) => {
    const deletedAt = deleted[account.email];
    return !Number.isFinite(Number(deletedAt)) || (Number(account.addedAt) || 0) > Number(deletedAt);
  });
}

function cleanAccounts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    const entry = cleanAccountEntry(raw);
    if (!entry || seen.has(entry.email)) continue;
    seen.add(entry.email);
    result.push(entry);
  }
  return result;
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
  if (source.id === undefined || !Number.isFinite(Number(source.startedAt))) return null;
  return {
    id: String(source.id),
    startedAt: Number(source.startedAt),
    endedAt: Number.isFinite(Number(source.endedAt)) ? Number(source.endedAt) : null,
    durationMs: Math.max(0, Number(source.durationMs) || 0),
    reason: typeof source.reason === 'string' ? source.reason : 'unknown',
    ...(source.synthetic === true ? { synthetic: true } : {})
  };
}

function cleanSessions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(cleanSession).filter(Boolean);
}

function validateStorageDocument(value) {
  if (!isObject(value) || value.format !== STORAGE_FORMAT || !ACCEPTED_VERSIONS.has(value.version)) {
    throw new Error('Unsupported or malformed RoseLite storage document');
  }
  if (!isObject(value.device) || typeof value.device.id !== 'string' || !value.device.id) {
    throw new Error('RoseLite storage document has no valid device id');
  }
}

function normalizeDocument(value) {
  validateStorageDocument(value);
  return {
    format: STORAGE_FORMAT,
    version: VERSION,
    device: {
      id: value.device.id,
      createdAt: Number.isFinite(Number(value.device.createdAt)) ? Number(value.device.createdAt) : 0
    },
    accounts: cleanAccounts(value.accounts),
    data: cleanData(value.data),
    playSessions: cleanSessions(value.playSessions),
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0
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
    const source = asObject(payload);
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
  STORAGE_FORMAT,
  VERSION,
  DATA_KEYS
};
