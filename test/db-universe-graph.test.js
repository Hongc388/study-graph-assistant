const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let skipDb = false;
let db;
try {
  db = require('../src/main/db');
} catch {
  skipDb = true;
}

const tmpDirs = [];

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    try { db?.close?.(); } catch { /* ok */ }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function openFreshDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-universe-'));
  tmpDirs.push(tmpDir);
  db.open(tmpDir);
  return tmpDir;
}

function seedLibrary({ modules = 3, topicsPerMod = 20, matsPerTopic = 8 } = {}) {
  for (let m = 0; m < modules; m++) {
    const modId = db.createModule({
      code: `MOD${1000 + m}`,
      name: `Module ${m}`,
      color: '#0E7A63',
    });
    for (let t = 0; t < topicsPerMod; t++) {
      const topicId = db.createTopic({ module_id: modId, name: `Topic ${m}-${t}` });
      for (let f = 0; f < matsPerTopic; f++) {
        db.createMaterial({
          module_id: modId,
          topic_id: topicId,
          title: `Lecture ${m}-${t}-${f}.pdf`,
          path: `/tmp/seed/m${m}/t${t}/f${f}.pdf`,
          type: 'lecture',
        });
      }
      db.createMaterial({
        module_id: modId,
        topic_id: topicId,
        title: `Handbook ${m}-${t}.pdf`,
        path: `/tmp/seed/m${m}/handbook-${t}.pdf`,
        type: 'overview',
      });
    }
  }
}

test('getUniverseGraph excludes overview materials and includes mastery on topics', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  openFreshDb();
  seedLibrary({ modules: 2, topicsPerMod: 2, matsPerTopic: 2 });
  const g = db.getUniverseGraph();
  assert.strictEqual(g.modules.length, 2);
  assert.strictEqual(g.topics.length, 4);
  assert.strictEqual(g.materials.length, 8, 'overview rows must not appear in universe data');
  assert.ok(g.topics.every(x => typeof x.mastery === 'number'));
  assert.ok(Array.isArray(g.edges));
});

test('getUniverseGraph meets stress-scale fetch budget', (t) => {
  if (skipDb) return t.skip('better-sqlite3 not built for this Node ABI');
  openFreshDb();
  seedLibrary({ modules: 5, topicsPerMod: 40, matsPerTopic: 10 });
  const t0 = performance.now();
  const g = db.getUniverseGraph();
  const ms = performance.now() - t0;
  assert.strictEqual(g.materials.length, 2000);
  assert.ok(ms < 800, `getUniverseGraph took ${ms.toFixed(1)}ms (budget 800ms)`);
});
