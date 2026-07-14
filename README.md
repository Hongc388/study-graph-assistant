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
