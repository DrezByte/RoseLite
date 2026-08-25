// Runnable check for the Kings section: `node overlay/kings.test.js`.
// Exercises the real logic the section uses (overlay/logic.js — kingDue, kFmt,
// kWhen, kingCompare) against the real kings.json. If the interval baking, the
// up→running→idle ordering, or the time format changes, this fails.
const assert = require('assert');
const KINGS = require('./kings.json');
const { kingDue, kFmt, kWhen, kingCompare } = require('./logic.js');

assert(KINGS.length === 100 && KINGS.every((k) => k.id && k.name && k.map && k.planet && k.secs > 0), 'kings.json shape');

assert.equal(kFmt(900), '15:00');
assert.equal(kFmt(484), '8:04');
assert.equal(kFmt(3995), '1:06:35');
assert.equal(kFmt(86400), '1d 0h');
assert.equal(kFmt(21 * 86400 + 5 * 3600), '21d 5h');

// kWhen: the absolute local spawn clock shown under the countdown.
const noon = new Date(); noon.setHours(12, 34, 0, 0);
assert(!kWhen(noon.getTime()).includes('·'), 'same-day spawn = clock only');
assert(kWhen(noon.getTime() + 21 * 86400_000).includes('·'), 'far spawn carries a date');

const NOW = 1_000_000_000_000;
const kills = {};   // id -> killedAtMs
const dueOf = (k) => kingDue(kills, k);
const sorted = () => [...KINGS].sort(kingCompare(kills, NOW));

const [a, b, c] = KINGS;   // a=up, b=running(soon), c=running(later)
kills[a.id] = NOW - a.secs * 1000 - 5000;        // already up
kills[b.id] = NOW - b.secs * 1000 + 10_000;      // up in 10s
kills[c.id] = NOW - c.secs * 1000 + 60_000;      // up in 60s
const order = sorted();
assert.equal(order[0].id, a.id, 'up king floats to top');
assert.equal(order[1].id, b.id, 'soonest running next');
assert.equal(order[2].id, c.id, 'later running after');
assert(dueOf(order[order.length - 1]) === null, 'idle kings sink to the tail');
assert(dueOf({ id: 'nope', secs: 100 }) === null, 'never-killed = idle');

console.log('kings.test ok — 100 kings, kFmt + up/running/idle order verified');
