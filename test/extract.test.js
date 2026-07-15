const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { extractText } = require('../src/main/extract');

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-extract-'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

test('markdown and text files yield their content, whitespace-normalized', async () => {
  const body = '# Eigenvalues\n\nAn eigenvector   of A is a vector x with\nAx = λx for some scalar λ. '.repeat(3);
  const md = await extractText(write('notes.md', body));
  assert.ok(md.text.includes('An eigenvector of A is a vector x'));
  assert.ok(!md.text.includes('\n'), 'newlines collapsed');
  const txt = await extractText(write('notes.txt', body));
  assert.ok(txt.text.length > 80);
});

test('html files have tags stripped', async () => {
  const p = write('page.html', `<html><body><h1>Bayes rule</h1><p>${'Posterior is prior times likelihood over evidence. '.repeat(5)}</p></body></html>`);
  const { text } = await extractText(p);
  assert.ok(text.includes('Posterior is prior times likelihood'));
  assert.ok(!text.includes('<p>'));
});

test('notebook cells are concatenated', async () => {
  const nb = {
    cells: [
      { cell_type: 'markdown', source: ['## Gradient descent\n', 'We minimize the loss iteratively. '.repeat(4)] },
      { cell_type: 'code', source: 'w = w - lr * grad  # update step' },
    ],
  };
  const { text } = await extractText(write('lab.ipynb', JSON.stringify(nb)));
  assert.ok(text.includes('Gradient descent'));
  assert.ok(text.includes('w = w - lr * grad'));
});

test('long content is capped at maxChars', async () => {
  const p = write('big.txt', 'x'.repeat(50000));
  const { text } = await extractText(p, 3000);
  assert.strictEqual(text.length, 3000);
});

test('unsupported formats and unreadable files report a reason instead of throwing', async () => {
  const docx = await extractText(write('slides.docx', 'binary-ish'));
  assert.strictEqual(docx.text, '');
  assert.match(docx.reason, /no text extractor/);
  const missing = await extractText(path.join(tmpDir, 'gone.md'));
  assert.strictEqual(missing.text, '');
  assert.ok(missing.reason);
});

test('near-empty text (scanned file) is reported as having no text layer', async () => {
  const p = write('scan.txt', '  δ λ  ');
  const { text, reason } = await extractText(p);
  assert.strictEqual(text, '');
  assert.match(reason, /no text layer/);
});
