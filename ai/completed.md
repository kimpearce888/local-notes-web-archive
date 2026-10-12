# completed.md — Completed Task Records

Every record: Task Name, Completion Timestamp, Validation Result, Commit Hash,
Push Status (ai/rule.md §8).

---
### T-001 Project management files
- Completion Timestamp: 2026-10-12T07:11:41Z
- Validation Result: ai/rule.md, ai/plan.md (43 tasks, full PRD traceability), ai/progress.md (queue), ai/completed.md created; files present and complete
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-002 Repository scaffolding
- Completion Timestamp: 2026-10-12T07:12:54Z
- Validation Result: .gitignore, LICENSE (MIT), full README (install/pin/update/uninstall/data-loss/backup), .env.example (test-harness only), Dockerfile.test + docker-compose.yml (dev/test-only, documented), src/ tree, tests/{unit,e2e}, docs/ created; no secrets or personal paths present
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-003 Toolchain and pinned dependencies
- Completion Timestamp: 2026-10-12T07:18:20Z
- Validation Result: tsc --noEmit green (tsconfig.app.json + tsconfig.node.json, strict); eslint . green (no-eval/no-new-func errors, no-explicit-any); vitest 4/4 green; 26 runtime deps + 14 dev deps pinned exact with committed lockfile; release.mjs static gate scans dist for remote URLs and dynamic code
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-004 Core domain types
- Completion Timestamp: 2026-10-12T07:21:21Z
- Validation Result: tsc strict green (app+node), eslint green, vitest 11/11 green; all PRD §6 entities typed with branded ids/ISO timestamps/local reminder dates; per-artifact capture states and FR-SET-01 settings surface covered
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-005 Utility foundations
- Completion Timestamp: 2026-10-12T07:25:33Z
- Validation Result: tsc strict green, eslint green, vitest 34/34; UUID v4 gen+validation, UTC/IANA/leap-year time utils, SHA-256 WebCrypto (verified against reference vector), bounded-string helpers, URL normalize/dedup/redact + full FR-CAP-04 eligibility gate matrix (14 reject cases), deepFreeze
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-006 IndexedDB schema and migrations
- Completion Timestamp: 2026-10-12T07:29:29Z
- Validation Result: tsc strict green, eslint green, vitest 42/42; 15 canonical stores with full index layout incl. composite keys; versioned idempotent migrations; MigrationFailedError rollback proven to preserve data; versionchange step-aside and lower-version rejection tested
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-007 Repository: notes and revisions
- Completion Timestamp: 2026-10-12T07:33:33Z
- Validation Result: tsc strict green, eslint green, vitest 57/57; transactional save of doc+projection+revision; createdAt-once and updatedAt-on-commit semantics; optimistic concurrency (NoteConflictError); bounded retention with floor 20 and restore-as-new-revision; archive/trash lifecycle; confirmed cascade permanent deletion; monotonic session clock for deterministic ordering
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-008 Repository: tags, categories and joins
- Completion Timestamp: 2026-10-12T07:36:41Z
- Validation Result: tsc strict green, eslint green, vitest 70/70; normalized unique tag keys with duplicate/collision rejection; merge with join reassignment + dedup; nested categories with cycle prevention on move/merge; delete-with-reassignment semantics; transactional join replacement; bulk additive assignment
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-009 Repository: links, snapshots, attachments
- Completion Timestamp: 2026-10-12T07:41:51Z
- Validation Result: tsc strict green, eslint green, vitest 85/85; content-addressed blob store with reference-aware GC; per-note link dedup + cross-note duplicate lookup; snapshot per-artifact states with FR-CAP-07 status derivation, recapture chains, integrity verification detecting tampering; magic-byte MIME verification with strict-UTF-8 text heuristic; attachment size limits and hash dedup
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-010 Repository: reminders, audit, logs, settings
- Completion Timestamp: 2026-10-12T07:59:22Z
- Validation Result: tsc strict green, eslint green, vitest 98/98 (15 consecutive clean full-suite runs); canonical reminder records with state transitions and due queries for reconciliation; audit trail with hashes-not-bodies, pagination and retention; structured logs with secret sanitization (bearer-before-kv ordering), rolling byte budget rotation; settings with defaults/merge/validation incl. loopback-only AI endpoint enforcement; fixed a real nondeterministic-sort bug (partial comparator) found by stress testing
- Commit Hash: (this commit)
- Push Status: pushed with this commit
---
### T-011 Search engine
- Completion Timestamp: 2026-10-12T08:06:21Z
- Validation Result: tsc strict green, eslint green, vitest 114/114 across 3 consecutive runs; FR-SEARCH-04 query syntax with inline error explanations (dates, unknown flags, impossible ranges, unclosed quotes); MiniSearch projections over all FR-SEARCH-01 fields; phrase matching with post-verification; optional fuzzy; exclusions; field scopes; has:/is:/tag:/category: filters incl. category descendants, overdue reminders, source domain, capture windows; sort by relevance/title/created/modified/reminder/capture with pagination; persisted index with corruption-triggered canonical rebuild; incremental doc add/discard/remove consistency
- Commit Hash: (this commit)
- Push Status: pushed with this commit

## T-012 Service worker core
- **Completion Timestamp:** 2026-10-12T09:00:00Z
- **Validation Result:** tsc strict (app+node) green; eslint green; vitest 183/183 (69 new background tests: protocol, router error mapping, dashboard tab focus, context-menu quick capture, alarm reconciliation, lifecycle, full RPC handler matrix over fake-indexeddb)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** typed RPC protocol with correlation ids and coded errors (PRD §12); single dashboard tab open/focus incl. new-note intent delivery; context menus (save current page / save selection) restricted to http(s) documents; alarm reconciliation on install/update/browser-start/worker-start and after every reminder mutation (FR-REM-04); stateless worker with IndexedDB as the only durable store. Security fix discovered by tests: createLink now rejects non-http(s) schemes (javascript: could previously become a link record).

## T-013 Manifest and icons
- **Completion Timestamp:** 2026-10-12T09:08:00Z
- **Validation Result:** tsc strict (app+node) green; eslint green; vitest 200/200 (17 new manifest tests: permissions matrix, CSP narrowing, loopback-only hosts, optional host permissions, commands, icon dimensions/byte-stability/determinism, pinned extension ID, no remote URLs)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** MV3 manifest with PRD §8.2 narrowest permission set (incl. contextMenus for §4.1 actions), loopback host_permissions, optional http/https host permissions, minimum_chrome_version 120, commands (_execute_action Alt+Shift+N + create-note Alt+Shift+C). CSP: script-src/object-src 'self'; connect-src 'self' + loopback verified against Chromium csp_validator.cc (localhost/127.0.0.1 sources are allowlisted secure tokens). Deterministic icon generator (pure geometry, 4x supersampling, zero deps) with byte-stability tests. Extension identity pinned via manifest "key" (public half committed; private pem gitignored under keys/, rotation-refusing generator, documented in docs/EXTENSION_IDENTITY.md; pinned ID pieeojhacbmcmkfakahpapgpmejgnaij). Full vite build/structure check lands with T-014 when the dashboard entry exists.

## T-014 Dashboard shell
- **Completion Timestamp:** 2026-10-12T09:16:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 228/228 (28 new shell tests); `npm run build` produces the loadable unpacked structure (dist/manifest.json, dashboard.html, assets/background.js + dashboard.js/css, icons/) and the static release-gate scan passes (no remote URLs, no dynamic code)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** PRD §4.1 top-to-bottom order (New Note → search+filters → toolbar with active-filters/sort/view-toggle → results); single-stylesheet design system with custom properties, light/dark/system themes, WCAG-AA-minded tokens, :focus-visible, reduced motion, no colour-only status; semantic HTML with skip link, labelled controls, radiogroup view toggle; live region + save-state label (Saving/Saved/Save failed) and loading/empty/error region states with retry; keyboard shortcuts (Ctrl+K, /); theme engine with live system tracking; ui-intent new-note handling (tab message + ?new=1); shell event API for the state manager (T-015) and views (T-016). HTML entry moved to repo root for correct dist/dashboard.html output.

## T-015 Dashboard state manager + messaging client
- **Completion Timestamp:** 2026-10-12T09:28:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 252/252 (24 new: client envelope/error/coded-failure/malformed-response/concurrency, store patch+notify semantics, controller end-to-end over the REAL router + fake-indexeddb: load/retry, optimistic create+rollback, live search requery, save flow Saving→Saved, conflict rollback + Save failed labelling, beforeunload guard engage/release, sort wiring)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** typed ApiContract shared between dashboard client and background router (payload+result per message, no drift possible); client wraps chrome.runtime.sendMessage with correlation ids and coded RpcClientError; store with subscription model and change-only notifications; controller = single writer wiring shell events (newNote/search/sort/view) to RPC, optimistic UI with truthful rollback, save-state indicator mirrored to the shell, beforeunload guard while saving; new-note intents (button, tab message, ?new=1) now create real persisted notes; minimal accessible result list until card views (T-016).

## T-016 Cards and list views
- **Completion Timestamp:** 2026-10-12T09:46:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 287/287 (35 new: pure card view-models incl. safe truncation/reminder chips/indicator mapping, XSS-safe textContent rendering, smart-list filter mapping, bulk-bar visibility/permission gating, controller integration over the REAL router: card+related rendering, grid/list toggle, pinned/archived/trashed smart lists, pagination windowing with 55 seeded notes, multi-select archive/tag/category assignment/trash/restore/permanent-delete with audit assertions)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** full PRD §4.2 card field set (title/subtitle/tag+category chips/created+modified/reminder state/link+snapshot indicators/plain-text preview with word-boundary truncation); grid+list toggle; seven smart lists incl. overdue; pagination (page size 50, windowed rendering — only the page's cards exist in DOM); select-all with indeterminate state; bulk actions bar with per-view permission gating and honest per-item failure reporting; tag/category assignment dialogs + destructive confirmations (native dialog; E2E coverage in T-042); background additions: notes/related-bulk handler and audit events on all note mutations (FR-LOG-02, correlation-linked).

## T-017 Editor core with full feature matrix
- **Completion Timestamp:** 2026-10-12T10:04:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 311/311 (24 new: exact §4.4 node/mark schema set incl. textStyle-attribute model, JSON round-trips with attr normalisation, full inline mark toggles, font size/colour/highlight/alignment, tables/task lists/code-block language labels/images, undo/redo, sanitisation gates (scripts/handlers/unsafe protocols/CSS vocabulary/checkbox preservation), Markdown import+export+GFM round-trip, find/replace semantics incl. wrapping and regex-metachar safety)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** Tiptap 3.31.4 StarterKit with codeBlock replaced by CodeBlockLowlight (language labels) and Link configured explicitly (openOnClick:false — clicks route through the panel's safe-open callback; autolink; safe rel); TextStyle+Color+FontSize+BackgroundColor+multicolour Highlight+Sub/Superscript; TextAlign on heading/paragraph; task lists nested; Table family resizable; Image (inline:false, base64 allowed); Placeholder + CharacterCount. Accessible toolbar (aria-pressed/disabled sync, grouped separators, bounded swatch lists); link/image dialogs with protocol validation; find bar (Ctrl+F) with match count, cycling and replace/replace-all; sanitised HTML source view (DOMPurify with CSS property whitelist via registered hooks — DOMPurify applies ALLOWED_URI_REGEXP to non-URI-safe attrs like input type, fixed via ADD_URI_SAFE_ATTR); Markdown import/export (marked + turndown + gfm plugin added and pinned); in-app toolbar+schema documentation dialog; escapeHtml helper for text-projection replacements. Dependencies added pinned: @tiptap/extension-link 3.31.4, turndown-plugin-gfm 1.0.2 (+ .d.ts); tsconfig.node include extended for ambient type declarations.

## T-018 Autosave, revisions and recovery
- **Completion Timestamp:** 2026-10-12T10:20:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 323/323 (12 new: autosave debounce/flush/cancel/failure semantics with fake timers, crash-journal round-trip/newer-than gating/16-entry bound/clear-after-save, editor-session end-to-end over the real router: typed edits autosaved with plain-text projection + revision recorded + journal cleared, recovery restores newer journal snapshot into the editor with announcement, revision panel lists + restores-as-new-revision, multi-tab conflict presents both versions and reload/duplicate escape hatches, close() flushes pending autosave)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** editor session module owns one note's editor screen: debounced 800ms autosave through saveNoteDetailed (coded outcomes; conflicts route to the FR-NOTE-07 dialog with reload/compare/duplicate), throttled 500ms sessionStorage crash journal (survives renderer crashes; cleared on save; 16-entry bound), revision history panel (previews via editorDocToPlainText; restore-as-new-revision), controller integration (openEditor/closeEditor, view switching, card title buttons open notes, duplicateWithContent conflict escape, safe external link opening via noopener window.open); chunkSizeWarningLimit raised with documented rationale (all-local bundle, PRD §11 measurement defers to release verification).

## T-019 Images and attachments pipeline
- **Completion Timestamp:** 2026-10-12T11:05:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 354/354 (31 new: attachments API over the real router — magic-byte MIME verification, per-note hash dedup, cross-note blob sharing with reference-aware GC, pre-write size limit with coded `attachment-too-large` error, empty/non-Blob/unknown-note payload rejection, filename sanitisation, oldest-first listing, search-projection add/rename/delete for attachment filenames, audit events with metadata only; LocalImage extension — width/caption schema round-trips through JSON and HTML, out-of-range width rejection, figure/figcaption node view with editable caption committing on blur, resize presets updating node attrs, attachment-src resolution with truthful load-failure state, data: URLs bypassing the resolver, sanitisation gate keeping `attachment:` UUID references and data-width/data-caption while stripping handlers and non-UUID attachment schemes; session end-to-end — pasted image files stored and inserted as durable `attachment:` refs rendered via session object URLs, repeated paste dedup with node re-insertion after NodeSelection, non-image files attached as note files, mislabelled images verified honestly and kept as files, oversized images rejected before any write, saved documents never contain session blob: URLs, object URLs revoked on close, attachments panel list/rename-dialog/delete-confirm/download-anchor flows)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** durable storage model: binaries live in the content-addressed blob store; documents keep stable `attachment:<uuid>` srcs resolved to session-scoped object URLs by a node view (resolver injected via extension options; nothing fetched over the network). Background: attachments/add (structured-cloneable Blob over the RPC channel, pre-write size check, hostile-filename sanitisation), list-for-note, get-blob, rename, delete (reference-aware blob GC + note re-index) with audit events carrying metadata only (FR-LOG-02) and a new `attachment-too-large` RpcErrorCode. Editor: file picker in the image dialog (data: URL path retained), paste + drag/drop file ingestion (bounded 20/call, drop position honoured, NodeSelection-aware re-insertion), LocalImage node with caption/width attributes and accessible resize controls. Attachments panel in the editor session with filename/type/size, rename dialog, explicit delete confirmation, anchor-download/open via object URLs (chrome.downloads deliberately not requested). Pre-existing debt fixed en route: release static gate now allowlists inert dependency literals (W3C XML namespace identifiers, documentation links inside error messages) while still catching real remote URLs (verified with negative tests); editor-session restore/conflict paths guard disposed editors; a racing journal-clear assertion in T-018 tests now waits for the async clear.

## T-020 URL detection and link queue
- **Completion Timestamp:** 2026-10-12T11:20:00Z
- **Validation Result:** tsc strict green; eslint green; vitest 376/376 (22 new: detectHttpUrlsInText matrix — messy prose extraction in first-seen order, trailing-punctuation/unbalanced-paren trimming, non-http/bare-domain rejection, dedup; links/detect-and-queue policy — pasted eligible URLs queued under the default auto-capture setting, detection-only when disabled, manual URLs never auto-visited, capture-ineligible http(s) URLs kept as links with gate reasons (loopback/private), non-http(s) and credential URLs rejected outright with zero records, dedup without state downgrade, unknown-note and 50-URL batch rejection, audited count-only summaries; queue-capture — explicit user queueing, ineligible refusal with the gate reason and record survival, not-found; state transitions incl. snapshot-derived captured and legacy-record normalisation; session integration — pasted URLs queued+announced, plain-text pastes converted to structured content so URLs survive as clickable link marks, autolink preserved in the saved doc, disabled-setting detection-only, typed URLs detected post-save from title+plain-text projections and never queued; card link indicator surfaces queued counts)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** Link model gains the FR-CAP-01..03 capture lifecycle (detected/queued/permission-required/capturing/captured/failed) with read-time normalisation for pre-T-020 records (snapshot presence implies captured) — no schema migration needed since IndexedDB records are schemaless. The queue policy lives in one background handler (links/detect-and-queue): paste + autoCaptureOnPaste + FR-CAP-04 gate → queued; everything else → detected, with existing links never downgraded. Plain-text pastes containing URLs are restructured into link-marked text runs (rich HTML pastes keep their own links through the schema gate); title paste detection and post-save typed-URL detection scan the title and plain-text projections. links/queue-capture is the explicit user entry point (truthful gate-reason failures); links/set-capture-state covers queue lifecycle transitions for T-022+. Card link chips surface queued capture counts; LinkNotFoundError maps to the coded not-found error.

## T-021 Origin permission manager
- **Completion Timestamp:** 2026-10-12T12:30:00Z
- **Validation Result:** tsc strict green (app+node); eslint green; vitest 399/399 (23 new: pure permission state machine — grant resumes only permission-required links, decline never changes state, revoke demotes queued/capturing only; originPattern exact-origin mapping incl. ports with rejection of paths/queries/non-web schemes; listGrantedCaptureOrigins loopback exclusion + sorted dedup; permissions/list-granted per-origin link and waiting counts; request-capture-permission — grant flow (exact pattern requested from the gesture window, link queued, settings mirror updated, audited), already-granted short-circuit without a prompt, user-decline keeps the link at permission-required with no grant recorded and an audited "no retry" note, gesture-less request resolves false harmlessly, gate-ineligible and unknown-link coded failures, detected links granted access without auto-queueing; revoke — grant removal, queued+capturing demotion, captured archives and detected links untouched, other origins unaffected, settings mirror pruned, audited counts, no-op revoke, malformed-origin rejection; queue-time checks — pasted eligible URLs park at permission-required for unauthorized origins, re-paste after grant promotes to queued, queue-capture returns permissionRequired truthfully, authorized origins queue immediately, manual URLs never auto-visited; v1→v2 migration adds links.origin index with record preservation and fresh-install layout verification)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** Schema v2 (migration machinery exercised for real): links.origin index for per-origin bookkeeping; SCHEMA_VERSION/DB_VERSION bumped with the v1→v2 upgrade test proving data survives. Background permissions module wraps chrome.permissions with exact `scheme://host[:port]/*` patterns; requests run inside the dashboard click's user-gesture window (gesture propagates across runtime.sendMessage — modelled by the mock's gestureActive flag; contains() needs no gesture). Three RPCs: links/request-capture-permission ("Allow access and capture"), permissions/list-granted (chrome.permissions.getAll() is the source of truth — reflects out-of-band grants — with the settings.allowedOrigins mirror maintained on grant/revoke), permissions/revoke (deletes nothing: finished archives stay, pending work returns to permission-required; active-capture abort lands with T-022's queue). Queue-time access checks added to links/detect-and-queue and links/queue-capture (origin cache per batch; detected/permission-required links adopt the current verdict on re-paste). Chrome mock gains a permissions surface (granted patterns, gesture model, forced decline, request call log). Contract gains the three entries; queue-capture result now carries permissionRequired. T-020 tests updated to pre-grant origins where queuing is the expected outcome.

## T-022 Capture queue and orchestration
- **Completion Timestamp:** 2026-10-12T14:05:00Z
- **Validation Result:** tsc strict green (app+node); eslint green; vitest 429/429 (30 new: tab driver — inactive-tab creation that never activates (FR-CAP-10), post-redirect final-URL reporting for origin validation, timeout failure with temporary-tab removal, mid-load tab-closed failure, idempotent close, chrome-surface discipline (tabs APIs only); queue — end-to-end job over the real IndexedDB stack (tab, origin validation, steps, link captured), concurrency hard-limited to one job at a time, service-worker restart requeue of `queued` links, ineligible-URL refusal before any tab opens, missing-grant parking at permission-required, cross-origin redirect aborting extraction BEFORE any artifact step yet still cleaning up the tab, same-origin redirect accepted, mid-capture revocation winning over the steps outcome (snapshot kept unlinked), time-budget failure with truthful failed state and tab cleanup, cancel before start / of the active job / after a snapshot was created (finalized canceled and kept linked), retry of failed links, reuse policy linking an existing same-dedup-key snapshot, ask policy parking a decision while other jobs keep draining, reuse/new resolution of parked duplicates, always-new policy, cancel of a parked duplicate, progress broadcast to open dashboard tabs, listener-less dashboard tabs tolerated, notifyLinkQueued firing on paste-queueing with an end-to-end subscribed queue, manual typed URLs never firing the hook, listener failure isolation)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** Sequential single-worker queue with concurrency=1 (FR-CAP-03): one temporary INACTIVE tab per job opened by tab-driver.ts (load-wait bounded by the remaining job budget, truthful timeout/tab-closed/create-failed failures, guaranteed idempotent cleanup). Job pipeline: FR-CAP-04 gate re-check → origin permission re-check (revocation between queueing and processing parks back at permission-required) → duplicate-capture policy (reuse/ask/always-new, FR-CAP-08; parked `waiting-dedup` entries keep draining other jobs) → capture-state claim → tab open → redirect validation (final origin must equal the authorized origin or extraction aborts with the reason) → injected CaptureSteps under the whole-job time budget with Promise.race aborts (cancel + timeout) → truthful finalization (permission re-check after capture wins; snapshotId-linked success with status/warnings; failure never overwrites a previous success on the link). Steps land with T-023/024/025 via the injected CaptureSteps interface (engine-agnostic queue: it never touches pageCapture/debugger itself). FR-CAP-07 all-canceled derivation added to snapshots.ts. New repos: listLinksByDedupKey (cross-note duplicate detection), listLinksInState (restart recovery). Links/permissions APIs notify the queue via onLinkQueued after every queueing transition (paste policy, explicit queue, permission grant) — production singleton subscribes when T-023 mounts the real steps. Dashboard announces terminal capture phases through the shared live region. Chrome mock gained tabs.get/remove/onUpdated/onRemoved with tab title/status.

## T-023 MHTML capture and snapshot persistence
- **Completion Timestamp:** 2026-10-12T14:20:00Z
- **Validation Result:** tsc strict green (app+node); eslint green; vitest 449/449 (20 new: production steps — end-to-end capture over the REAL queue + tab driver + IndexedDB: snapshot record with sourceUrl/finalUrl/title/timestamp/format-quoted-atom/hash/size/blob-key, text/png honest not-attempted states, partial status, stored blob round-trip, pageCapture called on the temporary tab, tab cleaned up; empty-title fallback to the final URL; size-budget refusal (settings floor 1KB respected) with oversized warning and no stored blob; empty archive and pageCapture-throwing both → failed artifact + resource-failure warning; failed recapture leaves the previous success linked with its blob/hash intact; successful recapture chains previousSnapshotId and re-points the link with history preserved; audit events carry status/warnings with redacted URLs; deriveStatus — all-terminal-no-failure → canceled, saved+not-attempted → partial with intermediate pending → capturing; pipeline — singleton identity and reset, paste-policy link captured end-to-end through the production notifyLinkQueued subscription, worker-restart requeue through handleWorkerStartup; RPCs — idle status, cancel of a queued-but-not-enqueued link via the DB-state fallback, unknown-link cancel false, malformed payloads invalid-request, ask-policy park + resolve-new producing two distinct snapshots, resolve-reuse linking the existing snapshot without a new pageCapture call, non-retryable 'capturing' state refused)
- **Commit Hash:** (this commit)
- **Push Status:** pushed to origin/main
- **Notes:** steps.ts is the production CaptureSteps injected into the T-022 queue: createSnapshot FIRST (a record always exists for cancel/timeout finalization; recapture chain via job.existingSnapshotId), then chrome.pageCapture.saveAsMHTML with undefined/empty/oversized/thrown failures each mapping to truthful artifact states + bounded warnings (oversized respects settings.capture.maxArchiveBytes — nothing stored over budget), text/png marked not-attempted only while still pending (a cancel that landed mid-capture wins over relabeling), warnings appended after artifacts, outcome mirrored from the persisted record, never throws (queue owns failure semantics). QUEUE FIX found by the new tests: finalization previously linked any snapshotId — now requires outcome.status !== 'failed' (a failed capture never links, preserving the previous success FR-CAP-05) with a truthful reason per branch; retry now also accepts 'captured' (retry = the recapture entry point, FR-CAP-08). deriveStatus rewritten: pending → capturing (any artifact still pending), saved>=1 terminal → partial, nothing saved + any failed → failed, nothing saved + canceled → canceled (user stopped it, nothing lost). pipeline.ts owns the production singleton (subscribed to onLinkQueued; resetCapturePipeline test hook); worker index.ts wires it at top level; handleWorkerStartup requeues links left queued by suspension with a lifecycle log. api/capture.ts adds capture/status, capture/cancel (with queued-in-DB-only fallback to detected), capture/retry, capture/resolve-duplicate with audit + redaction; contract entries typed via CaptureQueueStatus (QueueStatus renamed). Chrome mock gained pageCapture.saveAsMHTML with per-tab Blob/Error presets. Test-infra lesson: tab-cleanup assertions must waitFor the finally-path async closeTab (load-dependent flake observed once, hardened in all four sites).
