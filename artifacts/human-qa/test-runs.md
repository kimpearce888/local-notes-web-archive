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

### phase2c-cards-bulk-editor — 2026-10-14T18:25:11.758Z
- Phase 2 Batch C: cards/select-all/bulk (archive/restore/pin/unpin/assign-tags/assign-category/move-to-trash), trash lifecycle incl delete-forever, editor core (title/subtitle/body autosave/pin/trash/back + persistence reopen), toolbar marks + blocks + table + undo/redo + find bar + HTML source + file-menu exports. 10/14 PASSED. Defect candidates: section trash-lifecycle: locator.click: Timeout 30000ms exceeded. | section editor-core: locator.click: Timeout 30000ms exceeded. | section toolbar-marks: locator.click: Timeout 30000ms exceeded..
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2c-cards-bulk-editor-20261014-182449.json

### phase2c-cards-bulk-editor — 2026-10-14T18:26:58.994Z
- Phase 2 Batch C: cards/select-all/bulk (archive/restore/pin/unpin/assign-tags/assign-category/move-to-trash), trash lifecycle incl delete-forever, editor core (title/subtitle/body autosave/pin/trash/back + persistence reopen), toolbar marks + blocks + table + undo/redo + find bar + HTML source + file-menu exports. 36/36 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2c-cards-bulk-editor-20261014-182654.json

### phase2d-panels — 2026-10-14T18:29:53.670Z
- Phase 2 Batch D: revisions (open + restore), attachments (attach real PNG + rename + delete with cancel/confirm), reminders (validation, create, edit/snooze presence, delete + confirm), snapshots empty state, AI panel honest degradation + collapsed technical details. 10/14 PASSED. Defect candidates: section reminders: locator.click: Timeout 30000ms exceeded..
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2d-panels-20261014-182947.json

### phase2d-panels — 2026-10-14T18:32:52.398Z
- Phase 2 Batch D: revisions (open + restore), attachments (attach real PNG + rename + delete with cancel/confirm), reminders (validation, create, edit/snooze presence, delete + confirm), snapshots empty state, AI panel honest degradation + collapsed technical details. 16/17 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2d-panels-20261014-183250.json

### phase2d-panels — 2026-10-14T18:33:49.645Z
- Phase 2 Batch D: revisions (open + restore), attachments (attach real PNG + rename + delete with cancel/confirm), reminders (validation, create, edit/snooze presence, delete + confirm), snapshots empty state, AI panel honest degradation + collapsed technical details. 17/17 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2d-panels-20261014-183347.json

### phase2e-settings-dialogs — 2026-10-14T18:35:39.150Z
- Phase 2 Batch E: settings (theme live + persist via Save + Reset + unsaved-close, controls sweep, AI Test connection honest failure), backup export + restore review (cancel path), diagnostics full sweep (refresh/self-test/LM-fail/rebuild/export-review), palette (filter/keyboard/empty state/command families), save-page validation (empty + protocol), import workflows (md + sanitized html + invalid). 15/19 PASSED. Defect candidates: section settings-theme: locator.click: Error: strict mode violation: getByRole('button', { name: 'Open settings' }) resolved to 2 elements: | section settings-controls: locator.click: Error: strict mode violation: getByRole('button', { name: 'Open settings' }) resolved to 2 elements: | section backup: locator.click: Error: strict mode violation: getByRole('button', { name: 'Open settings' }) resolved to 2 elements:.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2e-settings-dialogs-20261014-183537.json

### phase2e-settings-dialogs — 2026-10-14T18:38:45.877Z
- Phase 2 Batch E: settings (theme live + persist via Save + Reset + unsaved-close, controls sweep, AI Test connection honest failure), backup export + restore review (cancel path), diagnostics full sweep (refresh/self-test/LM-fail/rebuild/export-review), palette (filter/keyboard/empty state/command families), save-page validation (empty + protocol), import workflows (md + sanitized html + invalid). 28/30 PASSED. Defect candidates: section settings-theme: locator.click: Timeout 30000ms exceeded..
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2e-settings-dialogs-20261014-183837.json

### phase2e-settings-dialogs — 2026-10-14T18:42:44.566Z
- Phase 2 Batch E: settings (theme live + persist via Save + Reset + unsaved-close, controls sweep, AI Test connection honest failure), backup export + restore review (cancel path), diagnostics full sweep (refresh/self-test/LM-fail/rebuild/export-review), palette (filter/keyboard/empty state/command families), save-page validation (empty + protocol), import workflows (md + sanitized html + invalid). 28/30 PASSED. Defect candidates: section settings-theme: locator.click: Timeout 30000ms exceeded..
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2e-settings-dialogs-20261014-184237.json

### phase2e-settings-dialogs — 2026-10-14T18:44:57.902Z
- Phase 2 Batch E: settings (theme live + persist via Save + Reset + unsaved-close, controls sweep, AI Test connection honest failure), backup export + restore review (cancel path), diagnostics full sweep (refresh/self-test/LM-fail/rebuild/export-review), palette (filter/keyboard/empty state/command families), save-page validation (empty + protocol), import workflows (md + sanitized html + invalid). 28/30 PASSED. Defect candidates: section settings-theme: locator.click: Timeout 30000ms exceeded. ||   - waiting for getByRole('button', { name: 'Save changes', exact: true }).first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2e-settings-dialogs-20261014-184450.json

### phase2e-settings-dialogs — 2026-10-14T18:46:02.725Z
- Phase 2 Batch E: settings (theme live + persist via Save + Reset + unsaved-close, controls sweep, AI Test connection honest failure), backup export + restore review (cancel path), diagnostics full sweep (refresh/self-test/LM-fail/rebuild/export-review), palette (filter/keyboard/empty state/command families), save-page validation (empty + protocol), import workflows (md + sanitized html + invalid). 32/32 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2e-settings-dialogs-20261014-184559.json

### phase2f-toolbar-media — 2026-10-14T18:49:56.459Z
- Phase 2 Batch F: remaining toolbar marks (strike/code/super/sub/clear), code block + HR, indent/outdent, align x4, table row/col/header ops, font size + colours + highlights + clears, link dialog (insert/edit/protocol-refusal), image dialog (file/alt/caption/resize), toolbar-group visibility setting, Apply-filters close-on-apply. 15/25 PASSED. Defect candidates: section font:   - waiting for getByLabel('Font size') | section link:   - waiting for locator('.ProseMirror').first().locator('a[href="https://example.com/docs"]').first() | section image: locator.fill: Error: strict mode violation: getByLabel(/Alt text/i) resolved to 2 elements:.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2f-toolbar-media-20261014-184947.json

### phase2f-toolbar-media — 2026-10-14T18:56:01.936Z
- Phase 2 Batch F (v2, verified locators): font size + hex colour swatches + highlights, marks (strike/code/super/sub/clear), align x4 via paragraph styles, code block + HR, indent/outdent, table ops, link dialog (insert/edit/refusal), image dialog (alt/caption/resize), toolbar-group visibility setting, filters save-as-view + chip switch. 21/25 PASSED. Defect candidates: section font: - waiting for getByLabel('Font size') | section image: - waiting for getByRole('button', { name: 'Full', exact: true }).
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2f-toolbar-media-20261014-185549.json

### phase2f-toolbar-media — 2026-10-14T19:01:58.841Z
- Phase 2 Batch F (v2, verified locators): font size + hex colour swatches + highlights, marks (strike/code/super/sub/clear), align x4 via paragraph styles, code block + HR, indent/outdent, table ops, link dialog (insert/edit/refusal), image dialog (alt/caption/resize), toolbar-group visibility setting, filters save-as-view + chip switch. 26/27 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2f-toolbar-media-20261014-190151.json

### phase2f-toolbar-media — 2026-10-14T19:05:48.513Z
- Phase 2 Batch F (v2, verified locators): font size + hex colour swatches + highlights, marks (strike/code/super/sub/clear), align x4 via paragraph styles, code block + HR, indent/outdent, table ops, link dialog (insert/edit/refusal), image dialog (alt/caption/resize), toolbar-group visibility setting, filters save-as-view + chip switch. 27/27 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2f-toolbar-media-20261014-190544.json

### phase2g-capture-persistence — 2026-10-14T19:15:22.123Z
- Phase 2 Batch G: entry shortcut Alt+Shift+C, REAL capture of https://example.com via save-page dialog, unreachable-host honesty, snapshots panel on real capture (exports/rename/preview), reload persistence, concurrent-tab conflict, attachments open/download, yearly + overdue-complete reminders, AI chat honest failure, JSON import, pagination with 52 notes, find-bar navigation. 3/13 PASSED. Defect candidates: section entry-shortcuts: - waiting for getByRole('button', { name: 'Open Untitled for editing' }).first() | section snapshots-real: - waiting for getByRole('button', { name: 'Export saved page…' }).first() | section persistence: - waiting for getByRole('button', { name: 'Open Capture host note for editing' }).first() | section attachments-rest: - waiting for getByRole('button', { name: 'Open Capture host note for editing' }).first() | section reminders-rest: - waiting for getByRole('button', { name: 'Open Capture host note for editing' }).first() | section ai-chat: - waiting for getByRole('button', { name: 'Open Capture host note for editing' }).first() | section find-bar: - waiting for getByRole('button', { name: 'Open Capture host note for editing' }).first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2g-capture-persistence-20261014-191501.json

### verify-d05-d06 — 2026-10-14T19:35:24.944Z
- QA-D05/D06 real-UI verification: Grant access affordance visible=VERIFIED; capture completed after grant=VERIFIED; link state after grant=CHECK; snapshot artifacts=CHECK
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d05-d06-20261014-193521.json

### verify-d05-d06 — 2026-10-14T19:38:16.224Z
- QA-D05/D06 real-UI verification: Grant access affordance visible=VERIFIED; capture completed after grant=VERIFIED; link state after grant=CHECK; snapshot artifacts=CHECK
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d05-d06-20261014-193814.json

### verify-e2e-capture — 2026-10-14T19:45:33.671Z
- E2E capture with seeded permission: 
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-194527.json

### verify-e2e-capture — 2026-10-14T19:46:29.914Z
- E2E capture with seeded permission: 
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-194623.json

### verify-e2e-capture — 2026-10-14T19:47:38.252Z
- E2E capture with seeded permission: 
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-194731.json

### verify-e2e-capture — 2026-10-14T19:48:42.945Z
- E2E capture with seeded permission: 
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-194836.json

### verify-e2e-capture — 2026-10-14T19:49:46.240Z
- E2E capture with seeded permission: 
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-194939.json

### verify-e2e-capture — 2026-10-14T19:50:11.152Z
- E2E capture with seeded permission: link state=[{"state":"captured","hasSnapshot":true}]; snapshots in DB=[{"mhtml":"failed","png":"saved","text":"saved","warnings":1; panel text=Snapshots1 snapshotClosepartialExample Domain2026-10-14 · Pa; E2E CAPTURE=VERIFIED_FIXED
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-e2e-capture-20261014-195009.json

### phase2h-final-rows — 2026-10-14T20:20:31.213Z
- Phase 2 Batch H (final 22 rows): filters apply-commits, card link/reminder/failed-capture indicators (real captured + really-failed links via pre-seeded permissions), pagination >50 notes with selection-clears, toolbar link/image/find/source-view under their inventory keys, find-bar nav/replace-all/match-case/close, paste+drop attach through real DOM events, attachment download/open, yearly reminder + Feb-29 + Apr-31 validation, overdue chip + complete, AI send honest degradation + permission-mode evidence, granted-sites Revoke, correct-fixture JSON import. 3/10 PASSED. Defect candidates: section qa113-link: - waiting for getByRole('button', { name: /^Save changes\*?$/ }).first() | section qa114-image: - waiting for getByRole('button', { name: /^Save changes\*?$/ }).first() | section find-suite: locator.fill: Error: strict mode violation: getByLabel('Find in note') resolved to 2 elements: | section qa138-paste-drop: - waiting for getByRole('button', { name: /^Save changes\*?$/ }).first() | section qa154-yearly: locator.fill: Error: strict mode violation: locator('dialog[open]').getByLabel('Time (local)') resolved to 2 elements: | section qa158-overdue: - waiting for getByRole('button', { name: 'Add reminder…' }) | section qa179-revoke: locator.click: Error: strict mode violation: locator('dialog[open] li, dialog[open] div').filter({ hasText: /qa-fail-host\.invalid/ }).first().getByRole('button', { name: 'Revoke', exact: true }) reso.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-final-rows-20261014-202010.json

### phase2h-restart — 2026-10-14T20:21:12.366Z
- Phase 2 Batch H phase C (restart + isolation): browser-restart persistence across full close/relaunch (notes + settings), two-dashboard-tab state isolation (no bleed; independent library/editor sessions). 0/1 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-restart-20261014-202105.json

### phase2h-final-rows — 2026-10-14T20:46:34.225Z
- Phase 2 Batch H part 1 (final rows minus pagination): find-bar suite (open/nav/match-case/replace-all/close), sanitised source view, toolbar link + image persistence, paste+drop attach through real DOM events, attachment download/open, yearly reminder + Feb-29 + Apr-31 validation, overdue chip + complete, REAL captured link + REAL failed link (capture tab closed mid-flight), card indicators incl. failed-capture tooltip, filters apply-commits, AI send honest degradation + permission-mode evidence, granted-sites Revoke, correct-fixture JSON import. 10/17 PASSED. Defect candidates: section qa154-yearly: - waiting for locator('dialog[open]').getByLabel('Kind', { exact: true }) | section qa158-overdue: - waiting for locator('dialog[open]').getByLabel('Kind', { exact: true }).
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-final-rows-20261014-204623.json

### phase2h-final-rows — 2026-10-14T20:52:14.873Z
- Phase 2 Batch H part 1 (final rows minus pagination): find-bar suite (open/nav/match-case/replace-all/close), sanitised source view, toolbar link + image persistence, paste+drop attach through real DOM events, attachment download/open, yearly reminder + Feb-29 + Apr-31 validation, overdue chip + complete, REAL captured link + REAL failed link (capture tab closed mid-flight), card indicators incl. failed-capture tooltip, filters apply-commits, AI send honest degradation + permission-mode evidence, granted-sites Revoke, correct-fixture JSON import. 18/21 PASSED. Defect candidates: none.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-final-rows-20261014-205205.json

### phase2h-pagination — 2026-10-14T20:53:05.837Z
- Phase 2 Batch H part 2: pagination with >50 notes (Next/Previous, selection cleared across pages). 2/2 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-pagination-20261014-205303.json

### phase2h-restart — 2026-10-14T20:53:21.198Z
- Phase 2 Batch H phase C (restart + isolation): browser-restart persistence across full close/relaunch (notes + settings), two-dashboard-tab state isolation (no bleed; independent library/editor sessions). 2/2 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase2h-restart-20261014-205319.json

### verify-d07 — 2026-10-14T21:04:42.029Z
- QA-D07 verification: failed-capture card found: true | Retry capture affordance visible: true | row text: Capture failed for https://qa-fail-host2.invalid.Retry capture | panel status after retry: Capture of https://qa-fail-host2.invalid re-queued — the archived copy appears here when i | affordance gone after successful re-queue: true | link state after retry: [{"state":"captured","snapshotId":"3e24ce88-0461-4f2d-acbc-3101e4c03a34"}]
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d07-20261014-210439.json

### phase3a-workflows — 2026-10-14T21:12:00.700Z
- Phase 3 part A (WF-01..WF-07 create/modify families): rich-note authoring end-to-end, web-capture journey with exports, note JSON export→import round-trip, reminder lifecycle (Due→Snooze→Complete), restructure+persist, bulk organize (tag/favorite/archive/restore), trash lifecycle incl. permanent delete. 3/3 PASSED. Defect candidates: section wf01-rich-note: - waiting for getByRole('button', { name: '• List' }) | section wf04-reminder-lifecycle: - waiting for locator('article.card').filter({ hasText: 'Rich journey note' }).first().getByRole('button', { name: /Open Rich journey note for editing/ }).first() | section wf05-restructure: - waiting for locator('article.card').filter({ hasText: 'Rich journey note' }).first().getByRole('button', { name: /Open Rich journey note for editing/ }).first() | section wf06-bulk-organize: - waiting for getByLabel('New tags (comma-separated)').
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3a-workflows-20261014-211137.json

### phase3a-fixup — 2026-10-14T21:14:45.638Z
- Phase 3 part A fixup (WF-01/04/05/06 with corrected locators): rich-note authoring end-to-end, reminder lifecycle, restructure+persist, bulk organize. 1/3 PASSED. Defect candidates: section wf06-bulk-organize: - waiting for getByRole('button', { name: 'Favorite', exact: true }).
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3a-fixup-20261014-211433.json

### phase3a-fixup2 — 2026-10-14T21:17:25.977Z
- Phase 3 part A fixup2 (WF-01 anchor / WF-05 align / WF-06 bulk with design-aware selection handling): 1/2 PASSED. Defect candidates: section wf05-align: - waiting for locator('article.card').filter({ hasText: 'Rich journey note' }).first().getByRole('button', { name: /Open Rich journey note for editing/ }).first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3a-fixup2-20261014-211719.json

### verify-d08 — 2026-10-14T21:28:13.829Z
- QA-D08 verification: before replace: {"h2":1,"li":2,"tr":2,"pre":1,"img":1} | after replace: {"h2":1,"li":2,"tr":2,"pre":1,"img":1,"redacted":true,"leftover":false} | after reopen: {"h2":1,"li":2,"tr":2,"pre":1,"img":1,"redacted":true,"leftoverText":false} | VERDICT: STRUCTURE PRESERVED (fixed)
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d08-20261014-212811.json

### phase3b-workflows — 2026-10-14T21:36:13.847Z
- Phase 3 part B (WF-01/05 final on the fixed build + WF-08..WF-16): rich-note authoring, restructure with structure preserved, search journey (tag/phrase/exclusion/sort), saved view growth, revisions restore, settings live-effect journey, backup export→preview→merge-restore, mid-edit navigation, smart-list chain with selection reset, cancel flows, universal Escape dismissal. 4/6 PASSED. Defect candidates: section wf05-final: - waiting for locator('article.card').filter({ hasText: 'D08 rich verify' }).first().getByRole('button', { name: /Open D08 rich verify for editing/ }).first() | section wf10-revisions: - waiting for getByRole('button', { name: /^Revisions/ }).first() | section wf11-settings-journey: - waiting for getByRole('button', { name: 'Open Untitled for editing' }).first() | section wf13-mid-edit: - waiting for locator('article.card').filter({ hasText: 'Journey complete' }).first().getByRole('button', { name: /Open Journey complete for editing/ }).first() | section wf15-cancels: - waiting for getByRole('button', { name: 'Cancel', exact: true }).first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3b-workflows-20261014-213550.json

### phase3b-fixup — 2026-10-14T21:41:02.130Z
- Phase 3 part B fixup (WF-05/10/11/13/15 with view-state + label corrections): 3/4 PASSED. Defect candidates: section wf11-settings-journey: - waiting for getByRole('button', { name: /^Save changes\*?$/ }).first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3b-fixup-20261014-214047.json

### phase3b-fixup2 — 2026-10-14T21:42:38.019Z
- Phase 3 part B fixup2 (WF-11 with the live-theme/draft-gated-save semantics): 1/1 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3b-fixup2-20261014-214237.json

### phase3c-workflows — 2026-10-14T21:46:55.263Z
- Phase 3 part C (WF-17..WF-21 + WF-22 part 1): second capture + duplicate decision + Compare + Delete snapshot (QA-147/149 re-covered), capture failure → retry through the QA-D07 affordance, two-tab conflict resolution via Save-as-duplicate, malformed imports rejected honestly, research-session journey, journal note with pasted image. 4/5 PASSED. Defect candidates: section wf19-conflict-resolution: - waiting for locator('.ProseMirror').first().locator('p').first().
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3c-workflows-20261014-214640.json

### phase3c-restart — 2026-10-14T21:47:01.467Z
- Phase 3 part C phase C (WF-22 journal continuity across browser restart): 1/1 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3c-restart-20261014-214700.json

### phase3c-fixup — 2026-10-14T21:47:55.327Z
- Phase 3 part C fixup (WF-19 with the note opened in tab 2 first): 1/1 PASSED.
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-phase3c-fixup-20261014-214753.json

### verify-d09 — 2026-10-14T21:57:35.040Z
- QA-D09 verification + WF-17 completion: capture cards: 3 | Capture fresh copy… affordance visible: true | snapshot rows: 0 → 1 | Compare… buttons: 1 | example.com link states: ["detected","captured","detected"] | VERDICT: recapture=true, compare(QA-147)=false, delete(QA-149)=true
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d09-20261014-215732.json

### verify-d09-v2 — 2026-10-14T21:59:33.248Z
- QA-D09 v2 verification (original note, same-link recapture → two snapshots → compare): cards: 3 (targeting the last/oldest) | snapshot rows before recapture: 1 | Capture fresh copy… visible: true | snapshot rows after recapture: 2 | Compare… buttons: 2 | VERDICT: recapture=true, compare(QA-147)=true
- Evidence: /home/z/my-project/repo-local-notes/artifacts/human-qa/logs/session-verify-d09-v2-20261014-215931.json

