# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

### T-056 UI/UX redesign — design system, sidebar app shell, command palette
Execute per the plan entry (user-supplied redesign brief: Linear/Arc/Obsidian
direction, 100% feature parity). Validation gate: eslint, tsc strict, vitest
(existing suites + new palette/shell tests), Playwright full run against the
rebuilt dist — no functional change, all 49 E2E specs still green.

### T-057 UI/UX redesign — component visual pass
Execute per the plan entry. Validation gate: same battery; pinned CSS
regressions (T-052 hidden guard, T-054 dialog-field sizing) must stay
intact; accessible names unchanged.

### T-058 UI/UX redesign — mandatory QA, human testing, screenshot proof
Execute per the plan entry (full battery + extended screenshot suite +
real-user validation loop; fix every issue found).

### T-059 UI/UX redesign — v1.0.3 release
Execute per the plan entry (version bump, release notes, QA report,
package, publish, audit regen; digest verified byte-identical).

