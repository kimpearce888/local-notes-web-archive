# Backup & Restore

Backups are the only way data leaves this device — as a file you choose to
save. This document specifies the format, the validation rules, the
merge/replace semantics and the honest failure behavior.

## Creating a backup

**Settings → Backup and restore → "Export backup now"** writes a complete
ZIP archive through a normal browser download (user-initiated, never
uploaded). The archive contains:

- `manifest.json` — format identifier, backup version, app and schema
  versions, exported-at timestamp, per-file SHA-256 hashes and byte sizes,
  and record counts
- notes with their editor documents and plain-text projections, tags,
  categories, link records, reminders (recurrence rules, timezones, states)
- revision history (bounded by your retention setting)
- snapshots: MHTML archives, PNG screenshots, extracted text
- attachments and inline images (deduplicated blobs)
- settings (AI endpoint configuration included — the model selection is
  yours; no secrets exist to leak)
- the diagnostics report (versions, counts, hashes)

Each record file carries a SHA-256 content hash; the manifest carries hashes
of every file. Progress and failures are reported truthfully — a partial or
failed export never claims success.

## The format

| Field | Value |
|---|---|
| `format` | `lnwa-backup` |
| `backupVersion` | 1 |
| `schemaVersion` | the database schema version the data came from |
| `appVersion` | the extension version that produced it |

The format is documented here and versioned; a future restore refusing a
higher `backupVersion` says so explicitly rather than guessing.

## Restoring

**Settings → "Restore backup…"** first produces a **preview**: exported-at
date, app/backup versions, record counts and compatibility issues — the
database is not touched. Then you choose a mode:

- **Merge** — archive records are added alongside current data. Captures of
  the same URL become duplicate-URL situations the duplicate policy handles.
- **Replace** — current data is deleted first. This mode requires typing
  your agreement through an explicit confirmation checkbox; without it the
  restore refuses with a `denied` audit record and the database is untouched.

### Validation before any write

The restore validates, in order: the file is a ZIP (`not-a-zip`), a manifest
exists (`missing-manifest`), the format is `lnwa-backup` (`bad-format`), the
backup and schema versions are supported (`unsupported-version`), and every
file hash matches (`hash-mismatch`). Reference integrity (notes referenced
by links/attachments actually exist) is checked before import. **Any
validation failure aborts before a single write** — a failed restore leaves
the database byte-for-byte untouched, and both the audit trail and a
structured error log record the refusal with its reason.

Restores are idempotent: restoring the same archive twice in merge mode
re-imports records deterministically.

## Portability

- Backups restore into any Chrome profile on any machine running the same or
  newer extension version (schema migration runs on open).
- Cross-version: restoring a **newer** backup into an **older** extension is
  refused (`unsupported-version`) — update the extension first.
- Individual notes also export as portable `lnwa-note` JSON, Markdown or
  sanitized HTML from the editor, and snapshots export as MHTML/PNG/text —
  usable outside the extension entirely.

## Data-loss scenarios and what protects you

| Scenario | Protection |
|---|---|
| Extension uninstall | None after the fact — Chrome deletes storage. Export first; the settings and onboarding surfaces repeat this warning. |
| Profile deletion / "clear extension data" | Same as above. |
| Moving the unpacked folder | May change the extension identity and its storage origin. Export before moving, restore after. |
| Extension update | Safe: versioned migrations preserve data; a failing migration stops writes and surfaces an actionable error (never a silent wipe). |
- Restore-replace | Gated behind explicit confirmation; merge mode never deletes.
- Mid-save crash | The editor's recovery entry restores the most recent keystrokes on reopen.

## Scheduling

There is no automatic background export (a scheduled upload would violate
the local-only model). Settings offers a **backup reminder** that surfaces
in the dashboard when the newest backup in your downloads is older than N
days (0 disables) — a reminder, not a nagware substitute for your own
routine.
