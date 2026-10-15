# Coverage Gaps — every control, feature, state and interaction not exercised, with precise reasons

Statuses follow the brief: BLOCKED / NOT RUN / INCONCLUSIVE. Nothing here is silently dropped; each entry states the exact reason and, where applicable, what partial/indirect evidence exists.

## Environment-blocked (cannot be exercised in this container at all)

| # | Area | Reason | Partial evidence |
|---|---|---|---|
| 1 | **Local AI round-trip** (chat, tool calls, Approve-once/Deny permission flow, model list) | No LM Studio (or any OpenAI-compatible loopback server) exists in the audit sandbox; the brief forbids cloud fallbacks. | Honest-degradation states fully verified (P6/P8/P9: input+send disabled, truthful connection failures). AI panel DOM/labels verified. |
| 2 | **Web-page capture pipeline** (queue, MHTML, CDP PNG, text extraction, snapshots panel with data, compare, export MHTML/PNG/text, duplicate-capture dialog) | The URL gate rejects loopback/internal by design (SECURITY.md) and the sandbox provides no capturable external web pages; capture requires an origin permission grant from real browsing. | Snapshots panel honest empty state verified (P5). URL-gate logic and pipeline covered by 23 repo unit tests + paste-refusal repo E2E; audit adds no new runtime evidence. |
| 3 | **Reminder alarm firing, notification delivery, missed-occurrence coalescing** | Requires wall-clock wait + OS/browser notification integration; container has no notification daemon. | Creation/validation/lifecycle fully verified (R1–R6, F1/F2 durability); documented limitation confirmed as disclosed (KNOWN_LIMITATIONS.md). |
| 4 | **Quick-capture context menus** (background context-menu flow) | No web pages to right-click; context menu lives outside the dashboard surface. | Code-inspected (`src/background/context-menus.ts`); not runtime-tested. |
| 5 | **Attachment row actions: Download / Open / Rename / Delete** | Unreachable because no attachment can ever be created (defect D-04 blocks the only creation path). | Control inventory rows C-82; panel DOM verified to render actions per row in source. |
| 6 | **Extension install/update/reload over an existing profile (unpacked-move identity)** | Profile identity games (moving the unpacked folder) are outside the safe audit scope on this container; zip-acceptance suite in the repo covers fresh extract-and-load. | Repo zip-acceptance 4/4 re-run green at audit HEAD. |

## Not run (safe to exercise, but not exercised in this audit — honest accounting)

| # | Control / scenario | Reason | Risk assessment |
|---|---|---|---|
| 7 | Editor toolbar **Ordered list** toggle | Bullet + task lists exercised; ordered shares the list-extension family | Low |
| 8 | **Indent / Outdent** list buttons | Not exercised; covered by unit tests of the list commands | Low |
| 9 | **Header cell toggle** (table) | Insert/+row/+col exercised | Low |
| 10 | **Font size select** | Headings used for block sizing instead | Low |
| 11 | **Clear formatting** button | Marks verified individually | Low |
| 12 | **Editor help** dialog (documentation viewer) | Not opened | Low |
| 13 | **Import MD into this note** (in-editor toolbar) | Sidebar-level MD/HTML import fully verified (C2) | Medium-low |
| 14 | **Export note as HTML / JSON** | Export-as-Markdown verified end-to-end (E9) | Medium-low |
| 15 | **Note-level JSON export → import round-trip** | Both halves untested (see 13/14) | Medium |
| 16 | Find bar **Match case / Previous / Next** | Count + replace-all + close verified (E7) | Low |
| 17 | Settings **auto-capture-on-paste** checkbox | Requires capture pipeline (blocked) | Low |
| 18 | Settings **duplicate capture mode** radios | Requires captures | Low |
| 19 | Settings **reminder notifications** checkbox | OS notifications blocked | Low |
| 20 | Settings AI **enable/endpoint/model/permission-mode** mutations | Blocked by no server; only Test connection verified | Medium |
| 21 | Reminder **Complete / Dismiss / Stop recurrence** buttons | Need an active reminder + state passage; delete/snooze/edit verified | Medium-low |
| 22 | **Note-level duplicate** flow (editor `duplicateWithContent`) | Duplicate dialog exists for captures; note-level path not driven | Medium-low |
| 23 | Selection × search-requery direct combo | Partially covered via P-01/P-02 | Low |

## Inconclusive

| # | Item | Detail |
|---|---|---|
| 24 | **Input-stall phenomenon** (pass-b-panels P4) | After a revision-restore on a very rich note, Playwright-dispatched input intermittently stalled while DOM state was clean. Root cause undetermined (tooling vs renderer). The affected reminders lifecycle was re-verified green in a fresh session (R1–R6). Fallbacks logged in session evidence. |
| 25 | **Recovery journal acceptance flow** | F4 observed the post-reload state and recorded it; the offered-recovery accept path could not be deterministically forced before autosave in this environment (partially timing-dependent). No corruption observed either way. |

## Requirement-level gaps (features promised but absent — see defects.md D-01..D-03)

- Favorites UI (FR-NOTE-05) — unreachable.
- Filter UI + saved views (FR-SEARCH-03) — empty disclosure; chips never populate.
- Sort direction control (FR-SEARCH-06) — fixed desc.
- Attachments/backup features exist in docs+source but are broken at runtime (D-04/D-06) — the docs describe them as working, which is not true of the shipped build.

## What IS fully covered (for contrast)

Core notes CRUD + full rich-text toolbar matrix; tags/categories/pin/archive/trash/restore/permanent-delete with cancel-safety; search incl. operators; sort/pagination/views; command palette; import md/html + failure paths; MD export; revisions + restore; multi-tab conflicts; reminders lifecycle + validation; settings theme/toolbar-groups + honest LM test; diagnostics full sweep; onboarding first-run; offline; full-restart durability; unicode/emoji/long-content boundaries; session hygiene (0 errors/0 external requests) across every audit session.
