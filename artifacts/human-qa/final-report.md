# final-report.md — Human-Behavior QA Program, Local Notes & Web Archive v1.0.7

Evidence-backed final report per `ai/qa-instructions.md` §17. Every claim is
traceable to the inventories, defect ledger, fix log, test-run journal or
evidence files in this directory. Program window: 2026-10-14 → 2026-10-15
(Asia/Dhaka). All testing performed through the real UI of the built
extension; no claim below rests on inspection alone.

---

## 1. Environment & build

- Product: Local Notes & Web Archive **v1.0.7** (Chrome MV3, local-first:
  notes, web archiving, reminders, optional LM Studio AI).
- Build: `npm run build` (vite) from the repository source at the tested
  commits; `dist/` loaded **unpacked** (`--disable-extensions-except` +
  `--load-extension`) — the intended development install method.
- Browser/runtime: Chromium 156.0.8078.4 via Playwright 1.64.0 persistent
  contexts on Debian 13 (trixie) under Xvfb 1440×900×24; deviceScaleFactor 2
  (2880×1800 evidence); `acceptDownloads` for export verification.
- Profiles: disposable per-session `mkdtemp` profiles (never real user
  data); sustained-use profiles for the phase programs; host permissions for
  capture testing pre-seeded via Chromium Preferences (the documented
  automation-equivalent of clicking Allow on the native prompt).
- Interaction: real pointer/keyboard events on visible UI; per-session
  video recording (`recordVideo`) and console/page-error collectors;
  per-session JSON logs under `logs/`.
- Tested commits: the QA program began at `0926e7f` (T-091 dist) and each
  defect fix was rebuilt and re-verified on its own commit (`d8a0370`,
  `33a5949`, `b0e9320`, `c239fe2`, `7ea37b0`, `fb4481a`); the final
  regression pass (T-098) ran on the final build containing all nine fixes.

## 2. Feature discovery

Full scope recorded in `action-inventory.csv` — **206 independently
testable actions across 29 feature areas**: extension entry points
(toolbar, commands, context menus), onboarding, navigation, search (9
operator rows), filters + saved views, sort/view modes, cards (indicators,
selection), bulk actions, trash lifecycle, editor core (autosave,
revisions, conflict recovery), File menu (3 export formats), 35
editor-toolbar controls (marks, blocks, lists, tables, media, tools),
media dialogs (link/image with staging), find bar (nav/replace/case),
sanitised HTML source view, attachments (paste/drop/download/open/rename),
snapshots (exports/compare/rename/delete + grant/retry/recapture
affordances), reminders (one-time/yearly/Feb-29 policies/snooze/overdue),
AI panel (honest degradation, permission modes), metadata bar, command
palette, settings (theme, toolbar groups, capture policy, backup,
granted-sites), import (JSON/MD/HTML), save-page dialog, diagnostics,
persistence. Discovery was grounded in the RUNNING UI (Phase 1 session
with a 3-note corpus + 19 baseline screenshots) cross-referenced with a
full source sweep of `src/dashboard`, `src/background`, `src/core`.

## 3. Action coverage

- **206 / 206 rows resolved** — none left NOT_TESTED.
- Status: **196 PASSED · 8 BLOCKED · 2 NOT_APPLICABLE · 0 FAILED**.
- The 8 BLOCKED rows are all environmental, each with disclosed cause and
  the strongest verifiable substitute evidence:
  - QA-008/QA-009 — browser-command dispatch (Alt+Shift+N/C) cannot be
    synthesized through this automation stack (L06); commands registered in
    the manifest, handlers unit-covered.
  - QA-012 — OS notification click (native UI outside web content; same
    class as L04); notify page + engine unit-covered.
  - QA-144 — MHTML export (L05: `Page.captureSnapshot` fails in this
    sandbox; snapshots store PNG + text honestly with the warning
    disclosed).
  - QA-147/QA-149 — re-covered through the real UI after the QA-D09 fix
    unblocked the same-link recapture path (see §8) while their original
    single-snapshot status is retained for honesty.
  - QA-161/QA-162 — LM Studio absent from the sandbox; send mechanics and
    the permission-mode setting verified, honest-degradation replies
    captured (`p2h-11-ai-chat-honest.png`).
- The 2 NOT_APPLICABLE rows (QA-058/QA-059 card-level pin/favorite
  toggles) are non-interactive badges by design (L03); toggling exists via
  bulk bar / editor header / palette.

## 4. Workflow coverage

`workflow-inventory.csv` — **22 workflows, 22 PASSED**, across all nine
protocol families: rich-note authoring end-to-end (autosave-only editor),
web-capture journey (queued → captured → artifacts → exports), note
export→import round-trip, reminder lifecycle (Due → Snooze → Complete),
restructure-with-integrity, bulk organize, trash lifecycle incl. permanent
delete, search journey (operators + query preservation across editor
round-trips), saved-view growth, revisions restore, settings journey
(live theme + draft-gated saves), backup export → honest review dialog →
merge restore, mid-edit navigation, smart-list chains, cancel flows,
universal Escape dismissal, second-capture + duplicate decision + Compare +
Delete, capture-failure → retry, two-tab conflict resolution
(Save-as-duplicate), malformed-import honesty, a multi-feature research
session, and journal continuity across a full browser restart. Sustained
sessions per protocol (no reset between workflows); every session logged
and videoed.

## 5. Interaction coverage

`interaction-coverage.csv` — **15 rows, 15 PASSED**: undo/redo across an
autosave flush, entry-point equivalence (palette vs toolbar), rapid panel
switching without state bleed, editing while a capture runs, the
duplicate-policy reuse branch and Ask restore (a real radio state change),
shared-roster propagation (editor tag → search operator + filters facet in
the same session), sequential distinct record opens, cross-surface
consistency (card preview = stored plainText head; reminder panel row =
card chip; renames propagate to search and download filenames), empty-note
honesty, rapid repeated creation (exactly N distinct notes),
order-sensitive search→sort→view, and wholesale undo after a multi-node
Replace all (single transaction). Documented honest behaviours: bulk
actions clear the selection on completion by design; theme radios apply
live and are not draft-cancellable; identical-content backup merges keep
existing same-ID notes.

## 6. Defects discovered

Nine confirmed defects (full reproduction steps, root causes, evidence and
references in `defects.md`):

| ID | Defect | Severity class | Found by |
|----|--------|----------------|----------|
| QA-D01 | Exclusion-only search returns nothing | functional | Phase 2 search rows |
| QA-D02 | Query syntax errors never surface inline (FR-SEARCH-04) | functional | Phase 2 |
| QA-D03 | Saved settings never reach the live session | functional | Phase 2 settings |
| QA-D04 | Image dialog drops alt/caption typed after file pick | data integrity | Phase 2 |
| QA-D05 | Save-a-web-page never queues the capture (dishonest queued:true) | critical / honesty | Phase 2g + IndexedDB inspection |
| QA-D06 | Capture permission flow unreachable (no UI caller) | critical | Phase 2g |
| QA-D07 | Failed captures unretryable despite the tooltip's promise | functional / honesty | Phase 3 inventory construction |
| QA-D08 | Find/Replace flattens rich documents and silently deletes images (autosaved data loss) | critical / data loss | Phase 3 WF-05 workflow + forensics |
| QA-D09 | Same-link recapture unreachable → Compare snapshots permanently unreachable | functional (FR-CAP-08) | Phase 3 WF-17 + audit-trail forensics |

Also recorded: six investigated limitations that are NOT defects (L01
multi-word exclusion tokenisation, L02 unknown colon-keys, L03 card-level
pin/favorite badges, L04 native prompts, L05 MHTML in sandbox, L06 command
dispatch) plus environment disclosures (LM Studio absent, OS notifications).

## 7. Repairs performed

All nine defects fixed with targeted, minimal changes; every fix shipped
with regression tests and was re-verified through the real UI on a rebuilt
dist (per-defect records in `defects.md` + `fix-log.md`):

- `d8a0370` — D01+D02: search engine candidate-set initialization for
  exclusion-only queries; honest 'no searchable terms' error; inline
  role=status notice in the dashboard.
- `33a5949` — D03+D04: `controller.refreshSettings()` wired into settings
  save; image dialog stages the file with a Ready-to-insert affordance.
- `b0e9320` — D05+D06: `attachSourceLink` creates 'queued' links +
  notifies the queue; Grant access… affordance performing
  `chrome.permissions.request` in the page's user-gesture context (the
  gesture does not survive the RPC hop — the incorrect comment corrected).
- `c239fe2` — D07: Retry capture rows for failed links routing to the
  previously UI-less `capture/retry` RPC.
- `7ea37b0` — D08: `find-replace.replaceInDocument()` — per-text-node
  replacement preserving structure/marks/images, one reverse-order
  transaction; the destructive `setContent(escaped-plain-text)` path
  removed; docstrings corrected.
- `fb4481a` — D09: 'Capture fresh copy…' affordance for captured links
  (fresh revision via previousSnapshotId chaining), making Compare
  reachable.

Unit suite grew 905 → 907 → 911 → 913 as regression tests were added
(2+2+4+2); tsc (both configs) and eslint clean at every fix commit.

## 8. Regression verification

T-098 complete regression on the final build over a fresh pre-seeded
profile — **12/12 checks PASSED** (sessions `phase8-*`, evidence under
`screenshots/final/reg-*` + `videos/final/`): every defect area re-exercised
through the real UI (D01 exclusion narrows; D03 settings reach a NEW editor
session live; D04 staging honored; D05 capture queues AND completes; D06
Grant affordance renders for an ungranted host; D07 failed→Retry→captured
end-to-end; D08 replace-all preserves heading+image structure through
autosave+reopen; D09 recapture chains a second same-link snapshot and the
Compare dialog renders), plus core flows (onboarding, CRUD, yearly
reminder, backup) and browser-restart persistence. The previously deferred
action rows QA-147/QA-149 were re-covered through the real UI via the D09
path (verify-d09 sessions). Unit gates 913/913 on the final source.

## 9. Visual evidence

- **Baseline** (original states + defects as first captured):
  `screenshots/baseline/` — 115 PNGs (phase0/1/2 series p2*, phase3 p3*,
  edges p6*, visual sweep p7*, defect captures d08-flattened-document).
- **Final** (fresh captures after all repairs, obtained by REPEATING the
  real interactions on the final build): `screenshots/final/` — 15 PNGs
  (d06/d07/d08/d09 fix verifications, reg-* regression states,
  compare-dialog, restart persistence).
- **Recordings**: `videos/baseline/` (137 webm) and `videos/final/`
  (76 webm) — per-session page recordings; filenames keyed by session in
  `logs/`.
- Every session's JSON log (67) records environment facts, console and
  page-error counts, native dialogs and artifact lists; `test-runs.md` is
  the chronological journal linking sessions to evidence.

## 10. Automated verification

- `npm run test`: **913 / 913 passed** (75 files) on the final source —
  including the 8 QA-program regression tests.
- `npm run check` (tsc, both configs): clean.
- `npm run lint` (eslint): clean.
- `npm run build` (vite): successful; the dist was operationally verified
  in every real-UI session (service worker start, dashboard load, zero
  unexpected console/page errors — recorded per session in `logs/`).

## 11. Unresolved issues

No open product defects. Remaining limitations, each established through
evidence and precisely documented (defects.md, action inventory rows):

1. L04-class: Chrome's native permission prompt and OS notification clicks
   are outside automation reach (browser chrome, not web content).
2. L05: MHTML `Page.captureSnapshot` fails in this sandbox — snapshots
   store PNG + text with honest warnings; the export path for the complete
   copy is exercised only in unit tests.
3. L06: browser-command dispatch (Alt+Shift+N/C) not synthesizable here.
4. LM Studio absent: model replies, streaming and tool-approve/deny dialogs
   unverified; honest-degradation surfaces verified instead.
5. L01/L02/L03: tokenisation and badge-design limitations documented as
   honest behaviours, not defects.
6. Timing-sensitivity observation (T-098): typing into the
   onboarding-created editor within ~2 s can race the async editor-session
   mount (the note saves empty). Human-paced interaction and explicit
   mount waits are unaffected; not classifiable as a defect from this
   evidence — flagged for awareness and follow-up.

## 12. Completion assessment

Against the protocol's own definition of done:

- Every discovered action exercised through the real UI: **206/206
  resolved** (196 PASSED; 8 BLOCKED with documented environmental causes
  and substitute evidence; 2 N/A by design).
- Every complete workflow exercised end-to-end with intermediate
  transitions, persistence and side effects: **22/22 PASSED** across all
  nine families.
- Interactions, combinations, persistence and integrity:
  **15/15 PASSED** + the Phase 5 verifications carried by earlier phases.
- Errors, edge cases and visual states: **EC-01..06 + P7-SWEEP PASSED**;
  validation/failure/empty states evidenced across phases.
- Defects: 9 discovered, 9 fixed with root-cause repairs, regression tests
  and real-UI re-verification; the FORBIDDEN list (hiding failures,
  weakening validation, test-fitting) was never used.
- Regression: complete pass on the final build — 12/12 + 913/913 units.
- Evidence: 130 screenshots, 213 session videos, 67 logged sessions, all
  linked by the journal; baseline kept separate from final.

**Honest determination: the program is complete.** The uncovered surface is
exactly the documented environmental set (native prompts, MHTML in-sandbox,
command dispatch, LM Studio) — each established through evidence, disclosed
precisely, and surrounded by continued testing of everything that remained
accessible, per §18.
