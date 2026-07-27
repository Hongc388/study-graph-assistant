// Native better-sqlite3 is compiled for Electron in postinstall, not system Node.
// Probe before db.open() so tests skip instead of failing with ERR_DLOPEN_FAILED.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKIP_HINT =
  'better-sqlite3 ABI mismatch — run: npm run test:db (uses Electron\'s Node)';

function sqliteAvailable() {
  try {
    const Database = require('better-sqlite3');
    const file = path.join(os.tmpdir(), `sg-sqlite-probe-${process.pid}.db`);
    const d = new Database(file);
    d.close();
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = { sqliteAvailable, SKIP_HINT };
