# Changelog

All notable changes to Study Graph Assistant are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com); versions follow
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed
- The calm palette is one step lighter (same hues): near-white surfaces,
  brighter accents; stored module colors are remapped once on upgrade.
- A completed pomodoro no longer starts the break by itself — it asks first
  (in the preview window if open, else a native dialog). Accepting freezes
  the reading behind a countdown; declining continues the work uninterrupted.

### Added
- The focus/pomodoro timer now also shows inside the material preview window,
  where the actual reading happens.
- Custom app icon (a learning-path graph mark), rendered from an SVG source
  into the macOS `.icns` by `scripts/make-icns.sh`.
- Study reminder notifications — deadlines (3 days / 1 day / on the day),
  flashcards due, planned study blocks about to start, pomodoro done / break
  over (when the window is in the background), and an evening streak-saver.
  Per-category toggles in Settings; each reminder fires at most once; never
  promotional.
- Distributable builds via electron-builder (`npm run pack` / `npm run dist`);
  CI boots the packaged .app to catch asar/path regressions.
- Playwright end-to-end tests driving real user flows against a throwaway
  data directory (`npm run test:e2e`), also in CI.
- Type checking of the main process and shared engines (`npm run typecheck`).

### Fixed
- Boot rendered the first view twice (explicit `route()` plus the `hashchange`
  event), attaching duplicate click handlers — dialogs could open doubled.

## [0.1.0] — 2026-07-15

First feature-complete local build.

### Added
- **Modules & ingest** — scan a library folder (`~/Desktop/year_three` by
  default), map known folders to course modules, index PDFs/notebooks/notes as
  materials, and parse the study-strategy markdown into per-module tips.
- **Topic graph** — force-directed knowledge graph with prereq / related /
  cross-module / analogy edges, within and across courses.
- **Day planner** — explainable schedule from availability, deadlines, mastery
  and prerequisite order; kanban view; editable study blocks.
- **Readiness model** — mastery derived from tagged problems and logged study
  time (never typed in), taking the higher of the two signals.
- **Flashcards** — SM-2 spaced repetition with interval previews, suspend and
  browse.
- **Pomodoro coach** — rides the material focus timer, logs completed
  pomodoros, break reminders, day streak in the status bar.
- **Reading notes** — per-material concept notes with a linkable mini-graph.
- **Local AI assist (optional, Ollama)** — auto-starts the server; suggests
  topics and edges; content-based file-type check (catches "about this module"
  files misfiled as lectures, new `overview` type); note-link suggestions.
  Every accept/reject is logged and fed back as few-shot examples.
- **Data safety** — rotating daily backups, pre-migration copies keyed to
  `PRAGMA user_version`, Export / Restore in Settings.
- **Crash log** — main and renderer errors recorded to a local file.
- **CI** — commit-message lint, 4-way unit-test matrix, Electron ABI native
  build check, boot smoke test that walks every view.
