# progress.md — Active Task Queue

Contains only incomplete tasks. On completion a task moves to completed.md
(same commit) per ai/rule.md §8. Do not reorder; execute top-down.

## Queue

### T-064 Fix D-01: favorite toggle in the bulk bar and the editor header
See ai/plan.md §L. Bulk action kind 'favorite' + editor-header toggle wired
through notes/set-flags so the Favorites smart list becomes reachable.

### T-065 Fix D-02: build the Filters region UI (FR-SEARCH-03)
See ai/plan.md §L. Real filter controls in #filters-region, active-filter
chips, and named saved views persisted via AppSettings.savedViews.

### T-066 Fix D-03: sort direction control (FR-SEARCH-06)
See ai/plan.md §L. Ascending/descending select in the toolbar + persisted
default-sort direction in settings.

### T-067 Fix D-05: re-enable Get started when onboarding re-shows
See ai/plan.md §L. Reset the button state on overlay re-open.

### T-068 Fix D-07: keep the page-1 slice invariant after rapid creation
See ai/plan.md §L. Requery instead of unbounded optimistic prepend when the
page slice is already full.

### T-069 Re-release v1.0.5 with the T-063..T-068 audit fixes
See ai/plan.md §L. Full re-release protocol so the installable artifact
carries all six audit-fix tasks.
