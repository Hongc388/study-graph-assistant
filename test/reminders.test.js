const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_PREFS, normalizePrefs, dueReminders, pruneSent, daysUntil, localDateStr,
} = require('../src/shared/reminders');

// A fixed local afternoon: 2026-07-15 14:00.
const NOW = new Date(2026, 6, 15, 14, 0);
const ctx = (over = {}) => ({ now: NOW, ...over });

test('deadline fires at 3 days, 1 day and on the day — nothing in between', () => {
  const mk = (id, dueAt) => ({ id, title: 'Final exam', due_at: dueAt, done: 0, module_code: 'COMP9315' });
  const deadlines = [
    mk(1, '2026-07-18T09:00'), // 3 days
    mk(2, '2026-07-17T09:00'), // 2 days — silent
    mk(3, '2026-07-16T09:00'), // tomorrow
    mk(4, '2026-07-15T18:00'), // today (later hour, still "today")
    mk(5, '2026-07-14T09:00'), // past — silent
  ];
  const out = dueReminders(ctx({ deadlines }));
  assert.deepStrictEqual(out.map(r => r.key),
    ['deadline:1:d3', 'deadline:3:d1', 'deadline:4:d0']);
  assert.strictEqual(out[2].title, 'COMP9315 — due today at 18:00');
  assert.strictEqual(out[0].body, 'Final exam');
});

test('done deadlines and already-sent keys are silent', () => {
  const deadlines = [
    { id: 1, title: 'a', due_at: '2026-07-15T18:00', done: 1, module_code: 'X' },
    { id: 2, title: 'b', due_at: '2026-07-15T18:00', done: 0, module_code: 'X' },
  ];
  const out = dueReminders(ctx({ deadlines, sent: { 'deadline:2:d0': '2026-07-15' } }));
  assert.deepStrictEqual(out, []);
});

test('flashcard reminder fires once a day, only after 9am and only when cards are due', () => {
  assert.strictEqual(dueReminders(ctx({ dueCards: 12 }))[0].key, 'reviews:2026-07-15');
  assert.match(dueReminders(ctx({ dueCards: 1 }))[0].title, /^1 flashcard due/);
  assert.deepStrictEqual(dueReminders(ctx({ dueCards: 0 })), []);
  const early = new Date(2026, 6, 15, 8, 59);
  assert.deepStrictEqual(dueReminders({ now: early, dueCards: 12 }), []);
  assert.deepStrictEqual(
    dueReminders(ctx({ dueCards: 12, sent: { 'reviews:2026-07-15': '2026-07-15' } })), []);
});

test('planned block notifies within its 10-minute lead window only', () => {
  const mk = (id, startMin, over = {}) => ({
    id, date: '2026-07-15', start_min: startMin, status: 'planned',
    module_code: 'COMP9020', topic_name: 'Graph theory', ...over,
  });
  const blocks = [
    mk(1, 14 * 60 + 5),                      // in 5 min → fires
    mk(2, 14 * 60),                          // right now → fires
    mk(3, 14 * 60 + 30),                     // too far out
    mk(4, 13 * 60),                          // already started
    mk(5, 14 * 60 + 5, { status: 'done' }),  // not planned
    mk(6, 14 * 60 + 5, { date: '2026-07-16' }), // tomorrow
  ];
  const out = dueReminders(ctx({ blocks }));
  assert.deepStrictEqual(out.map(r => r.key), ['block:1', 'block:2']);
  assert.strictEqual(out[0].title, 'Study block at 14:05');
  assert.strictEqual(out[1].title, 'Study block starting now');
  assert.strictEqual(out[0].body, 'COMP9020 · Graph theory');
});

test('streak nudge: evening only, streak ≥ 2, nothing logged today', () => {
  const at20 = new Date(2026, 6, 15, 20, 5);
  const fire = dueReminders({ now: at20, stats: { count: 0, streak: 4 } });
  assert.strictEqual(fire[0].key, 'streak:2026-07-15');
  assert.match(fire[0].title, /4-day streak/);
  assert.deepStrictEqual(dueReminders({ now: at20, stats: { count: 2, streak: 4 } }), []);
  assert.deepStrictEqual(dueReminders({ now: at20, stats: { count: 0, streak: 1 } }), []);
  assert.deepStrictEqual(dueReminders({ now: NOW, stats: { count: 0, streak: 4 } }), []);
});

test('master switch and per-category switches silence their reminders', () => {
  const deadlines = [{ id: 1, title: 'a', due_at: '2026-07-15T18:00', done: 0, module_code: 'X' }];
  const all = { deadlines, dueCards: 3 };
  assert.strictEqual(dueReminders(ctx(all)).length, 2);
  assert.deepStrictEqual(dueReminders(ctx({ ...all, prefs: { enabled: false } })), []);
  const noDeadlines = dueReminders(ctx({ ...all, prefs: { deadlines: false } }));
  assert.deepStrictEqual(noDeadlines.map(r => r.category), ['reviews']);
});

test('normalizePrefs merges stored JSON over defaults and survives junk', () => {
  assert.deepStrictEqual(normalizePrefs(null), { ...DEFAULT_PREFS });
  assert.strictEqual(normalizePrefs('{"streak":false}').streak, false);
  assert.strictEqual(normalizePrefs('{"streak":false}').reviews, true);
  assert.deepStrictEqual(normalizePrefs('not json'), { ...DEFAULT_PREFS });
});

test('pruneSent drops entries older than a week, keeps the rest', () => {
  const sent = {
    'reviews:2026-07-01': '2026-07-01',
    'reviews:2026-07-10': '2026-07-10',
    'deadline:4:d0': '2026-07-15',
  };
  assert.deepStrictEqual(Object.keys(pruneSent(sent, NOW)),
    ['reviews:2026-07-10', 'deadline:4:d0']);
});

test('daysUntil buckets by calendar day regardless of time of day', () => {
  const lateTonight = new Date(2026, 6, 15, 23, 30);
  assert.strictEqual(daysUntil('2026-07-16T00:30', lateTonight), 1);
  assert.strictEqual(daysUntil('2026-07-15T09:00', lateTonight), 0);
  assert.strictEqual(daysUntil('garbage', NOW), null);
  assert.strictEqual(localDateStr(NOW), '2026-07-15');
});
