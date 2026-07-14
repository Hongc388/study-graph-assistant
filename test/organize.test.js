const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, plannedBasename, normalizeSlot, slotFromLegacy } = require('../src/main/organize');

test('slugify produces filesystem-safe section slugs', () => {
  assert.strictEqual(slugify('Support Vector Machine'), 'support-vector-machine');
  assert.strictEqual(slugify('PCA / SVD'), 'pca-svd');
});

test('plannedBasename follows section-slot pattern', () => {
  const taken = new Set(['support-vector-machine-lecture.pdf']);
  assert.strictEqual(
    plannedBasename('Support Vector Machine', 'lecture', '.pdf', taken),
    'support-vector-machine-lecture-02.pdf',
  );
  assert.strictEqual(
    plannedBasename('PCA', 'lab', '.ipynb', new Set()),
    'pca-lab.ipynb',
  );
});

test('normalizeSlot and legacy type mapping', () => {
  assert.strictEqual(normalizeSlot('problemset'), 'problemset');
  assert.strictEqual(slotFromLegacy('assignment'), 'problemset');
  assert.strictEqual(slotFromLegacy('lab'), 'lab');
});
