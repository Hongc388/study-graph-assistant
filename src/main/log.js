// Tiny local file logger — the app's flight recorder. When the app dies on a
// user's machine there is no terminal to read, so main-process crashes,
// renderer exceptions and notable events all land in a log file under the
// Electron user-data dir (Settings can reveal it). No cloud reporting, ever.
//
// Kept Electron-free so plain `node --test` can exercise it: the caller
// injects the directory via init().
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024; // rotate at 1 MB, keep exactly one old file
const FILE = 'main.log';

let logPath = null;

function formatLine(level, scope, msg) {
  const text = msg instanceof Error ? (msg.stack || msg.message)
    : typeof msg === 'string' ? msg
    : JSON.stringify(msg);
  return `${new Date().toISOString()} [${level}] ${scope}: ${text}\n`;
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(logPath);
    if (st.size < MAX_BYTES) return;
    fs.renameSync(logPath, logPath + '.1'); // clobbers the previous .1
  } catch { /* no file yet, or fs hiccup — logging must never throw */ }
}

/** Point the logger at a directory (created if missing). Returns the log path. */
function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logPath = path.join(dir, FILE);
  rotateIfNeeded();
  return logPath;
}

function write(level, scope, msg) {
  if (!logPath) return; // not initialized (tests of other modules) — drop silently
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath, formatLine(level, scope, msg));
  } catch { /* a broken disk must not take the app down */ }
}

const info = (scope, msg) => write('info', scope, msg);
const warn = (scope, msg) => write('warn', scope, msg);
const error = (scope, msg) => write('error', scope, msg);

/** Wire process-wide crash capture for the main process. `onFatal` lets the
 *  caller show a dialog; the log entry is already written when it runs. */
function captureProcessErrors(onFatal) {
  process.on('uncaughtException', (err) => {
    error('main.uncaught', err);
    if (onFatal) onFatal(err);
  });
  process.on('unhandledRejection', (reason) => {
    error('main.unhandledRejection', reason instanceof Error ? reason : String(reason));
  });
}

module.exports = { init, info, warn, error, captureProcessErrors,
  formatLine, MAX_BYTES, get path() { return logPath; } };
