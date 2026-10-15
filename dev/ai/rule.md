# rule.md — Project Operating System

**Project:** Local Notes & Web Archive for Chrome
**Source of truth:** `PRD.md` (v1.0, approved architecture baseline, reviewed 2026-10-12)
**Protocol:** Autonomous single-cycle production build (see `/dev/ai/plan.md`, `/dev/ai/progress.md`, `/dev/ai/completed.md`; the governance files live under dev/ since the T-109 housekeeping)

---

## 1. Project mission

Deliver a production-ready, local-first Chrome Manifest V3 extension that manages
rich-text notes, tags, categories, links, archived web pages (MHTML + PNG + extracted
text), reminders and optional local LM Studio AI actions — entirely offline, with zero
cloud services, accounts, telemetry or remote code. The released artifact is one
self-contained, prebuilt unpacked-extension folder (`dist/`) whose installation
requires nothing except Chrome itself.

## 2. Production-ready definition

A task is production-ready only when **all** of the following hold:

- Code compiles under `tsc --noEmit` (strict mode, no `any` in tool-execution paths).
- Lint passes (`eslint .`).
- Tests for the touched area pass (`vitest run`); new logic ships with new tests.
- The feature is complete against the PRD feature matrix — no TODO comments, no
  placeholder code, no mock implementations (seed data for tests is the sole exception),
  no stub APIs, no incomplete screens.
- The behavior is observable/truthful: failures surface actionable states, never fake
  success.
- The change is committed (`type(scope): description`) and pushed to `origin/main`.

## 3. Development standards

- **Language:** TypeScript (strict) compiled by Vite to plain bundled JavaScript.
- **UI:** Vanilla TypeScript/DOM + standard CSS. No React or runtime UI framework.
- **Build:** Vite (dev/build only). Nothing built-time leaks into runtime
  requirements; after build, `dist/` needs no Node.js, no server, no CDN asset.
- **Modularity:** `src/core` (types, db, search), `src/background` (service worker,
  capture, AI, reminders, backup), `src/dashboard` (UI modules). Typed database
  models and versioned migrations only.
- **Completeness:** every feature in PRD §4.4, §5 (FR-NOTE/SEARCH/CAP/REM/AI/MCP/DATA/
  LOG/SET) and docs in §14 ship in this release. No phases, no MVP scope, no
  "future work".
- **Resolving ambiguity:** adopt industry best practice and record the decision in the
  task's plan entry. The PRD wins over generic templates when they conflict
  (e.g., Docker exists for dev/test only — never at runtime — because PRD §1
  constraint 1 and §7 dependency rules forbid runtime companions).

## 4. Security standards

- Narrowest effective permission set (PRD §8.2). `debugger` only for the temporary
  capture tab with a hard CDP command allowlist; AI tools can never drive CDP.
- All user/imported/captured HTML sanitized with DOMPurify before editor/dashboard
  use; approved link protocols only (`http`, `https`, `mailto`).
- MHTML archives are never rendered inside the dashboard; preview = saved PNG +
  extracted text only. Export to filesystem is user-initiated.
- URL gate: HTTP/HTTPS only; reject internal schemes, credentials-in-URL, localhost,
  link-local, private/reserved ranges for capture. Loopback allowed **only** for the
  LM Studio client.
- AI is an untrusted planner: strict tool schemas, bounded inputs, permission modes,
  fail-closed errors, full audit trail, prompt-injection containment (PRD §9).
- No remote code, no `eval`/`new Function`, no CDN; CSP narrowed to what the local AI
  needs.
- No secrets, personal data or developer paths in source or bundles.

## 5. Testing standards

- `vitest` unit tests for: data model invariants, migrations, repositories, search
  query syntax/filters/ranking, reminder recurrence (Feb-29 options, DST, final year),
  URL validation, AI tool validation/bounds, backup/restore round-trips, redaction.
- Playwright smoke tests: load unpacked extension, open dashboard, create/edit/search
  a note, offline behavior.
- Quality gate per task: compile + lint + tests green before the task moves to
  `completed.md`.
- Crash/interruption and failed-restore invariants are explicitly tested.

## 6. Documentation standards

Repository/release must contain (PRD §14): `README.md`, `LICENSE` (MIT),
`THIRD_PARTY_NOTICES.md`, `DEPENDENCIES.json`, `PRIVACY.md`, `PERMISSIONS.md`,
`KNOWN_LIMITATIONS.md`, `BACKUP_RESTORE.md`, `SECURITY.md`. Documentation states
limits honestly (MCP disclosure, Chrome-closed reminders, best-effort capture).

## 7. Git workflow

- One task → one commit → one push. No batching.
- Commit format: `type(scope): description` — e.g. `feat(db): implement notes
  repository`, `fix(search): correct phrase parsing`, `test(reminders): add DST tests`.
- Every commit updates `dev/ai/progress.md` and `dev/ai/completed.md` in the same commit.
- Push immediately after commit to `origin/main`.

## 8. Task management workflow

1. Pick the next task from `dev/ai/progress.md` (top of queue).
2. Execute it fully.
3. Validate (§2 gate: compile, lint, tests, PRD compliance).
4. Remove from `dev/ai/progress.md`; append record to `dev/ai/completed.md`
   (task name, completion timestamp, validation result, commit hash, push status).
5. Commit + push.
6. Continue automatically with the next task. Never stop while tasks remain.

## 9. Completion criteria

The project is complete only when:

- All PRD requirements implemented; all screens implemented; all internal APIs
  implemented.
- Note CRUD, tags/categories, revisions, trash/restore, search, capture (MHTML/PNG/
  text), reminders, AI tools, backup/restore, diagnostics, settings, onboarding all
  functional.
- Tests pass; build succeeds (`npm run build` produces loadable `dist/`).
- Deployment configuration exists (build scripts, dev/test Docker, release zip) and
  documentation exists (§14 list).
- `dev/ai/progress.md` contains zero tasks and all `dev/ai/plan.md` tasks exist in
  `dev/ai/completed.md`.

**If `dev/ai/progress.md` is not empty: continue working. Do not return next steps, future
work or phase-based recommendations.**

## 10. Standing operational rules

- Build everything in one go; no deferred implementation; no future phases; no TODO
  items; no placeholder code; no mock data except required seed/test data.
- Every feature completed before moving on; every completed task validated; every
  validated task committed; every commit pushed.
- On resume (new session): read `/home/z/my-project/INSTRUCTIONS.txt`, then this file,
  then `dev/ai/plan.md` + `dev/ai/progress.md`, check `git status`, and continue the queue.
