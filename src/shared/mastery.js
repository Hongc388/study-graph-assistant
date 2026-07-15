// Readiness ("mastery") derivation — pure, shared by db.js and unit tests.
//
// Readiness is DERIVED, never typed in. Two independent signals:
//   problems:  (solved|reviewed + 0.3 × attempted) / total   — proven competence, up to 100%
//   exposure:  logged time on the topic's materials           — capped at 60% so
//              reading alone never looks "mastered" (5h reaches the cap)
// Readiness is the HIGHER of the two: solving problems proves competence even
// with no time logged, and study time keeps the bar moving before (or without)
// tagged problems — it never goes down because you tagged more problems.

const EXPOSURE_CAP = 0.6;
const EXPOSURE_FULL_MIN = 300;

function deriveMastery(row) {
  const exposure = Math.min(EXPOSURE_CAP, ((row.exposure_min || 0) / EXPOSURE_FULL_MIN) * EXPOSURE_CAP);
  const problems = row.problem_count > 0
    ? Math.min(1, ((row.solved_count || 0) + 0.3 * (row.attempted_count || 0)) / row.problem_count)
    : 0;
  return {
    mastery: Math.max(problems, exposure),
    mastery_problems: problems,
    mastery_exposure: exposure,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deriveMastery, EXPOSURE_CAP, EXPOSURE_FULL_MIN };
} else {
  globalThis.Mastery = { deriveMastery, EXPOSURE_CAP, EXPOSURE_FULL_MIN };
}
