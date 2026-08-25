// Pure store-mutation for account passwords, split out of main.js so it can be
// self-checked without Electron. `store` maps email → base64 ciphertext.
// `encrypt(password)` returns the ciphertext (safeStorage in prod, identity in
// tests). A blank password keeps the existing entry; `oldEmail` renames and
// carries the ciphertext forward when the password itself isn't changed.
function applyAccountSet(store, { email, password, oldEmail } = {}, encrypt) {
  if (!email || typeof email !== 'string') return store;
  const prev = oldEmail && oldEmail !== email ? store[oldEmail] : store[email];
  if (oldEmail && oldEmail !== email) delete store[oldEmail];
  if (password) store[email] = encrypt(password);
  else if (prev) store[email] = prev;   // rename or edit without a password change
  return store;
}

module.exports = { applyAccountSet };

if (require.main === module) {
  const assert = require('assert');
  const enc = (p) => `enc(${p})`;
  // add
  assert.deepStrictEqual(applyAccountSet({}, { email: 'a@x', password: 'p1' }, enc), { 'a@x': 'enc(p1)' });
  // change password in place
  assert.deepStrictEqual(applyAccountSet({ 'a@x': 'enc(p1)' }, { email: 'a@x', password: 'p2' }, enc), { 'a@x': 'enc(p2)' });
  // rename WITHOUT changing password → ciphertext carried to the new email, old gone
  assert.deepStrictEqual(applyAccountSet({ 'a@x': 'enc(p1)' }, { email: 'b@x', password: '', oldEmail: 'a@x' }, enc), { 'b@x': 'enc(p1)' });
  // rename WITH a new password → new ciphertext under new email, old gone
  assert.deepStrictEqual(applyAccountSet({ 'a@x': 'enc(p1)' }, { email: 'b@x', password: 'p2', oldEmail: 'a@x' }, enc), { 'b@x': 'enc(p2)' });
  // blank password on a brand-new email → no entry (nothing to keep)
  assert.deepStrictEqual(applyAccountSet({}, { email: 'c@x', password: '' }, enc), {});
  console.log('accountstore self-check OK');
}
