# Task deliverables — every file produced by the task program, in one folder

This folder is the single, separate archive the maintainer asked for on
2026-10-14: *“all files in task should be kept in a separate folder in
github.”* Everything the autonomous task program (`ai/plan.md` tasks
T-062…T-082) produced as output — instruction briefs, QA evidence,
reports and release-verification records — lives here, and nothing from
this folder is mixed into the product source tree (`src/`, `tests/`,
`public/`) or the toolchain.

## Contents

| Sub-folder | Files | What it is |
| --- | --- | --- |
| `task-briefs/` | 2 | The two maintainer instruction documents that drove the task programs: `drive-instructions.txt` (2026-10-13, superseded) and `gdocs-instructions.txt` (2026-10-14 — the full QA & release validation protocol executed as T-070…T-082). |
| `release-verification/` | 3 | Independent REST-API verification records for the GitHub Releases: `v104-verified.txt`, `v105-verified.txt`, `v106-verified.txt` (tag == HEAD, sha256 digest match, byte-identical download-back). |
| `local-notes-human-qa-20261014/` | 102 | The T-062 universal human-behavior QA audit: executive summary, application map, control inventory (CSV), scenario catalog, state/cross-feature matrices, defects ledger (7 confirmed defects D-01…D-07) and the full `evidence/` tree — screenshots for every pass A–F plus targeted probes. |
| `qa-validation-v106/` | 54 | The T-070…T-082 zero-trust QA & release validation program that shipped v1.0.6: the 8 program reports (control inventory, coverage matrix, feature-gap report, final QA report — remaining issues: NONE — security/performance/integrity/a11y reports) and `qa-evidence/` (46 files: 13 reports, 10 logs, 22 screenshots, 1 full video walkthrough) covering the two defects found and fixed (D-08 requery sequencing, D-09 WCAG AA contrast) and the two consecutive clean verification passes. |

**Total: 161 archived files** (plus this README). The two zip bundles that
were delivered alongside these files (`local-notes-human-qa-20261014.zip`,
`qa-evidence-full.zip`) are intentionally **not** committed: their contents
are committed here instead, byte-identical (digest-verified during staging),
so nothing is duplicated and every file is browsable. The repo’s
`.gitignore` keeps ignoring `*.zip` unchanged.

## Provenance and integrity

- 160 of the 161 archived files are byte-identical copies of the delivered
  artifacts; the staging step verified `sha256` of each copy against its
  source. **One file was sanitized:** `qa-validation-v106/qa-evidence/logs/
  t073-secret-scan.txt` contained the literal bare PEM format header
  `-----BEG…` — the T-073 scan’s own record of *matching* the gitignored
  packaging key (never committed). The header string carried no key
  material, but the repository’s secret-scan standard flags any PEM
  header, so the archived copy replaces it with an explanatory marker
  (`[PEM format header redacted 2026-10-14 T-083: …]`). The file’s
  evidentiary meaning is unchanged; the unmodified original remains in the
  delivered bundle outside the repo.
- A pre-push secret scan (the same patterns `scripts/audit.mjs` uses:
  GitHub PATs, AWS key ids, Google/Slack/npm tokens, OpenAI-style keys,
  PEM headers) ran over all files: after the single sanitization above the
  result is **0 findings**.
- Toolchain isolation: `tsc`, `vitest` and Playwright are path-scoped and
  never touch this folder; `eslint.config.js` lists `task-deliverables/**`
  in its ignores so the evidence `.ts` spec copies cannot affect lint
  gates.
- Product code, build output and the release artifact are **not** affected
  by anything in this folder; the installable extension remains
  `local-notes-web-archive-<version>.zip` on the
  [releases page](https://github.com/kimpearce888/local-notes-web-archive/releases).
