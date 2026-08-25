'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProgressStore, VERSION } = require('./progressstore');

function testStore(file, times, ids) {
  let timeIndex = 0;
  let idIndex = 0;
  return createProgressStore({
    file,
    now: () => times[Math.min(timeIndex++, times.length - 1)],
    id: () => ids[idIndex++] || `generated-${idIndex}`
  });
}

function run() {
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
        gemTargets: [{ id: 20, qty: 2, owned: 1 }],
        dungeonRuns: [{ id: 'run-1', duration: 90 }],
        dungeonMe: 'RoseKnight',
        cards: { rose: 1 },          // v4: dropped — Collection left the envelope
        cardsUpdatedAt: 50,
        forbidden: 'discard me'
      }
    });
    // v4: the Collection moved to its own tables, so cards never enters the envelope.
    assert.strictEqual('cards' in ingested.data, false);
    assert.strictEqual('cardsUpdatedAt' in ingested.data, false);
    assert.deepStrictEqual(ingested.accounts, [{ email: 'player@example.test', nick: 'RoseKnight', icon: 'knight' }]);
    assert.deepStrictEqual(ingested.data.gemTargets, [{ id: 20, qty: 2, owned: 1 }]);
    assert.strictEqual(ingested.data.dungeonMe, 'RoseKnight');
    assert.strictEqual('forbidden' in ingested.data, false);

    store.startPlaySession();
    const checkpoint = store.checkpointPlaySession();
    assert.strictEqual(checkpoint.durationMs, 1);
    const session = store.endPlaySession('game-closed');
    assert.strictEqual(session.durationMs, 2);
    assert.strictEqual(session.reason, 'game-closed');

    // A remote envelope from another device: a new account, more progress
    // (union), and a newer Zuly wallet (last-write-wins, not summed).
    const remoteEnvelope = {
      accounts: [
        { email: 'player@example.test', nick: '', icon: '' },
        { email: 'second@example.test', nick: 'Alt', icon: '' }
      ],
      data: {
        itemsPinned: [11, 12], questsDone: ['q1', 'q2'], gemTargets: [],
        kings: { aqua: 450, jelly: 700 }, dungeonRuns: [{ id: 'run-1', duration: 999 }, { id: 'run-2', duration: 80 }],
        dungeonMe: '', loot: {}, dps: {}, calendarNotes: {}, shouts: [],
        cards: { rose: 99 }, cardsUpdatedAt: 999,   // v4: ignored by cleanData
      },
    };
    const merged = store.ingestLocal(remoteEnvelope);
    assert.deepStrictEqual(merged.data.itemsPinned, [10, 11, 12]);
    assert.deepStrictEqual(merged.data.questsDone, ['q1', 'q2']);
    assert.deepStrictEqual(merged.data.kings, { aqua: 500, jelly: 700 });
    assert.deepStrictEqual(merged.data.dungeonRuns.map((run) => run.id), ['run-1', 'run-2']);
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
    store.ingestLocal({ data: { shouts: ['LFM', 'WTB'] } });
    assert.strictEqual(store.flush(), true);
    assert.strictEqual(fs.existsSync(`${file}.bak`), true);

    const reloaded = createProgressStore({ file, now: () => 999, id: () => 'must-not-replace-device' });
    const persisted = reloaded.load();
    assert.strictEqual(persisted.device.id, 'device-uuid');
    assert.deepStrictEqual(persisted.data.shouts, ['LFM', 'WTB']);

    const corruptFile = path.join(root, 'corrupt.json');
    fs.writeFileSync(corruptFile, '{bad json', 'utf8');
    fs.writeFileSync(`${corruptFile}.bak`, JSON.stringify({ format: 'wrong', version: 2 }), 'utf8');
    assert.throws(
      () => createProgressStore({ file: corruptFile }).load(),
      /storage and backup are unreadable/i
    );

    // A v2 storage file loads cleanly: cleanData default-fills what is missing
    // and drops the keys this version no longer knows (cards, profile).
    const v2File = path.join(root, 'v2.json');
    fs.writeFileSync(v2File, JSON.stringify({
      format: 'roselite-storage', version: 2,
      device: { id: 'old-device', createdAt: 1 },
      accounts: [], data: { cards: { rose: 5 }, cardsUpdatedAt: 10 }, playSessions: [], updatedAt: 1
    }), 'utf8');
    const upgraded = createProgressStore({ file: v2File, now: () => 2000 }).load();
    assert.strictEqual(upgraded.version, VERSION);
    assert.strictEqual('cards' in upgraded.data, false);
    assert.strictEqual('profile' in upgraded.data, false);

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
