const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const log = require('../src/main/log');

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-log-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('writing before init is a silent no-op, never a throw', () => {
  assert.doesNotThrow(() => log.error('early', 'app not booted yet'));
});

test('init creates the directory and lines carry timestamp, level and scope', () => {
  const p = log.init(path.join(tmpDir, 'logs'));
  log.info('app', 'started v0.1.0');
  log.warn('renderer', 'window unresponsive');
  const text = fs.readFileSync(p, 'utf8');
  assert.match(text, /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z \[info\] app: started v0\.1\.0\n/m);
  assert.match(text, /\[warn\] renderer: window unresponsive/);
});

test('Error objects are logged with their stack trace', () => {
  const err = new Error('sqlite disk I/O error');
  log.error('main.uncaught', err);
  const text = fs.readFileSync(log.path, 'utf8');
  assert.ok(text.includes('sqlite disk I/O error'));
  assert.ok(text.includes('log.test.js'), 'stack frame recorded');
});

test('non-string payloads are JSON-serialized', () => {
  assert.match(log.formatLine('info', 's', { a: 1 }), /\{"a":1\}/);
});

test('the file rotates to .1 once it exceeds the size cap', () => {
  const p = log.init(path.join(tmpDir, 'rotate'));
  fs.writeFileSync(p, 'x'.repeat(log.MAX_BYTES + 1));
  log.info('app', 'first line after rotation');
  assert.ok(fs.existsSync(p + '.1'), 'old log kept as .1');
  const fresh = fs.readFileSync(p, 'utf8');
  assert.ok(fresh.includes('first line after rotation'));
  assert.ok(fresh.length < 1000, 'new file starts near-empty');
});

test('captureProcessErrors logs unhandled rejections', () => {
  const p = log.init(path.join(tmpDir, 'proc'));
  log.captureProcessErrors();
  // A real dangling Promise.reject (or emitting the process event) trips the
  // test runner's own listener, so call just the handler we registered.
  const handler = process.listeners('unhandledRejection').at(-1);
  handler(new Error('lost promise'), Promise.resolve());
  process.removeListener('unhandledRejection', handler);
  process.removeListener('uncaughtException', process.listeners('uncaughtException').at(-1));
  assert.ok(fs.readFileSync(p, 'utf8').includes('lost promise'));
});
