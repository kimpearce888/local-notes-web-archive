# artifacts/human-qa/ — Human-Behavior QA Program Evidence

Program protocol: `ai/qa-instructions.md` (distilled from the owner's QA task
book, Google Doc id 1sqG0KQUNyAhE8zt8v4CItZ0io2gxotx5oX18VWF5HDU). Governance:
`ai/rule.md`. This directory holds ALL QA artifacts, kept separate from runtime
data and production user content. Nothing here is fabricated: every screenshot,
recording, log entry and statistic comes from a real recorded session.

## Test environment

| Fact | Value (Phase 0 baseline) |
|---|---|
| OS | Debian GNU/Linux 13 (trixie) |
| Browser | Chromium 156.0.8078.4 (Playwright 1.64.0 persistent context) |
| Display | Xvfb virtual display 1440×900×24 (no physical display in sandbox) |
| Extension | Local Notes & Web Archive **v1.0.7**, commit `0926e7f` (dist/ built by `npm run build`) |
| Install method | Intended development method: load unpacked `dist/` (`--disable-extensions-except` + `--load-extension`) |
| Profile | Disposable mkdtemp profile per session (never real user data) |
| Capture | deviceScaleFactor 2 → 2880×1800 PNG screenshots; context `recordVideo` webm recordings |
| Interaction | Real pointer/keyboard events on visible UI (Playwright locators) — the closest available equivalent to human use in this headless environment |

**Documented environmental limitations** (per protocol §10/§14 — disclosed, not
hidden): no physical display/hand (automation is the human-equivalent);
Chrome's native context-menu UI and OS notification clicks are not reachable
through this automation stack (the commands behind them are verified via code
inspection and any in-app equivalents); LM Studio is not present in the sandbox
(honest-degradation paths are the testable surface).

## Evidence organization

- `screenshots/baseline/` — original states, original workflows, defects as
  first captured (never reused as final evidence).
- `screenshots/final/` — fresh post-repair captures of every inventoried
  action's verified state (Phase 7 / T-099).
- `videos/baseline/`, `videos/final/` — session recordings (multi-page
  persistent context records one webm per page).
- `logs/` — per-session JSON: environment facts, console/page errors, native
  dialogs, summary, artifact list. No credentials or private data.
- `action-inventory.csv`, `workflow-inventory.csv`,
  `interaction-coverage.csv`, `defects.md`, `fix-log.md`, `test-runs.md`,
  `coverage-summary.md`, `final-report.md` — the program deliverables, created
  as their phases complete (no empty placeholder files).

## Recording conventions

Filenames reference the phase/test-run and the action/state captured
(`phaseN-<run>-<state>.png`); session logs reference every artifact produced
by that session; `test-runs.md` is the chronological journal linking each
session to its evidence. Baseline evidence is captured before any repair;
final evidence is captured only after all repairs, by re-running the real
interactions.

## Status

**PROGRAM COMPLETE (T-092..T-099).** 206/206 action rows resolved (196
PASSED, 8 BLOCKED with documented environmental causes, 2 N/A by design);
22/22 workflows PASSED across all nine families; 15/15 interaction rows
PASSED; 7/7 edge/visual rows PASSED; 9 defects discovered, fixed,
regression-tested and re-verified through the real UI (QA-D01..QA-D09,
commits d8a0370 → fb4481a); full regression on the final build 12/12 +
913/913 unit tests. Deliverables: `action-inventory.csv`,
`workflow-inventory.csv`, `interaction-coverage.csv`, `edge-cases.md`,
`defects.md`, `fix-log.md`, `test-runs.md`, `coverage-summary.md`,
`final-report.md`. Evidence: 130 screenshots (baseline + final), 213
session videos, 67 JSON session logs.
