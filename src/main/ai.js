// Optional AI assist via a local Ollama server (http://localhost:11434).
// Everything degrades gracefully: if Ollama is unreachable the caller gets
// { ok: false, error } and the UI keeps working without AI.
// Privacy rule: no remote calls anywhere in this file — localhost only.

const OLLAMA_URL = 'http://127.0.0.1:11434';

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

module.exports = { status, suggestTopics, suggestEdges };
