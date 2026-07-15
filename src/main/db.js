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
    color TEXT DEFAULT '#085041'
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
  CREATE TABLE IF NOT EXISTS material_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('block','manual','timer'))
  );
  CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','attempted','solved','reviewed')),
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS module_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'tip',
    content TEXT NOT NULL,
    source TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS reading_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    body TEXT DEFAULT '',
    page INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reading_note_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_note INTEGER NOT NULL REFERENCES reading_notes(id) ON DELETE CASCADE,
    to_note INTEGER NOT NULL REFERENCES reading_notes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'related',
    UNIQUE (from_note, to_note)
  );
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT DEFAULT '',
    ease REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS card_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    reviewed_at TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 0 AND 3),
    interval_days REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pomodoro_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
    work_min INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `);
  // Additive migrations for databases created before these columns existed.
  const addCol = (table, col, decl) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch { /* exists */ }
  };
  addCol('modules', 'folder', "TEXT DEFAULT ''");
  addCol('modules', 'work', "TEXT DEFAULT 'reading'"); // proof | coding | writing | reading
  addCol('modules', 'exam_pct', 'REAL');
  addCol('modules', 'target_hours', 'REAL'); // hour budget (UK: credits × 10)
  addCol('materials', 'mtime', 'REAL');
  addCol('materials', 'size', 'INTEGER');
  addCol('materials', 'seq', 'INTEGER'); // spine position from "01-", "Unit2", …
  addCol('materials', 'last_opened_at', 'TEXT');
  addCol('materials', 'last_page', 'INTEGER');
  addCol('materials', 'last_scroll', 'INTEGER');
  addCol('study_sessions', 'block_id', 'INTEGER REFERENCES study_blocks(id) ON DELETE SET NULL');
  addCol('material_sessions', 'block_id', 'INTEGER REFERENCES study_blocks(id) ON DELETE SET NULL');
  addCol('study_blocks', 'sort_order', 'INTEGER');
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
    (SELECT COUNT(*) FROM deadlines d WHERE d.module_id = m.id AND d.done = 0) AS open_deadlines,
    (SELECT COALESCE(SUM(s.duration_min), 0) FROM material_sessions s
       JOIN materials x ON x.id = s.material_id WHERE x.module_id = m.id) AS spent_min
  FROM modules m ORDER BY m.code`);
const createModule = (m) =>
  run('INSERT INTO modules (code, name, term, color) VALUES (?,?,?,?)',
    m.code, m.name, m.term || '', m.color || '#085041').lastInsertRowid;
const updateModule = (m) =>
  run('UPDATE modules SET code=?, name=?, term=?, color=?, target_hours=? WHERE id=?',
    m.code, m.name, m.term || '', m.color, m.target_hours ?? null, m.id);
const deleteModule = (id) => run('DELETE FROM modules WHERE id=?', id);

// ---------- topics ----------
// Readiness rule (problems vs study time) lives in shared/mastery.js — pure
// and unit-tested; listTopics attaches mastery + both components to each row.
const { deriveMastery } = require('../shared/mastery');
const TOPIC_SQL = `
  SELECT t.id, t.module_id, t.name, t.summary,
    (SELECT COUNT(*) FROM problems p WHERE p.topic_id = t.id) AS problem_count,
    (SELECT COUNT(*) FROM problems p WHERE p.topic_id = t.id AND p.status IN ('solved','reviewed')) AS solved_count,
    (SELECT COUNT(*) FROM problems p WHERE p.topic_id = t.id AND p.status = 'attempted') AS attempted_count,
    (SELECT COALESCE(SUM(s.duration_min), 0) FROM material_sessions s
       JOIN materials m ON m.id = s.material_id WHERE m.topic_id = t.id) AS exposure_min
  FROM topics t`;
const listTopics = (moduleId) => {
  const rows = moduleId
    ? all(TOPIC_SQL + ' WHERE t.module_id=? ORDER BY t.name', moduleId)
    : all(TOPIC_SQL + ' ORDER BY t.module_id, t.name');
  return rows.map(r => ({ ...r, ...deriveMastery(r) }));
};
const createTopic = (t) =>
  run('INSERT INTO topics (module_id, name, summary) VALUES (?,?,?)',
    t.module_id, t.name, t.summary || '').lastInsertRowid;
const updateTopic = (t) =>
  run('UPDATE topics SET name=?, summary=? WHERE id=?', t.name, t.summary || '', t.id);
const deleteTopic = (id) => run('DELETE FROM topics WHERE id=?', id);

// Merge mergeId into keepId: reassign dependents, collapse edges, delete duplicate topic.
function mergeTopics(keepId, mergeId) {
  if (keepId === mergeId) throw new Error('Cannot merge a topic with itself');
  if (!get('SELECT id FROM topics WHERE id=?', keepId)) throw new Error('Keep topic not found');
  if (!get('SELECT id FROM topics WHERE id=?', mergeId)) throw new Error('Merge topic not found');
  const tx = db.transaction(() => {
    for (const sql of [
      'UPDATE materials SET topic_id=? WHERE topic_id=?',
      'UPDATE problems SET topic_id=? WHERE topic_id=?',
      'UPDATE deadlines SET topic_id=? WHERE topic_id=?',
      'UPDATE study_blocks SET topic_id=? WHERE topic_id=?',
      'UPDATE study_sessions SET topic_id=? WHERE topic_id=?',
    ]) run(sql, keepId, mergeId);
    for (const e of all('SELECT * FROM topic_edges WHERE from_topic=? OR to_topic=?', mergeId, mergeId)) {
      const from = e.from_topic === mergeId ? keepId : e.from_topic;
      const to = e.to_topic === mergeId ? keepId : e.to_topic;
      run('DELETE FROM topic_edges WHERE id=?', e.id);
      if (from !== to) {
        run('INSERT OR IGNORE INTO topic_edges (from_topic, to_topic, kind, weight, note) VALUES (?,?,?,?,?)',
          from, to, e.kind, e.weight, e.note);
      }
    }
    run('DELETE FROM topics WHERE id=?', mergeId);
  });
  tx();
}

// Ordered backlog of unsolved problems (exam-soon modules first).
function listProblemQueue(limit = 80) {
  const rows = all(`
    SELECT p.*, t.name AS topic_name, t.module_id,
           m.code AS module_code, m.color AS module_color, m.name AS module_name,
           ma.title AS material_title, ma.path AS material_path, ma.id AS material_id,
           (SELECT MIN(d.due_at) FROM deadlines d
              WHERE d.module_id = t.module_id AND d.done = 0) AS next_due
    FROM problems p
    JOIN topics t ON t.id = p.topic_id
    JOIN modules m ON m.id = t.module_id
    LEFT JOIN materials ma ON ma.id = p.material_id
    WHERE p.status IN ('todo', 'attempted')
    ORDER BY next_due IS NULL, next_due ASC,
             CASE p.status WHEN 'attempted' THEN 0 ELSE 1 END,
             p.id
    LIMIT ?`, limit);
  const now = Date.now();
  return rows.map(r => {
    let daysLeft = null;
    if (r.next_due) {
      daysLeft = Math.ceil((new Date(r.next_due).getTime() - now) / 86400000);
    }
    return { ...r, days_left: daysLeft };
  });
}

// ---------- problems (the competence signal) ----------
const listProblems = (topicId) => all(`
  SELECT p.*, m.title AS material_title FROM problems p
  LEFT JOIN materials m ON m.id = p.material_id
  WHERE p.topic_id=? ORDER BY p.id`, topicId);
const createProblem = (p) =>
  run('INSERT INTO problems (topic_id, material_id, label, status, updated_at) VALUES (?,?,?,?,?)',
    p.topic_id, p.material_id || null, p.label, p.status || 'todo', new Date().toISOString()).lastInsertRowid;
const updateProblem = (p) =>
  run('UPDATE problems SET label=?, status=?, material_id=?, updated_at=? WHERE id=?',
    p.label, p.status, p.material_id || null, new Date().toISOString(), p.id);
const deleteProblem = (id) => run('DELETE FROM problems WHERE id=?', id);

// ---------- material sessions (the time ledger) ----------
const createMaterialSession = (s) =>
  run('INSERT INTO material_sessions (material_id, started_at, duration_min, source, block_id) VALUES (?,?,?,?,?)',
    s.material_id, s.started_at || new Date().toISOString(), s.duration_min, s.source || 'manual',
    s.block_id ?? null).lastInsertRowid;

// ---------- materials ----------
// Spine-numbered files first, in curriculum order; the rest alphabetically.
const MAT_SQL = `SELECT m.*,
  (SELECT COUNT(*) FROM reading_notes rn WHERE rn.material_id = m.id) AS note_count
  FROM materials m`;
const listMaterials = (moduleId) => moduleId
  ? all(MAT_SQL + ' WHERE m.module_id=? ORDER BY (m.seq IS NULL), m.seq, m.title', moduleId)
  : all(MAT_SQL + ' ORDER BY m.module_id, (m.seq IS NULL), m.seq, m.title');
const createMaterial = (m) =>
  run('INSERT INTO materials (module_id, topic_id, path, type, title, due_at) VALUES (?,?,?,?,?,?)',
    m.module_id, m.topic_id || null, m.path || '', m.type || 'lecture', m.title, m.due_at || null).lastInsertRowid;
const updateMaterial = (m) =>
  run('UPDATE materials SET topic_id=?, path=?, type=?, title=?, due_at=? WHERE id=?',
    m.topic_id || null, m.path || '', m.type, m.title, m.due_at || null, m.id);
const deleteMaterial = (id) => run('DELETE FROM materials WHERE id=?', id);
const getMaterial = (id) => get('SELECT * FROM materials WHERE id=?', id);

// Fixed-size access loop (LRU): only this many materials keep last_opened_at set.
const MAX_RECENT_ACCESS = 12;

function pruneRecentAccess(keep = MAX_RECENT_ACCESS) {
  // id DESC tie-break: same-millisecond opens (bulk touch) must prune oldest-first
  const keepers = all(
    'SELECT id FROM materials WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC, id DESC LIMIT ?',
    keep
  ).map(r => r.id);
  if (!keepers.length) {
    run('UPDATE materials SET last_opened_at=NULL WHERE last_opened_at IS NOT NULL');
    return;
  }
  const placeholders = keepers.map(() => '?').join(',');
  run(`UPDATE materials SET last_opened_at=NULL
       WHERE last_opened_at IS NOT NULL AND id NOT IN (${placeholders})`, ...keepers);
}

function touchMaterialOpened(id) {
  // Strictly increasing timestamps: ISO strings have millisecond resolution, so
  // rapid opens could tie and make the LRU order (and pruning) arbitrary.
  let ts = new Date().toISOString();
  const max = get('SELECT MAX(last_opened_at) AS m FROM materials')?.m;
  if (max && ts <= max) ts = new Date(new Date(max).getTime() + 1).toISOString();
  run('UPDATE materials SET last_opened_at=? WHERE id=?', ts, id);
  pruneRecentAccess(MAX_RECENT_ACCESS);
}

const saveMaterialProgress = (id, fields) => {
  const cur = getMaterial(id);
  if (!cur) return;
  const last_page = 'last_page' in fields ? fields.last_page : cur.last_page;
  const last_scroll = 'last_scroll' in fields ? fields.last_scroll : cur.last_scroll;
  run('UPDATE materials SET last_page=?, last_scroll=? WHERE id=?',
    last_page ?? null, last_scroll ?? null, id);
};

// Today's study log + resume list for the companion home screen.
const listStudyToday = (date) => {
  const sessions = all(`
    SELECT s.started_at, s.duration_min, s.source,
           m.id AS material_id, m.title AS material_title, m.path, m.type AS slot,
           t.name AS section_name, t.id AS topic_id,
           mo.id AS module_id, mo.code AS module_code, mo.color AS module_color,
           'session' AS kind
    FROM material_sessions s
    JOIN materials m ON m.id = s.material_id
    LEFT JOIN topics t ON t.id = m.topic_id
    JOIN modules mo ON mo.id = m.module_id
    WHERE date(s.started_at) = ?
    ORDER BY s.started_at DESC`, date);
  const blocks = all(`
    SELECT (b.date || 'T' || printf('%02d:%02d:00', b.start_min / 60, b.start_min % 60)) AS started_at,
           (b.end_min - b.start_min) AS duration_min, 'block' AS source,
           m.id AS material_id, m.title AS material_title, m.path, m.type AS slot,
           t.name AS section_name, t.id AS topic_id,
           mo.id AS module_id, mo.code AS module_code, mo.color AS module_color,
           'block' AS kind
    FROM study_blocks b
    LEFT JOIN materials m ON m.id = b.material_id
    LEFT JOIN topics t ON t.id = b.topic_id
    LEFT JOIN modules mo ON mo.id = t.module_id
    WHERE b.date = ? AND b.status = 'done'
    ORDER BY b.start_min DESC`, date);
  return [...sessions, ...blocks].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
};

const listResumeItems = (limit = 8) => all(`
  SELECT m.id, m.title, m.path, m.type AS slot, m.last_opened_at, m.last_page, m.last_scroll,
         t.id AS topic_id, t.name AS section_name, t.mastery,
         mo.id AS module_id, mo.code AS module_code, mo.color AS module_color,
         (SELECT COUNT(*) FROM problems p WHERE p.topic_id = t.id) AS problem_count,
         (SELECT COUNT(*) FROM problems p WHERE p.topic_id = t.id AND p.status IN ('solved','reviewed')) AS solved_count,
         (SELECT COALESCE(SUM(s.duration_min), 0) FROM material_sessions s WHERE s.material_id = m.id) AS total_min,
         (SELECT COUNT(*) FROM reading_notes rn WHERE rn.material_id = m.id) AS note_count
  FROM materials m
  JOIN modules mo ON mo.id = m.module_id
  LEFT JOIN topics t ON t.id = m.topic_id
  WHERE m.last_opened_at IS NOT NULL
  ORDER BY m.last_opened_at DESC, m.id DESC
  LIMIT ?`, limit);
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
         ma.title AS material_title, ma.path AS material_path
  FROM study_blocks b
  LEFT JOIN topics t ON t.id = b.topic_id
  LEFT JOIN modules mo ON mo.id = t.module_id
  LEFT JOIN materials ma ON ma.id = b.material_id
  WHERE b.date = ? ORDER BY (b.sort_order IS NULL), b.sort_order, b.start_min`, date);
const clearPlannedBlocks = (date) =>
  run("DELETE FROM study_blocks WHERE date=? AND status='planned'", date);
const createBlock = (b) => {
  const maxSort = get('SELECT COALESCE(MAX(sort_order), -1) AS m FROM study_blocks WHERE date=?',
    b.date)?.m ?? -1;
  return run(
    'INSERT INTO study_blocks (date, start_min, end_min, topic_id, material_id, reason, sort_order) VALUES (?,?,?,?,?,?,?)',
    b.date, b.start_min, b.end_min, b.topic_id, b.material_id || null, b.reason || '', maxSort + 1
  ).lastInsertRowid;
};
const getBlock = (id) => get('SELECT * FROM study_blocks WHERE id=?', id);
// Edit time/topic/material/note in place; status changes stay with setBlockStatus
// so the session-logging rules there can't be bypassed.
const updateBlock = (b) =>
  run('UPDATE study_blocks SET start_min=?, end_min=?, topic_id=?, material_id=?, reason=? WHERE id=?',
    b.start_min, b.end_min, b.topic_id, b.material_id || null, b.reason || '', b.id);
const duplicateBlock = (id) => {
  const b = getBlock(id);
  if (!b) return null;
  return createBlock({
    date: b.date,
    start_min: b.start_min,
    end_min: b.end_min,
    topic_id: b.topic_id,
    material_id: b.material_id,
    reason: b.reason,
  });
};

function clearBlockSessions(blockId) {
  run('DELETE FROM study_sessions WHERE block_id=?', blockId);
  run('DELETE FROM material_sessions WHERE block_id=?', blockId);
}

const deleteBlock = (id) => {
  clearBlockSessions(id);
  run('DELETE FROM study_blocks WHERE id=?', id);
};

// Marking a block done logs TIME (a fact), never a mastery bump (an opinion) —
// mastery only moves when problems get solved or exposure accumulates.
function setBlockStatus(id, status) {
  const b = getBlock(id);
  if (!b || b.status === status) return;
  const prev = b.status;
  run('UPDATE study_blocks SET status=? WHERE id=?', status, id);

  if (status === 'planned' && (prev === 'done' || prev === 'skipped')) {
    clearBlockSessions(id);
    return;
  }
  if (status === 'done' && prev === 'planned') {
    if (b.topic_id) {
      run('INSERT INTO study_sessions (topic_id, date, duration_min, outcome, block_id) VALUES (?,?,?,?,?)',
        b.topic_id, b.date, b.end_min - b.start_min, 'done', id);
    }
    if (b.material_id) {
      createMaterialSession({
        material_id: b.material_id,
        duration_min: b.end_min - b.start_min,
        source: 'block',
        block_id: id,
      });
    }
    return;
  }
  if (status === 'skipped' && prev === 'planned' && b.topic_id) {
    run('INSERT INTO study_sessions (topic_id, date, duration_min, outcome, block_id) VALUES (?,?,?,?,?)',
      b.topic_id, b.date, 0, 'skipped', id);
  }
}

function reorderBlocks({ date, status, orderedIds }) {
  const tx = db.transaction(() => {
    orderedIds.forEach((id, i) => {
      run('UPDATE study_blocks SET sort_order=?, status=? WHERE id=? AND date=?',
        i, status, id, date);
    });
  });
  tx();
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
        // UK convention: 1 credit ≈ 10 hours total effort. Only fill when unset
        // so a hand-tuned budget survives re-ingest.
        if (sec.credits != null && get('SELECT target_hours FROM modules WHERE id=?', mod.id).target_hours == null) {
          run('UPDATE modules SET target_hours=? WHERE id=?', sec.credits * 10, mod.id);
        }
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

// ---------- reading notes (concept nodes while studying a material) ----------
const listReadingNotes = (materialId) =>
  all('SELECT * FROM reading_notes WHERE material_id=? ORDER BY created_at, id', materialId);
const listReadingNoteLinks = (materialId) => all(`
  SELECT l.* FROM reading_note_links l
  JOIN reading_notes a ON a.id = l.from_note
  WHERE a.material_id = ?`, materialId);
const createReadingNote = (n) =>
  run('INSERT INTO reading_notes (material_id, label, body, page, created_at) VALUES (?,?,?,?,?)',
    n.material_id, n.label.trim(), n.body || '', n.page ?? null, new Date().toISOString()).lastInsertRowid;
const updateReadingNote = (n) =>
  run('UPDATE reading_notes SET label=?, body=?, page=? WHERE id=?',
    n.label.trim(), n.body || '', n.page ?? null, n.id);
const deleteReadingNote = (id) => run('DELETE FROM reading_notes WHERE id=?', id);
const linkReadingNotes = (fromId, toId, kind = 'related') => {
  if (!fromId || !toId || fromId === toId) return null;
  const a = Math.min(fromId, toId);
  const b = Math.max(fromId, toId);
  return run('INSERT OR IGNORE INTO reading_note_links (from_note, to_note, kind) VALUES (?,?,?)',
    a, b, kind || 'related').lastInsertRowid;
};
const unlinkReadingNotes = (id) => run('DELETE FROM reading_note_links WHERE id=?', id);
const getReadingNoteGraph = (materialId) => ({
  notes: listReadingNotes(materialId),
  links: listReadingNoteLinks(materialId),
});

// ---------- AI feedback log ----------
// Every accepted/rejected AI suggestion is recorded. Recent entries go back
// into future prompts as few-shot examples, and the log doubles as a training
// dataset if the model is ever fine-tuned on this user's decisions.
const logAiFeedback = (f) =>
  run('INSERT INTO ai_feedback (kind, payload, accepted, created_at) VALUES (?,?,?,?)',
    f.kind, JSON.stringify(f.payload ?? {}), f.accepted ? 1 : 0, new Date().toISOString()).lastInsertRowid;
const listAiFeedback = (kind, limit = 12) =>
  all('SELECT * FROM ai_feedback WHERE kind=? ORDER BY id DESC LIMIT ?', kind, limit)
    .map(r => ({ ...r, accepted: !!r.accepted, payload: JSON.parse(r.payload) }));

// ---------- flashcards (SM-2 spaced repetition) ----------
const srs = require('../shared/srs');

const CARD_SQL = `
  SELECT c.*, t.name AS topic_name, t.module_id,
         m.code AS module_code, m.color AS module_color
  FROM cards c
  JOIN topics t ON t.id = c.topic_id
  JOIN modules m ON m.id = t.module_id`;
const listCards = (topicId) => topicId
  ? all(CARD_SQL + ' WHERE c.topic_id=? ORDER BY c.due_at', topicId)
  : all(CARD_SQL + ' ORDER BY c.due_at');
const listDueCards = (nowIso, limit = 50) =>
  all(CARD_SQL + ' WHERE c.suspended=0 AND c.due_at <= ? ORDER BY c.due_at LIMIT ?',
    nowIso || new Date().toISOString(), limit);
const createCard = (c) => {
  const fresh = srs.newCardState();
  return run(
    'INSERT INTO cards (topic_id, front, back, ease, interval_days, reps, lapses, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    c.topic_id, c.front.trim(), c.back || '', fresh.ease, fresh.interval_days,
    fresh.reps, fresh.lapses, fresh.due_at, new Date().toISOString()).lastInsertRowid;
};
const updateCard = (c) =>
  run('UPDATE cards SET front=?, back=?, topic_id=?, suspended=? WHERE id=?',
    c.front.trim(), c.back || '', c.topic_id, c.suspended ? 1 : 0, c.id);
const deleteCard = (id) => run('DELETE FROM cards WHERE id=?', id);

// Rate a due card: SM-2 computes the next state, the review is logged.
function reviewCard(id, rating, now = Date.now()) {
  const card = get('SELECT * FROM cards WHERE id=?', id);
  if (!card) throw new Error('Card not found');
  const next = srs.review(card, rating, now);
  const tx = db.transaction(() => {
    run('UPDATE cards SET ease=?, interval_days=?, reps=?, lapses=?, due_at=? WHERE id=?',
      next.ease, next.interval_days, next.reps, next.lapses, next.due_at, id);
    run('INSERT INTO card_reviews (card_id, reviewed_at, rating, interval_days) VALUES (?,?,?,?)',
      id, new Date(now).toISOString(), rating, next.interval_days);
  });
  tx();
  return get(CARD_SQL + ' WHERE c.id=?', id);
}

// Due/total per topic — badges for module pages and the Today view.
const cardCounts = (nowIso) => all(`
  SELECT t.id AS topic_id, t.module_id, COUNT(*) AS total,
         SUM(CASE WHEN c.suspended=0 AND c.due_at <= ? THEN 1 ELSE 0 END) AS due
  FROM cards c JOIN topics t ON t.id = c.topic_id
  GROUP BY t.id`, nowIso || new Date().toISOString());

// ---------- pomodoro log ----------
const logPomodoro = (p) =>
  run('INSERT INTO pomodoro_log (date, completed_at, material_id, work_min) VALUES (?,?,?,?)',
    p.date || new Date().toISOString().slice(0, 10), new Date().toISOString(),
    p.material_id || null, p.work_min).lastInsertRowid;

// Today's count + streak of consecutive days (ending today or yesterday) with ≥1 pomodoro.
function pomodoroStats(today) {
  const date = today || new Date().toISOString().slice(0, 10);
  const count = get('SELECT COUNT(*) AS n FROM pomodoro_log WHERE date=?', date)?.n ?? 0;
  const days = all('SELECT DISTINCT date FROM pomodoro_log ORDER BY date DESC').map(r => r.date);
  let streak = 0;
  let cursor = new Date(date + 'T00:00:00Z');
  if (!days.includes(date)) cursor.setUTCDate(cursor.getUTCDate() - 1); // today not broken yet
  for (const d of days.filter(d => d <= cursor.toISOString().slice(0, 10))) {
    if (d !== cursor.toISOString().slice(0, 10)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { date, count, streak };
}

// ---------- settings ----------
const getSetting = (key) => get('SELECT value FROM settings WHERE key=?', key)?.value ?? null;
const setSetting = (key, value) =>
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);

module.exports = {
  open,
  listModules, createModule, updateModule, deleteModule,
  listTopics, createTopic, updateTopic, deleteTopic, mergeTopics,
  listProblemQueue,
  listMaterials, getMaterial, touchMaterialOpened, pruneRecentAccess, MAX_RECENT_ACCESS,
  saveMaterialProgress, createMaterial, updateMaterial, deleteMaterial, searchMaterials,
  listStudyToday, listResumeItems,
  listEdges, createEdge, deleteEdge,
  listDeadlines, createDeadline, updateDeadline, deleteDeadline,
  listBlocks, clearPlannedBlocks, createBlock, getBlock, updateBlock, duplicateBlock, deleteBlock, setBlockStatus, reorderBlocks,
  listProblems, createProblem, updateProblem, deleteProblem, createMaterialSession,
  applyIngest, listModuleNotes,
  listReadingNotes, listReadingNoteLinks, createReadingNote, updateReadingNote, deleteReadingNote,
  linkReadingNotes, unlinkReadingNotes, getReadingNoteGraph,
  listCards, listDueCards, createCard, updateCard, deleteCard, reviewCard, cardCounts,
  logPomodoro, pomodoroStats,
  logAiFeedback, listAiFeedback,
  getSetting, setSetting,
};
