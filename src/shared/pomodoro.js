// Pomodoro phase machine — pure functions, shared by renderer and unit tests.
//
// The work phase advances on ACTIVE study time (fed from the material timer,
// so unfocused/paused time never counts); breaks advance on the wall clock.
// A completed work interval lands in 'break_pending' — the break is EARNED
// but not started until the user accepts it (startBreak) or declines
// (skipBreak). The clock only runs against an accepted break.
// State: { cfg, phase: 'work'|'break_pending'|'short_break'|'long_break',
//          workMs, completed, breakEndsAt }

const DEFAULTS = {
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  cyclesPerLong: 4, // every Nth completed pomodoro earns the long break
};

function createPomodoro(cfg = {}) {
  return {
    cfg: { ...DEFAULTS, ...cfg },
    phase: 'work',
    workMs: 0,
    completed: 0,
    breakEndsAt: null,
  };
}

// Feed active study milliseconds into the work phase.
// Returns { pomo, events } where events may contain 'work-complete'.
function applyWork(pomo, deltaMs, now = Date.now()) {
  if (!pomo || pomo.phase !== 'work' || deltaMs <= 0) return { pomo, events: [] };
  const next = { ...pomo, workMs: pomo.workMs + deltaMs };
  if (next.workMs < next.cfg.workMin * 60000) return { pomo: next, events: [] };

  next.completed += 1;
  next.phase = 'break_pending';
  next.breakEndsAt = null;
  next.workMs = 0;
  return { pomo: next, events: ['work-complete'] };
}

// Which break the current pending/active break is (every Nth earns the long one).
function earnedBreakMin(pomo) {
  const long = pomo.completed > 0 && pomo.completed % pomo.cfg.cyclesPerLong === 0;
  return { long, min: long ? pomo.cfg.longBreakMin : pomo.cfg.shortBreakMin };
}

// User accepted the earned break: the wall clock starts now.
function startBreak(pomo, now = Date.now()) {
  if (!pomo || pomo.phase !== 'break_pending') return pomo;
  const { long, min } = earnedBreakMin(pomo);
  return { ...pomo, phase: long ? 'long_break' : 'short_break', breakEndsAt: now + min * 60000 };
}

// Wall-clock tick: ends a finished break. Events may contain 'break-complete'.
// A pending (unaccepted) break has no clock, so it never completes here.
function tick(pomo, now = Date.now()) {
  if (!pomo || pomo.phase === 'work' || pomo.phase === 'break_pending'
    || now < pomo.breakEndsAt) return { pomo, events: [] };
  return {
    pomo: { ...pomo, phase: 'work', breakEndsAt: null },
    events: ['break-complete'],
  };
}

function skipBreak(pomo) {
  if (!pomo || pomo.phase === 'work') return pomo;
  return { ...pomo, phase: 'work', breakEndsAt: null };
}

// Ms left in the current phase (work: until the next break earns itself;
// pending: the full earned break, since it hasn't started counting).
function phaseRemainingMs(pomo, now = Date.now()) {
  if (!pomo) return 0;
  if (pomo.phase === 'work') return Math.max(0, pomo.cfg.workMin * 60000 - pomo.workMs);
  if (pomo.phase === 'break_pending') return earnedBreakMin(pomo).min * 60000;
  return Math.max(0, pomo.breakEndsAt - now);
}

const pomodoroExports = {
  DEFAULTS, createPomodoro, applyWork, startBreak, earnedBreakMin, tick, skipBreak, phaseRemainingMs,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = pomodoroExports;
} else {
  globalThis.Pomodoro = pomodoroExports;
}
