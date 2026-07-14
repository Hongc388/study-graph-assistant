const { test } = require('node:test');
const assert = require('node:assert');
const { planDay } = require('../src/main/scheduler');

const WINDOW = [{ start_min: 18 * 60, end_min: 21 * 60 }];

function world() {
  return {
    date: '2026-07-14',
    windows: WINDOW,
    topics: [
      { id: 1, module_id: 1, name: 'SVD', mastery: 0.3 },
      { id: 2, module_id: 2, name: 'PCA', mastery: 0.2 },
      { id: 3, module_id: 2, name: 'SVM', mastery: 0.6 },
      { id: 4, module_id: 3, name: 'Entropy', mastery: 0.5 },
    ],
    edges: [
      { from_topic: 1, to_topic: 2, kind: 'prereq' },
      { from_topic: 4, to_topic: 2, kind: 'cross_module' },
    ],
    deadlines: [
      { module_id: 2, topic_id: 2, title: 'ML midterm', due_at: '2026-07-18', weight: 3, done: 0 },
    ],
    materials: [],
  };
}

test('prereq-blocked topic is never scheduled; its parent is boosted', () => {
  const plan = planDay(world());
  const ids = plan.map(b => b.topic_id);
  assert.ok(!ids.includes(2), 'PCA is blocked (SVD mastery 0.3 < 0.5)');
  assert.strictEqual(ids[0], 1, 'SVD (the blocker) is scheduled first');
  assert.match(plan[0].reason, /unblocks "PCA"/);
});

test('once the prereq is mastered, the urgent weak topic tops the plan', () => {
  const w = world();
  w.topics[0].mastery = 0.8;
  const plan = planDay(w);
  assert.strictEqual(plan[0].topic_id, 2, 'PCA first');
  assert.match(plan[0].reason, /ML midterm due in \d+d/);
});

test('cross-module review is interleaved after a long focus block', () => {
  const w = world();
  w.topics[0].mastery = 0.8;
  const plan = planDay(w);
  const review = plan.find(b => /cross-module review/.test(b.reason));
  assert.ok(review, 'a spaced review block exists');
  assert.strictEqual(review.topic_id, 1, 'reviews the linked cross-module topic');
});

test('no block is shorter than 25 minutes and blocks fit the window', () => {
  const plan = planDay(world());
  for (const b of plan) {
    assert.ok(b.end_min - b.start_min >= 25, 'deep-work protection');
    assert.ok(b.start_min >= WINDOW[0].start_min && b.end_min <= WINDOW[0].end_min);
  }
});

test('under-budget module gets boosted with a budget rationale', () => {
  const w = world();
  w.deadlines = [];
  // equal mastery so only the hour deficit differentiates SVM (mod 2) vs Entropy (mod 3)
  w.topics = [
    { id: 3, module_id: 2, name: 'SVM', mastery: 0.5 },
    { id: 4, module_id: 3, name: 'Entropy', mastery: 0.5 },
  ];
  w.edges = [];
  w.modules = [
    { id: 2, spent_min: 0, target_hours: 100 },      // untouched → deficit 1
    { id: 3, spent_min: 6000, target_hours: 100 },   // done → deficit 0
  ];
  const plan = planDay(w);
  assert.strictEqual(plan[0].topic_id, 3, 'starved module scheduled first');
  assert.match(plan[0].reason, /module under budget: 0h\/100h/);
});

test('problem counts appear in the rationale when present', () => {
  const w = world();
  w.topics[0] = { ...w.topics[0], mastery: 0.2, problem_count: 8, solved_count: 2, attempted_count: 1 };
  const plan = planDay(w);
  const svd = plan.find(b => b.topic_id === 1);
  assert.match(svd.reason, /2\/8 problems solved/);
});

test('done deadlines are ignored', () => {
  const w = world();
  w.topics[0].mastery = 0.8;
  w.deadlines[0].done = 1;
  const plan = planDay(w);
  assert.ok(!/ML midterm/.test(plan.map(b => b.reason).join(' ')));
});

test('exam mode boosts topics with unsolved problems when exam is within 14 days', () => {
  const w = world();
  w.topics = [
    { id: 1, module_id: 1, name: 'SVD', mastery: 0.4, problem_count: 5, solved_count: 1 },
    { id: 3, module_id: 2, name: 'SVM', mastery: 0.4, problem_count: 0, solved_count: 0 },
  ];
  w.edges = [];
  w.deadlines = [
    { module_id: 1, topic_id: null, title: 'LinAlg exam', due_at: '2026-07-20', weight: 3, done: 0 },
    { module_id: 2, topic_id: null, title: 'ML exam', due_at: '2026-07-20', weight: 3, done: 0 },
  ];
  const plan = planDay(w);
  assert.strictEqual(plan[0].topic_id, 1);
  assert.match(plan[0].reason, /exam mode: unsolved problems/);
});
