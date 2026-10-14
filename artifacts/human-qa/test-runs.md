# test-runs.md — chronological QA program journal

Per ai/qa-instructions.md §14. One entry per session/probe. Evidence paths are relative to artifacts/human-qa/.

### phase0-baseline — 2026-10-14T17:45:25.534Z
- Phase 0 baseline: extension v1.0.7 built, installed unpacked, service worker started, dashboard + onboarding + editor + settings + diagnostics + palette all opened through the real UI; baseline screenshots + video captured. Findings: no blockers.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase0-baseline-20261014-174524.json
- screenshots/baseline/phase0-01-first-run-onboarding.png
- screenshots/baseline/phase0-02-onboarding-dialog-open.png
- screenshots/baseline/phase0-03-after-skip-dashboard.png
- screenshots/baseline/phase0-04-editor-first-note.png
- screenshots/baseline/phase0-05-settings-open.png
- screenshots/baseline/phase0-06-diagnostics-open.png
- screenshots/baseline/phase0-07-command-palette.png
- screenshots/baseline/phase0-08-library-end-of-tour.png

### phase1-discovery — 2026-10-14T17:51:43.210Z
- Phase 1 discovery verification: swept shell, onboarding, editor session, 5 panels, file menu, save-page/settings/filters/palette dialogs, search, cards+bulk against the running v1.0.7 UI. Reachable controls: 3; missing: none. Corpus of 3 notes created through the real UI.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase1-discovery-20261014-175139.json
- screenshots/baseline/phase1-01-onboarding.png

### phase1-discovery — 2026-10-14T17:53:05.950Z
- Phase 1 discovery verification: swept shell, onboarding, editor session, 5 panels, file menu, save-page/settings/filters/palette dialogs, search, cards+bulk against the running v1.0.7 UI. Reachable controls: 71; missing: shell:Import note…: sidebar/topbar button ; shell:view Grid/List: view toggle. Corpus of 3 notes created through the real UI.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase1-discovery-20261014-175303.json
- screenshots/baseline/phase1-01-onboarding.png
- screenshots/baseline/phase1-02-library-empty.png
- screenshots/baseline/phase1-editor-meeting.png
- screenshots/baseline/phase1-editor-reading.png
- screenshots/baseline/phase1-editor-recipe.png
- screenshots/baseline/phase1-03-library-corpus.png
- screenshots/baseline/phase1-04-editor-open.png
- screenshots/baseline/phase1-05-revisions-panel.png
- screenshots/baseline/phase1-06-attachments-panel.png
- screenshots/baseline/phase1-07-snapshots-panel.png
- screenshots/baseline/phase1-08-reminders-panel.png
- screenshots/baseline/phase1-09-ai-panel.png
- screenshots/baseline/phase1-10-file-menu.png
- screenshots/baseline/phase1-11-save-page-dialog.png
- screenshots/baseline/phase1-12-settings-full.png
- screenshots/baseline/phase1-13-palette-open.png
- screenshots/baseline/phase1-14-filters-panel.png
- screenshots/baseline/phase1-15-search-results.png
- screenshots/baseline/phase1-16-bulk-bar.png

### phase2a-onboarding-nav — 2026-10-14T18:00:11.558Z
- Phase 2 Batch A: onboarding (present/create/skip/settings-first/escape/reshow) + navigation (New Note, 7 smart lists, save-page dialog, import, settings, diagnostics) exercised through the real UI with evidence. Results: 8/19 PASSED. Defect candidates: Create my first note: cards=0 | Skip for now: obGone=true cards=0.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2a-onboarding-nav-20261014-175953.json

### phase2a-onboarding-nav — 2026-10-14T18:01:53.619Z
- Phase 2 Batch A: onboarding (present/create/skip/settings-first/escape/reshow) + navigation (New Note, 7 smart lists, save-page dialog, import, settings, diagnostics) exercised through the real UI with evidence. Results: 19/19 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2a-onboarding-nav-20261014-180151.json

### phase2b-search-filters — 2026-10-14T18:04:45.536Z
- Phase 2 Batch B: metadata bar add/remove tags+categories, bulk favorite, card pin, search free-text + 15 operator queries + malformed, filters (tag facet, chip removal, clear all, save-as-view + switch, domain input), sort 6 fields + direction, view grid/list. 7/7 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2b-search-filters-20261014-180435.json

### phase2b-search-filters — 2026-10-14T18:08:33.413Z
- Phase 2 Batch B: metadata bar add/remove tags+categories, bulk favorite, card pin, search free-text + 15 operator queries + malformed, filters (tag facet, chip removal, clear all, save-as-view + switch, domain input), sort 6 fields + direction, view grid/list. 39/44 PASSED. Defect candidates: section filters: locator.click: Error: strict mode violation: getByRole('button', { name: 'Filters' }) resolved to 3 elements:.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2b-search-filters-20261014-180829.json

### verify-d01-d02 — 2026-10-14T18:17:49.570Z
- Defect verification against repaired build: QA-D01 VERIFIED_FIXED; QA-D02 VERIFIED_FIXED; QA-D02 VERIFIED_FIXED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d01-d02-20261014-181746.json

### phase2b2-filters — 2026-10-14T18:20:19.553Z
- Phase 2 Batch B2 (filters re-run after locator fix): 7/7 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2b2-filters-20261014-182017.json

