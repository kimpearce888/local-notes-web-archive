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
