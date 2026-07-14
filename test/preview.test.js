const { test } = require('node:test');
const assert = require('node:assert');
const { isPreviewable, resolveOpenMode, PREVIEW_EXTS } = require('../src/main/preview');

test('previewable extensions include common study file types', () => {
  for (const ext of ['.pdf', '.md', '.txt', '.ipynb', '.py', '.html']) {
    assert.ok(PREVIEW_EXTS.has(ext), ext);
  }
});

test('isPreviewable accepts local study paths and rejects URLs', () => {
  assert.ok(isPreviewable('/library/COMP3009/lecture01.pdf'));
  assert.ok(isPreviewable('/library/notes/readme.MD'));
  assert.ok(!isPreviewable('https://example.com/slides.pdf'));
  assert.ok(!isPreviewable(''));
});

test('resolveOpenMode routes to preview, external, or none', () => {
  assert.strictEqual(resolveOpenMode('/a/b.pdf'), 'preview');
  assert.strictEqual(resolveOpenMode('/a/b.docx'), 'external');
  assert.strictEqual(resolveOpenMode('https://x/y.pdf'), 'none');
  assert.strictEqual(resolveOpenMode('/missing.pdf', { exists: false }), 'none');
});
