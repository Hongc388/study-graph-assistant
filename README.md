# Study Graph Assistant

Local-first study assistant for CS/AI students. Organizes course materials by
**module**, links topics into a **knowledge graph** (within and across courses),
and generates an **explainable daily study plan** from your available time,
deadlines, mastery, and prerequisite order.

Everything stays on disk. AI features are optional and use a **local Ollama
server only** — no cloud calls anywhere.

## Run

```sh
npm install   # downloads Electron (~100 MB) and compiles better-sqlite3 — slow the first time
npm start
```

If `better-sqlite3` complains about a Node ABI mismatch (`NODE_MODULE_VERSION`),
run `npm run rebuild`.

### Electron binary missing or download too slow

The `electron` npm package is a stub that downloads a ~100 MB zip from GitHub
releases in its install step. If that download fails or crawls (`Electron failed
to install correctly` at start), the fastest fixes:

```sh
# 1. Retry just the download through a fast mirror (no full npm install needed):
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js

# 2. Or make the mirror permanent for all projects — add to ~/.npmrc:
#    electron_mirror=https://npmmirror.com/mirrors/electron/

# 3. Or fully manual: download electron-v<version>-darwin-arm64.zip yourself,
#    drop it into ~/Library/Caches/electron/, then re-run install.js as above.
```

Check the exact version needed with
`node -p "require('./node_modules/electron/package.json').version"`.

## Optional AI

Install [Ollama](https://ollama.com), then:

```sh
ollama pull llama3.2
```

The sidebar badge shows "AI: local model ready" when connected. AI can suggest
topics for a module (from material titles) and links between topics; you
accept/reject each one. Without Ollama everything else works normally.

## How the day planner decides

For each topic it computes `need × (1 + 3 × urgency)` where `need = 1 − mastery`
and `urgency = deadline_weight / days_left`. Then:

1. **Prerequisites first** — a topic whose prereq parent is below 50% mastery is
   not schedulable; instead its parent inherits its urgency ("do X before Y").
2. **Deadline-urgent weak topics** float to the top.
3. After each ≥90-minute focus block, one **25-minute cross-module review** of a
   linked topic is interleaved (spaced repetition).
4. Blocks are never shorter than 25 minutes (deep work protection).
5. Assignments with a due date get full focus-length blocks.

Marking a block **Done** logs a study session and bumps that topic's mastery
(capped, diminishing), so tomorrow's plan adapts. **Skip** logs the miss.

## CI/CD

GitHub Actions workflow: `.github/workflows/ci.yml`, runs on every push to
`main` / `feature/**` / `bugfix/**` / `hotfix/**` / `release/**` and on PRs.
Each job exists because of a specific failure mode this project has hit:

| Job | Issue it catches | Details |
|---|---|---|
| `commit-lint` | Commit messages drifting from the repo convention | Validates every commit on the branch against `type: description` / `JIRA-1234 type: description` (types: chore, ci, docs, feat, fix, perf, refactor, revert, style, test; Merge/Revert exempt) |
| `unit-tests` | Logic regressions in the scheduler and ingest | `npm test` on a 4-way matrix (Node 20/22 × Ubuntu/macOS). Installs with `--ignore-scripts` + `ELECTRON_SKIP_BINARY_DOWNLOAD=1` so it never pays the ~100 MB Electron download — the code under test is pure Node |
| `native-build` | `NODE_MODULE_VERSION` ABI mismatch between better-sqlite3 and Electron (the exact crash from first install) | Full `npm ci` on macOS (downloads Electron, compiles the native module, runs electron-rebuild), then loads better-sqlite3 *inside Electron's Node* (`ELECTRON_RUN_AS_NODE`) and executes a real SQL statement |
| `smoke` | Main-process crashes at boot: broken DB migrations, bad IPC channel wiring, preload errors | Boots the actual app under `xvfb` with `--smoke`, which exits 0 after DB open + migrations + window load, printing `SMOKE_OK`; any main-process throw fails the job |

### Unit test details (`npm test`)

**`test/scheduler.test.js`** — the day-plan optimizer:
- prereq-blocked topic is never scheduled; its blocking parent is scheduled first with an "unblocks X" rationale
- once the prereq is mastered, the deadline-urgent weak topic tops the plan with the deadline named in its reason
- a short cross-module review is interleaved after a long focus block
- no block is shorter than 25 minutes; all blocks fit inside the availability window
- deadlines marked done stop influencing the plan

**`test/ingest.test.js`** — the year_three indexer (runs against a throwaway temp folder):
- known folders map to the right module codes (`computer vision` → COMP3007)
- junk directories (`node_modules/`, `Untitled/`, …) are never indexed
- filenames become clean topic names (`08-monocular_depth_estimation.pdf` → *Monocular Depth Estimation*); dated exam papers do not become topics
- material classification: dated exam PDFs → `exam-prep`, problem sets → `assignment`, numbered lectures → `lecture`
- strategy.md parsing extracts the module code, exam percentage (e.g. 80%), and per-step tips

To reproduce CI locally: `npm test` (unit), `npm start` (smoke, visible window),
`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('better-sqlite3')"` (ABI).

## Layout

```
src/main/       Electron main process
  main.js         window + IPC wiring
  db.js           SQLite schema + queries (better-sqlite3)
  scheduler.js    day-plan optimizer (pure JS, unit-testable with plain node)
  ai.js           optional Ollama client (localhost only)
  preload.js      contextBridge → window.api
src/renderer/   UI (vanilla JS, no framework)
  app.js          hash-routed views: Modules / Graph / Today / Deadlines / Settings
  graphview.js    dependency-free force-directed SVG graph
```

Database file: Electron user-data dir (`~/Library/Application Support/study-graph-assistant/study-graph.db` on macOS).
