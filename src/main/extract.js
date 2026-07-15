// Extract a plain-text excerpt from a study file so the local AI can judge
// the document by its actual content, not its filename. PDF text comes from
// the bundled pdf.js text layer — scanned/image PDFs yield nothing, which is
// reported so callers can fall back to title-only judgment.
const fs = require('fs');
const path = require('path');

const MAX_CHARS = 3000;
const MAX_PDF_PAGES = 4;
const PLAIN_EXTS = new Set(['.md', '.txt', '.py', '.c', '.cpp', '.html']);

async function pdfText(filePath, maxChars) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let text = '';
  const pages = Math.min(MAX_PDF_PAGES, doc.numPages);
  for (let p = 1; p <= pages && text.length < maxChars; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    text += tc.items.map(i => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  await doc.destroy();
  return text;
}

function ipynbText(filePath) {
  const nb = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (nb.cells || [])
    .map(c => (Array.isArray(c.source) ? c.source.join('') : c.source || ''))
    .join('\n');
}

/** → { text } on success, { text: '', reason } when nothing usable came out. */
async function extractText(filePath, maxChars = MAX_CHARS) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  try {
    if (ext === '.pdf') text = await pdfText(filePath, maxChars);
    else if (ext === '.ipynb') text = ipynbText(filePath);
    else if (PLAIN_EXTS.has(ext)) {
      text = fs.readFileSync(filePath, 'utf8');
      if (ext === '.html') text = text.replace(/<[^>]+>/g, ' ');
    } else {
      return { text: '', reason: `no text extractor for ${ext || 'this file'}` };
    }
  } catch (e) {
    return { text: '', reason: e.message };
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  if (text.length < 80) return { text: '', reason: 'no text layer (scanned or image-only file)' };
  return { text };
}

module.exports = { extractText, MAX_CHARS };
