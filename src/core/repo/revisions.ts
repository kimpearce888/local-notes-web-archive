import type { EntityId, Revision, RevisionMetadataSnapshot, UtcTimestamp } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Revision history (FR-NOTE-06): bounded retention, preview/restore, and
 * restore-recorded-as-new-revision semantics.
 */

export interface CreateRevisionInput {
  readonly noteId: EntityId;
  readonly editorDoc: object | null;
  readonly metadataSnapshot: RevisionMetadataSnapshot;
  readonly summary: string;
  readonly createdAt?: UtcTimestamp;
}

export const DEFAULT_REVISION_RETENTION = 20;
export const MIN_REVISION_RETENTION = 20;

export async function createRevision(
  ctx: RepoContext,
  input: CreateRevisionInput,
): Promise<Revision> {
  const revision: Revision = {
    id: newId(),
    noteId: input.noteId,
    editorDoc: input.editorDoc,
    metadataSnapshot: input.metadataSnapshot,
    createdAt: input.createdAt ?? nowUtc(),
    summary: input.summary,
  };
  await ctx.transaction([Store.Revisions], 'readwrite', (stores) => {
    stores[Store.Revisions]?.put(revision);
  });
  return revision;
}

export async function getRevision(
  ctx: RepoContext,
  id: EntityId,
): Promise<Revision | null> {
  return ctx.get<Revision>(Store.Revisions, id);
}

export async function listRevisions(
  ctx: RepoContext,
  noteId: EntityId,
): Promise<Revision[]> {
  const revisions = await ctx.getByIndex<Revision>(Store.Revisions, 'noteId', noteId);
  return revisions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Count revisions for a note (retention reporting, FR-NOTE-06). */
export async function countRevisions(ctx: RepoContext, noteId: EntityId): Promise<number> {
  const revisions = await ctx.getByIndex<Revision>(Store.Revisions, 'noteId', noteId);
  return revisions.length;
}

/**
 * Prune to retention (at least MIN_REVISION_RETENTION kept, FR-NOTE-06),
 * keeping the newest revisions. Pruning failures never block note writes.
 * Returns the number of pruned revisions (for audit).
 */
export async function pruneRevisions(
  ctx: RepoContext,
  noteId: EntityId,
  retention: number,
): Promise<number> {
  const effective = Math.max(MIN_REVISION_RETENTION, retention);
  let pruned = 0;
  await ctx.transaction([Store.Revisions], 'readwrite', (stores) => {
    const store = stores[Store.Revisions];
    if (!store) return;
    return new Promise<void>((resolve) => {
      const composite = store.index('note_created');
      const range = IDBKeyRange.bound([noteId, ''], [noteId, '\uffff']);
      const listReq = composite.getAll(range);
      listReq.onsuccess = () => {
        const entries = listReq.result as unknown as Array<{
          id: EntityId;
          createdAt: UtcTimestamp;
        }>;
        const sorted = entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        const stale = sorted.slice(effective);
        pruned = stale.length;
        for (const rev of stale) store.delete(rev.id);
        resolve();
      };
      listReq.onerror = () => resolve(); // never block the note write (FR-LOG-04 spirit)
    });
  });
  return pruned;
}
