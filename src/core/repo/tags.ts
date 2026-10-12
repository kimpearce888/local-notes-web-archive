import type { EntityId, NoteTag, Tag } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { normalizeKey } from '../util/strings';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Tags repository (FR-NOTE-04): normalized unique keys, create/rename/merge/
 * delete-with-reassignment, join records.
 */

export class DuplicateTagError extends Error {
  constructor(readonly normalizedKey: string) {
    super(`a tag with the normalized key "${normalizedKey}" already exists`);
    this.name = 'DuplicateTagError';
  }
}

export class TagNotFoundError extends Error {
  constructor(readonly tagId: EntityId) {
    super(`tag ${tagId} not found`);
    this.name = 'TagNotFoundError';
  }
}

export async function createTag(ctx: RepoContext, name: string): Promise<Tag> {
  const normalizedKey = normalizeKey(name);
  if (normalizedKey === '') throw new Error('tag name must not be empty');
  const existing = await findTagByKey(ctx, normalizedKey);
  if (existing) throw new DuplicateTagError(normalizedKey);
  const now = nowUtc();
  const tag: Tag = {
    id: newId(),
    name,
    normalizedKey,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.transaction([Store.Tags], 'readwrite', (stores) => {
    stores[Store.Tags]?.put(tag);
  });
  return tag;
}

export async function findTagByKey(ctx: RepoContext, key: string): Promise<Tag | null> {
  const hits = await ctx.getByIndex<Tag>(Store.Tags, 'normalizedKey', normalizeKey(key));
  return hits[0] ?? null;
}

export async function getTag(ctx: RepoContext, id: EntityId): Promise<Tag | null> {
  return ctx.get<Tag>(Store.Tags, id);
}

export async function listTags(ctx: RepoContext): Promise<Tag[]> {
  const tags = await ctx.getAll<Tag>(Store.Tags);
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

export async function renameTag(ctx: RepoContext, id: EntityId, newName: string): Promise<Tag> {
  const normalizedKey = normalizeKey(newName);
  if (normalizedKey === '') throw new Error('tag name must not be empty');
  let updated: Tag | null = null;
  await ctx.transaction([Store.Tags], 'readwrite', (stores) => {
    const store = stores[Store.Tags];
    if (!store) throw new Error('tags store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const tag = req.result as Tag | undefined;
        if (!tag) {
          reject(new TagNotFoundError(id));
          return;
        }
        const collision = store.index('normalizedKey').getKey(normalizedKey);
        collision.onsuccess = () => {
          const other = collision.result;
          if (other !== undefined && other !== id) {
            reject(new DuplicateTagError(normalizedKey));
            return;
          }
          updated = { ...tag, name: newName, normalizedKey, updatedAt: nowUtc() };
          store.put(updated);
          resolve();
        };
        collision.onerror = () => reject(collision.error ?? new Error('index lookup failed'));
      };
      req.onerror = () => reject(req.error ?? new Error('tag read failed'));
    });
  });
  if (!updated) throw new TagNotFoundError(id);
  return updated;
}

/**
 * Merge `sourceId` into `targetId`: all note-tag joins move to the target
 * (deduplicated); the source tag is deleted. Runs in one transaction.
 */
export async function mergeTags(
  ctx: RepoContext,
  sourceId: EntityId,
  targetId: EntityId,
): Promise<void> {
  if (sourceId === targetId) throw new Error('cannot merge a tag into itself');
  await ctx.transaction([Store.Tags, Store.NoteTags], 'readwrite', (stores) => {
    const tags = stores[Store.Tags];
    const joins = stores[Store.NoteTags];
    if (!tags || !joins) throw new Error('stores unavailable for merge');
    const sourceJoinReq = joins.index('tagId').getAllKeys(sourceId);
    sourceJoinReq.onsuccess = () => {
      const joinKeys = sourceJoinReq.result;
      const readAll = joinKeys.map(
        (key) =>
          new Promise<void>((resolve, reject) => {
            const getReq = joins.get(key);
            getReq.onsuccess = () => {
              const join = getReq.result as NoteTag | undefined;
              if (join) {
                // Deduplicate: skip when the target join already exists.
                const dup = joins.index('noteId').getAll(join.noteId);
                dup.onsuccess = () => {
                  const noteJoins = dup.result as NoteTag[];
                  const exists = noteJoins.some((j) => j.tagId === targetId);
                  if (!exists) {
                    joins.put({ ...join, tagId: targetId, createdAt: join.createdAt });
                  }
                  joins.delete(key);
                  resolve();
                };
                dup.onerror = () => reject(dup.error ?? new Error('join scan failed'));
              } else {
                resolve();
              }
            };
            getReq.onerror = () => reject(getReq.error ?? new Error('join read failed'));
          }),
      );
      void Promise.all(readAll).catch(() => {
        /* transaction-level failures surface via onabort */
      });
    };
    sourceJoinReq.onerror = () => {
      /* surfaced via transaction onerror */
    };
    tags.delete(sourceId);
  });
}

/** Delete a tag and all its join records (notes themselves are untouched). */
export async function deleteTag(ctx: RepoContext, id: EntityId): Promise<void> {
  await ctx.transaction([Store.Tags, Store.NoteTags], 'readwrite', (stores) => {
    const tags = stores[Store.Tags];
    const joins = stores[Store.NoteTags];
    if (!tags || !joins) throw new Error('stores unavailable for delete');
    tags.delete(id);
    const joinReq = joins.index('tagId').getAllKeys(id);
    joinReq.onsuccess = () => {
      for (const key of joinReq.result) joins.delete(key);
    };
  });
}

/* ------------------------------------------------------------------ */
/* Join records                                                        */
/* ------------------------------------------------------------------ */

export async function listNoteTags(ctx: RepoContext, noteId: EntityId): Promise<Tag[]> {
  const joins = await ctx.getByIndex<NoteTag>(Store.NoteTags, 'noteId', noteId);
  const tags: Tag[] = [];
  for (const join of joins) {
    const tag = await ctx.get<Tag>(Store.Tags, join.tagId);
    if (tag) tags.push(tag);
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTagNotes(ctx: RepoContext, tagId: EntityId): Promise<EntityId[]> {
  const joins = await ctx.getByIndex<NoteTag>(Store.NoteTags, 'tagId', tagId);
  return joins.map((j) => j.noteId);
}

/** Replace the full tag set of a note transactionally. */
export async function setNoteTags(
  ctx: RepoContext,
  noteId: EntityId,
  tagIds: readonly EntityId[],
): Promise<void> {
  await ctx.transaction([Store.NoteTags], 'readwrite', (stores) => {
    const joins = stores[Store.NoteTags];
    if (!joins) throw new Error('join store unavailable');
    const existing = joins.index('noteId').getAllKeys(noteId);
    existing.onsuccess = () => {
      for (const key of existing.result) joins.delete(key);
      for (const tagId of new Set(tagIds)) {
        joins.put({ noteId, tagId, createdAt: nowUtc() });
      }
    };
  });
}

/** Bulk-assign tags to many notes (FR-NOTE-08). Existing tags are kept. */
export async function assignTagsToNotes(
  ctx: RepoContext,
  noteIds: readonly EntityId[],
  tagIds: readonly EntityId[],
): Promise<void> {
  if (noteIds.length === 0 || tagIds.length === 0) return;
  await ctx.transaction([Store.NoteTags], 'readwrite', (stores) => {
    const joins = stores[Store.NoteTags];
    if (!joins) throw new Error('join store unavailable');
    void Promise.all(
      noteIds.map(
        (noteId) =>
          new Promise<void>((resolve) => {
            const existing = joins.index('noteId').getAll(noteId);
            existing.onsuccess = () => {
              const current = new Set(
                (existing.result as NoteTag[]).map((j) => j.tagId as string),
              );
              for (const tagId of tagIds) {
                if (!current.has(tagId)) {
                  joins.put({ noteId, tagId, createdAt: nowUtc() });
                }
              }
              resolve();
            };
            existing.onerror = () => resolve();
          }),
      ),
    );
  });
}
