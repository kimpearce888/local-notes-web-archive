# T-076 — Accessibility, Control-State & Human-Like Patterns Report

Protocol source: external QA brief sections ACCESSIBILITY TESTING +
STATE TESTING + HUMAN-LIKE TESTING. Method: qa-audit/specs/t076-a11y.spec.ts
against the built artifact through real user paths. Raw JSON: `t076-a11y.json`.

## Results — 12/13 PASS, 1 FAIL (defect D-09 found — queued as fix T-078)

| ID | Check | Result |
|----|-------|--------|
| A3 | Onboarding dialog: focus inside on open | PASS |
| A3 | Escape closes onboarding | PASS |
| A1 | Onboarding completable keyboard-only (Tab+Enter) | PASS |
| A1 | Tab order: 13 documented stops — skip-link → New Note → smart lists → … → search input | PASS |
| A1 | Note creation via keyboard-only (blur → Tab×8 → Enter): focus landed on New Note, Enter created the card | PASS |
| A2 | Visible focus (:focus-visible) on keyboard-focused controls — solid outlines + focus ring on every probed control | PASS |
| A3 | Settings dialog focus containment + Escape close | PASS |
| A4 | WCAG AA contrast spot-checks (6 computed probes) | **FAIL — D-09** |
| A5 | Narrow viewport 375px: 0px horizontal overflow, New Note reachable | PASS |
| A6 | Unicode + emoji + quotes + tags title durable across reload; ~50KB body saved | PASS |
| A7 | Double-click New Note: bounded (2 notes), page-1 invariant holds | PASS |
| A8 | Navigation interruption: typed content preserved via autosave flush | PASS |

## Harness limitations (recorded honestly, never counted as passes)

- `chrome.commands` bindings (Alt+Shift+C new-note shortcut) are
  browser-level and cannot be synthesized by Playwright's page keyboard
  events — keyboard-only creation proven through the in-page Tab+Enter
  path instead; the shortcut's own registration is surfaced honestly in
  Settings ("suggested … could not be assigned — set it in
  chrome://extensions/shortcuts").
- Programmatic `.focus()` does not trigger Chrome's `:focus-visible` —
  the focus-style probe drives REAL Tab presses.

## Defect D-09 — card meta text fails WCAG AA contrast (both themes)

**Finding:** `.card__meta` (the "Created … · Modified …" timestamps on
every note card) uses `var(--color-text-faint)` at `0.75rem` (12px —
small text, no large-text exception):

- Light theme: `#8a8d9b` on white cards = **3.3:1** (AA requires 4.5:1)
- Dark theme: `#74768a` on dark surfaces = **3.46–4.01:1** (also below)

Every other probed pair passes AA comfortably (card title 17.7:1,
sidebar heading 15.7:1, results heading 16.4:1, primary button 4.8:1).

**Fix (queued as T-078):** darken the light token to `#6b6e7d`
(5.06:1 on white, 4.76:1 on #f7f8fa) and lighten the dark token to
`#8f92a3` (≥5.0:1 on the darkest card surface) — both keep the visual
"faint" hierarchy while clearing AA on every surface the token touches
(3 usage sites: card meta, status bar, diagnostics hint text). A CSS
token contrast unit test locks the ratios in.

## Control-state sweep cross-coverage (re-verified green this session)

Default/empty (fresh profile empty state), loading→ready transitions,
success (Saved state, announcements), error (dead-endpoint honest
failure — T-075 N1), disabled (in-flight button disabling — 34 sites
audited in T-071), hover/focus (A2 outlines + CSS token tests), dialog
states (A3), destructive confirmations (T-075 I1c/e).
