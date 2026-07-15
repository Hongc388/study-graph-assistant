const { test } = require('node:test');
const assert = require('node:assert');
const { deriveMastery, EXPOSURE_CAP, EXPOSURE_FULL_MIN } = require('../src/shared/mastery');

test('no problems: readiness grows with logged time and caps at 60%', () => {
  assert.strictEqual(deriveMastery({ problem_count: 0, exposure_min: 0 }).mastery, 0);
  const half = deriveMastery({ problem_count: 0, exposure_min: EXPOSURE_FULL_MIN / 2 });
  assert.ok(Math.abs(half.mastery - EXPOSURE_CAP / 2) < 1e-9);
  const lots = deriveMastery({ problem_count: 0, exposure_min: 10 * EXPOSURE_FULL_MIN });
  assert.strictEqual(lots.mastery, EXPOSURE_CAP, 'reading alone never exceeds the cap');
});

test('problems dominate once competence beats exposure', () => {
  const r = deriveMastery({ problem_count: 4, solved_count: 3, attempted_count: 0, exposure_min: 60 });
  assert.strictEqual(r.mastery_problems, 0.75);
  assert.ok(r.mastery_exposure < 0.75);
  assert.strictEqual(r.mastery, 0.75);
});

test('study time still counts when problems exist but are unsolved', () => {
  // the old rule zeroed readiness here; now 5h of study keeps the bar at the cap
  const r = deriveMastery({ problem_count: 5, solved_count: 0, attempted_count: 0, exposure_min: 300 });
  assert.strictEqual(r.mastery_problems, 0);
  assert.strictEqual(r.mastery, EXPOSURE_CAP);
});

test('attempts count 30% toward problem competence', () => {
  const r = deriveMastery({ problem_count: 10, solved_count: 2, attempted_count: 5, exposure_min: 0 });
  assert.ok(Math.abs(r.mastery_problems - 0.35) < 1e-9);
});

test('tagging more problems never lowers readiness below the exposure floor', () => {
  const before = deriveMastery({ problem_count: 0, exposure_min: 200 });
  const after = deriveMastery({ problem_count: 8, solved_count: 0, attempted_count: 0, exposure_min: 200 });
  assert.strictEqual(after.mastery, before.mastery);
});
