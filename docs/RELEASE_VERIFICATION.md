# Release Verification Report

**Task:** T-043 Release verification gate (plan.md; PRD §11, §13) — re-verified for
v1.0.5 by T-069 (re-release carrying the T-063..T-068 QA-audit defect fixes)
**Version verified:** 1.0.5
**Date:** 2026-10-14
**Verdict:** **PASS** — every gate green; the artifact is releasable.

## Verification environment

| Property | Value |
|---|---|
| Runner | Linux container, Intel(R) Xeon(R) × 2 vCPU, 4 GB RAM |
| Node | v24.21.0 |
| Unit/benchmark engine | vitest 5.0.3, fake-indexeddb 6.2.5 (structuredClone-backed) |
| Browser | Chromium via Playwright 1.64.0, persistent context, Xvfb 1440×900, `--disable-gpu --no-sandbox` |
| Build | vite 8.3.4 → `dist/` (14 files, 4 JS bundles) |

Environment honesty: all numbers below were measured in this container.
Software rendering (`--disable-gpu`) and the shared vCPUs make browser
timings conservative relative to a typical desktop; the search benchmark
runs the production engine path under Node + fake-indexeddb. Absolute
values on other hardware will differ; the code paths, corpus sizes and
assertions are the production ones.

## Gate matrix (PRD §13)

| # | Gate | Result |
|---|---|---|
| 1 | Build (`vite build`) | PASS — 14 files, 0 warnings blocking, `theme-hint.js` external (CSP-safe) |
| 2 | Static release scan (`release.mjs`) | PASS — 4 shipped JS files scanned: no remote runtime URLs, no `eval`/`new Function`; inert literal allowlist (W3C namespace URIs, dependency doc links) only |
| 3 | Manifest scan (`verify-release.mjs`) | PASS — MV3, Chrome ≥ 120, stable `key`; CSP `script-src 'self'` / `object-src 'self'` / `connect-src 'self' + loopback`; 6 manifest/html-referenced assets present; icons are real PNGs; permissions match PERMISSIONS.md exactly (8 API, 2 required host, 2 optional host) |
| 4 | Unit tests | PASS — 835/835 (`vitest run`; +38 since v1.0.4: binary-transport codec + real-channel regression, favorites wiring, filters panel/controller/engine, sort direction, onboarding re-show, page-slice invariant) |
| 5 | E2E smoke + verification | PASS — 66/66 in real Chromium over the unpacked `dist/` (functional smoke incl. the command-palette spec, release verification incl. keyboard pass, human-simulation personas, ZIP extract-and-load acceptance against this artifact, the 14-test screenshot suite, the 7-test user-report regression suite, and the new 8-test audit-defect regression suite covering all seven T-062 findings in the real browser) |
| 6 | Performance (PRD §11) | PASS — see measurements below |
| 7 | Accessibility keyboard pass | PASS — see below |
| 8 | Release artifacts | PASS — see below |
| 13.13 | Final production-folder scan | PASS — gates 2 + 3 prove no missing files and no remote runtime imports |

## Performance measurements (PRD §11)

### Dashboard shell

| Measurement | Observed | Target | Result |
|---|---|---|---|
| Cold, clean profile (first load) | 317 ms / 418 ms (two runs) | < 1,500 ms | PASS |
| Warm reloads, data present | 191–226 ms per load, medians 192–224 ms | < 1,500 ms | PASS |

Method: `page.goto` (commit) until heading + "New Note" + search input are
present in the real extension page, timed in the persistent Chromium context.
The E2E regression guards assert < 3,000 ms (cold) / < 2,000 ms (warm) with
headroom for shared CI hardware.

### Search over 10,000 notes + 2,000 indexed snapshots

200 samples across 8 realistic query shapes (common term, two-term, phrase,
title-scoped, flag filter + term, filter-only sort, term + title sort, fuzzy
misspelling), measured through the real `SearchEngine.execute()` path after
one authoritative index build:

| Statistic | Value |
|---|---|
| p50 | 79 ms |
| **p95** | **125 ms** |
| p99 | 338 ms |
| max | 378 ms |

Per-shape p95: common term 119 ms, two-term 123 ms, phrase 129 ms,
title-scoped 81 ms, flag filter + term 96 ms, filter-only 83 ms,
term + title sort 104 ms, fuzzy 90 ms. **PRD budget: p95 < 500 ms → PASS**
(asserted in `tests/perf/search-p95.test.ts`, runnable via
`npm run test:perf`).

Documented observation: a full index **rebuild** of the 10k corpus took
~113 s under Node + fake-indexeddb. Rebuild is the rare recovery path
(corruption/migration); production indexing is incremental per save. Users
should expect a one-time longer rebuild on very large corpora after a
corruption recovery.

## Accessibility keyboard pass

Verified in real Chromium (`tests/e2e/release-verification.spec.ts`):

- First-run onboarding dialog: focus is contained while open (native
  `<dialog>` modal), dismissable with keyboard Enter on "Get started".
- Keyboard-only note creation: "New Note", the note open button, the title
  input and the editor are all reachable by Tab through the full toolbar
  chain; text typed, `Ctrl+A` + `Ctrl+B` bold applied (`<strong>` present),
  autosave reached the durable "Saved" state — no pointer input anywhere.
- **Command palette (v1.0.3):** Ctrl+K opens it, typing filters,
  ArrowDown/Enter run commands, Escape closes, a no-match query shows an
  honest empty state where Enter is a no-op (asserted in
  `tests/e2e/extension.spec.ts`).
- **QA-audit defect regressions (v1.0.5):** the eight-spec
  `audit-defect-regressions` suite drives the audit's exact repros in the
  real browser — a real file attaches through the panel and downloads with
  byte-verified content, backup export produces a PK-signed zip that
  restores end-to-end, favorites work from the bulk bar and the editor,
  the Filters panel applies filters/chips/saved views across a reload, the
  sort direction flips Title ordering, and the re-shown onboarding's
  Get-started completes (asserted in `tests/e2e/audit-defect-regressions.spec.ts`).
- **Post-redesign regressions (v1.0.4):** under the default system theme
  with a light OS the active smart-list button renders the light accent-soft
  pill with a computed WCAG contrast ≥ 4.5:1, and note cards read title →
  subtitle → body → tags row → categories row → indicators → meta with
  tags/categories on separate rows (asserted in
  `tests/e2e/user-report-regressions.spec.ts`).
- Settings dialog: 12 consecutive Tabs never leave the dialog (focus trap);
  Escape closes it; focus returns to page.
- Visible focus: keyboard-focused search input renders the `:focus-visible`
  outline (2px solid focus ring, asserted via computed style) — the redesigned
  topbar focus glow layers on top of the ring, never replaces it.
- Accessible names: all interactions in the E2E specs use role + accessible
  name queries only, which fail on unlabeled controls.

## Release artifacts

| Artifact | Value |
|---|---|
| Zip | `release/local-notes-web-archive-1.0.5.zip` (1,555,953 bytes) |
| SHA-256 | `ead1a27de5ee06bc332efadeea92efd87fc77bd618b9c5fc9fe79a88527c54f8` |
| Inventory | `release/RELEASE_MANIFEST.txt` (file list + sizes) |
| Installation | Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the extracted folder. Nothing else: no Node, no server, no CDN, no download (PRD §13.1). The v1.0.5 artifact supersedes v1.0.4: it fixes all seven confirmed defects from the external human-behavior QA audit (2026-10-14, 34 workflows verified, evidence on file) — attachments and backup export/restore work again through a base64 binary codec for the RPC channel (D-04/D-06, both critical), favorites are reachable from the bulk bar and the editor (D-01), the Filters disclosure holds the full FR-SEARCH-03 control set with removable chips and durable saved named views (D-02), the sort direction control exists and the persisted default sort seeds new sessions (D-03), the re-shown onboarding's Get-started always works (D-05), and rapid creation keeps the page-slice invariant (D-07). It carries everything from v1.0.4/v1.0.3 (post-redesign fixes and the complete UI/UX redesign) and every earlier fix (T-054 dialog fields + editor pin/trash, T-052 hidden guard). |

The zip and checksums are regenerable via `npm run release`; the manifest
scan is enforced inside that pipeline (`scripts/verify-release.mjs`) and
standalone via `npm run verify-release`, so no future artifact can ship with
a remote URL, dynamic code, missing asset or undocumented permission.

## Verification commands

```bash
npm run verify          # lint + tsc strict + 835 unit tests
npm run test:perf       # 10k-note search p95 benchmark (< 500 ms budget)
npm run test:e2e        # 66 Playwright tests over the built extension
npm run release         # build + static gate + manifest scan + zip + sha256
```
