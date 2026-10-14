import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/core/db/open';
import { RepoContext } from '../../../src/core/repo/context';
import { createNote, saveNote, setFlags, archiveNote, trashNote } from '../../../src/core/repo/notes';
import { createTag, setNoteTags } from '../../../src/core/repo/tags';
import { createCategory, setNoteCategories } from '../../../src/core/repo/categories';
import { createLink } from '../../../src/core/repo/links';
import {
  createSnapshot,
  saveTextArtifact,
  markMhtmlArtifact,
  markPngArtifact,
  markTextArtifact,
} from '../../../src/core/repo/snapshots';
import { createReminder } from '../../../src/core/repo/reminders';
import { parseQuery } from '../../../src/core/search/query';
import { SearchEngine } from '../../../src/core/search/engine';
import { newId } from '../../../src/core/util/ids';

let db: IDBDatabase;
let ctx: RepoContext;
let engine: SearchEngine;

beforeEach(async () => {
  db = await openDatabase({ name: `search-test-${newId()}` });
  ctx = new RepoContext(db);
  engine = new SearchEngine(ctx);
  await engine.rebuild();
});

afterEach(() => {
  db.close();
});

async function seedNote(title: string, body: string): Promise<ReturnType<typeof createNote>> {
  const note = await createNote(ctx, { title });
  const saved = await saveNote(ctx, {
    noteId: note.id,
    title,
    subtitle: '',
    editorDoc: null,
    plainText: body,
    expectedRevisionId: null,
    changeSummary: 'seed',
  });
  await engine.indexNote(saved);
  return saved;
}

describe('query parser (FR-SEARCH-04)', () => {
  it('parses bare terms, phrases and exclusions', () => {
    const parsed = parseQuery('chrome extension -edge "local notes"');
    expect(parsed.terms.map((t) => t.text)).toEqual(['chrome', 'extension', 'edge', 'local notes']);
    expect(parsed.terms[2]?.exclude).toBe(true);
    expect(parsed.terms[3]?.phrase).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('parses operators with validation', () => {
    const parsed = parseQuery('tag:work category:Projects has:link is:pinned in:title search');
    expect(parsed.tagNames).toEqual(['work']);
    expect(parsed.categoryNames).toEqual(['Projects']);
    expect(parsed.has).toEqual(['link']);
    expect(parsed.is).toEqual(['pinned']);
    expect(parsed.terms.map((t) => t.text)).toEqual(['search']);
    expect(parsed.terms[0]?.scope).toEqual(['title']);
    expect(parsed.errors).toEqual([]);
  });

  it('explains invalid syntax inline instead of silently changing the query', () => {
    const parsed = parseQuery('has:nope is:maybe before:not-a-date in:middle -tag:work');
    expect(parsed.errors.length).toBe(5);
    expect(parsed.errors[0]).toContain('has:nope is unknown');
    expect(parsed.errors[1]).toContain('is:maybe is unknown');
    expect(parsed.errors[2]).toContain('before:not-a-date is not a valid date');
    expect(parsed.errors[3]).toContain('in:middle is unknown');
    expect(parsed.errors[4]).toContain('cannot be excluded');
  });

  it('validates date ranges', () => {
    expect(parseQuery('before:2026-01-01 after:2026-06-01').errors[0]).toContain(
      'before: date is earlier than after: date',
    );
    expect(parseQuery('before:2026-10-01 after:2026-01-01').errors).toEqual([]);
    expect(parseQuery('before:2026-10-01T10:00:00').errors).toEqual([]);
  });

  it('handles unclosed quotes and empty values honestly', () => {
    const unclosed = parseQuery('"unterminated phrase');
    expect(unclosed.terms.map((t) => t.text)).toEqual(['unterminated phrase']);
    expect(unclosed.terms[0]?.phrase).toBe(true);
    expect(parseQuery('tag:').errors[0]).toContain('empty value');
  });
});

describe('search engine (FR-SEARCH-01/02/05/06)', () => {
  it('finds terms across all searchable fields', async () => {
    await seedNote('Chrome tips', 'browser keyboard shortcuts');
    await seedNote('Kitchen recipes', 'pasta and tomato sauce');
    const result = await engine.execute({ query: 'chrome' });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.score).toBeGreaterThan(0);
    const bodyHit = await engine.execute({ query: 'tomato' });
    expect(bodyHit.total).toBe(1);
  });

  it('matches exact phrases but not scattered words', async () => {
    await seedNote('One', 'local notes archive for chrome');
    await seedNote('Two', 'notes are local; the archive is chrome-based');
    const result = await engine.execute({ query: '"local notes archive"' });
    expect(result.total).toBe(1);
    expect(result.queryErrors).toEqual([]);
  });

  it('excludes terms and respects field scopes', async () => {
    await seedNote('Alpha', 'search engine ranking');
    await seedNote('Beta', 'ranking of chess players');
    const excluded = await engine.execute({ query: 'ranking -chess' });
    expect(excluded.total).toBe(1);
    const inTitle = await engine.execute({ query: 'in:title alpha' });
    expect(inTitle.total).toBe(1);
    const inBody = await engine.execute({ query: 'in:title chess' });
    expect(inBody.total).toBe(0);
  });

  it('searches tags, categories, links, snapshot text and attachment names', async () => {
    const note = await seedNote('Search surfaces', 'plain body');
    const tag = await createTag(ctx, 'research');
    await setNoteTags(ctx, note.id, [tag.id]);
    const category = await createCategory(ctx, 'Projects');
    await setNoteCategories(ctx, note.id, [category.id]);
    await createLink(ctx, note.id, 'https://example.com/interesting');
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/interesting',
      finalUrl: 'https://example.com/interesting',
      title: 'An interesting page',
    });
    await saveTextArtifact(ctx, snapshot.id, 'the captured readable text mentions xylophone');
    await engine.indexNote(note);

    expect((await engine.execute({ query: 'research' })).total).toBe(1);
    expect((await engine.execute({ query: 'tag:research' })).total).toBe(1);
    expect((await engine.execute({ query: 'category:projects' })).total).toBe(1);
    expect((await engine.execute({ query: 'interesting' })).total).toBe(1);
    expect((await engine.execute({ query: 'xylophone' })).total).toBe(1);
    expect((await engine.execute({ query: 'in:snapshot xylophone' })).total).toBe(1);
    expect((await engine.execute({ query: 'in:title xylophone' })).total).toBe(0);
  });

  it('applies has:/is: and state filters with trashed-excluded default', async () => {
    const linked = await seedNote('With link', 'body');
    await createLink(ctx, linked.id, 'https://example.com/a');
    const pinned = await seedNote('Pinned note', 'body');
    await setFlags(ctx, pinned.id, { pinned: true });
    await seedNote('Plain note', 'body');
    await engine.indexNote(linked);
    await engine.indexNote(pinned);

    expect((await engine.execute({ query: '' })).total).toBe(3);
    expect((await engine.execute({ query: 'has:link' })).total).toBe(1);
    expect((await engine.execute({ query: 'is:pinned' })).total).toBe(1);
    expect((await engine.execute({ query: '', filters: { pinned: true } })).total).toBe(1);

    const archived = await archiveNote(ctx, pinned.id);
    await engine.indexNote(archived);
    expect((await engine.execute({ query: '' })).total).toBe(2);
    expect((await engine.execute({ query: 'is:archived' })).total).toBe(1);

    const trashed = await trashNote(ctx, linked.id);
    await engine.indexNote(trashed);
    expect((await engine.execute({ query: 'has:link' })).total).toBe(0);
    expect((await engine.execute({ query: 'is:trashed has:link' })).total).toBe(1);
  });

  it('filters overdue reminders and reminder presence', async () => {
    const note = await seedNote('Reminder holder', 'body');
    await createReminder(ctx, {
      noteId: note.id,
      dueAt: '2020-01-01T00:00:00.000Z' as never,
      recurrence: null,
      timeZone: 'UTC' as never,
      nextDueAt: '2020-01-01T00:00:00.000Z' as never,
    });
    const result = await engine.execute({ query: 'is:overdue' });
    expect(result.total).toBe(1);
    expect((await engine.execute({ query: 'has:reminder' })).total).toBe(1);
    expect((await engine.execute({ query: '', filters: { reminder: 'overdue' } })).total).toBe(1);
  });

  it('sorts by created/modified/title and paginates', async () => {
    const a = await seedNote('C-title', 'first');
    const b = await seedNote('A-title', 'second');
    const c = await seedNote('B-title', 'third');
    void a; void c;
    const byTitle = await engine.execute({ query: '', sort: { field: 'title', direction: 'asc' } });
    expect(byTitle.hits.map((h) => h.noteId)).toEqual([b.id, c.id, a.id]);
    const page1 = await engine.execute({ query: '', sort: { field: 'created', direction: 'asc' }, limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.hits).toHaveLength(2);
    const page2 = await engine.execute({ query: '', sort: { field: 'created', direction: 'asc' }, limit: 2, offset: 2 });
    expect(page2.hits).toHaveLength(1);
  });

  it('persist-loads the index and rebuilds from canonical records on corruption', async () => {
    await seedNote('Persisted', 'index survives reload');
    const engine2 = new SearchEngine(ctx);
    expect(await engine2.load()).toBe('loaded');
    expect((await engine2.execute({ query: 'survives' })).total).toBe(1);

    // Simulate corruption: tamper with the stored payload.
    const { Store } = await import('../../../src/core/db/schema');
    await ctx.transaction([Store.SearchMeta], 'readwrite', (stores) => {
      stores[Store.SearchMeta]?.put({ key: 'fts-index-v1', payload: { broken: true }, docCount: 99 });
    });
    const engine3 = new SearchEngine(ctx);
    expect(await engine3.load()).toBe('rebuilt');
    expect((await engine3.execute({ query: 'survives' })).total).toBe(1);
  });

  it('index updates stay consistent after note edits and removal', async () => {
    const note = await seedNote('Original title', 'original body words');
    expect((await engine.execute({ query: 'original' })).total).toBe(1);
    const saved = await saveNote(ctx, {
      noteId: note.id,
      title: 'Updated title',
      subtitle: '',
      editorDoc: null,
      plainText: 'completely different vocabulary',
      expectedRevisionId: note.revisionId,
      changeSummary: 'rewrite',
    });
    await engine.indexNote(saved);
    expect((await engine.execute({ query: 'vocabulary' })).total).toBe(1);
    expect((await engine.execute({ query: 'original' })).total).toBe(0);
    await engine.removeNote(note.id);
    expect((await engine.execute({ query: 'vocabulary' })).total).toBe(0);
    expect(engine.documentCount).toBe(0);
  });

  it('reports partial snapshot status through has:snapshot filtering', async () => {
    const note = await seedNote('Snapshotted', 'body');
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/partial',
      finalUrl: 'https://example.com/partial',
      title: 'Partial capture',
    });
    await saveTextArtifact(ctx, snapshot.id, 'text only');
    await markMhtmlArtifact(ctx, snapshot.id, 'failed');
    await markPngArtifact(ctx, snapshot.id, 'failed');
    expect((await engine.execute({ query: 'has:snapshot' })).total).toBe(1);
    // Honest semantics (T-065): this capture is PARTIAL (text saved), not
    // failed — the whole capture failing means nothing was saved. The old
    // assertion passed only because 'failed' used to be a no-op filter.
    expect((await engine.execute({ query: '', filters: { snapshot: 'failed' } })).total).toBe(0);
  });

  it('fuzzy matching is optional and off by default', async () => {
    await seedNote('Typo target', 'approximate wrods here');
    expect((await engine.execute({ query: 'wrods' })).total).toBe(1);
    expect((await engine.execute({ query: 'wrodd' })).total).toBe(0);
    expect((await engine.execute({ query: 'wrodd', fuzzy: true })).total).toBe(1);
  });
});

describe('matchedFields decoration (T-041, FR-SEARCH-01 result decoration)', () => {
  it('reports title and body matches for plain terms', async () => {
    await seedNote('Chrome tips', 'browser keyboard shortcuts for chrome');
    const titleOnly = await engine.execute({ query: 'tips' });
    expect(titleOnly.hits[0]?.matchedFields).toEqual(['title']);

    const bodyOnly = await engine.execute({ query: 'keyboard' });
    expect(bodyOnly.hits[0]?.matchedFields).toEqual(['body']);

    const both = await engine.execute({ query: 'chrome' });
    expect([...(both.hits[0]?.matchedFields ?? [])].sort()).toEqual(['body', 'title']);
  });

  it('reports only the scoped field for in: queries', async () => {
    await seedNote('Alpha report', 'quarterly alpha report');
    const inTitle = await engine.execute({ query: 'in:title alpha' });
    expect(inTitle.hits[0]?.matchedFields).toEqual(['title']);

    const inBody = await engine.execute({ query: 'in:body alpha' });
    expect(inBody.hits[0]?.matchedFields).toEqual(['body']);
  });

  it('reports the verified field for exact phrases', async () => {
    await seedNote('One', 'local notes archive for chrome');
    const phrase = await engine.execute({ query: '"local notes archive"' });
    expect(phrase.hits[0]?.matchedFields).toEqual(['body']);

    const titlePhrase = await engine.execute({ query: '"local notes"' });
    expect(titlePhrase.hits[0]?.matchedFields).toEqual(['body']);

    await seedNote('Local Notes deep dive', 'unrelated body text');
    const inTitlePhrase = await engine.execute({ query: 'in:title "local notes"' });
    expect(inTitlePhrase.total).toBe(1);
    expect(inTitlePhrase.hits[0]?.matchedFields).toEqual(['title']);
  });

  it('reports relationship fields: tags, categories, snapshot text', async () => {
    const note = await seedNote('Tagged note', 'plain body words');
    const tag = await createTag(ctx, 'projectx');
    await setNoteTags(ctx, note.id, [tag.id]);
    const category = await createCategory(ctx, 'Research', null);
    await setNoteCategories(ctx, note.id, [category.id]);
    await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/post',
      finalUrl: 'https://example.com/post',
      title: 'Externally hosted article',
    }).then(async (snapshot) => {
      await saveTextArtifact(ctx, snapshot.id, 'zygomatic arch discussion');
    });
    await engine.rebuild();

    const tagHit = await engine.execute({ query: 'projectx' });
    expect(tagHit.hits[0]?.matchedFields).toEqual(['tags']);

    const categoryHit = await engine.execute({ query: 'research' });
    expect(categoryHit.hits[0]?.matchedFields).toEqual(['categories']);

    const snapshotHit = await engine.execute({ query: 'zygomatic' });
    expect(snapshotHit.hits[0]?.matchedFields).toEqual(['snapshots']);
  });

  it('keeps matchedFields through a non-relevance sort', async () => {
    await seedNote('Bravo chrome', 'chrome appears in body too');
    await seedNote('Alpha other', 'chrome in body only');
    const sorted = await engine.execute({
      query: 'chrome',
      sort: { field: 'title', direction: 'asc' },
    });
    expect(sorted.total).toBe(2);
    const byTitle = new Map(
      sorted.hits.map((hit) => [hit.noteId as string, hit.matchedFields]),
    );
    const notes = await ctx.getAll<{ id: string; title: string }>('notes');
    const alpha = notes.find((n) => n.title === 'Alpha other');
    const bravo = notes.find((n) => n.title === 'Bravo chrome');
    expect(alpha && [...(byTitle.get(alpha.id) ?? [])]).toEqual(['body']);
    expect(bravo && [...(byTitle.get(bravo.id) ?? [])].sort()).toEqual(['body', 'title']);
  });

  it('reports empty matchedFields for filter-only queries (no text terms)', async () => {
    const note = await seedNote('Pinned one', 'body');
    await setFlags(ctx, note.id, { pinned: true });
    const result = await engine.execute({ query: '', filters: { pinned: true } });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.matchedFields).toEqual([]);
  });
});

describe('snapshot absence and failure filters (T-065, FR-SEARCH-03)', () => {
  it("snapshot: 'missing' returns notes without any snapshot", async () => {
    const snapshotted = await seedNote('With snapshot', 'captured body');
    await createSnapshot(ctx, {
      noteId: snapshotted.id,
      linkId: null,
      sourceUrl: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      title: 'Captured page',
    });
    const bare = await seedNote('Bare note', 'no capture here');
    const missing = await engine.execute({ query: '', filters: { snapshot: 'missing' } });
    expect(missing.total).toBe(1);
    expect(missing.hits[0]?.noteId).toBe(bare.id);

    // Presence still works the other way.
    const present = await engine.execute({ query: '', filters: { snapshot: 'present' } });
    expect(present.total).toBe(1);
    expect(present.hits[0]?.noteId).toBe(snapshotted.id);
  });

  it("snapshot: 'failed' returns notes whose capture failed", async () => {
    await seedNote('Clean capture', 'body');
    const failedNote = await createNote(ctx, { title: 'Failed capture' });
    const snapshot = await createSnapshot(ctx, {
      noteId: failedNote.id,
      linkId: null,
      sourceUrl: 'https://example.com/failed',
      finalUrl: 'https://example.com/failed',
      title: 'Failed page',
    });
    await markMhtmlArtifact(ctx, snapshot.id, 'failed');
    await markPngArtifact(ctx, snapshot.id, 'failed');
    await markTextArtifact(ctx, snapshot.id, 'failed');

    const failed = await engine.execute({ query: '', filters: { snapshot: 'failed' } });
    expect(failed.total).toBe(1);
    expect(failed.hits[0]?.noteId).toBe(failedNote.id);
  });
});

describe('exclusion-only queries (QA-D01 regression, FR-SEARCH-04)', () => {
  it('a lone exclusion returns every note that does not match', async () => {
    await seedNote('Alpha', 'sourdough starter method');
    await seedNote('Beta', 'vegetable soup recipe');
    await seedNote('Gamma', 'ferry timetable');
    const result = await engine.execute({ query: '-sourdough' });
    expect(result.total).toBe(2);
    expect(result.queryErrors).toEqual([]);
  });

  it('a lone phrase exclusion narrows the full corpus', async () => {
    await seedNote('One', 'the complete saved copy of the page');
    await seedNote('Two', 'a different article entirely');
    // Single-word quoted phrase after the minus sign is the reachable
    // phrase-exclusion syntax (the tokenizer splits multi-word quotes).
    const result = await engine.execute({ query: '-"saved"' });
    expect(result.total).toBe(1);
    expect(result.queryErrors).toEqual([]);
  });

  it('mixed queries still subtract exclusions from matches', async () => {
    await seedNote('One', 'search engine ranking notes');
    await seedNote('Two', 'ranking of chess players');
    await seedNote('Three', 'unrelated gardening tips');
    const result = await engine.execute({ query: 'ranking -chess' });
    expect(result.total).toBe(1);
  });
});
