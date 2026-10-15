# Release Verification Report

**Task:** T-043 Release verification gate (plan.md; PRD §11, §13) — re-verified for
v1.0.10 by T-104 (release shipping the T-103 option-alignment fix, plan.md
§V: the v1.0.9 zip was cut before the fix landed on main; user report
2026-10-15)
**Version verified:** 1.0.10
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
| 3 | Manifest scan (`verify-release.mjs`) | PASS — MV3, Chrome ≥ 120, stable `key`; CSP unchanged `script-src 'self'` / `object-src 'self'` / `connect-src 'self' + loopback`; 6 manifest/html-referenced assets present; icons are real PNGs; permissions match PERMISSIONS.md exactly (8 API, 2 required host, 2 optional host — unchanged from v1.0.9) |
| 4 | Unit tests | PASS — 924/924 (`vitest run`; +7 since v1.0.9: the T-103 CSS-guard regressions pinning every alignment selector — the parent-qualified sidebar flex-start rules, the rail/strip media-query blocks incl. the save-page extension, the settings/diagnostics shrink-to-fit rules — plus rename detectors) |
| 5 | E2E smoke + verification | PASS — 82/82 in real Chromium over the unpacked `dist/` and the extracted zip (functional smoke incl. the command-palette spec, release verification incl. keyboard pass, human-simulation personas, ZIP extract-and-load acceptance against this artifact, the screenshot suite, the user-report regression suite, the audit-defect regression suite, the T-084 register-fixes suite, and the v1.0.10 alignment: 4 T-103 ground-truth tests assert computed styles + pixel gaps at wide/rail/strip widths — sidebar actions flush-left, settings panel actions shrink-to-fit — and the zip-acceptance spec carries the same alignment assertions against the EXTRACTED package, matching the shipped behavior of this artifact) |
| 6 | Performance (PRD §11) | PASS — see measurements below |
| 7 | Accessibility keyboard pass | PASS — see below |
| 8 | Release artifacts | PASS — see below |
| 13.13 | Final production-folder scan | PASS — gates 2 + 3 prove no missing files and no remote runtime imports |

## Performance measurements (PRD §11)

### Dashboard shell

| Measurement | Observed | Target | Result |
|---|---|---|---|
| Cold, clean profile (first load) | 428 ms / 433 ms (two runs) | < 1,500 ms | PASS |
| Warm reloads, data present | 210–362 ms per load, medians 297 ms / 273 ms | < 1,500 ms | PASS |

Method: `page.goto` (commit) until heading + "New Note" + search input are
present in the real extension page, timed in the persistent Chromium context
(3 warm samples per run with one note present). The E2E regression guards assert
< 3,000 ms (cold) / < 2,000 ms (warm) with headroom for shared CI hardware.

### Search over 10,000 notes + 2,000 indexed snapshots

200 samples across 8 realistic query shapes (common term, two-term, phrase,
title-scoped, flag filter + term, filter-only sort, term + title sort, fuzzy
misspelling), measured through the real `SearchEngine.execute()` path after
one authoritative index build:

| Statistic | Value |
|---|---|
| p50 | 76 ms |
| **p95** | **126 ms** |
| p99 | 309 ms |
| max | 394 ms |

Per-shape p95: common term 69 ms, two-term 161 ms, phrase 141 ms,
title-scoped 77 ms, flag filter + term 105 ms, filter-only 67 ms,
term + title sort 117 ms, fuzzy 124 ms. **PRD budget: p95 < 500 ms → PASS**
(asserted in `tests/perf/search-p95.test.ts`, runnable via
`npm run test:perf`).

Documented observation: a full index **rebuild** of the 10k corpus took
~109 s under Node + fake-indexeddb. Rebuild is the rare recovery path
(corruption/migration); production indexing is incremental per save. Users
should expect a one-time longer rebuild on very large corpora after a
corruption recovery. The HEIC decode adds ~1.4 s to image insertion on
first use only (worker warm-up), and nothing to note load: the 3.1 MB
decoder ships as a separate file the dashboard never fetches until a HEIC
photo is inserted.

## Accessibility keyboard pass

Verified in real Chromium (`tests/e2e/release-verification.spec.ts`):

- First-run onboarding dialog: focus is contained while open (native
  `<dialog>` modal), dismissable with keyboard Enter on "Skip for now";
  the primary "Create my first note" action is focused on open so Enter
  starts the product directly (T-089).
- Keyboard-only note creation: "New Note", the title input and the editor
  are all reachable by Tab through the full toolbar chain; text typed,
  `Ctrl+A` + `Ctrl+B` bold applied (`<strong>` present), autosave reached
  the durable "Saved" state — no pointer input anywhere.
- **Option alignment (v1.0.10, T-103):** every sidebar action button
  (New Note, Save a web page…, Import note…, Settings, Diagnostics) reads
  flush-left in one column with the smart lists at every width — wide,
  collapsed icon rail and narrow strip — and the Settings/Diagnostics
  dialogs' direct panel actions (Test connection, Show the introduction
  again, Rebuild search index) shrink to their content and align left
  like every sibling control (asserted via computed styles + pixel gaps
  in `tests/e2e/user-report-regressions.spec.ts` and, against the
  extracted package, in `tests/e2e/zip-acceptance.spec.ts`).
- **New Note navigation (v1.0.9, T-101):** every New Note activation —
  button, palette command or Alt+Shift+C — lands the user in the fresh
  note's editor immediately (asserted across the E2E suites and the
  zip-acceptance flow against this artifact); the note previously being
  edited is flushed by autosave on the way in, and the header save-state
  resets honestly instead of showing the previous note's "Saved".
- **Command palette (v1.0.3):** Ctrl+K opens it, typing filters,
  ArrowDown/Enter run commands, Escape closes, a no-match query shows an
  honest empty state where Enter is a no-op (asserted in
  `tests/e2e/extension.spec.ts`).
- **Universal dismissal (v1.0.7, T-085):** every popped-out bar —
  attachments, snapshots, reminders, AI, filters — closes via its own
  in-surface Close control and via Escape (LIFO stack, guarded while a
  modal dialog is open); the Filters bar additionally closes on Apply;
  Revisions honors Escape (asserted in
  `tests/e2e/t084-register-fixes.spec.ts`).
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
  `tests/e2e/user-report-regressions.spec.ts`).
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
| Zip | `release/local-notes-web-archive-1.0.10.zip` (3,231,557 bytes) |
| SHA-256 | `206d3cd0caac42f051f23f0b1547b4da45f40d0d5a5df1ec16931abdb84e67ad` |
| Inventory | `release/RELEASE_MANIFEST.txt` (file list + sizes) |
| GitHub cross-check | Release id 413539535, tag == HEAD (7c1be96), asset digest matches, download-back byte-identical — all 9 checks PASS, record archived at `task-deliverables/release-verification/v1010-verified.txt` |
| Installation | Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the extracted folder. Nothing else: no Node, no server, no CDN, no download (PRD §13.1). |

The v1.0.10 artifact supersedes v1.0.9: it ships the T-103 option-alignment
fix (user report 2026-10-15, two screenshots) — the sidebar's action buttons
(New Note, Save a web page…, Import note…, Settings, Diagnostics) now read
flush-left in one column with the smart lists at every width (a CSS cascade
bug had the generic button rule's `justify-content: center` silently defeat
the sidebar's left-align intent), the Settings and Diagnostics dialogs' direct
panel actions shrink to their content and align left instead of stretching
full-width centered, and the collapsed icon rail no longer clips the
"Save a web page…" label. No features were added or removed — v1.0.10 is
the repaired v1.0.9 (the zip stays byte-for-byte the same shape; the size
delta vs v1.0.9 is version strings, release-notes CSS hashes and bundle
hashes).

The zip and checksums are regenerable via `npm run release`; the manifest
scan is enforced inside that pipeline (`scripts/verify-release.mjs`) and
standalone via `npm run verify-release`, so no future artifact can ship with a
remote URL, dynamic code, missing asset or undocumented permission.

## Verification commands

```bash
npm run verify          # lint + tsc strict + 924 unit tests
npm run test:perf       # 10k-note search p95 benchmark (< 500 ms budget)
npm run test:e2e        # 82 Playwright tests over the built extension
npm run release         # build + static gate + manifest scan + zip + sha256
```
