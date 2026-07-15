// Pomodoro phase machine — pure functions, shared by renderer and unit tests.
//
// The work phase advances on ACTIVE study time (fed from the material timer,
// so unfocused/paused time never counts); breaks advance on the wall clock.
// State: { cfg, phase: 'work'|'short_break'|'long_break', workMs, completed, breakEndsAt }

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
  const long = next.completed % next.cfg.cyclesPerLong === 0;
  next.phase = long ? 'long_break' : 'short_break';
  next.breakEndsAt = now + (long ? next.cfg.longBreakMin : next.cfg.shortBreakMin) * 60000;
  next.workMs = 0;
  return { pomo: next, events: ['work-complete'] };
}

// Wall-clock tick: ends a finished break. Events may contain 'break-complete'.
function tick(pomo, now = Date.now()) {
  if (!pomo || pomo.phase === 'work' || now < pomo.breakEndsAt) return { pomo, events: [] };
  return {
    pomo: { ...pomo, phase: 'work', breakEndsAt: null },
    events: ['break-complete'],
  };
}

function skipBreak(pomo) {
  if (!pomo || pomo.phase === 'work') return pomo;
  return { ...pomo, phase: 'work', breakEndsAt: null };
}

// Ms left in the current phase (work: until the next break earns itself).
function phaseRemainingMs(pomo, now = Date.now()) {
  if (!pomo) return 0;
  if (pomo.phase === 'work') return Math.max(0, pomo.cfg.workMin * 60000 - pomo.workMs);
  return Math.max(0, pomo.breakEndsAt - now);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULTS, createPomodoro, applyWork, tick, skipBreak, phaseRemainingMs };
} else {
  globalThis.Pomodoro = { DEFAULTS, createPomodoro, applyWork, tick, skipBreak, phaseRemainingMs };
}
