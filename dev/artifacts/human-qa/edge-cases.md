# edge-cases.md — Phase 6+7 (T-097) error/edge/visual record

Driven through the real UI on the sustained phase3 profile (sessions
`phase6-edges`, `phase6-fixup`, `probe-ec01`; logs + videos attached).
Validation-error, failure and empty states captured across Phases 2-4 are
referenced, not repeated.

| ID | Case | Result |
|----|------|--------|
| EC-01 | Unicode/emoji/RTL content round-trip (CJK title+body, 🎉🧪🚀, مرحبا بالعالم, café naïve résumé) + CJK search | PASSED — full round-trip through editor/storage/search; search 你好世界 finds the note |
| EC-02 | Very long content (~5,500 chars, 5 paragraphs) | PASSED — autosave+reopen intact, editor responsive |
| EC-03 | Whitespace-only inputs (title / search / tag) | PASSED — title falls back to Untitled; search returns full list; tag rejected; no crash |
| EC-04 | Degenerate search queries ('tag:', '""', '-', 'tag:   ') | PASSED — honest fallback (full corpus or empty), no crash; engine's 'no searchable terms' path unit-covered by the QA-D01 fix |
| EC-05 | Duplicate dialog submission (double-click Add reminder) | PASSED — idempotent: at most one reminder created |
| EC-06 | Very long title (184 chars) | PASSED — card contains it without layout breakage; editor + search handle the full string |
| P7-SWEEP | Visual states, both themes: populated library, editor+find bar, empty search, settings, editor+reminders panel (light + dark) | PASSED — 6 fresh states captured (p7-*) joining the validation-error/failure/empty states from Phases 2-4 (Apr-31 error p2h-07, unreachable host p2g/p3c, malformed import p3c-20, conflict p3c-19, honest AI failure p2h-11, empty trash p3-07, empty search p2b-04) |

Environment limitations applying here (see defects.md): the Chrome native
permission prompt and OS notification clicks remain unreachable to
automation (L04-class); the final-evidence pass (T-099) re-captures the
verified states on the final build.
