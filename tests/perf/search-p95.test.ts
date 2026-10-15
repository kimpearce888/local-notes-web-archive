import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/core/db/open';
import { RepoContext } from '../../src/core/repo/context';
import { SearchEngine } from '../../src/core/search/engine';
import { Store } from '../../src/core/db/schema';
import { newId } from '../../src/core/util/ids';
import type { Note, Snapshot, UtcTimestamp } from '../../src/core/types';

/**
 * T-043 performance spot-check (plan.md, PRD §11): search over 10,000 notes
 * plus 2,000 indexed snapshots returns initial results within 500 ms at the
 * 95th percentile after the index is loaded.
 *
 * This benchmark seeds the real IndexedDB-backed stores through the real
 * repository context, rebuilds the real SearchEngine index once, then times
 * the real `SearchEngine.execute()` path (parse → filter → MiniSearch →
 * decorate → sort → paginate) across a realistic query mix. It runs in its
 * own vitest project (`npm run test:perf`) so the default unit suite stays
 * fast; the numbers land in docs/RELEASE_VERIFICATION.md.
 *
 * Environment honesty: latencies are measured under Node + fake-indexeddb
 * (structuredClone-backed). The engine code path, document count and corpus
 * shape are the production ones; absolute numbers on a reference desktop
 * Chrome profile will differ, which the verification report documents.
 */

const NOTE_COUNT = 10_000;
const SNAPSHOT_COUNT = 2_000;
const ITERATIONS = 25; // per query shape → 8 shapes = 200 samples

/** Deterministic LCG so every run measures the same corpus. */
let seed = 0x5eed1234;
function rand(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

const COMMON = ['note', 'chrome', 'meeting', 'archive', 'local', 'page', 'data', 'search'];
const TOPICAL = [
  'quantum', 'ledger', 'roadmap', 'harvest', 'cathedral', 'orchard', 'turbine', 'viaduct',
  'lighthouse', 'archive', 'policy', 'saffron', 'meridian', 'blueprint', 'compass', 'harbor',
];
const FILLER = [
  'record', 'detail', 'summary', 'draft', 'outline', 'review', 'appendix', 'section',
  'chapter', 'entry', 'memo', 'brief', 'report', 'sketch', 'log', 'plan',
];

function words(count: number, pool: readonly string[]): string {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(pick(pool));
  return out.join(' ');
}

function isoTime(offsetMinutes: number): UtcTimestamp {
  return new Date(Date.UTC(2026, 0, 1) + offsetMinutes * 60_000).toISOString() as UtcTimestamp;
}

function makeNote(i: number): Note {
  const state = i % 50 === 0 ? 'archived' : i % 200 === 0 ? 'trashed' : 'active';
  const created = isoTime(i);
  return {
    id: newId(),
    title: `${pick(COMMON)} ${pick(TOPICAL)} ${i}`,
    subtitle: rand() < 0.3 ? words(4, FILLER) : '',
    editorDoc: null,
    plainText: `${words(90, [...TOPICAL, ...FILLER])} ${pick(COMMON)} ${words(30, FILLER)}`,
    createdAt: created,
    updatedAt: isoTime(i + Math.floor(rand() * 5000)),
    state,
    pinned: i % 20 === 0,
    favorite: i % 37 === 0,
    trashedAt: state === 'trashed' ? created : null,
    archivedAt: state === 'archived' ? created : null,
    revisionId: null,
    duplicatedFrom: null,
    cardBackgroundColor: null,
    cardForegroundColor: null,
  };
}

function makeSnapshot(i: number, note: Note): Snapshot {
  return {
    id: newId(),
    noteId: note.id,
    linkId: null,
    sourceUrl: `https://example.com/page-${i}`,
    finalUrl: `https://example.com/page-${i}`,
    canonicalUrl: null,
    title: `Archived page ${i} ${pick(TOPICAL)}`,
    capturedAt: isoTime(i),
    status: 'complete',
    mhtml: 'saved',
    png: 'saved',
    text: 'saved',
    mhtmlBlobKey: null,
    pngBlobKey: null,
    extractedText: `${words(120, [...TOPICAL, ...FILLER])} policy archive`,
    mhtmlHash: null,
    pngHash: null,
    format: 'mhtml',
    mhtmlSize: 4096,
    pngSize: 2048,
    textSize: 1024,
    warnings: [],
    previousSnapshotId: null,
  };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

describe('search performance (PRD §11: p95 < 500 ms over 10k notes + 2k snapshots)', () => {
  it(
    'returns initial results within the 500 ms p95 budget',
    async () => {
      const db = await openDatabase({ name: `perf-search-${newId()}` });
      const ctx = new RepoContext(db);
      try {
        // Seed in bulk transactions (the canonical records; the engine
        // rebuild then projects them exactly as production would).
        const notes: Note[] = [];
        for (let i = 0; i < NOTE_COUNT; i += 1) notes.push(makeNote(i));
        await ctx.transaction([Store.Notes], 'readwrite', (stores) => {
          const store = stores[Store.Notes];
          if (!store) throw new Error('Notes store missing');
          for (const note of notes) store.put(note);
        });
        const snapshots: Snapshot[] = [];
        for (let i = 0; i < SNAPSHOT_COUNT; i += 1) snapshots.push(makeSnapshot(i, notes[i] as Note));
        await ctx.transaction([Store.Snapshots], 'readwrite', (stores) => {
          const store = stores[Store.Snapshots];
          if (!store) throw new Error('Snapshots store missing');
          for (const snapshot of snapshots) store.put(snapshot);
        });

        // One authoritative index build (the "index is loaded" precondition).
        const engine = new SearchEngine(ctx);
        const indexStart = performance.now();
        const docCount = await engine.rebuild();
        const indexMs = performance.now() - indexStart;
        expect(docCount).toBe(NOTE_COUNT);

        // Realistic query mix (FR-SEARCH-01..04 shapes).
        const shapes: Array<{ label: string; input: Parameters<SearchEngine['execute']>[0] }> = [
          { label: 'common single term', input: { query: 'chrome' } },
          { label: 'topical two-term', input: { query: 'quantum ledger' } },
          { label: 'phrase', input: { query: '"archive policy"' } },
          { label: 'title-scoped', input: { query: 'in:title roadmap' } },
          { label: 'flag filter + term', input: { query: 'is:pinned meeting', filters: { state: 'active' } } },
          { label: 'filter-only sort', input: { query: '', filters: { state: 'active' }, sort: { field: 'modified', direction: 'desc' } } },
          { label: 'term + title sort', input: { query: 'harbor', sort: { field: 'title', direction: 'asc' } } },
          { label: 'fuzzy misspelling', input: { query: 'cathdral', fuzzy: true } },
        ];

        const samples: number[] = [];
        const perShape: Array<{ label: string; p95: number; max: number; total: number }> = [];
        for (const shape of shapes) {
          const times: number[] = [];
          let total = 0;
          for (let i = 0; i < ITERATIONS; i += 1) {
            const start = performance.now();
            const result = await engine.execute(shape.input);
            times.push(performance.now() - start);
            total = result.total;
          }
          samples.push(...times);
          const sorted = [...times].sort((a, b) => a - b);
          perShape.push({
            label: shape.label,
            p95: Math.round(percentile(sorted, 95)),
            max: Math.round(sorted[sorted.length - 1] ?? 0),
            total,
          });
        }

        const sortedAll = [...samples].sort((a, b) => a - b);
        const p50 = percentile(sortedAll, 50);
        const p95 = percentile(sortedAll, 95);
        const p99 = percentile(sortedAll, 99);
        const max = sortedAll[sortedAll.length - 1] ?? 0;

        // Report (captured into docs/RELEASE_VERIFICATION.md).
        console.log(`[perf] corpus: 10,000 notes / 2,000 snapshot docs, index build ${Math.round(indexMs)} ms`);
        for (const shape of perShape) {
          console.log(
            `[perf] ${shape.label.padEnd(24)} p95 ${String(shape.p95).padStart(5)} ms  max ${String(shape.max).padStart(5)} ms  hits ${shape.total}`,
          );
        }
        console.log(
          `[perf] OVERALL ${samples.length} samples: p50 ${Math.round(p50)} ms, p95 ${Math.round(p95)} ms, p99 ${Math.round(p99)} ms, max ${Math.round(max)} ms`,
        );

        // Sanity: the corpus actually matches.
        expect(perShape[0]?.total).toBeGreaterThan(0);
        expect(perShape[4]?.total).toBeGreaterThan(0);

        // The PRD §11 budget.
        expect(p95, `search p95 ${Math.round(p95)} ms exceeds the 500 ms budget`).toBeLessThan(500);
      } finally {
        db.close();
      }
    },
    600_000,
  );
});
