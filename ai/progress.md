# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## Queue

- [x] T-092 — Phase 0 environment: build, isolated profile, install, verify operational, baseline evidence (commit f173136; record in completed.md).
- [x] T-093 — Phase 1 discovery: 206-row action-inventory.csv (commit 903de12; record in completed.md).
- [~] T-094 — Phase 2 individual actions: batches A-G done; 176/206 PASSED, 6 BLOCKED (env-limited L04-L06), 2 N/A, 22 remaining; defects QA-D01..QA-D06 fixed + regression-verified (d8a0370, 33a5949, b0e9320). Remaining: 22 rows + phase-2 close-out.
- [ ] T-095 — Phase 3: workflow-inventory.csv (complete end-to-end workflows + realistic journeys).
- [ ] T-096 — Phase 4+5: interaction-coverage.csv + persistence/integrity/recovery.
- [ ] T-097 — Phase 6+7: error/edge cases + visual testing of every interface state.
- [ ] T-098 — defect repair completion + complete regression pass on the rebuilt extension.
- [ ] T-099 — final evidence (fresh screenshots/videos of every verified state), coverage-summary.md computed from inventories, 12-part final-report.md.
