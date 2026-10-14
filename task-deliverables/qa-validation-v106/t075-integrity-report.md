# T-075 — Data Integrity + Network Resiliency Report

Protocol source: external QA brief sections DATA INTEGRITY TESTING +
NETWORK RESILIENCY TESTING + BACKEND VALIDATION. Method:
qa-audit/specs/t075-integrity.spec.ts against the built artifact through
real user paths (unique marker strings, durable verification after every
step). Raw JSON: `t075-integrity.json`.

## Results — 8/9 PASS, 1 BLOCKED (harness limitation, honestly recorded)

| ID | Check | Result |
|----|-------|--------|
| I1a | Create durable across page reload | PASS |
| I1b | Update (title + body) durable across reload | PASS |
| I1c | Move-to-trash durable across reload (confirm dialog path) | PASS |
| I1d | Restore from trash durable (bulk-bar path) | PASS |
| I1e | Permanent purge durable — gone forever after reload | PASS |
| I4 | Full CRUD offline (context.setOffline(true)): create + save + search all work — local-first confirmed | PASS |
| N1 | Dead LM Studio endpoint (127.0.0.1:59999): honest fail-closed error surfaced, no fake success | PASS |
| I2 | Extension reload (chrome.runtime.reload) persistence | **BLOCKED** — see below |
| I3 | Browser restart (close context, relaunch SAME profile): data survives, settings survive, onboarding NOT re-shown (visibility-verified) | PASS |

## I2 — BLOCKED, with exact reason and evidence

`chrome.runtime.reload()` invoked from the dashboard ORPHANS the unpacked
extension inside a Playwright persistent context: the service worker never
re-registers (probe evidence: `debug-reload.mjs` observed 0 service
workers across 8 consecutive 1-second probes after the call;
`--load-extension` applies at browser launch only). This is a harness
limitation, not an application defect — recorded as BLOCKED per the
honesty rules, never as a pass. The equivalent durability semantics
(extension unload + reload + SW cold start + IndexedDB reopen with the
same profile) ARE exercised by I3's full browser-restart path.

## Cross-coverage from the repo's own battery (re-verified green in T-070
and again in T-077's full run: 836/836 unit + 67/67 E2E)

- Multi-tab consistency: human-simulation "multiple tabs: a second
  dashboard tab stays consistent with the first" — PASS.
- Import/export round-trip byte-fidelity: audit-defect-regressions
  backup export → PK-zip verification → restore preview → full
  merge-restore round-trip — PASS.
- Revision recovery, trash boundaries, conflict handling: unit suites +
  the T-062 audit's pass-F persistence workflows — PASS.
- Service-worker "backend": all RPC handlers (notes/search/settings/
  capture/reminders/AI/backup) exercised through the real channel by the
  E2E batteries; URL gate, sanitization, transport codec unit-tested.

## Test-methodology notes (recorded honestly)

- The trash/restore/purge flow required the exact established selectors
  ('Move to trash…' → dialog--confirm → 'Move to trash' exact; bulk-bar
  'Delete permanently…' → exact confirm) — generic regexes matched the
  sidebar Trash nav button instead of the editor action.
- The purge step must re-trash the note after the restore check (the
  restore returns it to active) — a test-flow correction, not an app fix.
- The onboarding "re-show" check must assert dialog VISIBILITY, not DOM
  presence (the dialog element persists in the DOM for returning users).
- No product defects found in this battery.
