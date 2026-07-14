const { test } = require('node:test');
const assert = require('node:assert');
const { isTimerActive, elapsedMs, applyActivitySync } = require('../src/shared/timer-state');

const base = () => ({
  materialId: 1,
  title: 'Lecture 1',
  mode: 'preview',
  activeMs: 60_000,
  lastTickMs: 1000,
  paused: false,
});

test('timer only runs while the file preview window is focused', () => {
  const t = base();
  assert.ok(isTimerActive(t, { previewFocused: true }));
  assert.ok(!isTimerActive(t, { previewFocused: false }));
  assert.ok(!isTimerActive({ ...t, mode: 'external' }, { previewFocused: true }));
});

test('elapsedMs freezes while paused', () => {
  const t = { ...base(), paused: true, activeMs: 90_000, lastTickMs: 5000 };
  assert.strictEqual(elapsedMs(t, 20_000), 90_000);
  assert.strictEqual(elapsedMs({ ...t, paused: false }, 20_000), 105_000);
});

test('applyActivitySync accumulates active time when focus is lost', () => {
  const t = base();
  const paused = applyActivitySync(t, false, 61_000);
  assert.strictEqual(paused.paused, true);
  assert.strictEqual(paused.activeMs, 120_000);
  const resumed = applyActivitySync(paused, true, 120_000);
  assert.strictEqual(resumed.paused, false);
  assert.strictEqual(resumed.lastTickMs, 120_000);
});
