import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/core/db/open';
import { RepoContext } from '../../../src/core/repo/context';
import {
  NoteConflictError,
  NoteNotFoundError,
  archiveNote,
  createNote,
  duplicateNote,
  editorDocToPlainText,
  getNote,
  listAllNotes,
  permanentlyDeleteNote,
  restoreNote,
  restoreRevision,
  saveNote,
  setFlags,
  trashNote,
} from '../../../src/core/repo/notes';
import {
  DEFAULT_REVISION_RETENTION,
  createRevision,
  listRevisions,
  pruneRevisions,
} from '../../../src/core/repo/revisions';
import { newId } from '../../../src/core/util/ids';
import { Store } from '../../../src/core/db/schema';
import type { EntityId, Note } from '../../../src/core/types';

/**
 * T-007 validation: transactional CRUD, createdAt-once, updatedAt-on-commit,
 * bounded revisions with restore-as-new-revision, conflict detection,
 * trash/archive lifecycle and confirmed permanent deletion.
 */

let db: IDBDatabase;
let ctx: RepoContext;

beforeEach(async () => {
  db = await openDatabase({ name: `notes-test-${newId()}` });
  ctx = new RepoContext(db);
});

afterEach(() => {
  db.close();
});

const id = (s: string): EntityId => s as EntityId;

describe('notes repository', () => {
  it('creates a note with createdAt set once', async () => {
    const note = await createNote(ctx, { title: 'First' });
    expect(note.state).toBe('active');
    expect(note.revisionId).toBeNull();
    expect(note.createdAt).toBe(note.updatedAt);
    const stored = await getNote(ctx, note.id);
    expect(stored?.title).toBe('First');
  });

  it('saves document + projection + revision transactionally', async () => {
    const note = await createNote(ctx, {});
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello notes' }] }] };
    const saved = await saveNote(ctx, {
      noteId: note.id,
      title: 'Title',
      subtitle: 'Sub',
      editorDoc: doc,
      plainText: 'hello notes',
      expectedRevisionId: null,
      changeSummary: 'initial content',
    });
    expect(saved.revisionId).not.toBeNull();
    expect(saved.updatedAt >= note.createdAt).toBe(true);
    expect(saved.plainText).toBe('hello notes');
    const revisions = await listRevisions(ctx, note.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.summary).toBe('initial content');
  });

  it('rejects a save whose expected revision is stale (conflict)', async () => {
    const note = await createNote(ctx, {});
    const doc = { type: 'doc', content: [] };
    const first = await saveNote(ctx, {
      noteId: note.id,
      title: 'A',
      subtitle: '',
      editorDoc: doc,
      plainText: '',
      expectedRevisionId: null,
      changeSummary: 'first',
    });
    // A second tab saves with the same stale expectation.
    await expect(
      saveNote(ctx, {
        noteId: note.id,
        title: 'B (stale)',
        subtitle: '',
        editorDoc: doc,
        plainText: '',
        expectedRevisionId: null,
        changeSummary: 'stale save',
      }),
    ).rejects.toBeInstanceOf(NoteConflictError);
    // Fresh expectation works.
    const second = await saveNote(ctx, {
      noteId: note.id,
      title: 'B',
      subtitle: '',
      editorDoc: doc,
      plainText: '',
      expectedRevisionId: first.revisionId,
      changeSummary: 'second',
    });
    expect(second.title).toBe('B');
  });

  it('throws NoteNotFoundError for unknown ids', async () => {
    await expect(
      saveNote(ctx, {
        noteId: id('missing'),
        title: 'x',
        subtitle: '',
        editorDoc: null,
        plainText: '',
        expectedRevisionId: null,
        changeSummary: 'x',
      }),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('archives, restores, trashes and restores from trash', async () => {
    const note = await createNote(ctx, { title: 'Lifecycle' });
    const archived = await archiveNote(ctx, note.id);
    expect(archived.state).toBe('archived');
    expect(archived.archivedAt).not.toBeNull();
    const active = await restoreNote(ctx, note.id);
    expect(active.state).toBe('active');
    expect(active.archivedAt).toBeNull();
    const trashed = await trashNote(ctx, note.id);
    expect(trashed.state).toBe('trashed');
    expect(trashed.trashedAt).not.toBeNull();
    const revived = await restoreNote(ctx, note.id);
    expect(revived.state).toBe('active');
    expect(revived.trashedAt).toBeNull();
  });

  it('sets pinned and favorite flags', async () => {
    const note = await createNote(ctx, {});
    const flagged = await setFlags(ctx, note.id, { pinned: true, favorite: true });
    expect(flagged.pinned).toBe(true);
    expect(flagged.favorite).toBe(true);
    const unflagged = await setFlags(ctx, note.id, { pinned: false });
    expect(unflagged.pinned).toBe(false);
    expect(unflagged.favorite).toBe(true);
  });

  it('duplicates a note with its own identity and history', async () => {
    const note = await createNote(ctx, { title: 'Original' });
    const doc = { type: 'doc', content: [] };
    await saveNote(ctx, {
      noteId: note.id,
      title: 'Original',
      subtitle: '',
      editorDoc: doc,
      plainText: 'body',
      expectedRevisionId: null,
      changeSummary: 'content',
    });
    const copy = await duplicateNote(ctx, note.id);
    expect(copy.id).not.toBe(note.id);
    expect(copy.title).toBe('Original (copy)');
    expect(copy.duplicatedFrom).toBe(note.id);
    expect(copy.revisionId).toBeNull();
    expect(copy.plainText).toBe('body');
    const copyRevisions = await listRevisions(ctx, copy.id);
    expect(copyRevisions).toHaveLength(0);
  });

  it('bounds revision history to retention (>= 20)', async () => {
    const note = await createNote(ctx, {});
    let current: Note = note;
    for (let i = 0; i < 30; i += 1) {
      current = await saveNote(ctx, {
        noteId: note.id,
        title: `Rev ${i}`,
        subtitle: '',
        editorDoc: { type: 'doc', content: [] },
        plainText: `revision ${i}`,
        expectedRevisionId: current.revisionId,
        changeSummary: `edit ${i}`,
      });
    }
    const revisions = await listRevisions(ctx, note.id);
    expect(revisions.length).toBeLessThanOrEqual(DEFAULT_REVISION_RETENTION + 5);
    expect(revisions.length).toBeGreaterThanOrEqual(DEFAULT_REVISION_RETENTION);
    // Newest first.
    expect(revisions[0]?.summary).toBe('edit 29');
  });

  it('pruneRevisions never drops below the minimum retention floor', async () => {
    const note = await createNote(ctx, {});
    let current: Note = note;
    for (let i = 0; i < 25; i += 1) {
      current = await saveNote(ctx, {
        noteId: note.id,
        title: `R${i}`,
        subtitle: '',
        editorDoc: null,
        plainText: '',
        expectedRevisionId: current.revisionId,
        changeSummary: `e${i}`,
      });
    }
    const pruned = await pruneRevisions(ctx, note.id, 5); // below floor
    expect(pruned).toBe(0);
    const revisions = await listRevisions(ctx, note.id);
    expect(revisions.length).toBeGreaterThanOrEqual(20);
  });

  it('restores a revision and records the restore as a new revision', async () => {
    const note = await createNote(ctx, {});
    let current = await saveNote(ctx, {
      noteId: note.id,
      title: 'v1',
      subtitle: '',
      editorDoc: { type: 'doc', content: [{ type: 'text', text: 'one' }] },
      plainText: 'one',
      expectedRevisionId: null,
      changeSummary: 'v1',
    });
    current = await saveNote(ctx, {
      noteId: note.id,
      title: 'v2',
      subtitle: '',
      editorDoc: { type: 'doc', content: [{ type: 'text', text: 'two' }] },
      plainText: 'two',
      expectedRevisionId: current.revisionId,
      changeSummary: 'v2',
    });
    const revisions = await listRevisions(ctx, note.id);
    const v1 = revisions.find((r) => r.summary === 'v1');
    expect(v1).toBeDefined();
    const restored = await restoreRevision(ctx, {
      noteId: note.id,
      revisionId: v1?.id as EntityId,
      expectedRevisionId: current.revisionId,
    });
    expect(restored.title).toBe('v1');
    const after = await listRevisions(ctx, note.id);
    expect(after[0]?.summary).toContain('restored revision');
    expect(after.length).toBe(revisions.length + 1);
  });

  it('requires explicit confirmation for permanent deletion', async () => {
    const note = await createNote(ctx, { title: 'Doomed' });
    await expect(permanentlyDeleteNote(ctx, { noteId: note.id, confirm: false })).rejects.toThrow(
      /explicit confirmation/,
    );
    await expect(getNote(ctx, note.id)).resolves.not.toBeNull();
  });

  it('permanently deletes the note and owned records', async () => {
    const note = await createNote(ctx, { title: 'Cascade' });
    await saveNote(ctx, {
      noteId: note.id,
      title: 'Cascade',
      subtitle: '',
      editorDoc: null,
      plainText: '',
      expectedRevisionId: null,
      changeSummary: 'created',
    });
    // Owned rows in related stores.
    const tagJoin = { noteId: note.id, tagId: id('tag-1'), createdAt: '2026-10-12T08:00:00.000Z' };
    await ctx.transaction([Store.NoteTags], 'readwrite', (stores) => {
      stores[Store.NoteTags]?.put(tagJoin);
    });
    await permanentlyDeleteNote(ctx, { noteId: note.id, confirm: true });
    await expect(getNote(ctx, note.id)).resolves.toBeNull();
    expect(await listRevisions(ctx, note.id)).toHaveLength(0);
    const joins = await ctx.getByIndex(Store.NoteTags, 'noteId', note.id);
    expect(joins).toHaveLength(0);
  });

  it('lists notes by most recently updated', async () => {
    const a = await createNote(ctx, { title: 'A' });
    await createNote(ctx, { title: 'B' });
    await saveNote(ctx, {
      noteId: a.id,
      title: 'A+',
      subtitle: '',
      editorDoc: null,
      plainText: '',
      expectedRevisionId: null,
      changeSummary: 'touch A',
    });
    const notes = await listAllNotes(ctx);
    expect(notes.map((n) => n.title)).toEqual(['A+', 'B']);
  });
});

describe('editorDocToPlainText', () => {
  it('projects text with block separators', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Head' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'text', text: ' two' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      ],
    };
    expect(editorDocToPlainText(doc)).toBe('Head\none two\nthree');
    expect(editorDocToPlainText(null)).toBe('');
  });
});

describe('createRevision standalone', () => {
  it('stores a revision with metadata snapshot', async () => {
    const note = await createNote(ctx, {});
    const revision = await createRevision(ctx, {
      noteId: note.id,
      editorDoc: null,
      metadataSnapshot: { title: 't', subtitle: 's', tagIds: [], categoryId: [] },
      summary: 'manual',
    });
    expect(revision.id).toBeTruthy();
    const listed = await listRevisions(ctx, note.id);
    expect(listed).toHaveLength(1);
  });
});
