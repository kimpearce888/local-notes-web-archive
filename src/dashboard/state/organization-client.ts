/**
 * OrganizationApi factory (T-087): the RPC-backed tag/category operations
 * the editor session's metadata bar needs — one wiring shared by the
 * dashboard controller and the editor-session test stacks, mirroring
 * reminders-client/snapshots-client (no drift between prod and tests).
 */

import type { ApiClient } from './client';
import type { OrganizationApi } from './editor-session';

export function createOrganizationApi(client: ApiClient): OrganizationApi {
  return {
    listTags: async () => (await client.request('tags/list', {})).tags,
    createTag: async (name) => {
      try {
        const { tag } = await client.request('tags/create', { name });
        return tag;
      } catch {
        return null;
      }
    },
    noteTagIds: async (noteId) => {
      const { related } = await client.request('notes/related-bulk', {
        noteIds: [noteId],
      });
      const entry = related[noteId];
      return entry ? entry.tags.map((tag) => tag.id) : [];
    },
    setNoteTags: async (noteId, tagIds) => {
      try {
        await client.request('tags/set-note-tags', { noteId, tagIds });
        return true;
      } catch {
        return false;
      }
    },
    listCategories: async () =>
      (await client.request('categories/list', {})).categories,
    createCategory: async (name) => {
      try {
        const { category } = await client.request('categories/create', {
          name,
          parentId: null,
        });
        return category;
      } catch {
        return null;
      }
    },
    noteCategoryIds: async (noteId) => {
      const { related } = await client.request('notes/related-bulk', {
        noteIds: [noteId],
      });
      const entry = related[noteId];
      return entry ? entry.categories.map((category) => category.id) : [];
    },
    setNoteCategories: async (noteId, categoryIds) => {
      try {
        await client.request('categories/set-note-categories', {
          noteId,
          categoryIds,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
