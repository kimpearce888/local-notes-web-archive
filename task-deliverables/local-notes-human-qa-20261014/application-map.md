# Application Map — Local Notes & Web Archive (v1.0.4 build)

Discovered from source tree (`src/`), the running built extension, product docs (PRD.md, KNOWN_LIMITATIONS.md, README) and the test tree. Every screen/panel below was opened in the real UI during the audit unless marked otherwise.

## Entry points

| Entry point | How reached | Status in audit |
|---|---|---|
| Toolbar action → `dashboard.html` | Chromium extension load, `chrome-extension://<id>/dashboard.html` | Exercised (all sessions) |
| Service worker (MV3) | Persistent-context extension load; SW start awaited | Exercised (all sessions) |
| Context menus (`context-menus.ts`: quick capture) | Chrome page context menu | NOT RUN (no web pages in sandbox) |
| `notify` page (`notify` bundle, notification click-through) | Notification interaction | BLOCKED (no OS notifications) |
| Second dashboard tab | `context.newPage()` → same URL | Exercised (X3, X4, F5) |

## Screens / views (dashboard)

1. **Dashboard shell** — persistent left sidebar (brand, New Note CTA, 7 smart lists, footer: Import/Settings/Diagnostics) + content column (sticky search topbar with Filters + palette trigger, toolbar row with active-filters chips region / sort select / view toggle, bulk-bar mount, filters region (empty — D-02), results heading with select-page, cards grid, pagination, status bar with save-state + live region).
2. **Onboarding dialog** (first run; re-showable from Settings — D-05).
3. **Editor session** — title + subtitle inputs, TipTap prose surface, sticky grouped toolbar (history / text marks / font / blocks / lists / table / media / tools), session header (Back · Revisions · Attachments · Snapshots · Reminders · AI · File · Pin · Move-to-trash…), floating find bar, HTML source view.
4. **Editor sub-panels** — Revision history; Attachments; Snapshots; Reminders; AI assistant.
5. **Settings dialog** — Appearance (theme, default view, default sort); Web capture (auto-capture on paste, duplicate mode); Reminders (notifications checkbox); Editor (toolbar-group checkboxes); AI (enable, endpoint, model, permission mode, test); Storage (backup export/restore — D-06); onboarding re-show; Save/Reset/Close.
6. **Diagnostics dialog** — storage/permissions/AI status sections, Refresh, network privacy self-test, Test LM Studio, export diagnostics (review → download), rebuild search index.
7. **Command palette dialog** (Ctrl+K) — combobox over existing actions.
8. **Dialogs** — confirm (bulk trash / permanent delete / editor trash / attachment delete / reminder delete), assign-tags, assign-category, add/edit reminder, snooze reminder, insert/edit link, insert image, rename attachment/snapshot, compare snapshots, duplicate-capture decision, restore-backup review, diagnostics export review.

## Data boundaries (stores behind the views)

- IndexedDB (`local-notes-web-archive`, schema v2): notes (+revisions), tags, categories + joins, links, snapshots, attachments (blobs), reminders, audit log, structured logs, settings record.
- DOM `sessionStorage`-backed recovery journal (editor keystrokes).
- `chrome.storage` not used for app data (onboarding flag lives in the settings record).
- Filesystem boundaries: exports (note .md/.html/.json, diagnostics .json, backup .zip — D-06) via download events; imports via file pickers.

## Integrations / runtime dependencies

- **LM Studio** (optional): loopback-only OpenAI-compatible client; absent in audit environment → honest degradation verified.
- **DevTools protocol** (capture screenshots): only on temporary capture tabs; not exercisable in sandbox.
- **chrome.alarms / notifications**: reminder delivery; requires browser running (documented limitation).
- **Network**: none required for core operation — offline verified (D7 in pass-d).

## Feature inventory (28 areas)

Notes CRUD · rich-text editor matrix · title/subtitle · tags · categories · pin · favorites (data+views only — D-01) · archive/restore · trash/permanent delete · duplicate · search (terms + operators) · filters UI (empty — D-02) · saved views (absent — D-02/D-03) · sort · pagination · view modes · selection + bulk actions · command palette · attachments (broken — D-04) · images (data-URL path only — D-04 blocks picker) · links + URL detection · web capture (blocked) · snapshots (empty-state verified) · reminders (validation/lifecycle verified; firing blocked) · revisions + restore + conflicts · import (.md/.html verified; .json failure path verified; success path not run) · export (.md verified; .html/.json not run) · backup/restore (broken — D-06) · settings + theme persistence · diagnostics · onboarding (first-run verified; re-show defect D-05) · offline operation.

## State boundaries (summary; full matrix in state-transition-matrix.csv)

- Note: active ↔ archived; active → trashed → active; trashed → permanently deleted (irreversible); draft → autosaved → modified → saved; revision restore rolls content back; conflict on concurrent tab save.
- Reminder: none → active (one-time/yearly) → completed/dismissed/deleted; snooze pending; validation states block creation.
- UI: selection on/off (cleared across queries), editor open/closed, dialog open/cancel/confirm, theme system/light/dark (persisted only via Save — G-07), search set/cleared, page 1↔2, palette open/closed, panel open/closed.
