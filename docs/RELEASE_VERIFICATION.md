# Release Verification Report

**Task:** T-043 Release verification gate (plan.md; PRD §11, §13) — re-verified for
v1.0.7 by T-090 (release packaging the T-084 lost-user register fixes, plan.md §N /
T-085..T-089: universal disclosure dismissal, HEIC photo support, editor tag/category
bar, the visible save-a-web-page entry point, product-first onboarding, the inline
empty-state create action and the plain-language copy pass)
**Version verified:** 1.0.7
**Date:** 2026-10-14
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
| 2 | Static release scan (`release.mjs`) | PASS — 6 shipped JS files scanned: no remote runtime URLs, no `eval`/`new Function`; inert literal allowlist (W3C namespace URIs, dependency doc links) only. The new save-page dialog's copy was written scheme-less precisely so this gate needed NO new allowlist entries |
| 3 | Manifest scan (`verify-release.mjs`) | PASS — MV3, Chrome ≥ 120, stable `key`; CSP unchanged `script-src 'self'` / `object-src 'self'` / `connect-src 'self' + loopback` (the HEIC decoder is asm.js with no dynamic evaluation — no CSP additions anywhere); 6 manifest/html-referenced assets present; icons are real PNGs; permissions match PERMISSIONS.md exactly (8 API, 2 required host, 2 optional host — unchanged) |
| 4 | Unit tests | PASS — 896/896 (`vitest run`; +56 since v1.0.6: T-085 dismissal matrix, T-086 HEIC detection/orchestration/extraction contracts + real-channel session tests, T-087 metadata-bar contract + real-channel session tests, T-088 humanize mapper + disclosure structure, T-089 save-page dialog + product-first onboarding, plus refreshed docs pins) |
| 5 | E2E smoke + verification | PASS — 77/77 in real Chromium over the unpacked `dist/` and the extracted zip (functional smoke incl. the command-palette spec, release verification incl. keyboard pass, human-simulation personas, ZIP extract-and-load acceptance against this artifact, the screenshot suite, the user-report regression suite, the audit-defect regression suite, and the new T-084 register-fixes suite: every popped-out bar closes, a REAL iPhone HEIC photo decodes locally and inserts as a visible 1440×960 image under the strict extension CSP, tags are created from the editor, and Save-a-web-page runs end-to-end) |
| 6 | Performance (PRD §11) | PASS — see measurements below |
| 7 | Accessibility keyboard pass | PASS — see below |
| 8 | Release artifacts | PASS — see below |
| 13.13 | Final production-folder scan | PASS — gates 2 + 3 prove no missing files and no remote runtime imports |

## Performance measurements (PRD §11)

### Dashboard shell

| Measurement | Observed | Target | Result |
|---|---|---|---|
| Cold, clean profile (first load) | 482 ms / 199 ms (two runs) | < 1,500 ms | PASS |
| Warm reloads, data present | 115–134 ms per load, median 126 ms | < 1,500 ms | PASS |

Method: `page.goto` (commit) until heading + "New Note" + search input are
present in the real extension page, timed in the persistent Chromium context
(5 warm samples with one note present). The E2E regression guards assert
< 3,000 ms (cold) / < 2,000 ms (warm) with headroom for shared CI hardware.

### Search over 10,000 notes + 2,000 indexed snapshots

200 samples across 8 realistic query shapes (common term, two-term, phrase,
title-scoped, flag filter + term, filter-only sort, term + title sort, fuzzy
misspelling), measured through the real `SearchEngine.execute()` path after
one authoritative index build:

| Statistic | Value |
|---|---|
| p50 | 75 ms |
| **p95** | **122 ms** |
| p99 | 322 ms |
| max | 362 ms |

Per-shape p95: common term 71 ms, two-term 143 ms, phrase 129 ms,
title-scoped 131 ms, flag filter + term 107 ms, filter-only 75 ms,
term + title sort 152 ms, fuzzy 94 ms. **PRD budget: p95 < 500 ms → PASS**
(asserted in `tests/perf/search-p95.test.ts`, runnable via
`npm run test:perf`).

Documented observation: a full index **rebuild** of the 10k corpus took
~125 s under Node + fake-indexeddb. Rebuild is the rare recovery path
(corruption/migration); production indexing is incremental per save. Users
should expect a one-time longer rebuild on very large corpora after a
corruption recovery. The new HEIC decode adds ~1.4 s to image insertion on
first use only (worker warm-up), and nothing to note load: the 3.1 MB
decoder ships as a separate file the dashboard never fetches until a HEIC
photo is inserted.

## Accessibility keyboard pass

Verified in real Chromium (`tests/e2e/release-verification.spec.ts`):

- First-run onboarding dialog: focus is contained while open (native
  `<dialog>` modal), dismissable with keyboard Enter on "Skip for now";
  the primary "Create my first note" action is focused on open so Enter
  starts the product directly (T-089).
- Keyboard-only note creation: "New Note", the note open button, the title
  input and the editor are all reachable by Tab through the full toolbar
  chain; text typed, `Ctrl+A` + `Ctrl+B` bold applied (`<strong>` present),
  autosave reached the durable "Saved" state — no pointer input anywhere.
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
| Zip | `release/local-notes-web-archive-1.0.7.zip` (3,222,503 bytes) |
| SHA-256 | `bfb88efebe1e1d622ad2654302f1783723802a722b6dcf70810945e962db28fd` |
| Inventory | `release/RELEASE_MANIFEST.txt` (file list + sizes) |
| GitHub cross-check | Release id 412494481, tag == HEAD, asset digest matches, download-back byte-identical (verified by `scripts/verify-v107-release.mjs`) |
| Installation | Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the extracted folder. Nothing else: no Node, no server, no CDN, no download (PRD §13.1). |

The v1.0.7 artifact supersedes v1.0.6: it fixes 16 of the 17 findings in
the T-084 lost-user register (a maintainer-reported comprehensive UX audit
of v1.0.6, evidence in `task-deliverables/t084-ux-audit/`) — every
popped-out bar now carries its own Close control plus Escape (UX-01..05,
09), iPhone photos (HEIC) insert from the PC through a local decoder with
the data:image "blobs" ask removed (UX-06, 07, 15), tags and categories are
editable in the note editor itself (UX-08), saving a web page has a visible
entry point (UX-13), onboarding teaches the product (UX-14), the empty
library offers an inline create button (UX-16), and user-facing copy speaks
plain language (UX-10, 11, 12). UX-17 (diagnostics vocabulary) was accepted
as-is per the register's own judgment. The artifact grows by ~1.7 MB over
v1.0.6 because the HEIC decoder (libheif + libde265 compiled to asm.js)
ships inside the extension for fully offline photo insertion — nothing is
downloaded, ever.

The zip and checksums are regenerable via `npm run release`; the manifest
scan is enforced inside that pipeline (`scripts/verify-release.mjs`) and
standalone via `npm run verify-release`, so no future artifact can ship with
a remote URL, dynamic code, missing asset or undocumented permission.

## Verification commands

```bash
npm run verify          # lint + tsc strict + 896 unit tests
npm run test:perf       # 10k-note search p95 benchmark (< 500 ms budget)
npm run test:e2e        # 77 Playwright tests over the built extension
npm run release         # build + static gate + manifest scan + zip + sha256
```
