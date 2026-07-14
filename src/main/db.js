// SQLite layer: schema + all query helpers.
// One database file lives in Electron's userData directory so it survives app updates.
const path = require('path');
const Database = require('better-sqlite3');

let db;

function open(userDataDir) {
  db = new Database(path.join(userDataDir, 'study-graph.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  return db;
}

function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    term TEXT DEFAULT '',
    color TEXT DEFAULT '#4f6df5'
  );
  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    summary TEXT DEFAULT '',
    mastery REAL NOT NULL DEFAULT 0.3 CHECK (mastery >= 0 AND mastery <= 1)
  );
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    path TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'lecture',
    title TEXT NOT NULL,
    due_at TEXT
  );
  CREATE TABLE IF NOT EXISTS topic_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_topic INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    to_topic INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('prereq','related','cross_module','analogy','exam_cluster')),
    weight REAL NOT NULL DEFAULT 1.0,
    note TEXT DEFAULT '',
    UNIQUE (from_topic, to_topic, kind)
  );
  CREATE TABLE IF NOT EXISTS deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    due_at TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS study_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped'))
  );
  CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    outcome TEXT DEFAULT '',
    notes TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS module_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'tip',
    content TEXT NOT NULL,
    source TEXT DEFAULT ''
  );
  `);
  // Additive migrations for databases created before these columns existed.
  const addCol = (table, col, decl) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch { /* exists */ }
  };
  addCol('modules', 'folder', "TEXT DEFAULT ''");
  addCol('modules', 'work', "TEXT DEFAULT 'reading'"); // proof | coding | writing | reading
  addCol('modules', 'exam_pct', 'REAL');
  addCol('materials', 'mtime', 'REAL');
  addCol('materials', 'size', 'INTEGER');
  addCol('materials', 'seq', 'INTEGER'); // spine position from "01-", "Unit2", …
  // topic_edges gained the 'exam_cluster' kind; SQLite can't alter a CHECK, so
  // rebuild the table once if the old constraint is still in place.
  const ddl = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='topic_edges'")?.sql || '';
  if (ddl && !ddl.includes('exam_cluster')) {
    db.exec(`
      CREATE TABLE topic_edges_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_topic INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        to_topic INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('prereq','related','cross_module','analogy','exam_cluster')),
        weight REAL NOT NULL DEFAULT 1.0,
        note TEXT DEFAULT '',
        UNIQUE (from_topic, to_topic, kind)
      );
      INSERT INTO topic_edges_new SELECT * FROM topic_edges;
      DROP TABLE topic_edges;
      ALTER TABLE topic_edges_new RENAME TO topic_edges;
    `);
  }
}

// ---------- generic helpers ----------
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

// ---------- modules ----------
const listModules = () => all(`
  SELECT m.*,
    (SELECT COUNT(*) FROM topics t WHERE t.module_id = m.id) AS topic_count,
    (SELECT COUNT(*) FROM materials x WHERE x.module_id = m.id) AS material_count,
    (SELECT COUNT(*) FROM deadlines d WHERE d.module_id = m.id AND d.done = 0) AS open_deadlines
  FROM modules m ORDER BY m.code`);
const createModule = (m) =>
  run('INSERT INTO modules (code, name, term, color) VALUES (?,?,?,?)',
    m.code, m.name, m.term || '', m.color || '#4f6df5').lastInsertRowid;
const updateModule = (m) =>
  run('UPDATE modules SET code=?, name=?, term=?, color=? WHERE id=?',
    m.code, m.name, m.term || '', m.color, m.id);
const deleteModule = (id) => run('DELETE FROM modules WHERE id=?', id);

// ---------- topics ----------
const listTopics = (moduleId) => moduleId
  ? all('SELECT * FROM topics WHERE module_id=? ORDER BY name', moduleId)
  : all('SELECT * FROM topics ORDER BY module_id, name');
const createTopic = (t) =>
  run('INSERT INTO topics (module_id, name, summary, mastery) VALUES (?,?,?,?)',
    t.module_id, t.name, t.summary || '', t.mastery ?? 0.3).lastInsertRowid;
const updateTopic = (t) =>
  run('UPDATE topics SET name=?, summary=?, mastery=? WHERE id=?',
    t.name, t.summary || '', t.mastery, t.id);
const deleteTopic = (id) => run('DELETE FROM topics WHERE id=?', id);

// ---------- materials ----------
// Spine-numbered files first, in curriculum order; the rest alphabetically.
const listMaterials = (moduleId) => moduleId
  ? all('SELECT * FROM materials WHERE module_id=? ORDER BY (seq IS NULL), seq, title', moduleId)
  : all('SELECT * FROM materials ORDER BY module_id, (seq IS NULL), seq, title');
const createMaterial = (m) =>
  run('INSERT INTO materials (module_id, topic_id, path, type, title, due_at) VALUES (?,?,?,?,?,?)',
    m.module_id, m.topic_id || null, m.path || '', m.type || 'lecture', m.title, m.due_at || null).lastInsertRowid;
const updateMaterial = (m) =>
  run('UPDATE materials SET topic_id=?, path=?, type=?, title=?, due_at=? WHERE id=?',
    m.topic_id || null, m.path || '', m.type, m.title, m.due_at || null, m.id);
const deleteMaterial = (id) => run('DELETE FROM materials WHERE id=?', id);
const searchMaterials = (q, moduleId) => {
  const like = `%${q}%`;
  return moduleId
    ? all('SELECT * FROM materials WHERE module_id=? AND (title LIKE ? OR path LIKE ?) ORDER BY title', moduleId, like, like)
    : all('SELECT * FROM materials WHERE title LIKE ? OR path LIKE ? ORDER BY title', like, like);
};

// ---------- edges ----------
const listEdges = () => all(`
  SELECT e.*, tf.name AS from_name, tf.module_id AS from_module,
         tt.name AS to_name, tt.module_id AS to_module
  FROM topic_edges e
  JOIN topics tf ON tf.id = e.from_topic
  JOIN topics tt ON tt.id = e.to_topic`);
const createEdge = (e) =>
  run('INSERT OR IGNORE INTO topic_edges (from_topic, to_topic, kind, weight, note) VALUES (?,?,?,?,?)',
    e.from_topic, e.to_topic, e.kind || 'related', e.weight ?? 1.0, e.note || '').lastInsertRowid;
const deleteEdge = (id) => run('DELETE FROM topic_edges WHERE id=?', id);

// ---------- deadlines ----------
const listDeadlines = () => all(`
  SELECT d.*, m.code AS module_code, m.color AS module_color
  FROM deadlines d JOIN modules m ON m.id = d.module_id
  ORDER BY d.done, d.due_at`);
const createDeadline = (d) =>
  run('INSERT INTO deadlines (module_id, topic_id, title, due_at, weight) VALUES (?,?,?,?,?)',
    d.module_id, d.topic_id || null, d.title, d.due_at, d.weight ?? 1.0).lastInsertRowid;
const updateDeadline = (d) =>
  run('UPDATE deadlines SET title=?, due_at=?, weight=?, done=?, topic_id=? WHERE id=?',
    d.title, d.due_at, d.weight, d.done ? 1 : 0, d.topic_id || null, d.id);
const deleteDeadline = (id) => run('DELETE FROM deadlines WHERE id=?', id);

// ---------- study blocks / sessions ----------
const listBlocks = (date) => all(`
  SELECT b.*, t.name AS topic_name, t.module_id, mo.code AS module_code, mo.color AS module_color,
         ma.title AS material_title
  FROM study_blocks b
  LEFT JOIN topics t ON t.id = b.topic_id
  LEFT JOIN modules mo ON mo.id = t.module_id
  LEFT JOIN materials ma ON ma.id = b.material_id
  WHERE b.date = ? ORDER BY b.start_min`, date);
const clearPlannedBlocks = (date) =>
  run("DELETE FROM study_blocks WHERE date=? AND status='planned'", date);
const createBlock = (b) =>
  run('INSERT INTO study_blocks (date, start_min, end_min, topic_id, material_id, reason) VALUES (?,?,?,?,?,?)',
    b.date, b.start_min, b.end_min, b.topic_id, b.material_id || null, b.reason || '').lastInsertRowid;

// Marking a block done/skipped also logs a session and nudges mastery.
function setBlockStatus(id, status) {
  const b = get('SELECT * FROM study_blocks WHERE id=?', id);
  if (!b) return;
  run('UPDATE study_blocks SET status=? WHERE id=?', status, id);
  if (b.topic_id) {
    if (status === 'done') {
      run('INSERT INTO study_sessions (topic_id, date, duration_min, outcome) VALUES (?,?,?,?)',
        b.topic_id, b.date, b.end_min - b.start_min, 'done');
      // Diminishing-returns mastery bump: long sessions help more, capped at 1.
      const gain = Math.min(0.15, (b.end_min - b.start_min) / 600);
      run('UPDATE topics SET mastery = MIN(1.0, mastery + ?) WHERE id=?', gain, b.topic_id);
    } else if (status === 'skipped') {
      run('INSERT INTO study_sessions (topic_id, date, duration_min, outcome) VALUES (?,?,?,?)',
        b.topic_id, b.date, 0, 'skipped');
    }
  }
}

// ---------- ingest (idempotent: re-running updates, never duplicates) ----------
// scan = output of ingest.scanRoot(); strategy = ingest.parseStrategy() or null.
function applyIngest(scan, strategy, opts = {}) {
  const todayIso = opts.today || new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    const stats = { modules: 0, materials: 0, updated: 0, removed: 0,
                    topics: 0, tips: 0, deadlines: 0, spineEdges: 0 };
    const scannedPaths = new Set();
    for (const m of scan.modules) {
      let mod = get('SELECT * FROM modules WHERE folder=? OR code=?', m.folder, m.code);
      if (!mod) {
        const id = run('INSERT INTO modules (code, name, term, color, folder, work) VALUES (?,?,?,?,?,?)',
          m.code, m.name, '', m.color, m.folder, m.work).lastInsertRowid;
        mod = { id };
        stats.modules++;
      } else {
        run('UPDATE modules SET folder=?, work=? WHERE id=?', m.folder, m.work, mod.id);
        // refresh color only if the stored one is a legacy default (not user-picked)
        if (require('./ingest').LEGACY_DEFAULT_COLORS.has(mod.color)) {
          run('UPDATE modules SET color=? WHERE id=?', m.color, mod.id);
        }
      }
      for (const f of m.files) {
        scannedPaths.add(f.path);
        const existing = get('SELECT id, mtime FROM materials WHERE path=?', f.path);
        if (existing) {
          if (existing.mtime !== f.mtime) stats.updated++;
          run('UPDATE materials SET mtime=?, size=?, seq=? WHERE id=?', f.mtime, f.size, f.seq, existing.id);
        } else {
          run('INSERT INTO materials (module_id, title, path, type, mtime, size, seq) VALUES (?,?,?,?,?,?,?)',
            mod.id, f.name, f.path, classifyLazy(f.name), f.mtime, f.size, f.seq);
          stats.materials++;
        }
        // Dated exam paper -> auto deadline with countdown (future dates only;
        // past papers stay useful as exam-prep material but shouldn't panic the planner).
        if (f.examDate && f.examDate >= todayIso) {
          const due = f.examDate + 'T09:00';
          if (!get('SELECT id FROM deadlines WHERE module_id=? AND due_at=?', mod.id, due)) {
            run('INSERT INTO deadlines (module_id, title, due_at, weight) VALUES (?,?,?,?)',
              mod.id, `${m.code} exam (from ${f.name})`, due, 3);
            stats.deadlines++;
          }
        }
      }
      const topicIdByName = new Map();
      for (const s of m.topicSuggestions) {
        let t = get('SELECT id FROM topics WHERE module_id=? AND LOWER(name)=LOWER(?)', mod.id, s.name);
        if (!t) {
          t = { id: run('INSERT INTO topics (module_id, name, summary) VALUES (?,?,?)',
            mod.id, s.name, `suggested from ${s.fromFile}`).lastInsertRowid };
          stats.topics++;
        }
        topicIdByName.set(s.name, { id: t.id, seq: s.seq });
      }
      // Spine ordering: consecutive lecture-numbered topics form a prereq chain
      // ("01-camera-models" before "02-single-view-metrology"). INSERT OR IGNORE
      // keeps re-ingests idempotent; users can delete any edge they disagree with.
      const spine = [...topicIdByName.values()]
        .filter(t => t.seq != null)
        .sort((a, b) => a.seq - b.seq);
      for (let i = 0; i + 1 < spine.length; i++) {
        const r = run(`INSERT OR IGNORE INTO topic_edges (from_topic, to_topic, kind, note)
          VALUES (?,?,?,?)`, spine[i].id, spine[i + 1].id, 'prereq', 'lecture order (spine)');
        if (r.changes) stats.spineEdges++;
      }
    }
    // Diff ingest: drop materials whose file vanished from the library root
    // (only auto-indexed ones — manual links/notes have paths outside the root).
    if (scan.root) {
      for (const row of all("SELECT id, path FROM materials WHERE path LIKE ?", scan.root + '/%')) {
        if (!scannedPaths.has(row.path)) {
          run('DELETE FROM materials WHERE id=?', row.id);
          stats.removed++;
        }
      }
    }
    if (strategy) {
      for (const sec of strategy) {
        const mod = get('SELECT id FROM modules WHERE code=?', sec.code);
        if (!mod) continue;
        if (sec.examPct != null) run('UPDATE modules SET exam_pct=? WHERE id=?', sec.examPct, mod.id);
        run('DELETE FROM module_notes WHERE module_id=? AND source=?', mod.id, 'strategy.md');
        if (sec.assessment)
          run('INSERT INTO module_notes (module_id, kind, content, source) VALUES (?,?,?,?)',
            mod.id, 'assessment', sec.assessment, 'strategy.md');
        for (const tip of sec.tips) {
          run('INSERT INTO module_notes (module_id, kind, content, source) VALUES (?,?,?,?)',
            mod.id, 'tip', tip, 'strategy.md');
          stats.tips++;
        }
      }
    }
    return stats;
  });
  return tx();
}
// material type classifier lives in ingest.js; required lazily to avoid a cycle
function classifyLazy(name) { return require('./ingest').classify(name); }

const listModuleNotes = (moduleId) =>
  all('SELECT * FROM module_notes WHERE module_id=? ORDER BY kind DESC, id', moduleId);

// ---------- settings ----------
const getSetting = (key) => get('SELECT value FROM settings WHERE key=?', key)?.value ?? null;
const setSetting = (key, value) =>
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);

module.exports = {
  open,
  listModules, createModule, updateModule, deleteModule,
  listTopics, createTopic, updateTopic, deleteTopic,
  listMaterials, createMaterial, updateMaterial, deleteMaterial, searchMaterials,
  listEdges, createEdge, deleteEdge,
  listDeadlines, createDeadline, updateDeadline, deleteDeadline,
  listBlocks, clearPlannedBlocks, createBlock, setBlockStatus,
  applyIngest, listModuleNotes,
  getSetting, setSetting,
};
