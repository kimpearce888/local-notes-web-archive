# defects.md — Human-QA defect ledger

Continuously maintained per ai/qa-instructions.md §12. IDs: QA-Dxx. Status:
OPEN → INVESTIGATING → FIXED (regression-verified) / DOCUMENTED (limitation).
Every entry links evidence and the regression tests that pin the fix.

---

## QA-D01 — Exclusion-only search queries return zero results

- **Status:** FIXED (regression-verified against the repaired build through the real UI)
- **Affected feature/action:** Search / inventory rows "Operator -term exclusion",
  "Unknown operator / malformed query honest error" (Search feature area)
- **Discovered:** phase2b-search-filters-sort session (2026-10-14), real-UI test run
- **Reproduction steps:**
  1. Create 4 notes, one containing the word "sourdough".
  2. Type `-sourdough` in the search box.
- **Initial state:** ≥2 notes, at least one matching the excluded term.
- **Expected:** All notes NOT containing "sourdough" (3 of 4) — "-term" is
  documented FR-SEARCH-04 syntax; a lone exclusion means "everything except…".
- **Actual:** 0 results. The list silently empties.
- **Reproducible:** Deterministic.
- **Baseline evidence:** session log `logs/session-phase2b-search-filters-*.json`;
  result row in `scripts/qa/results-phase2b.json` ("Operator -term exclusion → 0 (expected 3)").
- **Root cause (confirmed):** `src/core/search/engine.ts` `textSearch()` — the
  include-terms loop is the only place that initializes the result-id set; with an
  exclusion-only query it never runs, `ids` stays `null`, the exclusion loop
  no-ops (`ids?.delete`), and the trailing `ids === null` guard returns an empty
  map with a misleading error ("query has terms but the index is empty").
- **Files changed:** `src/core/search/engine.ts`
- **Repair:** When the query has no include terms but has exclusions, initialize
  the candidate set from the full indexed corpus before subtracting exclusions.
  The misleading error message was also corrected ("the query has no searchable
  terms") — it now only fires for genuinely unsearchable queries (e.g. `""`).
- **Regression tests:** `tests/unit/core/search.test.ts` —
  "a lone exclusion returns every note that does not match",
  "a lone phrase exclusion narrows the full corpus",
  "mixed queries still subtract exclusions from matches";
  `tests/unit/dashboard/controller.test.ts` —
  "exclusion-only queries return the non-matching notes (QA-D01, FR-SEARCH-04)".
- **Final verification (real UI, repaired build):** `scripts/qa/verify-defects-d01-d02.mjs`
  → `VERIFIED_FIXED`: `-sourdough` returns 3 cards `[Delta | Gamma | Alpha]`.
  Evidence: `screenshots/final/d01-fixed-exclusion-only-search.png`,
  session log `logs/session-verify-d01-d02-*.json`, final-build video.
- **Related:** QA-D02 (same session, same feature area).

---

## QA-D02 — Query syntax errors never surface in the UI (FR-SEARCH-04 violation)

- **Status:** FIXED (regression-verified against the repaired build through the real UI)
- **Affected feature/action:** Search / inventory row "Unknown operator / malformed
  query honest error"; PRD FR-SEARCH-04 ("Invalid syntax must produce an inline
  explanation, not silently change the query").
- **Discovered:** phase2b-search-filters-sort session (2026-10-14), real-UI test run
- **Reproduction steps:**
  1. Have at least one note.
  2. Type `is:zebra` (a known operator key with an invalid value) in the search box.
- **Expected:** Results (or no-results state) PLUS an inline explanation that
  `is:zebra` is invalid syntax; the `SearchResult.queryErrors` field exists
  precisely "for inline display (FR-SEARCH-04)" per its type declaration.
- **Actual:** Only "No matching notes". The dashboard never reads
  `queryErrors` — the RPC returns it and the controller drops it.
- **Reproducible:** Deterministic.
- **Baseline evidence:** session log `logs/session-phase2b-search-filters-*.json`;
  result row in `scripts/qa/results-phase2b.json` ("bogus:xyz → error surfaced: false").
  Note: `bogus:xyz` (unknown colon-key) is intentionally treated as a literal
  search term so URLs and times stay searchable; the genuine syntax-error
  repro is `is:zebra` / `tag:` / `is:-pinned`.
- **Root cause (confirmed):** `src/dashboard/state/controller.ts` `requery()`
  consumed only `result.hits`/`result.total`; `queryErrors` was never stored or
  rendered. The store had no field for it.
- **Files changed:** `src/dashboard/state/store.ts` (new `queryErrors` state field),
  `src/dashboard/state/controller.ts` (store + render inline notice above the
  results/empty state, cleared with the query), `src/dashboard/styles.css`
  (`.results__query-note` styling).
- **Repair:** `requery()` stores `queryErrors`; `render()` prepends a
  `role="status"` notice ("Search syntax: …") in both the results and
  no-results paths; clearing the query clears the notice.
- **Regression tests:** `tests/unit/dashboard/controller.test.ts` —
  "renders query syntax errors inline instead of silently ignoring them
  (QA-D02, FR-SEARCH-04)" (asserts the notice, its content, and its removal).
- **Final verification (real UI, repaired build):** `scripts/qa/verify-defects-d01-d02.mjs`
  → `VERIFIED_FIXED`: `is:zebra` shows "Search syntax: is:zebra is unknown
  (expected pinned, favorite, archived, trashed or overdue)." and clearing the
  query removes it. Evidence: `screenshots/final/d02-fixed-inline-query-error.png`,
  session log `logs/session-verify-d01-d02-*.json`, final-build video.
- **Related:** QA-D01.

---

## Documented limitations (investigated, not defects)

- **L01 — Multi-word phrase exclusion `-"a b"` is not tokenizable.** The
  tokenizer splits at whitespace before the quote logic runs, so `-"saved copy"`
  becomes two tokens. Single-word phrase exclusion `-"saved"` works. The PRD
  documents "quoted phrases, exclusions (-term)" as separate constructs —
  phrase exclusion across multiple words is undocumented and behaves as
  separate term tokens. Recorded as a syntax limitation, not repaired
  (extending the tokenizer would be feature work beyond the QA mandate).
- **L02 — Unknown colon-keys fall through as literal terms.** `bogus:xyz` is
  searched as a literal word (no error). This is intentional: erroring would
  break searching for URLs, times ("12:30") and other colon-containing text.
- **L03 — Card-level pin/favorite toggles do not exist.** Cards show Pinned/
  Favorite as non-interactive badges; toggling happens via the bulk bar, the
  editor session header and the command palette. Inventory row corrected to
  NOT_APPLICABLE (display verified as part of card rendering).

---

## QA-D03 — Saved settings do not reach the live session (toolbar groups stale until reload)

- **Status:** FIXED (regression-verified against the repaired build through the real UI)
- **Affected feature/action:** Settings / inventory row "Toolbar-group visibility
  checkboxes (9 groups)"; any store-backed setting consumed mid-session.
- **Discovered:** phase2f-toolbar-media session (2026-10-14): uncheck "tools"
  toolbar group → Save changes → open a note → the tools buttons were still there.
- **Reproduction steps:**
  1. Open Settings → Editor toolbar → uncheck a group (e.g. tools) → Save changes.
  2. Open any note in the SAME session (no page reload).
- **Expected:** The saved preference applies to the session immediately — the
  source comment in `src/dashboard/index.ts` even states "a saved patch re-loads
  the controller state".
- **Actual:** The controller store's settings snapshot is never refreshed by the
  settings-dialog save flow, so editor sessions created afterwards read the stale
  initial-load settings. The preference only applies after a manual page reload.
- **Reproducible:** Deterministic.
- **Baseline evidence:** session log `logs/session-phase2f-toolbar-media-*.json`
  (result row "Toolbar-group visibility checkboxes: tools group hidden ... false");
  the earlier phase2f run's screenshot evidence.
- **Root cause (confirmed):** `createSettingsPanel`'s `patchSettings` callback
  (src/dashboard/index.ts) performed the `settings/patch` RPC and returned —
  nothing refreshed the controller store. `controller.refresh()` (which does
  reload settings) is only wired to diagnostics/save-page/error-retry flows.
- **Files changed:** `src/dashboard/state/controller.ts` (new public
  `refreshSettings()` — settings-only reload, no loading flash, no requery),
  `src/dashboard/index.ts` (patchSettings now calls it after a successful patch).
- **Repair:** A saved patch now re-reads settings into the store (and re-applies
  the theme preference) immediately; a failed re-read keeps the previous snapshot
  and leaves honest reporting to the next full refresh.
- **Regression tests:** `tests/unit/dashboard/controller.test.ts` —
  "refreshSettings picks up a saved patch without a loading flash" (real
  settings/patch RPC through the real router; asserts store pickup AND that the
  results region never flashes loading).
- **Final verification (real UI, repaired build):** phase2f re-run →
  "Toolbar-group visibility checkboxes (9 groups)" PASSED: tools group hidden in
  a new session after uncheck+save (screenshot `screenshots/baseline/p2f-04-tools-group-hidden.png`).

---

## QA-D04 — Image dialog drops Alt text / Caption typed after picking the file

- **Status:** FIXED (regression-verified against the repaired build through the real UI)
- **Affected feature/action:** Editor media / inventory rows "Insert image from
  file (+HEIC)" and "Alt text + caption fields".
- **Discovered:** phase2f-toolbar-media session (2026-10-14): alt attribute came
  back as the filename default ("qa-image") although the Alt text field had been
  filled with "A tiny test square" before pressing Insert.
- **Reproduction steps:**
  1. Toolbar → Insert image with alt text.
  2. Choose a picture.
  3. Type alt text / caption in the dialog.
  4. Observe: the dialog already closed at step 2 — the image was inserted with
     the filename-stem default alt and empty caption; everything typed at step 3
     is silently dropped.
- **Expected:** The dialog's labeled fields are usable after choosing the
  picture; the insert honors them.
- **Actual:** The file-input `change` handler inserted immediately and closed
  the dialog, reading `altInput.value`/`captionInput.value` at a moment when
  they were necessarily empty (unless pre-filled before picking).
- **Reproducible:** Deterministic.
- **Baseline evidence:** session log `logs/session-phase2f-toolbar-media-*.json`
  (result row "Alt text + caption fields -> alt set: false"; console line
  `[image] actual alt attribute: "qa-image"`).
- **Root cause (confirmed):** `src/dashboard/editor/editor-panel.ts`
  `insertImageDialog` — insert-on-change flow with dialog.close() in the change
  handler.
- **Files changed:** `src/dashboard/editor/editor-panel.ts` (same file).
- **Repair:** The file is now STAGED on change (dialog stays open with a
  role=status line "Ready to insert <name>…"); a new primary "Insert image"
  button performs the insert and honors the alt/caption values at press time;
  the flow keeps Cancel and Choose picture… actions.
- **Regression tests:** real-UI re-execution (below). The dialog is DOM-level
  (jsdom coverage of this panel is not part of the existing unit harness);
  the E2E human-simulation suite exercises the insert-image pipeline.
- **Final verification (real UI, repaired build):** phase2f re-run →
  "Alt text + caption fields" PASSED: `alt="A tiny test square"`, caption
  element present (screenshot `screenshots/baseline/p2f-03-image-inserted.png`).

---

## QA-D05 — "Save a web page…" never actually queues the capture (dishonest queued: true)

- **Status:** FIXED (regression-verified against the repaired build through the real UI)
- **Affected feature/action:** Capture / inventory rows "Save valid http(s) URL",
  "Capture failure honest reporting"; Entry points (context-menu captures use the
  same function); the core web-archive promise.
- **Discovered:** phase2g-capture-persistence session (2026-10-14): after saving
  https://example.com via the dialog, the link sat in state `detected` and the
  snapshots panel stayed empty forever; the RPC response still reported
  `queued: true`.
- **Reproduction steps:**
  1. "Save a web page…" → https://example.com → Save page.
  2. Open the note → Snapshots panel.
- **Expected:** The link is queued and the capture pipeline runs (the dialog copy:
  "a complete offline copy is captured automatically").
- **Actual:** `attachSourceLink` called `createLink` with the DEFAULT state
  `'detected'` — never queued, never notified — so no capture ever ran, while the
  API reported queued: true.
- **Reproducible:** Deterministic.
- **Baseline evidence:** probe-linkstate session (`[t+25s] links: [{"state":"detected"}]`
  pre-fix), logs/session-phase2g-*.json.
- **Root cause (confirmed):** `src/background/quick-capture.ts` — direct
  `createLink(...)` bypassed the links API's queue notification AND used the
  default 'detected' state.
- **Files changed:** `src/background/quick-capture.ts` — `attachSourceLink` now
  creates the link with captureState `'queued'`, upgrades an existing
  `'detected'` link to queued (explicit user intent), and fires
  `notifyLinkQueued` so the pipeline starts immediately.
- **Regression tests:** `tests/unit/background/context-menus.test.ts` —
  "saveCurrentPageAsNote creates the link queued and notifies the capture queue"
  (asserts state + notification).
- **Final verification (real UI, repaired build):** save → link state
  `captured` within seconds; snapshot record with PNG saved + text saved;
  MHTML honestly "failed" (environment CDP quirk) with the panel reporting
  "partial — Page copy failed · Screenshot saved · Text saved · 1 warning".
  Evidence: `screenshots/final/e2e-capture-snapshots-panel.png`, final video,
  `scripts/qa/results-verify-d05-d06.json`.

---

## QA-D06 — The capture permission flow is unreachable (no UI ever calls it)

- **Status:** FIXED (regression-verified; full grant prompt is an automation
  limitation — see below)
- **Affected feature/action:** Every capture of a not-yet-granted origin; PRD
  FR-CAP-02; the entire "web archive" feature on fresh installs.
- **Discovered:** phase2g session + direct IndexedDB inspection: links stuck in
  `permission-required` forever; `grep` showed ZERO call sites of
  `links/request-capture-permission` anywhere in the dashboard.
- **Reproduction steps:**
  1. "Save a web page…" for any origin (pre-fix: also after QA-D05 fix).
  2. The capture pipeline stops at `permission-required`.
  3. No button, dialog or setting anywhere lets the user grant access — the
     RPC exists with full grant+resume logic but nothing invokes it.
- **Expected:** An affordance to grant the origin permission and resume the capture.
- **Actual:** Dead RPC; captures permanently stalled; the "Granted site access"
  list in Settings could never grow.
- **Reproducible:** Deterministic.
- **Root cause (confirmed):** the flow was designed (RPC + FR-CAP-02 transitions)
  but never wired into any view. Additionally — and this is WHY it likely stayed
  unwired — `chrome.permissions.request` called from the service worker behind
  the RPC fails with "This function must be called during a user gesture":
  the gesture does NOT survive the RPC hop (verified through the real UI),
  contradicting the comment in `src/background/permissions.ts`.
- **Files changed:**
  - `src/dashboard/editor/snapshots-panel.ts` — a Grant access… affordance for
    links in `permission-required` state; the click handler performs
    `chrome.permissions.request` DIRECTLY in the dashboard page (user-gesture
    context), then calls the RPC which re-checks and resumes the capture.
  - `src/dashboard/state/editor-session.ts` + `src/dashboard/state/snapshot-client.ts`
    — `listLinks` + `requestCapturePermission` wiring.
  - `src/dashboard/styles.css` — grant row styling.
  - `src/background/permissions.ts` — the incorrect gesture-propagation comment
    corrected (honesty).
- **Regression tests:** `tests/unit/dashboard/snapshots-panel.test.ts` —
  "shows Grant access for a permission-required link and requests the permission
  on click" + "hides the affordance when no link is waiting".
- **Final verification (real UI, repaired build):**
  - Grant affordance renders ("Capture waiting for access to https://example.com.
    Grant access…") — screenshot `screenshots/final/d06-grant-affordance.png`.
  - The page-level permission request is correct product code; completing the
    Chrome NATIVE permission prompt cannot be automated (the prompt lives in
    browser chrome, outside web content — Playwright cannot click it; the
    request promise hangs). **Documented environmental limitation.**
  - End-to-end completion verified by pre-seeding the profile's granted
    optional-host permission (Chromium Preferences `granted_permissions` +
    `active_permissions` explicit_host) — the standard automation-equivalent of
    the user clicking Allow: the capture then ran through the REAL pipeline to
    `captured` with PNG + text artifacts (see QA-D05 verification).

---

## Environmental limitations (honest disclosure)

- **L04 — Chrome's native permission prompt cannot be answered by automation.**
  `chrome.permissions.request` shows browser-chrome UI outside web content.
  The grant flow's product code is verified (affordance renders, page-level
  request in the gesture context, RPC resume path unit-tested); full-prompt
  completion is verified via profile pre-seeding (the automation equivalent of
  the user clicking Allow).
- **L05 — MHTML Page.captureSnapshot returns a failure in this sandbox**
  (screenshot PNG + text extraction succeed; the app reports the partial
  state honestly: "Page copy failed · Screenshot saved · Text saved"). The
  MHTML artifact path is covered by unit tests (capture-steps/capture-cdp) with
  injected drivers.
- **L06 — Alt+Shift+N / Alt+Shift+C browser-command dispatch did not fire via
  CDP keyboard events** (phase2g: no note created). The commands are registered
  in the manifest; the handler paths are unit-covered; physical keyboard
  verification is not possible in this environment.
