// Pure timer state helpers — shared by renderer (browser global) and unit tests (CommonJS).

function isTimerActive(timer, { previewFocused }) {
  if (!timer) return false;
  if (timer.mode === 'preview') return previewFocused;
  return false;
}

function elapsedMs(timer, now = Date.now()) {
  if (!timer) return 0;
  const live = timer.paused ? 0 : now - timer.lastTickMs;
  return timer.activeMs + live;
}

function applyActivitySync(timer, active, now = Date.now()) {
  if (!timer) return null;
  const next = { ...timer };
  if (active) {
    if (next.paused) {
      next.paused = false;
      next.lastTickMs = now;
    }
  } else if (!next.paused) {
    next.activeMs += now - next.lastTickMs;
    next.paused = true;
    next.lastTickMs = now;
  }
  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isTimerActive, elapsedMs, applyActivitySync };
} else {
  globalThis.TimerState = { isTimerActive, elapsedMs, applyActivitySync };
}
