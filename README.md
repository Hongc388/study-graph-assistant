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

## Build a distributable app

```sh
npm run pack   # fast: unsigned .app in dist/mac-arm64 (good for local testing)
npm run dist   # full: .dmg + .zip in dist/
```

Builds are unsigned for now (`identity: null`), so on another Mac the first
launch needs right-click → Open. If the electron-builder downloads crawl, the
same mirror trick as above works:

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

CI's `package` job builds the .app on every push and boots it with `--smoke`,
so asar/path regressions (native modules, the pdf.js worker) are caught before
they reach a release.

## Optional AI

Install [Ollama](https://ollama.com), then:

```sh
ollama pull qwen2.5
```

If Ollama is installed but not running, the app starts it automatically on
launch. The sidebar badge shows "AI: local model ready" when connected.
Without Ollama everything else works normally. All AI output is
suggestion-only — you accept or reject each item, nothing is applied silently:

- **Suggest sections / links between topics** (from material titles).
- **Check file types** (module view) — reads each file's actual text (PDF text
  layer, markdown, notebooks) and re-classifies it by content, catching e.g. an
  "about this module" PDF filed as a lecture. Files without a text layer
  (scanned slides) are judged from the filename only and flagged as
  low-confidence. The new `overview` type marks course-description documents
  (syllabus, module guide) that are *not* study content.
- **Suggest note links** (notes dialog) — proposes edges between the concepts
  you captured while reading.

Every accept/reject decision is logged (`ai_feedback` table) and fed back into
future prompts as examples, so suggestions adapt to your judgment over time —
and the log doubles as a training dataset if the model is ever fine-tuned.

## Data safety

The database is one SQLite file under the Electron user-data dir. The app
protects it three ways: a rotating **daily backup** (last 5 kept in
`backups/`), an automatic **pre-migration copy** whenever a schema upgrade is
about to run (`PRAGMA user_version` tracks the schema), and manual
**Export / Restore** buttons in Settings. Restore keeps the replaced database
as `.pre-import` so it's reversible. Crashes are recorded to a local log file
(Settings → Open log file) — nothing is ever uploaded.

## Flashcards (spaced repetition)

The **▧ Flashcards** view reviews cards with the SM-2 algorithm: rate a card
Again / Hard / Good / Easy and it comes back in 10 minutes / ~1 day / 1→6→ease-multiplied
days accordingly (each button previews its interval). Cards belong to a topic;
pause (suspend) or delete them from the browser table. New cards are due
immediately.

## Pomodoro coach

Enable it in Settings. It rides on the material focus timer, so **only focused
study time counts** toward the work interval (default 25 min). Completed
pomodoros trigger a break reminder (5 min short, 15 min long every 4th), are
logged to the database, and the status bar shows the countdown, today's count
and your day streak.

## How readiness is computed

Readiness (the per-topic bar) is **derived, never typed in**, from two signals:

- **problems** — (solved + 0.3 × attempted) ÷ total, up to 100%. Proven competence.
- **study time** — logged minutes on the topic's materials, capped at 60%
  (5 hours reaches the cap). Reading alone never looks "mastered".

Readiness is the **higher** of the two, so tagging problems never erases
progress from study time, and solving problems counts even with no time logged.
Hover a topic's bar to see both components.

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
| `smoke` | Main-process crashes at boot: broken DB migrations, bad IPC channel wiring, preload errors — plus renderer exceptions | Boots the actual app under `xvfb` with `--smoke`, which walks every hash route (dashboard, graph, queue, cards, schedule, settings) watching the renderer console; any main-process throw or renderer console error fails the job, otherwise it prints `SMOKE_OK` and exits 0 |

### Unit test details (`npm test`)

**`test/scheduler.test.js`** — the day-plan optimizer:
- prereq-blocked topic is never scheduled; its blocking parent is scheduled first with an "unblocks X" rationale
- once the prereq is mastered, the deadline-urgent weak topic tops the plan with the deadline named in its reason
- a short cross-module review is interleaved after a long focus block
- no block is shorter than 25 minutes; all blocks fit inside the availability window
- deadlines marked done stop influencing the plan

**`test/srs.test.js`** — the SM-2 flashcard scheduler:
- good ratings follow the 1d, 6d, then ease-multiplied ladder; easy adds an extra 1.3× and ease bonus
- again resets reps, counts a lapse, drops ease, retries within the session; hard grows slowly with the ease floored at 1.3
- intervals cap at a year; rating buttons preview human labels (10m/1d/7w/2mo)

**`test/pomodoro.test.js`** — the pomodoro phase machine:
- 25 active minutes complete a pomodoro and start a short break; every 4th earns the long break
- work time never accumulates during a break; the wall-clock tick ends breaks on schedule
- skip returns straight to work; custom work/break/cycle config is honored

**`test/extract.test.js`** — the file-text extractor behind the AI type check:
- markdown/text/html/notebook content comes out whitespace-normalized, tags stripped, capped at the excerpt limit
- unsupported formats, missing files, and text-free (scanned) files report a reason instead of throwing

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
