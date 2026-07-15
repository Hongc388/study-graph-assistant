// Optional AI assist via a local Ollama server (http://localhost:11434).
// Everything degrades gracefully: if Ollama is unreachable the caller gets
// { ok: false, error } and the UI keeps working without AI.
// Privacy rule: no remote calls anywhere in this file — localhost only.

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const OLLAMA_URL = 'http://127.0.0.1:11434';

// Where Homebrew / the installer put the binary. `which` is unreliable here
// because GUI apps on macOS don't inherit the shell PATH.
const OLLAMA_BINS = ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'];

let startAttempted = false;

/** If Ollama is installed but not running, start it (detached — it stays up
 *  after the app quits, like the Ollama menu-bar app would). One attempt per
 *  app run; returns the usual status() shape either way. */
async function ensureRunning() {
  let s = await status();
  if (s.ok || startAttempted) return s;
  startAttempted = true;
  const bin = OLLAMA_BINS.find(p => fs.existsSync(p));
  if (!bin) return { ok: false, error: 'Ollama is not installed — get it from ollama.com' };
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    return { ok: false, error: `Could not start Ollama: ${e.message}` };
  }
  // The server usually answers within a second or two.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    s = await status();
    if (s.ok) return s;
  }
  return { ok: false, error: 'Started Ollama but it did not come up on 127.0.0.1:11434' };
}

async function ollamaChat(model, prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2 } }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return data.response;
}

async function status() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return { ok: true, models: (data.models || []).map(m => m.name) };
  } catch (e) {
    return { ok: false, error: 'Ollama not reachable on 127.0.0.1:11434' };
  }
}

// Pull the first JSON array/object out of a model reply (models love prose).
function extractJson(text) {
  const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model reply');
  return JSON.parse(m[0]);
}

/** Suggest topics for a module from material titles. */
async function suggestTopics(model, moduleName, materialTitles) {
  const prompt = `You are helping a CS/AI student organize the course "${moduleName}".
Course materials:
${materialTitles.map(t => '- ' + t).join('\n')}

Suggest 5-12 concrete study topics (concepts, not chapter numbers) this course likely covers based ONLY on these titles.
Reply with a JSON array of objects: [{"name": "...", "summary": "one sentence"}]. JSON only.`;
  const out = await ollamaChat(model, prompt);
  return extractJson(out);
}

/** Suggest edges among existing topics (intra + cross module). */
async function suggestEdges(model, topics) {
  const list = topics.map(t => `${t.id}: ${t.name} [module ${t.module_id}]`).join('\n');
  const prompt = `Here are study topics from a CS/AI student's courses, as "id: name [module N]":
${list}

Suggest useful links between them. Kinds:
- "prereq": from must be learned before to
- "related": same module, conceptually adjacent
- "cross_module": different modules, one genuinely supports the other
- "analogy": different modules, similar structure only

Reply with a JSON array: [{"from": id, "to": id, "kind": "...", "note": "short justification"}].
Max 15 links, only high-confidence ones. JSON only.`;
  const out = await ollamaChat(model, prompt);
  return extractJson(out);
}

// Types the content classifier may return. "overview" is the important one:
// a file that describes the course (syllabus, welcome, module guide) is not
// study material and must not be filed as a lecture just because it exists.
const MATERIAL_TYPES = ['overview', 'lecture', 'assignment', 'exam-prep', 'lab', 'paper', 'cheatsheet', 'notes'];

/** Classify one document from its actual text. `examples` are past user
 *  corrections ({title, to}) so the model imitates this user's judgment. */
async function classifyMaterial(model, { title, moduleName, text }, examples = []) {
  const exampleBlock = examples.length
    ? `\nThis user filed similar documents like this before — imitate their judgment:\n${
      examples.map(e => `- "${e.title}" → ${e.to}`).join('\n')}\n`
    : '';
  const body = text
    ? `Document text (beginning):\n"""\n${text}\n"""`
    : 'No text could be extracted (scanned file) — judge from the filename only and lower your confidence.';
  const prompt = `You are filing study materials for the university course "${moduleName}".
Classify this document by WHAT IT IS, not by what it mentions. Exactly one type:
- overview: describes the course itself — syllabus, module guide, welcome/introduction to the module, assessment/admin info. NOT teaching content.
- lecture: teaches actual course concepts
- assignment: problem set / coursework / homework — questions the student must solve
- exam-prep: past exam paper or revision questions — contains actual numbered questions (often with marks); a document that merely describes the exam is overview
- lab: practical or lab instructions, code walkthrough
- paper: academic research paper
- cheatsheet: condensed summary or reference sheet
- notes: personal or informal study notes
${exampleBlock}
Filename: ${title}
${body}

Reply with JSON only: {"type": "...", "confidence": 0.0-1.0, "reason": "one short sentence citing evidence"}`;
  const out = await ollamaChat(model, prompt);
  const j = extractJson(out);
  if (!MATERIAL_TYPES.includes(j.type)) throw new Error(`Model returned unknown type "${j.type}"`);
  return j;
}

/** Suggest links between a material's concept notes. `examples` are past
 *  accept/reject decisions ({a, b, accepted}) for few-shot grounding. */
async function suggestNoteLinks(model, materialTitle, notes, examples = []) {
  const list = notes.map(n => `${n.id}: ${n.label}`).join('\n');
  const good = examples.filter(e => e.accepted).slice(0, 4);
  const bad = examples.filter(e => !e.accepted).slice(0, 4);
  const exampleBlock = (good.length || bad.length)
    ? `\nPast decisions by this user:\n${
      good.map(e => `- linked: "${e.a}" ↔ "${e.b}"`).join('\n')}${good.length && bad.length ? '\n' : ''}${
      bad.map(e => `- rejected: "${e.a}" ↔ "${e.b}"`).join('\n')}\n`
    : '';
  const prompt = `A student captured these concept notes while reading "${materialTitle}", as "id: concept":
${list}

Suggest which concepts are directly related and should be linked in their concept graph.
Only pairs with a real conceptual relationship (one defines/uses/contrasts the other).
${exampleBlock}
Reply with JSON only: [{"from": id, "to": id, "why": "short reason"}]. Max 8 links.`;
  const out = await ollamaChat(model, prompt);
  const arr = extractJson(out);
  if (!Array.isArray(arr)) throw new Error('Model did not return a list');
  return arr;
}

module.exports = { status, ensureRunning, suggestTopics, suggestEdges,
  classifyMaterial, suggestNoteLinks, MATERIAL_TYPES };
