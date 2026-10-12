/**
 * Notes API: every mutation keeps the derived search index in sync with the
 * canonical record (FR-SEARCH-05 transactional index updates), so a save is
 * only reported successful when both the note and its projection are durable.
 */

import type { MessageRouter } from '../router';
import { repo, searchEngine } from '../db';
import {
  archiveNote,
  createNote,
  duplicateNote,
  editorDocToPlainText,
  getNoteOrFail,
  listAllNotes,
  permanentlyDeleteNote,
  restoreNote,
  restoreRevision,
  saveNote,
  setFlags,
  trashNote,
} from '../../core/repo/notes';
import { listRevisions } from '../../core/repo/revisions';
import { listNoteTags } from '../../core/repo/tags';
import { listNoteCategories } from '../../core/repo/categories';
import { listNoteLinks } from '../../core/repo/links';
import { listNoteReminders } from '../../core/repo/reminders';
import type { Note, NoteState } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import {
  asId,
  asObject,
  asOptionalBoolean,
  asOptionalJsonObject,
  asOptionalId,
  asOptionalString,
  asString,
} from './validate';

async function indexNote(note: Note): Promise<void> {
  const engine = await searchEngine();
  await engine.indexNote(note);
}

const NOTE_STATES: readonly NoteState[] = ['active', 'archived', 'trashed'];

export function registerNoteApi(router: MessageRouter): void {
  router.register('notes/create', async (payload) => {
    const p = asObject(payload, 'notes/create');
    const editorDoc = asOptionalJsonObject(p['editorDoc'], 'editorDoc') ?? null;
    const explicitPlainText = asOptionalString(p['plainText'], 'plainText', { maxLength: 2_000_000 });
    const plainText = explicitPlainText ?? (editorDoc ? editorDocToPlainText(editorDoc) : undefined);
    const note = await createNote(await repo(), {
      title: asOptionalString(p['title'], 'title', { maxLength: 2000, allowEmpty: true }),
      subtitle: asOptionalString(p['subtitle'], 'subtitle', { maxLength: 2000, allowEmpty: true }),
      editorDoc,
      plainText,
      pinned: asOptionalBoolean(p['pinned'], 'pinned'),
      favorite: asOptionalBoolean(p['favorite'], 'favorite'),
    });
    await indexNote(note);
    return { note };
  });

  router.register('notes/get', async (payload) => {
    const p = asObject(payload, 'notes/get');
    const note = await getNoteOrFail(await repo(), asId(p['noteId'], 'noteId'));
    return { note };
  });

  router.register('notes/list', async (payload) => {
    const p = asObject(payload, 'notes/list');
    const state = asOptionalString(p['state'], 'state', { maxLength: 20 });
    if (state !== undefined && !NOTE_STATES.includes(state as NoteState)) {
      throw new PayloadValidationError(`notes/list: invalid state "${state}"`);
    }
    const notes = await listAllNotes(await repo());
    return { notes: state ? notes.filter((n) => n.state === (state as NoteState)) : notes };
  });

  router.register('notes/save', async (payload) => {
    const p = asObject(payload, 'notes/save');
    const editorDoc = asOptionalJsonObject(p['editorDoc'], 'editorDoc') ?? null;
    const note = await saveNote(await repo(), {
      noteId: asId(p['noteId'], 'noteId'),
      title: asString(p['title'], 'title', { maxLength: 2000, allowEmpty: true }),
      subtitle: asString(p['subtitle'], 'subtitle', { maxLength: 2000, allowEmpty: true }),
      editorDoc,
      plainText: asString(p['plainText'], 'plainText', { maxLength: 2_000_000, allowEmpty: true }),
      expectedRevisionId: asOptionalId(p['expectedRevisionId'], 'expectedRevisionId') ?? null,
      changeSummary: asString(p['changeSummary'], 'changeSummary', { maxLength: 500, allowEmpty: true }),
    });
    await indexNote(note);
    return { note };
  });

  router.register('notes/archive', async (payload) => {
    const p = asObject(payload, 'notes/archive');
    const note = await archiveNote(await repo(), asId(p['noteId'], 'noteId'));
    return { note };
  });

  router.register('notes/restore', async (payload) => {
    const p = asObject(payload, 'notes/restore');
    const note = await restoreNote(await repo(), asId(p['noteId'], 'noteId'));
    return { note };
  });

  router.register('notes/trash', async (payload) => {
    const p = asObject(payload, 'notes/trash');
    const note = await trashNote(await repo(), asId(p['noteId'], 'noteId'));
    return { note };
  });

  router.register('notes/delete-permanently', async (payload) => {
    const p = asObject(payload, 'notes/delete-permanently');
    if (p['confirm'] !== true) {
      throw new PayloadValidationError(
        'notes/delete-permanently: confirm must be literally true (explicit user confirmation)',
      );
    }
    const noteId = asId(p['noteId'], 'noteId');
    await permanentlyDeleteNote(await repo(), { noteId, confirm: true });
    const engine = await searchEngine();
    await engine.removeNote(noteId);
    return { deleted: true, noteId };
  });

  router.register('notes/duplicate', async (payload) => {
    const p = asObject(payload, 'notes/duplicate');
    const note = await duplicateNote(await repo(), asId(p['noteId'], 'noteId'));
    await indexNote(note);
    return { note };
  });

  router.register('notes/set-flags', async (payload) => {
    const p = asObject(payload, 'notes/set-flags');
    const note = await setFlags(await repo(), asId(p['noteId'], 'noteId'), {
      pinned: asOptionalBoolean(p['pinned'], 'pinned'),
      favorite: asOptionalBoolean(p['favorite'], 'favorite'),
    });
    return { note };
  });

  router.register('notes/restore-revision', async (payload) => {
    const p = asObject(payload, 'notes/restore-revision');
    const note = await restoreRevision(await repo(), {
      noteId: asId(p['noteId'], 'noteId'),
      revisionId: asId(p['revisionId'], 'revisionId'),
      expectedRevisionId: asOptionalId(p['expectedRevisionId'], 'expectedRevisionId') ?? null,
    });
    await indexNote(note);
    return { note };
  });

  router.register('notes/revisions', async (payload) => {
    const p = asObject(payload, 'notes/revisions');
    const revisions = await listRevisions(await repo(), asId(p['noteId'], 'noteId'));
    return { revisions };
  });

  /** Everything a card/editor needs for one note in a single round trip. */
  router.register('notes/related', async (payload) => {
    const p = asObject(payload, 'notes/related');
    const noteId = asId(p['noteId'], 'noteId');
    const ctx = await repo();
    const [note, tags, categories, links, reminders] = await Promise.all([
      getNoteOrFail(ctx, noteId),
      listNoteTags(ctx, noteId),
      listNoteCategories(ctx, noteId),
      listNoteLinks(ctx, noteId),
      listNoteReminders(ctx, noteId),
    ]);
    return { note, tags, categories, links, reminders };
  });

  /** Per-state counts for navigation and the trash guard (FR-NOTE-03). */
  router.register('notes/counts', async () => {
    const notes = await listAllNotes(await repo());
    const counts = { active: 0, archived: 0, trashed: 0 };
    for (const note of notes) counts[note.state] += 1;
    return { counts };
  });
}
