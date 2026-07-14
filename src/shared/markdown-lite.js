// Minimal markdown → HTML for in-app preview (no external deps).
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(s) {
  let out = escHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}

/** @param {string} src */
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let listType = null;

  const flushList = () => {
    if (listType === 'ul') out.push('</ul>');
    if (listType === 'ol') out.push('</ol>');
    listType = null;
  };
  const flushCode = () => {
    out.push(`<pre class="md-code"><code>${escHtml(codeBuf.join('\n'))}</code></pre>`);
    codeBuf = [];
    inCode = false;
  };

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith('```')) {
      if (inCode) flushCode();
      else { flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inlineMd(line.replace(/^#{1,6}\s+/, ''))}</h${level}>`);
      continue;
    }
    if (/^(-|\*)\s+/.test(line)) {
      if (listType !== 'ul') { flushList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inlineMd(line.replace(/^(-|\*)\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { flushList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (line.trim() === '') {
      flushList();
      continue;
    }
    flushList();
    out.push(`<p>${inlineMd(line)}</p>`);
  }
  if (inCode) flushCode();
  flushList();
  return out.join('\n');
}

module.exports = { renderMarkdown, escHtml, inlineMd };
