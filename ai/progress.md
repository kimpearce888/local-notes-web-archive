# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## Queue

- [ ] T-071 — Fake-implementation detection scan + feature completeness validation vs PRD (feature-gap-report.md)
- [ ] T-072 — Feature/screen/interaction/workflow inventories re-verified live against v1.0.5 (coverage ledgers)
- [ ] T-073 — Security testing (XSS/stored-XSS/sanitization/URL gate/storage leaks) + permission audit + secret scan (repo + artifact)
- [ ] T-074 — Performance measurements (load/transition/search/large dataset) + memory-leak loops (heap/listener/detached-DOM monitoring)
- [ ] T-075 — Data integrity CRUD/persistence matrix (refresh/reload/extension-restart/browser-restart/multi-tab) + network resiliency (offline, LM Studio timeout degradation)
- [ ] T-076 — Accessibility + control-state sweep + human-like input patterns (rapid/double/keyboard-only/mixed/special chars) + a11y-state-report.md

(Continuation tasks — defect fixes, upgrade/rollback/artifact/extension
validation, dependency audit, evidence consolidation, coverage matrix, QA
report, two-pass completion challenge, release — are queued dynamically per
findings per plan.md §M.)
