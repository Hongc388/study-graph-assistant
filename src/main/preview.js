// Which materials open in the in-app preview window (file-focus timer tracking).
const path = require('path');

const PREVIEW_EXTS = new Set([
  '.pdf', '.md', '.txt', '.html', '.htm', '.json', '.ipynb',
  '.py', '.c', '.cpp', '.h', '.hpp', '.java', '.js', '.ts', '.css', '.xml', '.csv', '.tex',
]);

function isPreviewable(filePath) {
  if (!filePath || filePath.startsWith('http')) return false;
  return PREVIEW_EXTS.has(path.extname(filePath).toLowerCase());
}

/** @returns {'preview'|'external'|'none'} */
function resolveOpenMode(filePath, { exists = true } = {}) {
  if (!filePath || filePath.startsWith('http')) return 'none';
  if (!exists) return 'none';
  return isPreviewable(filePath) ? 'preview' : 'external';
}

module.exports = { PREVIEW_EXTS, isPreviewable, resolveOpenMode };
