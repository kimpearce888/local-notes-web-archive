# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## K. User-reported bug-fix round

### T-054 User-reported bug fixes: reminder dialog field sizing and editor pin/trash actions
Two user-reported defects (screenshots 2026-10-13): (1) the Add-reminder
dialog fields render ~352px tall with the Time zone field cut off —
`.search-input`'s `flex: 1 1 22rem` (authored for the horizontal search
form) applies its flex-basis to HEIGHT inside the column-flex
`.dialog__field`; (2) pin and trash actions are entirely absent from the
editor, so a user inside a note cannot pin it or move it to trash. Fix
both with scoped CSS + editor-header actions wired through new session
callbacks, plus unit and E2E regression coverage.
