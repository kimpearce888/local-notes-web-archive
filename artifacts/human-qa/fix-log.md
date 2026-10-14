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

---

## 2026-10-15 — fix(capture): QA-D05 + QA-D06 (phase 2, batch G discoveries)

**Defects addressed:** QA-D05 (save-page/context-menu captures never queued —
link left 'detected' while the API reported queued: true), QA-D06 (the capture
permission flow was unreachable — no UI called links/request-capture-permission,
and the SW-side request cannot work because the user gesture does not survive
the RPC hop).

**Files changed:**
- `src/background/quick-capture.ts` — attachSourceLink creates links 'queued',
  upgrades existing 'detected' links, and notifies the capture queue.
- `src/dashboard/editor/snapshots-panel.ts` — Grant access… affordance for
  permission-required links; page-level `chrome.permissions.request` inside the
  click gesture, then the RPC resume.
- `src/dashboard/state/editor-session.ts`, `src/dashboard/state/snapshot-client.ts`
  — listLinks + requestCapturePermission wiring.
- `src/dashboard/styles.css` — grant row styling.
- `src/background/permissions.ts` — incorrect gesture-propagation comment corrected.
- `tests/unit/background/context-menus.test.ts` (+1), 
  `tests/unit/dashboard/snapshots-panel.test.ts` (+2) — regression tests.
- `artifacts/human-qa/defects.md`, `artifacts/human-qa/fix-log.md` — records.

**Gates at commit time:** tsc both configs PASS; eslint PASS; vitest 905/905.
**Real-UI verification:** the FIRST end-to-end capture through the real UI:
save → queue → pipeline → link `captured`, snapshot record with PNG saved +
text saved + honest partial-MHTML reporting (screenshots/final/
e2e-capture-snapshots-panel.png + d06-grant-affordance.png, final video).

## Fix QA-D07 — Retry-capture affordance for failed links (Phase 3 discovery)

**Committed:** pending (this entry) · **Verification:** real UI + 2 regression tests

- `src/dashboard/editor/snapshots-panel.ts`: new `.snapshots-panel__retry` rows
  for links in `failed` state with a `Retry capture` button; honest inline
  status on failure; announce + auto-refresh on success.
- `src/dashboard/state/editor-session.ts`, `src/dashboard/state/snapshot-client.ts`:
  `retryCapture` wired to the previously UI-less `capture/retry` RPC.
- `src/dashboard/styles.css`: retry row styling.
- `tests/unit/dashboard/snapshots-panel.test.ts`: +2 regression tests
  (re-queue on click; hidden when nothing failed + honest failure status).
- Gates: 907/907 tests (was 905), tsc both configs, eslint clean, dist rebuilt.
- Real-UI verification (verify-d07 session, phase2h profile): failed link
  (qa-fail-host2.invalid, produced by closing the capture tab mid-flight) →
  Retry capture visible → click → re-queued → link `failed → captured` with
  snapshot; affordance gone. Screenshots `d07-retry-affordance.png`,
  `d07-after-retry.png`.
