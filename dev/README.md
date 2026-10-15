# dev/ — everything development-internal, nothing shipped

This folder holds **all** the repository's development material in one
place. The extension artifact is built exclusively from the root's
`src/`, `public/`, `dashboard.html` and the build pipeline in
`scripts/` — nothing inside `dev/` is ever bundled into `dist/` or the
release zip.

| Folder / file | What it is |
|---|---|
| `tests/` | The full quality gates: `unit/` (Vitest), `perf/` (the PRD §11 search benchmark) and `e2e/` (Playwright over the built extension, including the extract-zip-and-load acceptance suite). Their tool configs sit beside them at `dev/` root: `vitest.config.ts`, `vitest.perf.config.ts`, `playwright.config.ts`, `eslint.config.js`. |
| `ai/` | Task governance records — `rule.md` (the project operating system), `plan.md`, `progress.md`, `completed.md`. Internal working material, kept for full auditability of every change. |
| `task-deliverables/` | The archive of every task-program output: release verification records (`v104`…`v1012-verified.txt`), QA evidence trees, program reports. See its own `README.md`. |
| `artifacts/` | Human-QA evidence from the behavioral audit: 420 files (videos, screenshots, logs) plus the inventory CSVs and reports. |
| `scripts/` | `audit.mjs` (regenerates `docs/REPOSITORY_AUDIT.md`) and historical one-off tools. |
| `PRD.md` | The product requirements document (source of truth for the build). |
| `REDESIGN_QA_REPORT.md` | The T-056 UI redesign QA report (historical). |
| `Dockerfile.test`, `docker-compose.yml`, `.env.example` | Dev/test-only harness (reproduces the lint/typecheck/unit-test environment). Docker is never used at runtime. |

## Running the gates from the repository root

Nothing about the workflow changes — the npm scripts carry the
configuration paths for you:

```bash
npm run verify          # eslint + tsc (both configs) + 970 unit tests
npm run test:perf       # 10k-note search p95 benchmark
npm run test:e2e        # 86 Playwright tests over the built extension
npm run audit:repo      # regenerate docs/REPOSITORY_AUDIT.md
```
