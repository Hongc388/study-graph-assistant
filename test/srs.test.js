const { test } = require('node:test');
const assert = require('node:assert');
const { newCardState, review, previewInterval } = require('../src/shared/srs');

const NOW = Date.UTC(2026, 6, 14, 9, 0, 0);
const days = (from, iso) => (new Date(iso).getTime() - from) / 86400000;

test('good ratings follow the 1d, 6d, then ease-multiplied ladder', () => {
  let c = newCardState(NOW);
  c = review(c, 2, NOW);
  assert.strictEqual(c.interval_days, 1);
  assert.ok(Math.abs(days(NOW, c.due_at) - 1) < 0.01);
  c = review(c, 2, NOW);
  assert.strictEqual(c.interval_days, 6);
  c = review(c, 2, NOW);
  assert.strictEqual(c.interval_days, 15); // 6 × 2.5
  assert.strictEqual(c.reps, 3);
});

test('again resets reps, counts a lapse, drops ease and retries in minutes', () => {
  let c = { ...newCardState(NOW), reps: 3, interval_days: 15, ease: 2.5 };
  c = review(c, 0, NOW);
  assert.strictEqual(c.reps, 0);
  assert.strictEqual(c.lapses, 1);
  assert.strictEqual(c.interval_days, 0);
  assert.strictEqual(c.ease, 2.3);
  assert.ok(days(NOW, c.due_at) < 0.01, 'due again within the same session');
});

test('hard grows slowly and never below 1 day; ease floors at 1.3', () => {
  let c = { ...newCardState(NOW), interval_days: 0, ease: 1.35 };
  c = review(c, 1, NOW);
  assert.strictEqual(c.interval_days, 1);
  assert.strictEqual(c.ease, 1.3);
  c = review(c, 1, NOW);
  assert.strictEqual(c.interval_days, 1.2);
  assert.strictEqual(c.ease, 1.3); // floored, not 1.15
});

test('easy boosts ease and multiplies the interval by an extra 1.3', () => {
  let c = { ...newCardState(NOW), reps: 2, interval_days: 6, ease: 2.5 };
  c = review(c, 3, NOW);
  assert.strictEqual(c.ease, 2.65);
  assert.strictEqual(c.interval_days, 19.5); // 6 × 2.5 × 1.3
});

test('interval is capped at a year', () => {
  const c = review({ ...newCardState(NOW), reps: 10, interval_days: 350, ease: 2.5 }, 2, NOW);
  assert.strictEqual(c.interval_days, 365);
});

test('previewInterval renders human labels per rating', () => {
  const fresh = newCardState(NOW);
  assert.strictEqual(previewInterval(fresh, 0), '10m');
  assert.strictEqual(previewInterval(fresh, 2), '1d');
  const mature = { ...fresh, reps: 3, interval_days: 20, ease: 2.5 };
  assert.strictEqual(previewInterval(mature, 2), '7w'); // 50d
  assert.strictEqual(previewInterval(mature, 3), '2mo'); // 65d
});
