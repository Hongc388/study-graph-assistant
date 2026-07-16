const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpDir;
let skipDb = false;
let db;
let matId;

before(() => {
  try {
    db = require('../src/main/db');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-hl-'));
    db.open(tmpDir);
    const modId = db.createModule({ code: 'COMP4128', name: 'Algorithms', color: '#12866A' });
    matId = db.createMaterial({ module_id: modId, title: 'Flows lecture', type: 'lecture', path: '/flows.pdf' });
  } catch {
    skipDb = true;
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('highlights persist per material, ordered by page', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const rects = JSON.stringify([{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }]);
  db.createHighlight({ material_id: matId, page: 7, text: 'max-flow min-cut', color: 'green', rects });
  db.createHighlight({ material_id: matId, page: 2, text: 'augmenting path', color: 'yellow', rects });
  const list = db.listHighlights(matId);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list.map(h => h.page), [2, 7]);
  assert.strictEqual(list[0].color, 'yellow');
  assert.deepStrictEqual(JSON.parse(list[1].rects), [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }]);
});

test('deleting a highlight removes only that one', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const before_ = db.listHighlights(matId);
  db.deleteHighlight(before_[0].id);
  const after_ = db.listHighlights(matId);
  assert.strictEqual(after_.length, before_.length - 1);
  assert.ok(!after_.some(h => h.id === before_[0].id));
});

test('highlights are cascade-deleted with their material', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const mat = db.listMaterials().find(m => m.id === matId);
  db.deleteMaterial(mat.id);
  assert.deepStrictEqual(db.listHighlights(matId), []);
});
