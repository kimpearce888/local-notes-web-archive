# Known Limitations

Honest limits of **Local Notes & Web Archive for Chrome**, stated up front
rather than discovered later. Each entry explains what the extension does
about it.

## Reminders depend on Chrome running

- Reminder alarms fire only while the browser is open; nothing can wake a
  closed computer from an extension.
- Chrome may discard alarms across restarts or crashes. Durable state is the
  database: on install/update, worker startup and browser startup, alarms are
  reconciled from the canonical records, so reminders are re-scheduled —
  including occurrences missed while the browser was closed.
- Missed occurrences are coalesced into one concise notification and shown as
  overdue in the dashboard.
- Notification delivery further depends on Chrome and OS notification
  settings, which an extension cannot query or change; the Diagnostics page
  states this explicitly instead of pretending to check it.

## Full-page screenshots are best-effort

- Screenshots use the DevTools protocol on the temporary capture tab. Pages
  with fixed-position overlays, endless-scroll behavior, cross-origin iframes
  or WebGL canvases may not be captured perfectly.
- Very tall pages are captured in tiles up to the configured pixel ceiling;
  beyond it the PNG is marked **partial** with the reason, and the MHTML
  archive and extracted text remain complete.
- A screenshot failure never discards the rest of the capture: the snapshot
  records per-artifact states (MHTML / PNG / text) independently.

## Some pages cannot be archived

The URL gate deliberately rejects: non-HTTP(S) schemes, URLs with embedded
credentials, `localhost`/loopback, link-local, private and reserved IP
ranges, and browser-internal pages (`chrome://`, the Web Store, etc.).
Password-protected or paywalled pages archive only what the capture tab
could actually load. Pages that render almost entirely through opaque
JavaScript may yield thin extracted text; the MHTML archive still preserves
the loaded DOM.

## MHTML is never rendered inside the extension

Archives are exported to the filesystem and opened as files — never loaded
into the dashboard — because an MHTML file is untrusted web content. In-app
preview is the saved PNG plus the extracted text only.

## Local AI depends on your LM Studio

- AI features require LM Studio (or any OpenAI-compatible loopback server)
  running and a model loaded. If it is unreachable, AI features degrade
  gracefully with a truthful error; every other feature keeps working.
- Output quality, tool-use competence and instruction-following depend
  entirely on the model you load. The application bounds what tools can do,
  but a weak model produces weak proposals.
- The connection is loopback-only (`127.0.0.1` / `localhost`). There is no
  cloud fallback and none will be added.

## There is no external MCP server

The AI assistant's tools (search, read, create/update, tag, reminder and
snapshot operations) are **internal** to this extension: function calls
validated and executed by the extension's own code. There is no Model
Context Protocol server, no external tool registry, and no plan to add one.
Settings and documentation state this plainly so "tool use" is never
mistaken for external connectivity (per the MCP disclosure requirements).

## Storage is a single browser profile

- All data lives in one Chrome profile on one machine. Multi-device sync is
  intentionally absent; the supported path is backup export → restore
  ([BACKUP_RESTORE.md](./BACKUP_RESTORE.md)).
- Uninstalling the extension, deleting the profile, or clearing extension
  data deletes everything permanently. The settings and onboarding surfaces
  repeat this warning before destructive actions.
- Moving the unpacked extension folder can change its identity/storage origin;
  export before moving.

## Browser-extension physics

- Service workers are ephemeral: state is rebuilt from IndexedDB on wake, so
  a hard crash mid-save can lose the last keystrokes — the editor writes a
  recovery entry as you type and offers it on reopen.
- The `debugger` banner during screenshot capture is Chrome's own UI and
  cannot be suppressed; the debugger is never attached outside captures.
- Binary data (attachments, backup archives) crosses the dashboard ↔ service
  worker channel as base64 inside the JSON message envelope, because
  `chrome.runtime.sendMessage` cannot carry Blobs. The practical ceiling is
  the 50 MB per-attachment limit (enforced before any write); very large
  transfers transiently use roughly 2.5× the file size in memory while the
  envelope is built, so attaching or backing up near the limit on a
  memory-constrained machine can fail honestly with a storage/channel error
  rather than silently truncating.

## HEIC/HEIF photos (v1.0.7, T-086)

- Chrome does not render HEIC/HEIF inside notes in ANY version (only Safari
  does). Inserting an iPhone photo therefore converts it locally to JPEG
  (pinned heic-to decoder — libheif + libde265 compiled to plain asm.js
  with no dynamic evaluation, so the extension's strict CSP needs no
  change; nothing is uploaded, no WebAssembly) before storing it. The note
  shows the JPEG; the original HEIC file can still be attached verbatim
  through the attachments panel and opened in any OS viewer.
- The decoder adds ~3.2 MB to the extension (one dedicated worker file,
  loaded only when the first HEIC photo is inserted — the dashboard's main
  thread never runs the decode). If decoding a specific file fails (corrupt
  or exotic HEVC variant), the file is kept as a regular attachment and
  the note tells you so instead of inserting a broken image.
