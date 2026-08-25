'use strict';

const MAX_ROWS = 12000;
const MAX_HISTORY = 4000;

function failure(response) {
  return {
    ok: false,
    status: Number.isInteger(response?.status) ? response.status : 0,
    data: null
  };
}

function finiteNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return null;
  return number;
}

function safeText(value, max = 200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function safeDate(value) {
  const text = safeText(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function normalizeSnapshotResponse(response) {
  if (!response?.ok || !Array.isArray(response.data?.data)) return failure(response);
  const data = [];
  for (const raw of response.data.data.slice(0, MAX_ROWS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const itemType = finiteNumber(raw.item_type, { min: 0, max: 10000, integer: true });
    const itemId = finiteNumber(raw.item_id, { min: 0, max: 1000000000, integer: true });
    const itemName = safeText(raw.item_name);
    const minPrice = finiteNumber(raw.min_price);
    const minChangePct = finiteNumber(raw.min_change_pct, { min: -100, max: 1000000000 });
    const latestQuantity = finiteNumber(raw.latest_quantity ?? 0, { integer: true });
    const sampleCount = finiteNumber(raw.sample_count ?? 0, { integer: true });
    if (itemType === null || itemId === null || itemName === null || minPrice === null || minChangePct === null
      || latestQuantity === null || sampleCount === null) continue;
    data.push({
      item_type: itemType,
      item_id: itemId,
      item_name: itemName,
      min_price: minPrice,
      min_change_pct: minChangePct,
      latest_quantity: latestQuantity,
      sample_count: sampleCount,
      last_updated: safeDate(raw.last_updated) || '',
      is_selling: raw.is_selling === true || raw.is_selling === 1 || raw.is_selling === '1'
    });
  }
  return data.length ? { ok: true, status: response.status, data: { data } } : failure(response);
}

function normalizeHistoryResponse(response, metric = 'min_price') {
  if (!response?.ok || !Array.isArray(response.data?.history) || !['min_price', 'quantity'].includes(metric)) return failure(response);
  const history = [];
  for (const raw of response.data.history.slice(-MAX_HISTORY)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const date = safeDate(raw.date || raw.updated_at);
    const value = finiteNumber(raw[metric]);
    if (!date || value === null) continue;
    const point = { date, [metric]: value };
    const updatedAt = safeDate(raw.updated_at);
    if (updatedAt) point.updated_at = updatedAt;
    history.push(point);
  }
  return history.length ? { ok: true, status: response.status, data: { history } } : failure(response);
}

module.exports = { normalizeSnapshotResponse, normalizeHistoryResponse };

if (require.main === module) {
  const assert = require('node:assert/strict');
  const snapshot = normalizeSnapshotResponse({ ok: true, status: 200, data: { data: [
    { item_type: '12', item_id: '34', item_name: 'Iron & Ore', min_price: '100', min_change_pct: '-2.5', latest_quantity: '4', sample_count: 3, last_updated: '2026-08-25T12:00:00Z', is_selling: 1 },
    { item_type: '1\" onerror=run()', item_id: 2, item_name: '<img>', min_price: 1, min_change_pct: 0 }
  ] } });
  assert.deepStrictEqual(snapshot.data.data[0], {
    item_type: 12, item_id: 34, item_name: 'Iron & Ore', min_price: 100, min_change_pct: -2.5,
    latest_quantity: 4, sample_count: 3, last_updated: '2026-08-25T12:00:00Z', is_selling: true
  });
  assert.strictEqual(snapshot.data.data.length, 1);
  const history = normalizeHistoryResponse({ ok: true, status: 200, data: { history: [
    { date: '2026-08-24', min_price: '90' },
    { date: '\"><img src=x onerror=run()>', min_price: 100 }
  ] } });
  assert.deepStrictEqual(history.data.history, [{ date: '2026-08-24', min_price: 90 }]);
  assert.strictEqual(normalizeSnapshotResponse({ ok: true, status: 200, data: { data: [] } }).ok, false);
  console.log('marketdata.js self-check OK');
}
