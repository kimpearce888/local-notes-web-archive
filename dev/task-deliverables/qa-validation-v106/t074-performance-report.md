# T-074 — Performance & Memory Report

Protocol source: external QA brief sections PERFORMANCE TESTING + MEMORY
LEAK TESTING. Method: qa-audit/specs/t074-perf.spec.ts against the built
artifact, real user paths only, CDP Performance.getMetrics for memory.
Raw JSON: `t074-perf.json`.

## 1. Performance measurements — PASS (10/11 checks)

| Metric | Measured | Threshold | Verdict |
|--------|----------|-----------|---------|
| P1 Dashboard initial load (median of 5 reloads) | **207 ms** | < 2000 ms | PASS |
| P2 Editor open (worst of 5) | 138 ms | < 500 ms | PASS |
| P2 Editor close (worst of 5) | 60 ms | < 500 ms | PASS |
| P2 Command palette open (worst of 5) | 182 ms | < 500 ms | PASS |
| P2 Filters panel (worst of 5) | 344 ms | < 500 ms | PASS |
| P2 Settings dialog (worst of 5) | 339 ms | < 500 ms | PASS |
| P3 List render, 121 notes after reload | 629 ms | < 2000 ms | PASS |
| P3 Pagination next-page transition | 707 ms | < 2000 ms | PASS |
| P3 Search hit (Enter → card rendered), 121 notes | **47 ms** | < 500 ms | PASS |
| P3 Search miss (Enter → empty state rendered) | **56 ms** | < 500 ms | PASS (re-measured post-fix) |
| (reference) Search engine p95 at 10k corpus, 200 samples | 126 ms | < 500 ms | PASS (T-070) |

Dataset: 121 notes created through the real UI (1 titled + body via editor,
120 via rapid New Note clicks in 12 batches of 10 parallel clicks,
~10 s total; PAGE_SIZE=50 caps page 1 at exactly 50 cards — the pagination
invariant holds).

## 2. Memory-leak loops — PASS (4/4 checks)

CDP `Performance.getMetrics` before/after 75 loop iterations
(navigation ×15, settings modal open/close ×15, search ×30, palette ×15):

| Metric | Before | After | Growth | Threshold | Verdict |
|--------|--------|-------|--------|-----------|---------|
| JSHeapUsedSize | 9.8 MB | 12.0 MB | **+22.2%** | < 25% | PASS |
| DOM Nodes | 3,127 | 3,496 | +11.8% | bounded | PASS |
| JSEventListeners | 263 | 200 | **−63 (net cleanup)** | < +50 | PASS |
| Documents | 3 | 3 | 0 | stable | PASS |

The negative listener growth demonstrates correct listener disposal on
panel teardown. Heap growth is bounded (index + card cache warming), no
monotonic leak signature across afterNav → afterModal → afterSearch →
afterPalette (heap goes 9.8 → 15.8 → 13.6 → 10.5 → 12.0 MB — GC recovers).

## 3. Defect D-08 discovered during P3 (search miss) — CONFIRMED and FIXED (T-077)

**Title:** stale in-flight requery results can overwrite newer search
results (missing request-sequencing guard).

**Reproduction (E2E, deterministic environment):** with 121 notes,
1. trigger a requery that stays in flight (creation storm's queued
   requeries, or a pagination transition), then
2. submit a search whose results render (47 ms),
3. submit a second search with no matches — the empty state renders,
   then ~1–3 s later a STALE earlier-issued requery resolves and
   overwrites the view with the full unfiltered list (50 "Untitled"
   cards, "121 notes") while the search input still holds the query.
   Input/state desync until the next user action self-heals it.

**Root cause (code inspection, controller.ts:350–388):** `requery()`
captures state, awaits `search/query`, then `resolveNotes()` — which
issues up to PAGE_SIZE sequential `notes/get` RPCs (the wide race
window) — then writes `total/notes/status` into the store with NO check
that this requery is still the latest one. The only guard is `disposed`
(teardown). Two overlapping requeries therefore resolve in RPC-arrival
order, not issuance order, and the stale one wins.
`hydrateRelated()` (related-bulk write) has the same exposure.

**Impact:** transient wrong-results display after rapid interactions
(rapid creation + immediate search; pagination + immediate search);
self-heals on the next interaction; no data loss (storage is correct —
display-only corruption). Severity: moderate.

**Status:** FIXED in T-077 (epoch/sequence guard checked after every
await in requery + hydrateRelated; deterministic transport-delayed unit
repro failed pre-fix, passes post-fix; E2E regression: creation storm +
immediate search keeps its results and a true no-match search stays
empty — 9/9 in the audit-defect suite).

**Post-fix re-measurement:** search miss 56 ms (Enter → empty state
rendered), 121-note corpus — the D-08 measurement artifact is gone.

**Test-methodology note (recorded honestly):** the original miss-term
'zzz-no-such-term-anywhere' actually MATCHES a note — MiniSearch's
default tokenizer splits hyphens ('no' becomes a term) and prefix search
matches 'no' against 'Note'. The E2E regression and the perf miss
measurement now use 'qqqzzz' (API-verified 0 hits). The stale-requery
race itself was independently real (unit repro + the pre-fix full-list
stomp observed in the T-074 run).

## 4. Verdict

Performance: PASS on every measured metric (search hit 47 ms at 121
notes; engine p95 126 ms at 10k). Memory: PASS (bounded heap, net
listener cleanup, stable documents). One defect (D-08, display-race)
found and queued for the mandated fix → retest → regression cycle.
