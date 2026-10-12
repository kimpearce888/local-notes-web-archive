# plan.md — Complete Implementation Plan

Every task below is required for the production release. Nothing is omitted or
deferred. Task IDs are stable; `progress.md` is the active queue (copy of this list);
`completed.md` receives each finished task record.

Legend for output areas: `core` = src/core, `bg` = src/background, `ui` = src/dashboard,
`docs` = repository documents, `tests` = automated tests, `build` = tooling/release.

---

## A. Foundations

### T-001 Project management files
Create `/ai/rule.md`, `/ai/plan.md`, `/ai/progress.md`, `/ai/completed.md`. Commit and
push. This file set is the mandatory protocol anchor.

### T-002 Repository scaffolding
`.gitignore` (node_modules, dist, coverage, artifacts), `LICENSE` (MIT, copyright
holder "Local Notes & Web Archive contributors"), full `README.md` (scope, Chrome 120+
requirement, install/pin/update/uninstall, data-loss warnings, backup guide),
`docs/` folder, `tests/` folder, `src/` tree, `.env.example` (test-harness vars only:
`CHROME_CHANNEL`, `TEST_TIMEOUT_MS`), `Dockerfile.test` + `docker-compose.yml`
(dev/test-only runner for lint/typecheck/unit tests — runtime stays dependency-free
per PRD §1/§7). No secrets, no personal paths.

### T-003 Toolchain and pinned dependencies
`package.json` (private, exact pinned versions), install: typescript, vite,
@tiptap/core + @tiptap/pm + @tiptap/starter-kit + open-source Tiptap extensions
(underline, text-align, text-style, color, highlight, subscript, superscript,
task-list, task-item, table family, image, link, placeholder, character-count),
@types/chrome, dompurify, minisearch, fflate, marked, turndown, vitest,
@playwright/test, eslint + typescript-eslint. Commit `package.json` +
`package-lock.json`. Configure `tsconfig.json` (strict, ES2022, chrome types),
`vite.config.ts` (extension build → `dist/`, multiple entries: service worker,
dashboard, offscreen-free), `eslint.config.js`, `vitest.config.ts`,
`playwright.config.ts`, npm scripts (`build`, `check`, `test`, `test:e2e`, `lint`,
`release`). Validation: `tsc --noEmit`, `eslint .`, `vitest run` all green on hello-world
test.

## B. Core domain

### T-004 Core domain types
`core/types.ts`: Note, Tag, Category, NoteTag, NoteCategory, Link, Snapshot,
Attachment, Reminder, RecurrenceRule, Revision, AuditEvent, DiagnosticLog, AppSettings,
SaveState, CaptureStatus, AiPermissionMode, ToolCallStatus, entity UUID branded types,
ISO-8601 UTC event timestamps, explicit local datetime + IANA timezone for reminders.
Data-model invariants encoded as TypeScript discriminations (PRD §6).

### T-005 Utility foundations
`core/util/`: UUID v4 generator (crypto.randomUUID with fallback), clock/ISO helpers,
SHA-256 content hash (WebCrypto), bounded-string helpers, URL normalization +
deduplication key, redaction helper for URL query secrets, deep-freeze for test
fixtures. Unit tests for each helper.

### T-006 IndexedDB schema and migrations
`core/db/open.ts`, `core/db/schema.ts`, `core/db/migrations.ts`: database
`local-notes-web-archive` v1 with object stores + indexes for notes, tags, categories,
note_tags, note_categories, links, snapshots, attachments, reminders, revisions,
audit_events, diagnostic_logs, settings, search_index meta; Blob storage keys for
MHTML/PNG/attachment payloads; versioned idempotent migrations with failure path that
preserves data, stops writes, surfaces actionable error (FR-DATA-06). Unit tests with
fake-indexeddb.

### T-007 Repository: notes and revisions
`core/repo/notes.ts`, `core/repo/revisions.ts`: transactional CRUD, duplicate,
archive/restore, trash/restore/permanent-delete guard, createdAt-once semantics,
updatedAt-on-commit, bounded revision history (default 20, configurable) with restore
as new revision (FR-NOTE-01..03, 06), conflict detection via revision compare
(FR-NOTE-07). Unit tests.

### T-008 Repository: tags, categories and joins
`core/repo/tags.ts`, `core/repo/categories.ts`: normalized unique keys, create/rename/
merge/delete-with-reassignment, nested categories with cycle prevention, join records
(FR-NOTE-04). Bulk ops: tag/category assignment (FR-NOTE-08). Unit tests incl. cycle
rejection and merge reassignment.

### T-009 Repository: links, snapshots, attachments
`core/repo/links.ts`, `core/repo/snapshots.ts`, `core/repo/attachments.ts`: link
records with normalized dedup keys and origin, snapshot records with per-artifact
state (MHTML/PNG/text), content-hash verification, previous-snapshot chaining
(FR-CAP-08), attachment verified MIME + hash + Blob keys, size accounting. Unit tests.

### T-010 Repository: reminders, audit, logs, settings
`core/repo/reminders.ts` (canonical recurrence records, FR-REM-04),
`core/repo/audit.ts` (actor/action/target/approval/outcome, content hashes not bodies,
FR-LOG-02), `core/repo/logs.ts` (rolling 5 MB bound + rotation, FR-LOG-04),
`core/repo/settings.ts` (chrome.storage.local-backed small settings, FR-DATA-01
boundary). Unit tests incl. rotation and retention bounds.

### T-011 Search engine
`core/search/`: MiniSearch adapter over normalized projections (title, subtitle, body
plain text, tags, categories, link URL/title, captured page title/text, attachment
filenames — FR-SEARCH-01); query syntax parser (quoted phrases, `-term`, `tag:`,
`category:`, `before:`, `after:`, `has:link|snapshot|reminder|attachment`,
`is:pinned|archived|trashed|overdue`, `in:title|body|snapshot`, with inline error
explanations — FR-SEARCH-04); filters (date ranges, reminder states, capture date,
source domain — FR-SEARCH-03); relevance/prefix/fuzzy modes (FR-SEARCH-02); sort
orders (FR-SEARCH-06); saved views persistence; transactional index updates + corrupt-
index rebuild from canonical records (FR-SEARCH-05). Full unit-test matrix.

## C. Extension runtime

### T-012 Service worker core
`bg/index.ts`: message router (typed request/response with correlation IDs),
toolbar action opens/focuses single dashboard tab (PRD §4.1), configurable command
shortcut default (Alt+Shift+N checked for conflicts), context menu actions
(save-current-page link capture, save-selection-as-note) — no silent tab/history
inspection; install/update lifecycle: alarm reconciliation trigger, onboarding flag;
stateless design, durable state only from IndexedDB (PRD §8.1).

### T-013 Manifest and icons
`public/manifest.json` (MV3): required permissions storage, unlimitedStorage, alarms,
notifications, scripting, pageCapture, debugger; optional host permissions
`http://*/*`, `https://*/*`; loopback host permissions `http://127.0.0.1/*`,
`http://localhost/*`; commands; context menus; CSP `script-src 'self'`;
`connect-src` narrowed to `self` + loopback; minimum_chrome_version 120. Icons
16/32/48/128 generated (deterministic geometric design script → PNG), action icon,
documented extension-ID stability via shipped public key. Validation: build output
loads as unpacked extension (structure check + manifest schema test).

### T-014 Dashboard shell
`ui/` entry: responsive layout in PRD §4.1 order (New Note → search → filters/views/
sort → results), theme (light/dark/system), semantic HTML, visible focus, keyboard
operability, ARIA live regions for save/capture/AI states, screen-reader
announcements, empty/error/loading states, no color-only status (PRD §11
accessibility, WCAG 2.2 AA target). CSS design system in one stylesheet with custom
properties.

### T-015 Dashboard state manager + messaging client
`ui/state/`: store with subscription model, message client to service worker
(typed), optimistic UI with truthful rollback, save-state indicator (`Saving/Saved/
Save failed`), beforeunload guard against pending saves (PRD §4.3).

### T-016 Cards and list views
`ui/views/`: card fields (title, subtitle, chips, created/modified, reminder state,
link/snapshot indicators, plain-text preview with safe truncation — PRD §4.2), grid +
list toggle, pinned/favorites/recent/overdue smart lists, pagination/virtualization
(windowed rendering), multi-select bulk actions (assign tags/categories, pin, archive,
trash with confirmation + audit) — FR-NOTE-05/08. Unit tests for view-model logic.

## D. Editor

### T-017 Editor core with full feature matrix
`ui/editor/`: Tiptap/ProseMirror configured with exactly PRD §4.4: paragraphs,
headings 1–6, bold/italic/underline/strikethrough/inline code, sub/superscript, font
size + text color + highlight (custom TextStyle-based fontSize extension), 4
alignments, ordered/unordered/task lists with indent/outdent where structurally valid,
blockquotes, horizontal rules, code blocks with language label (lowlight), clear
formatting, links with edit dialog + safe external opening, tables (row/col insert/
delete, header cells, alignment, selection), images (alt, caption, resize controls),
attachments UI, find-in-note bar with replace, selection tools, rich/plain paste
handling, HTML source view guarded by DOMPurify, Markdown import/export (marked +
turndown round-trip), keyboard shortcuts, placeholder text, accessible toolbar labels,
selection preservation, reliable undo/redo. In-app documentation of toolbar + schema
(PRD §4.4 last paragraph). Unit tests for schema round-trips and sanitize gates.

### T-018 Autosave, revisions and recovery
Autosave writes full document + plain-text projection transactionally with visible
state; survive tab close/service-worker restart; navigation guard; undo/redo retained;
most-recent-recoverable-edit recovery after unexpected failure (PRD §4.3); revision
history panel with preview/restore (FR-NOTE-06); conflict dialog for multi-tab edits
(reload/compare/save-as-duplicate — FR-NOTE-07). Unit tests incl. simulated crash
sequence.

### T-019 Images and attachments pipeline
Local-file insert, clipboard paste and drag/drop for images → Blob store with hash,
alt text, caption, resize controls; file attachments with filename/type/size display
and download/open actions (chrome.downloads not permitted — use anchor-download via
object URLs in dashboard context); size limits with truthful errors. Tests for
dedup-by-hash and limits.

## E. Capture

### T-020 URL detection and link queue
Detect pasted HTTP/HTTPS URLs in title/body (auto-capture on paste when enabled),
manual typed URLs detected but never auto-visited (FR-CAP-01); link records with
queue status surfaced in note + dashboard; URL gate (FR-CAP-04): scheme allowlist,
credentials rejection, localhost/link-local/private/reserved-IP block, browser-internal
scheme rejection. Unit tests for the full gate matrix.

### T-021 Origin permission manager
Per-origin optional host permission request only from user gesture (`Allow access and
capture`), exact-origin requests, declined = retained link + `permission required`
status, no silent retry, revocation UI in settings (FR-CAP-02, FR-SET-03); revoked
permission handling in capture flow. Unit tests for state machine.

### T-022 Capture queue and orchestration
Sequential single-tab queue with cancel/retry, dedup options, progress events,
concurrency=1 hard limit, time/size budgets (FR-CAP-03); temporary inactive tab
lifecycle with guaranteed cleanup; redirect validation — abort extraction if final
origin not authorized (FR-CAP-04). Unit tests with mocked chrome APIs.

### T-023 MHTML capture and snapshot persistence
`chrome.pageCapture.saveAsMHTML` on the temporary tab → Blob in IndexedDB; snapshot
record: source URL, validated final URL, title, timestamp, content hash, extracted
text, format, status, warnings (FR-CAP-05); failed artifact never overwrites previous
success; status model queued/permission-required/capturing/complete/partial/failed/
canceled with per-artifact states (FR-CAP-07); recapture → new revision by default,
replace-on-confirmation option (FR-CAP-08). Unit tests.

### T-024 Text extraction
Narrowly scoped injected script (`chrome.scripting`) after load+settling: visible
readable text extraction, title, canonical URL, warnings for lazy/oversized/frames
where detectable (FR-CAP-09); stored separately for search. Unit tests on fixture
HTML (jsdom-based extraction core).

### T-025 CDP full-page PNG
`chrome.debugger` attach to temporary capture tab only; hard allowlist:
`Page.getLayoutMetrics`, `Page.captureScreenshot`; tiled capture for very tall pages
with configurable pixel/byte ceiling; detach in `finally`; never inspect cookies/
network; failure → PNG marked partial/failed with reason, MHTML+text retained
(FR-CAP-10, §15). Do not activate tab for screenshot. Unit tests for allowlist +
tiling math.

### T-026 Snapshot management UI
Preview (PNG + extracted text, never MHTML rendering — FR-CAP-06), export MHTML/PNG/
text as user-initiated downloads, compare-by-timestamp view, rename, delete,
duplicate-URL reuse confirmation. Snapshot indicators in cards/notes.

## F. Reminders

### T-027 Reminder engine
Recurrence semantics: one-time; yearly month/day with inclusive final year or until
stopped; Feb-29 policies (Feb 28 / Mar 1 / skip — default Feb 28, FR-REM-03); local
wall-clock + IANA timezone representation; DST gap/repeat determinism (FR-REM-07);
snooze, complete, dismiss; multiple reminders per note (FR-REM-01/02). Pure engine +
exhaustive unit tests (leap years, DST transitions, year boundaries, recurrence stop).

### T-028 Alarms, notifications and reconciliation
Canonical records in IndexedDB, alarms as hints only; reconcile on install/update,
worker startup, browser startup, reminder change (FR-REM-04); `chrome.alarms` +
`chrome.notifications` with OS/browser settings respect; overdue shown in dashboard
even if notifications denied; missed occurrences coalesced into one concise
notification + dashboard state (FR-REM-05); honest limits messaging (FR-REM-06).
Alarm-loss and restart tests.

## G. Local AI

### T-029 LM Studio client
Service-worker-only fetch client to OpenAI-compatible loopback endpoints
(default `http://127.0.0.1:1234/v1`, localhost accepted, port configurable, loopback
enforced — FR-AI-01/02); connection test, model listing/selection, tool-use test,
timeout, structured errors (FR-AI-03); AI unavailable ⇒ graceful degradation of AI
features only (FR-AI-10).

### T-030 Tool contract and dispatcher
17 validated tools with strict JSON schemas, input bounds, ID validation,
relationship checks, pagination, structured results: search_notes, get_note,
create_note, update_note, duplicate_note, archive_note, restore_note, trash_note,
manage_tags, manage_categories, list_reminders, create_reminder, update_reminder,
complete_reminder, search_snapshots, get_snapshot_text, recapture_url,
get_diagnostics (FR-AI-05); model proposes, app validates/executes (FR-AI-06);
fail-closed on malformed/unknown/injection; bounded outputs; cancellation/timeout;
exact partial-completion reporting (PRD §9). Unit tests: schema rejects, bounds,
permission matrix, injection corpus.

### T-031 Permission modes and AI panel
Modes: read-only / ask-before-every-write (default) / safe-writes-with-confirm-for-
destructive; permanent deletion always confirmed (FR-AI-07); AI panel in dashboard +
editor: search, summarize, action items, tag/category proposals, duplicate
suggestions, note create/edit, link summaries, reminder ops, natural-language query →
filter; AI-generated data visibly marked until saved (FR-AI-04); status per tool call
(proposed/awaiting-approval/running/succeeded/failed/canceled); approval UI + audit
events. Unit tests for mode gating.

### T-032 Prompt hygiene and disclosure
Minimum-content selection policy (FR-AI-09), untrusted-input containment (FR-AI-08 —
webpage/note/imported text can't alter policy/permissions/trigger destructive ops or
extra captures), no prompt/content in technical logs; settings + docs state internal
tool-calling ≠ external MCP server, no server status faked (FR-MCP-01..03). Injection
test corpus passes.

## H. Data lifecycle

### T-033 Backup export
Complete ZIP backup via fflate: manifest/schema version, notes + relationships,
reminders, revisions, snapshots (MHTML/PNG blobs), attachments, preferences,
timestamps, hashes, license/version report (FR-DATA-03); progress + truthful failure
states; nothing uploaded. Unit test round-trip.

### T-034 Backup restore
Format/schema/size/path/hash validation before any write; preview; merge and replace
modes; replace requires explicit confirmation; failed restore leaves DB untouched
(FR-DATA-04); reference validation on import; idempotent re-restore. Failure-path unit
tests (corrupt zip, wrong version, hash mismatch → DB unchanged).

### T-035 Note-level and snapshot export/import
Note JSON/Markdown/sanitized-HTML export + import; snapshot MHTML/PNG/text export
(FR-DATA-05); import sanitization gates; no uploads. Round-trip unit tests.

### T-036 Storage health
`navigator.storage.persist()`, usage estimation, per-kind size reporting (archives,
attachments, logs), configurable warnings (FR-DATA-02); explicit data-loss warnings
before destructive reset + uninstall guidance (FR-DATA-07). Settings surfaces.

## I. Observability

### T-037 Structured logging and audit
Structured logs: timestamp, severity, component, operation/correlation IDs, duration,
result code, sanitized errors (FR-LOG-01); audit trail actor/action/target/approval/
outcome + changed-field names/hashes (FR-LOG-02); redaction rules — no passwords/
tokens/full prompts/note bodies/archived HTML/attachment content/history; URL query
redaction (FR-LOG-03); bounded rotation (FR-LOG-04); log export never blocks note
writes. Unit tests for redaction + rotation.

### T-038 Diagnostics page
Extension/build version, Chrome version, DB schema, storage usage, index status,
permissions granted, notification status, LM Studio reachability/model, last capture
failures, recent sanitized errors; opt-in "Export diagnostics" with review step
(FR-LOG-05); network privacy self-test verifying only capture + loopback traffic
exists (FR-SET-04).

## J. Settings, onboarding, release

### T-039 Settings and onboarding
Settings: theme, default view/sort, saved views, auto-capture on paste, allowed
origins + revocation, capture limits, duplicate handling, reminder notification
preferences, leap-day behavior, editor toolbar config, revision retention, backup
warnings, AI permission mode + endpoint config + tests (FR-SET-01); first-run
onboarding: local storage, permissions, LM Studio optional, reminder limits,
data-loss risk; core flows usable with AI/notifications off (FR-SET-02).

### T-040 Documentation bundle
README final polish; `THIRD_PARTY_NOTICES.md` + `DEPENDENCIES.json` (direct +
transitive, exact versions, SPDX, source URLs); `PRIVACY.md`; `PERMISSIONS.md`;
`KNOWN_LIMITATIONS.md`; `BACKUP_RESTORE.md`; `SECURITY.md` (PRD §14). Generated from
the actual pinned lockfile by script — no manual drift.

### T-041 Unit test completion sweep
Fill gaps to coverage targets: data invariants (§6), error-state matrix (§12) for
save-failed/conflict/migration-failed/storage-full/permission-denied/URL-unsupported/
capture-timeout/partial/failed/backup-invalid/restore-failed/notifications-denied/
reminder-missed/AI-unavailable/tool-malformed/tool-denied. All vitest suites green.

### T-042 Playwright E2E smoke suite
Launch persistent context with `dist/` unpacked: toolbar opens dashboard; create →
edit (bold/heading/list/link) → autosave indicator → search finds note → filter →
pin/archive/trash/restore → export note MD → reload dashboard → data persisted;
capture queue UI states with stubbed origin; offline mode: notes/search/export keep
working. (Blocked-capture/AI paths assert graceful error states.)

### T-043 Release verification gate
`npm run build` → `dist/` manifest scan: no remote URLs in code/CSP, all assets
local, icons present, permissions match PERMISSIONS.md; `npm run release` produces
versioned zip + SHA-256 checksums; performance spot-check documented (dashboard
shell < 1.5 s, 10k-note search < 500 ms p95 with seeded index); accessibility
keyboard pass; final commit of verification report into `docs/RELEASE_VERIFICATION.md`.

---

## Task → PRD traceability

All FR-IDs (NOTE 01–08, SEARCH 01–06, CAP 01–10, REM 01–07, AI 01–10, MCP 01–03,
DATA 01–07, LOG 01–05, SET 01–04), §4.4 editor matrix, §6 invariants, §8 architecture,
§9 AI safety, §10 privacy/security, §11 NFRs, §12 error states, §13 acceptance gates
and §14 documentation are covered by tasks T-001..T-043 above. No requirement is
scheduled for a later phase.
