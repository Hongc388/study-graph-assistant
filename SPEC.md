# Study Graph — Product Spec (source of truth)

Cursor-style desktop study assistant that indexes `~/Desktop/year_three`,
organizes materials by module, links topics within/across modules, and builds
explainable daily schedules optimized for first-class outcomes.

## Library root

Default: `/Users/hongchengli/Desktop/year_three` (other roots selectable later).

Known folder → module mapping:

| Folder | Module |
|---|---|
| `computibility` | COMP3001 Computability & Complexity |
| `machine_learning` | COMP3009 Machine Learning |
| `computer vision` | COMP3007 Computer Vision |
| `cryptography` | COMP3077 Cryptography |
| `agent` | COMP3004 Agents |
| `computer security` | COMP3006 Computer Security |
| `ethics` | COMP3020 Ethics |
| `dessertation` | COMP3003 Dissertation |
| `referenceBook` | Shared reference library (cross-module) |
| `Year3_Study_Strategy.md` | Strategy source — deadlines, exam weights, tactics |

## Visual language (Cursor-like)

- Dark by default: near-black surfaces (`#0e0e10` / `#1a1a1e`), subtle borders,
  muted sidebar, bright blue/violet accent for focus only.
- Layout: activity bar + sidebar | main workspace | optional right AI pane.
- Typography: system sans for chrome, JetBrains Mono-style for code/data.
- Dense, information-rich; no decorative cards.
- Command palette (Cmd+K / Cmd+P), quick-open materials, minimal chrome.
- Status bar: selected module, today's next block, AI status (local/offline).

## Core intelligence

1. **Smart ingest** — scan root → modules from subfolders; index PDFs/MD/notebooks/docs
   (title, path, mtime, size, module); suggest topics from filenames
   (`08-monocular_depth_estimation.pdf` → *Monocular Depth Estimation*); parse
   strategy.md into per-module tips + exam %.
2. **Topic graph** — edges: `prereq`, `related`, `cross_module`, `exam_cluster`
   (+ `analogy`); smart suggestions with a short "why"; user accepts/rejects.
3. **Daily schedule** — inputs: available time, deadlines/exams, mastery, graph
   prerequisites, strategy priorities. Output: ordered blocks with visible
   rationale. Rules: respect prereqs; prioritize weak × high-weight × near-deadline;
   separate proof practice (COMP3001) vs coding/lab (ML/Crypto) vs writing
   (Ethics/Dissertation/Agents); short spaced cross-module reviews.
4. **Study AI pane** — grounded Q&A about selected material/topic (cite file names);
   "what should I study next"; edge suggestions; proof drills / flash prompts.
   Local Ollama preferred; degrade gracefully offline.
5. **Command palette actions** — Index year_three, Open COMP3009, Plan today,
   Link selected topic, Search across Year 3, Show weak topics.

## Non-goals (v1)

Cloud sync by default, social features, replacing Moodle, perfect PDF OCR.

## Tech constraints

Electron + local SQLite (better-sqlite3). Files stay on disk; DB stores metadata,
graph, schedule. Privacy-first: no upload unless remote AI explicitly enabled.

## Acceptance criteria

- [x] First launch connects to `~/Desktop/year_three` and populates modules from folders
- [x] Browse/search materials per module (sidebar file tree)
- [x] Build/edit topic graph with cross-module links
- [x] Generate a today plan with explainable ordering
- [x] Cursor-inspired dark IDE look
- [x] Works offline for non-AI features
- [ ] Right-hand Study AI pane (grounded Q&A, flash prompts)
- [ ] Scheduler uses exam % and work-type (proof/coding/writing) separation
- [ ] Exam-date deadlines auto-created from dated exam files
