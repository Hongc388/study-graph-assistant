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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-notes-'));
    db.open(tmpDir);
    const modId = db.createModule({ code: 'COMP3009', name: 'ML', color: '#4f6df5' });
    db.createMaterial({ module_id: modId, title: 'SVM lecture', type: 'lecture', path: '/x.pdf' });
  } catch {
    skipDb = true;
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('reading notes form a concept graph per material', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  const mat = db.listMaterials()[0];
  const a = db.createReadingNote({ material_id: mat.id, label: 'margin', page: 3 });
  const b = db.createReadingNote({ material_id: mat.id, label: 'support vectors', page: 4 });
  db.linkReadingNotes(a, b);
  const graph = db.getReadingNoteGraph(mat.id);
  assert.strictEqual(graph.notes.length, 2);
  assert.strictEqual(graph.links.length, 1);
  db.deleteReadingNote(a);
  assert.strictEqual(db.getReadingNoteGraph(mat.id).notes.length, 1);
  assert.strictEqual(db.getReadingNoteGraph(mat.id).links.length, 0);
});
