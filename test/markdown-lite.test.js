const { test } = require('node:test');
const assert = require('node:assert');
const { renderMarkdown } = require('../src/shared/markdown-lite');

test('markdown-lite renders headings and emphasis', () => {
  const html = renderMarkdown('# Title\n\n**bold** and `code`');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

test('markdown-lite renders fenced code blocks', () => {
  const html = renderMarkdown('```\nconst x = 1;\n```');
  assert.match(html, /<pre class="md-code"><code>const x = 1;<\/code><\/pre>/);
});
