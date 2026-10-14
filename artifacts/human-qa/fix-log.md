# fix-log.md — traceable record of QA code changes

One entry per repair; each entry lists the defects addressed, files changed,
and the tests confirming the change (per ai/qa-instructions.md §12/§13).

---

## 2026-10-15 — fix(search): QA-D01 + QA-D02 (phase 2, batch B discoveries)

**Commit:** `fix(search): ...` (see git log; same commit as this file entry)

**Defects addressed:** QA-D01 (exclusion-only queries returned zero results),
QA-D02 (query syntax errors never surfaced — FR-SEARCH-04 violation).

**Files changed:**
- `src/core/search/engine.ts` — exclusion-only queries now start from the full
  indexed corpus before subtracting exclusions; misleading "index is empty"
  error replaced with the accurate "the query has no searchable terms".
- `src/dashboard/state/store.ts` — new `queryErrors: readonly string[]` state
  field (initial `[]`).
- `src/dashboard/state/controller.ts` — `requery()` stores
  `result.queryErrors` (cleared on failure); `render()` prepends a
  `role="status"` inline notice in both the results and no-results paths.
- `src/dashboard/styles.css` — `.results__query-note` notice styling.
- `tests/unit/core/search.test.ts` — 3 new exclusion-semantics regression tests.
- `tests/unit/dashboard/controller.test.ts` — 2 new real-channel regression
  tests (inline notice + exclusion-only results).
- `artifacts/human-qa/defects.md`, `artifacts/human-qa/fix-log.md` — records.

**Gates at commit time:** `tsc --noEmit` both configs PASS; `eslint .` PASS;
`vitest run` 901/901 PASS (5 new). Rebuilt `dist/` and re-executed the original
failing interactions through the real UI: both VERIFIED_FIXED
(`scripts/qa/verify-defects-d01-d02.mjs`, final evidence under
`artifacts/human-qa/screenshots/final/` + final-build video).

---

## 2026-10-15 — fix(settings/editor): QA-D03 + QA-D04 (phase 2, batch F discoveries)

**Defects addressed:** QA-D03 (saved settings never reached the live session —
toolbar-group preferences stale until page reload), QA-D04 (image dialog
inserted on file-pick and closed, silently dropping Alt text / Caption typed
afterwards).

**Files changed:**
- `src/dashboard/state/controller.ts` — new public `refreshSettings()`
  (settings-only store reload; no loading flash, no requery).
- `src/dashboard/index.ts` — the settings panel's `patchSettings` now calls
  `controller.refreshSettings()` after a successful patch.
- `src/dashboard/editor/editor-panel.ts` — image dialog: file is staged on
  change with a role=status "Ready to insert …" line; new primary "Insert
  image" button applies alt/caption at press time; Cancel and Choose picture…
  retained.
- `tests/unit/dashboard/controller.test.ts` — QA-D03 regression test
  (real settings/patch RPC; store pickup asserted; no loading flash).
- `artifacts/human-qa/defects.md`, `artifacts/human-qa/fix-log.md` — records.

**Gates at commit time:** `tsc --noEmit` both configs PASS; `eslint .` PASS;
`vitest run` 902/902 PASS. Rebuilt `dist/` and re-executed the original failing
interactions through the real UI: both VERIFIED_FIXED (phase2f re-run 27/27 —
toolbar group hidden after save without reload; image alt reads the filled
text).
