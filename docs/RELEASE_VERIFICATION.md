# Release Verification Report

**Task:** T-043 Release verification gate (plan.md; PRD §11, §13) — re-verified for
v1.0.12 by T-108 (release shipping the T-107 card colors + separated
metadata blocks feature, plan.md §Z: the v1.0.11 zip was cut before the
feature landed on main; maintainer request 2026-10-15)
**Version verified:** 1.0.12
**Date:** 2026-10-15
**Verdict:** **PASS** — every gate green; the artifact is releasable.

## Verification environment

| Property | Value |
|---|---|
| Runner | Linux container, Intel(R) Xeon(R) × 2 vCPU, 4 GB RAM |
| Node | v24.21.0 |
| Unit/benchmark engine | vitest 5.0.3, fake-indexeddb 6.2.5 (structuredClone-backed) |
| Browser | Chromium via Playwright 1.64.0, persistent context, Xvfb 1440×900, `--disable-gpu --no-sandbox` |
| Build | vite 8.3.4 → `dist/` (17 files, 6 JS files incl. the heic decoder worker) |

Environment honesty: all numbers below were measured in this container.
Software rendering (`--disable-gpu`) and the shared vCPUs make browser
timings conservative relative to a typical desktop; the search benchmark
runs the production engine path under Node + fake-indexeddb. Absolute
values on other hardware will differ; the code paths, corpus sizes and
assertions are the production ones.

## Gate matrix (PRD §13)

| # | Gate | Result |
|---|---|---|
| 1 | Build (`vite build`) | PASS — 17 files, 0 warnings blocking, `theme-hint.js` external (CSP-safe); `heic-decoder-worker.js` emitted once (3.1 MB) with a 1.7 kB lazy wrapper chunk |
| 2 | Static release scan (`release.mjs`) | PASS — 6 shipped JS files scanned: no remote runtime URLs, no `eval`/`new Function`; inert literal allowlist (W3C namespace URIs, dependency doc links) only |
| 3 | Manifest scan (`verify-release.mjs`) | PASS — MV3, Chrome ≥ 120, stable `key`; CSP unchanged `script-src 'self'` / `object-src 'self'` / `connect-src 'self' + loopback`; 6 manifest/html-referenced assets present; icons are real PNGs; permissions match PERMISSIONS.md exactly (8 API, 2 required host, 2 optional host — unchanged from v1.0.10) |
| 4 | Unit tests | PASS — 970/970 (`vitest run`; +38 since v1.0.11: the T-107 color math — WCAG luminance/contrast, auto-foreground pick, strict `#rrggbb` normalization with CSS-injection rejection — the setAppearance repo semantics, the notes/set-appearance RPC validation, the card render ground truth realigned to the separated blocks + tinted rendering, and the CSS guards pinning the `[data-tinted]` rules, the meta-row list, the palette and the panel styles) |
| 5 | E2E smoke + verification | PASS — 86/86 in real Chromium over the unpacked `dist/` and the extracted zip (functional smoke incl. the command-palette spec, release verification incl. keyboard pass, human-simulation personas, ZIP extract-and-load acceptance against this artifact, the screenshot suite, the user-report regression suite, the audit-defect regression suite, the T-084 register-fixes suite, and the v1.0.12 card colors: 2 T-107 ground-truth tests drive the real Card color panel — the card renders data-tinted with the chosen background and the auto-contrast text at an in-page WCAG ratio >= 4.5, default notes stay untinted, colors survive reload, reset restores the default honestly, and Created/Modified render as separate blocks with the reminder chip on its own row after creating a reminder through the real dialog — on top of the retained T-103 alignment and T-105 single-scrollbar tests, and the zip-acceptance spec carries the same alignment + single-scrollbar + card-color assertions against the EXTRACTED package, matching the shipped behavior of this artifact) |
| 6 | Performance (PRD §11) | PASS — see measurements below |
| 7 | Accessibility keyboard pass | PASS — see below |
| 8 | Release artifacts | PASS — see below |
| 13.13 | Final production-folder scan | PASS — gates 2 + 3 prove no missing files and no remote runtime imports |

## Performance measurements (PRD §11)

### Dashboard shell

| Measurement | Observed | Target | Result |
|---|---|---|---|
| Cold, clean profile (first load) | 470 ms / 161 ms (two runs) | < 1,500 ms | PASS |
| Warm reloads, data present | 104–142 ms per load, median 122 ms (5 samples) | < 1,500 ms | PASS |

Method: `page.goto` (commit) until heading + "New Note" + search input are
present in the real extension page, timed in the persistent Chromium context
(5 warm samples in one run with one note present). The E2E regression guards assert
< 3,000 ms (cold) / < 2,000 ms (warm) with headroom for shared CI hardware.

### Search over 10,000 notes + 2,000 indexed snapshots

200 samples across 8 realistic query shapes (common term, two-term, phrase,
title-scoped, flag filter + term, filter-only sort, term + title sort, fuzzy
misspelling), measured through the real `SearchEngine.execute()` path after
one authoritative index build:

| Statistic | Value |
|---|---|
| p50 | 74 ms |
| **p95** | **123 ms** |
| p99 | 297 ms |
| max | 378 ms |

Per-shape p95: common term 74 ms, two-term 161 ms, phrase 128 ms,
title-scoped 64 ms, flag filter + term 103 ms, filter-only 66 ms,
term + title sort 147 ms, fuzzy 96 ms. **PRD budget: p95 < 500 ms → PASS**
(asserted in `dev/tests/perf/search-p95.test.ts`, runnable via
`npm run test:perf`).

Documented observation: a full index **rebuild** of the 10k corpus took
~123 s under Node + fake-indexeddb. Rebuild is the rare recovery path
(corruption/migration); production indexing is incremental per save. Users
should expect a one-time longer rebuild on very large corpora after a
corruption recovery. The HEIC decode adds ~1.4 s to image insertion on
first use only (worker warm-up), and nothing to note load: the 3.1 MB
decoder ships as a separate file the dashboard never fetches until a HEIC
photo is inserted.

## Accessibility keyboard pass

Verified in real Chromium (`dev/tests/e2e/release-verification.spec.ts`):

- First-run onboarding dialog: focus is contained while open (native
  `<dialog>` modal), dismissable with keyboard Enter on "Skip for now";
  the primary "Create my first note" action is focused on open so Enter
  starts the product directly (T-089).
- Keyboard-only note creation: "New Note", the title input and the editor
  are all reachable by Tab through the full toolbar chain; text typed,
  `Ctrl+A` + `Ctrl+B` bold applied (`<strong>` present), autosave reached
  the durable "Saved" state — no pointer input anywhere.
- **Card colors with auto-contrast (v1.0.12, T-107):** every note can
  carry its own card background/text color — set through the editor's
  Card color pop-out panel (curated AA-clean palette + native custom
  input, immediate apply); when the user sets no explicit text color the
  foreground is picked automatically by WCAG contrast and every other
  card item (subtitle, dates, badges, chips) re-derives from the pair,
  with the overdue reminder chip inverted for maximum standout; default
  notes keep the standard look byte-identically; Created and Modified
  render as separate blocks and the reminder chip sits on its own row —
  asserted through the real panel flow in
  `dev/tests/e2e/user-report-regressions.spec.ts` and, against the extracted
  package, in `dev/tests/e2e/zip-acceptance.spec.ts`.
- **Single scrollbar per dialog (v1.0.11, T-105):** the Settings,
  Diagnostics and restore-review dialogs render exactly ONE scrollbar —
  the content box's; the dialog element itself never scrolls (its
  own-scrollbar width equals its border widths exactly), the heading and
  the Save/Reset/Close actions stay pinned while the settings list itself
  scrolls, and a closed dialog provably hides (the sheet layout must not
  defeat the UA closed-state rule) — asserted at the reporting user's
  798x752 viewport and a short 1280x600 viewport in
  `dev/tests/e2e/user-report-regressions.spec.ts` and, against the extracted
  package, in `dev/tests/e2e/zip-acceptance.spec.ts`.
- **Option alignment (v1.0.10, T-103):** every sidebar action button
  (New Note, Save a web page…, Import note…, Settings, Diagnostics) reads
  flush-left in one column with the smart lists at every width — wide,
  collapsed icon rail and narrow strip — and the Settings/Diagnostics
  dialogs' direct panel actions (Test connection, Show the introduction
  again, Rebuild search index) shrink to their content and align left
  like every sibling control (asserted via computed styles + pixel gaps
  in `dev/tests/e2e/user-report-regressions.spec.ts` and, against the
  extracted package, in `dev/tests/e2e/zip-acceptance.spec.ts`).
- **New Note navigation (v1.0.9, T-101):** every New Note activation —
  button, palette command or Alt+Shift+C — lands the user in the fresh
  note's editor immediately (asserted across the E2E suites and the
  zip-acceptance flow against this artifact); the note previously being
  edited is flushed by autosave on the way in, and the header save-state
  resets honestly instead of showing the previous note's "Saved".
- **Command palette (v1.0.3):** Ctrl+K opens it, typing filters,
  ArrowDown/Enter run commands, Escape closes, a no-match query shows an
  honest empty state where Enter is a no-op (asserted in
  `dev/tests/e2e/extension.spec.ts`).
- **Universal dismissal (v1.0.7, T-085):** every popped-out bar —
  attachments, snapshots, reminders, AI, filters — closes via its own
  in-surface Close control and via Escape (LIFO stack, guarded while a
  modal dialog is open); the Filters bar additionally closes on Apply;
  Revisions honors Escape (asserted in
  `dev/tests/e2e/t084-register-fixes.spec.ts`).
- **Image insertion (v1.0.8, QA-D04):** the insert-image dialog stages the
  chosen file with an honest "Ready to insert" status; alt text and caption
  typed after the pick are honored on the explicit Insert action; keyboard
  and pointer paths are equivalent.
- **QA-audit defect regressions (v1.0.5):** the
  `audit-defect-regressions` suite drives the audit's exact repros in the
  real browser — a real file attaches through the panel and downloads with
  byte-verified content, backup export produces a PK-signed zip that
  restores end-to-end, favorites work from the bulk bar and the editor,
  the Filters panel applies filters/chips/saved views across a reload, the
  sort direction flips Title ordering, and the re-shown onboarding always
  completes.
- **Post-redesign regressions (v1.0.4):** under the default system theme
  with a light OS the active smart-list button renders the light
  accent-soft pill with a computed WCAG contrast ≥ 4.5:1, and note cards
  read title → subtitle → body → tags row → categories row → indicators →
  meta with tags/categories on separate rows (asserted in
  `dev/tests/e2e/user-report-regressions.spec.ts`).
- Settings dialog: 12 consecutive Tabs never leave the dialog (focus trap);
  Escape closes it; focus returns to page.
- Visible focus: keyboard-focused search input renders the `:focus-visible`
  outline (2px solid focus ring, asserted via computed style) — the
  redesigned topbar focus glow layers on top of the ring, never replaces it.
- Accessible names: all interactions in the E2E specs use role + accessible
  name queries only, which fail on unlabeled controls.

## Release artifacts

| Artifact | Value |
|---|---|
| Zip | `release/local-notes-web-archive-1.0.12.zip` (3,245,476 bytes) |
| SHA-256 | `7da6c9599a1bc185107ec65508045c427137940b07c61b24a16c98b58108cdb6` |
| Inventory | `release/RELEASE_MANIFEST.txt` (file list + sizes) |
| GitHub cross-check | Release id 413683194, tag == HEAD (21f9a33 — the release commit was pushed BEFORE publish so the auto-created tag landed correctly), asset digest matches, download-back byte-identical — all 9 checks PASS, record archived at `dev/task-deliverables/release-verification/v1012-verified.txt` |
| Installation | Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the extracted folder. Nothing else: no Node, no server, no CDN, no download (PRD §13.1). |

The v1.0.12 artifact supersedes v1.0.11: it ships the T-107 card colors +
separated metadata blocks feature (maintainer request 2026-10-15) — every
note can now carry its own card background and text color (chosen from a
curated AA-clean palette or any custom color through the editor's new Card
color panel; colors apply immediately, persist across reloads, ride along
on duplicates and round-trip through backup/restore), and when the user
sets no explicit text color the foreground is auto-picked by WCAG
contrast with every other card item re-derived so everything stays
visible, standout and clearly noticeable on ANY background. The card
layout also separates every metadata fact: Created and Modified each
render on their own row (the old single inline line is gone) and the
reminder chip moved to its own row below the link indicators. Notes
without colors keep the standard look exactly (present condition
preserved); the size delta vs v1.0.11 is the feature + its tests and
version strings.

The zip and checksums are regenerable via `npm run release`; the manifest
scan is enforced inside that pipeline (`scripts/verify-release.mjs`) and
standalone via `npm run verify-release`, so no future artifact can ship with a
remote URL, dynamic code, missing asset or undocumented permission.

## Verification commands

```bash
npm run verify          # lint + tsc strict + 970 unit tests
npm run test:perf       # 10k-note search p95 benchmark (< 500 ms budget)
npm run test:e2e        # 86 Playwright tests over the built extension
npm run release         # build + static gate + manifest scan + zip + sha256
```
