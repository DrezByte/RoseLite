// Runnable check for the gem-crafting calculator: `node overlay/gems-calc.test.js`.
// Exercises the real logic the section uses (overlay/logic.js — gemTypes,
// gemExpand) against the real data.js API (recipeFor / recipesBySkill). If the
// recipe tree, the Gem-Cutting leaf rule, or the owned-consumption changes,
// this fails.
const assert = require('assert');
const D = require('./data.js');
const L = require('./logic.js');

const grp = D.recipesBySkill().find(([s]) => s === 'Gem Cutting');
const byType = L.gemTypes(grp[1]);
const gemExpand = (targets) => L.gemExpand(targets, byType, D.recipeFor);

const ruby = byType.get('Ruby');
const R = (n) => ruby.find((r) => r.rank === n).item;
const get = (o, n) => (o.find((x) => x.name === n) || { count: 0 }).count;
assert.equal(ruby.length, 10, '10 ruby ranks');
assert(ruby.every((r, i) => !i || ruby[i - 1].rank < r.rank), 'gemTypes sorts by rank');

// 1× Ruby[9] with nothing owned: needs 2^8 = 256 Ruby[1], ×3 Red Crystal = 768.
assert.equal(get(gemExpand([{ item: R(9), base: 'Ruby', rank: 9, qty: 1, owned: {} }]), 'Red Crystal'), 768, 'Ruby[9] → 768 Red Crystal');
// Owning 14 Ruby[1] + 4 Ruby[4] offsets the tree: 768 − 14×3 − 4×8×3 = 630.
assert.equal(get(gemExpand([{ item: R(9), base: 'Ruby', rank: 9, qty: 1, owned: { 1: 14, 4: 4 } }]), 'Red Crystal'), 630, 'inventory offset 768→630');
// Owning the two Ruby[8] a Ruby[9] needs removes every lower material.
assert.equal(get(gemExpand([{ item: R(9), base: 'Ruby', rank: 9, qty: 1, owned: { 8: 2 } }]), 'Red Crystal'), 0, 'own 2×Ruby[8] → 0 Red Crystal');
// Multi-target quantity: 3× Ruby[2] = 6 Ruby[1] = 18 Red Crystal.
assert.equal(get(gemExpand([{ item: R(2), base: 'Ruby', rank: 2, qty: 3, owned: {} }]), 'Red Crystal'), 18, '3× Ruby[2] → 18 Red Crystal');

console.log('OK — gem calculator: recipe tree, leaf rule, and owned-offset all check out');
