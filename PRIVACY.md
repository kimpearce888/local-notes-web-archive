# Privacy Statement

**Local Notes & Web Archive for Chrome** is a local-first browser extension.
It has no backend, no accounts, no telemetry and no analytics. This document
states exactly what is stored, what network activity can ever occur, and how
logging treats your content. It complements [PERMISSIONS.md](./PERMISSIONS.md)
(permission rationale) and [SECURITY.md](./SECURITY.md) (threat model).

## What is stored, and where

Everything you create is stored **inside your Chrome profile's extension
storage** on this device — IndexedDB for records and blobs,
`chrome.storage.local` for small flags. Nothing is synchronized, replicated
or uploaded anywhere.

| Data | Where | Notes |
|---|---|---|
| Notes (rich text, plain-text projection) | IndexedDB | Full history kept as revisions (bounded, default 20) |
| Tags, categories, links | IndexedDB | Relationships alongside notes |
| Archived pages (MHTML, PNG, extracted text) | IndexedDB blobs | Stored per snapshot with content hashes |
| Attachments and inline images | IndexedDB blobs | Deduplicated by SHA-256 content hash |
| Reminders | IndexedDB | Local wall-clock times plus IANA timezone |
| Settings | IndexedDB + `chrome.storage.local` | Theme, capture limits, AI configuration |
| Audit events, diagnostic logs | IndexedDB | Sanitized (see below), size-bounded, rotatable |

The extension requests `unlimitedStorage` so archives are not artificially
capped; actual usage is visible in **Settings → Diagnostics** with per-kind
sizes and quota warnings.

## What network calls can ever happen

The extension's CSP restricts `connect-src` to the extension itself and
loopback hosts. Exactly two kinds of network activity exist:

1. **Capturing a page you explicitly asked to save.** When you save/archive
   a link, a temporary tab loads that page (like a normal browsing visit),
   then is closed. This only happens after you granted access to that site's
   origin (or the page is one you navigated and chose to capture from the
   context menu). No page is ever visited silently — URLs you type or paste
   are recorded as links and never fetched without an explicit capture
   action.
2. **Your own LM Studio server, on loopback only** (optional, off by
   default). When AI features are enabled, requests go to the endpoint you
   configured — `127.0.0.1` or `localhost` only; any other host is refused.
   Prompts carry the minimum content needed for the requested action.

There is no update ping, no usage report, no crash reporter, no remote
configuration, no font/asset CDN — the release gate and the diagnostics
network self-test both verify this.

## LM Studio behavior

- Off by default; every note feature works without it.
- The endpoint is validated to be loopback before any request is made.
- The current chat context (selected note content, when you invoke an action
  on a note) is sent to your local model — never anywhere else.
- Model responses are treated as untrusted proposals: tools are validated,
  bounded and permission-gated before anything executes.
- AI actions are audited (actor `ai`) with tool name, outcome and approval
  state — never the prompt or response content.

## Origin permissions

Site access is requested per-origin, only from your click on
"Allow access and capture", using Chrome's own permission prompt. Declining
keeps the link and marks it "permission required" — there is no silent retry.
Grants are listed and revocable in **Settings → Site access**; revoking
returns pending captures to "permission required" and never deletes saved
archives. See [PERMISSIONS.md](./PERMISSIONS.md) for the full model.

## Logging rules

Diagnostic logs and the audit trail are written locally and follow strict
redaction rules:

- **Never recorded:** note bodies, archived HTML, attachment contents, full
  prompts or model responses, history, passwords, tokens.
- **Recorded instead:** timestamps, severity, component, operation and
  correlation ids, durations, result codes, changed-field **names**, content
  **hashes**, and URL queries redacted to their parameter names.
- **Bounded:** technical logs rotate at a 5 MB ceiling; audit retention is
  configurable (default 365 days).
- **Opt-in export:** the Diagnostics page shows exactly what an export would
  contain before you download it; the export never includes note bodies.

## Deleting your data

Everything lives in one place. Uninstalling the extension (or deleting the
Chrome profile / clearing extension data) destroys it permanently — export a
backup first ([BACKUP_RESTORE.md](./BACKUP_RESTORE.md)). Individual deletes
(trash → permanent delete, snapshot delete, attachment delete) act
immediately on the local database.
