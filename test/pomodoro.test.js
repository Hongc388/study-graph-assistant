const { test } = require('node:test');
const assert = require('node:assert');
const {
  createPomodoro, applyWork, startBreak, earnedBreakMin, tick, skipBreak, phaseRemainingMs,
} = require('../src/shared/pomodoro');

const MIN = 60000;
const NOW = 1_000_000;

test('25 active minutes complete a pomodoro and leave the break pending', () => {
  let p = createPomodoro();
  let r = applyWork(p, 24 * MIN, NOW);
  assert.deepStrictEqual(r.events, []);
  assert.strictEqual(r.pomo.phase, 'work');
  r = applyWork(r.pomo, 1 * MIN, NOW);
  assert.deepStrictEqual(r.events, ['work-complete']);
  assert.strictEqual(r.pomo.phase, 'break_pending');
  assert.strictEqual(r.pomo.completed, 1);
  assert.strictEqual(r.pomo.breakEndsAt, null, 'no clock until the break is accepted');
  assert.strictEqual(r.pomo.workMs, 0);
});

test('accepting the break starts its wall clock from that moment', () => {
  const { pomo } = applyWork(createPomodoro(), 25 * MIN, NOW);
  const later = NOW + 90_000; // user thought about it for 90s
  const b = startBreak(pomo, later);
  assert.strictEqual(b.phase, 'short_break');
  assert.strictEqual(b.breakEndsAt, later + 5 * MIN, 'full break from acceptance, not completion');
});

test('every 4th pomodoro earns the long break', () => {
  let p = { ...createPomodoro(), completed: 3 };
  const r = applyWork(p, 25 * MIN, NOW);
  assert.strictEqual(r.pomo.phase, 'break_pending');
  assert.deepStrictEqual(earnedBreakMin(r.pomo), { long: true, min: 15 });
  const b = startBreak(r.pomo, NOW);
  assert.strictEqual(b.phase, 'long_break');
  assert.strictEqual(b.breakEndsAt, NOW + 15 * MIN);
});

test('a pending break never completes by itself and accumulates no work', () => {
  const { pomo } = applyWork(createPomodoro(), 25 * MIN, NOW);
  assert.deepStrictEqual(tick(pomo, NOW + 60 * MIN).events, [], 'no clock, no completion');
  assert.strictEqual(applyWork(pomo, 10 * MIN, NOW).pomo.workMs, 0);
  assert.strictEqual(startBreak(createPomodoro(), NOW).phase, 'work', 'startBreak is a no-op outside break_pending');
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

test('skipBreak returns straight to work, from pending or from a running break', () => {
  const pending = applyWork(createPomodoro(), 25 * MIN, NOW).pomo;
  assert.strictEqual(skipBreak(pending).phase, 'work');
  const p = { ...createPomodoro(), phase: 'long_break', breakEndsAt: NOW + 15 * MIN };
  const back = skipBreak(p);
  assert.strictEqual(back.phase, 'work');
  assert.strictEqual(back.breakEndsAt, null);
});

test('phaseRemainingMs: work by active time, pending shows the full earned break, breaks by the clock', () => {
  const p = createPomodoro({ workMin: 25 });
  assert.strictEqual(phaseRemainingMs(p, NOW), 25 * MIN);
  const { pomo } = applyWork(p, 10 * MIN, NOW);
  assert.strictEqual(phaseRemainingMs(pomo, NOW), 15 * MIN);
  const pending = applyWork(pomo, 15 * MIN, NOW).pomo;
  assert.strictEqual(phaseRemainingMs(pending, NOW + 99 * MIN), 5 * MIN, 'pending ignores the clock');
  const brk = startBreak(pending, NOW);
  assert.strictEqual(phaseRemainingMs(brk, NOW + 2 * MIN), 3 * MIN);
});

test('custom cycle config is honored', () => {
  let p = createPomodoro({ workMin: 50, shortBreakMin: 10, cyclesPerLong: 2 });
  let r = applyWork(p, 50 * MIN, NOW);
  const b = startBreak(r.pomo, NOW);
  assert.strictEqual(b.phase, 'short_break');
  assert.strictEqual(b.breakEndsAt, NOW + 10 * MIN);
  r = applyWork(skipBreak(b), 50 * MIN, NOW);
  assert.deepStrictEqual(earnedBreakMin(r.pomo), { long: true, min: 15 });
});
