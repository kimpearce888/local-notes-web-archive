# T-072 — Discovery Inventories (v1.0.5, live-verified 2026-10-14)

Protocol source: external QA brief sections AUTOMATIC FEATURE DISCOVERY,
AUTOMATIC INTERACTION DISCOVERY, WORKFLOW DISCOVERY. Method: live Playwright
walk of every reachable screen in the built dist/ (t072-inventory.spec.ts,
1357 raw records → deduped ledger) cross-referenced with the T-062 audit
ledgers (7-pass, 118 controls) and the source tree. Raw data:
`t072-live-controls.json`, `control-inventory-v105.csv`.

## 1. Screen inventory (17 screens live-verified)

| # | Screen | Live controls | Reachable from |
|---|--------|--------------|----------------|
| 1 | onboarding (first-run dialog) | 24 visible | fresh profile |
| 2 | dashboard (empty state) | 22 visible | onboarding dismiss |
| 3 | dashboard (list + cards) | 22 visible | note exists |
| 4 | editor (note detail) | 88 visible | card open / New Note |
| 5 | editor-attachments panel | 90 visible | editor toolbar |
| 6 | editor-snapshots panel | 88 visible | editor toolbar |
| 7 | editor-reminders panel | 88 visible | editor toolbar |
| 8 | editor-findbar | 88 visible | Ctrl+F in editor |
| 9 | command palette | 53 visible | Ctrl+K / toolbar |
| 10 | filters panel | 37 visible | topbar Filters |
| 11 | bulk bar | 37 visible | card checkbox |
| 12 | AI panel | via editor/sidebar | AI toolbar button |
| 13 | settings dialog | 49 visible | sidebar Settings |
| 14 | diagnostics dialog | 43 visible | sidebar Diagnostics |
| 15 | view: trash | 37 visible | sidebar smart list |
| 16 | view: favorites | 37 visible | sidebar smart list |
| 17 | view: pinned | 37 visible | sidebar smart list |

Context-gated surfaces (verified present in source + T-062 E2E, opened only
on demand): tag dialog, category dialog, duplicate-capture dialog, confirm
dialogs (trash/purge/restore), reminder add/edit dialog, image/link dialogs,
diagnostics export review, backup restore preview, capture permission
dialog, editor revision compare view, onboarding re-show.

## 2. Feature inventory (source + live cross-verified)

Notes CRUD (create/edit/autosave/title/subtitle), rich-text editor
(TipTap: 40+ formatting actions individually live-verified — headings
h1–h6, bold/italic/underline/strike, inline code, sub/superscript, text
colour ×6, highlight ×5 + remove, lists, indent/outdent, quote, code block,
tables insert/add-row/add-col/delete-row/delete-col/header-toggle, image
with alt, link, HTML source view, undo/redo, find/replace with match case),
tags & categories (assign dialogs + card chips), pin/favorite/archive/
trash/restore/purge, revisions (history + restore), attachments
(attach files…, download, delete — v1.0.5-fixed transport), snapshots
(MHTML/PNG/text capture + export), reminders (recurrence, Feb-29 policy,
final year, timezone, complete/snooze/dismiss), search (query syntax,
filters panel with 10+ filter controls, saved views, sort field + direction
v1.0.5, relevance ranking), command palette, import (JSON/MD/HTML + into
current note), export (note MD, diagnostics, backup), backup/restore
(v1.0.5-fixed), settings (theme, defaults, toolbar visibility, AI config
with Load models/Test connection, capture options), diagnostics (refresh,
self-test, export, index rebuild, storage stats), onboarding, AI panel
(ask/approve/deny, permission modes), offline operation.

## 3. Interaction inventory

138 unique visible controls live-harvested in this walk + the T-062 ledger's
context-gated dialog controls (reminder dialog 8 fields, tag/category
inputs, confirm dialogs, image/link dialogs, capture permission, export
review dialogs). Keyboard shortcuts live-verified: Ctrl+K (palette),
Ctrl+F (find), / (focus search), Alt+Shift+C (new note), Escape (close
dialogs), Ctrl+B/I/U/Y/Z (formatting). Full CSV:
`control-inventory-v105.csv` (stable selector, role, accessible name,
type, disabled, visible per screen).

### v1.0.5 additions verified live (delta vs T-062 inventory)
- Favorites: bulk-bar Favorite/Unfavorite + editor Favorite toggle (T-064)
- Filters panel: Apply filters, Clear all, Save as view…, state/reminder/
  snapshot/tag/category/date/source-domain controls, removable chips (T-065)
- Sort direction: Descending/Ascending select (T-066)
- Attachments: Attach files…, Files to attach list (T-063)
- Settings AI: Load models, Test connection (live-verified reachable)
- Import markdown into this note; Export this note as markdown
- Navigation: Skip to notes list (a11y jump link), grid/list view toggle,
  pagination Previous/Next page, Select all notes on this page

## 4. Workflow inventory (recursive: action → dialog → workflow → screen)

34 workflows verified end-to-end in the T-062 audit (lifecycle, toolbar
matrix, reminders, multi-tab, restart durability, offline, imports,
palette, diagnostics, honest AI degradation) — all still covered by the
repo's 66-test E2E battery re-run green in T-070. v1.0.5 workflows added
and covered by the audit-defect regression suite (8 E2E specs, green in
T-070): real file attach → download → delete; backup export → verify →
restore round-trip; favorite from bulk bar and editor; filters apply →
chip remove → saved view persist across reload; sort direction toggle;
onboarding re-show completion; rapid-creation page-slice invariant.

Primary/secondary/edge/hidden workflow classes per the brief:
- Primary: note create→edit→save→find→reopen; capture→snapshot→export;
  reminder create→notify→complete; backup→restore.
- Secondary: tag/category assignment; import; saved views; sort/filter
  combinations; settings changes; AI ask with approve/deny.
- Edge: empty/whitespace/unicode titles; duplicate capture decision;
  revision restore; trash→restore→purge; offline AI failure.
- Hidden (context-revealed): onboarding re-show (Help), find bar,
  HTML source view, diagnostics export review, capture permission dialog,
  revision compare, bulk actions bar.

## 5. Reconciliation statement

Every control in the T-062 ledger is either (a) live-verified in this
walk, (b) individually enumerated now (previously grouped, e.g. TipTap
toolbar actions), or (c) context-gated behind a dialog this navigation
sweep did not open — category (c) is covered by the source inspection
here and will be exercised by the T-073..T-076 deep-testing passes.
No documentation-invented controls: every inventoried item was found in
the source tree AND the running build, or carries its source location.
