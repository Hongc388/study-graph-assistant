// Rename/move materials on disk when the user drops them into a section + slot.
const fs = require('fs');
const path = require('path');

const SLOTS = ['lecture', 'problemset', 'reference', 'lab', 'other'];

const SLOT_LABELS = {
  lecture: 'Lecture notes',
  problemset: 'Problem set',
  reference: 'Reference',
  lab: 'Lab code',
  other: 'Other',
};

/** Map legacy ingest types → section slot. */
const LEGACY_TO_SLOT = {
  lecture: 'lecture',
  assignment: 'problemset',
  'exam-prep': 'problemset',
  paper: 'problemset',
  lab: 'lab',
  cheatsheet: 'reference',
  notes: 'reference',
};

function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'section';
}

function normalizeSlot(slot) {
  const s = String(slot || 'other').toLowerCase();
  return SLOTS.includes(s) ? s : 'other';
}

function slotFromLegacy(type) {
  return LEGACY_TO_SLOT[type] || normalizeSlot(type);
}

/**
 * @param {Set<string>} takenBasenames lowercased filenames already used
 */
function plannedBasename(sectionName, slot, ext, takenBasenames) {
  const base = `${slugify(sectionName)}-${normalizeSlot(slot)}`;
  let candidate = `${base}${ext}`;
  if (!takenBasenames.has(candidate.toLowerCase())) return candidate;
  for (let n = 2; n < 100; n++) {
    candidate = `${base}-${String(n).padStart(2, '0')}${ext}`;
    if (!takenBasenames.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

function collectTakenBasenames(targetDir, extraPaths = []) {
  const taken = new Set();
  for (const p of extraPaths) {
    if (p) taken.add(path.basename(p).toLowerCase());
  }
  if (targetDir && fs.existsSync(targetDir)) {
    for (const f of fs.readdirSync(targetDir)) {
      if (!f.startsWith('.')) taken.add(f.toLowerCase());
    }
  }
  return taken;
}

/**
 * Move + rename a material file into the module folder with a structured name.
 * @returns {{ path: string, title: string, renamed: boolean }}
 */
function organizeOnDisk({
  libRoot,
  moduleFolder,
  materialPath,
  sectionName,
  slot,
  reservedPaths = [],
}) {
  if (!materialPath || materialPath.startsWith('http') || !fs.existsSync(materialPath)) {
    const title = materialPath ? path.basename(materialPath) : 'material';
    return { path: materialPath || '', title, renamed: false };
  }
  const targetDir = path.join(libRoot, moduleFolder);
  fs.mkdirSync(targetDir, { recursive: true });
  const ext = path.extname(materialPath) || '';
  const taken = collectTakenBasenames(targetDir, reservedPaths.filter(p => p !== materialPath));
  const basename = plannedBasename(sectionName, slot, ext, taken);
  const newPath = path.join(targetDir, basename);
  if (path.resolve(materialPath) !== path.resolve(newPath)) {
    fs.renameSync(materialPath, newPath);
    return { path: newPath, title: basename, renamed: true };
  }
  return { path: newPath, title: basename, renamed: false };
}

module.exports = {
  SLOTS,
  SLOT_LABELS,
  slugify,
  normalizeSlot,
  slotFromLegacy,
  plannedBasename,
  organizeOnDisk,
};
