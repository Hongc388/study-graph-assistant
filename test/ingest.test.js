const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { scanRoot, parseStrategy, classify, KNOWN_MODULES } = require('../src/main/ingest');

// Build a throwaway library root mimicking year_three.
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ingest-'));
  const mk = (p, content = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), content);
  };
  mk('computer vision/08-monocular_depth_estimation.pdf');
  mk('computer vision/COMP3007_08_July_2026.pdf');
  mk('computibility/COMP3001_Unit1_Models_of_Computation.md');
  mk('computibility/node_modules/junk/deep.pdf');   // must be skipped
  mk('computibility/Untitled/huge_dataset.pdf');    // must be skipped
  mk('machine_learning/problemset1.pdf');
  mk('Year3_Study_Strategy.md', [
    '# Strategy', '',
    '## 1. Computability & Complexity (COMP3001)',
    '**Credits:** 10 | **Semester:** Autumn | **Assessment:** 20% continuous + 80% exam',
    '### Step 1 — Build a proof template library',
    '### Step 2 — Do every past paper proof twice',
  ].join('\n'));
  return root;
}

test('scanRoot maps known folders to module codes', () => {
  const root = makeRoot();
  const r = scanRoot(root);
  const cv = r.modules.find(m => m.folder === 'computer vision');
  assert.strictEqual(cv.code, 'COMP3007');
  assert.strictEqual(KNOWN_MODULES['machine_learning'].code, 'COMP3009');
  fs.rmSync(root, { recursive: true, force: true });
});

test('junk directories are not indexed', () => {
  const root = makeRoot();
  const r = scanRoot(root);
  const comp = r.modules.find(m => m.folder === 'computibility');
  assert.ok(comp.files.every(f => !f.path.includes('node_modules') && !f.path.includes('Untitled')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('topics come from filenames, not dates or junk', () => {
  const root = makeRoot();
  const r = scanRoot(root);
  const cv = r.modules.find(m => m.folder === 'computer vision');
  const names = cv.topicSuggestions.map(t => t.name);
  assert.ok(names.includes('Monocular Depth Estimation'), `got: ${names}`);
  assert.ok(!names.some(n => /2026/.test(n)), 'dated exam files are not topics');
  fs.rmSync(root, { recursive: true, force: true });
});

test('classify tags exam papers and problem sets', () => {
  assert.strictEqual(classify('COMP3001_07_May_2026.pdf'), 'exam-prep');
  assert.strictEqual(classify('problemset1.pdf'), 'assignment');
  assert.strictEqual(classify('01-camera-models.pdf'), 'lecture');
});

test('parseStrategy extracts exam percentage and tips', () => {
  const root = makeRoot();
  const r = scanRoot(root);
  const s = parseStrategy(r.strategyPath);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].code, 'COMP3001');
  assert.strictEqual(s[0].examPct, 80);
  assert.strictEqual(s[0].tips.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
