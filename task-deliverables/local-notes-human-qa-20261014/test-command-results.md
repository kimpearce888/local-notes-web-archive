# Test Command Results — exact commands, exit codes, discovered counts

Target: `main` @ `ab61ca2`, working tree clean, built dist/ v1.0.4.

## Discovered test counts (from the runners' own list commands — not badges)

| Runner | Command | Discovered |
|---|---|---|
| Vitest | `npx vitest list` | 803 raw entries; **authoritative JSON report: 797 tests / 66 files** (the 6-entry delta is raw `test.each` fragment titles listing as separate lines, not skipped tests: skipped=0, todo=0 in the JSON report) |
| Playwright (repo) | `npx playwright test --list` | **58 tests in 6 files** (extension 13 · human-simulation 14 · release-verification 6 · screenshots 14 · user-report-regressions 7 · zip-acceptance 4) |
| Playwright (audit) | `node node_modules/@playwright/test/cli.js test --list` (in /home/z/my-project/qa-audit) | **75 tests in 9 files** |

## Repo's declared checks, re-run fresh at the audit HEAD

| Gate | Exact command | Result | Exit |
|---|---|---|---|
| Lint | `npm run lint` (`eslint .`) | PASS — 0 problems | 0 |
| Type-check | `npm run check` (tsc strict, app + node) | PASS | 0 |
| Unit/integration | `npm test` (vitest run) | **797/797 passed**, 66 files, 46.8 s | 0 |
| Perf | `npm run test:perf` | 1/1 PASS — 200 samples: p50 75 ms / **p95 121 ms** / p99 315 ms (budget p95 < 500 ms) | 0 |
| Build | `npm run build` (vite) | PASS — 14 files, dist manifest 1.0.4 | 0 |
| Release verify | `npm run verify-release` | PASS — MV3, CSP self-only, permissions match, 14 files complete | 0 |
| E2E (repo) | `xvfb-run wrapper: npx playwright test` | **58/58 passed** in ~60 s (real Chromium, persistent context, unpacked dist/) | 0 |

Environment notes (honest): Xvfb `:99` 1440×900 via a no-xauth wrapper script (the container lacks xauth; standard `xvfb-run` errors without it). Chromium build `chromium-1248` was (re)installed for Playwright 1.64.0 during the audit because the shared cache held only `chromium-1200` (repo suite itself initially failed to launch until this was installed — an environment fact, not a product fact). `--disable-dev-shm-usage` was added to the audit launcher because `/dev/shm` is 64 MB in this container.

## Audit battery (the deliverable suite)

| Run | Command | Result |
|---|---|---|
| Final full battery (twice) | `/home/z/my-project/scripts/xvfb-run-noauth.sh node node_modules/@playwright/test/cli.js test -c playwright.config.ts` (cwd `/home/z/my-project/qa-audit`) | **75/75 passed** — output preserved at `evidence/audit-final-run.txt` |
| Per-suite re-runs during stabilization | same runner with spec filters | pass-a 7/7 · pass-b-shell 10/10 · pass-b-editor 12/12 · pass-b-panels 10/10 · pass-b-panels2 7/7 · pass-c 6/6 · pass-d 9/9 · pass-e 8/8 · pass-f 6/6 |

## Investigation probes (kept as evidence)

probe-b2 (card/checkbox DOM ground truth), probe-b8 (pagination overflow + reload self-heal), probe-attach (attachment Blob failure), probe-backup (export createObjectURL failure), probe-import (filechooser mechanics), probe-onboarding (re-show disabled button), probe-restore (click responsiveness after restore) — each under `evidence/probe-*/session-evidence.json`.

## Tooling notes (transparency)

1. **Xvfb wrapper**: `scripts/xvfb-run-noauth.sh` starts Xvfb + waits for the abstract socket + runs the command + cleans up, all inside one shell invocation (the sandbox reaps background processes between commands; a detached Xvfb dies).
2. **Intermittent input stalls**: Playwright's CDP-dispatched clicks/fills occasionally stalled on verified-clickable elements in this container (probe evidence: DOM state clean, hit-test passes, buttons enabled). The audit helper `auditClick`/`auditFill` fall back to a DOM-dispatched event on the SAME real element after 20 s, and every fallback is recorded in the session evidence logs. Root cause undetermined (tooling/environment; flagged for developer awareness, not counted as a product defect).
3. **The repo suite is untouched**: no repo file was modified; the audit tooling lives outside the repository (`/home/z/my-project/qa-audit`) and the repo working tree remained clean throughout (verified after every phase).
