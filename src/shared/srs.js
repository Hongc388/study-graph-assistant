// SM-2 spaced repetition — pure functions, shared by main (db review) and
// renderer (interval previews on the rating buttons) and unit tests.
//
// Ratings: 0 = again (forgot), 1 = hard, 2 = good, 3 = easy.
// A card carries { ease, interval_days, reps, lapses, due_at }.

const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 365;
const AGAIN_RETRY_MIN = 10; // forgotten card comes back within the same session

function newCardState(now = Date.now()) {
  return {
    ease: 2.5,
    interval_days: 0,
    reps: 0,
    lapses: 0,
    due_at: new Date(now).toISOString(),
  };
}

// Next state after rating a card. Never mutates the input.
function review(card, rating, now = Date.now()) {
  let { ease, interval_days: interval, reps, lapses } = card;

  if (rating === 0) {
    lapses += 1;
    reps = 0;
    interval = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
  } else if (rating === 1) {
    // hard: small step, never the full ease multiplier
    interval = Math.max(1, interval * 1.2);
    ease = Math.max(MIN_EASE, ease - 0.15);
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = interval * ease;
    if (rating === 3) {
      interval *= 1.3;
      ease += 0.15;
    }
  }
  interval = Math.min(MAX_INTERVAL_DAYS, interval);

  const dueMs = rating === 0
    ? now + AGAIN_RETRY_MIN * 60000
    : now + interval * 86400000;

  return {
    ease: Math.round(ease * 100) / 100,
    interval_days: Math.round(interval * 100) / 100,
    reps,
    lapses,
    due_at: new Date(dueMs).toISOString(),
  };
}

// "1d" / "6d" / "3w" / "2mo" label for a rating button.
function previewInterval(card, rating) {
  const next = review(card, rating);
  if (rating === 0) return `${AGAIN_RETRY_MIN}m`;
  const d = next.interval_days;
  if (d < 14) return `${Math.round(d)}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { newCardState, review, previewInterval, MIN_EASE, MAX_INTERVAL_DAYS };
} else {
  globalThis.Srs = { newCardState, review, previewInterval, MIN_EASE, MAX_INTERVAL_DAYS };
}
