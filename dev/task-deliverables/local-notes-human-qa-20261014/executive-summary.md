# Executive Summary — Universal Human-Behavior QA Audit

**Target:** https://github.com/kimpearce888/local-notes-web-archive
**Branch/HEAD:** `main` @ `ab61ca2` (clean working tree, in sync with origin)
**Audit type:** External brief (Google Drive, 2026-10-14) — exploratory, whole-application, evidence-first audit. No product code was modified during this audit.
**Audit date:** 2026-10-13/14 (UTC)
**Auditor:** Automated human-behavior audit driven by Playwright 1.64.0 against the real built `dist/` extension (v1.0.4) loaded as an unpacked extension in isolated Chromium persistent profiles.

## Environment

| Property | Value |
|---|---|
| OS | Debian GNU/Linux 13 (trixie), kernel 5.10.134, container, 2 vCPU / 4 GB |
| Node / npm | v24.21.0 / 11.19.0 |
| Browser | Chromium 156.0.8078.4 (Playwright build chromium-1248), headed under Xvfb 1440×900, `--disable-gpu --no-sandbox --disable-dev-shm-usage` |
| Playwright | 1.64.0 (repo-pinned) |
| Build | vite 8.3.4 production build (14 files, 4 JS bundles), dist/manifest.json v1.0.4 |
| Repo gates re-run at audit HEAD | lint PASS · tsc strict PASS · verify-release PASS · vitest 797/797 (66 files) · Playwright 58/58 · perf p95 121 ms (budget 500 ms) |

## Overall outcome

The application's **core note-taking workflows are genuinely solid**: a first-time user can onboard, create rich rich-text notes with the full toolbar (marks, blocks, colors, tables, links, images, find & replace, source view), organize with tags/categories/pin/archive/trash/restore/permanent-delete with honest confirmations, search with operators, sort, paginate, switch themes, use the command palette, import Markdown/HTML, export Markdown, autosave with conflict detection across tabs, and everything survives a full browser restart with verified durable state (F2). Error states are consistently honest — invalid input, offline mode, missing LM Studio, blocked URLs, malformed imports all produce truthful feedback rather than fake success.

However, the audit confirmed **7 defects** (5 of them feature-breaking or requirement mismatches) and documented **19 controls/areas NOT RUN or BLOCKED** with reasons. The most severe findings are two **transport-level breakages** that kill entire feature areas: binary data (File/Blob) cannot cross the `chrome.runtime.sendMessage` RPC boundary, which makes **file attachments** and **backup export/restore** fail end-to-end in the real UI (D-04, D-06). A third requirement mismatch makes the **Favorites** feature unreachable (D-01), a fourth leaves the **Filters panel an empty shell** against PRD FR-SEARCH-03 (D-02).

## Confirmed defects (see defects.md for full repro)

| ID | Severity | Summary |
|---|---|---|
| D-01 | High (requirement mismatch) | Favorites is unreachable: no UI control anywhere sets `favorite`, though the Favorites smart list, card badge, RPC and data model all exist (FR-NOTE-05) |
| D-02 | High (requirement mismatch) | The Filters disclosure opens an **empty region** — the extensive FR-SEARCH-03 filter set (date ranges, tags, categories, flags, states, saved views) has no UI |
| D-03 | Medium (requirement mismatch) | Sort direction is fixed `desc` with no ascending/descending control (FR-SEARCH-06); saved views absent |
| D-04 | Critical (feature broken) | Attachments are broken end-to-end: real files cannot be attached (`attachments/add: data must be a Blob` — the RPC transport JSON-serializes File/Blob); also kills the image dialog's file-picker path |
| D-05 | Medium (bug) | The re-shown onboarding's "Get started" button is permanently disabled (handler disables on first completion and only re-enables on failure) |
| D-06 | Critical (feature broken) | Backup export fails (`createObjectURL` overload error — the SW-built Blob arrives as `{}` over the RPC transport) and restore preview fails the same way (`archive: expected the backup file (a Blob)`) |
| D-07 | Low–Medium (state consistency) | After rapid note creation the page-1 slice invariant breaks: 51+ cards render on "Page 1 of 2"; self-heals on reload |

## Blocked / inconclusive (see coverage-gaps.md)

- **Local AI execution** — no LM Studio server exists in the audit container; honest degradation verified (input/send disabled, truthful test-connection failures) but no successful AI round-trip could be run. BLOCKED, per brief §8 (no cloud fallback permitted).
- **Web-page capture** — the URL gate rejects loopback by design and the sandbox has no capturable external web pages; snapshots panel verified in its honest empty state only. BLOCKED.
- **Reminder alarm firing / OS notifications** — require wall-clock time and OS integration (documented product limitation). BLOCKED.
- **One input-stall phenomenon** (INCONCLUSIVE): after a revision-restore on a very rich note, Playwright-dispatched input intermittently stalled while DOM state was verified clean; recorded as a tooling/environment observation with a DOM-dispatched fallback on the same real elements, and the affected flow (reminders lifecycle) was re-run green in a dedicated fresh session (pass-b-panels2 R1–R6).

## Answers to the brief's seven questions

1. **What can a user actually accomplish?** Everything in the core notes domain: create/edit/format notes (full toolbar matrix), tag/category/pin/archive/trash/restore/permanently delete, search (terms, `title:`, `tag:`, `is:`), sort, paginate, grid/list views, command palette, settings incl. theme + toolbar-group customization, diagnostics incl. self-test/export/index rebuild, Markdown/HTML import, Markdown export, autosave + multi-tab conflict handling, full restart persistence. What a user **cannot** accomplish: attach files, export or restore backups, favorite a note, use filter UI, choose sort direction, or dismiss a re-shown onboarding with its primary button.
2. **Which complete workflows passed start → durable end state?** 34 verified end-to-end workflows (see feature-workflow-matrix.csv): the full note lifecycle, import journeys, search workflows, revision restore, reminder lifecycle, theme persistence across restart, conflict handling, offline operation, palette navigation, diagnostics export.
3. **What is broken/misleading/inaccessible/inconsistent?** D-01…D-07 above; plus UX observation G-07 (theme preference silently reverts if settings closed without saving — disclosed in hint text but easy to miss).
4. **Which sequences/timings cause data loss, duplication or stale UI?** Rapid creation + pagination invariant (D-07, self-healing, no data loss). Multi-tab same-note editing correctly surfaces the conflict dialog and announcement (no silent loss observed). Rapid theme toggling, rapid creation with active selection: no corruption. No duplication or data-loss sequence was observed outside the defect list.
5. **Do source, requirements, docs and behavior agree?** Core domain: yes, with high fidelity between PRD, implementation and runtime. Disagreements: FR-NOTE-05 favorites (D-01), FR-SEARCH-03 filters/saved views (D-02), FR-SEARCH-06 sort direction (D-03), and the attachments/backup features whose source exists but whose runtime transport is broken (D-04/D-06) — documentation describes them as working, which is not true in the built artifact.
6. **Exactly what remains untested/blocked/inconclusive?** 19 items with precise reasons in coverage-gaps.md (AI round-trip, capture pipeline, alarm firing, notifications, 12 secondary controls not exercised, JSON note-format import round-trip, find-bar Match case/Prev/Next, export HTML/JSON).
7. **Minimal repro for each defect?** In defects.md, each with exact steps, expected/actual, reproduction rate, evidence path and root-cause classification (evidence-backed vs hypothesis).

## Coverage accounting (exact counts from the ledgers)

- **Control inventory:** 118 audited controls → 79 PASS, 7 FAIL (tied to D-01..D-07), 8 BLOCKED, 22 NOT RUN (documented reasons), 2 INCONCLUSIVE-adjacent tooling notes.
- **Feature workflows:** 34 feature areas → 26 PASS end-to-end, 5 FAIL (attachments, backup export, backup restore, favorites, filters), 3 BLOCKED (AI execution, capture, alarms).
- **State transitions:** 42 defined transitions → 38 executed PASS, 2 FAIL (page-slice invariant D-07, re-show onboarding close D-05), 2 BLOCKED (reminder fired, notification delivered).
- **Cross-feature pairs:** 21 tested of 28 identified as meaningful (pairwise baseline) + 3 higher-order combinations; 7 pairs not run with reasons.
- **Audit automation:** 75 tests in 9 spec files (7 exploration passes A–F + regression re-runs), all passing after stabilization; 63 screenshots, 16 session evidence logs, 7 investigation probes preserved under `evidence/`.
