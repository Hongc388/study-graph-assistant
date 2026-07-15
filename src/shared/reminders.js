// Study reminder engine — pure functions, shared by the main process and unit
// tests. Given a snapshot of the world (time, deadlines, due cards, planned
// blocks, pomodoro stats) plus what was already sent, decides exactly which
// notifications to fire. Never promotional: every reminder is about the
// user's own study data, and each fires at most once (per day where daily).
//
// Categories: deadlines (3/1/0 days out), reviews (due flashcards, after 9am),
// blocks (planned block starting within 10 min), streak (evening nudge when a
// ≥2-day streak would end). The pomodoro category is event-driven in the
// renderer; it only appears here as a preference the renderer consults.
//
// Wrapped in an IIFE because the renderer loads this as a classic <script>:
// top-level names would become globals and collide with app.js (fmtMin) or
// shadow window.api.
(() => {

const DEFAULT_PREFS = Object.freeze({
  enabled: true,
  deadlines: true,
  reviews: true,
  blocks: true,
  streak: true,
  pomodoro: true,
});

const SENT_KEEP_DAYS = 7;

// Accepts a prefs object or the raw JSON string stored in settings.
function normalizePrefs(raw) {
  let p = raw;
  if (typeof raw === 'string') {
    try { p = JSON.parse(raw); } catch { p = null; }
  }
  return { ...DEFAULT_PREFS, ...(p && typeof p === 'object' ? p : {}) };
}

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const localDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Calendar days from `now` to a deadline's due_at ('YYYY-MM-DDTHH:MM', local):
// 0 = due today, 1 = tomorrow. Time of day never shifts the bucket.
function daysUntil(dueAt, now) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((dayStart(due).getTime() - dayStart(now).getTime()) / 86400000);
}

const fmtMin = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const clockOf = (dueAt) => {
  const m = /T(\d{2}:\d{2})/.exec(dueAt);
  return m ? m[1] : null;
};

// ctx: { now: Date, deadlines, dueCards, blocks, stats: {count, streak},
//        sent: {key: 'YYYY-MM-DD'}, prefs }
// Returns [{ key, category, title, body }] — everything that should fire now.
function dueReminders(ctx) {
  const { now, deadlines = [], dueCards = 0, blocks = [], stats = null, sent = {} } = ctx;
  const prefs = normalizePrefs(ctx.prefs);
  if (!prefs.enabled) return [];

  const out = [];
  const today = localDateStr(now);
  const hour = now.getHours();
  const nowMin = hour * 60 + now.getMinutes();

  if (prefs.deadlines) {
    for (const d of deadlines) {
      if (d.done) continue;
      const left = daysUntil(d.due_at, now);
      if (left !== 3 && left !== 1 && left !== 0) continue;
      const key = `deadline:${d.id}:d${left}`;
      if (sent[key]) continue;
      const at = clockOf(d.due_at);
      const when = left === 0 ? (at ? `today at ${at}` : 'today')
        : left === 1 ? 'tomorrow' : `in ${left} days`;
      out.push({
        key, category: 'deadlines',
        title: `${d.module_code ? d.module_code + ' — ' : ''}due ${when}`,
        body: d.title,
      });
    }
  }

  if (prefs.reviews && dueCards > 0 && hour >= 9) {
    const key = `reviews:${today}`;
    if (!sent[key]) {
      out.push({
        key, category: 'reviews',
        title: `${dueCards} flashcard${dueCards === 1 ? '' : 's'} due for review`,
        body: 'A short session today keeps the intervals growing.',
      });
    }
  }

  if (prefs.blocks) {
    for (const b of blocks) {
      if (b.status !== 'planned' || b.date !== today) continue;
      const lead = b.start_min - nowMin;
      if (lead < 0 || lead > 10) continue;
      const key = `block:${b.id}`;
      if (sent[key]) continue;
      const what = [b.module_code, b.topic_name].filter(Boolean).join(' · ') || 'Planned study';
      out.push({
        key, category: 'blocks',
        title: lead === 0 ? 'Study block starting now' : `Study block at ${fmtMin(b.start_min)}`,
        body: what,
      });
    }
  }

  if (prefs.streak && stats && hour >= 20 && stats.count === 0 && stats.streak >= 2) {
    const key = `streak:${today}`;
    if (!sent[key]) {
      out.push({
        key, category: 'streak',
        title: `${stats.streak}-day streak on the line`,
        body: 'One pomodoro before midnight keeps it alive.',
      });
    }
  }

  return out;
}

// Drops sent-log entries older than SENT_KEEP_DAYS so the map stays small.
function pruneSent(sent, now) {
  const cutoff = new Date(dayStart(now).getTime() - SENT_KEEP_DAYS * 86400000);
  const keep = {};
  for (const [k, dateStr] of Object.entries(sent || {})) {
    if (new Date(dateStr + 'T00:00:00') >= cutoff) keep[k] = dateStr;
  }
  return keep;
}

const remindersExports = {
  DEFAULT_PREFS, SENT_KEEP_DAYS,
  normalizePrefs, dueReminders, pruneSent, daysUntil, localDateStr,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = remindersExports;
} else {
  globalThis.Reminders = remindersExports;
}

})();
