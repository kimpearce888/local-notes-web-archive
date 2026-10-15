# Local Notes & Web Archive for Chrome
## Product Requirements Document (PRD)

**Document version:** 1.0  
**Status:** Approved architecture baseline; implementation specification  
**Research reviewed:** 12 October 2026  
**Product type:** Local-first Chrome desktop extension  
**Working name:** Local Notes & Web Archive  
**Delivery model:** One self-contained, prebuilt unpacked-extension folder

---

## 1. Product definition

Build a production-ready, local-first notes and web-archiving application that runs entirely as a Chrome Manifest V3 extension. Clicking its toolbar icon opens the dashboard in a normal tab. The dashboard manages rich-text notes, tags, categories, links, archived pages, search, reminders, local AI actions, backups and diagnostics.

The released extension folder must contain the manifest, compiled JavaScript, CSS, icons, editor modules, capture modules and all runtime assets. After the folder is built, installation must not require Node.js, Rust, Python, Docker, a database server, a native helper, a companion service or any other software installation. No runtime dependency may be loaded from a CDN.

All ordinary note operations must work offline. AI features connect only to the user's already-installed LM Studio local API. Page capture makes a network request only to the URL the user pasted or explicitly requested to capture. The extension must not use cloud services, accounts, cloud sync, telemetry, analytics, remote configuration or silent cloud AI fallback.

### Approved constraints

1. **Extension-only runtime.** No companion process, native messaging host, local web server or separate database service.
2. **One-folder installation.** The user enables Chrome Developer mode, selects the packaged extension folder through **Load unpacked**, and pins the toolbar icon. Chrome does not let an extension pin itself; pinning is a user action.
3. **Dashboard in a tab.** A toolbar click opens the dashboard as a normal extension tab, focusing an existing dashboard tab when appropriate instead of creating duplicates.
4. **Local data.** Notes, indexes, snapshots, attachments, reminders, revisions, settings and logs remain in the extension's local browser storage.
5. **Local AI only.** LM Studio is an external, already-installed optional runtime. The extension never falls back to a remote model.
6. **MCP boundary.** The extension may give LM Studio structured application tools for internal tool-calling. It will **not** expose an external MCP server or claim that this internal interface is MCP. An external MCP server requires a reachable server process/transport; Chrome Native Messaging also requires an installed and registered native host, which this product explicitly forbids.
7. **Reminder boundary.** Notifications can be delivered only while Chrome is running and the operating system permits notifications. Alarms do not wake a sleeping computer. On browser restart, overdue reminders are reconciled and shown; exact delivery while Chrome is closed is not promised.
8. **Open-source distribution.** All application code and bundled dependencies must be free/open-source, with licenses and notices included. LM Studio itself is not open source; it is the user-approved external dependency and is neither bundled nor required for non-AI features.
9. **Snapshot deliverables.** Each capture attempts to save (a) a page-and-resource MHTML archive through Chrome's built-in `chrome.pageCapture` API, (b) searchable extracted page text and (c) a full-page PNG screenshot using the Chrome DevTools Protocol through `chrome.debugger`. MHTML is stored locally and exported/opened from the filesystem; the extension does not render raw archives inside its privileged UI. Screenshot capture is best-effort. The `pageCapture` and powerful `debugger` permissions trigger Chrome permission warnings and must be explained before the user enables the extension.
10. **Whole product in the first release.** Every in-scope capability below belongs to the production release; this is not an MVP or phased roadmap.

## 2. Goals and exclusions

### Goals

- Capture, organize, edit, find and revisit notes and saved web pages without cloud dependency.
- Make rich-text editing comparable to a capable general-purpose WYSIWYG editor using only free/open-source packages.
- Make body text and archived page text searchable alongside note metadata.
- Provide robust one-time and annual reminders with clearly communicated browser-runtime limits.
- Let a compatible local model perform controlled note-management operations through validated tool calls.
- Make user actions, AI actions, capture outcomes and failures auditable without logging private note contents by default.
- Keep installation and runtime footprint small and eliminate external services.

### Not goals

- A cloud account, synchronization service, collaboration backend or mobile application.
- A standalone MCP server accessible from other applications.
- Notifications when Chrome is fully closed, or waking a sleeping computer.
- Guaranteed capture of inaccessible, DRM-protected, browser-internal, interactive or hostile pages, or guaranteed screenshot success where Chrome policy/page limits prohibit it.
- OCR of scanned documents or binary attachments in the initial product.
- Exact feature-for-feature parity with every TinyMCE plugin or any paid editor plugin. The editor must implement the explicit feature matrix in this PRD using free/open-source code.

## 3. Users and principal workflows

### Primary user

A single person using desktop Chrome who wants a searchable personal knowledge base, web archive and reminder system, and wants local AI to manage that information without sending it to a cloud service.

### Required workflows

- Click the pinned toolbar icon and open the dashboard.
- Create, edit, format, tag, categorize, search, filter, pin, archive, duplicate, restore or delete a note.
- Paste a URL into a note; have it detected, preserved as a link and queued for automatic capture. If that origin has not been authorized, Chrome's permission prompt is shown. If permission is declined or capture fails, the link remains saved and its status explains why.
- Preview the saved full-page screenshot and extracted text offline, and export/open the saved MHTML archive as a local file; compare recaptures by timestamp.
- Create a one-time reminder or yearly reminder that repeats on a month/day until stopped or through an inclusive end year.
- Ask the local AI to find notes, summarize material, create or edit notes, assign tags/categories and manage reminders; review and authorize changes according to the configured permission mode.
- Export a full backup, restore it after validation, or export/import individual notes.
- Diagnose a failed capture, unavailable model, denied permission, failed save or missed reminder from the application UI and local logs.

## 4. Information architecture and interface

### 4.1 Dashboard

The dashboard must be a full browser tab with a responsive layout and keyboard accessibility. Its top-to-bottom order is:

1. **New Note** action.
2. Global search field and filter controls.
3. Active filters, saved views and sort controls.
4. Cards/list results with pagination or virtualization.

The toolbar icon opens the dashboard. A configurable keyboard shortcut opens it or creates a note. The default shortcut must be checked for platform conflicts and remain user-configurable in Chrome's extension-shortcuts settings. Context-menu actions may save the current page or selected text when the user invokes them; the extension must not silently inspect browsing history or scan open tabs.

### 4.2 Cards and list view

Each card shows the title, subtitle, tag/category chips, created date, last-modified date, reminder state and link/snapshot indicators when relevant. The body preview is plain text with safe truncation; rich HTML is never rendered directly into a card. Support grid and list views, pinned notes, favorites, recently edited notes, overdue reminders, pagination/virtualization and selectable bulk actions.

### 4.3 Note editor

A note contains a title, subtitle, rich-text body, zero or more tags, zero or more categories, dates, zero or more links/snapshots, zero or more reminders, attachments, pin/favorite/archive state and revision history. Title may be blank during creation but the UI must provide a sensible untitled label until saved with a title.

The editor must autosave with a visible state (`Saving`, `Saved`, or `Save failed`), preserve data after a tab closes or the service worker restarts, and prevent navigation from discarding a pending save. Autosave must write the full document and searchable plain-text projection transactionally. Support undo/redo and recovery of the most recent recoverable edit after an unexpected failure.

### 4.4 Editor feature matrix

The first production release includes:

- Paragraphs; heading levels 1–6; bold, italic, underline, strikethrough, inline code, subscript and superscript.
- Font size, text colour and highlight colour; left/centre/right/justify alignment.
- Ordered, unordered and task/check lists; indent/outdent where structurally valid.
- Block quotes, horizontal rules, code blocks with language label, and clear formatting.
- Links, automatic link detection, link editing and safe external-link opening.
- Tables with row/column insertion/deletion, header cells, cell alignment, and row/column selection.
- Image insertion from local files, clipboard paste and drag/drop; local binary storage, alt text, caption and resize controls.
- File attachments, with filename/type/size shown and local download/open actions.
- Find within the current note, selection tools, paste from common rich-text sources and plain-text paste.
- Import/export of safe HTML and Markdown, plus a guarded HTML-source view that sanitizes content before rendering or returning it to the editor.
- Keyboard shortcuts, placeholder text, accessible toolbar labels, selection preservation and reliable undo/redo.

The toolbar and supported document schema must be documented in-app. No paid Tiptap extension, paid cloud feature, external editor service or remote asset is permitted. The implementation must not advertise “all TinyMCE features”; it must advertise the exact feature matrix above.

## 5. Functional requirements

### 5.1 Notes and organization

**FR-NOTE-01** Create, read, update, duplicate, archive, restore and trash notes. Permanent deletion requires explicit confirmation.  
**FR-NOTE-02** Store title, subtitle, structured editor document, derived plain text, tags, categories, timestamps, state flags, attachments, links, reminders and revision references.  
**FR-NOTE-03** `createdAt` is set once; `updatedAt` changes after each successfully committed meaningful modification. Failed writes must not report a successful save.  
**FR-NOTE-04** Support multiple tags and multiple categories per note. Categories may be nested. Provide create, rename, merge and delete-with-reassignment for tags/categories.  
**FR-NOTE-05** Provide pinning, favorites, archive, trash, restore and duplicate. Archived notes remain searchable unless the active filter excludes them. Trashed notes are excluded by default and recoverable until permanently deleted.  
**FR-NOTE-06** Maintain a bounded revision history (at least 20 saved revisions per note by default), permit preview/restore, and record the revision restore as a new revision. Retention must be configurable and included in storage reporting.  
**FR-NOTE-07** Detect edit conflicts from multiple open dashboard tabs. Do not silently overwrite a newer revision; offer reload, compare or save as a duplicate.  
**FR-NOTE-08** Bulk operations support tag/category assignment, pin/unpin, archive/restore and trash. Bulk deletion is confirmed and every affected record is audited.

### 5.2 Search, filters and views

**FR-SEARCH-01** Full-text search covers note title, subtitle, rich-text body projection, tags, categories, stored link URL/title, captured webpage title/text and attachment filenames. Binary files and scanned images are not OCR-indexed.  
**FR-SEARCH-02** Provide exact phrase matching, prefix matching, optional fuzzy matching and relevance ranking. Search must remain available without AI.  
**FR-SEARCH-03** Provide filters for created/modified date ranges, tags, categories, pinned/favorite, active/archived/trashed, reminder present/due/overdue/completed, links present, snapshot present/missing/failed, attachment present, capture date and source domain. Filters may be combined and saved as named views.  
**FR-SEARCH-04** Support a documented query syntax for quoted phrases, exclusions (`-term`), `tag:`, `category:`, `before:`, `after:`, `has:link`, `has:snapshot`, `has:reminder`, `is:pinned`, `is:archived`, `is:overdue`, and field scopes `in:title`, `in:body`, `in:snapshot`. Invalid syntax must produce an inline explanation, not silently change the query.  
**FR-SEARCH-05** Search index updates are transactionally consistent with note/snapshot saves. Index corruption triggers a rebuild from canonical records.  
**FR-SEARCH-06** Provide sort by relevance, title, created, modified, reminder date and capture date; ascending/descending where meaningful. Filters and sort survive navigation within the dashboard.

### 5.3 URL detection and web capture

**FR-CAP-01** Detect pasted HTTP/HTTPS URLs in the title/body editor and preserve the URL as a normal clickable link. The paste event queues capture automatically when auto-capture is enabled. Manually typed URLs are detected but do not trigger a network visit until the user requests capture or enables an explicit setting.  
**FR-CAP-02** Origin access is optional and requested per origin. If an origin has not been authorized, keep the link and set the capture to `permission required`; show a clear explanation and a user-clicked `Allow access and capture` action. Request the exact optional host permission from that user gesture, then continue only if granted. If declined, retain the link and do not retry without another user action. The user can revoke origin access from settings.  
**FR-CAP-03** Queue capture jobs sequentially with cancel/retry, deduplication and progress. Never open many hidden tabs concurrently. Capture only an explicitly pasted or user-requested URL, not tabs/history in the background.  
**FR-CAP-04** Only HTTP/HTTPS URLs are eligible. Reject browser-internal schemes, file/data/javascript URLs, credentials in URLs, localhost, link-local, private-network and reserved IP ranges by default. Do not treat an archived URL as trusted instructions. If navigation redirects away from the authorized origin or the final destination cannot be validated, stop extraction/capture and show the reason.  
**FR-CAP-05** Use Chrome's built-in `chrome.pageCapture.saveAsMHTML({ tabId })` API to store a self-contained MHTML page archive as a Blob in IndexedDB. This avoids a third-party webpage-archiving runtime dependency. Store source URL, validated final URL, page title, capture timestamp, content hash, extracted readable text, format, status and warnings. MHTML may omit inaccessible resources or states and must be treated as best-effort.  
**FR-CAP-06** Never render or inject a stored MHTML archive into the extension dashboard. In-app offline preview consists of the saved PNG and extracted text. Provide an explicit user-initiated MHTML export/download; the user opens the exported file from the filesystem in Chrome to view the full archive. Do not claim that MHTML can be loaded from an extension Blob URL or embedded inside the dashboard.  
**FR-CAP-07** Show capture status: queued, permission required, capturing, complete, partial, failed or canceled, plus the independent state of the MHTML, PNG and text artifacts. `Complete` means all three artifacts were saved; `Partial` means at least one artifact succeeded but another failed; `Failed` means no artifact was saved. Capture warnings identify resource failures, unsupported frames, lazy-loaded content, oversized pages, access restrictions or redirects where detectable. A failed artifact never overwrites a previously successful snapshot.  
**FR-CAP-08** Re-capture creates a new snapshot revision unless the user chooses to replace the old revision. Provide open, compare metadata, rename, export and delete snapshot actions. Duplicate URLs may reuse an existing capture only after clear user-visible confirmation or according to a defined deduplication setting.  
**FR-CAP-09** Save extracted visible text separately for search, so search does not need to parse the full archive each time. The capture is a best-effort record of what was accessible at capture time; the product must never claim that every site, resource, script state, video frame or authenticated interactive state can be faithfully archived.  
**FR-CAP-10** Attempt a genuine full-page PNG for every capture by using Chrome DevTools Protocol (`Page.getLayoutMetrics` and tiled `Page.captureScreenshot` calls) through `chrome.debugger` on the temporary target tab. Do not activate the tab merely to take the screenshot. Restrict the CDP command allowlist to the exact page metrics/screenshot commands required; detach in a `finally` path and never inspect cookies, credentials or network bodies. Tile very tall pages and enforce a configurable pixel/byte limit. Enterprise policy, protected pages, debugger conflicts, browser limitations or size limits may prevent screenshots; in that case retain the MHTML archive and extracted text, mark the PNG partial/failed and explain why. The `debugger` permission is an explicit architecture trade-off, not a hidden dependency.

### 5.4 Reminders

**FR-REM-01** Support multiple reminders per note. A reminder includes due date/time, completion/dismissal state, snooze, optional recurrence, final year and creation/update timestamps.  
**FR-REM-02** Support one-time reminders and yearly recurrence by month/day and local wall-clock time. A yearly reminder repeats until manually stopped or through a specified **inclusive final year**. Stopping recurrence disables future occurrences but preserves history.  
**FR-REM-03** February 29 recurrence behavior is configurable: February 28, March 1 or skip non-leap years. Default is February 28 and is shown in reminder details.  
**FR-REM-04** Persist recurrence rules in IndexedDB; treat Chrome alarms as wake-up hints only. Reconcile alarm schedule from canonical reminder records on install/update, service-worker startup, browser startup, and after changing a reminder.  
**FR-REM-05** Use the Chrome Alarms and Notifications APIs. Respect OS/browser notification settings. Show overdue reminders in the dashboard even if notifications were denied or missed. When Chrome restarts, coalesce missed occurrences into a concise notification and dashboard state rather than sending a burst for every missed year/date.  
**FR-REM-06** The app must clearly state that Chrome must be running for notifications, the computer must be awake to display them, alarms may be delayed, and no notification will wake a sleeping computer. If Chrome was closed, reconcile missed reminders at next startup.  
**FR-REM-07** Handle daylight-saving gaps/repeated times deterministically, timezone changes, clock changes, leap years, deleted notes, disabled notifications, alarm loss and recurrence end year. All edge-case semantics must be covered by automated tests.

### 5.5 Local AI with LM Studio

**FR-AI-01** Provide an optional AI panel available from the dashboard and note editor. Default API base URL is `http://127.0.0.1:1234/v1`, with `http://localhost:1234/v1` supported. Allow port configuration, but only loopback URLs are accepted by default. Non-loopback AI endpoints are out of scope.  
**FR-AI-02** All requests to LM Studio originate from the extension service worker using declared loopback host permissions, not from page content or an embedded webpage. Use the OpenAI-compatible Chat Completions tool-call API and native `fetch`; no OpenAI cloud SDK or service is required.  
**FR-AI-03** The user must have started LM Studio's local API server and loaded a model. The extension cannot start LM Studio or load a model from this approved architecture. The settings screen provides connection test, model listing, model selection, tool-use test, timeout and clear diagnostics.  
**FR-AI-04** AI tasks include note search, summarization, extraction of action items, proposed tags/categories, duplicate suggestions, creation/editing of notes, link/snapshot summaries, reminder creation/update and natural-language query-to-filter conversion. AI-generated data must be visibly marked until saved.  
**FR-AI-05** Provide validated application tools: `search_notes`, `get_note`, `create_note`, `update_note`, `duplicate_note`, `archive_note`, `restore_note`, `trash_note`, `manage_tags`, `manage_categories`, `list_reminders`, `create_reminder`, `update_reminder`, `complete_reminder`, `search_snapshots`, `get_snapshot_text`, `recapture_url`, and `get_diagnostics`. Every tool has a strict schema, input bounds, authorization check and structured result. Large result sets require pagination/limits.  
**FR-AI-06** The model may propose tool calls but never executes them directly. The application validates, authorizes and performs each operation, then returns a bounded result to the model. Malformed calls, unknown tool names, invalid IDs, schema errors, prompt injection and model timeouts fail closed.  
**FR-AI-07** Permission modes: (a) read-only; (b) ask before every write; and (c) allow safe, non-destructive writes while requiring confirmation for bulk changes, trash, permanent deletion, overwrite/restore and destructive operations. Default is ask before every write. Permanent deletion always requires confirmation.  
**FR-AI-08** Webpage text, note text and imported content are untrusted data. Instructions inside them cannot change the system policy, grant permissions or trigger destructive operations. AI does not follow links or capture additional websites unless an application tool is explicitly authorized by user settings.  
**FR-AI-09** Only the minimum selected note/snapshot text necessary for the current operation is sent to the local LM Studio endpoint. Prompts and note contents are excluded from technical logs by default. There is no remote fallback, cloud telemetry or unapproved network endpoint.  
**FR-AI-10** LM Studio and model capability are external dependencies. If the server is stopped, no model is loaded, the chosen model lacks usable tool calls, or the API format differs, core notes/search/capture/reminders continue to work and AI features show actionable error states rather than pretending success.

### 5.6 Internal tool interface and MCP disclosure

**FR-MCP-01** The extension implements a documented, versioned internal tool contract that lets a compatible LM Studio model request application operations through its API's tool-calling format. This contract is internal to the extension and is not the Model Context Protocol.  
**FR-MCP-02** The extension does not bind a TCP/HTTP server, expose a stdio server to other processes or register a native messaging host. External MCP clients cannot directly operate the extension in this release.  
**FR-MCP-03** Settings and product documentation must explicitly state this limitation. It must not display “MCP server connected,” advertise MCP compatibility, or imply that another MCP client can call the extension's tools.

### 5.7 Backup, import, export and recovery

**FR-DATA-01** Use IndexedDB as the canonical store for notes, revisions, reminders, categories, tags, capture metadata, archive Blobs, attachment Blobs, settings and audit records. Use `chrome.storage.local` only for small extension settings that benefit from the Chrome storage API. Do not use localStorage as the primary database.  
**FR-DATA-02** Request `unlimitedStorage` and call `navigator.storage.persist()` where supported. Show estimated usage, archive/attachment sizes and configurable warnings; browser storage is still limited by disk capacity and user profile lifecycle.  
**FR-DATA-03** Provide complete ZIP backup and restore. The backup includes a manifest/schema version, notes and relationships, reminders, revisions, snapshots, attachments, preferences, timestamps, hashes and a license/version report where relevant. ZIP creation uses a bundled open-source ZIP library.  
**FR-DATA-04** Validate backup format, schema version, sizes, path names and hashes before restore. Restore supports preview, merge and replace modes. Replace mode requires explicit confirmation; failed restore must leave the existing database unchanged.  
**FR-DATA-05** Support individual note export/import as JSON, Markdown and sanitized HTML; snapshot export as the stored MHTML archive, PNG and extracted text; and full data export as ZIP. No export uploads anything.  
**FR-DATA-06** Detect schema changes and run idempotent, versioned IndexedDB migrations. Migration failure must preserve the original data where possible, stop writes, display an actionable message and provide diagnostic export.  
**FR-DATA-07** Make data-loss risk explicit: uninstalling the extension, deleting the Chrome profile or clearing extension data can delete the local database. Provide a backup reminder before destructive reset/uninstall instructions. The extension cannot silently write scheduled backups to arbitrary disk paths without additional file access/permissions.

### 5.8 Logging, auditing and diagnostics

**FR-LOG-01** Use structured local logs with timestamp, severity, component, operation ID, correlation ID, duration, result code and sanitized error details. Log successful high-level operations and all failures for note writes, migrations, captures, reminders, AI calls, imports/exports, permission changes and tool calls.  
**FR-LOG-02** Maintain a separate audit trail of user and AI actions, including actor, action, target ID, timestamp, approval status and outcome. Record content hashes or changed-field names where useful; do not log full body text by default.  
**FR-LOG-03** Never log passwords, API tokens, full prompts, note bodies, archived HTML, attachment content or browser history by default. Redact URL query parameters that may contain tokens; preserve the actual source URL only in the note/snapshot record itself.  
**FR-LOG-04** Bound technical logs (default rolling maximum 5 MB) and define configurable audit retention. Log rotation, quota limits and log export must not break ordinary note writes.  
**FR-LOG-05** Provide a diagnostics page with extension/build version, Chrome version, database schema, storage usage, index status, permissions, notification status, LM Studio endpoint reachability/model status, last capture failures and recent sanitized errors. Offer an explicit “Export diagnostics” action with a review step.

### 5.9 Settings and onboarding

**FR-SET-01** Settings include theme, card/list view, default sort, saved views, auto-capture on pasted URL, allowed origins, capture limits, duplicate handling, reminder notification preferences, leap-day behavior, editor toolbar, revision retention, backup warnings and AI permissions.  
**FR-SET-02** First-run onboarding explains local storage, permissions, LM Studio optional setup, reminder limits and data-loss risk. The main note workflow remains usable if AI or notifications are disabled.  
**FR-SET-03** Show site-access grants and provide a way to revoke granted origins. No broad `<all_urls>` permission is requested by default; capture asks for per-origin permission.  
**FR-SET-04** No telemetry or network traffic occurs except (a) the explicit page navigation/capture requested by the user and (b) loopback requests to LM Studio. A built-in network privacy test must verify this.

## 6. Data model and invariants

The logical data model includes these entities:

- **Note:** UUID, title, subtitle, editor JSON, plain-text projection, created/updated timestamps, pinned/favorite/archive/trash state, revision ID, and relationship IDs.
- **Tag:** UUID, display name, normalized unique key, creation/update timestamps.
- **Category:** UUID, name, optional parent category ID, ordering and timestamps. Cycles are forbidden.
- **NoteTag / NoteCategory:** unique join records enabling multiple tags and categories per note.
- **Link:** UUID, note ID, original URL, normalized deduplication key, anchor/display text, origin, created timestamp and optional capture ID.
- **Snapshot:** UUID, source and validated final URL, title, captured timestamp, state, MHTML Blob key, PNG Blob key, extracted text, content hash, archive format, size, warnings and parent/previous snapshot ID.
- **Attachment:** UUID, note ID, original filename, verified MIME type, byte size, hash, Blob key and timestamps.
- **Reminder:** UUID, note ID, due date/time, recurrence rule, IANA timezone/system-local policy, final year, leap-day policy, active/completed/dismissed state and timestamps.
- **Revision:** UUID, note ID, editor JSON snapshot, metadata snapshot, created timestamp and change summary. Apply bounded retention.
- **AuditEvent / DiagnosticLog:** IDs, timestamps, operation/correlation ID, actor, action, sanitized metadata, status and error code.
- **Settings / Migration:** versioned configuration and schema state.

Invariants: UUIDs are stable; timestamps use ISO 8601 UTC for events and an explicit local date/time/timezone representation for reminders; all writes use transactions where possible; derived indexes can be rebuilt; no note is reported saved until its transaction commits; snapshots and attachments are content-hash checked; references are validated on import/restore; trash is recoverable; archive rendering is isolated; AI tool calls use the same services and validation as UI operations.

## 7. Technology stack and licensing

### Runtime stack

| Area | Selected technology | Role and license |
|---|---|---|
| Extension platform | Chrome Extensions Manifest V3 | Browser runtime and privileged APIs; no extra installed software |
| Languages | TypeScript compiled to JavaScript; HTML; CSS | Application source and shipped assets; TypeScript Apache-2.0; output is local bundled JS |
| UI | Vanilla TypeScript/DOM and standard CSS | Avoid React and other runtime UI frameworks |
| Build | Vite + TypeScript (development/build only) | Builds the folder; no Node.js runtime is needed after installation; Vite MIT |
| Rich editor | Tiptap Core, ProseMirror and explicitly selected open-source Tiptap extensions | MIT-licensed components only; no Pro/Cloud modules |
| Web archive | Chrome `chrome.pageCapture.saveAsMHTML` | Built-in Chrome API; no third-party archive runtime; MHTML is exported/opened from the filesystem |
| HTML sanitization | DOMPurify | MPL-2.0 OR Apache-2.0; sanitize imported/pasted HTML before it reaches the editor |
| Full-text search | MiniSearch | MIT; zero external runtime dependencies; local indexing/ranking |
| Backup ZIP | fflate | MIT; ZIP encoding/decoding without an external service |
| Durable storage | IndexedDB; `chrome.storage.local` for small settings | Built-in browser APIs; no SQLite/server |
| Background events | Manifest V3 service worker; `chrome.alarms`; `chrome.notifications` | Built-in Chrome APIs |
| AI | Native `fetch` to LM Studio's OpenAI-compatible local API | No SDK/service required; LM Studio is external proprietary software already installed by user |
| Quality tooling | Vitest, Playwright, `tsc`, ESLint and dependency/license scanning | Development/test-only, not shipped as extension runtime |

### Dependency rules

- No React, Node.js runtime, Rust runtime, SQLite server, Docker, Qdrant, backend server, hosted database, CDN, telemetry library, payment/analytics SDK or cloud AI SDK.
- Vendor and bundle every runtime dependency and every required asset into the release folder. No runtime npm installation, CDN, remote module import, `eval`, `new Function`, or remote executable code.
- Pin exact versions in the lockfile. Record direct/transitive dependency names, versions, SPDX license identifiers, source URLs and any required notices in `THIRD_PARTY_NOTICES.md` and machine-readable inventory.
- Every release fails the license gate if any dependency is paid-only, proprietary, unlicensed, license-incompatible or adds an undisclosed runtime network dependency. Audit direct and transitive licenses, not just package-level marketing pages.
- The recommended first-party project license is **MIT**, subject to a final license scan of exact pinned dependencies. Preserve all third-party license texts and notices. Do not add an AGPL, paid-only or proprietary bundled dependency without an explicit product/legal decision.
- LM Studio is not an open-source component. It is the user-approved, existing external exception for optional AI features only; it is not bundled or required for the rest of the extension. Model weights are separately licensed and must be chosen by the user. The targeted Google Chrome browser is also proprietary software; the extension's source and bundled dependencies remain open source, and a compatible Chromium distribution may be used where tested.

## 8. Technical architecture and Chrome permissions

### 8.1 Components

- **Dashboard page:** all note/card/editor/search/reminder/archive/settings screens.
- **Extension service worker:** toolbar/shortcut/context-menu events, alarms, capture queue orchestration, AI API calls and message routing. It is stateless across suspension; durable state is always read from IndexedDB.
- **IndexedDB repository layer:** transactions, records, migrations, indexes, revision history and Blobs.
- **Search adapter:** MiniSearch index over normalized projections, persisted with schema/version metadata and rebuilt from canonical records when required.
- **Capture worker:** requests origin access, creates one inactive tab for the pasted URL, waits for load/settling, uses `chrome.pageCapture` to create an MHTML Blob, extracts readable text using a narrowly scoped injected script, attempts a CDP screenshot, persists each artifact and closes the temporary tab. It must honor cancel/time/size limits and never open multiple capture tabs concurrently.
- **AI tool dispatcher:** local API client, tool schemas, validation, permission policy, transaction calls, bounded outputs and audit events.
- **Export/import manager:** archive ZIP, validate, hash-check, preview, transactional restore and migration.

### 8.2 Required and optional permissions

The build must use the narrowest effective permission set. The planned required permissions are:

- `storage` for small settings and extension storage utilities.
- `unlimitedStorage` to support larger IndexedDB-backed notes/archives and reduce storage eviction risk; physical disk/profile limits still apply.
- `alarms` and `notifications` for reminder scheduling and system notifications.
- `scripting` for capture-text extraction only after origin access is granted.
- `pageCapture` for saving the authorized temporary tab as MHTML. This API permission triggers a Chrome warning.
- `debugger` for the narrowly allowlisted CDP screenshot commands. This is a powerful permission and triggers a broad Chrome warning. It is used only against the temporary capture tab and detached immediately.
- Loopback host permissions for `http://127.0.0.1/*` and `http://localhost/*` so the service worker can call the user's LM Studio API without broad website access.

Declare `http://*/*` and `https://*/*` as optional host permissions, not granted automatically. Request the exact origin only after the user clicks the capture authorization action. Avoid `<all_urls>`, `tabs`, `cookies`, `history`, `webRequest`, downloads, nativeMessaging and file-system permissions unless implementation testing proves a specific API makes one unavoidable; any change requires a documented justification and security review. The `debugger` permission is the approved exception for full-page PNG capture and must never be used for general page inspection or network interception. Optional origin host permissions constrain ordinary script-based extraction but do not neutralize the broad power of `debugger`; security depends on the narrowly scoped capture workflow, temporary-tab-only target selection, hard CDP command allowlist and immediate detach. AI tools must never control debugger targets or CDP commands. All capture code must handle user-revoked host permissions.

Permissions and API behavior vary with Chrome versions and user controls, so the production build must be tested against the minimum supported Chrome version and current stable Chrome. Minimum target: Chrome 120+ desktop. Do not rely solely on the newer `persistAcrossSessions` alarm field; reconstruct alarm state from IndexedDB at startup.

### 8.3 Dashboard and installation lifecycle

The final distributable directory contains `manifest.json` at its root and all referenced built assets. It is loadable through `chrome://extensions` → Developer mode → Load unpacked. The user pins the icon through Chrome's extension menu. A stable extension ID/public key must be maintained in the release manifest so replacing files and reloading the same folder does not create a new storage origin. Updates should replace files in the same folder and use Chrome's Reload action; do not uninstall/reinstall for routine updates.

Chrome controls extension pinning, Developer mode and unpacked-extension status. The product cannot hide those native browser steps. If the folder is moved or the extension ID changes, profile storage may not be available under the new origin. The README must explain this and require an export before removal or migration.

## 9. AI safety and trust model

The AI is an untrusted planner, not an authority. The extension's tool dispatcher is the sole execution layer. It must enforce:

- Strict JSON schema and bounded string/list/record sizes for every tool.
- Read/write permissions, ID validation, note relationship validation and transaction checks.
- Confirmation for destructive and bulk actions; permanent deletion always confirmed.
- No arbitrary JavaScript execution, SQL, filesystem access, arbitrary network requests, shell commands or hidden browser navigation through model-generated tool arguments.
- Captured pages and imported documents are treated as untrusted input and isolated from privileged extension UI. Prompt-injection text cannot alter tool permissions or application rules.
- No use of hidden context from all notes. The model receives only search results or explicitly selected content required for the request.
- Clear status for every tool call: proposed, awaiting approval, running, succeeded, failed or canceled. Never state an operation succeeded until the data transaction completes.
- Cancellation and timeout support. A partially completed multi-tool request must report exactly which operations committed and which did not; the product must not claim cross-operation atomicity when the operations were not a single transaction.

## 10. Privacy, security and data lifecycle

- Local-first by default; no login or account. No note/snapshot/attachment content is transmitted except to loopback LM Studio when AI is invoked and to the explicitly pasted/requested source website during capture.
- No background crawling, browser-history import, automatic tab inventory, tracking, analytics, or silent outbound requests.
- Restrict AI requests to localhost/127.0.0.1 by default; reject public endpoints. Never follow model-provided arbitrary URLs.
- Use `connect-src` and the extension CSP as narrowly as Chrome allows while supporting the local API; no remote scripts or dynamic executable code.
- Use DOMPurify for pasted/imported HTML. Sanitize links and allow only approved protocols (`http`, `https`, `mailto` where appropriate); reject `javascript:`, `data:` and extension schemes from user content.
- Do not render raw MHTML or page-provided HTML in the dashboard. Display the captured PNG and extracted text in-app; MHTML is opened only as a user-exported local file.
- Validate URL schemes, credentials, origin, redirects, MIME types, archive size and attachment type. Apply configurable per-capture and aggregate size limits; default maximum individual archive 100 MB, configurable downward/upward within safe memory constraints. Large archives must be processed as Blobs where possible rather than copied repeatedly into strings.
- Private-network, loopback, link-local and reserved URLs are blocked for automatic capture by default. Capture is restricted to explicitly user-pasted/requested links and per-origin permission grants. Redirect handling must abort when final access cannot be validated.
- Logs redact potentially secret query values and exclude content by default. Diagnostics export is opt-in and previewed before it leaves the app; export itself is a local file download.
- Data is scoped to the Chrome profile. Extension uninstall, profile deletion, profile corruption or clearing extension data can permanently remove data; backups are the user's portable recovery mechanism.

## 11. Non-functional requirements

### Reliability and data integrity

- Autosave and metadata updates use IndexedDB transactions; visible success is shown only after commit.
- Crash/interruption tests must prove notes are not silently lost or half-written.
- Search indexes and alarms are derived data and rebuildable from canonical entities.
- Failed captures preserve any previously successful snapshot. Failed imports/restores leave prior data untouched.
- All async tasks expose progress, cancellation where feasible, timeout and actionable failure state.

### Performance targets

Validate against a documented reference computer and clean Chrome profile. Targets for the production build:

- Dashboard shell visible within 1.5 seconds after opening under normal local conditions.
- Search over 10,000 notes plus 2,000 indexed snapshots returns initial results within 500 ms at the 95th percentile after the index is loaded.
- Typing and editing remain responsive while indexing/capturing occurs; long work runs outside the editor's critical path.
- Card rendering is virtualized/paginated and archives are lazy-loaded. The extension must not load every Blob into memory at startup.
- Peak memory, initial package size, storage use and capture throughput are measured and documented during release verification; any regression must be explained rather than concealed.

### Accessibility and usability

- Keyboard-operable dashboard, editor toolbar, filters, dialogs and reminders.
- Visible focus, accessible names, reasonable contrast, semantic structure and screen-reader announcements for save/capture/AI states.
- Confirmations for destructive operations, undo where recoverable, clear empty/error/loading states and no important status conveyed by colour alone.
- Target WCAG 2.2 AA for the application UI, subject to documented limitations of third-party editor primitives.

### Maintainability

- Strict TypeScript, linting and type checking; no untyped dynamic code paths for tool execution.
- Modular repository/services and UI; typed database models and migrations.
- Exact lockfile and reproducible build from source.
- CI tests, dependency/license/security scans, packaged-file inspection and no-network verification.
- No production secrets, personal data, API tokens or developer filesystem paths in source or bundles.

## 12. Error handling and observable states

Every user-facing action must produce a truthful outcome. Standard failure states include: save failed; note conflict; database unavailable/migration failed; storage nearly full; permission required/denied/revoked; URL unsupported/private/redirected; capture timeout/partial/failure/too large; archive cannot be rendered; backup invalid/incompatible/corrupt; restore failed; notification permission disabled; reminder missed; LM Studio not running; no model loaded; tool use unsupported/malformed; AI timeout/canceled; tool permission denied; audit/log storage full.

For each failure, show (a) what failed, (b) whether the user's data was saved, (c) what the application did to protect existing data, and (d) a concrete recovery action. Diagnostic details are sanitized. Never swallow errors or report success based only on receiving an HTTP 200 response if the body indicates a failure.

## 13. Acceptance criteria and release gates

A release is acceptable only when all of the following pass:

1. **Installability:** a clean desktop Chrome profile can load the single release folder using Load unpacked. No host-level runtime, separate service, Node.js, Rust, Docker, database or download is required. Every runtime asset is inside the folder. Toolbar click opens the dashboard tab; pinning instructions are accurate.
2. **Open source and offline:** all bundled code has verified open-source licenses and included notices. With networking disconnected, note creation/editing, local search, filters, reminder state management, backup/export, screenshot preview and extracted-text viewing continue to function; only new external page captures and AI API interactions need their respective network targets.
3. **Editor:** every feature in Section 4.4 passes automated and manual tests; imported malicious HTML cannot execute script in the editor; no stored web archive is injected into the extension UI; autosave/recovery works after reload/crash simulation.
4. **Data correctness:** CRUD, categories/tags, relationships, revisions, trash, import/export, merge/replace restore, schema migration and index rebuild pass tests. A failed restore never changes existing records.
5. **Search:** every searchable field in FR-SEARCH-01, filters, advanced syntax, saved views, sort orders and archive text search produce expected results. Search works without AI and remains consistent after edit, restore, archive, trash and recapture.
6. **Capture:** pasted public HTTP/HTTPS links are queued; first-origin permission is handled correctly; capture failures leave the link intact; the capture queue limits concurrency; captures are stored offline as MHTML; extracted text is searchable and the MHTML export opens as a local file; duplicate and recapture policies are honored; redirects/unsupported pages fail safely. Capture is tested on static, long, lazy-loaded, single-page, iframe-heavy, logged-in, cross-origin and blocked sites, with known limits reported honestly.
7. **Reminders:** one-time, yearly-until-stopped, yearly-through-final-year, Feb 29 options, daylight saving, timezone change, sleep/wake, Chrome restart, extension reload, notification denial, overdue reconciliation and recurrence stop are tested. Documentation does not promise alerts while Chrome is closed or device wake-up.
8. **AI:** default LM Studio endpoint can be tested from the extension service worker with appropriate loopback host permissions. Server unavailable, unloaded model, unsupported tool calls, malformed arguments, rejected permissions and timeouts fail safely. Every mutation is auditable and approval modes work. Network inspection confirms no cloud fallback or note-content traffic to unrelated origins.
9. **MCP disclosure:** user documentation and UI state that the extension has internal model tool-calling but does not expose an external MCP server. No fake server status or false compatibility claims.
10. **Security:** no remote executable code/CDN; XSS, malicious archives, prompt injection, unsafe schemes, private-network URLs, oversized inputs, corrupted backups, revoked permissions and arbitrary-tool/network-execution attempts are tested.
11. **Logs:** all required high-level operations and failures are correlated and inspectable; log rotation is bounded; default diagnostics contain no full note bodies, captured HTML, full prompts or secrets.
12. **Performance/accessibility:** targets in Section 11 are measured; keyboard navigation and accessibility checks pass; large data sets do not freeze the UI or load all archives into memory.
13. **Distribution:** versioned build artifacts, source, README, license texts, third-party dependency inventory, permissions rationale, known limitations, backup/restore guide and support diagnostics guide are present. A final production-folder scan proves no missing files or remote runtime imports.

## 14. Required bundled documentation

The repository and release folder must contain:

- `README.md`: product scope, supported Chrome version, install/pin/update/uninstall, data-loss warnings and backup/restore guide.
- `LICENSE`: MIT for first-party project code, subject to final dependency license verification.
- `THIRD_PARTY_NOTICES.md`: direct and transitive dependencies, versions, SPDX licenses, copyright and required notices.
- `DEPENDENCIES.json` (or equivalent machine-readable inventory): resolved dependency tree and licenses.
- `PRIVACY.md`: exactly what is stored locally, what network calls happen, LM Studio behavior, origin permissions and logging rules.
- `PERMISSIONS.md`: every manifest permission, why it is required, when it is used and how to revoke site access.
- `KNOWN_LIMITATIONS.md`: Chrome-closed reminders, full-height screenshot restrictions, unsupported page capture cases, LM Studio availability/model capability and absence of an external MCP server.
- `BACKUP_RESTORE.md`: backup format, integrity validation, merge/replace semantics, portability, and data-loss scenarios.
- `SECURITY.md`: threat model, reporting route, archive sandboxing, prompt-injection treatment and dependency update policy.

## 15. Explicit production limitations

These are product boundaries, not hidden implementation tasks:

- **No external MCP server:** the application can offer built-in model tool calls but cannot act as an MCP server for another process while remaining only an unpacked extension with no native host/service.
- **No notification while Chrome is fully closed:** overdue items are reconciled when Chrome starts again; Chrome alarms cannot wake a sleeping machine.
- **Local AI requires an active LM Studio API server and a compatible loaded model.** The extension does not install or start LM Studio and never uses a cloud fallback. If Chrome/LM Studio networking policy blocks loopback calls, the diagnostic must state the specific connection/permission failure and no automatic workaround may relax security.
- **Web archiving is best-effort:** websites may block capture, rely on protected/cross-origin resources, update during capture, require interaction, or expose incomplete content. Show archive quality/warnings; never claim universal fidelity. The MHTML archive can be exported/opened from disk; it is not embedded in the extension UI.
- **Full-height PNG screenshots are best-effort, not universally guaranteed.** The extension attempts a background-tab capture through CDP, but Chrome enterprise policy, restricted pages, very large dimensions or debugger conflicts may prevent it. The MHTML archive plus indexed text is the required fallback; the UI must label screenshot success/partial/failure.
- **Unpacked extensions are developer-mode installations.** Chrome controls enabling Developer mode and pinning; the project can minimize steps but cannot automate them from extension code. The extension source and bundled libraries can be fully open-source; Google Chrome itself is proprietary, while a compatible Chromium distribution is the open-source browser alternative.
- **Capture permissions are intentionally prominent.** Chrome warns about the `pageCapture` and `debugger` permissions. The extension cannot deliver the agreed MHTML-plus-full-page-screenshot behavior without requesting them; onboarding must explain why they are needed and what they permit.
- **No out-of-profile backup without a user-initiated export or an explicitly granted filesystem workflow.** Local browser storage is not a substitute for a portable backup.

## 16. Research references

The following primary documentation was rechecked on 12 October 2026. Pages and API behavior can change; implementation must verify the supported Chrome version and pinned dependency behavior before packaging.

1. Chrome: Load an unpacked extension - https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
2. Chrome: Extension service worker lifecycle - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
3. Chrome: Storage and cookies / IndexedDB in extensions - https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
4. Chrome: Declare permissions and host permissions - https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
5. Chrome: `chrome.alarms` behavior, sleep and persistence - https://developer.chrome.com/docs/extensions/reference/api/alarms
6. Chrome: `chrome.pageCapture.saveAsMHTML` and MHTML restrictions - https://developer.chrome.com/docs/extensions/reference/api/pageCapture
7. Chrome: `chrome.debugger` API, permission warning and enterprise restrictions - https://developer.chrome.com/docs/extensions/reference/api/debugger
8. Chrome DevTools Protocol: `Page.captureScreenshot` - https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot
9. Chrome: Manifest V3 remote-code requirements - https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
10. Chrome: Native Messaging requires a registered native host - https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
11. LM Studio: Local API server - https://lmstudio.ai/docs/developer/core/server
12. LM Studio: Server CORS and bind configuration - https://lmstudio.ai/docs/cli/serve/server-start
13. LM Studio: OpenAI-compatible endpoints - https://lmstudio.ai/docs/developer/openai-compat
14. LM Studio: Tool use and validated function execution model - https://lmstudio.ai/docs/developer/openai-compat/tools
15. Tiptap core source and MIT license - https://github.com/ueberdosis/tiptap
16. Tiptap editor architecture and open-source/proprietary feature boundary - https://tiptap.dev/docs/editor/getting-started/overview
17. MiniSearch source, capabilities and zero runtime dependencies - https://github.com/lucaong/minisearch
18. DOMPurify source, security behavior and dual license - https://github.com/cure53/DOMPurify
19. fflate source and MIT license - https://github.com/101arrowz/fflate
20. Chrome local network access restrictions and applicability to extension/API requests - https://developer.chrome.com/release-notes/142
21. Chromium Extensions discussion on host permissions and local-network checks - https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk
