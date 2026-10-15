# T-073 — Security Testing Report (XSS, sanitization, permissions, secrets)

Protocol source: external QA brief sections SECURITY TESTING + PERMISSION
AUDIT + SECRET SCANNING. Method: new E2E security battery against the real
built artifact (qa-audit/specs/t073-security.spec.ts, outside the tracked
tree) + scripted permission audit + scripted secret scan. Evidence:
`t073-security.json`, `t073-permission-audit.txt`, `t073-secret-scan.txt`.

## 1. XSS / stored XSS / DOM injection — PASS (7/7 checks)

New coverage beyond the repo suite's existing XSS tests (title payload,
clipboard HTML sanitization, remote-image blocking, javascript:-URL
rejection — all re-verified green in T-070's 66/66 battery):

| ID | Check | Result |
|----|-------|--------|
| S1 | Stored XSS survives reload WITHOUT executing — title `<img onerror>`, body script, iframe `data:text/html`, svg `onload` | PASS — all `window.__xss*` flags undefined after reload |
| S2 | Tag with `<script>` payload rendered inert on cards/list | PASS — 0 dangerous nodes |
| S2b | Card rendering of payload title/tag | PASS — no `img[onerror]`/iframe/svg[onload] in card DOM |
| S3 | Imported HTML file with script/iframe/javascript:-link | PASS — DOMPurify sanitizes at import; inert in list + editor |
| S4 | Imported Markdown with inline HTML/JS + javascript: link | PASS — raw-text semantics, never executes |
| S5 | Search/filter echo of XSS payload (no-results + chips) | PASS — no execution from echoed query |
| S6 | Real clipboard paste of scripted HTML (event handlers, iframe, svg, javascript: link) | PASS — sanitized through the real paste pipeline |

## 2. Input sanitization boundaries — PASS

- Editor paste pipeline: scripted HTML sanitized (S6 above).
- Import pipeline: HTML sanitized via DOMPurify at import (S3); Markdown
  treated as text (S4).
- Link dialog: `javascript:` protocol rejected (repo E2E, re-verified).
- CSP: `script-src 'self'; object-src 'self'; connect-src 'self' +
  loopback only` — no remote script/object origins possible (manifest,
  re-verified by verify-release in T-070).

## 3. Network / privacy — PASS

- Zero external requests during the entire security battery (S7) —
  the app is fully local; remote tracking images never fetch (repo E2E).
- Loopback connect-src is LM Studio-only; URL gate rejects internal
  schemes, credentials-in-URL, localhost/private/link-local/reserved
  ranges for CAPTURE (20 unit tests, URL-gate suite).

## 4. Permission audit — PASS (minimal set, all used + justified)

Required (8): `storage` (4 files), `unlimitedStorage` (quota for MHTML/
PNG archives — PERMISSIONS.md justified), `alarms` (3), `notifications`
(2), `scripting` (2), `pageCapture` (1), `debugger` (1 — CDP screenshots
on the temporary capture tab only, hard command allowlist), `contextMenus`
(2). Every permission has live source usage and a PERMISSIONS.md
justification with usage conditions. No unused permissions; no
`identity`, no `webRequest`, no broad host permissions.

Host permissions: required = loopback only (LM Studio client);
optional = `http://*/*`, `https://*/*` for capture — requested at capture
time via `chrome.permissions.request`, removable, contains/remove helpers
implemented in `src/background/permissions.ts`.

## 5. Secret scan — CLEAN (0 real findings)

- Working tree: 1 hit = `keys/local-notes-web-archive.pem` — the extension
  packaging identity key (pins the extension ID), **untracked** and covered
  by `.gitignore:13 keys/` + `*.pem`; exists only on the build machine,
  never committed (verified `git ls-files keys/` → empty).
- Release artifact (v1.0.5 zip): 0 findings across all bundled files.
- Git history (`git log --all -p -S ghp_`): 2 commits matched — both are
  the DETECTION/REDACTION patterns themselves (`scripts/audit.mjs` secret
  scanner regex; `src/core/repo/logs.ts` redaction rule that scrubs
  ghp_/bearer/sk-/token patterns from logs). Zero actual tokens ever
  committed.
- `.gitignore` covers `.env`, `keys/`, `*.pem`.

## 6. Verdict

SECURITY: PASS. No security defects found. Nothing blocks release on
security grounds. (Storage-leak review of diagnostics export content:
the diagnostics export contains counts/status/storage stats + redacted
logs — the redaction rules above scrub credentials from log lines; export
review dialog shows content before download.)
