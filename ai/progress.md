# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## Queue

- [x] T-092 — Phase 0 environment: build, isolated profile, install, verify operational, baseline evidence (commit f173136; record in completed.md).
- [x] T-093 — Phase 1 discovery: 206-row action-inventory.csv (commit 903de12; record in completed.md).
- [x] T-094 — Phase 2 individual actions: COMPLETE — 206/206 rows resolved (196 PASSED, 8 BLOCKED env-limited, 2 N/A); defects QA-D01..QA-D06 fixed + regression-verified (d8a0370, 33a5949, b0e9320); final 22 rows closed by phase2h batches (real captured + really-failed links, find bar, source view, paste/drop, reminders, pagination, restart, two tabs, JSON import); record in completed.md.
- [x] T-095 — Phase 3 workflows: COMPLETE — workflow-inventory.csv 22/22 PASSED across 9 families; defects QA-D07 (retry unreachable, c239fe2), QA-D08 (replace flattens rich docs — data loss, 7ea37b0), QA-D09 (recapture unreachable / Compare permanently unreachable, fb4481a) fixed + regression + real-UI verified; deferred QA-147/149 re-covered; record in completed.md.
- [x] T-096 — Phase 4+5: COMPLETE — interaction-coverage.csv 15/15 PASSED (undo/autosave, entry points, rapid switching, capture-while-editing, policy branches, shared roster, sequential opens, cross-surface consistency, renames, empty-note, rapid creation, order-sensitive combos, wholesale undo); no new defects (failures were test-design artifacts, documented honestly); record in completed.md.
- [x] T-097 — Phase 6+7: COMPLETE — edge-cases.md EC-01..06 + P7-SWEEP all PASSED (Unicode/emoji/RTL, long content, whitespace inputs, degenerate queries, double-submits, long titles, both-theme visual sweep); no new defects; record in completed.md.
- [x] T-098 — Regression: COMPLETE — 12/12 checks PASSED on the final build (all nine defect areas D01..D09 + core flows + restart; 913/913 units); one timing-sensitivity observation documented (onboarding editor mount race); record in completed.md.
- [x] T-099 — Final deliverables: COMPLETE — coverage-summary.md (computed from inventories) + final-report.md (12 sections, evidence-backed) + README status updated; the queue is EMPTY; record in completed.md.
- [x] T-100 — v1.0.8 release: IN FLIGHT — version bump + notes + gates green (913/913 units, 78/78 E2E incl new seeded end-to-end capture test, perf PASS, zip cut + verified); publish + docs regeneration + record archive in the audit commit per the T-090 two-commit pattern.
