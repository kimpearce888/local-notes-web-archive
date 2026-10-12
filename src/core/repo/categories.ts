import type { Category, EntityId, NoteCategory } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Categories repository (FR-NOTE-04): nesting with cycle prevention,
 * create/rename/move/merge and delete-with-reassignment, join records.
 */

export class CategoryNotFoundError extends Error {
  constructor(readonly categoryId: EntityId) {
    super(`category ${categoryId} not found`);
    this.name = 'CategoryNotFoundError';
  }
}

export class CategoryCycleError extends Error {
  constructor(readonly categoryId: EntityId, readonly parentId: EntityId) {
    super('moving this category under its own descendant would create a cycle');
    this.name = 'CategoryCycleError';
  }
}

export async function createCategory(
  ctx: RepoContext,
  name: string,
  parentId: EntityId | null = null,
): Promise<Category> {
  if (name.trim() === '') throw new Error('category name must not be empty');
  if (parentId !== null) {
    const parent = await ctx.get<Category>(Store.Categories, parentId);
    if (!parent) throw new CategoryNotFoundError(parentId);
  }
  const now = nowUtc();
  let created: Category | null = null;
  // Sibling scan and write share one transaction: the assigned order is
  // atomic against concurrent category writes (no stale sibling counts).
  await ctx.transaction([Store.Categories], 'readwrite', (stores) => {
    const store = stores[Store.Categories];
    if (!store) throw new Error('categories store unavailable');
    const parentKey = parentId ?? null;
    const scan = parentKey === null
      ? store.getAll()
      : store.index('parentId').getAll(parentKey);
    scan.onsuccess = () => {
      const siblings = (scan.result as Category[]).filter(
        (c) => (c.parentId ?? null) === parentKey,
      );
      const order = siblings.reduce((max, c) => Math.max(max, c.order + 1), 0);
      created = {
        id: newId(),
        name,
        parentId,
        order,
        createdAt: now,
        updatedAt: now,
      };
      store.put(created);
    };
    scan.onerror = () => {
      /* surfaced through transaction onerror */
    };
  });
  if (!created) throw new Error('category creation produced no record');
  return created;
}

export async function getCategory(
  ctx: RepoContext,
  id: EntityId,
): Promise<Category | null> {
  return ctx.get<Category>(Store.Categories, id);
}

export async function listCategories(ctx: RepoContext): Promise<Category[]> {
  const categories = await ctx.getAll<Category>(Store.Categories);
  // Total order: (parent, order, name, id). A consistent comparator is
  // required — partial comparators make Array#sort engine-dependent and can
  // invert same-parent pairs depending on the store's return order.
  return categories.sort((a, b) => {
    const pa = a.parentId ?? '';
    const pb = b.parentId ?? '';
    if (pa !== pb) return pa < pb ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return (a.id as string) < (b.id as string) ? -1 : 1;
  });
}

export interface CategoryNode {
  readonly category: Category;
  readonly children: CategoryNode[];
}

/** Build the nested tree (cycle-safe even if legacy data contains one). */
export async function categoryTree(ctx: RepoContext): Promise<CategoryNode[]> {
  const all = await listCategories(ctx);
  const byParent = new Map<string | null, Category[]>();
  for (const category of all) {
    const key = category.parentId ?? null;
    const bucket = byParent.get(key) ?? [];
    bucket.push(category);
    byParent.set(key, bucket);
  }
  const build = (parentId: string | null, seen: Set<string>): CategoryNode[] => {
    const children = (byParent.get(parentId) ?? []).filter(
      (c) => !seen.has(c.id as string),
    );
    return children.map((category) => {
      const nextSeen = new Set(seen);
      nextSeen.add(category.id as string);
      return { category, children: build(category.id as string, nextSeen) };
    });
  };
  return build(null, new Set());
}

export async function renameCategory(
  ctx: RepoContext,
  id: EntityId,
  newName: string,
): Promise<Category> {
  if (newName.trim() === '') throw new Error('category name must not be empty');
  let updated: Category | null = null;
  await ctx.transaction([Store.Categories], 'readwrite', (stores) => {
    const store = stores[Store.Categories];
    if (!store) throw new Error('categories store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const category = req.result as Category | undefined;
        if (!category) {
          reject(new CategoryNotFoundError(id));
          return;
        }
        updated = { ...category, name: newName, updatedAt: nowUtc() };
        store.put(updated);
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('category read failed'));
    });
  });
  if (!updated) throw new CategoryNotFoundError(id);
  return updated;
}

/** Collect the descendant chain of a category (excluding itself). */
async function descendantsOf(ctx: RepoContext, id: EntityId): Promise<Set<string>> {
  const all = await listCategories(ctx);
  const childrenOf = new Map<string | null, Category[]>();
  for (const c of all) {
    const key = c.parentId ?? null;
    const bucket = childrenOf.get(key) ?? [];
    bucket.push(c);
    childrenOf.set(key, bucket);
  }
  const seen = new Set<string>();
  const queue: string[] = [id as string];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (!seen.has(child.id as string)) {
        seen.add(child.id as string);
        queue.push(child.id as string);
      }
    }
  }
  return seen;
}

/** Move a category under a new parent; cycles are rejected (FR-NOTE-04). */
export async function moveCategory(
  ctx: RepoContext,
  id: EntityId,
  newParentId: EntityId | null,
): Promise<Category> {
  if (newParentId === id) throw new CategoryCycleError(id, newParentId);
  if (newParentId !== null) {
    const parent = await ctx.get<Category>(Store.Categories, newParentId);
    if (!parent) throw new CategoryNotFoundError(newParentId);
    const descendants = await descendantsOf(ctx, id);
    if (descendants.has(newParentId as string)) {
      throw new CategoryCycleError(id, newParentId);
    }
  }
  let updated: Category | null = null;
  await ctx.transaction([Store.Categories], 'readwrite', (stores) => {
    const store = stores[Store.Categories];
    if (!store) throw new Error('categories store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const category = req.result as Category | undefined;
        if (!category) {
          reject(new CategoryNotFoundError(id));
          return;
        }
        updated = { ...category, parentId: newParentId, updatedAt: nowUtc() };
        store.put(updated);
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('category read failed'));
    });
  });
  if (!updated) throw new CategoryNotFoundError(id);
  return updated;
}

/**
 * Merge `sourceId` into `targetId`: joins move to the target (deduplicated),
 * source children are re-parented to the target, and the source is deleted.
 */
export async function mergeCategories(
  ctx: RepoContext,
  sourceId: EntityId,
  targetId: EntityId,
): Promise<void> {
  if (sourceId === targetId) throw new Error('cannot merge a category into itself');
  const descendants = await descendantsOf(ctx, sourceId);
  if (descendants.has(targetId as string)) {
    throw new CategoryCycleError(sourceId, targetId);
  }
  await ctx.transaction([Store.Categories, Store.NoteCategories], 'readwrite', (stores) => {
    const categories = stores[Store.Categories];
    const joins = stores[Store.NoteCategories];
    if (!categories || !joins) throw new Error('stores unavailable for merge');
    // Re-parent children of the source.
    const childReq = categories.index('parentId').getAllKeys(sourceId);
    childReq.onsuccess = () => {
      for (const childId of childReq.result) {
        const getReq = categories.get(childId);
        getReq.onsuccess = () => {
          const child = getReq.result as Category | undefined;
          if (child) categories.put({ ...child, parentId: targetId, updatedAt: nowUtc() });
        };
      }
    };
    // Move joins (deduplicated against existing target joins).
    const joinReq = joins.index('categoryId').getAllKeys(sourceId);
    joinReq.onsuccess = () => {
      for (const joinKey of joinReq.result) {
        const getJoin = joins.get(joinKey);
        getJoin.onsuccess = () => {
          const join = getJoin.result as NoteCategory | undefined;
          if (!join) return;
          const noteJoins = joins.index('noteId').getAll(join.noteId);
          noteJoins.onsuccess = () => {
            const exists = (noteJoins.result as NoteCategory[]).some(
              (j) => j.categoryId === targetId,
            );
            if (!exists) {
              joins.put({ ...join, categoryId: targetId });
            }
            joins.delete(joinKey);
          };
        };
      }
    };
    categories.delete(sourceId);
  });
}

export interface DeleteCategoryOptions {
  /**
   * Reassignment target for the category's note joins: another category, or
   * null to simply remove the joins (delete-with-reassignment, FR-NOTE-04).
   */
  readonly reassignTo: EntityId | null;
  /** Children are moved to the deleted category's parent. */
  readonly reparentChildren?: boolean;
}

/** Delete a category with explicit join reassignment semantics. */
export async function deleteCategory(
  ctx: RepoContext,
  id: EntityId,
  options: DeleteCategoryOptions,
): Promise<void> {
  const source = await ctx.get<Category>(Store.Categories, id);
  if (!source) throw new CategoryNotFoundError(id);
  if (options.reassignTo === id) throw new Error('cannot reassign to the deleted category');
  if (options.reassignTo !== null) {
    const target = await ctx.get<Category>(Store.Categories, options.reassignTo);
    if (!target) throw new CategoryNotFoundError(options.reassignTo);
  }
  await ctx.transaction(
    [Store.Categories, Store.NoteCategories],
    'readwrite',
    (stores) => {
      const categories = stores[Store.Categories];
      const joins = stores[Store.NoteCategories];
      if (!categories || !joins) throw new Error('stores unavailable for delete');
      categories.delete(id);
      // Re-parent children to the deleted category's parent (or root).
      const childReq = categories.index('parentId').getAllKeys(id);
      childReq.onsuccess = () => {
        for (const childId of childReq.result) {
          const getReq = categories.get(childId);
          getReq.onsuccess = () => {
            const child = getReq.result as Category | undefined;
            if (child) {
              categories.put({
                ...child,
                parentId: options.reparentChildren === false ? null : source.parentId,
                updatedAt: nowUtc(),
              });
            }
          };
        }
      };
      // Reassign or remove note joins.
      const joinReq = joins.index('categoryId').getAllKeys(id);
      joinReq.onsuccess = () => {
        for (const joinKey of joinReq.result) {
          if (options.reassignTo === null) {
            joins.delete(joinKey);
            continue;
          }
          const getJoin = joins.get(joinKey);
          getJoin.onsuccess = () => {
            const join = getJoin.result as NoteCategory | undefined;
            if (!join) return;
            const noteJoins = joins.index('noteId').getAll(join.noteId);
            noteJoins.onsuccess = () => {
              const exists = (noteJoins.result as NoteCategory[]).some(
                (j) => j.categoryId === options.reassignTo,
              );
              if (!exists) {
                joins.put({ ...join, categoryId: options.reassignTo });
              } else {
                joins.delete(joinKey);
              }
            };
          };
        }
      };
    },
  );
}

/* ------------------------------------------------------------------ */
/* Join records                                                        */
/* ------------------------------------------------------------------ */

export async function listNoteCategories(
  ctx: RepoContext,
  noteId: EntityId,
): Promise<Category[]> {
  const joins = await ctx.getByIndex<NoteCategory>(Store.NoteCategories, 'noteId', noteId);
  const categories: Category[] = [];
  for (const join of joins) {
    const category = await ctx.get<Category>(Store.Categories, join.categoryId);
    if (category) categories.push(category);
  }
  return categories;
}

/** Replace the full category set of a note transactionally. */
export async function setNoteCategories(
  ctx: RepoContext,
  noteId: EntityId,
  categoryIds: readonly EntityId[],
): Promise<void> {
  await ctx.transaction([Store.NoteCategories], 'readwrite', (stores) => {
    const joins = stores[Store.NoteCategories];
    if (!joins) throw new Error('join store unavailable');
    const existing = joins.index('noteId').getAllKeys(noteId);
    existing.onsuccess = () => {
      for (const key of existing.result) joins.delete(key);
      for (const categoryId of new Set(categoryIds)) {
        joins.put({ noteId, categoryId, createdAt: nowUtc() });
      }
    };
  });
}

/** Bulk-assign categories to many notes (FR-NOTE-08). */
export async function assignCategoriesToNotes(
  ctx: RepoContext,
  noteIds: readonly EntityId[],
  categoryIds: readonly EntityId[],
): Promise<void> {
  if (noteIds.length === 0 || categoryIds.length === 0) return;
  await ctx.transaction([Store.NoteCategories], 'readwrite', (stores) => {
    const joins = stores[Store.NoteCategories];
    if (!joins) throw new Error('join store unavailable');
    void Promise.all(
      noteIds.map(
        (noteId) =>
          new Promise<void>((resolve) => {
            const existing = joins.index('noteId').getAll(noteId);
            existing.onsuccess = () => {
              const current = new Set(
                (existing.result as NoteCategory[]).map((j) => j.categoryId as string),
              );
              for (const categoryId of categoryIds) {
                if (!current.has(categoryId)) {
                  joins.put({ noteId, categoryId, createdAt: nowUtc() });
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
