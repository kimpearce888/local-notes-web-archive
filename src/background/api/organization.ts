/**
 * Tags and categories API (FR-NOTE-04, FR-NOTE-08): CRUD plus join
 * management and bulk assignment used by multi-select actions.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { auditUserAction } from '../observability';
import {
  assignTagsToNotes,
  createTag,
  deleteTag,
  listTags,
  mergeTags,
  renameTag,
  setNoteTags,
} from '../../core/repo/tags';
import {
  assignCategoriesToNotes,
  categoryTree,
  createCategory,
  deleteCategory,
  listCategories,
  mergeCategories,
  moveCategory,
  renameCategory,
  setNoteCategories,
} from '../../core/repo/categories';
import {
  asId,
  asIdArray,
  asObject,
  asOptionalId,
  asString,
} from './validate';

export function registerOrganizationApi(router: MessageRouter): void {
  /* ---------------- Tags ---------------- */

  router.register('tags/list', async () => {
    const tags = await listTags(await repo());
    return { tags };
  });

  router.register('tags/create', async (payload, ctx) => {
    const p = asObject(payload, 'tags/create');
    const tag = await createTag(await repo(), asString(p['name'], 'name', { maxLength: 200 }));
    await auditUserAction({
      action: 'tags/create',
      targetKind: 'tag',
      targetId: tag.id,
      outcome: 'succeeded',
      detail: `created tag "${tag.name}"`,
      correlationId: ctx.correlationId,
    });
    return { tag };
  });

  router.register('tags/rename', async (payload, ctx) => {
    const p = asObject(payload, 'tags/rename');
    const tag = await renameTag(
      await repo(),
      asId(p['tagId'], 'tagId'),
      asString(p['name'], 'name', { maxLength: 200 }),
    );
    await auditUserAction({
      action: 'tags/rename',
      targetKind: 'tag',
      targetId: tag.id,
      outcome: 'succeeded',
      changedFields: ['name'],
      detail: `renamed tag to "${tag.name}"`,
      correlationId: ctx.correlationId,
    });
    return { tag };
  });

  router.register('tags/merge', async (payload, ctx) => {
    const p = asObject(payload, 'tags/merge');
    const sourceTagId = asId(p['sourceTagId'], 'sourceTagId');
    const targetTagId = asId(p['targetTagId'], 'targetTagId');
    await mergeTags(await repo(), sourceTagId, targetTagId);
    await auditUserAction({
      action: 'tags/merge',
      targetKind: 'tag',
      targetId: targetTagId,
      outcome: 'succeeded',
      detail: `merged tag ${sourceTagId} into ${targetTagId}`,
      correlationId: ctx.correlationId,
    });
    return { merged: true };
  });

  router.register('tags/delete', async (payload, ctx) => {
    const p = asObject(payload, 'tags/delete');
    const tagId = asId(p['tagId'], 'tagId');
    await deleteTag(await repo(), tagId);
    await auditUserAction({
      action: 'tags/delete',
      targetKind: 'tag',
      targetId: tagId,
      outcome: 'succeeded',
      detail: 'deleted tag (join records removed)',
      correlationId: ctx.correlationId,
    });
    return { deleted: true };
  });

  router.register('tags/set-note-tags', async (payload, ctx) => {
    const p = asObject(payload, 'tags/set-note-tags');
    const noteId = asId(p['noteId'], 'noteId');
    const tagIds = asIdArray(p['tagIds'], 'tagIds');
    await setNoteTags(await repo(), noteId, tagIds);
    await auditUserAction({
      action: 'tags/set-note-tags',
      targetKind: 'note',
      targetId: noteId,
      outcome: 'succeeded',
      changedFields: ['tags'],
      detail: `note now has ${tagIds.length} tag(s)`,
      correlationId: ctx.correlationId,
    });
    return { applied: true };
  });

  router.register('tags/assign-to-notes', async (payload, ctx) => {
    const p = asObject(payload, 'tags/assign-to-notes');
    const noteIds = asIdArray(p['noteIds'], 'noteIds', { max: 1000 });
    const tagIds = asIdArray(p['tagIds'], 'tagIds');
    await assignTagsToNotes(await repo(), noteIds, tagIds);
    await auditUserAction({
      action: 'tags/assign-to-notes',
      targetKind: 'tag',
      targetId: tagIds[0] ?? null,
      outcome: 'succeeded',
      changedFields: ['tags'],
      detail: `assigned ${tagIds.length} tag(s) to ${noteIds.length} note(s)`,
      correlationId: ctx.correlationId,
    });
    return { applied: true };
  });

  /* ------------- Categories ------------- */

  router.register('categories/list', async () => {
    const categories = await listCategories(await repo());
    return { categories };
  });

  router.register('categories/tree', async () => {
    const tree = await categoryTree(await repo());
    return { tree };
  });

  router.register('categories/create', async (payload, ctx) => {
    const p = asObject(payload, 'categories/create');
    const category = await createCategory(
      await repo(),
      asString(p['name'], 'name', { maxLength: 200 }),
      asOptionalId(p['parentId'], 'parentId') ?? null,
    );
    await auditUserAction({
      action: 'categories/create',
      targetKind: 'category',
      targetId: category.id,
      outcome: 'succeeded',
      detail: `created category "${category.name}"`,
      correlationId: ctx.correlationId,
    });
    return { category };
  });

  router.register('categories/rename', async (payload, ctx) => {
    const p = asObject(payload, 'categories/rename');
    const category = await renameCategory(
      await repo(),
      asId(p['categoryId'], 'categoryId'),
      asString(p['name'], 'name', { maxLength: 200 }),
    );
    await auditUserAction({
      action: 'categories/rename',
      targetKind: 'category',
      targetId: category.id,
      outcome: 'succeeded',
      changedFields: ['name'],
      detail: `renamed category to "${category.name}"`,
      correlationId: ctx.correlationId,
    });
    return { category };
  });

  router.register('categories/move', async (payload, ctx) => {
    const p = asObject(payload, 'categories/move');
    const category = await moveCategory(
      await repo(),
      asId(p['categoryId'], 'categoryId'),
      asOptionalId(p['parentId'], 'parentId') ?? null,
    );
    await auditUserAction({
      action: 'categories/move',
      targetKind: 'category',
      targetId: category.id,
      outcome: 'succeeded',
      changedFields: ['parentId'],
      detail: 'moved category within the tree',
      correlationId: ctx.correlationId,
    });
    return { category };
  });

  router.register('categories/merge', async (payload, ctx) => {
    const p = asObject(payload, 'categories/merge');
    const sourceCategoryId = asId(p['sourceCategoryId'], 'sourceCategoryId');
    const targetCategoryId = asId(p['targetCategoryId'], 'targetCategoryId');
    await mergeCategories(await repo(), sourceCategoryId, targetCategoryId);
    await auditUserAction({
      action: 'categories/merge',
      targetKind: 'category',
      targetId: targetCategoryId,
      outcome: 'succeeded',
      detail: `merged category ${sourceCategoryId} into ${targetCategoryId}`,
      correlationId: ctx.correlationId,
    });
    return { merged: true };
  });

  router.register('categories/delete', async (payload, ctx) => {
    const p = asObject(payload, 'categories/delete');
    const categoryId = asId(p['categoryId'], 'categoryId');
    const reassignTo = asOptionalId(p['reassignTo'], 'reassignTo') ?? null;
    await deleteCategory(await repo(), categoryId, { reassignTo });
    await auditUserAction({
      action: 'categories/delete',
      targetKind: 'category',
      targetId: categoryId,
      outcome: 'succeeded',
      detail: reassignTo
        ? `deleted category; notes reassigned to ${reassignTo}`
        : 'deleted category (join records removed)',
      correlationId: ctx.correlationId,
    });
    return { deleted: true };
  });

  router.register('categories/set-note-categories', async (payload, ctx) => {
    const p = asObject(payload, 'categories/set-note-categories');
    const noteId = asId(p['noteId'], 'noteId');
    const categoryIds = asIdArray(p['categoryIds'], 'categoryIds');
    await setNoteCategories(await repo(), noteId, categoryIds);
    await auditUserAction({
      action: 'categories/set-note-categories',
      targetKind: 'note',
      targetId: noteId,
      outcome: 'succeeded',
      changedFields: ['categories'],
      detail: `note now has ${categoryIds.length} categor(y/ies)`,
      correlationId: ctx.correlationId,
    });
    return { applied: true };
  });

  router.register('categories/assign-to-notes', async (payload, ctx) => {
    const p = asObject(payload, 'categories/assign-to-notes');
    const noteIds = asIdArray(p['noteIds'], 'noteIds', { max: 1000 });
    const categoryIds = asIdArray(p['categoryIds'], 'categoryIds');
    await assignCategoriesToNotes(await repo(), noteIds, categoryIds);
    await auditUserAction({
      action: 'categories/assign-to-notes',
      targetKind: 'category',
      targetId: categoryIds[0] ?? null,
      outcome: 'succeeded',
      changedFields: ['categories'],
      detail: `assigned ${categoryIds.length} categor(y/ies) to ${noteIds.length} note(s)`,
      correlationId: ctx.correlationId,
    });
    return { applied: true };
  });
}
