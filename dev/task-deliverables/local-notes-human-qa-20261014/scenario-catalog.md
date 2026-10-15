# Scenario Catalog — T-062 Universal Human-Behavior QA Audit

Every scenario below was derived from the discovered application inventory (application-map.md, control-inventory.csv), executed against the real built extension through the real UI only (no RPC/DB shortcuts), and recorded with evidence. IDs map to the audit specs preserved under `evidence/` (spec sources: `/home/z/my-project/qa-audit/specs/`).

## Pass A — Unscripted discovery (pass-a-discovery)

| ID | Scenario | Preconditions | Expected postcondition | Status |
|---|---|---|---|---|
| A1 | First run presents itself honestly | Fresh isolated profile | Onboarding visible, both exits enabled | PASS |
| A2 | "Open Settings first" promise | Onboarding open | Settings dialog opens; closable | PASS |
| A3 | Empty library honesty | Onboarding dismissed | All 7 smart lists render honest empty states | PASS |
| A4 | First search on empty library | Empty library | Zero cards, no error; clearing restores | PASS |
| A5 | First note end-to-end | Empty library | Note durable and listed | PASS |
| A6 | Dead-end probe of primary controls | 1 note | Import/Settings/Diagnostics/Filters/palette all answer | PASS (Filters answered with an empty region — D-02) |
| A7 | Session hygiene | — | 0 page errors / console errors / external requests | PASS |

## Pass B — Systematic screen & control sweep

### Shell (pass-b-shell)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| B1 | Seed 3 notes via real UI | All listed | PASS |
| B2 | Pinned/Archived lists with data | Correct filtering | PASS |
| B3 | Favorites reachable? | Some control can favorite | **FAIL (D-01)** — enumerated card/bulk/editor controls; none exists |
| B4 | Search: term / no-results / invalid operator / clearing | Correct states each | PASS |
| B5 | Filters disclosure with data | Filter controls present | **FAIL (D-02)** — region has 0 children; active-filters chips never populate |
| B6 | All sort orders | Honest reordering | PASS with D-03 (direction fixed desc) |
| B7 | Grid/List toggle | Cards render both | PASS |
| B8 | Pagination at 51 notes: pages, prev/next, select-page | 50/1 split; exact selection | PASS with D-07 (page-1 overflow pre-reload) |
| B9 | Palette command sweep | Trash/All/Settings/Diagnostics activate | PASS |
| B10 | Hygiene | clean session | PASS |

### Editor (pass-b-editor)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| E1 | Marks matrix (keys + buttons) | strong/em/u/s/code/sup/sub in DOM | PASS |
| E2 | Blocks matrix (H1/para/quote/code/hr/bullet/task) | all nodes present | PASS |
| E3 | Color + highlight swatches | styled spans | PASS |
| E4 | Table insert + row + col | table grows | PASS |
| E5 | Link dialog: valid / javascript: / cancel | applied / refused / no-op | PASS |
| E6 | Image via data-URL + alt + caption | img node durable | PASS |
| E7 | Find & replace-all | replaced + saved + bar closes | PASS |
| E8 | HTML source toggle | source ↔ editor | PASS |
| E9 | Export MD | real download with marker | PASS |
| E10 | Panel toggles ×5, pin/unpin, trash-cancel | all respond; cancel safe | PASS |
| E11 | Long/unicode/emoji title+subtitle | persists; no overflow | PASS |
| E12 | Hygiene | clean | PASS |

### Panels & dialogs (pass-b-panels, pass-b-panels2)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| P1 | Attach real file | attachment listed | **FAIL (D-04)** — 'data must be a Blob' |
| P2 | Download attachment bytes | real bytes | BLOCKED (D-04 leaves no input) |
| P3 | 3 revisions → restore older | rollback durable | PASS |
| P4 | Reminders lifecycle in rich-note session | full lifecycle | INCONCLUSIVE (input stall — tooling; documented) |
| P5 | Snapshots honest empty state | guidance text | PASS |
| P6 | AI unavailability honesty | input/send disabled | PASS |
| P7 | Theme live + toolbar-group live effect | dark applies; Undo disappears | PASS |
| P8 | Test connection honesty + onboarding re-show | truthful failure; re-show works | PASS + **FAIL (D-05)** on re-show dismissal |
| P9 | Diagnostics full sweep | all sections/actions honest | PASS |
| R1–R6 | Reminder lifecycle in fresh session: disabled-while-invalid, cleared-date error, valid create, edit-cancel, snooze-cancel, delete cancel+confirm, Feb-30 | exact inline errors; state changes only on confirm | PASS |

## Pass C — End-to-end workflows (pass-c-workflows)

| ID | Scenario | Expected durable end state | Status |
|---|---|---|---|
| C1 | Full lifecycle: create→tag→category→pin→archive→restore→trash→restore→permanent delete | every intermediate verified | PASS |
| C2 | Import .md and .html | notes created, opened, content verified, durable | PASS |
| C3 | Import malformed JSON | honest failure; library intact | PASS |
| C4 | Backup export + restore | backup file; restored state | **FAIL (D-06)** both directions |
| C5 | Search operators over real library | correct results | PASS |
| C6 | Hygiene | clean | PASS |

## Pass D — Boundary/invalid/cancel/failure (pass-d-boundaries)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| D1 | Whitespace-only title/body | honest Untitled | PASS |
| D2 | 500-char + CJK + emoji + RTL | persists; no card overflow | PASS |
| D3 | Every bulk confirm: cancel-then-confirm | cancel = no change; confirm = change | PASS |
| D4 | Reminder boundaries: Feb-30, invalid IANA zone | exact validation messages | PASS |
| D5 | Link dialog cancel | nothing inserted (innerHTML identical) | PASS |
| D6 | Rapid creation with active selection | no corruption | PASS |
| D7 | Offline creation + search | works fully offline | PASS |
| D8 | Empty .md import | observed fallback-title import | PASS (observed) |
| D9 | Hygiene | clean | PASS |

## Pass E — Cross-feature & timing (pass-e-crossfeature)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| X1 | Selection × navigation | cleared across queries | PASS |
| X2 | Search × bulk archive | scoped correctly | PASS |
| X3 | Multi-tab conflict | honest conflict surfacing | PASS |
| X4 | Background trash while editing | honest failure | PASS |
| X5 | Theme × creation | durable | PASS |
| X6 | Palette over editor with unsaved edits | navigation works; state recorded | PASS |
| X7 | Rapid theme toggling | shell healthy | PASS |
| X8 | Hygiene | clean | PASS |

## Pass F — Persistence/restart/round-trip (pass-f-persistence)

| ID | Scenario | Expected | Status |
|---|---|---|---|
| F1 | Build rich durable state (note+subtitle+reminder+pin+tag+category+dark) | all persisted | PASS |
| F2 | Full browser restart (same profile) | everything survives; no onboarding | PASS |
| F3 | Reload + tag: search | index rebuilt from durable state | PASS |
| F4 | Recovery journal on hard reload | offered/observed without corruption | PASS (observed) |
| F5 | Second tab consistent read | same durable view | PASS |
| F6 | Hygiene | clean | PASS |

## Pass G — Regression & repeat

Every failure encountered during development of the audit was re-run to a stable, reproducible verdict (or documented as intermittent with the reproduction rate). The final full battery (75 tests) was executed twice consecutively green, plus per-suite re-runs; the repo's own 58-test E2E battery was re-run green at the audit HEAD.
