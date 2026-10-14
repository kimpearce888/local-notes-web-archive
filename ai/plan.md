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
Also populate `SearchHit.matchedFields` (currently always `[]` — decoration gap
left by T-011) with per-field matches computed from scoped per-field MiniSearch
queries, with tests.

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

## J. Final QA, Playwright & release protocol (post-plan acceptance round)

User-mandated final acceptance round before COMPLETE. Any issue found enters the
bug-fix loop: add task → fix → test → move to completed.md → commit → push.

### T-044 Production rebuild and full-suite baseline
Fresh `npm run build`; `npm run verify` (lint + tsc strict + full vitest);
`npm run test:e2e` over the real dist/ in persistent Chromium — re-verify every
existing gate before new coverage lands. Zero failures allowed.

### T-045 Human-simulation and adversarial Playwright suite
New E2E spec driving the app exactly like a real user: fast/repeated clicks
(rapid New Note, double-submit guards), invalid and empty inputs (empty title,
empty search, non-numeric values in numeric settings fields), malicious inputs
(XSS payloads in title/body via real clipboard paste, javascript: URL in the
link dialog), multiple dashboard tabs, full browser-restart persistence (context
close → relaunch same profile), navigation sweep across all smart lists,
permanent delete from Trash, theme setting persisting across reload, zero
uncaught page errors and zero non-loopback network requests during the session.
Persona coverage: new user (first-run onboarding), returning user (restart +
persisted data), power user (bulk ops, keyboard), invalid/malicious user (above).
Auth flow N/A — the extension is account-less by design (PRD §1); first-run
onboarding is the equivalent entry journey.

### T-046 ZIP package acceptance test (extract → load → use)
Playwright spec that treats the release ZIP as the product: extract
`release/local-notes-web-archive-<version>.zip` into a scratch directory with
fflate, verify the extracted inventory against RELEASE_MANIFEST.txt, then load
the EXTRACTED folder (not dist/) as an unpacked extension in a fresh persistent
context and verify installation, service worker, dashboard shell, note
create/save/search, settings dialog — no build steps, usable immediately after
extraction exactly like the user workflow (Download → Extract → Load Unpacked →
Use). Popup-equivalent and content-script-equivalent surfaces verified honestly:
the manifest has no popup (action opens the dashboard) and no declared content
scripts (capture injects via chrome.scripting + CDP) — assert the actual paths.

### T-048 Bug fix: image-source privacy guard and pasted-HTML sanitisation
Added by the bug-fix loop when the T-045 adversarial suite found real issues:
(1) image nodes accepted arbitrary src values and the node view assigned them
to the live DOM — pasted remote images would have been fetched by the browser
(an external network request in a local-first extension, PRD §10) and relative
srcs produced resource-load noise against the extension origin; (2) the
sanitize gate's single URI regexp admitted https?: for image srcs (the link
policy had leaked into the image policy); (3) clipboard HTML entered
ProseMirror unsanitised (the schema filtered the resulting document, but the
raw HTML with inline handlers still reached Chromium's parsers); (4) the
onboarding completion flag lived in chrome.storage.local, which is not durable
across browser restarts for unpacked installs while IndexedDB is — and the
onInstalled('install') reset re-armed the walkthrough for returning users.
Fix: split image-src policy (data:image + attachment: only) with truthful
removal reporting; render-time refusal with honest status; paste gate through
sanitizeEditorHtml before parsing; onboarding flag in the IndexedDB settings
record with no install-time reset. Unit + E2E coverage; full regression.

### T-047 Release packaging and GitHub Release with ZIP upload
Regenerate the release artifact (`npm run release`), place
`release/local-notes-web-archive-1.0.0.zip` + .sha256 + RELEASE_MANIFEST.txt,
then create GitHub Release v1.0.0 (tag on main) via the GitHub REST API using
credentials read at runtime from the local git credential store (never committed)
and upload the ZIP (+ checksum + manifest) as release assets; verify the release
and asset download URLs; add the download/install workflow to README.

## K. Repository audit, screenshots and marketing README

User-mandated presentation round. Same bug-fix loop discipline applies.

### T-049 Complete repository audit
Full audit for the record and for honest marketing numbers: repo structure
and tracked-file stats, commit history, source/test line counts, secrets scan
(worktree + full git history), npm audit over pinned dependencies, permission
and CSP verification re-run, docs completeness, release artifact integrity
re-verification. Findings recorded in completed.md and reflected truthfully
in the README quality section.

### T-050 Professional screenshots from the live extension
Load the built extension in a persistent Chromium context, drive it through
the real UI to seed realistic demo data (rich notes, tags, categories, pinned
note), and capture retina-quality screenshots: dashboard (light), rich-text
editor, search with results, dashboard (dark), diagnostics. Compose a social
banner (1280x640) for link previews. Store under docs/screenshots/ with
README-referenced alt text. No mocks — the real app, really working.

### T-051 Marketing-ready README and GitHub metadata
Rewrite README.md production-first: value proposition, badges, screenshots,
features, install-from-release workflow, search syntax, local AI, privacy
guarantees, quality/verification numbers from the audit, documentation table,
FAQ, development-from-source, license. SEO/SMO: keyword-rich headings and
copy, descriptive image alt text, social banner, GitHub repository
description + topics + homepage updated through the REST API (token read at
runtime from the credential store, never committed). All docs tests stay
green; relative links resolve; honest limits stay visible.

### T-052 Added by the bug fix loop when the T-050 screenshot review (vision QA over the
real UI) noticed the editor's find/replace bar visible without ever pressing
Ctrl+F. Root cause: components toggle visibility with the `hidden` attribute
while their CSS classes carry author `display` rules, which override the UA
stylesheet's `[hidden] { display: none }`: `.editor-find` (display: flex — the
find bar rendered permanently in the editor) and `.settings__check`
(display: inline-flex — the destructive restore confirmation checkbox
revealed regardless of the chosen restore mode, weakening the data-loss
safety flow). `.editor-image__controls` already carried a specific per-class
[hidden] rule and never leaked; the global guard generalises that pattern.
Fix: a single global `[hidden] { display: none !important }` guard at
the end of styles.css so the attribute always wins for every current and
future element; regression tests: a static CSS guard test (guard present
and ordered after every display rule), a real-browser computed-style check
in the E2E suite (find bar hidden by default, visible on Ctrl+F, hidden
again after Close), and the T-050 screenshots re-captured against the
fixed build.

### T-053 Re-release v1.0.1 with the T-052 fix and final protocol re-run
The v1.0.0 release artifact predates the T-052 hidden-attribute bug fix (the
dist was rebuilt with the guard but the release zip was never regenerated, so
the published artifact still ships the permanently-visible find bar and the
leaked destructive-restore checkbox). Bump package.json +
public/manifest.json to 1.0.1 (semver patch for a product bug fix), rebuild
the production dist, re-run the full gate battery (eslint, tsc strict,
vitest, perf), regenerate the release zip via npm run release (new sha256),
run the full Playwright suite (including the zip-acceptance extract-and-load
suite against the NEW artifact), publish GitHub Release v1.0.1 with the three
assets via npm run publish-release, update README install links and docs
pins to 1.0.1, regenerate docs/REPOSITORY_AUDIT.md at the final HEAD, and
verify the uploaded asset digest through the REST API (download-back +
byte-identical sha256). The v1.0.0 release stays untouched as the historical
record.


### T-055 Re-release v1.0.2 with the T-054 fixes
The v1.0.1 release artifact predates the T-054 user-reported fixes (the
reminder-dialog field sizing and the editor pin/trash actions). Bump
package.json + package-lock + public/manifest.json + src/core/version.ts
to 1.0.2, update the version-pinning tests (manifest mirror, core/types
metadata, diagnostics-api overview) and the README install links, rebuild
the production dist, re-run the full gate battery (eslint, tsc strict,
vitest, perf), regenerate the release zip via npm run release (new
sha256), run the full Playwright suite (including the zip-acceptance
extract-and-load against the NEW artifact and the T-054 regression
specs), publish GitHub Release v1.0.2 with the three assets via npm run
publish-release, refresh the verification-doc numbers, and verify the
uploaded asset digest through the REST API (download-back +
byte-identical sha256).

### T-056 UI/UX redesign — design system, sidebar app shell, command palette
The user-supplied redesign brief (Google Docs, 2026-10-13) directs a full
visual redesign toward "a local-first Obsidian alternative with Linear's
polish and Arc's modern feel" while preserving 100% feature parity: no
changes to business logic, behavior, data structures, storage, APIs,
permissions, search/AI/reminder/archive logic or import/export — only UI,
UX, layouts, navigation, typography, colors, spacing, components,
animations, accessibility, information architecture, responsiveness and
empty/loading/error states. Foundation task: (1) a refreshed token system
in styles.css (Linear-style dark-first palette, tighter type scale,
consistent radii/spacing/motion) with the light/system themes kept in
WCAG-AA parity; (2) the dashboard shell restructured from the stacked
top-heavy layout into a persistent left sidebar (brand, New Note CTA,
vertical smart-lists navigation, secondary actions footer) plus a content
column with a topbar (search with Ctrl+K affordance, filters, sort, view
toggle) — every existing element id, accessible name, aria attribute,
data-action hook and the PRD §4.1 DOM order preserved so all 773 unit
tests and 49 E2E tests keep passing; responsive breakpoints collapse the
sidebar gracefully; (3) a NEW view-layer command palette (Ctrl+K) that
surfaces EXISTING actions only (new note, import, smart-list navigation,
settings, diagnostics, theme preference) with keyboard-first
filtering/arrow navigation, Radix-style focus containment and Escape
close — no business logic, purely navigation/UX as the brief's
"Command Palette (Ctrl+K)" item requires. Unit tests for the palette
semantics and the preserved shell contract ship with the task.

### T-057 UI/UX redesign — component visual pass
Second redesign task, same parity constraints: restyle every remaining
surface to the new design language — note cards (hierarchy, chips, hover
elevation, selected state), region states (empty/loading/error glyphs and
copy hierarchy), all dialogs (backdrop, header structure, field
grouping), the editor session (header action grouping with Back primary,
panel toolbars, prose typography with readable measure), revision /
attachments / snapshots / reminders / AI panels, settings and diagnostics
dialogs (section rhythm, row hierarchy), onboarding, bulk action bar
(floating centered bar), pagination, status bar, and the responsive
passes for each. DOM changes are limited to decorative structure (icons,
grouping wrappers) that never alters accessible names, roles or the
pinned CSS regressions (T-052 hidden guard, T-054 dialog-field sizing).

### T-058 UI/UX redesign — mandatory QA, human testing, screenshot proof
The brief mandates: do not assume anything works; test like a real user;
validate notes CRUD + restore, search, archives, reminders, AI features,
settings, navigation, keyboard shortcuts, command palette, responsive
layouts, accessibility; run lint, type checks, unit, integration, E2E and
production build; fix every issue found; continue until none remain.
Execute the full battery (eslint, tsc strict, vitest 773+, perf suite,
all Playwright suites against the rebuilt dist/ including
human-simulation personas and zip acceptance), extend the screenshot
suite to prove every surface the brief lists (dashboard, notes/editor,
search, archives/trash view, reminders dialog, AI panel, settings,
command palette, responsive layouts, plus light and dark themes), and
drive the app like a real user to catch regressions. Any defect found is
fixed and re-tested in this task.

### T-059 UI/UX redesign — v1.0.3 release
Per the brief's release requirements: verify all tests pass, verify no
functionality changed and no regressions remain, generate the production
build, increment the version (1.0.2 -> 1.0.3 in all five authoritative
places plus the three version-pinning tests and README/docs pins), write
release notes and a redesign QA report (docs), package the final release
via npm run release, re-run verify-release, publish GitHub Release v1.0.3
with the three assets, verify the uploaded digest byte-identical, and
regenerate docs/REPOSITORY_AUDIT.md at the final HEAD.

### T-060 User-reported bug fixes: system-theme active nav contrast and note-card reading order
Found by the user testing the v1.0.3 redesign (screenshot 2026-10-13,
pixel-verified against the build). Two real defects, nothing else changes.
(1) "All notes" button invisible in the sidebar: the active smart-list
button painted dark navy `#23273f` behind `var(--color-text)` — under the
DEFAULT theme preference 'system' with a light OS the text token resolves
to the light-theme near-black `#17181d`, so dark text sat on a dark navy
pill (contrast ~1.2:1). Root cause: the dark-theme active-nav override
listed `[data-theme='system']` selectors OUTSIDE any media query, so the
dark background applied even when the OS was light; the correct
`@media (prefers-color-scheme: dark)` system rule already existed below
it. Fix: drop the two unconditional system selectors so the dark override
keys off explicit dark + the existing OS-dark media query only — system
+light now renders the light `--color-accent-soft` pill with dark text
(~13:1). (2) Note cards read body-first: renderCard appended subtitle and
preview BEFORE the title (DOM order subtitle, preview, title, meta, one
inline chips row), so cards showed body text above the title, and tags,
categories, link and reminder chips all shared ONE inline row. Fix: strict
reading order title -> subtitle -> body preview -> tags row -> categories
row -> indicator row -> meta, with tags and categories on SEPARATE rows
(never inline with each other), empty rows omitted, and per-row
aria-labels. Regression coverage: unit CSS guard
tests/unit/dashboard/smart-nav-theme-css.test.ts (dark override excludes
system selectors outside the media query; the media block carries the
system rule; light base uses the token pill), card-order assertions added
to tests/unit/dashboard/cards.test.ts (exact child order, tags/categories
row separation, empty-row omission), and E2E additions to
tests/e2e/user-report-regressions.spec.ts (computed background/color of
the active nav button under system+light with a WCAG contrast computation;
card children order through the real UI for a note carrying subtitle,
body, a tag AND a category).

### T-061 Re-release v1.0.4 with the T-060 fixes
The T-060 fixes (system-theme active-nav contrast, note-card reading
order) live on main but the installable v1.0.3 zip predates them — a user
installing from the release page would still hit both defects. Re-release
so the shipped artifact carries them: version bump 1.0.3 -> 1.0.4 in all
five authoritative places (package.json, package-lock.json via
npm install --package-lock-only, public/manifest.json, src/core/version.ts
APP_VERSION, README install links) plus the three version-pinning tests
(manifest mirror, core/types metadata, diagnostics-api overview.app.version)
and the docs zip-name pins; refresh the release-notes template with a
"What's new in v1.0.4" section describing the two fixes and correct the
stale gate numbers to the measured 797/797 vitest + 58/58 Playwright;
re-verify docs/RELEASE_VERIFICATION.md for 1.0.4; run the full gate battery
on the final code (eslint, tsc strict, vitest 797/797, perf suite,
Playwright 58/58 including zip-acceptance against the NEW artifact);
npm run release to regenerate the zip + .sha256 + RELEASE_MANIFEST.txt;
publish GitHub Release v1.0.4 with the three assets; verify the uploaded
digest and download the zip back through the API byte-identical; regenerate
docs/REPOSITORY_AUDIT.md at the final HEAD. No source changes beyond the
version pins and docs — the fixes themselves are already merged (T-060).

### T-062 Universal human-behavior QA audit (external brief)
User-supplied audit brief (Google Drive, 2026-10-14): act as a meticulous
human user, exploratory QA engineer, accessibility tester and
test-coverage analyst over the ENTIRE application at the current build.
This is an audit/testing task, NOT an implementation task: no product code
changes, no test weakening, no fixes during the audit. Deliverables are
saved OUTSIDE the repository (user-accessible download directory), per the
brief: environment + test-target record (repo URL, branch, HEAD SHA,
working-tree status, OS, Node/npm, Chromium/Playwright versions);
discovered test counts from the runners' own list commands (not badges);
the repo's declared checks re-run fresh at the audit HEAD; a discovery
ledger built from product UI + source tree + docs + test tree + runtime
(application-map.md, control-inventory.csv, feature-workflow-matrix.csv,
state-transition-matrix.csv, existing-test-coverage.md); scenario
generation from the actual app inventory across the 17 brief-defined
classes; exploration passes A-G (unscripted discovery, control sweep,
end-to-end workflows, boundary/invalid/cancel/failure, cross-feature and
timing, persistence/restart/round-trip, regression repeat); state-model
coverage accounting with PASS/FAIL/BLOCKED/NOT RUN/INCONCLUSIVE statuses
per control and transition; evidence rules (real UI actions only — no RPC
or database shortcuts — screenshots, console/network observation, synthetic
marker strings, persisted-outcome verification); honest handling of
environment-blocked areas (local LM Studio absent, capture permissions,
reminder wake limits); defect handling per brief §9 (preserve, repeat,
classify against requirements vs documented limits, hypothesis labeling);
final deliverables (executive summary, application map, control inventory,
feature/workflow/state/cross-feature matrices, scenario catalog, test
command results, defects, coverage gaps, existing test coverage, evidence
directory) with exact counts computed from the ledgers and explicit
separation of observed fact vs code-inspection finding vs requirement
mismatch vs hypothesis vs environment limitation. Audit automation lives
outside the tracked tree (local exclude only); the repository working tree
stays clean; only this ai/ record is committed.

---

## L. QA-audit defect remediation and v1.0.5 re-release

The T-062 universal human-behavior QA audit (external brief, 2026-10-14)
confirmed 7 defects with reproducible evidence across the shipped v1.0.4
build. Per the maintainer's go-ahead the defects are now FIXED (the audit
itself stayed hands-off per its §9). Each defect gets a full
implement-validate-commit-push cycle; T-069 then re-releases so the
installable artifact carries every fix, following the established
re-release protocol (T-048/T-055/T-059/T-061).

### T-063 Fix D-04+D-06: base64 binary codec for the RPC channel (attachments, backup, blob returns)
Both critical audit findings share one root cause: chrome.runtime.sendMessage
JSON-serializes payloads/results, so every File/Blob crossing the channel
arrives as `{}` — killing attachments end-to-end (D-04: 'data must be a
Blob'), backup export AND restore (D-06: createObjectURL overload failure /
'expected the backup file'), and by the same class the not-yet-audited
blob-returning RPCs (attachments/get-blob, snapshots/get-png,
snapshots/export, notes/export-file). Fix: a transparent binary transfer
codec at the two channel boundaries only — the dashboard client's
request() encodes payload Blobs into a `{__lnwaBinary: true, mimeType,
base64}` envelope and decodes envelope results back into Blobs; the service
worker's onMessage listener decodes incoming payloads before router dispatch
and encodes Blob results before sendResponse. Handlers, call sites and the
ApiContract stay Blob-typed — the envelope is purely the wire format, and
handler `instanceof Blob` guards now validate the REBUILT blobs (honest
validation semantics preserved). Codec: depth-bounded deep walk (plain
objects/arrays only), chunked btoa/atob (32 KiB slices, no stack overflow),
strict envelope validation on decode (PayloadValidationError on malformed
base64/shape). Tests: codec round-trip units (nested payloads, File subclass,
empty and large blobs, malformed envelopes, depth bound), a JSON-clone
transport regression test that emulates the REAL channel semantics
(JSON.parse(JSON.stringify(message)) — the exact test whose absence let D-04
ship), and E2E specs exercising a real file attach through the panel
file-picker plus backup export/restore round-trip in the built artifact.

### T-064 Fix D-01: favorite toggle in the bulk bar and the editor header (FR-NOTE-05)
Favorites were unreachable: the background fully supports `favorite` in
notes/set-flags, the smart list and card badge exist, but no UI control ever
set the flag. Fix: add `{ kind: 'favorite'; value: boolean }` to the bulk
action union with Favorite/Unfavorite buttons (mirroring Pin, gated by a new
viewAllows.favorite), wire it in the controller through notes/set-flags, and
add a Favorite editor-header toggle mirroring the T-054 Pin button
(callbacks.setFavorite → notes/set-flags, live label swap, honest failure
announcements, disabled while in flight). The Favorites smart list then
populates truthfully.

### T-065 Fix D-02: build the Filters region UI (FR-SEARCH-03)
The topbar Filters button opens an empty disclosure: shell.ts creates
#filters-region and emits filtersToggle with no listener and no controls —
while the underlying Filters engine (search/query) fully supports every
FR-SEARCH-03 field. Fix: a filters panel module that renders real controls
into the region — created/modified date ranges, tag and category
multi-selects (from allTags/allCategories), pinned/favorite/has-attachment
tri-state selects, note-state select, reminder-state select, snapshot-status
select, capture-date range, source-domain input — wired to a controller
handler that merges the selections into state.filters, re-queries at page 1,
and renders removal chips into #active-filters (one chip per active filter,
click to remove; Clear all). Saved views: persisted via the existing
AppSettings.savedViews (already typed, never used) — save the current
query+filters under a name, list saved-view chips in the toolbar, click to
apply, remove to delete (settings/patch persists). Unit tests for the panel
state mapping (Filters ⇄ controls) and chip rendering; E2E: open filters,
apply a tag filter, observe narrowed results + chip, remove chip, save a
named view, reload, apply it.

### T-066 Fix D-03: sort direction control (FR-SEARCH-06)
Sort direction was hard-coded desc with no ascending control anywhere
(store default, toolbar, settings). Fix: an ascending/descending select in
the toolbar next to the field select (aria-labelled, data-action hook),
emitting a shell event the controller wires into
store.setState({sort:{field,direction}}) + requery at page 1; settings'
default-sort gains the same direction pair so the persisted default
honors FR-SEARCH-06 on startup; 'relevance' keeps direction hidden where
meaningless per the PRD's "where meaningful" wording. Unit tests for the
event wiring and settings persistence; E2E asserts Title asc puts
'Alpha' before 'Gamma' (the audit's exact repro, now inverted to PASS).

### T-067 Fix D-05: re-enable Get started when onboarding re-shows
The re-shown onboarding's primary button is permanently disabled: the click
handler sets startButton.disabled = true and only re-enables on failure, so
after the first successful completion the persisted overlay presents the
already-spent button (Escape-only exit, verified by the audit). Fix: reset
the button state whenever the overlay is re-opened (open() sets
startButton.disabled = false) — one line, plus a regression test that
completes onboarding once, re-shows it, and asserts the button is enabled
and completes again.

### T-068 Fix D-07: keep the page-1 slice invariant after rapid creation
createNote() optimistically prepends every new note to state.notes without
any page-boundary check, so 52 rapid creations render 52 cards on "Page 1
of 2" until a reload self-heals. Fix: when the current page slice is already
full (notes.length >= pageSize), skip the optimistic prepend and requery()
after the create RPC resolves instead — the honest paginated window with the
new note at its sorted position; otherwise keep the existing optimistic
prepend (page not full → placeholder remains instant). Regression test:
fill a page beyond pageSize through rapid creation and assert the rendered
card count never exceeds pageSize with the pagination label consistent.

### T-069 Re-release v1.0.5 with the T-063..T-068 audit fixes
The v1.0.4 zip predates all six fix tasks, so the installable artifact
carries the two critical transport breakages and the four requirement
mismatches. Re-run the full re-release protocol (T-061 pattern): version
1.0.4 -> 1.0.5 in all five authoritative places (package.json,
package-lock.json, public/manifest.json, src/core/version.ts, README install
links), update the three version-pinning tests and doc zip-name pins, add
the release-notes section describing the audit fixes, re-run the full gate
battery (build, eslint, tsc strict, vitest, perf, full Playwright suite
including zip-acceptance against the NEW artifact and the audit-defect
regression specs), regenerate release/local-notes-web-archive-1.0.5.zip +
.sha256 + RELEASE_MANIFEST.txt, publish GitHub Release v1.0.5 with API
verification (asset digest match, tag == HEAD, byte-identical download),
re-verify docs/RELEASE_VERIFICATION.md, regenerate
docs/REPOSITORY_AUDIT.md at the release HEAD, and record the audit-deliverable
supersession note (the defects.md fixes are now shipped).

---

## Task → PRD traceability

All FR-IDs (NOTE 01–08, SEARCH 01–06, CAP 01–10, REM 01–07, AI 01–10, MCP 01–03,
DATA 01–07, LOG 01–05, SET 01–04), §4.4 editor matrix, §6 invariants, §8 architecture,
§9 AI safety, §10 privacy/security, §11 NFRs, §12 error states, §13 acceptance gates
and §14 documentation are covered by tasks T-001..T-043 above; the post-plan
acceptance round T-044..T-047 (final QA, human-simulation Playwright, ZIP
acceptance, GitHub Release) closes the user-mandated release protocol. No
requirement is scheduled for a later phase.

### T-054 User-reported bug fixes: reminder dialog field sizing and editor pin/trash actions
Found by the user testing the released build (screenshots 2026-10-13). Two
real defects: (1) The "Add reminder" dialog fields render ~352px (22rem)
tall and the dialog overflows the viewport so the Time zone field is cut
off — root cause: `.search-input { flex: 1 1 22rem }` was authored for the
horizontal dashboard search form, but inside `.dialog__field` (a
flex-direction: column container) the 22rem flex-BASIS applies to HEIGHT
and flex-grow stretches each select/input into a giant empty box (the
Kind select, the datetime-local picker, month/day/time, final year, Feb-29
policy, zone). Fix: a scoped rule resetting dialog field sizing (flex: 0 0
auto; width: 100%) so form controls render at natural height. (2) Pin and
Trash are impossible from the editor: the editor header only offers
Back/Revisions/Attachments/Snapshots/Reminders/AI/File-export, so a user
working inside a note has no pin or trash path at all (the reported "pin,
trash is not working from editor"). Fix: add Pin/Unpin and a confirmed
Move-to-trash action to the editor header via new session callbacks
(notes/set-flags, notes/trash) wired through the controller, with honest
announcements, the confirm dialog pattern from the bulk bar, autosave
flush before trash, and the editor closing back to the list after the
note moves to trash. Regression coverage: unit tests for the new CSS rule
order + the pin/trash session flow, and an E2E spec asserting the reminder
dialog fields are natural-height with the zone field visible, and that
pin/trash work end-to-end from the editor. (The find-bar regression the
user also screenshotted is the T-052 defect already fixed and
regression-covered in v1.0.1 — the screenshot predates that release; no
code change needed there, only the version note to the user.)

---

## M. Full QA & release validation program (external protocol, Google Doc 2026-10-14)

The maintainer supplied a second external brief (Google Docs
`1v4E7RF7HxM10KodNikRSGT68cAYYY39ES9p0A8-gNNE`) that shifts the agent's
role from feature implementation to QA Engineer / Test Engineer /
Automation Engineer / Security Tester / Performance Engineer / Bug Hunter /
Release Manager, under a ZERO-TRUST principle (documentation, prior
validation, green gates and completion claims are not trusted — everything
is re-verified through actual execution). The mandated cycle is
DISCOVER → TEST → BREAK → FIX → RETEST → REGRESSION TEST → VALIDATE →
RELEASE. Unlike the T-062 audit (hands-off), this protocol REQUIRES fixing
every discovered defect (fix → retest → regression loop) and re-releasing
only after every release gate passes, including two consecutive
independent verification passes that find no new defects. Evidence lives
under /home/z/my-project/qa-evidence/{screenshots,videos,logs}/ (the
brief's /qa-evidence path mapped inside the sandbox); final reports are
also copied to /home/z/my-project/download/ for the maintainer.

### T-070 Program queue + zero-trust baseline re-validation
Queue this program (this section + progress.md), then re-run EVERY declared
check fresh at HEAD 92fece2 with recorded exact commands, exit codes and
discovered counts (npm ci state, eslint, tsc strict, vitest with the
runner's own count, perf, full Playwright battery incl. zip-acceptance,
verify-release, audit:repo). Nothing from the T-069 record is trusted
without a fresh execution. Output: /home/z/my-project/qa-evidence/logs/
baseline-gates.txt.

### T-071 Fake-implementation detection + feature completeness validation
Full-source scan for TODO/FIXME/HACK/MOCK/STUB/PLACEHOLDER/TEMP markers,
simulated responses, fake success messages, dummy data, mock APIs,
incomplete handlers and disabled functionality (test fixtures are the sole
sanctioned exception per rule.md §2). Cross-check the implementation
against PRD.md feature matrix (FR-NOTE/SEARCH/CAP/REM/AI/MCP/DATA/LOG/SET,
§4.4 editor matrix, §6 invariants) + README + KNOWN_LIMITATIONS: identify
missing, partially implemented, broken, hidden, stub or placeholder
features. Output: feature-gap-report.md (Feature Gap Report).

### T-072 Feature / screen / interaction / workflow inventories (live re-verification)
Regenerate the four discovery inventories against the CURRENT v1.0.5 build
(the T-062 ledgers predate the filters panel, favorites controls, sort
direction, working attachments/backup): feature inventory, screen
inventory, interaction inventory (every button/input/select/shortcut/
dialog action with stable id + aria name), workflow inventory (recursive:
action → dialog → workflow → screen → further actions). Source tree +
live UI as equal authorities; docs are not. Output: coverage ledgers under
qa-evidence/ + updated control-inventory.csv.

### T-073 Security testing + permission audit + secret scan
E2E security battery in the real browser: note titles/content/tags with
XSS payloads (`<script>`, `<img onerror>`, event handlers, `javascript:`
links), stored-XSS persistence across reload, imported-HTML sanitization
(DOMPurify boundary), capture URL gate (internal schemes, credentials-in-
URL, localhost/private ranges — loopback only for LM Studio), no unexpected
network calls (CSP + remote-origin assertion), storage-leak check
(diagnostics export content audit). Permission audit: every manifest
permission justified against PERMISSIONS.md; no unused permissions; no
unused host_permissions. Secret scan of the repository AND the release
artifact (token/credential/API-key patterns, .gitignore coverage, git
history spot-check). Any security defect blocks release.

### T-074 Performance testing + memory-leak testing
Measured, recorded numbers in the real browser: dashboard initial load,
route/panel transitions (editor open/close, palette, filters), search
performance at 10k-corpus scale (already budgeted p95 < 500ms — re-measured
fresh), large-dataset rendering (1k+ visible cards pagination), and memory
growth over repeated loops (navigation cycles, modal open/close ×N, search
×N, workflow executions ×N) monitoring heap size, listener counts and
detached-DOM growth via CDP metrics. Regression thresholds: load < 2s,
transition < 500ms, search p95 < 500ms, heap growth bounded (< 25% after
10 cycles). Output: performance-report.md with raw measurements.

### T-075 Data integrity + network resiliency
CRUD matrix with durable verification: persistence after refresh, after
extension reload, after browser restart, second-tab consistency, import/
export round-trip byte-fidelity, trash/restore/purge boundaries, revision
recovery. Network resiliency: offline mode (fully local by design —
assert no network dependency), slow/timeout LM Studio endpoint degradation
(honest fail-closed errors, no fake success), service-worker restart
mid-operation. Any data integrity issue blocks release.

### T-076 Accessibility + control-state sweep + human-like input patterns
Keyboard-only full walkthrough (tab order, visible focus, dialog focus
containment, Escape/Enter semantics), ARIA names for every inventoried
control (re-verified live), contrast spot-checks, zoom/narrow-viewport
behavior. State sweep: every control in default/hover/focus/active/
loading/success/error/empty/disabled states where reachable. Human-like
patterns: slow usage, rapid clicking, double-click guards, keyboard-only,
mouse-only, mixed input, large content, empty content, invalid content,
special characters/emoji, navigation interruptions, session restoration.
Output: a11y-state-report.md; screenshots of every failure.

### Continuation (queued dynamically per findings, following the T-062 → T-063..T-069 pattern)
Fix tasks for every defect confirmed in T-070..T-076 (numbered from the
next free ID, one task = one commit = one push, fix → retest → regression
suite), then: upgrade testing (install v1.0.4 → create real data → upgrade
to the current build → data/settings/migrations survive; same from
v1.0.5), rollback validation (previous version restorable, data intact,
downgrade path documented), artifact inspection (zip contents: required
files, no dev/test/debug/temp files, no secrets), Chrome extension
validation (manifest valid, SW operates, reload/restart/upgrade survival),
dependency audit (vulnerable/abandoned/duplicate dependencies), evidence
consolidation (screenshots for every listed area + video walkthrough under
qa-evidence/), coverage matrix (screen × interaction × status × evidence
targeting 100% of discovered items), QA report, completion-challenge loop
(two consecutive independent verification passes discovering no new
defects — re-running the full gate battery + QA specs twice), and only
then the release: version increment, changelog, release notes, package,
validate, publish with API verification.

### T-077 Fix D-08: requery request-sequencing guard (stale-response race)
The T-074 performance audit found requery() writing list state with no
check that it is still the latest issued requery — the only guard was
`disposed` (teardown). Overlapping requeries (rapid searches, a search
issued while the creation storm's refreshes or a pagination requery are
still draining) resolve in RPC-arrival order, so a stale earlier-issued
response could overwrite the newer result view (observed: the unfiltered
full list replacing search results while the input still held the
query). resolveNotes()'s up to PAGE_SIZE sequential notes/get RPCs widen
the window; hydrateRelated()'s related-bulk write had the same exposure.
Fix: a requeryEpoch counter — requery() captures its epoch at entry and
re-checks `epoch === requeryEpoch` after EVERY await (search/query,
resolveNotes, and in the catch branch); hydrateRelated receives the
epoch and drops superseded related writes. Tests: deterministic unit
repro in controller.test.ts (transport interceptor holds the first
search/query for 'needle' in flight while a newer no-match query
resolves; releasing the stale one must NOT overwrite the empty state —
failed pre-fix, passes post-fix) + E2E regression in
audit-defect-regressions.spec.ts (30-note creation storm, immediate
search keeps its results, true no-match stays empty; q-only miss term
'qqqzzz' API-verified 0 hits because MiniSearch splits hyphens and
prefix-matches short tokens like 'no' against 'Note'). Gates at
completion: eslint green, tsc strict green, vitest 836/836, full
Playwright battery 67/67 including zip-acceptance.

### T-079 Upgrade/rollback validation + artifact inspection + dependency audit
Upgrade testing: install the PREVIOUS released artifact (v1.0.5 zip from
GitHub, byte-verified), create real application data through the UI
(notes with tags, a reminder, settings changes), then upgrade to the
current build (dist/) over the same profile — verify data survives,
settings survive, workflows survive, migrations succeed. Rollback: reload
the previous version over the upgraded profile, verify data remains
intact and document the downgrade path honestly (schema-forward
compatibility semantics). Artifact inspection: unzip the current release
candidate — required files present (manifest, dashboard, background,
icons, docs), zero dev/test/debug/temp files, zero secrets, zero
accidental files. Dependency audit: npm audit (vulnerabilities),
duplicate/outdated dependency review via the lockfile, DEPENDENCIES.json
consistency.

### T-080 Evidence consolidation + coverage matrix + QA report
Screenshots for every area the protocol lists (dashboard, navigation,
dialogs, settings, forms, search, notes, reminders, archive, AI
workflows, responsive layouts, fixed bugs, regression validation) under
qa-evidence/screenshots/; video walkthrough of the major workflows under
qa-evidence/videos/ (Playwright recordVideo); coverage matrix
(screen x interaction x status x evidence) targeting 100% of DISCOVERED
items with honest BLOCKED/NOT RUN accounting; the final QA report
(features/screens/interactions/workflows discovered, tests executed,
bugs + root causes + fixes, a11y/security/performance/regression
findings, remaining issues = none).

### T-081 Completion challenge loop — two consecutive clean passes
Per the protocol: assume the application is still broken; run the FULL
gate battery + all five QA spec batteries (t072 inventory, t073
security, t074 perf/memory, t075 integrity, t076 a11y) as pass #1;
fix anything found; re-run everything as an INDEPENDENT pass #2. Two
consecutive passes discovering no new defects gate the release.

### T-082 Release v1.0.6
The release protocol (T-061/T-069 pattern): version 1.0.5 -> 1.0.6 in
all five authoritative places + pinning tests; release-notes section
(the two QA-program fixes: D-08 requery sequencing, D-09 contrast);
README numbers refreshed; full gates; npm run release + verify-release;
publish GitHub Release with API verification (digest match, tag == HEAD,
byte-identical download-back); RELEASE_VERIFICATION.md + REPOSITORY_AUDIT
regenerated; records commit.

## §N — Task-file archival in GitHub (maintainer instruction, 2026-10-14)

### T-083 task-deliverables — all task files in one separate folder on GitHub
Maintainer instruction: "all files in task should be kept in a separate
folder in github" (the maintainer counted 116 deliverable files produced
by the task program — the QA-evidence, reports and verification records
that so far lived only outside the repo). Create `task-deliverables/` at
the repo root as THE single separate folder for every task output:
`task-briefs/` (the two maintainer instruction documents that drove the
task programs), `release-verification/` (v1.0.4/v1.0.5/v1.0.6 API
verification records), `local-notes-human-qa-20261014/` (the T-062
universal human-behavior QA audit, 102 files) and `qa-validation-v106/`
(the T-070..T-082 zero-trust validation program: 8 report files plus
`qa-evidence/` — the 46 files inside qa-evidence-full.zip, extracted so
everything is browsable). Redundant zip archives are not committed
(their contents are committed instead, byte-identical — verified);
gitignore's `*.zip` rule stays untouched. Guard the toolchain so the
evidence copies cannot perturb gates: eslint ignores task-deliverables/
(tsc, vitest and Playwright are already path-scoped); README documents
the folder with a resolving link. Pre-push secret scan over all 162
files with the audit's exact patterns (0 findings). Verify on GitHub via
the API (file count + digests), regenerate REPOSITORY_AUDIT.md, records
commit.

## §O — Comprehensive UX cluelessness audit (maintainer report, 2026-10-14)

### T-084 find EVERY area where a normal user is lost
Maintainer report: image insert does not take pictures from the PC; the
attachment/reminder/etc. toggle buttons pop out bars that have no close
button; "a lot of areas where a person does not have any clue what they
are supposed to do or use that feature". Directive: find ALL such areas
first — not a few issues, everything. Discovery-only task producing the
complete problem register across five dimensions: (1) closability of
every disclosure surface (in-surface close, Escape, re-click toggle,
click-outside); (2) every file-picker flow end-to-end (does the OS
picker open, right accept filters, success feedback); (3) developer
jargon in user-facing copy (data:image/base64 placeholders, blob, MHTML
etc.); (4) guidance/discoverability (icon-only controls, empty states
without calls-to-action, hidden-only interactions); (5) dead ends
(no-visible-effect buttons, unrecoverable errors). Method: static source
sweep of every user-facing string and surface + live Playwright walk of
every screen/control. Fixes are queued AFTER the register is presented.

## §P — T-084 register fixes: make every surface dismissible, human, and reachable

Maintainer confirmed "yes, please" to fixing the complete T-084 register
(task-deliverables/t084-ux-audit/t084-ux-audit.md — 8 severe / 7 moderate /
2 low). UX-17 (diagnostics vocabulary) is accepted-as-is per the register's
own judgment (that page's audience opts in); everything else is fixed.

### T-085 universal dismissal for every disclosure surface (UX-01..UX-05, UX-09)
One mechanism, five surfaces: every popped-out bar carries its own Close
control, Escape dismisses it, and the Filters bar additionally closes on
Apply. Concretely: attachments/snapshots/reminders/AI panels gain an onClose
callback + an in-header Close button (wired through editor-session's toggle
teardown); the session container handles Escape (closes the most recently
opened panel; inert while any native <dialog> is modal); the revisions view
gains Escape parity with its existing Close button; the filters panel gains
an in-region header with Close, the Filters button/region gains Escape
handling in the shell, and Apply closes the region. Regression tests for
every surface (button + Escape + apply-closes).

### T-086 insert-image rework + HEIC photo support (UX-06, UX-07, UX-15)
The dialog stops asking for data:image URLs (field removed; replaced with a
tip that drag-and-drop and paste both work) and gains an explicit Insert
flow; the file picker's accept list admits HEIC/HEIF (MIME + .heic/.heif
extensions so OS pickers stop greying out iPhone photos). Because Chrome
cannot render HEIC inline (verified: no <img> HEIF decode in any Chrome
version), a local WASM decoder (heic2any, MIT, pinned exact) converts
HEIC/HEIF to JPEG before the attachment pipeline — lazily imported, one
conversion choke point covering dialog/paste/drop, honest failure messages.
Manifest CSP gains 'wasm-unsafe-eval' for the decoder's WASM; third-party
notices documented; unit tests mock the dynamic import; E2E covers the
dialog surface changes and the honest fake-HEIC failure path.

### T-087 tags and categories reachable from the editor (UX-08)
New editor metadata bar (chips row under the note subtitle): existing tags
as removable chips + an add-tag input with suggestions; categories as chips
with an add input. Backed by the existing RPCs (tags/list, tags/create,
tags/set-note-tags, categories/*) applied immediately like attachments and
reminders — not deferred to autosave. Controller wires the API + refreshes
the roster so cards reflect the change; announcements for every outcome.

### T-088 plain-language copy pass (UX-10, UX-11, UX-12)
AI panel disclosure rewritten for notes users (technical MCP detail moves
into a collapsed "Technical details" disclosure); attachment rows show
"PNG image"-style descriptions instead of raw MIME (raw type kept in the
title attribute); snapshots copy humanizes MHTML ("complete saved copy of
the page (an .mhtml file)") across the export buttons, preview note,
missing-artifact tooltips and the artifact summary line. Pinned-string
tests updated alongside.

### T-089 capture entry points, onboarding that teaches the product, empty-state action (UX-13, UX-14, UX-16)
A visible "Save a web page…" action (header, next to New note) opens a
paste-a-URL dialog that creates the note + link and queues the capture —
the same pipeline the context menu and paste-into-note use; snapshots empty
state explains how links get there; onboarding is restructured product-
first (concrete first actions: create a note, save a page, tag, filter;
privacy points condensed, backup advice kept) with a "Create my first
note" primary action; the empty notes list gains an inline create button.

### T-090 release v1.0.7 packaging the T-084 fixes
Five-place version bump + pinning tests; release notes mapping every
register finding to its fix; README numbers; full gates (tsc strict,
eslint, vitest, perf, full Playwright battery incl. zip-acceptance);
npm run release + publish + API verification; RELEASE_VERIFICATION.md and
REPOSITORY_AUDIT.md regenerated; records commits.

### T-091 persist the human-QA mission brief as an ai/ protocol file
Distill the exhaustive human-behavior QA mission (source Google Doc
1sqG0KQUNyAhE8zt8v4CItZ0io2gxotx5oX18VWF5HDU, read in full 2026-10-14) into
`ai/qa-instructions.md`: 18 sections compressed into an agent-optimized protocol
covering environment setup, action/workflow/interaction inventories, persistence
and error testing, visual testing, evidence rules, defect + repair + regression
protocols, deliverables tree under artifacts/human-qa/, truth rules, completion
definition, and the 12-part final report. The file is self-contained so the
remote doc never needs re-reading; QA repairs remain governed by ai/rule.md
(§2 gates, §7 git workflow). Protocol files updated in the same commit.

## §Q-exec — Human-QA program execution (added during T-092..T-094 work after the
## session reset realigned the tree with the remote T-091 state)

### T-092 Phase 0 environment + baseline evidence
Build v1.0.7, isolated disposable profile, install unpacked dist/, verify
operational (SW, dashboard, console clean), environment record, baseline
screenshots + video, artifacts/human-qa/ scaffolding. DONE (f173136).

### T-093 Phase 1 discovery + action inventory
Explore the entire product; artifacts/human-qa/action-inventory.csv — 206
independently testable actions across 30 feature areas. DONE (903de12).

### T-094 Phase 2 individual action testing
Exercise every inventory row through the real UI with variations; defects →
ledger → fix → regression → real-UI re-verification. DONE: 206/206 rows
resolved — 196 PASSED, 8 BLOCKED (all environmental: L04/L06 command dispatch
+ native prompts + OS notifications, L05 MHTML, LM Studio absent; QA-147/149
single-snapshot deferrals re-covered by Phase 3 workflows), 2 NOT_APPLICABLE
(card-level pin/favorite toggles are non-interactive badges by design, L03);
six defects QA-D01..QA-D06 fixed and regression-verified (commits d8a0370,
33a5949, b0e9320); final 22 rows closed by phase2h (real captured link via
pre-seeded host permission, real failed link via capture-tab close, find-bar
suite, sanitised source view, paste/drop attach, yearly/Feb-29/Apr-31
reminders, pagination >50 with selection-clears, restart + two-tab isolation,
JSON import round-trip).

### T-095 Phase 3 workflow inventory (workflow-inventory.csv)
### T-096 Phase 4+5 interactions + persistence (interaction-coverage.csv)
### T-097 Phase 6+7 error/edge cases + visual testing
### T-098 defect repair completion + full regression pass
### T-099 final evidence + deliverables + 12-part final report

T-095 DONE: 22 workflows across 9 families (create/modify/access/settings/
navigate/cancel/complete/recover/journey), 22/22 PASSED — driven through
the real UI on a sustained pre-seeded profile (phase3a/b/c + targeted
rechecks; every session logged + videoed). THREE new defects found + fixed
+ regression-verified + real-UI-verified: QA-D07 failed-capture retry
unreachable (c239fe2), QA-D08 find/replace flattened rich documents —
silent structure + image data loss (7ea37b0, 4 regression tests),
QA-D09 recapture of captured links unreachable which made Compare
snapshots permanently unreachable (fb4481a, 2 regression tests). The
Phase 2 deferred rows QA-147 (Compare needs 2+ same-link snapshots) and
QA-149 (Delete + confirm) are now covered via the D09 recapture flow.

T-098 DONE: complete regression pass on the final build (dist @ the D09
fix) over a fresh pre-seeded profile — 12/12 checks PASSED: all nine defect
areas re-verified through the real UI (D01 exclusion search, D02 inline
errors, D03 settings-live, D04 image staging, D05 capture-queues, D06 grant
affordance on an ungranted host, D07 failed→retry end-to-end, D08
replace-all structure preservation, D09 recapture+compare) plus core flows
(onboarding, CRUD, reminders, backup) and browser-restart persistence;
full unit suite 913/913 green at every fix commit. One timing-sensitivity
observation recorded honestly: typing into the onboarding-created editor
within ~2s can race the async editor-session mount (the note saves empty);
human-paced interaction and explicit mount waits are unaffected — earlier
phases verified the same flow; flagged for awareness, not classifiable as
a defect from this evidence.

T-097 DONE: edge-cases.md — EC-01..06 + P7-SWEEP all PASSED (Unicode/emoji/
RTL round-trip incl. CJK search, ~5.5k-char content, whitespace-only
title/search/tag, degenerate queries, duplicate dialog submissions, long
titles, both-theme visual states); no new defects.

T-096 DONE: interaction-coverage.csv 15/15 PASSED — undo/redo across an
autosave flush, entry-point equivalence (palette vs toolbar), rapid panel
switching without bleed, capture-while-editing, duplicate-policy reuse
branch + Ask restore, shared-roster propagation (editor tag → search +
filters), sequential distinct opens, card/editor/storage consistency
(through the app's own plainText projection), reminder-surface consistency,
note + attachment renames, empty-note honesty, rapid creation,
order-sensitive search/sort/view, wholesale undo after multi-node
replace-all (single transaction verified). No new product defects — every
failure during the pass was a test-design artifact, resolved with honest
documentation of the actual behaviour (radios fire no 'change' when already
checked; DOM textContent lacks the plainText block separators; the reminders
panel footnote mentions the Overdue list; the rename dialog labels its
field 'Filename').
