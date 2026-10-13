# Security

Threat model, hardening measures and reporting route for **Local Notes &
Web Archive for Chrome**. Companion documents: [PRIVACY.md](./PRIVACY.md)
(data handling), [PERMISSIONS.md](./PERMISSIONS.md) (permission rationale),
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) (honest limits).

## Threat model

| Adversary / vector | Treatment |
|---|---|
| Malicious archived web pages | MHTML never rendered in-app; preview is PNG + extracted text only. All imported/pasted HTML passes DOMPurify before the editor or dashboard uses it. Links open externally with `noopener,noreferrer`. |
| Prompt injection through page/note text | Web content and notes are untrusted input to the AI: they are contained, never concatenated into policy, and can never trigger destructive tools, permission changes or extra captures. The model proposes; the app validates, authorizes and executes. Fail-closed on malformed or unknown tool calls. |
| Overreaching AI actions | Strict tool schemas, input bounds, ID validation, relationship checks, pagination caps, timeouts and cancellation. Permission modes: read-only / ask-before-every-write (default) / safe-writes — permanent deletion always requires confirmation. Every call audited. |
| Malicious backup files | Full pre-write validation (ZIP structure, manifest, versions, per-file SHA-256, reference integrity). Any failure aborts before a write; replace mode needs explicit confirmation. |
| Cross-site request context | URL gate rejects credentials-in-URL, loopback/private/link-local/reserved targets and browser-internal schemes for capture; redirects re-validated against the granted origin. |
| Data exfiltration channels | CSP `connect-src` limited to self + loopback; no remote code, no `eval`/`new Function`, no CDN. Release gate scans built output; runtime self-test re-asserts the declarative surface. |
| Secrets in logs | Redaction at write time (tokens, bearer headers, credential-shaped key/values) plus URL query scrubbing; note bodies, prompts, archive HTML and attachment content are never logged. |
| Debugger abuse | `chrome.debugger` attaches only to the temporary capture tab, commands limited to `Page.getLayoutMetrics` and `Page.captureScreenshot`, detached in `finally`; AI tools cannot reach CDP. |

## Hardening inventory

- **Manifest V3**, `minimum_chrome_version` 120, stable extension ID via
  shipped public key.
- **CSP:** `script-src 'self'; object-src 'self'; connect-src 'self'
  http://127.0.0.1:* http://localhost:*`.
- **Sanitization:** DOMPurify gates every HTML path (imports, pastes,
  editor source view); approved link protocols only (`http`, `https`,
  `mailto`); file exports use safe filenames.
- **Storage integrity:** content hashes on snapshots/attachments, revision
  chaining, transactional writes with conflict detection, versioned
  migrations that stop writes on failure.
- **Observability with redaction:** structured logs + audit trail with
  changed-field names and hashes (never bodies), bounded rotation, reviewed
  diagnostics export.
- **Supply chain:** all dependencies pinned to exact versions
  ([DEPENDENCIES.json](./DEPENDENCIES.json)); the runtime bundle is scanned
  at release for remote URLs and dynamic code; Docker exists only for
  dev/test, never at runtime.

## Dependency update policy

- Versions are **pinned exactly** in `package.json` and `package-lock.json`;
  there is no floating range, no auto-update at build time.
- Updates are deliberate: bump the pin, review the diff and license
  (`npm run deps` regenerates the inventory), run the full gate
  (lint, strict typecheck, unit tests, E2E smoke, release scan), then
  commit the regenerated `DEPENDENCIES.json` /
  `THIRD_PARTY_NOTICES.md` in the same change.
- New runtime dependencies require a documented justification in the PR
  description and must be open-source with licenses compatible with
  bundling.

## Reporting a vulnerability

Open a **private security advisory** on the GitHub repository (Security →
Report a vulnerability), or contact the maintainer listed in the repository
profile. Please include reproduction steps and affected version (visible in
Diagnostics). Reports are triaged in the order received; fixed releases
bump the version and update the release checksums. Please avoid opening
public issues for unpatched vulnerabilities.

## What this extension intentionally is not

- It is not a password manager, a sync service, or a cloud product.
- It does not attempt to defend against a compromised browser or OS — no
  extension can.
- It does not run code from archived pages; previews are inert images and
  text.
