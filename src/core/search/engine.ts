import MiniSearch from 'minisearch';
import type { EntityId, Filters, Note, SearchField, SearchResult, SortDirection, SortField, Tag, Link, Snapshot, Attachment } from '../types';
import { Store } from '../db/schema';
import type { RepoContext } from '../repo/context';
import { parseQuery, scopeToFields, type ParsedQuery } from './query';

/**
 * Search engine (FR-SEARCH-01..06): MiniSearch over normalized projections,
 * transactional index updates, rebuild-on-corruption, filters, saved views
 * and sort orders.
 */

/** Indexed projection of one note plus its relationships. */
export interface SearchDoc {
  readonly id: string;
  title: string;
  subtitle: string;
  body: string;
  tags: string;
  categories: string;
  links: string;
  snapshots: string;
  attachments: string;
}

const FIELDS: readonly SearchField[] = [
  'title',
  'subtitle',
  'body',
  'tags',
  'categories',
  'links',
  'snapshots',
  'attachments',
];

const INDEX_KEY = 'fts-index-v1';

interface IndexMetaRecord {
  readonly key: string;
  payload: unknown;
  docCount: number;
}

/* ------------------------------------------------------------------ */
/* Projection building                                                 */
/* ------------------------------------------------------------------ */

export async function buildSearchDoc(
  ctx: RepoContext,
  note: Note,
): Promise<SearchDoc> {
  const [tags, links, snapshots, attachments, categories] = await Promise.all([
    (async () => {
      const joins = await ctx.getByIndex<{ tagId: EntityId }>(Store.NoteTags, 'noteId', note.id);
      const names: string[] = [];
      for (const join of joins) {
        const tag = await ctx.get<Tag>(Store.Tags, join.tagId);
        if (tag) names.push(tag.name);
      }
      return names;
    })(),
    (async () => {
      const links = await ctx.getByIndex<Link>(Store.Links, 'noteId', note.id);
      return links.map((l) => `${l.originalUrl} ${l.anchorText}`).join(' ');
    })(),
    (async () => {
      const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'noteId', note.id);
      return snapshots.map((s) => `${s.title} ${s.extractedText}`).join(' ');
    })(),
    (async () => {
      const attachments = await ctx.getByIndex<Attachment>(Store.Attachments, 'noteId', note.id);
      return attachments.map((a) => a.filename).join(' ');
    })(),
    (async () => {
      const joins = await ctx.getByIndex<{ categoryId: EntityId }>(
        Store.NoteCategories,
        'noteId',
        note.id,
      );
      const names: string[] = [];
      for (const join of joins) {
        const category = await ctx.get<{ name: string }>(Store.Categories, join.categoryId);
        if (category) names.push(category.name);
      }
      return names;
    })(),
  ]);
  return {
    id: note.id as string,
    title: note.title ?? '',
    subtitle: note.subtitle ?? '',
    body: note.plainText ?? '',
    tags: tags.join(' '),
    categories: categories.join(' '),
    links,
    snapshots,
    attachments,
  };
}

function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch({ fields: [...FIELDS], storeFields: [] });
}

/* ------------------------------------------------------------------ */
/* Index lifecycle (FR-SEARCH-05)                                      */
/* ------------------------------------------------------------------ */

export class SearchEngine {
  private mini: MiniSearch<SearchDoc> | null = null;
  private docs = new Map<string, SearchDoc>();

  constructor(private readonly ctx: RepoContext) {}

  /** Load the persisted index; rebuild from canonical records when absent,
   * version-mismatched or corrupt. Rebuild is authoritative (FR-SEARCH-05). */
  async load(): Promise<'loaded' | 'rebuilt'> {
    const record = await this.ctx.get<IndexMetaRecord>(Store.SearchMeta, INDEX_KEY);
    if (record && typeof record.payload === 'object' && record.payload !== null) {
      try {
        const mini = MiniSearch.loadJSON<SearchDoc>(
          JSON.stringify(record.payload),
          { fields: [...FIELDS], storeFields: [] },
        );
        if (mini.documentCount === record.docCount) {
          this.mini = mini;
          return 'loaded';
        }
      } catch {
        // fall through to rebuild
      }
    }
    await this.rebuild();
    return 'rebuilt';
  }

  /** Full rebuild from canonical records; persists the fresh index. */
  async rebuild(): Promise<number> {
    const notes = await this.ctx.getAll<Note>(Store.Notes);
    const docs: SearchDoc[] = [];
    for (const note of notes) {
      docs.push(await buildSearchDoc(this.ctx, note));
    }
    const mini = createMiniSearch();
    mini.addAll(docs);
    this.mini = mini;
    this.docs = new Map(docs.map((d) => [d.id, d]));
    await this.persist();
    return docs.length;
  }

  private async persist(): Promise<void> {
    if (!this.mini) return;
    const record: IndexMetaRecord = {
      key: INDEX_KEY,
      payload: this.mini.toJSON() as unknown,
      docCount: this.mini.documentCount,
    };
    await this.ctx.transaction([Store.SearchMeta], 'readwrite', (stores) => {
      stores[Store.SearchMeta]?.put(record);
    });
  }

  /** Add/replace one note's projection (called after save commit). */
  async indexNote(note: Note): Promise<void> {
    const doc = await buildSearchDoc(this.ctx, note);
    if (!this.mini) {
      await this.rebuild();
      return;
    }
    const existing = this.docs.get(doc.id);
    if (existing) this.mini.discard(existing.id);
    try {
      this.mini.add(doc);
    } catch {
      // Corrupt/inconsistent state → authoritative rebuild.
      await this.rebuild();
      return;
    }
    this.docs.set(doc.id, doc);
    await this.persist();
  }

  async removeNote(noteId: EntityId): Promise<void> {
    if (!this.mini) return;
    const existing = this.docs.get(noteId as string);
    if (existing) {
      try {
        this.mini.discard(existing.id);
      } catch {
        await this.rebuild();
        return;
      }
      this.docs.delete(noteId as string);
      await this.persist();
    }
  }

  get documentCount(): number {
    return this.mini?.documentCount ?? 0;
  }

  /* --------------------------------------------------------------- */
  /* Execution                                                        */
  /* --------------------------------------------------------------- */

  async execute(input: {
    query: string;
    filters?: Filters;
    sort?: { field: SortField; direction: SortDirection };
    limit?: number;
    offset?: number;
    fuzzy?: boolean;
  }): Promise<SearchResult> {
    const parsed: ParsedQuery = parseQuery(input.query);
    const errors = [...parsed.errors];

    // 1. Base set: canonical notes filtered by structural filters.
    let notes = await this.ctx.getAll<Note>(Store.Notes);
    notes = await applyFilters(this.ctx, notes, input.filters ?? {}, parsed);

    // 2. Text search over the index when terms exist.
    if (parsed.terms.length > 0) {
      if (!this.mini) await this.rebuild();
      const scores = this.textSearch(parsed, input.fuzzy ?? false, errors);
      const noteMap = new Map(notes.map((n) => [n.id as string, n]));
      const matched: Array<{ noteId: string; score: number; fields: Set<SearchField> }> = [];
      for (const [id, hit] of scores) {
        if (noteMap.has(id)) matched.push({ noteId: id, score: hit.score, fields: hit.fields });
      }
      notes = matched
        .map((m) => noteMap.get(m.noteId) as Note)
        .filter((n): n is Note => Boolean(n));
      // Sort by score desc when no explicit non-relevance sort is given.
      const sort = input.sort ?? { field: 'relevance', direction: 'desc' };
      if (sort.field === 'relevance') {
        const scoreOf = new Map(matched.map((m) => [m.noteId, m.score]));
        notes = [...notes].sort(
          (a, b) => (scoreOf.get(b.id as string) ?? 0) - (scoreOf.get(a.id as string) ?? 0),
        );
        const hits = matched.map((m) => ({
          noteId: m.noteId as EntityId,
          score: m.score,
          matchedFields: [...m.fields].filter(isSearchField),
        }));
        return paginate(hits, notes, input, errors);
      }
      // Non-relevance sort: keep the matched-field decoration for the hits.
      const fieldsOf = new Map(matched.map((m) => [m.noteId, m.fields]));
      const sorted = await sortNotes(this.ctx, notes, sort);
      const sortedHits = sorted.map((n) => ({
        noteId: n.id,
        score: fieldsOf.get(n.id as string)?.size ? (scores.get(n.id as string)?.score ?? 0) : 0,
        matchedFields: [...(fieldsOf.get(n.id as string) ?? [])].filter(isSearchField),
      }));
      return paginate(sortedHits, sorted, input, errors);
    }

    // 3. Sort (relevance already handled above).
    const sort = input.sort ?? { field: 'modified', direction: 'desc' };
    notes = await sortNotes(this.ctx, notes, sort);

    const hits = notes.map((n) => ({
      noteId: n.id,
      score: 0,
      matchedFields: [] as SearchField[],
    }));
    return paginate(hits, notes, input, errors);
  }

  private textSearch(
    parsed: ParsedQuery,
    fuzzy: boolean,
    errors: string[],
  ): Map<string, { score: number; fields: Set<SearchField> }> {
    const mini = this.mini;
    if (!mini) return new Map();
    let ids: Set<string> | null = null;
    const scores = new Map<string, { score: number; fields: Set<SearchField> }>();

    const addFields = (id: string, fields: Iterable<string>): void => {
      const entry = scores.get(id) ?? { score: 0, fields: new Set<SearchField>() };
      for (const field of fields) {
        if (isSearchField(field)) entry.fields.add(field);
      }
      scores.set(id, entry);
    };

    for (const term of parsed.terms.filter((t) => !t.exclude)) {
      const fields = scopeToFields(term.scope);
      if (term.phrase) {
        // MiniSearch has no native phrase matching: match the individual
        // words, then verify the exact phrase against the stored projection.
        const words = term.text.split(/\s+/).filter((w) => w !== '');
        if (words.length === 0) continue;
        let phraseIds: Set<string> | null = null;
        for (const word of words) {
          const result = mini.search(word, {
            fields: fields ?? [...FIELDS],
            prefix: true,
            fuzzy: fuzzy ? 0.2 : undefined,
          });
          const wordIds: ReadonlySet<string> = new Set(
            result.map((r) => String(r.id)),
          );
          if (phraseIds === null) {
            phraseIds = new Set(wordIds);
          } else {
            const previous: ReadonlySet<string> = phraseIds;
            phraseIds = new Set(
              [...previous].filter((id: string) => wordIds.has(id)),
            );
          }
        }
        const candidates = phraseIds ?? new Set<string>();
        const verified = new Map<string, SearchField[]>();
        for (const id of candidates) {
          const matchedFields = this.phraseFieldsInDoc(id, term.text, fields);
          if (matchedFields.length > 0) verified.set(id, matchedFields);
        }
        ids = combine(
          ids,
          new Set(verified.keys()),
          'AND',
        );
        for (const [id, matchedFields] of verified) {
          const entry = scores.get(id) ?? { score: 0, fields: new Set<SearchField>() };
          entry.score += 1;
          entry.fields = new Set([...entry.fields, ...matchedFields]);
          scores.set(id, entry);
        }
      } else {
        const result = mini.search(term.text, {
          fields: fields ?? [...FIELDS],
          prefix: true,
          fuzzy: fuzzy ? 0.2 : undefined,
        });
        const termIds = new Set(result.map((r) => String(r.id)));
        for (const hit of result) {
          const id = String(hit.id);
          const entry = scores.get(id) ?? { score: 0, fields: new Set<SearchField>() };
          entry.score += hit.score;
          scores.set(id, entry);
          // MiniSearch's match info: which fields each matched term was found in.
          for (const matchedFields of Object.values(hit.match ?? {})) {
            addFields(id, matchedFields);
          }
        }
        ids = combine(ids, termIds, 'AND');
      }
    }

    // Exclusion-only queries narrow the full corpus instead of blanking the
    // results: "-term" is documented syntax (FR-SEARCH-04) and a lone
    // exclusion means "everything except…". Without this the include loop
    // never runs, ids stays null and the query silently returns nothing
    // (found by human QA as defect QA-D01).
    if (ids === null && parsed.terms.some((term) => term.exclude)) {
      ids = new Set(this.docs.keys());
    }

    // Exclusions subtract from the result.
    for (const term of parsed.terms.filter((t) => t.exclude)) {
      const fields = scopeToFields(term.scope);
      if (term.phrase) {
        const words = term.text.split(/\s+/).filter((w) => w !== '');
        let phraseIds: Set<string> | null = null;
        for (const word of words) {
          const result = mini.search(word, { fields: fields ?? [...FIELDS], prefix: true });
          const wordIds: ReadonlySet<string> = new Set(
            result.map((r) => String(r.id)),
          );
          if (phraseIds === null) {
            phraseIds = new Set(wordIds);
          } else {
            const previous: ReadonlySet<string> = phraseIds;
            phraseIds = new Set(
              [...previous].filter((id: string) => wordIds.has(id)),
            );
          }
        }
        for (const id of phraseIds ?? new Set<string>()) {
          if (this.phraseFieldsInDoc(id, term.text, fields).length > 0) ids?.delete(id);
        }
      } else {
        const result = mini.search(term.text, { fields: fields ?? [...FIELDS], prefix: true });
        for (const hit of result) ids?.delete(String(hit.id));
      }
    }

    if (ids === null) {
      // Only reachable when every term was skipped as unsearchable (e.g. an
      // empty quoted phrase): say so instead of blaming the index.
      errors.push('the query has no searchable terms');
      return new Map();
    }
    const filteredScores = new Map<string, { score: number; fields: Set<SearchField> }>();
    for (const id of ids) {
      const entry = scores.get(id);
      filteredScores.set(id, entry ?? { score: 0, fields: new Set<SearchField>() });
    }
    return filteredScores;
  }

  private phraseFieldsInDoc(
    id: string,
    phrase: string,
    scope: readonly SearchField[] | null,
  ): SearchField[] {
    const doc = this.docs.get(id);
    if (!doc) return [];
    const fields = scope ?? FIELDS;
    const needle = phrase.toLocaleLowerCase('en-US');
    const matched: SearchField[] = [];
    for (const field of fields) {
      const value = (doc[field as keyof SearchDoc] as string | undefined) ?? '';
      if (value.toLocaleLowerCase('en-US').includes(needle)) matched.push(field);
    }
    return matched;
  }
}

function isSearchField(value: string): value is SearchField {
  return (FIELDS as readonly string[]).includes(value);
}

function combine(current: Set<string> | null, incoming: Set<string>, op: 'AND'): Set<string> {
  if (current === null) return incoming;
  if (op === 'AND') return new Set([...current].filter((id) => incoming.has(id)));
  return current;
}

function paginate(
  hits: Array<{ noteId: EntityId; score: number; matchedFields: SearchField[] }>,
  notes: Note[],
  input: { limit?: number; offset?: number },
  errors: readonly string[],
): SearchResult {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 50;
  return {
    hits: hits.slice(offset, offset + limit),
    total: notes.length,
    queryErrors: errors,
  };
}

/* ------------------------------------------------------------------ */
/* Filters (FR-SEARCH-03)                                              */
/* ------------------------------------------------------------------ */

async function applyFilters(
  ctx: RepoContext,
  notes: Note[],
  filters: Filters,
  parsed: ParsedQuery,
): Promise<Note[]> {
  let result = notes;

  // State: trashed excluded by default unless requested (FR-NOTE-05).
  const stateFilter = filters.state ?? (parsed.is.includes('trashed') ? 'trashed' : parsed.is.includes('archived') ? 'archived' : 'active');
  result = result.filter((n) => n.state === stateFilter);

  if (parsed.is.includes('pinned') || filters.pinned === true) {
    result = result.filter((n) => n.pinned);
  }
  if (parsed.is.includes('favorite') || filters.favorite === true) {
    result = result.filter((n) => n.favorite);
  }

  // Dates: created/modified windows (before/after apply to modified when
  // unspecified — documented behavior).
  const before = parsed.before ?? filters.modifiedBefore ?? filters.createdBefore ?? null;
  const after = parsed.after ?? filters.modifiedAfter ?? filters.createdAfter ?? null;
  if (before) {
    const bound = normalizeDateBound(before);
    result = result.filter((n) => n.updatedAt <= bound);
  }
  if (after) {
    const bound = normalizeDateBound(after, 'start');
    result = result.filter((n) => n.updatedAt >= bound);
  }

  // Tags by name.
  if (parsed.tagNames.length > 0) {
    const wanted = new Set(parsed.tagNames.map((n) => n.toLocaleLowerCase('en-US')));
    const keep = new Set<string>();
    for (const note of result) {
      const joins = await ctx.getByIndex<{ tagId: EntityId }>(Store.NoteTags, 'noteId', note.id);
      for (const join of joins) {
        const tag = await ctx.get<Tag>(Store.Tags, join.tagId);
        if (tag && wanted.has(tag.normalizedKey)) {
          keep.add(note.id as string);
          break;
        }
      }
    }
    result = result.filter((n) => keep.has(n.id as string));
  }
  if ((filters.tagIds?.length ?? 0) > 0) {
    const wanted = new Set((filters.tagIds ?? []).map((id) => id as string));
    const keep = new Set<string>();
    for (const note of result) {
      const joins = await ctx.getByIndex<{ tagId: EntityId }>(Store.NoteTags, 'noteId', note.id);
      if (joins.some((j) => wanted.has(j.tagId as string))) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  // Categories by name (includes descendants of the named category).
  if (parsed.categoryNames.length > 0) {
    const categories = await ctx.getAll<{ id: EntityId; name: string; parentId: EntityId | null }>(Store.Categories);
    const descendants = new Set<string>();
    const byName = categories.filter((c) =>
      parsed.categoryNames.some((n) => c.name.toLocaleLowerCase('en-US') === n.toLocaleLowerCase('en-US')),
    );
    const expand = (id: string): void => {
      if (descendants.has(id)) return;
      descendants.add(id);
      for (const child of categories.filter((c) => (c.parentId ?? '') === id)) {
        expand(child.id as string);
      }
    };
    for (const match of byName) expand(match.id as string);
    const keep = new Set<string>();
    for (const note of result) {
      const joins = await ctx.getByIndex<{ categoryId: EntityId }>(Store.NoteCategories, 'noteId', note.id);
      if (joins.some((j) => descendants.has(j.categoryId as string))) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }
  if ((filters.categoryIds?.length ?? 0) > 0) {
    const wanted = new Set((filters.categoryIds ?? []).map((id) => id as string));
    const keep = new Set<string>();
    for (const note of result) {
      const joins = await ctx.getByIndex<{ categoryId: EntityId }>(Store.NoteCategories, 'noteId', note.id);
      if (joins.some((j) => wanted.has(j.categoryId as string))) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  // has:link / has:snapshot / has:reminder / has:attachment
  const linkWanted = parsed.has.includes('link') || filters.hasLink === true;
  const snapshotWanted =
    parsed.has.includes('snapshot') ||
    (filters.snapshot !== undefined && filters.snapshot !== 'missing' && filters.snapshot !== 'failed');
  const reminderWanted = parsed.has.includes('reminder') || filters.reminder === 'any' || filters.reminder === 'due' || filters.reminder === 'overdue';
  const attachmentWanted = parsed.has.includes('attachment') || filters.hasAttachment === true;

  if (linkWanted || snapshotWanted || reminderWanted || attachmentWanted) {
    const keep = new Set<string>();
    for (const note of result) {
      const links = await ctx.getByIndex<Link>(Store.Links, 'noteId', note.id);
      const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'noteId', note.id);
      const reminders = await ctx.getByIndex<{ state: string; nextDueAt: string | null }>(Store.Reminders, 'noteId', note.id);
      const attachments = await ctx.getByIndex<Attachment>(Store.Attachments, 'noteId', note.id);
      let ok = true;
      if (linkWanted) ok = ok && links.length > 0;
      if (snapshotWanted) ok = ok && snapshots.length > 0;
      if (reminderWanted) ok = ok && reminders.length > 0;
      if (attachmentWanted) ok = ok && attachments.length > 0;
      if (ok) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  // Snapshot absence / failure (T-065, FR-SEARCH-03): the presence block
  // above cannot express "no snapshots" or "failed captures", so these get
  // their own pass — keeping every offered filter honest.
  if (filters.snapshot === 'missing' || filters.snapshot === 'failed') {
    const keep = new Set<string>();
    for (const note of result) {
      const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'noteId', note.id);
      const ok =
        filters.snapshot === 'missing'
          ? snapshots.length === 0
          : snapshots.some((s) => s.status === 'failed');
      if (ok) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  if (parsed.is.includes('overdue') || filters.reminder === 'overdue') {
    const now = new Date().toISOString();
    const keep = new Set<string>();
    for (const note of result) {
      const reminders = await ctx.getByIndex<{ state: string; nextDueAt: string | null }>(
        Store.Reminders,
        'noteId',
        note.id,
      );
      if (reminders.some((r) => r.state === 'active' && r.nextDueAt !== null && r.nextDueAt <= now)) {
        keep.add(note.id as string);
      }
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  // Reminder state refinements (T-065, FR-SEARCH-03 "reminder
  // present/due/overdue/completed"): 'due' keeps notes with a scheduled
  // upcoming occurrence, 'completed' notes with at least one completed
  // reminder. The presence block above already ran for these values.
  if (filters.reminder === 'due' || filters.reminder === 'completed') {
    const now = new Date().toISOString();
    const keep = new Set<string>();
    for (const note of result) {
      const reminders = await ctx.getByIndex<{ state: string; nextDueAt: string | null }>(
        Store.Reminders,
        'noteId',
        note.id,
      );
      const ok =
        filters.reminder === 'due'
          ? reminders.some((r) => r.state === 'active' && r.nextDueAt !== null && r.nextDueAt > now)
          : reminders.some((r) => r.state === 'completed');
      if (ok) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  // Source domain + capture date windows.
  const domain = filters.sourceDomain;
  if (domain || filters.capturedAfter || filters.capturedBefore) {
    const keep = new Set<string>();
    for (const note of result) {
      const links = await ctx.getByIndex<Link>(Store.Links, 'noteId', note.id);
      const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'noteId', note.id);
      const domains = links.map((l) => hostOf(l.originalUrl));
      let ok = true;
      if (domain) ok = ok && domains.some((d) => d === domain.toLocaleLowerCase('en-US'));
      if (filters.capturedAfter) {
        const bound = normalizeDateBound(filters.capturedAfter, 'start');
        ok = ok && snapshots.some((s) => s.capturedAt >= bound);
      }
      if (filters.capturedBefore) {
        const bound = normalizeDateBound(filters.capturedBefore);
        ok = ok && snapshots.some((s) => s.capturedAt <= bound);
      }
      if (ok) keep.add(note.id as string);
    }
    result = result.filter((n) => keep.has(n.id as string));
  }

  return result;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLocaleLowerCase('en-US');
  } catch {
    return '';
  }
}

function normalizeDateBound(value: string, edge: 'end' | 'start' = 'end'): string {
  if (value.length === 10) {
    return edge === 'end' ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
  }
  return value.endsWith('Z') ? value : `${value}Z`;
}

/* ------------------------------------------------------------------ */
/* Sorting (FR-SEARCH-06)                                              */
/* ------------------------------------------------------------------ */

async function sortNotes(
  ctx: RepoContext,
  notes: Note[],
  sort: { field: SortField; direction: SortDirection },
): Promise<Note[]> {
  const factor = sort.direction === 'asc' ? 1 : -1;
  const remindersByNote = new Map<string, string>();
  const capturesByNote = new Map<string, string>();
  if (sort.field === 'reminder' || sort.field === 'capture') {
    const allReminders = await ctx.getByIndex<{ noteId: EntityId; state: string; nextDueAt: string | null }>(
      Store.Reminders,
      'state',
      'active',
    );
    for (const r of allReminders) {
      const current = remindersByNote.get(r.noteId as string);
      if (r.nextDueAt !== null && (current === undefined || r.nextDueAt < current)) {
        remindersByNote.set(r.noteId as string, r.nextDueAt);
      }
    }
    const snapshots = await ctx.getAll<Snapshot>(Store.Snapshots);
    for (const s of snapshots) {
      if (s.noteId === null) continue;
      const current = capturesByNote.get(s.noteId as string);
      if (current === undefined || s.capturedAt > current) {
        capturesByNote.set(s.noteId as string, s.capturedAt);
      }
    }
  }
  return [...notes].sort((a, b) => {
    switch (sort.field) {
      case 'title':
        return factor * (a.title.localeCompare(b.title) || (a.id as string).localeCompare(b.id as string));
      case 'created':
        return factor * (a.createdAt.localeCompare(b.createdAt) || (a.id as string).localeCompare(b.id as string));
      case 'reminder': {
        const ra = remindersByNote.get(a.id as string) ?? '9999';
        const rb = remindersByNote.get(b.id as string) ?? '9999';
        return factor * (ra.localeCompare(rb) || (a.id as string).localeCompare(b.id as string));
      }
      case 'capture': {
        const ca = capturesByNote.get(a.id as string) ?? '';
        const cb = capturesByNote.get(b.id as string) ?? '';
        return factor * (cb.localeCompare(ca) || (a.id as string).localeCompare(b.id as string)) * (sort.direction === 'desc' ? 1 : -1);
      }
      case 'modified':
      default:
        return factor * (a.updatedAt.localeCompare(b.updatedAt) || (a.id as string).localeCompare(b.id as string));
    }
  });
}
