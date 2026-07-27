const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { executeIngest } = require('../src/main/ingest-job');
const { scanRoot, parseStrategy } = require('../src/main/ingest');

test('executeIngest reports scan progress per module and returns stats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ingest-job-'));
  const modDir = path.join(root, 'computer vision');
  fs.mkdirSync(modDir);
  fs.writeFileSync(path.join(modDir, '01-intro.pdf'), 'pdf');

  const progress = [];
  let applied = false;
  const result = executeIngest({
    root,
    defaultRoot: root,
    getSetting: () => null,
    setSetting: () => {},
    scanRoot,
    parseStrategy,
    applyIngest: (scan) => {
      applied = true;
      assert.strictEqual(scan.modules.length, 1);
      assert.strictEqual(scan.modules[0].files.length, 1);
      return { modules: 1, materials: 1, topics: 0, updated: 0, removed: 0,
        deadlines: 0, spineEdges: 0, tips: 0 };
    },
    onProgress: (p) => progress.push(p),
  });

  assert.ok(applied);
  assert.strictEqual(result.modules, 1);
  assert.strictEqual(result.materials, 1);
  assert.ok(progress.some(p => p.phase === 'scan' && p.total === 1 && p.done === 1));
  assert.ok(progress.some(p => p.phase === 'db'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('executeIngest uses library_root setting when root arg omitted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ingest-job2-'));
  fs.mkdirSync(path.join(root, 'ethics'));
  let stored = null;
  executeIngest({
    defaultRoot: '/unused',
    getSetting: (k) => (k === 'library_root' ? root : null),
    setSetting: (k, v) => { if (k === 'library_root') stored = v; },
    scanRoot,
    parseStrategy,
    applyIngest: () => ({ modules: 0, materials: 0, topics: 0, updated: 0,
      removed: 0, deadlines: 0, spineEdges: 0, tips: 0 }),
  });
  assert.strictEqual(stored, root);
  fs.rmSync(root, { recursive: true, force: true });
});
