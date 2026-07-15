// Backup / restore safety net around the SQLite file. Self-skips when the
// native module isn't built for this Node ABI (CI unit-tests job); the
// Electron-run DB test step executes it for real.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpDir;
let skipDb = false;
let db;
let Database;

before(() => {
  try {
    db = require('../src/main/db');
    Database = require('better-sqlite3');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-backup-'));
    // requiring better-sqlite3 works even on an ABI mismatch — the native
    // module only fails on first use, so probe with a real construction
    new Database(path.join(tmpDir, 'probe.db')).close();
  } catch {
    skipDb = true;
  }
});

after(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const dirA = () => path.join(tmpDir, 'a');
const backupsDir = () => path.join(dirA(), 'backups');

test('fresh database: no pre-migrate copy, no backup churn', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI (OK under Electron rebuild)');
  fs.mkdirSync(dirA(), { recursive: true });
  db.open(dirA());
  db.createModule({ code: 'COMP3009', name: 'ML', color: '#4f6df5' });
  assert.ok(!fs.readdirSync(dirA()).some(f => f.includes('pre-migrate')),
    'a brand-new file has nothing worth backing up');
  assert.ok(!fs.existsSync(backupsDir()));
});

test('reopening an existing database writes one rotating daily backup', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  db.close();
  db.open(dirA());
  const today = new Date().toISOString().slice(0, 10);
  const dated = fs.readdirSync(backupsDir());
  assert.deepStrictEqual(dated, [`study-graph-${today}.db`]);
  db.close();
  db.open(dirA()); // same day again — still exactly one backup
  assert.strictEqual(fs.readdirSync(backupsDir()).length, 1);
});

test('old daily backups are pruned beyond the keep limit', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  const today = new Date().toISOString().slice(0, 10);
  fs.rmSync(path.join(backupsDir(), `study-graph-${today}.db`));
  for (let i = 1; i <= 7; i++) {
    fs.writeFileSync(path.join(backupsDir(), `study-graph-2026-06-0${i}.db`), 'old');
  }
  db.close();
  db.open(dirA()); // creates today's backup, then prunes
  const dated = fs.readdirSync(backupsDir()).sort();
  assert.strictEqual(dated.length, db.BACKUP_KEEP);
  assert.ok(dated.includes(`study-graph-${today}.db`));
  assert.ok(!dated.includes('study-graph-2026-06-01.db'), 'oldest pruned first');
});

test('a schema version bump copies the old file aside before migrating', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  db.close();
  const raw = new Database(path.join(dirA(), 'study-graph.db'));
  raw.pragma('user_version = 0'); // pretend the file predates versioning
  raw.close();
  db.open(dirA());
  assert.ok(fs.existsSync(path.join(dirA(), 'study-graph.pre-migrate-v0.db')),
    'pre-migration safety copy exists');
});

test('export produces a standalone database containing the data', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  const dest = path.join(tmpDir, 'exported.db');
  db.exportTo(dest);
  const probe = new Database(dest, { readonly: true });
  const mod = probe.prepare('SELECT code FROM modules').get();
  probe.close();
  assert.strictEqual(mod.code, 'COMP3009');
});

test('import replaces the data and keeps a .pre-import escape hatch', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  const dirB = path.join(tmpDir, 'b');
  fs.mkdirSync(dirB);
  db.close();
  db.open(dirB);
  db.createModule({ code: 'IMPORTED', name: 'From elsewhere', color: '#085041' });
  const shipped = path.join(tmpDir, 'shipped.db');
  db.exportTo(shipped);
  db.close();

  db.open(dirA());
  assert.strictEqual(db.listModules()[0].code, 'COMP3009');
  db.importFrom(shipped);
  assert.deepStrictEqual(db.listModules().map(m => m.code), ['IMPORTED']);
  assert.ok(fs.existsSync(path.join(dirA(), 'study-graph.db.pre-import')));
});

test('import refuses a file that is not a study-graph database', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  const junk = path.join(tmpDir, 'junk.db');
  fs.writeFileSync(junk, 'this is not sqlite');
  assert.throws(() => db.importFrom(junk));
  assert.strictEqual(db.listModules()[0].code, 'IMPORTED', 'live data untouched');
});

test('reopening remaps old-palette module colors to the lighter hexes', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  const dirC = path.join(tmpDir, 'c');
  fs.mkdirSync(dirC);
  db.close();
  db.open(dirC);
  const oldPalette = db.createModule({ code: 'OLD1', name: 'x', color: '#085041' });
  const custom = db.createModule({ code: 'CUST', name: 'y', color: '#123456' });
  db.close();
  db.open(dirC); // migrate() runs the remap
  const byId = Object.fromEntries(db.listModules().map(m => [m.id, m.color]));
  assert.strictEqual(byId[oldPalette], '#0E7A63'); // same hue, lighter
  assert.strictEqual(byId[custom], '#123456');     // user-picked colors untouched
});
