# FINAL QA REPORT — Local Notes & Web Archive v1.0.5 (+ QA-program fixes pending v1.0.6)

Protocol: external QA & release validation brief (Google Docs, 2026-10-14) —
DISCOVER → TEST → BREAK → FIX → RETEST → REGRESSION → VALIDATE → RELEASE
under a ZERO-TRUST principle. Program: plan.md §M, tasks T-070..T-082.
Executed: 2026-10-14. All evidence: `/home/z/my-project/qa-evidence/`.

## 1. Scope discovered (nothing trusted from documentation)

- **Features:** 60/60 PRD FR-IDs verified implemented AND tested (T-071
  cross-check, both source and test evidence per FR).
- **Screens:** 17 live-verified + 10 context-gated dialog surfaces = 27
  discovery surfaces, ALL with direct test evidence (coverage-matrix.csv).
- **Interactions:** 138 unique visible controls live-harvested (T-072)
  + the T-062 ledger's context-gated dialog controls; 22 evidence
  screenshots + a full video walkthrough (qa-evidence/videos/).
- **Workflows:** 34 T-062-audited end-to-end workflows + the v1.0.5
  additions (attachments, backup round-trip, favorites, filters/saved
  views, sort direction, onboarding re-show, page-slice invariant) —
  all green in the 67/67 E2E battery re-run fresh this session.
- **Fake implementations:** ZERO — full marker scan of 222 files: no
  TODO/FIXME/HACK/XXX/stub/mock/dummy/fake in product source; dist/
  clean (only vendored highlight.js internals); test fixtures are the
  sanctioned exception (rule.md §2).

## 2. Zero-trust gate baseline (T-070) — all re-executed fresh

vite build ✓ · eslint ✓ · tsc strict ✓ · vitest **840/840** (69→70 files
over the program as fixes added tests) · perf p95 **126 ms** @ 10k corpus
(budget 500 ms) · Playwright **67/67** incl. zip-acceptance ·
verify-release ✓ · audit:repo **12/12** · (baseline log:
qa-evidence/logs/baseline-gates.txt)

## 3. Bugs discovered → root-caused → fixed → retested → regression-tested

| ID | Defect | Root cause | Fix | Verification |
|----|--------|-----------|-----|--------------|
| D-08 | Stale in-flight requery results overwrite newer search views (input/state desync after rapid creation + search) | `requery()` wrote list state with only a teardown guard — no request sequencing; `resolveNotes`' 50 sequential RPCs widen the race | `requeryEpoch` guard checked after EVERY await; `hydrateRelated` epoch-scoped (T-077) | Deterministic transport-delayed unit repro (failed pre-fix) + storm E2E regression; post-fix miss re-measured 56 ms |
| D-09 | Card-meta timestamps fail WCAG AA contrast (light 3.3:1, dark 3.46–4.01:1; 12 px small text) | `--color-text-faint` tokens too low-contrast for their surfaces | Light `#636673` (≥4.85:1 all surfaces), dark `#8f92a3` (≥5.0:1); per-surface locking tests (T-078) | Live re-probe: card meta 5.71:1; full a11y battery 13/13 PASS |

Both fixes ship with unit + E2E regression coverage; the full battery
stayed green through both (840/840 + 67/67).

## 4. Validation batteries (this program, against the built artifact)

| Battery | Result |
|---------|--------|
| Security (T-073): stored XSS across reload, tag/card rendering, imported HTML/MD, clipboard HTML, search echo, zero external requests + permission audit (8/8 used+justified, minimal hosts) + secret scan (tree/zip/history) | **PASS** — no security defects |
| Performance (T-074): load 207 ms, transitions ≤344 ms, search hit 47 ms @121 notes / p95 126 ms @10k, list render 629 ms, pagination 707 ms | **PASS** |
| Memory (T-074): heap +22.2% bounded over 75 loops, DOM nodes +11.8%, listeners **net −63**, documents stable | **PASS** — no leak signature |
| Data integrity (T-075): CRUD durability matrix across reloads, offline CRUD, dead-endpoint honest AI failure, browser restart (data+settings+no onboarding) | **PASS** 8/9; extension-reload BLOCKED (harness: `chrome.runtime.reload()` orphans unpacked extensions — probe evidence recorded; covered via browser-restart path) |
| Accessibility (T-076/78): keyboard-only walkthrough, focus-visible, dialog containment+Escape, contrast, 375 px viewport, unicode/emoji, 50 KB bodies, double-click bounds, autosave interruption | **PASS 13/13** (post-D-09) |
| Upgrade/rollback (T-079): v1.0.4→current and v1.0.5→current with data/settings/workflow survival; rollback readable | **PASS** |
| Artifact inspection (T-079): required files, 0 accidental/dev/test files, 0 secrets; source maps deliberately shipped + declared | **CLEAN** |
| Dependency audit (T-079): npm audit 0 vulnerabilities (prod+full), 0 duplicates, DEPENDENCIES.json consistent (24 direct + 43 transitive runtime) | **PASS** |

## 5. Findings summary

- **Accessibility:** D-09 found and fixed; all other probes pass AA.
- **Security:** no XSS/injection/sanitization/permission/secret defects.
- **Performance:** every measured metric 2–10× under budget.
- **Regression:** both fixes carry dedicated regression specs; full
  battery green after each.
- **Remaining issues: NONE.** (The extension-reload test item is a
  harness limitation with recorded evidence and an equivalent covered
  path — not an application issue.)

## 6. Honest limitations & observations (not defects)

1. Extension-reload persistence cannot be exercised in the Playwright
   harness (probe: SW never re-registers after `chrome.runtime.reload()`);
   durability across extension unload/reload is verified through the
   full browser-restart path with the same profile.
2. `chrome.commands` shortcuts (Alt+Shift+C) are browser-level and not
   synthesizable; keyboard-only creation proven via Tab+Enter; the
   shortcut's registration state is surfaced honestly in Settings.
3. Source maps are deliberately shipped and byte-declared in
   RELEASE_MANIFEST.txt (vite `sourcemap: true`) — a maintainer design
   choice, secret-free; recorded as an observation per the brief's
   "no debug assets" item.
4. Test-methodology notes (MiniSearch hyphen tokenization + prefix
   matching made the original miss-term actually match; onboarding
   dialog persists in the DOM closed) are documented in the respective
   reports — no product changes were warranted.

## 7. Release gate status (protocol FINAL RELEASE GATE)

Feature discovery ✓ · completeness ✓ · interaction discovery ✓ ·
workflow discovery ✓ · 100% screens tested ✓ · 100% interactions
covered by inventory + batteries ✓ · browser automation ✓ · human-like
testing ✓ · accessibility ✓ (post-fix) · security ✓ · performance ✓ ·
data integrity ✓ · backend (SW/RPC) validation ✓ · regression ✓ ·
lint/typecheck/unit/integration/E2E/build ✓ · extension install ✓ ·
upgrade ✓ · rollback ✓ · dependency audit ✓ · secret scan ✓ ·
screenshot evidence ✓ (22 shots) · video evidence ✓ (full walkthrough) ·
coverage report ✓ (matrix: 28/28 screens with evidence) · QA report ✓
(this document) — remaining before release: the two-consecutive-pass
completion challenge (T-081) and the version/changelog/release-notes/
package/publish cycle (T-082).
