# qa-instructions.md — Human-Behavior QA Mission Brief (optimized local copy)

**Source:** Google Docs id `1sqG0KQUNyAhE8zt8v4CItZ0io2gxotx5oX18VWF5HDU` — full 18-section
original read completely (2026-10-14). This file is the authoritative distillation: the
remote doc does **not** need to be read again; every normative requirement is carried here.
**Governing framework:** `ai/rule.md` stays the project operating system. QA repairs are
normal code changes — rule.md §2 gates (`tsc --noEmit` strict, `eslint .`, `vitest run`)
and §7 git workflow (`type(scope): description`, one task → one commit → one push,
`progress.md` + `completed.md` updated in the same commit) apply to every fix.

---

## 1. Role and mission

Autonomous QA + exploratory + usability + debugging + repair engineer. Test the **running**
Chrome extension as a real human would (real clicking, typing, selecting, scrolling,
dragging, hovering, menus, dialogs, navigation). This is not code-review-only, not a smoke
test, not happy-path checks, not a demo of selected features.

Mission chain: discover the whole product → build a coverage plan → exercise every
discoverable action and complete workflow through the real UI → capture evidence → repair
root causes → retest → complete final regression. No feature, screen, or workflow is assumed
more important than the rest (the note editor gets no special priority).

Five questions the work must answer:
1. What can a user actually do in this application?
2. Have all discoverable actions and complete workflows been exercised through the real UI?
3. What fails, behaves unexpectedly, loses data, or renders incorrectly?
4. Have the defects been repaired and the original failures reproduced as passing?
5. What evidence proves the final repaired app works, and what remains unverified?

Do not stop after producing a report — investigate, change code, run, test, verify.

## 2. Non-negotiable principles

- **P1 — The running app is the subject.** Source inspection, DevTools, logs, DB/API
  inspection, and automated tests are supplementary only; they never replace real UI testing.
  A function/component/handler/test existing does not prove the user-facing feature works.
  Verify observable result + side effects + persistence + feedback + subsequent behavior.
- **P2 — Discover scope; never assume it.** Do not infer the feature set from README/PRD/
  screenshots/source structure alone. Explore the running app; use code only to locate
  less-obvious capabilities and implementation gaps, then verify in the UI. Record
  implemented-but-unreachable functionality and investigate whether it is a defect. Never
  invent features that are neither implemented nor reasonably indicated.
- **P3 — Full coverage.** Every independently testable action gets its own inventory entry,
  actual test result, and linked evidence. Every distinct screen and relevant state gets
  inspected. Every complete workflow gets exercised. Every available option gets tested
  individually. No bundling into "settings tested" / "toolbar tested" / "editor tested".
- **P4 — Systematic AND exploratory.** Both, without substitution: complete inventory sweep
  plus natural unpredictable sessions (varied sequences, combined unrelated features,
  revisits, mistakes + recovery, mid-workflow direction changes).
- **P5 — Evidence must match the claim.** Never mark PASSED without genuine exercise and
  observed expected behavior. Never reuse pre-fix screenshots as post-fix evidence. Never
  mark blocked/untested as passed. Never fabricate screenshots/recordings/results/stats.
  Environment-blocked → state the exact limitation + preserve diagnostics.

## 3. Phase 0 — Environment (before functional testing)

- [ ] Inspect repo structure, manifest, entry points, build system, deps, config, storage,
      browser integrations, test infrastructure.
- [ ] Determine the intended install/run procedure from project + actual implementation.
- [ ] Create an isolated Chrome testing profile (or equivalent safe environment).
- [ ] Build + install via the intended dev/distribution method.
- [ ] Launch **every** interface the extension actually provides.
- [ ] Verify operational, not merely installed.
- [ ] Investigate/repair immediate blockers first: broken install steps, missing
      deps/resources, startup failures, JS errors, permission failures.
- [ ] Inspect DevTools output, service-worker logs, console errors, storage, diagnostics.
- [ ] Record OS, Chrome version, extension version/commit, configuration, constraints.
- [ ] Capture baseline screenshots; begin the initial exploratory recording.

Data safety: preserve existing user data and unrelated files; use disposable test data and
isolated storage; never reset/erase real data to simplify testing. Never claim inaccessible
features were tested.

## 4. Phase 1 — Discovery → `artifacts/human-qa/action-inventory.csv`

Assign every independently testable action a unique ID. Never merge controls that can fail
independently (distinct controls, menu choices, shortcuts, operations stay separate
entries). For multi-value options, inventory the meaningful values/states — one click does
not prove all choices work. Maintain the inventory continuously through discovery, testing,
repair, and final verification.

Required columns: Action ID · Feature & interface · Exact action/control · Location + steps
to reach · Preconditions & app state · Test input/data · Expected behavior · Actual behavior
· Test-run ID · Coverage status · Baseline evidence · Final evidence · Related defect IDs ·
Regression result · Notes/limitations/blockers.

Statuses (each backed by an explicit reason or evidence): `NOT_TESTED` · `PASSED` ·
`FAILED` · `BLOCKED` · `NOT_APPLICABLE`.

Discovery domains (a guide, not a closed list): install/init/permissions/onboarding/first
run; every popup/panel/tab/page/window; navigation, back/forward, transitions; all
create/view/edit/update/organize/delete features; all toolbars, buttons, menus, dropdowns,
toggles, contextual controls, shortcuts; every settings option; search/filter/sort/selection;
entry, validation, save/load/persistence/recovery; import/export/backup/restore/clipboard;
browser integrations, context menus, selected-text/page interactions; feedback,
confirmations, notifications, validation messages, loading indicators, errors, empty states;
AI-powered or local-integration capabilities; accessibility, keyboard navigation, focus;
anything else discovered. Inspect hidden/conditional surfaces: open menus and submenus,
reveal contextual controls, change settings that unlock options, test controls enabled by
selection/mode/state.

## 5. Phase 2 — Per-action procedure (every inventory entry)

1. Open the interface; establish initial state → 2. Locate the exact control → 3. Interact
through the real UI → 4. Supply realistic input → 5. Observe the immediate result →
6. Inspect resulting screen, content, state, feedback, side effects → 7. Verify dependent
behavior → 8. Verify persistence when expected → 9. Capture evidence → 10. Record exact
behavior; update inventory → 11. Investigate every deviation.

PASS = intended observable result occurred AND relevant side effects are correct.

Variations (per action, based on its actual behavior/risk; document why a variation is
inapplicable when it affects coverage): different valid inputs · alternative values and
selections · empty/initial/populated states · repeated operation · reversal, cancellation,
dismissal · navigate away and return · preconditions/dependencies · mouse AND keyboard where
both exist · boundary conditions · recovery after failure/interruption. Concrete examples:
don't just open a selector — exercise its choices; don't just toggle on — toggle off and
verify the behavior; don't just click save — change, save, leave, reopen, verify what
persisted. No category gets a free pass.

## 6. Phase 3 — Complete workflows end-to-end

Controls passing individually ≠ workflow passing. Discover workflows from the UI,
implementation, entry points, and interactions. Exercise each from starting condition to
final observable outcome; verify meaningful intermediate transitions plus persistence and
side effects — not just the final screen.

Record per workflow: initial state · required data/preconditions · ordered actions ·
expected + actual intermediate results · final expected outcome · data/state that must
persist · screenshots + recording timestamps · defects · final retest after repair.

Workflow families: create/initiate · modify existing data · access previous work · search ·
change settings · navigate between interfaces · cancel an operation · complete an operation ·
recover from unexpected results. Examples are not limits.

Realistic journeys: start op A → switch to feature B → return to A; modify previous content;
navigate away; reopen the extension; continue working. Vary starting points, sequences,
content, selections, and states across runs; explore beyond the obvious happy path; include
short focused workflows AND long multi-feature sessions. Don't restart/reset between every
test unless isolation is needed — sustained use, repeated navigation, and state-transition
chains expose bugs isolated tests miss.

## 7. Phase 4 — Feature interactions and combinations

Build an interaction map (which features depend on, modify, or share state). Test:
create-then-modify/search/organize/reopen/delete · setting change → every related interface
· operation → undo/reverse/cancel/repeat · navigate away mid-edit → return · switch
records/tabs/panels without state bleed · contextual controls across selections and content
types · order-sensitive operation ordering · rapid repetition (duplicate/lost/stale state) ·
revisit a feature after another changes shared data · one op while another is pending ·
format/settings/input/navigation combinations in content editing · different entry points to
the same operation (compare results). Derive more from the real architecture and observed
behavior.

Combination coverage — ALL mandatory:
1. every independently testable action tested individually;
2. every meaningful state transition exercised;
3. every known dependency tested;
4. each relevant pair of interacting features tested together;
5. representative multi-feature sequences with varied action ordering;
6. longer exploratory sessions for behavior isolated tests cannot expose;
7. boundary conditions and combinations implicated by a discovered defect get extra coverage.

Don't enumerate meaningless permutations; don't claim exhaustive combination coverage from
hand-picked examples. Document the actual strategy and any untested combination. New
dependency discovered → update the interaction map and expand the suite.

## 8. Phase 5 — Persistence, integrity, consistency, recovery

Test via the product's real storage mechanisms and user workflows (as applicable):
CRUD + rename/move · save and reopen · navigate away then return · close/reopen the
extension · reload the page/interface · restart Chrome when practical · restart local
components · configuration persistence · repeated operations (duplicates?) · sequential
record opens stay distinct · empty/missing/stale/malformed/invalid data · cancel leaves no
unintended persistence · interruption/failure recovery · import/export/backup/restore ·
consistency between interfaces showing the same underlying data.

Verify contents, relationships, formatting, ordering, and metadata — a record merely
remaining present is not integrity. Compare saved data vs input vs what is displayed. Use
controlled fault injection with disposable data; restore the environment afterward; never
risk genuine user data to test a failure.

## 9. Phase 6 — Errors, edge cases, recovery

Build scenarios from the actions that actually exist and their real failure conditions —
don't force every error into every feature: missing required input · empty/whitespace-only ·
extremely short or long content · Unicode, non-English text, emoji, punctuation, special
characters · invalid/unsupported/malformed input · duplicate submissions/repeated actions ·
unexpected selection, focus, or navigation states · cancelled dialogs/interrupted workflows ·
invalid imported data/unavailable resources · permission/storage/dependency failures ·
temporarily unavailable integrations · unexpected browser/app lifecycle events · access to
removed content · unusual but valid sequences.

For each: handled correctly, understandable feedback, valid data preserved, returns to a
usable state. Intermittent defects: capture multiple attempts, document reproduction
conditions, preserve evidence; never dismiss as random noise; never mark resolved merely
because it didn't recur next attempt.

## 10. Phase 7 — Visual testing (every interface and state)

States: initial views, populated views, open menus, open dialogs, selected elements,
loading, confirmation, validation errors, failure states, completed operations.

Check: layout/spacing/sizing/positioning/alignment · overlapping or clipped components ·
hidden/truncated text · obstructed controls · dropdown/menu/dialog/popover positioning ·
unexpected menu dismissal · broken scrolling or focus · viewport overflow · missing or
confusing interaction feedback · incorrect active/selected/disabled/loading states ·
visible state vs actual state mismatch · content changing/disappearing during interaction ·
visual corruption after navigation/saving/reopening/editing · inconsistency between
interfaces or configurations · anything else harming comprehension, access, or usability.

Use realistic content and long-running sessions (empty/short data hides layout bugs). Test
applicable viewport sizes, display configurations, accessibility behavior. Document every
visual defect — a technically completing operation with a broken presentation is still a
defect.

## 11. Evidence rules (mandatory screenshots and video)

- **Baseline:** record from initial exploration; capture original states and real
  interaction sequences (navigation, workflows, exploration, state changes, failures);
  defect screenshots BEFORE fixing whenever possible.
- **Per-action:** every inventory entry links evidence showing the control/its accessible
  location, resulting interface state, observable effect, relevant validation/error/
  confirmation messages, and persistent results. Transient interfaces captured while open.
  Too transient → recording + documented timestamp + static screenshot of the resulting
  state. No generic whole-app screenshot standing in for dozens of unrelated actions.
  Consistent unique filenames referencing action/test-run IDs. Baseline kept separate from
  final.
- **Final screenshots (after ALL repairs):** fresh captures of every discovered interface,
  every distinct relevant UI state, and every inventoried action's resulting state —
  obtained by REPEATING the actual interactions, never reconstructed or generated.
  Include open menus, dropdowns, dialogs, contextual toolbars, config choices, validation.
  Content/state-changing features: immediate result + reopened/persisted state. Previously
  broken features: evidence of corrected behavior.
- **Final recordings:** complete end-to-end workflows, broad exploratory sessions,
  multi-feature sequences, regression testing. Preserve original-failure evidence alongside
  repaired behavior. Understandable segments, clear filenames, meaningful timestamps.
- Environment prevents a capture → attempt an appropriate local method and document the
  remaining limitation. Never pretend unavailable evidence exists.

## 12. Defect protocol — `artifacts/human-qa/defects.md`

Maintain continuously as discoveries happen; never postpone to the end. Per defect: unique
ID · concise specific description · affected feature + action IDs · exact reproduction
steps · initial state + test data · expected vs actual behavior · reproducible or
intermittent · screenshot evidence · recording path + timestamps · console errors/logs/
diagnostics · confirmed root cause (or current findings) · files/components changed ·
repair description · regression tests executed · final verification + evidence.

Distinct failures are separate entries unless confirmed symptoms of one root cause (then
explain the relationship). Record visual, functional, data-integrity, workflow,
installation, and interaction defects. Never omit an issue for being hard to reproduce, an
uncommon sequence, or small.

Repair loop (per confirmed defect):
1. preserve original failure evidence → 2. reproduce + identify preconditions →
3. trace through UI, state, data flow, integration, storage → 4. find the underlying
cause, not the symptom → 5. targeted, maintainable fix → 6. add/update regression tests →
7. rebuild + reload the extension → 8. repeat the original interaction through the real
UI → 9. confirm the expected result → 10. test related features and transitions for
regressions → 11. capture fresh evidence → 12. update inventory, defect ledger, fix log.

FORBIDDEN: hiding failures by disabling features, removing controls, weakening validation,
changing tests to accept incorrect behavior, or bypassing the intended implementation. No
wholesale rewrite unless investigation proves it necessary. Unclear intended behavior →
derive from the actual implementation and surrounding workflows; record remaining ambiguity
instead of inventing a convenient expectation. New defects found while fixing/retesting →
add to the ledger and investigate. Continue until addressed or limitations are documented.

## 13. Regression protocol (after repairs, on the rebuilt + reloaded build)

A successful compile, passing unit tests, or one demo proves nothing. Perform a new
complete coverage pass: reexecute the original failing scenarios · retest every feature
affected by a code change · retest features sharing state/components · retest ALL
individual actions in the inventory · repeat each discovered E2E workflow · repeat relevant
combinations and state transitions · verify persistence and data integrity · repeat visual
inspection of relevant screens/states · inspect console and runtime logs · run automated
tests and build checks · another exploratory pass on the repaired build. A repair that
introduces a new defect gets repaired too, then verification repeats. Final evidence must
come from the build that was actually retested.

## 14. Deliverables — `artifacts/human-qa/` (separate from runtime data, production user content, unrelated files)

| Artifact | Required content |
|---|---|
| `README.md` | test environment, build/commit tested, install method, evidence organization, recording conventions, final completion status |
| `action-inventory.csv` | complete action-level inventory: expected + actual, original + final result, coverage state, evidence paths, defect refs, regression outcome |
| `workflow-inventory.csv` | every E2E workflow: start conditions, steps, expected intermediate + final outcomes, actual results, evidence, defects, final retest status |
| `interaction-coverage.csv` | cross-feature dependencies, state transitions, combinations tested, multi-step sequences, known-untested combos, results + evidence |
| `test-runs.md` | chronological exploratory sessions, individual tests, workflows, inputs, observed results, evidence locations |
| `defects.md` | the full defect ledger (§12) |
| `fix-log.md` | traceable code changes: affected files/components, defects addressed, confirming tests |
| `coverage-summary.md` | calculated from actual inventories: discovered features/interfaces; independent actions; passed/failed/blocked/untested; workflows discovered + retested; interaction combos; defects discovered/repaired/verified; outstanding defects + limitations; screenshot/recording coverage — real data only, no invented totals, no rounding up, no conflating blocked with passed |
| `screenshots/baseline/` | initial states, original workflows, significant interactions, defect captures |
| `screenshots/final/` | fresh genuine captures: every action's final verified state, every distinct relevant interface state, corrected appearance of previously defective features |
| `videos/baseline/` | original exploration, meaningful workflows, cross-feature interactions, reproducible failures |
| `videos/final/` | complete workflows, multi-feature interactions, final exploration, regression verification |
| `logs/` | build/install output, console errors, runtime diagnostics — no credentials, no unrelated private information |

Every reference to a screenshot, recording, log, result, or fix must point to an actual
artifact. No empty files simulating completion.

## 15. Truth rules (enforced throughout)

Every discovered action → its own traceable entry. PASSED ⇒ genuinely exercised. Workflow
PASSED ⇒ completed end to end. Every repaired defect ⇒ a passing reproduction test against
the final build. Final screenshots show the actual post-repair app. Every recording is a
real capture. Coverage claims are calculated from the inventories. Blocked actions and
untested scenarios are disclosed. Every new defect is recorded. Every meaningful change
gets regression testing.

A feature is not "completely tested" because its primary button works — its options,
states, variations, resulting data, and connections to other features are required. A
screen is not "completely tested" because it rendered. Never claim the whole app passed
while the inventory has undisclosed failed or untested entries. Never hide incomplete
coverage behind a single percentage.

Always distinguish: tested + passed · tested + failed · could not be tested (blocked) ·
remains untested · not applicable (explicit reason).

## 16. Definition of completion (each item complete only with supporting evidence)

- Extension builds, installs, launches in the intended test environment.
- Every discovered interface and relevant reachable state explored.
- The inventory contains every discovered independently testable action.
- Every available option and meaningful state exercised as appropriate.
- Every discovered complete workflow tested.
- Relevant dependencies and interactions between features tested.
- Realistic exploratory sessions completed beyond predetermined scripts.
- Persistence, data integrity, navigation, cancellation, recovery tested where applicable.
- Visual defects and interaction problems investigated throughout.
- Every discovered defect has an evidence-backed record.
- Confirmed, repairable defects addressed.
- Original failures retested against the repaired build.
- The entire action inventory received a final verification pass.
- E2E workflows and relevant combinations regression-tested.
- Fresh screenshots cover every action's final verified state and every distinct UI state.
- Baseline + final recordings exist for important workflows wherever technically possible.
- All evidence references point to real files.
- Coverage statistics calculated from the completed inventories.
- All remaining defects, inaccessible features, blocked checks, untested actions disclosed.

Everything repairable fixed but a test still blocked → report "repaired to the extent
verified" with remaining limitations clearly identified; never falsely report full
completion. Never stop at the first successful build, first passing workflow, clean
console, short checklist, or absence of obvious failures.

## 17. Final report (evidence-backed, 12 sections)

1. **Environment & build** — what was actually installed and tested.
2. **Feature discovery** — full scope of discovered functionality and interfaces.
3. **Action coverage** — actual inventory counts and status breakdown.
4. **Workflow coverage** — end-to-end journeys exercised and outcomes.
5. **Interaction coverage** — dependencies, combinations, state transitions tested.
6. **Defects discovered** — problems, reproduction steps, evidence references.
7. **Repairs performed** — code changes and what they addressed.
8. **Regression verification** — original failures + related workflows retested on the final build.
9. **Visual evidence** — baseline/final screenshot and recording locations.
10. **Automated verification** — actual build, test-suite, diagnostic results.
11. **Unresolved issues** — every remaining defect, blocked check, inaccessible behavior, untested action.
12. **Completion assessment** — honest determination against these coverage/evidence requirements.

Every claim traceable to the action inventory, workflow inventory, interaction coverage,
defect ledger, fix log, test-run records, or actual evidence files.

## 18. Final instruction (binding)

Start now: understand the real project, get the extension running, record its original
state. Discover the entire application; build the complete inventory before treating the
scope as known. Test every discovered feature and action individually. Use the extension
like a real person through unpredictable sequences and complete workflows. Investigate
everything that behaves unexpectedly. Capture evidence. Repair the underlying causes.
Repeat the original interactions and perform a complete final regression pass. Do not
assume which feature matters most; do not let visibility determine thoroughness; do not
stop when the obvious functionality works. Never ask the user to perform tests that this
environment can carry out. A genuine environmental limitation must be established through
evidence, documented precisely, and followed by continued testing of everything else that
remains accessible.
