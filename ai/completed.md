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
