/**
 * Tags and categories API (FR-NOTE-04, FR-NOTE-08): CRUD plus join
 * management and bulk assignment used by multi-select actions.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
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

  router.register('tags/create', async (payload) => {
    const p = asObject(payload, 'tags/create');
    const tag = await createTag(await repo(), asString(p['name'], 'name', { maxLength: 200 }));
    return { tag };
  });

  router.register('tags/rename', async (payload) => {
    const p = asObject(payload, 'tags/rename');
    const tag = await renameTag(
      await repo(),
      asId(p['tagId'], 'tagId'),
      asString(p['name'], 'name', { maxLength: 200 }),
    );
    return { tag };
  });

  router.register('tags/merge', async (payload) => {
    const p = asObject(payload, 'tags/merge');
    await mergeTags(await repo(), asId(p['sourceTagId'], 'sourceTagId'), asId(p['targetTagId'], 'targetTagId'));
    return { merged: true };
  });

  router.register('tags/delete', async (payload) => {
    const p = asObject(payload, 'tags/delete');
    await deleteTag(await repo(), asId(p['tagId'], 'tagId'));
    return { deleted: true };
  });

  router.register('tags/set-note-tags', async (payload) => {
    const p = asObject(payload, 'tags/set-note-tags');
    await setNoteTags(await repo(), asId(p['noteId'], 'noteId'), asIdArray(p['tagIds'], 'tagIds'));
    return { applied: true };
  });

  router.register('tags/assign-to-notes', async (payload) => {
    const p = asObject(payload, 'tags/assign-to-notes');
    await assignTagsToNotes(
      await repo(),
      asIdArray(p['noteIds'], 'noteIds', { max: 1000 }),
      asIdArray(p['tagIds'], 'tagIds'),
    );
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

  router.register('categories/create', async (payload) => {
    const p = asObject(payload, 'categories/create');
    const category = await createCategory(
      await repo(),
      asString(p['name'], 'name', { maxLength: 200 }),
      asOptionalId(p['parentId'], 'parentId') ?? null,
    );
    return { category };
  });

  router.register('categories/rename', async (payload) => {
    const p = asObject(payload, 'categories/rename');
    const category = await renameCategory(
      await repo(),
      asId(p['categoryId'], 'categoryId'),
      asString(p['name'], 'name', { maxLength: 200 }),
    );
    return { category };
  });

  router.register('categories/move', async (payload) => {
    const p = asObject(payload, 'categories/move');
    const category = await moveCategory(
      await repo(),
      asId(p['categoryId'], 'categoryId'),
      asOptionalId(p['parentId'], 'parentId') ?? null,
    );
    return { category };
  });

  router.register('categories/merge', async (payload) => {
    const p = asObject(payload, 'categories/merge');
    await mergeCategories(
      await repo(),
      asId(p['sourceCategoryId'], 'sourceCategoryId'),
      asId(p['targetCategoryId'], 'targetCategoryId'),
    );
    return { merged: true };
  });

  router.register('categories/delete', async (payload) => {
    const p = asObject(payload, 'categories/delete');
    await deleteCategory(await repo(), asId(p['categoryId'], 'categoryId'), {
      reassignTo: asOptionalId(p['reassignTo'], 'reassignTo') ?? null,
    });
    return { deleted: true };
  });

  router.register('categories/set-note-categories', async (payload) => {
    const p = asObject(payload, 'categories/set-note-categories');
    await setNoteCategories(
      await repo(),
      asId(p['noteId'], 'noteId'),
      asIdArray(p['categoryIds'], 'categoryIds'),
    );
    return { applied: true };
  });

  router.register('categories/assign-to-notes', async (payload) => {
    const p = asObject(payload, 'categories/assign-to-notes');
    await assignCategoriesToNotes(
      await repo(),
      asIdArray(p['noteIds'], 'noteIds', { max: 1000 }),
      asIdArray(p['categoryIds'], 'categoryIds'),
    );
    return { applied: true };
  });
}
