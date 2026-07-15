const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpDir;
let skipDb = false;
let db;
let topicId;

before(() => {
  try {
    db = require('../src/main/db');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cards-'));
    db.open(tmpDir);
    const modId = db.createModule({ code: 'COMP3007', name: 'CV', color: '#4f6df5' });
    topicId = db.createTopic({ module_id: modId, name: 'Camera Models' });
  } catch {
    // CI unit-tests job uses npm ci --ignore-scripts — no native sqlite build.
    skipDb = true;
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('new cards are due immediately and reviewing pushes due_at forward', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const id = db.createCard({ topic_id: topicId, front: 'What is the pinhole model?', back: 'x = PX' });
  let due = db.listDueCards(new Date().toISOString());
  assert.ok(due.some(c => c.id === id), 'fresh card appears in the due list');

  const after1 = db.reviewCard(id, 2); // good → 1 day
  assert.strictEqual(after1.interval_days, 1);
  assert.strictEqual(after1.reps, 1);
  due = db.listDueCards(new Date().toISOString());
  assert.ok(!due.some(c => c.id === id), 'reviewed card leaves today\'s due list');
});

test('cardCounts reports due vs total per topic and skips suspended cards', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const id = db.createCard({ topic_id: topicId, front: 'Focal length?', back: 'f' });
  const row = db.cardCounts(new Date().toISOString()).find(r => r.topic_id === topicId);
  assert.strictEqual(row.total, 2);
  assert.strictEqual(row.due, 1); // the card reviewed in the previous test is tomorrow

  const card = db.listCards(topicId).find(c => c.id === id);
  db.updateCard({ ...card, suspended: 1 });
  const row2 = db.cardCounts(new Date().toISOString()).find(r => r.topic_id === topicId);
  assert.strictEqual(row2.due, 0, 'suspended card no longer counts as due');
});

test('pomodoro log counts today and computes the day streak', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const today = '2026-07-14';
  const yesterday = '2026-07-13';
  db.logPomodoro({ date: yesterday, work_min: 25 });
  db.logPomodoro({ date: today, work_min: 25 });
  db.logPomodoro({ date: today, work_min: 25 });
  const s = db.pomodoroStats(today);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.streak, 2);
  // a gap two days back doesn't extend the streak
  db.logPomodoro({ date: '2026-07-10', work_min: 25 });
  assert.strictEqual(db.pomodoroStats(today).streak, 2);
});

test('an empty day keeps yesterday\'s streak alive (not yet broken)', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const s = db.pomodoroStats('2026-07-15'); // no pomodoros logged on the 15th
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.streak, 2, 'streak counts back from yesterday');
});

test('AI feedback log round-trips decisions for few-shot reuse', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  db.logAiFeedback({ kind: 'material-type', accepted: true,
    payload: { title: 'COMP3007_module_guide.pdf', from: 'lecture', to: 'overview' } });
  db.logAiFeedback({ kind: 'material-type', accepted: false,
    payload: { title: '01-camera-models.pdf', from: 'lecture', to: 'overview' } });
  db.logAiFeedback({ kind: 'note-link', accepted: true,
    payload: { a: 'epipolar line', b: 'fundamental matrix' } });

  const types = db.listAiFeedback('material-type');
  assert.strictEqual(types.length, 2);
  assert.strictEqual(types[0].accepted, false, 'newest first');
  assert.strictEqual(types[1].payload.to, 'overview');
  const links = db.listAiFeedback('note-link');
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].payload.a, 'epipolar line');
});
