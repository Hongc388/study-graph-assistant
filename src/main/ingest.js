// Smart ingest: scan a library root (default ~/Desktop/year_three), map known
// subfolders to modules, index study files as materials, suggest topics from
// filenames, and parse Year3_Study_Strategy.md into per-module tips.
const fs = require('fs');
const path = require('path');

// Known folder -> module mapping (spec). Anything unknown becomes a module
// named after its folder so other roots work too.
const KNOWN_MODULES = {
  'computibility':      { code: 'COMP3001', name: 'Computability & Complexity', color: '#7c6ff0', work: 'proof' },
  'machine_learning':   { code: 'COMP3009', name: 'Machine Learning',           color: '#4f8ff7', work: 'coding' },
  'computer vision':    { code: 'COMP3007', name: 'Computer Vision',            color: '#22b8cf', work: 'coding' },
  'cryptography':       { code: 'COMP3077', name: 'Cryptography',               color: '#e8590c', work: 'coding' },
  'agent':              { code: 'COMP3004', name: 'Agents',                     color: '#f59f00', work: 'writing' },
  'computer security':  { code: 'COMP3006', name: 'Computer Security',          color: '#e64980', work: 'coding' },
  'ethics':             { code: 'COMP3020', name: 'Ethics',                     color: '#94d82d', work: 'writing' },
  'dessertation':       { code: 'COMP3003', name: 'Dissertation',               color: '#20c997', work: 'writing' },
  'referenceBook':      { code: 'REF',      name: 'Shared Reference Library',   color: '#868e96', work: 'reading' },
};

const INDEX_EXTS = new Set(['.pdf', '.md', '.ipynb', '.docx', '.pptx', '.txt', '.py', '.c', '.cpp', '.html', '.doc']);
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'venv', '.venv', 'env',
  'site-packages', 'dist', 'build', 'checkpoints', 'data', 'datasets', 'Untitled']);
const MAX_DEPTH = 4;
const MAX_FILES_PER_MODULE = 400;

const TYPE_BY_HINT = [
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
        files.push({ path: full, name: e.name, mtime: st.mtimeMs, size: st.size });
      }
    }
  })(dir, 0);
  return files;
}

/** Scan the root. Returns { modules: [{folder, code, name, color, work, files:[...] , topicSuggestions:[...]}], strategyPath } */
function scanRoot(root) {
  const out = { modules: [], strategyPath: null };
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
    const topicSuggestions = [];
    for (const f of files) {
      const t = topicFromFilename(f.name);
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); topicSuggestions.push({ name: t, fromFile: f.name }); }
    }
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
              assessment: '', examPct: null, tips: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^##\s/.test(line) && !/^###/.test(line)) { cur = null; continue; }
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

module.exports = { scanRoot, parseStrategy, classify, KNOWN_MODULES };
