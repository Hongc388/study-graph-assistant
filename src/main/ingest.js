// Smart ingest: scan a library root (default ~/Desktop/year_three), map known
// subfolders to modules, index study files as materials, suggest topics from
// filenames, and parse Year3_Study_Strategy.md into per-module tips.
const fs = require('fs');
const path = require('path');

// Known folder -> module mapping (spec). Anything unknown becomes a module
// named after its folder so other roots work too.
// Colors: CVD-validated categorical palette for dark surfaces (fixed assignment,
// never cycled); REF gets a neutral gray since it's a shared library, not a series.
const KNOWN_MODULES = {
  'computibility':      { code: 'COMP3001', name: 'Computability & Complexity', color: '#444441', work: 'proof' },
  'machine_learning':   { code: 'COMP3009', name: 'Machine Learning',           color: '#085041', work: 'coding' },
  'computer vision':    { code: 'COMP3007', name: 'Computer Vision',            color: '#3C3489', work: 'coding' },
  'cryptography':       { code: 'COMP3077', name: 'Cryptography',               color: '#712B13', work: 'coding' },
  'agent':              { code: 'COMP3004', name: 'Agents',                     color: '#72243E', work: 'writing' },
  'computer security':  { code: 'COMP3006', name: 'Computer Security',          color: '#444441', work: 'coding' },
  'ethics':             { code: 'COMP3020', name: 'Ethics',                     color: '#444441', work: 'writing' },
  'dessertation':       { code: 'COMP3003', name: 'Dissertation',               color: '#72243E', work: 'writing' },
  'referenceBook':      { code: 'REF',      name: 'Shared Reference Library',   color: '#444441', work: 'reading' },
};

// Defaults shipped before the validated palette — refreshed on re-ingest so
// existing databases pick up the fix; user-customized colors are left alone.
const LEGACY_DEFAULT_COLORS = new Set(['#7c6ff0', '#4f8ff7', '#22b8cf', '#e8590c',
  '#f59f00', '#e64980', '#94d82d', '#20c997', '#4f6df5', '#10a37f', '#5b8cff',
  '#9085e9', '#3987e5', '#199e70', '#d95926', '#c98500', '#d55181', '#008300',
  '#e66767', '#868e96']);

const INDEX_EXTS = new Set(['.pdf', '.md', '.ipynb', '.docx', '.pptx', '.txt', '.py', '.c', '.cpp', '.html', '.doc']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'venv', '.venv', 'env',
  'site-packages', 'dist', 'build', 'checkpoints', 'data', 'datasets', 'Untitled']);
const MAX_DEPTH = 4;
const MAX_FILES_PER_MODULE = 400;
// Topics are a curated spine, not a folder mirror — not every file gets a node.
const MAX_TOPICS_PER_MODULE = 25;

const TYPE_BY_HINT = [
  // course-description files, not study content ("01-introduction.pdf" is NOT
  // matched — that's usually a real first lecture; the AI type check covers it)
  [/syllabus|handbook|module[-_ ]?(guide|info|overview|intro)|welcome|about[-_ ]?(the[-_ ]?)?module/i, 'overview'],
  [/assignment|problemset|coursework|homework|hw\d/i, 'assignment'],
  [/exam|past.?paper|midterm|quiz/i, 'exam-prep'],
  [/_\d{1,2}_(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*_\d{4}/i, 'exam-prep'], // "COMP3001_07_May_2026.pdf"
  [/lab|notebook|\.ipynb$/i, 'lab'],
  [/cheat|summary|template/i, 'cheatsheet'],
  [/arxiv|\d{4}\.\d{4,5}|paper/i, 'paper'],
];

function classify(filename) {
  for (const [re, type] of TYPE_BY_HINT) if (re.test(filename)) return type;
  return 'lecture';
}

// Spine position: "01-camera-models.pdf" -> 1, "COMP3001_Unit2_..." -> 2.
// Lecture-numbered files form the module's guided learning path.
function seqFromFilename(filename) {
  let m = filename.match(/^(\d{1,3})[-_. ]/);
  if (m) return Number(m[1]);
  m = filename.match(/(?:Unit|Block|Lecture|Week|Chapter)\s*_?(\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
                 jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "COMP3001_07_May_2026.pdf" -> "2026-05-07" (an exam date to count down to).
function examDateFromFilename(filename) {
  const m = filename.match(/(\d{1,2})[_ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[_ -](\d{4})/i);
  if (!m) return null;
  const day = String(Number(m[1])).padStart(2, '0');
  const month = String(MONTHS[m[2].toLowerCase().slice(0, 3)]).padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

// "08-monocular_depth_estimation.pdf" -> "Monocular Depth Estimation"
function topicFromFilename(filename) {
  let base = filename.replace(/\.[^.]+$/, '');
  base = base.replace(/\.md$/, '');
  base = base.replace(/\s*\(\d+\)\s*$/, '');             // "(1)" duplicate-download suffix
  base = base.replace(/^\d{1,3}[-_. ]+/, '');            // leading lecture number
  base = base.replace(/^COMP\d{4}[-_ ]*/i, '');          // course code prefix
  base = base.replace(/^(Unit|Block|Lecture|Chapter|Week|Module)\s*\d*[-_: ]*/i, '');
  base = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || /^\d+$/.test(base) || base.length < 4 || base.length > 60) return null;
  if (/untitled|course notes|lecture\d*post|notes?\d+[ab]?$/i.test(base)) return null;
  if (/^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{4}/i.test(base)) return null; // dated exam papers
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(base)) return null; // arXiv ids
  if (!base.includes(' ') && base.length > 18) return null; // GluedTogetherBookDumpNames
  // Title Case, keep known acronyms
  return base.split(' ').map(w =>
    /^(of|the|and|in|to|for|a|an|vs)$/i.test(w) ? w.toLowerCase()
    : w.length <= 4 && w === w.toUpperCase() ? w
    : w[0].toUpperCase() + w.slice(1)).join(' ');
}

function scanModuleDir(dir) {
  const files = [];
  (function walk(d, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES_PER_MODULE) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES_PER_MODULE) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1);
      } else if (INDEX_EXTS.has(path.extname(e.name).toLowerCase())) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        files.push({ path: full, name: e.name, mtime: st.mtimeMs, size: st.size,
          seq: seqFromFilename(e.name), examDate: examDateFromFilename(e.name) });
      }
    }
  })(dir, 0);
  return files;
}

/** Scan the root. Returns { modules: [{folder, code, name, color, work, files:[...] , topicSuggestions:[...]}], strategyPath } */
function scanRoot(root) {
  const out = { root, modules: [], strategyPath: null };
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { throw new Error(`Cannot read ${root}: ${e.message}`); }

  for (const e of entries) {
    if (e.isFile() && /strategy.*\.md$/i.test(e.name)) out.strategyPath = path.join(root, e.name);
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const known = KNOWN_MODULES[e.name] || {
      code: e.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 12),
      name: e.name, color: '#868e96', work: 'reading',
    };
    const files = scanModuleDir(path.join(root, e.name));
    const seen = new Set();
    let topicSuggestions = [];
    for (const f of files) {
      const t = topicFromFilename(f.name);
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        topicSuggestions.push({ name: t, fromFile: f.name, seq: f.seq });
      }
    }
    // Merge prefix duplicates ("Monocular Depth" ⊂ "Monocular Depth Estimation")
    // keeping the longer, more specific name.
    topicSuggestions = topicSuggestions.filter(a =>
      !topicSuggestions.some(b => b !== a &&
        b.name.toLowerCase().startsWith(a.name.toLowerCase()) && b.name.length > a.name.length));
    // Spine topics first, then cap — the rest stay reachable as materials.
    topicSuggestions.sort((a, b) => (a.seq == null) - (b.seq == null) || (a.seq ?? 0) - (b.seq ?? 0));
    topicSuggestions = topicSuggestions.slice(0, MAX_TOPICS_PER_MODULE);
    out.modules.push({ folder: e.name, ...known, files, topicSuggestions });
  }
  return out;
}

/**
 * Parse Year3_Study_Strategy.md into per-module structured tips.
 * Recognizes "## N. <emoji> Name (CODE)" section heads, "**Credits:** ... Assessment: ..."
 * lines, and "### ..." step headings. Returns [{code, heading, assessment, examPct, tips:[...]}]
 */
function parseStrategy(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const head = line.match(/^##\s+\d+\.\s*(.+?)\s*\((COMP\d{4})\)/);
    if (head) {
      cur = { code: head[2], heading: head[1].replace(/[^\p{L}\p{N} &-]/gu, '').trim(),
              assessment: '', examPct: null, credits: null, tips: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^##\s/.test(line) && !/^###/.test(line)) { cur = null; continue; }
    const cred = line.match(/\*\*Credits:?\*\*\s*(\d+)|Credits:\s*(\d+)/i);
    if (cred) cur.credits = Number(cred[1] || cred[2]);
    const assess = line.match(/\*\*Assessment:?\*\*\s*(.+)|Assessment:\s*(.+)/i);
    if (assess) {
      cur.assessment = (assess[1] || assess[2]).trim();
      const pct = cur.assessment.match(/(\d{1,3})%\s*exam/i) || cur.assessment.match(/exam[^0-9]*(\d{1,3})%/i);
      if (pct) cur.examPct = Number(pct[1]);
    }
    const tip = line.match(/^###\s+(.+)/);
    if (tip) cur.tips.push(tip[1].replace(/^Step \d+ [—-] /, '').trim());
  }
  return sections;
}

module.exports = { scanRoot, parseStrategy, classify, seqFromFilename, examDateFromFilename,
  KNOWN_MODULES, LEGACY_DEFAULT_COLORS };
