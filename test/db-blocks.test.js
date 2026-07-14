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
  db.deleteBlock(id);
});
