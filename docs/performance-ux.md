# Performance & UX — Study Graph Assistant

This document defines **how fast the app should feel**, **which user journeys matter most**, and **how we verify regressions**. It applies to the Electron stack in this repo: main process + SQLite (`better-sqlite3`), vanilla renderer (`app.js`), canvas universe (`universe.js`), separate material preview windows, and optional local Ollama.

Targets assume a **typical student laptop** (Apple Silicon or recent Intel, SSD, 8 GB RAM) with a **warm cache** unless noted.

---

## Principles

### User perception (RAIL)

| Delay | Perception | App rule |
| --- | --- | --- |
| **0–100 ms** | Instant | Every click/key shows immediate feedback (active tab, “Loading…”, button disabled state). |
| **100–300 ms** | Connected | Acceptable for a full view swap if the shell (sidebar, status bar) stays stable. |
| **300 ms–3 s** | Working | Show progress or partial UI; never a frozen window with no message. |
| **3–30 s** | Impatience | Must be cancellable or clearly background (ingest, AI classify). |
| **>30 s** | Abandonment | Never block navigation; use toasts + status bar updates. |

### Actual vs perceived speed

| Technique | Where we use it (or should) |
| --- | --- |
| **Stale-while-revalidate** | Sidebar `refreshTree()` paints cached `treeData` before `library:tree` returns. |
| **Single IPC snapshot** | `library:tree` feeds the whole sidebar tree — navigation does not N+1 the DB. |
| **Parallel IPC on heavy views** | Universe and schedule views use `Promise.all` for independent lists. |
| **Teardown on route change** | `uniHandle.destroy()` stops the universe `requestAnimationFrame` loop when leaving `#/graph`. |
| **Main-process heavy work** | PDF extract, ingest scan, `planDay`, SQLite — stay in main; renderer only paints results. |
| **Optimistic / honest AI** | Suggestions are accept/reject only; stream or progress for long Ollama calls (`ai:classify-progress`). |

### Process architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Renderer (index.html + app.js + universe.js + notes-graph) │
│  • Hash routes, DOM, canvas rAF, command palette            │
│  • No sync IPC; no PDF parsing                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ window.api (preload → invoke)
┌───────────────────────────▼─────────────────────────────────┐
│  Main (main.js + db.js + scheduler + extract + ingest + ai) │
│  • SQLite, file I/O, planDay, ingest scan, Ollama           │
└───────────────────────────┬─────────────────────────────────┘
                            │ separate BrowserWindow
┌───────────────────────────▼─────────────────────────────────┐
│  Material preview (material-preview.html + pdf.js worker)   │
│  • Timed study session; progress save via IPC                 │
└─────────────────────────────────────────────────────────────┘
```

**Budget rule:** renderer main thread work per frame **≤ ~10 ms** (60 fps). IPC handlers that can exceed **50 ms** should not run on the critical path of input handling without showing loading state first.

---

## Scale assumptions (budget reference)

These numbers define “normal” vs “stress” for manual profiling. Adjust budgets if your library is routinely larger.

| Entity | Normal | Stress (must remain usable) |
| --- | --- | --- |
| Modules | 4–12 | 30 |
| Topics | 50–200 | 800 |
| Materials (files) | 200–2,000 | 10,000 |
| Edges | 50–300 | 2,000 |
| Reading notes per file | 5–40 | 150 |
| Library root scan (`ingest:run`) | ~500 files | 5,000+ files |

---

## Critical user journeys & budgets

Each journey lists **P75 targets** (75% of sessions should meet them on reference hardware). **Hard limits** are fail conditions for release review.

### J1 — Cold start → dashboard

**Path:** Launch app → DB open + migrations → `#/dashboard` (default hash) → modules or onboarding.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Window visible (first paint) | ≤ 1.5 s | ≤ 3 s | Electron + `index.html` |
| Dashboard interactive (click module / Index) | ≤ 2.5 s | ≤ 5 s | Includes first `route()` |
| AI badge settled (`ai:status`) | ≤ 3 s | ≤ 8 s | Badge may read “AI: offline”; must not block UI |
| Smoke route walk (CI) | all views, no console errors | — | `--smoke` in `main.js` |

**UX requirements**

- Empty library: onboarding CTA (`#onboard-index`) visible without scrolling.
- Non-empty: module cards visible; sidebar either cached tree or “Library not indexed yet.”

**Verification:** `xvfb-run npx electron . --smoke --no-sandbox` (CI `smoke` job).

---

### J2 — Sidebar library tree

**Path:** Any view → expand module/topic → filter → open file / reference (⧉).

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Filter keystroke → tree update | ≤ 16 ms | ≤ 50 ms | Client-only `renderTreeNodes()` |
| After navigation, tree visible (cached) | ≤ 50 ms | ≤ 150 ms | Stale-while-revalidate |
| `library:tree` refresh (cold) | ≤ 200 ms | ≤ 800 ms | Single query snapshot |
| Double-click / open row → preview window opening | ≤ 500 ms | ≤ 2 s | PDF spawns second window + worker |

**UX requirements**

- Filter shows “No files match.” instead of empty silence.
- Delegated click handlers on `#tree-nodes` (rows re-render often).

**Verification:** E2E “sidebar layers files… live filter” in `test/e2e/app.spec.js`.

---

### J3 — Module study board

**Path:** `#/dashboard` → `#/module/<id>` → section board, drag-drop, open material, reading-notes dialog.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Module view first paint | ≤ 300 ms | ≤ 1 s | After IPC lists for that module |
| Drag-drop slot update | ≤ 200 ms | ≤ 500 ms | `materials:organize` + `route()` |
| Open material (in-app preview) | ≤ 500 ms | ≤ 2 s | `materials:open` |
| Reading-notes graph dialog | ≤ 300 ms | ≤ 1 s | SVG force layout; keep **≤ 80** notes smooth |

**UX requirements**

- “Loading…” only in `#view`, not whole window.
- Course-info (`overview`) stays in About panel, not study board (reduces noise and DOM size).

**Verification:** E2E module, section, about-panel, and drag tests.

---

### J4 — Library Universe (`#/graph`)

**Path:** Activity bar → universe canvas → zoom levels → material panel → optional AI link suggestions.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| First frame after data load | ≤ 500 ms | ≤ 1.5 s | Layout once in `layoutUniverse()` (~240 iter × modules) |
| `graph:universeData` IPC (stress ~2000 files) | ≤ 200 ms | ≤ 800 ms | Single snapshot in `db.getUniverseGraph()` |
| View shell visible before IPC returns | ≤ 100 ms | — | Canvas chrome paints first; `#uni-msg` loading hint |
| Steady-state animation | 60 fps | ≥ 30 fps | With “idle motion” on; user can disable |
| Leaving `#/graph` | rAF stopped | — | `destroy()` must run (memory + CPU) |
| `modulesList` + full lists at stress scale | ≤ 2 s | ≤ 5 s | Consider pagination if routinely exceeded |

**UX requirements**

- “Freeze for capture” disables motion for screenshots.
- Breadcrumb (`#uni-crumb`) updates within one frame of level change.

**Verification:** CI smoke includes `#/graph`; E2E universe drill-down via `window.__uni`.

**Future work if stress scale hurts:** incremental layout, lazy material fetch per galaxy, worker offload for layout.

---

### J5 — Today plan & schedule

**Path:** `#/schedule/today` → kanban → generate/adjust blocks → open material from block → mark done.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Today tab first paint | ≤ 400 ms | ≤ 1.2 s | `Promise.all` on blocks, deadlines, lists |
| `plan:generate` (main) | ≤ 150 ms | ≤ 500 ms | Pure JS `planDay()`; scales with topic count |
| Calendar month (`blocks:listRange`) | ≤ 300 ms | ≤ 1 s | Extra IPC only on calendar tab |
| Kanban drag / status change | ≤ 200 ms | ≤ 500 ms | |

**UX requirements**

- Empty today: short hint + “+ Study block”, not blank main area.
- Done/skip updates mastery for tomorrow’s plan (user should see toast or visible state change).

**Verification:** `test/scheduler.test.js` (logic); smoke `#/schedule/today` + `#/schedule/timeline`.

---

### J6 — Library ingest / re-index

**Path:** `#reindex`, settings “Run index”, onboarding Index, or command palette.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| UI acknowledgment | ≤ 100 ms | — | Sidebar shows “Indexing…” |
| Scan + DB apply (500 files) | ≤ 5 s | ≤ 60 s | Background via `ingest:start` + `ingest:progress` |
| Post-ingest tree refresh | ≤ 1 s | ≤ 3 s | `refreshTree()` on `ingest:done` |
| UI during ingest | navigation stays usable | — | Status bar `#st-ingest`; sidebar keeps cached tree |

**UX requirements**

- Progress in the status bar; re-index button disabled while running.
- Toast on `ingest:done`; errors via `ingest:error`.
- Synchronous `ingest:run` remains for scripts/tests that need a blocking result.

**Verification:** `test/ingest-job.test.js`, `test/ingest.test.js`; manual timing on real `year_three` root.

**IPC:** `ingest:start`, `ingest:status`, events `ingest:progress`, `ingest:done`, `ingest:error`.

---

### J7 — AI (optional Ollama)

**Path:** Module classify, suggest topics/edges, note links, overview summary.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| `ai:status` | ≤ 2 s | ≤ 5 s | Non-blocking at boot |
| First token / progress event | ≤ 3 s | ≤ 15 s | Model load dependent |
| Full module classify (20 files) | progress UI | ≤ 5 min | Must show `ai:classify-progress` |
| PDF excerpt (`extract.js`) | ≤ 300 ms/file | ≤ 2 s/file | First 4 pages, 3000 chars cap |

**UX requirements**

- Status bar: `AI: local` vs `AI: offline`.
- No silent apply — user confirms suggestions.
- Scanned PDFs: fall back to filename with low-confidence messaging (see README).

**Verification:** `test/extract.test.js`; manual with `ollama pull qwen2.5`.

---

### J8 — Material preview & study timer

**Path:** Open PDF/MD → read → timer runs on focus → close → session logged.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Preview window interactive | ≤ 1 s | ≤ 3 s | pdf.js worker from unpacked asar path |
| Page scroll / render | 60 fps | ≥ 30 fps | Large PDFs: lazy page render |
| Progress save | ≤ 100 ms | ≤ 500 ms | Prefer async; avoid blocking UI on close |
| Timer visible in preview | ≤ 200 ms | — | `preview:timer` push |

**UX requirements**

- Reference windows (⧉) do not affect pomodoro/timer state.
- `backgroundThrottling: false` on preview for accurate study time.

**Verification:** CI `package` job smoke on built `.app` (catches asar/worker path regressions).

---

### J9 — Command palette (⌘K)

**Path:** Open palette → type → run command / open material.

| Metric | P75 target | Hard limit | Notes |
| --- | --- | --- | --- |
| Palette open | ≤ 50 ms | ≤ 100 ms | DOM already in `index.html` |
| Search filter (materials) | ≤ 150 ms | ≤ 400 ms | Depends on `materials:search` / list size |

**UX requirements**

- First keystroke focuses input; list updates without layout jump (fixed palette height).

---

## Hash routes (smoke coverage)

| Route | View |
| --- | --- |
| `#/dashboard` | Module cards |
| `#/graph` | Universe canvas |
| `#/queue` | Problem queue |
| `#/cards` | Flashcards |
| `#/schedule/today` | Today kanban |
| `#/schedule/timeline` | Deadline timeline |
| `#/settings` | Settings + ingest + backup |

Module detail `#/module/<id>` is covered by E2E, not smoke (no DB seed in smoke mode).

---

## Release checklist

Before tagging a release (or merging large UI/main-process changes):

1. **Unit:** `npm test`
2. **Smoke (dev):** `npx electron . --smoke --no-sandbox` → `SMOKE_OK`
3. **E2E (optional locally):** `npm run test:e2e`
4. **Packaged smoke (when touching native paths):** `npm run pack` then run `.app` with `--smoke`
5. **Manual spot-check (5 min):**
   - Cold start → dashboard
   - Open universe → leave → CPU drops (Activity Monitor)
   - Open PDF preview → scroll → close → session toast
   - Re-index on a small folder → toast counts
6. **Regression scan:** renderer errors logged via `log:renderer` (Settings → Open log)

---

## Profiling guide

### Renderer

1. DevTools → **Performance** record while: switching routes, filtering tree, orbiting universe.
2. Watch **Long Tasks** > 50 ms during `#/graph` animation.
3. Confirm `uniHandle.destroy()` on route change (no runaway rAF).

### Main process

1. Log timestamps around `ingest:run`, `plan:generate`, `ai:*` handlers in `main.js` during investigation.
2. SQLite: `EXPLAIN QUERY PLAN` for new hot queries in `db.js`.
3. Electron: `--trace-startup` for cold-start regressions.

### Packaged vs dev

Native module and pdf.js worker paths differ under `asarUnpack`. Treat **packaged smoke** as authoritative for preview and DB.

---

## Anti-patterns (do not introduce)

- Calling `route()` twice on boot (duplicate handlers) — see `boot()` comment in `app.js`.
- Full `listMaterials()` on every keystroke without debounce.
- Synchronous `sendSync` on hot paths except intentional progress flush on preview close.
- SVG notes graph with hundreds of nodes without simplification.
- Modal dialogs with no cancel during ingest or AI batch jobs.
- Drawing every cross-module edge on the universe canvas (layout uses affinity; lines are optional and expensive).

---

## Related code & tests

| Area | Primary files |
| --- | --- |
| Routing & shell | `src/renderer/app.js`, `src/renderer/index.html` |
| Sidebar cache | `refreshTree()`, `library:tree` in `src/main/main.js` / `db.js` |
| Universe data | `graph:universeData`, `getUniverseGraph()` in `db.js` |
| Ingest job | `src/main/ingest-job.js`, `test/ingest-job.test.js` |
| Universe | `src/renderer/universe.js` |
| Notes graph | `src/renderer/notes-graph.js` |
| Plan optimizer | `src/main/scheduler.js`, `test/scheduler.test.js` |
| Ingest | `src/main/ingest.js`, `test/ingest.test.js` |
| Extract / AI input | `src/main/extract.js`, `test/extract.test.js` |
| Smoke | `src/main/main.js` (`--smoke`) |
| E2E journeys | `test/e2e/app.spec.js` |

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-07-27 | Background ingest (`ingest:start` + progress events); universe `graph:universeData` snapshot. |
| 2026-07-27 | Initial journey budgets aligned with current architecture and CI smoke/E2E. |
