const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { scanRoot, parseStrategy, classify, seqFromFilename, examDateFromFilename, KNOWN_MODULES } = require('../src/main/ingest');

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

test('classify separates course-info files from study material', () => {
  for (const f of ['module-handbook.pdf', 'COMP3009_syllabus.pdf', 'Welcome slides.pptx',
    'about_the_module.pdf', 'course-outline-2026.pdf', 'timetable_spring.pdf',
    'marking-scheme.pdf', 'staff_contacts.md']) {
    assert.strictEqual(classify(f), 'overview', f);
  }
  // a real first lecture must stay a lecture
  assert.strictEqual(classify('01-introduction.pdf'), 'lecture');
  assert.strictEqual(classify('02-course-of-values-recursion.pdf'), 'lecture');
});

test('seqFromFilename reads lecture numbers and Unit/Block markers', () => {
  assert.strictEqual(seqFromFilename('01-camera-models.pdf'), 1);
  assert.strictEqual(seqFromFilename('08-monocular_depth_estimation.pdf'), 8);
  assert.strictEqual(seqFromFilename('COMP3001_Unit2_Equivalent_Models.md'), 2);
  assert.strictEqual(seqFromFilename('problemset1.pdf'), null);
});

test('examDateFromFilename parses dated exam papers', () => {
  assert.strictEqual(examDateFromFilename('COMP3001_07_May_2026.pdf'), '2026-05-07');
  assert.strictEqual(examDateFromFilename('COMP3007_08_July_2026.pdf'), '2026-07-08');
  assert.strictEqual(examDateFromFilename('01-camera-models.pdf'), null);
});

test('scanned files carry seq and examDate for the ingest diff', () => {
  const root = makeRoot();
  const r = scanRoot(root);
  assert.strictEqual(r.root, root, 'scan reports its root for diff deletion');
  const cv = r.modules.find(m => m.folder === 'computer vision');
  const depth = cv.files.find(f => f.name.startsWith('08-'));
  assert.strictEqual(depth.seq, 8);
  const exam = cv.files.find(f => f.name.includes('July'));
  assert.strictEqual(exam.examDate, '2026-07-08');
  fs.rmSync(root, { recursive: true, force: true });
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
