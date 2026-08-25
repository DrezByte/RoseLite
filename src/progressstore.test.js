'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProgressStore, normalizeProgressPayload, VERSION } = require('./progressstore');

function testStore(file, times, ids) {
  let timeIndex = 0;
  let idIndex = 0;
  return createProgressStore({
    file,
    now: () => times[Math.min(timeIndex++, times.length - 1)],
    id: () => ids[idIndex++] || `generated-${idIndex}`
  });
}

function dungeonRun(id, at, seconds = 90) {
  return {
    id, dungeon: 'other', at, seconds, me: 'RoseKnight',
    rows: [{ name: 'RoseKnight', cls: 'Raider', deaths: 0, kills: 4, dmgIn: 225551,
      dmgRcv: 20226, healIn: 10, healRcv: 20, reflect: 0, block: 2 }]
  };
}

function assertPlainOutput(value, pathName = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPlainOutput(entry, `${pathName}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  assert.strictEqual(Object.getPrototypeOf(value), Object.prototype, `${pathName} must be a plain object`);
  for (const [key, entry] of Object.entries(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key.toLowerCase()), `${pathName}.${key} is prototype-sensitive`);
    assertPlainOutput(entry, `${pathName}.${key}`);
  }
}

function testPayloadNormalization() {
  const representative = normalizeProgressPayload({
    accounts: [{ email: ' Player@Example.test ', nick: "Drez's Main", icon: 'weapon/iron_sword', addedAt: '123' }],
    data: {
      itemsPinned: [10, 'item-11', 10], itemsUnpinned: { 12: '400' },
      questsDone: ['q1', 2], questsUndone: { q2: 401 },
      gemTargets: [{ id: 20, qty: 2, owned: { 1: 3, 2: '4' } }],
      kings: { aqua: '500' }, accountsDeleted: { 'Old@Example.test': 600 },
      dungeonRuns: [dungeonRun(700, 701)], dungeonMe: 'RoseKnight',
      loot: {
        mobs: { 42: { name: 'Jelly Bean', kills: 3, drops: { '12:45': 2 } } },
        session: { startAt: 800, entries: [{ at: 801, key: '12:45' }],
          prices: { '12:45': { name: 'Iron Sword', npc: 10, market: null, npcOnly: true } } },
        sessions: [{ name: 'Jelly farm', savedAt: 900, startAt: 800,
          entries: [{ at: 801, key: '12:45' }],
          prices: { '12:45': { name: 'Iron Sword', npc: 10, market: 15, npcOnly: false } } }]
      },
      dps: {
        session: { startAt: 1000, lastAt: 1010, combatMs: 5000, out: 25000, best: 5000 },
        sessions: [{ name: 'Boss pull', savedAt: 1020, startAt: 1000, lastAt: 1010,
          combatMs: 5000, out: 25000, best: 5000 }]
      },
      calendarNotes: { '2026-8-25': 'Bring 2× keys\nMeet at gate & wait.' },
      shouts: [{ name: 'LF DG', text: 'LF DG [Iron sword] & mats', channel: '/p ' }]
    }
  });

  assert.deepStrictEqual(representative.accounts, [{
    email: 'player@example.test', nick: "Drez's Main", icon: 'weapon/iron_sword', addedAt: 123
  }]);
  assert.deepStrictEqual(representative.data.itemsPinned, [10, 'item-11']);
  assert.deepStrictEqual(representative.data.itemsUnpinned, { 12: 400 });
  assert.deepStrictEqual(representative.data.questsDone, ['q1', 2]);
  assert.deepStrictEqual(representative.data.gemTargets, [{ id: 20, qty: 2, owned: { 1: 3, 2: 4 } }]);
  assert.deepStrictEqual(representative.data.kings, { aqua: 500 });
  assert.deepStrictEqual(representative.data.accountsDeleted, { 'old@example.test': 600 });
  assert.deepStrictEqual(representative.data.dungeonRuns, [dungeonRun(700, 701)]);
  assert.strictEqual(representative.data.loot.mobs['42'].drops['12:45'], 2);
  assert.strictEqual(representative.data.loot.session.prices['12:45'].npcOnly, true);
  assert.strictEqual(representative.data.dps.sessions[0].name, 'Boss pull');
  assert.strictEqual(representative.data.calendarNotes['2026-8-25'], 'Bring 2× keys\nMeet at gate & wait.');
  assert.deepStrictEqual(representative.data.shouts, [{ name: 'LF DG', text: 'LF DG [Iron sword] & mats', channel: '/p ' }]);
  assertPlainOutput(representative);

  const poisonMap = JSON.parse('{"safe":10,"__proto__":11,"prototype":12,"constructor":13}');
  const poisonDrops = JSON.parse('{"12:45":2,"__proto__":3,"constructor":4}');
  const hostile = normalizeProgressPayload({
    accounts: [
      { email: 'bad@example.test', nick: '\" onmouseover=\"globalThis.pwned=1', icon: 'knight' },
      { email: 'icon@example.test', nick: 'Safe', icon: '../../evil\" onerror=\"run' },
      { email: '<img-onerror>@example.test', nick: 'Bad', icon: 'knight' }
    ],
    data: {
      itemsPinned: [1, {}, '__proto__', 'constructor', '<img-onerror=x>'],
      itemsUnpinned: poisonMap,
      questsDone: ['q1', Number.POSITIVE_INFINITY], questsUndone: poisonMap,
      gemTargets: [
        { id: 2, qty: Number.NaN, owned: {} },
        { id: 3, qty: 1, owned: { 1: Number.POSITIVE_INFINITY, 2: 4 } },
        { id: '__proto__', qty: 1, owned: {} }
      ],
      kings: poisonMap,
      accountsDeleted: JSON.parse('{"safe@example.test":20,"__proto__":21,"constructor":22}'),
      dungeonMe: '\" autofocus onfocus=run()',
      dungeonRuns: [
        { ...dungeonRun(10, 20), rows: [
          { ...dungeonRun(10, 20).rows[0], name: '\" onmouseover=run()' },
          dungeonRun(10, 20).rows[0]
        ] },
        { ...dungeonRun(11, 20), seconds: Number.POSITIVE_INFINITY },
        { ...dungeonRun(12, 20), rows: [{ ...dungeonRun(12, 20).rows[0], cls: '<img src=x onerror=run()>' }] }
      ],
      loot: {
        mobs: {
          1: { name: '<img src=x onerror=run()>', kills: 1, drops: poisonDrops },
          2: { name: 'Safe Mob', kills: 2, drops: poisonDrops },
          3: { name: 'Broken Mob', kills: Number.NaN, drops: {} }
        },
        session: { startAt: 30,
          entries: [{ at: 31, key: '12:45' }, { at: 32, key: '9:9' }, { at: Number.NaN, key: '12:45' }],
          prices: {
            '12:45': { name: 'Safe item', npc: 1, market: null },
            '9:9': { name: 'javascript:run()', npc: 1, market: 2 }
          } },
        sessions: [{ name: '<svg onload=run()>', savedAt: 40, startAt: 30, entries: [], prices: {} }]
      },
      dps: {
        session: { startAt: 50, lastAt: 51, combatMs: 1, out: Number.POSITIVE_INFINITY, best: 1 },
        sessions: [
          { name: '\" onfocus=run()', savedAt: 60, startAt: 50, lastAt: 51, combatMs: 1, out: 2, best: 2 },
          { name: 'Safe pull', savedAt: 60, startAt: 50, lastAt: 51, combatMs: 1, out: 2, best: 2 }
        ]
      },
      calendarNotes: { '2026-2-30': 'invalid date', nope: 'invalid key', '2026-8-25': 123 },
      shouts: [
        { name: '<img onerror=run()>', text: 'bad', channel: '' },
        { name: 'Bad channel', text: 'bad', channel: '\" onfocus=run()' },
        { name: 'Safe shout', text: 123, channel: '' }
      ]
    }
  });

  assert.deepStrictEqual(hostile.accounts, [
    { email: 'bad@example.test', nick: '', icon: 'knight' },
    { email: 'icon@example.test', nick: 'Safe', icon: '' }
  ]);
  assert.deepStrictEqual(hostile.data.itemsPinned, [1]);
  assert.deepStrictEqual(hostile.data.itemsUnpinned, { safe: 10 });
  assert.deepStrictEqual(hostile.data.gemTargets, [{ id: 3, qty: 1, owned: { 2: 4 } }]);
  assert.deepStrictEqual(hostile.data.kings, { safe: 10 });
  assert.deepStrictEqual(hostile.data.accountsDeleted, { 'safe@example.test': 20 });
  assert.strictEqual(hostile.data.dungeonMe, '');
  assert.strictEqual(hostile.data.dungeonRuns.length, 1);
  assert.deepStrictEqual(hostile.data.dungeonRuns[0].rows, [dungeonRun(10, 20).rows[0]]);
  assert.deepStrictEqual(Object.keys(hostile.data.loot.mobs), ['2']);
  assert.deepStrictEqual(hostile.data.loot.mobs['2'].drops, { '12:45': 2 });
  assert.deepStrictEqual(hostile.data.loot.session.entries, [{ at: 31, key: '12:45' }]);
  assert.deepStrictEqual(hostile.data.loot.sessions, []);
  assert.strictEqual('session' in hostile.data.dps, false);
  assert.deepStrictEqual(hostile.data.dps.sessions.map((session) => session.name), ['Safe pull']);
  assert.deepStrictEqual(hostile.data.calendarNotes, {});
  assert.deepStrictEqual(hostile.data.shouts, []);
  assert(!/onerror|onmouseover|onfocus|javascript:/i.test(JSON.stringify(hostile)), 'event/HTML payload survived normalization');
  assertPlainOutput(hostile);
  assert.strictEqual({}.pwned, undefined);

  const inheritedData = Object.create({ itemsPinned: [999], kings: { inherited: 1 } });
  assert.deepStrictEqual(normalizeProgressPayload({ data: inheritedData }).data, normalizeProgressPayload({}).data);

  const bounded = normalizeProgressPayload({
    accounts: Array.from({ length: 101 }, (_, i) => ({ email: `p${i}@example.test`, nick: 'n'.repeat(50), icon: 'knight' })),
    data: {
      itemsPinned: Array.from({ length: 5100 }, (_, i) => i),
      calendarNotes: { '2026-1-1': 'x'.repeat(10001) },
      shouts: Array.from({ length: 201 }, (_, i) => ({ name: `Shout ${i}`, text: 'x'.repeat(1001) }))
    }
  });
  assert.strictEqual(bounded.accounts.length, 100);
  assert.strictEqual(bounded.accounts[0].nick.length, 40);
  assert.strictEqual(bounded.data.itemsPinned.length, 5000);
  assert.strictEqual(bounded.data.calendarNotes['2026-1-1'].length, 10000);
  assert.strictEqual(bounded.data.shouts.length, 200);
  assert.strictEqual(bounded.data.shouts[0].text.length, 1000);
}

function run() {
  testPayloadNormalization();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roselite-progressstore-'));
  try {
    const file = path.join(root, 'progress.json');
    const store = testStore(
      file,
      [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
      ['device-uuid', 'session-1']
    );

    const initial = store.load();
    assert.strictEqual(initial.format, 'roselite-storage');
    assert.strictEqual(initial.version, VERSION);
    assert.strictEqual(initial.device.id, 'device-uuid');
    assert.deepStrictEqual(initial.accounts, []);

    const ingested = store.ingestLocal({
      accounts: [{ email: 'Player@Example.test', nick: 'RoseKnight', icon: 'knight' }],
      data: {
        itemsPinned: [10, 11],
        questsDone: ['q1'],
        kings: { aqua: 500 },
        gemTargets: [{ id: 20, qty: 2, owned: { 1: 1 } }],
        dungeonRuns: [dungeonRun('run-1', 1000)],
        dungeonMe: 'RoseKnight',
        deprecatedPayload: { value: 1 },
        deprecatedUpdatedAt: 50,
        forbidden: 'discard me'
      }
    });
    // Unknown fields from older formats never enter the current envelope.
    assert.strictEqual('deprecatedPayload' in ingested.data, false);
    assert.strictEqual('deprecatedUpdatedAt' in ingested.data, false);
    assert.deepStrictEqual(ingested.accounts, [{ email: 'player@example.test', nick: 'RoseKnight', icon: 'knight' }]);
    assert.deepStrictEqual(ingested.data.gemTargets, [{ id: 20, qty: 2, owned: { 1: 1 } }]);
    assert.strictEqual(ingested.data.dungeonMe, 'RoseKnight');
    assert.strictEqual('forbidden' in ingested.data, false);

    store.startPlaySession();
    const checkpoint = store.checkpointPlaySession();
    assert.strictEqual(checkpoint.durationMs, 1);
    const session = store.endPlaySession('game-closed');
    assert.strictEqual(session.durationMs, 2);
    assert.strictEqual(session.reason, 'game-closed');

    // A second local envelope: a new account and more progress to merge.
    const remoteEnvelope = {
      accounts: [
        { email: 'player@example.test', nick: '', icon: '' },
        { email: 'second@example.test', nick: 'Alt', icon: '' }
      ],
      data: {
        itemsPinned: [11, 12], questsDone: ['q1', 'q2'], gemTargets: [],
        kings: { aqua: 450, jelly: 700 }, dungeonRuns: [dungeonRun('run-1', 1001, 999), dungeonRun('run-2', 1002, 80)],
        dungeonMe: '', loot: {}, dps: {}, calendarNotes: {}, shouts: [],
        deprecatedPayload: { value: 99 }, deprecatedUpdatedAt: 999,
      },
    };
    const merged = store.ingestLocal(remoteEnvelope);
    assert.deepStrictEqual(merged.data.itemsPinned, [10, 11, 12]);
    assert.deepStrictEqual(merged.data.questsDone, ['q1', 'q2']);
    assert.deepStrictEqual(merged.data.kings, { aqua: 500, jelly: 700 });
    assert.deepStrictEqual(merged.data.gemTargets, [{ id: 20, qty: 2, owned: { 1: 1 } }]);
    assert.deepStrictEqual(merged.data.dungeonRuns.map((run) => run.id), ['run-1', 'run-2']);
    assert.strictEqual(merged.data.dungeonRuns[0].seconds, 90);   // first copy of a run id still wins
    // nick/icon: local non-empty values win over the incoming blanks.
    assert.deepStrictEqual(merged.accounts.find((a) => a.email === 'player@example.test'),
      { email: 'player@example.test', nick: 'RoseKnight', icon: 'knight' });
    assert.strictEqual(merged.accounts.some((a) => a.email === 'second@example.test'), true);
    // v4: cards is no longer part of the envelope at all (moved to its own tables).
    assert.strictEqual('cards' in merged.data, false);

    // A remote delete tombstone removes the account and survives a stale re-add
    // (regression: account merge used to be union-only, so deletes resurrected).
    const afterDelete = store.ingestLocal({ accounts: [],
      data: { accountsDeleted: { 'second@example.test': 10000 } }
    });
    assert.strictEqual(afterDelete.accounts.some((a) => a.email === 'second@example.test'), false);
    const stale = store.ingestLocal({
      accounts: [{ email: 'second@example.test', nick: 'Alt', icon: '' }],
      data: {}
    });
    assert.strictEqual(stale.accounts.some((a) => a.email === 'second@example.test'), false);
    const readded = store.ingestLocal({
      accounts: [{ email: 'second@example.test', nick: 'Alt', icon: '', addedAt: 20000 }],
      data: {}
    });
    assert.strictEqual(readded.accounts.some((a) => a.email === 'second@example.test'), true);

    // Regression: itemsPinned/questsDone used to merge as a pure union, so
    // un-pinning an item (or un-marking a quest done) could never stick — the
    // id came right back the moment it merged with any side that still had it.
    // itemsPinned is currently [10, 11, 12] (from the earlier union merges).
    const unpinned = store.ingestLocal({
      data: { itemsPinned: [10, 12], itemsUnpinned: { 11: 900000 } }
    });
    assert.deepStrictEqual(unpinned.data.itemsPinned.sort(), [10, 12]);
    // A stale remote copy that never saw the unpin (no tombstone, item 11 still
    // listed) must not resurrect it — the local tombstone wins.
    const staleReunion = store.ingestLocal({ accounts: [],
      data: { itemsPinned: [10, 11, 12], itemsUnpinned: {} }
    });
    assert.deepStrictEqual(staleReunion.data.itemsPinned.sort(), [10, 12]);

    assert.strictEqual(store.flush(), true);
    assert.strictEqual(fs.existsSync(file), true);
    assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
    store.ingestLocal({ data: { shouts: [
      { name: 'LFM', text: 'Looking for members', channel: '/p ' },
      { name: 'WTB', text: 'Buying materials' }
    ] } });
    assert.strictEqual(store.flush(), true);
    assert.strictEqual(fs.existsSync(`${file}.bak`), true);

    const reloaded = createProgressStore({ file, now: () => 999, id: () => 'must-not-replace-device' });
    const persisted = reloaded.load();
    assert.strictEqual(persisted.device.id, 'device-uuid');
    assert.deepStrictEqual(persisted.data.shouts, [
      { name: 'LFM', text: 'Looking for members', channel: '/p ' },
      { name: 'WTB', text: 'Buying materials' }
    ]);

    const corruptFile = path.join(root, 'corrupt.json');
    fs.writeFileSync(corruptFile, '{bad json', 'utf8');
    fs.writeFileSync(`${corruptFile}.bak`, JSON.stringify({ format: 'wrong', version: 2 }), 'utf8');
    assert.throws(
      () => createProgressStore({ file: corruptFile }).load(),
      /storage and backup are unreadable/i
    );

    // A v2 storage file loads cleanly: normalization default-fills what is
    // missing and drops fields the current format no longer knows.
    const v2File = path.join(root, 'v2.json');
    fs.writeFileSync(v2File, JSON.stringify({
      format: 'roselite-storage', version: 2,
      device: { id: 'old-device', createdAt: 1 },
      accounts: [], data: { deprecatedPayload: { value: 5 }, deprecatedUpdatedAt: 10 }, playSessions: [], updatedAt: 1
    }), 'utf8');
    const upgraded = createProgressStore({ file: v2File, now: () => 2000 }).load();
    assert.strictEqual(upgraded.version, VERSION);
    assert.strictEqual('deprecatedPayload' in upgraded.data, false);
    assert.strictEqual('deprecatedUpdatedAt' in upgraded.data, false);

    // Versions 3 and 4 remain accepted too; all accepted documents normalize to v5.
    for (const version of [3, 4]) {
      const acceptedFile = path.join(root, `v${version}.json`);
      fs.writeFileSync(acceptedFile, JSON.stringify({
        format: 'roselite-storage', version,
        device: { id: `device-v${version}`, createdAt: 1 },
        accounts: [], data: {}, playSessions: [], updatedAt: 1
      }), 'utf8');
      assert.strictEqual(createProgressStore({ file: acceptedFile }).load().version, VERSION);
    }
    const unsupportedFile = path.join(root, 'v6.json');
    fs.writeFileSync(unsupportedFile, JSON.stringify({
      format: 'roselite-storage', version: 6,
      device: { id: 'future-device', createdAt: 1 }, data: {}
    }), 'utf8');
    assert.throws(() => createProgressStore({ file: unsupportedFile }).load(), /storage is unreadable/i);

    // Regression: mergeAccounts' existing-account branch used to rebuild the
    // entry as { email, nick, icon }, dropping addedAt. Once dropped,
    // presentAccounts treats addedAt as 0, so any tombstone (even a stale one
    // predating the account entirely) would hide it again on the next merge.
    const addedAtFile = path.join(root, 'addedat.json');
    const addedAtStore = testStore(addedAtFile, [100, 200, 300, 400], ['addedat-device']);
    addedAtStore.load();
    addedAtStore.ingestLocal({
      accounts: [{ email: 'third@example.test', nick: 'Third', icon: '', addedAt: 5000 }], data: {}
    });
    // Merge again with the same email but no addedAt — this hits the
    // else-branch (existing found) that used to drop it.
    const remerged = addedAtStore.ingestLocal({
      accounts: [{ email: 'third@example.test', nick: 'Third', icon: '' }], data: {}
    });
    const thirdAccount = remerged.accounts.find((a) => a.email === 'third@example.test');
    assert.strictEqual(thirdAccount.addedAt, 5000);
    // A stale tombstone that predates addedAt must not hide the account.
    const afterStaleTombstone = addedAtStore.ingestLocal({ accounts: [],
      data: { accountsDeleted: { 'third@example.test': 1000 } }
    });
    assert.strictEqual(afterStaleTombstone.accounts.some((a) => a.email === 'third@example.test'), true);

    console.log('progressstore self-check OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
