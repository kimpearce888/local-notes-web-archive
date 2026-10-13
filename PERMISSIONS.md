# Permissions

Every permission in the manifest, why it exists, when it is used, and how to
reduce or revoke it. This is the reference behind the install-time prompt;
the privacy details live in [PRIVACY.md](./PRIVACY.md).

## API permissions (required)

| Permission | Why it is required | When it is used |
|---|---|---|
| `storage` | Notes, archives, settings and logs persist in `chrome.storage` / IndexedDB | Constantly, locally |
| `unlimitedStorage` | MHTML archives and screenshots exceed Chrome's default extension quota | Storage accounting; no quota ceiling on archives |
| `alarms` | Reminder scheduling needs a wake-up source that survives tab closes | When reminders exist; alarms are hints, durable state is the source of truth |
| `notifications` | Showing reminder notifications | Only when enabled in Settings; dashboard overdue lists work without it |
| `contextMenus` | "Save this page" / "Save selection as note" from the right-click menu | When you use those menu items |
| `scripting` | Injecting the narrowly scoped text-extraction script into a page being captured | Once per capture, on the temporary capture tab |
| `pageCapture` | Producing the self-contained MHTML archive | Once per capture, on the temporary capture tab |
| `debugger` | Full-page PNG screenshots via the DevTools protocol (CDP) | Only attached to the temporary capture tab, with a hard command allowlist (`Page.getLayoutMetrics`, `Page.captureScreenshot`), detached in `finally` |

The `debugger` permission shows Chrome's "started debugging this browser"
banner during a screenshot capture. It is never attached to any tab you are
browsing, and AI tools can never drive it.

## Host permissions

| Pattern | Kind | Purpose |
|---|---|---|
| `http://127.0.0.1/*`, `http://localhost/*` | Required | The only non-extension network peer: your LM Studio endpoint (optional) |
| `http://*/*`, `https://*/*` | Optional | Page capture, granted per-origin on demand |

### How site access works

1. You save/archive a link to a site. The link is recorded — nothing is
   fetched yet.
2. If the origin has no grant, the link is parked as **permission required**.
3. Your click on **"Allow access and capture"** triggers Chrome's permission
   prompt for that exact origin. A grant resumes the capture; a decline
   changes nothing and is never retried silently.
4. Grants are listed with per-origin link counts in **Settings → Site
   access**, and each can be revoked there. Revoking returns pending captures
   to "permission required" and never deletes saved archives.

### What capture never touches

The URL gate (enforced before any tab opens) rejects: non-HTTP(S) schemes,
URLs with embedded credentials, `localhost`/loopback, link-local, private and
reserved IP ranges, and browser-internal pages. Redirects are re-validated —
if a page redirects to an origin you did not authorize, extraction aborts.

## Content security policy

```
script-src 'self'; object-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*
```

No remote code, no `eval`/`new Function`, no CDN assets. The release gate
scans every built file for remote URLs and dynamic-code patterns; the
Diagnostics page ships a runtime network privacy self-test asserting the
declarative surface (CSP, host permissions, AI endpoint loopback).

## Minimum-usable configuration

You can decline every optional host grant, keep notifications off, and leave
AI off: notes, tags, search, reminders (in-dashboard), backup and export all
work. The required API permissions above cannot be dropped without removing
the corresponding feature.

## Revoking everything

- Per-origin site access: **Settings → Site access → Revoke**.
- Notifications: Chrome site settings for the extension, or disable in
  Settings (in-dashboard overdue display is unaffected).
- Alarms: clearing all reminders stops alarm creation.
- The extension itself: removing it removes all permissions and all data —
  export a backup first ([BACKUP_RESTORE.md](./BACKUP_RESTORE.md)).
