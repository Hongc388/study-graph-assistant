const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpDir;
let skipDb = false;
let db;

before(() => {
  try {
    db = require('../src/main/db');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-db-'));
    db.open(tmpDir);
    const modId = db.createModule({ code: 'COMP3009', name: 'ML', color: '#4f6df5' });
    const topicId = db.createTopic({ module_id: modId, name: 'PCA' });
    db.createMaterial({ module_id: modId, topic_id: topicId, title: 'Lecture 1', type: 'lecture', path: '/x.pdf' });
  } catch {
    // CI unit-tests job uses npm ci --ignore-scripts — no native sqlite build.
    skipDb = true;
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('manual study blocks can be created, listed, and deleted', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const date = '2026-07-14';
  const topics = db.listTopics();
  const blockId = db.createBlock({
    date,
    start_min: 18 * 60,
    end_min: 19 * 60 + 30,
    topic_id: topics[0].id,
    reason: 'review eigenvectors',
  });
  const blocks = db.listBlocks(date);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].topic_name, 'PCA');
  assert.strictEqual(blocks[0].start_min, 18 * 60);
  db.deleteBlock(blockId);
  assert.strictEqual(db.listBlocks(date).length, 0);
});

test('marking a block done logs study and material session time', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const date = '2026-07-15';
  const topic = db.listTopics()[0];
  const mat = db.listMaterials()[0];
  const id = db.createBlock({
    date,
    start_min: 10 * 60,
    end_min: 11 * 60,
    topic_id: topic.id,
    material_id: mat.id,
    reason: 'problem set',
  });
  db.setBlockStatus(id, 'done');
  const block = db.listBlocks(date).find(b => b.id === id);
  assert.strictEqual(block.status, 'done');
  const log = db.listStudyToday(date);
  assert.ok(log.some(x => x.kind === 'session' || x.kind === 'block'));
  db.setBlockStatus(id, 'planned');
  assert.strictEqual(db.listStudyToday(date).filter(x => x.source === 'block').length, 0);
  db.deleteBlock(id);
});

test('updateBlock edits time, topic, material and note but not status', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const date = '2026-07-17';
  const topic = db.listTopics()[0];
  const mat = db.listMaterials()[0];
  const id = db.createBlock({
    date,
    start_min: 9 * 60,
    end_min: 10 * 60,
    topic_id: topic.id,
    reason: 'first draft',
  });
  db.updateBlock({
    id,
    start_min: 16 * 60,
    end_min: 17 * 60 + 30,
    topic_id: topic.id,
    material_id: mat.id,
    reason: 'moved to the afternoon',
  });
  const b = db.listBlocks(date).find(x => x.id === id);
  assert.strictEqual(b.start_min, 16 * 60);
  assert.strictEqual(b.end_min, 17 * 60 + 30);
  assert.strictEqual(b.material_id, mat.id);
  assert.strictEqual(b.reason, 'moved to the afternoon');
  assert.strictEqual(b.status, 'planned', 'editing never flips status');
  db.deleteBlock(id);
});

test('duplicate block creates a new planned row', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const date = '2026-07-16';
  const topic = db.listTopics()[0];
  const id = db.createBlock({
    date,
    start_min: 14 * 60,
    end_min: 15 * 60,
    topic_id: topic.id,
    reason: 'review',
  });
  db.setBlockStatus(id, 'done');
  const copyId = db.duplicateBlock(id);
  const blocks = db.listBlocks(date);
  assert.strictEqual(blocks.length, 2);
  assert.ok(blocks.some(b => b.id === copyId && b.status === 'planned'));
  db.deleteBlock(copyId);
  db.deleteBlock(id);
});

test('reorder blocks updates sort order within a column', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const date = '2026-07-17';
  const topic = db.listTopics()[0];
  const a = db.createBlock({ date, start_min: 9 * 60, end_min: 10 * 60, topic_id: topic.id, reason: 'a' });
  const b = db.createBlock({ date, start_min: 11 * 60, end_min: 12 * 60, topic_id: topic.id, reason: 'b' });
  db.reorderBlocks({ date, status: 'planned', orderedIds: [b, a] });
  const listed = db.listBlocks(date).filter(x => x.status === 'planned');
  assert.strictEqual(listed[0].id, b);
  assert.strictEqual(listed[1].id, a);
  db.deleteBlock(a);
  db.deleteBlock(b);
});

test('material progress saves page and scroll position', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const mat = db.listMaterials()[0];
  db.touchMaterialOpened(mat.id); // resume list only shows opened materials
  db.saveMaterialProgress(mat.id, { last_page: 12 });
  let row = db.getMaterial(mat.id);
  assert.strictEqual(row.last_page, 12);
  db.saveMaterialProgress(mat.id, { last_scroll: 480 });
  row = db.getMaterial(mat.id);
  assert.strictEqual(row.last_page, 12);
  assert.strictEqual(row.last_scroll, 480);
  const resume = db.listResumeItems(5).find(r => r.id === mat.id);
  assert.ok(resume);
  assert.strictEqual(resume.last_scroll, 480);
});

test('recent access loop keeps only MAX_RECENT_ACCESS materials', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const mod = db.listModules()[0];
  const ids = [];
  for (let i = 0; i < db.MAX_RECENT_ACCESS + 3; i++) {
    const id = db.createMaterial({
      module_id: mod.id,
      title: `doc-${i}`,
      type: 'lecture',
      path: `/tmp/doc-${i}.pdf`,
    });
    ids.push(id);
    db.touchMaterialOpened(id);
  }
  const open = db.listResumeItems(100);
  assert.strictEqual(open.length, db.MAX_RECENT_ACCESS);
  const openIds = new Set(open.map(r => r.id));
  // oldest three of the batch should have been pruned from the loop
  assert.ok(!openIds.has(ids[0]));
  assert.ok(!openIds.has(ids[1]));
  assert.ok(!openIds.has(ids[2]));
  assert.ok(openIds.has(ids[ids.length - 1]));
  // reopening an older one brings it back and drops another
  db.touchMaterialOpened(ids[0]);
  const after = new Set(db.listResumeItems(100).map(r => r.id));
  assert.ok(after.has(ids[0]));
  assert.strictEqual(after.size, db.MAX_RECENT_ACCESS);
});
