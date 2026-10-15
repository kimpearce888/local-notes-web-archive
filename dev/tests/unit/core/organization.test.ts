import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../src/core/db/open';
import { RepoContext } from '../../../../src/core/repo/context';
import { createNote } from '../../../../src/core/repo/notes';
import {
  DuplicateTagError,
  TagNotFoundError,
  assignTagsToNotes,
  createTag,
  deleteTag,
  findTagByKey,
  listNoteTags,
  listTagNotes,
  mergeTags,
  renameTag,
  setNoteTags,
} from '../../../../src/core/repo/tags';
import {
  CategoryCycleError,
  CategoryNotFoundError,
  assignCategoriesToNotes,
  categoryTree,
  createCategory,
  deleteCategory,
  listNoteCategories,
  mergeCategories,
  moveCategory,
  renameCategory,
  setNoteCategories,
} from '../../../../src/core/repo/categories';
import { newId } from '../../../../src/core/util/ids';

let db: IDBDatabase;
let ctx: RepoContext;

beforeEach(async () => {
  db = await openDatabase({ name: `org-test-${newId()}` });
  ctx = new RepoContext(db);
});

afterEach(() => {
  db.close();
});

describe('tags repository', () => {
  it('creates tags with normalized unique keys', async () => {
    const a = await createTag(ctx, '  Web   Archive ');
    expect(a.normalizedKey).toBe('web archive');
    await expect(createTag(ctx, 'WEB ARCHIVE')).rejects.toBeInstanceOf(DuplicateTagError);
    await expect(createTag(ctx, 'web  archive')).rejects.toBeInstanceOf(DuplicateTagError);
    await expect(createTag(ctx, '  ')).rejects.toThrow(/must not be empty/);
  });

  it('renames with collision detection keeping identity', async () => {
    const a = await createTag(ctx, 'alpha');
    const b = await createTag(ctx, 'beta');
    const renamed = await renameTag(ctx, a.id, 'Alpha Prime');
    expect(renamed.id).toBe(a.id);
    expect(renamed.normalizedKey).toBe('alpha prime');
    await expect(renameTag(ctx, a.id, 'BETA')).rejects.toBeInstanceOf(DuplicateTagError);
    // Renaming to own key is allowed.
    await expect(renameTag(ctx, b.id, 'beta')).resolves.toBeDefined();
  });

  it('assigns, replaces and lists note tags', async () => {
    const note = await createNote(ctx, {});
    const work = await createTag(ctx, 'work');
    const home = await createTag(ctx, 'home');
    await setNoteTags(ctx, note.id, [work.id]);
    expect((await listNoteTags(ctx, note.id)).map((t) => t.name)).toEqual(['work']);
    await setNoteTags(ctx, note.id, [work.id, home.id]);
    expect((await listNoteTags(ctx, note.id)).map((t) => t.name)).toEqual(['home', 'work']);
    expect(await listTagNotes(ctx, work.id)).toEqual([note.id]);
  });

  it('merges tags with join reassignment and dedup', async () => {
    const note = await createNote(ctx, {});
    const source = await createTag(ctx, 'source');
    const target = await createTag(ctx, 'target');
    const other = await createTag(ctx, 'other');
    await setNoteTags(ctx, note.id, [source.id, other.id]);
    await mergeTags(ctx, source.id, target.id);
    const names = (await listNoteTags(ctx, note.id)).map((t) => t.name);
    expect(names.sort()).toEqual(['other', 'target']);
    await expect(findTagByKey(ctx, 'source')).resolves.toBeNull();
    // Merging into itself is rejected.
    await expect(mergeTags(ctx, target.id, target.id)).rejects.toThrow(/into itself/);
  });

  it('deletes a tag and its joins but keeps notes', async () => {
    const note = await createNote(ctx, { title: 'Keep me' });
    const tag = await createTag(ctx, 'temp');
    await setNoteTags(ctx, note.id, [tag.id]);
    await deleteTag(ctx, tag.id);
    expect(await listNoteTags(ctx, note.id)).toHaveLength(0);
    await expect(renameTag(ctx, tag.id, 'x')).rejects.toBeInstanceOf(TagNotFoundError);
  });

  it('bulk-assigns tags to many notes additively', async () => {
    const n1 = await createNote(ctx, {});
    const n2 = await createNote(ctx, {});
    const t1 = await createTag(ctx, 'one');
    const t2 = await createTag(ctx, 'two');
    await assignTagsToNotes(ctx, [n1.id, n2.id], [t1.id]);
    await assignTagsToNotes(ctx, [n1.id], [t2.id]);
    expect((await listNoteTags(ctx, n1.id)).map((t) => t.name).sort()).toEqual(['one', 'two']);
    expect((await listNoteTags(ctx, n2.id)).map((t) => t.name)).toEqual(['one']);
  });
});

describe('categories repository', () => {
  it('creates a nested hierarchy with ordering', async () => {
    const root = await createCategory(ctx, 'Projects');
    const childA = await createCategory(ctx, 'Alpha', root.id);
    const childB = await createCategory(ctx, 'Beta', root.id);
    expect(childA.parentId).toBe(root.id);
    expect(childA.order).toBe(0);
    expect(childB.order).toBe(1);
    const tree = await categoryTree(ctx);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.category.name)).toEqual(['Alpha', 'Beta']);
  });

  it('rejects unknown parents', async () => {
    await expect(createCategory(ctx, 'X', newId())).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('prevents cycles when moving (FR-NOTE-04)', async () => {
    const root = await createCategory(ctx, 'Root');
    const mid = await createCategory(ctx, 'Mid', root.id);
    const leaf = await createCategory(ctx, 'Leaf', mid.id);
    await expect(moveCategory(ctx, root.id, leaf.id)).rejects.toBeInstanceOf(CategoryCycleError);
    await expect(moveCategory(ctx, mid.id, mid.id)).rejects.toBeInstanceOf(CategoryCycleError);
    // Legal move: leaf under root.
    await expect(moveCategory(ctx, leaf.id, root.id)).resolves.toBeDefined();
    const tree = await categoryTree(ctx);
    expect(tree[0]?.children.map((c) => c.category.name).sort()).toEqual(['Leaf', 'Mid']);
  });

  it('renames without reparenting', async () => {
    const root = await createCategory(ctx, 'Docs');
    const renamed = await renameCategory(ctx, root.id, 'Documents');
    expect(renamed.name).toBe('Documents');
    expect(renamed.parentId).toBeNull();
  });

  it('merges categories: joins, children, deletion', async () => {
    const note = await createNote(ctx, {});
    const source = await createCategory(ctx, 'Source');
    const target = await createCategory(ctx, 'Target');
    const child = await createCategory(ctx, 'Child', source.id);
    await setNoteCategories(ctx, note.id, [source.id]);
    await mergeCategories(ctx, source.id, target.id);
    expect(await listNoteCategories(ctx, note.id)).toHaveLength(1);
    expect((await listNoteCategories(ctx, note.id))[0]?.name).toBe('Target');
    const tree = await categoryTree(ctx);
    const targetNode = tree.find((n) => n.category.name === 'Target');
    expect(targetNode?.children.map((c) => c.category.name)).toEqual(['Child']);
    // Merging an unrelated category succeeds; merging into own descendant
    // would be rejected by the cycle check above.
    const other = await createCategory(ctx, 'Other');
    await expect(mergeCategories(ctx, other.id, child.id)).resolves.toBeUndefined();
  });

  it('deletes with join reassignment or removal', async () => {
    const note = await createNote(ctx, {});
    const doomed = await createCategory(ctx, 'Doomed');
    const heir = await createCategory(ctx, 'Heir');
    const child = await createCategory(ctx, 'Child', doomed.id);
    await setNoteCategories(ctx, note.id, [doomed.id]);
    // Reassign joins to heir; child lifts to root.
    await deleteCategory(ctx, doomed.id, { reassignTo: heir.id });
    expect((await listNoteCategories(ctx, note.id)).map((c) => c.name)).toEqual(['Heir']);
    const tree = await categoryTree(ctx);
    expect(tree.map((n) => n.category.name).sort()).toEqual(['Child', 'Heir']);
    expect(child.parentId).toBe(doomed.id); // original object unchanged
    // Removal semantics: joins deleted, no reassignment.
    const note2 = await createNote(ctx, {});
    const cat = await createCategory(ctx, 'Gone');
    await setNoteCategories(ctx, note2.id, [cat.id]);
    await deleteCategory(ctx, cat.id, { reassignTo: null });
    expect(await listNoteCategories(ctx, note2.id)).toHaveLength(0);
  });

  it('bulk-assigns categories additively', async () => {
    const n1 = await createNote(ctx, {});
    const n2 = await createNote(ctx, {});
    const c1 = await createCategory(ctx, 'C1');
    const c2 = await createCategory(ctx, 'C2');
    await assignCategoriesToNotes(ctx, [n1.id, n2.id], [c1.id]);
    await assignCategoriesToNotes(ctx, [n1.id], [c2.id]);
    expect((await listNoteCategories(ctx, n1.id)).map((c) => c.name).sort()).toEqual(['C1', 'C2']);
    expect((await listNoteCategories(ctx, n2.id)).map((c) => c.name)).toEqual(['C1']);
  });
});
