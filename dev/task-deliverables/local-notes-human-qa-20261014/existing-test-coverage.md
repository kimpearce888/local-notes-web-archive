# Existing Test Coverage — what the repository's tests prove, and what they do not

The repository ships 797 vitest tests (66 files), 1 perf test and 58 Playwright E2E tests (6 files). This mapping was built by reading every spec's assertions (test names listed via the runners' own `--list`) and comparing them against the discovered control/feature inventory. It explains WHY the audit's headline defects were not caught by the existing suite.

## Per-feature mapping

| Feature | Existing automated coverage | What it proves | What it does NOT prove |
|---|---|---|---|
| Notes CRUD + editor | `tests/unit/editor/*` (editor, toolbar-groups, markdown, find-replace, sanitize, local-image, note-transfer); e2e `extension.spec` (create/edit bold/heading/list/link) | Mark/block commands apply; toolbar groups render per settings; sanitization; MD round-trip at unit level; one real-browser happy path | Did not exercise EVERY toolbar control in a real browser (audit E1–E4 adds that); no real-browser coverage of colors/tables/code-block/hr/task-list |
| Autosave/revisions/conflict | `editor.test`, `recovery.test`, `revisions` units; e2e autosave assertions | Debounce + revision records + recovery journal logic | Multi-tab conflict dialog in a real browser (audit X3 adds); background-trash save (X4) |
| Tags/categories | repo units + `user-report-regressions` card-order e2e | Assignment + card chip rendering + reading order | Bulk-dialog cancel paths at e2e level (audit C1/D3 add) |
| Pin/favorite/archive/trash/restore | units for set-flags; e2e pin/archive/trash happy paths | Pin works end-to-end; archive/trash/restore work | **Favorite has NO test anywhere exercising a UI control — because none exists (D-01). The smart-list render is unit-tested with seeded data, which masked the reachability gap.** |
| Search | `search-engine` units (huge), perf suite, e2e search assertions | Engine operators/scoring/p95 budget; e2e term search | Filter-panel UI (nothing to test — D-02); sort direction UI (D-03) |
| Shell/navigation | `shell.test`, `command-palette.test`, e2e navigation sweep | DOM order, shortcuts, palette semantics | Filters-region emptiness (never asserted to HAVE content — the `hidden` toggle alone was tested, which is why T-056/T-057 passed while the region stayed empty) |
| Bulk bar | `bulk-bar.test` units | Action union rendering per view | Cancel-then-confirm of every destructive action in real browser (audit D3 adds) |
| Pagination | store/controller units with fake data | Page math | **Rapid-creation slice invariant (D-07): the optimistic prepend is unit-tested in isolation, so the invariant break only manifests at >50 notes in a real session — untested before** |
| Attachments | `attachments-panel.test` + background `attachments` units with INJECTED transports | Panel rendering; per-row action wiring; background validation incl. the Blob guard | **The real chrome.runtime.sendMessage transport never carries a File in ANY test — fake transports preserve objects, which is exactly why D-04 shipped. The `data instanceof Blob` guard was unit-tested with real Blobs.** |
| Backup | `export.test`/`restore.test` + settings units | Archive building/parsing/validation logic | **Same transport blind spot (D-06): createObjectURL on the real returned payload never executed** |
| Reminders | `reminders-panel.test`, engine units (DST, recurrence), e2e dialog-field heights | Validation messages, preview engine, alarm reconciliation logic | Real-browser lifecycle (audit R1–R6 adds); alarm firing (environment-blocked for everyone) |
| Import/export notes | `note-transfer.test` (parse/sanitize), e2e MD export | Parser honesty incl. malformed JSON | md/html import through the real sidebar picker (audit C2 adds); HTML/JSON export e2e |
| Settings/theme | `settings-panel.test`, `theme` units, e2e theme persistence | Radio wiring; persistence contract | Toolbar-group live effect in real browser (audit P7 adds); onboarding re-show (D-05 — the disabled-button state was never re-presented in any test) |
| Diagnostics | `diagnostics-api.test` + panel units | API shape; self-test logic | Full real-browser sweep incl. export download (audit P9 adds) |
| Security/sanitization | `sanitize.test`, hygiene units, e2e XSS/clipboard/tracking-image/javascript-URL | Strong and real | — (audit confirms) |
| Zip/release | zip-acceptance 4 e2e, verify-release gate | Artifact integrity | — (re-run green at audit HEAD) |

## The systemic pattern behind the audit's critical findings

1. **Transport blind spot (D-04, D-06):** every unit test injects a fake RPC transport that passes objects by reference; the two production transports that must carry binary data (`chrome.runtime.sendMessage` both ways) were never exercised with a real File/Blob in any automated test. The guards on both sides were individually unit-tested green — the seam between them was not.
2. **UI-reachability blind spot (D-01, D-02):** components are tested with seeded data (Favorites list renders favorite notes; filtersRegion toggles hidden). No test asserts that a HUMAN can produce the preconditions through visible controls. The audit's B3/A6 probes test reachability by construction.
3. **State-slice blind spot (D-07):** controller optimistic-append is unit-tested below the page size; the invariant only breaks in a real session above 50 notes.
4. **Re-presentation blind spot (D-05):** onboarding completion is tested once per fresh mount; the persistent-DOM re-show case was never driven.

## Honest accounting

- Of the 7 audit defects, **0 are covered by failing tests** — all 797/58 pass. 4 of the 7 (D-01, D-02, D-03, D-07) are invisible to the current suite by construction; 2 (D-04, D-06) live in an untested seam; 1 (D-05) is an untested re-presentation path.
- The repo suite remains genuinely strong for what it does cover (engine correctness, sanitization, RPC validation, keyboard/a11y, persistence) — the audit re-ran it fully green at the audit HEAD.
