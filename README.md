# Local Notes & Web Archive for Chrome

A local-first, offline-first Chrome (Manifest V3) extension for personal notes,
web page archiving, reminders and optional local AI — **no cloud services, no
accounts, no telemetry, no remote code**.

The complete product specification is [`PRD.md`](./PRD.md) (v1.0, approved
architecture baseline). This repository contains the full production source,
tests, build tooling and the bundled third-party dependency inventory.

---

## What it does

- **Notes** — rich-text WYSIWYG editor (headings, lists, tables, images,
  attachments, links, code blocks, Markdown/HTML import-export), tags, nested
  categories, pinning, favorites, archive, trash with restore, revision history.
- **Web archive** — paste a link and capture the page: self-contained MHTML
  archive via Chrome's `pageCapture` API, extracted searchable text, and a
  best-effort full-page PNG screenshot through the DevTools protocol. Everything
  is stored locally in IndexedDB; MHTML is exported and opened from the
  filesystem, never rendered inside the extension UI.
- **Search** — full-text search over notes and archived page text with a query
  syntax (`tag:`, `is:pinned`, `has:snapshot`, phrases, exclusions), saved views
  and filters. Works completely offline, with or without AI.
- **Reminders** — one-time and yearly reminders with an inclusive final year,
  Feb-29 policies, DST-safe local wall-clock scheduling, and honest limits
  (Chrome must be running; nothing wakes a sleeping computer).
- **Local AI (optional)** — connects only to your own LM Studio local API on
  loopback. The model can propose validated tool calls (search, summarize, tag,
  create/edit notes, manage reminders); the application validates, authorizes
  and executes every operation under your chosen permission mode. There is no
  cloud fallback, ever.
- **Diagnostics & settings** — a full settings surface (appearance, capture
  behaviour and limits, site-access grants with revocation, reminder
  preferences, editor toolbar, retention, backup/restore with preview) and a
  diagnostics page (versions, storage, index status, permissions, LM Studio
  reachability, recent sanitized errors, audit trail, a network privacy
  self-test, and an opt-in diagnostics export with a review step).
- **First-run onboarding** — five short, honest points about local storage,
  permissions, optional AI, reminder limits and data-loss risk; nothing is
  gated behind it.

## Requirements

- Desktop **Google Chrome 120 or newer** (or a compatible Chromium distribution
  tested at the same version).
- Nothing else. No Node.js, no server, no database, no Docker, no native helper
  at runtime. The release folder is self-contained.

## Install (Load unpacked)

1. Build or download the release folder (`dist/`).
2. Open `chrome://extensions` and enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin the extension from the Chrome toolbar menu so the icon is always visible
   (Chrome does not allow an extension to pin itself).
5. Click the toolbar icon to open the dashboard in a normal tab.

> The `pageCapture` and `debugger` permissions shown during install are required
> for MHTML archiving and full-page screenshots respectively. They are used only
> on the single temporary tab opened for a capture you explicitly requested.
> See [`PERMISSIONS.md`](./PERMISSIONS.md) for the complete rationale.

## Update / uninstall — read this first

- **Update:** replace the files inside the same folder and press **Reload** on
  `chrome://extensions`. Do not uninstall/reinstall for routine updates — the
  extension keeps a stable ID and storage origin for the same folder path.
- **Data-loss warning:** all data lives in the Chrome profile's extension
  storage. Uninstalling the extension, deleting the profile, or clearing
  extension data **permanently deletes your notes, archives and backups stored
  inside the app**. Export a ZIP backup first — see
  [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md).
- If the extension folder is moved to a different path, Chrome may treat it as
  a new installation with a different storage origin. Export before moving.

## Backups

Full ZIP backup/restore (with preview, merge and replace modes) is built in:
dashboard → Settings → Backup. Individual notes export as JSON, Markdown or
sanitized HTML; snapshots export as MHTML, PNG and text. Nothing is ever
uploaded anywhere.

## Development

```bash
npm install        # installs exact pinned dependencies (package-lock.json)
npm run lint       # eslint
npm run check      # tsc --noEmit (strict)
npm test           # vitest unit tests
npm run build      # vite build -> dist/ (the loadable extension folder)
npm run release    # dist/ + versioned zip + SHA-256 checksums
npm run test:e2e   # Playwright smoke suite (loads dist/ unpacked)
```

A dev/test-only `Dockerfile.test` + `docker-compose.yml` reproduce the lint/
typecheck/unit-test environment. Docker is **never** used at runtime or for
installation (PRD §1, §7).

## License & third-party components

First-party code: **MIT** ([LICENSE](./LICENSE)). All bundled runtime
dependencies are free/open-source, pinned and vendored into the release folder:
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and
[`DEPENDENCIES.json`](./DEPENDENCIES.json). LM Studio (optional AI runtime) is
external, proprietary, user-installed software — never bundled or required.

## Documentation

| Document | Contents |
|---|---|
| [`PRD.md`](./PRD.md) | Product requirements (source of truth) |
| [`PRIVACY.md`](./PRIVACY.md) | What is stored locally, what network calls exist |
| [`PERMISSIONS.md`](./PERMISSIONS.md) | Every manifest permission, why, how to revoke |
| [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) | Honest limits: MCP, reminders, capture fidelity |
| [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) | Backup format, validation, merge/replace, portability |
| [`SECURITY.md`](./SECURITY.md) | Threat model, reporting, sandboxing, update policy |
| [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) | Licenses of every bundled runtime dependency |
| [`DEPENDENCIES.json`](./DEPENDENCIES.json) | Machine-readable pinned dependency inventory |
| [`docs/EXTENSION_IDENTITY.md`](./docs/EXTENSION_IDENTITY.md) | Stable extension ID and key management |

## Status

Implementation is complete against the PRD: every feature area (notes,
search, capture, reminders, local AI, data lifecycle, observability,
settings/onboarding) is implemented, tested and verified by the release
gate. See [`ai/plan.md`](./ai/plan.md) and [`ai/completed.md`](./ai/completed.md)
for the task-level record.
