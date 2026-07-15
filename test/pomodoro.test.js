const { test } = require('node:test');
const assert = require('node:assert');
const { createPomodoro, applyWork, tick, skipBreak, phaseRemainingMs } = require('../src/shared/pomodoro');

const MIN = 60000;
const NOW = 1_000_000;

test('25 active minutes complete a pomodoro and start a short break', () => {
  let p = createPomodoro();
  let r = applyWork(p, 24 * MIN, NOW);
  assert.deepStrictEqual(r.events, []);
  assert.strictEqual(r.pomo.phase, 'work');
  r = applyWork(r.pomo, 1 * MIN, NOW);
  assert.deepStrictEqual(r.events, ['work-complete']);
  assert.strictEqual(r.pomo.phase, 'short_break');
  assert.strictEqual(r.pomo.completed, 1);
  assert.strictEqual(r.pomo.breakEndsAt, NOW + 5 * MIN);
  assert.strictEqual(r.pomo.workMs, 0);
});

test('every 4th pomodoro earns the long break', () => {
  let p = { ...createPomodoro(), completed: 3 };
  const r = applyWork(p, 25 * MIN, NOW);
  assert.strictEqual(r.pomo.phase, 'long_break');
  assert.strictEqual(r.pomo.breakEndsAt, NOW + 15 * MIN);
});

test('work time does not accumulate during a break; tick ends it on schedule', () => {
  let p = { ...createPomodoro(), phase: 'short_break', breakEndsAt: NOW + 5 * MIN };
  assert.strictEqual(applyWork(p, 10 * MIN, NOW).pomo.workMs, 0);
  assert.deepStrictEqual(tick(p, NOW + 4 * MIN).events, []);
  const done = tick(p, NOW + 5 * MIN);
  assert.deepStrictEqual(done.events, ['break-complete']);
  assert.strictEqual(done.pomo.phase, 'work');
  assert.strictEqual(done.pomo.breakEndsAt, null);
});

test('skipBreak returns straight to work', () => {
  const p = { ...createPomodoro(), phase: 'long_break', breakEndsAt: NOW + 15 * MIN };
  const back = skipBreak(p);
  assert.strictEqual(back.phase, 'work');
  assert.strictEqual(back.breakEndsAt, null);
});

test('phaseRemainingMs counts down work by active time and breaks by the clock', () => {
  const p = createPomodoro({ workMin: 25 });
  assert.strictEqual(phaseRemainingMs(p, NOW), 25 * MIN);
  const { pomo } = applyWork(p, 10 * MIN, NOW);
  assert.strictEqual(phaseRemainingMs(pomo, NOW), 15 * MIN);
  const brk = { ...pomo, phase: 'short_break', breakEndsAt: NOW + 5 * MIN };
  assert.strictEqual(phaseRemainingMs(brk, NOW + 2 * MIN), 3 * MIN);
});

test('custom cycle config is honored', () => {
  let p = createPomodoro({ workMin: 50, shortBreakMin: 10, cyclesPerLong: 2 });
  let r = applyWork(p, 50 * MIN, NOW);
  assert.strictEqual(r.pomo.phase, 'short_break');
  assert.strictEqual(r.pomo.breakEndsAt, NOW + 10 * MIN);
  r = applyWork(skipBreak(r.pomo), 50 * MIN, NOW);
  assert.strictEqual(r.pomo.phase, 'long_break');
});
