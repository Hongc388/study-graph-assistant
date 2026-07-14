// Greedy day-plan optimizer.
//
// Principles (from the spec):
//   1. Respect prerequisites — a topic is not "ready" until its prereq parents
//      have mastery >= READY_THRESHOLD; ready parents are scheduled first.
//   2. Prefer deadline-urgent weak topics (urgency * (1 - mastery)).
//   3. Interleave short cross-module review after long focus blocks (spacing).
//   4. Protect deep work — blocks are >= MIN_BLOCK minutes, never confetti slots.
//   5. Assignments with a due material get coding/lab-sized blocks, not reading slots.

const READY_THRESHOLD = 0.5; // parent mastery needed before a child is schedulable
const MIN_BLOCK = 25;        // never schedule less than this (protect deep work)
const FOCUS_BLOCK = 90;      // preferred deep-work length
const REVIEW_BLOCK = 25;     // short spaced-review slot

const DAY_MS = 24 * 3600 * 1000;

/**
 * Build a plan for one day.
 * @param opts {
 *   date: 'YYYY-MM-DD',
 *   windows: [{start_min, end_min}],   // available time, minutes since midnight
 *   topics, edges, deadlines, materials, // straight from db (topic mastery is derived)
 *   modules?  // [{id, spent_min, target_hours}] for the hour-budget deficit term
 * }
 * @returns [{start_min, end_min, topic_id, material_id, reason}]
 */
function planDay(opts) {
  const { date, windows, topics, edges, deadlines, materials, modules = [] } = opts;
  const topicById = new Map(topics.map(t => [t.id, t]));

  // Module hour deficit: 0 (on/over budget) … 1 (untouched). Under-budget
  // modules get a boost so no course silently starves.
  const deficitByModule = new Map(modules.map(m => {
    if (!m.target_hours) return [m.id, { d: 0 }];
    const d = Math.max(0, 1 - (m.spent_min || 0) / (m.target_hours * 60));
    return [m.id, { d, label: `${((m.spent_min || 0) / 60).toFixed(0)}h/${m.target_hours}h logged` }];
  }));

  // --- prerequisite map: child -> [parents] ---
  const parents = new Map();
  for (const e of edges) {
    if (e.kind !== 'prereq') continue;
    // Convention: edge from_topic -> to_topic means "from is a prereq of to".
    if (!parents.has(e.to_topic)) parents.set(e.to_topic, []);
    parents.get(e.to_topic).push(e.from_topic);
  }
  const blockedBy = (t) =>
    (parents.get(t.id) || []).filter(pid => (topicById.get(pid)?.mastery ?? 1) < READY_THRESHOLD);

  // --- urgency per topic from open deadlines; exam mode = exam within 14 days ---
  const now = new Date(date + 'T00:00:00').getTime();
  const examModules = new Set();
  const urgency = new Map(); // topic_id -> {score, label}
  for (const d of deadlines) {
    if (d.done) continue;
    const daysLeft = Math.max(0.5, (new Date(d.due_at).getTime() - now) / DAY_MS);
    if (daysLeft <= 14) {
      if (d.topic_id) {
        const mid = topics.find(t => t.id === d.topic_id)?.module_id;
        if (mid) examModules.add(mid);
      } else if (d.module_id) examModules.add(d.module_id);
    }
    const score = (d.weight || 1) / daysLeft; // closer + heavier = hotter
    const apply = (tid) => {
      const cur = urgency.get(tid);
      if (!cur || score > cur.score) {
        urgency.set(tid, { score, label: `${d.title} due in ${Math.ceil(daysLeft)}d` });
      }
    };
    if (d.topic_id) apply(d.topic_id);
    else for (const t of topics) if (t.module_id === d.module_id) apply(t.id);
  }

  // --- score every topic ---
  // need = competence gap (derived mastery), scaled by deadline urgency,
  // plus the module's hour-budget deficit (spec: no course silently starves).
  const scored = topics.map(t => {
    const u = urgency.get(t.id);
    const blockers = blockedBy(t);
    const need = 1 - t.mastery;
    const def = deficitByModule.get(t.module_id) || { d: 0 };
    let score = need * (1 + 3 * (u?.score ?? 0)) + 0.5 * def.d;
    const examMode = examModules.has(t.module_id);
    if (examMode && t.problem_count > 0 && t.solved_count < t.problem_count) {
      score *= 1.35;
    }
    const why = [];
    if (u) why.push(u.label);
    if (examMode && t.problem_count > 0 && t.solved_count < t.problem_count) {
      why.push('exam mode: unsolved problems');
    }
    why.push(t.problem_count > 0
      ? `${t.solved_count}/${t.problem_count} problems solved`
      : `mastery ${(t.mastery * 100).toFixed(0)}% (time-based)`);
    if (def.d > 0.3 && def.label) why.push(`module under budget: ${def.label}`);
    if (blockers.length) {
      // Not ready: its blocking parents inherit its urgency instead.
      score = -1;
      why.push('blocked by prereq: ' + blockers.map(id => topicById.get(id)?.name).join(', '));
    }
    return { topic: t, score, blockers, why };
  });

  // Boost parents that block something urgent ("do X before Y").
  for (const s of scored) {
    if (s.blockers.length === 0) continue;
    const childUrg = urgency.get(s.topic.id)?.score ?? 0;
    for (const pid of s.blockers) {
      const p = scored.find(x => x.topic.id === pid);
      if (p && p.score >= 0) {
        p.score += (1 - p.topic.mastery) * (1 + 3 * childUrg) * 0.9;
        p.why.push(`unblocks "${s.topic.name}"`);
      }
    }
  }

  const ready = scored.filter(s => s.score >= 0).sort((a, b) => b.score - a.score);

  // --- material picker: due assignment first, else any material on the topic ---
  const matsByTopic = new Map();
  for (const m of materials) {
    if (!m.topic_id) continue;
    if (!matsByTopic.has(m.topic_id)) matsByTopic.set(m.topic_id, []);
    matsByTopic.get(m.topic_id).push(m);
  }
  const pickMaterial = (tid, examUrgent = false) => {
    const ms = matsByTopic.get(tid) || [];
    if (examUrgent) {
      return ms.find(m => m.type === 'exam-prep')
        || ms.find(m => m.type === 'assignment' && m.due_at)
        || ms[0] || null;
    }
    return ms.find(m => m.type === 'assignment' && m.due_at) || ms[0] || null;
  };

  // --- cross-module review candidates: topics linked to a scheduled topic
  //     from a *different* module (spec principle 3). Prereq-blocked topics
  //     are never valid review targets (principle 1). ---
  const blockedIds = new Set(scored.filter(s => s.blockers.length).map(s => s.topic.id));
  const crossLinked = (tid) => edges
    .filter(e => (e.from_topic === tid || e.to_topic === tid))
    .map(e => e.from_topic === tid ? e.to_topic : e.from_topic)
    .map(id => topicById.get(id))
    .filter(t => t && t.module_id !== topicById.get(tid)?.module_id && !blockedIds.has(t.id));

  // --- fill windows greedily ---
  const plan = [];
  const usedTopics = new Set();
  let queue = [...ready];

  for (const w of windows) {
    let cursor = w.start_min;
    while (w.end_min - cursor >= MIN_BLOCK && queue.length) {
      const s = queue.shift();
      if (usedTopics.has(s.topic.id)) continue;
      const remaining = w.end_min - cursor;
      const examUrgent = examModules.has(s.topic.module_id);
      const mat = pickMaterial(s.topic.id, examUrgent);
      const wantLong = mat?.type === 'assignment' || remaining >= FOCUS_BLOCK + REVIEW_BLOCK;
      const len = Math.min(remaining, wantLong ? FOCUS_BLOCK : Math.max(MIN_BLOCK, remaining));
      plan.push({
        start_min: cursor, end_min: cursor + len,
        topic_id: s.topic.id, material_id: mat?.id || null,
        reason: s.why.join(' · '),
      });
      usedTopics.add(s.topic.id);
      cursor += len;

      // Interleave one short cross-module review after a long focus block.
      if (len >= FOCUS_BLOCK && w.end_min - cursor >= REVIEW_BLOCK) {
        const rev = crossLinked(s.topic.id).find(t => !usedTopics.has(t.id));
        if (rev) {
          plan.push({
            start_min: cursor, end_min: cursor + REVIEW_BLOCK,
            topic_id: rev.id, material_id: pickMaterial(rev.id, examModules.has(rev.module_id))?.id || null,
            reason: `spaced cross-module review — linked to "${s.topic.name}"`,
          });
          usedTopics.add(rev.id);
          cursor += REVIEW_BLOCK;
        }
      }
    }
  }
  return plan;
}

module.exports = { planDay, READY_THRESHOLD };
