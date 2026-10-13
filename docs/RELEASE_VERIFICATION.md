# Release Verification Report

**Task:** T-043 Release verification gate (plan.md; PRD §11, §13) — re-verified for
v1.0.3 by T-059 (re-release with the T-056..T-058 UI/UX redesign)
**Version verified:** 1.0.3
**Date:** 2026-10-13
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
| 4 | Unit tests | PASS — 791/791 (`vitest run`; +18 redesign tests: command palette semantics/keyboard model, shell Ctrl/Cmd+K wiring) |
| 5 | E2E smoke + verification | PASS — 56/56 in real Chromium over the unpacked `dist/` (functional smoke incl. the new command-palette spec, release verification incl. keyboard pass, human-simulation personas, ZIP extract-and-load acceptance, the extended 14-test screenshot suite, T-054 user-report regressions) |
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
| p50 | 68 ms |
| **p95** | **118 ms** |
| p99 | 301 ms |
| max | 396 ms |

Per-shape p95: common term 66 ms, two-term 118 ms, phrase 125 ms,
title-scoped 133 ms, flag filter + term 56 ms, filter-only 60 ms,
term + title sort 95 ms, fuzzy 84 ms. **PRD budget: p95 < 500 ms → PASS**
(asserted in `tests/perf/search-p95.test.ts`, runnable via
`npm run test:perf`).

Documented observation: a full index **rebuild** of the 10k corpus took
~102 s under Node + fake-indexeddb. Rebuild is the rare recovery path
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
- **Command palette (new, v1.0.3):** Ctrl+K opens it, typing filters,
  ArrowDown/Enter run commands, Escape closes, a no-match query shows an
  honest empty state where Enter is a no-op (asserted in
  `tests/e2e/extension.spec.ts`).
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
| Zip | `release/local-notes-web-archive-1.0.3.zip` (1,532,959 bytes) |
| SHA-256 | `2cb3d6131c99a054fd0f4ec6f54c35a2683fa6f3595174ec589ade104be9181c` |
| Inventory | `release/RELEASE_MANIFEST.txt` (file list + sizes) |
| Installation | Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the extracted folder. Nothing else: no Node, no server, no CDN, no download (PRD §13.1). The v1.0.3 artifact supersedes v1.0.2: it ships the complete UI/UX redesign (T-056..T-058 — sidebar app shell, Linear/Arc design language, command palette, component pass; redesign QA evidence in `docs/REDESIGN_QA_REPORT.md`) while preserving 100% feature parity — no change to business logic, data, storage, APIs, permissions, search/AI/reminder/archive logic or import/export behavior; it also carries every earlier fix (T-054 dialog fields + editor pin/trash, T-052 hidden guard). |

The zip and checksums are regenerable via `npm run release`; the manifest
scan is enforced inside that pipeline (`scripts/verify-release.mjs`) and
standalone via `npm run verify-release`, so no future artifact can ship with
a remote URL, dynamic code, missing asset or undocumented permission.

## Verification commands

```bash
npm run verify          # lint + tsc strict + 791 unit tests
npm run test:perf       # 10k-note search p95 benchmark (< 500 ms budget)
npm run test:e2e        # 56 Playwright tests over the built extension
npm run release         # build + static gate + manifest scan + zip + sha256
```
