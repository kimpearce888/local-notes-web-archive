/**
 * Notes API: every mutation keeps the derived search index in sync with the
 * canonical record (FR-SEARCH-05) and appends an audit event (FR-LOG-02 —
 * actor/action/target/outcome with changed-field names, never content
 * bodies), so a save is only reported successful when both the note and its
 * projection are durable.
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
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
import { appendAuditEvent } from '../../core/repo/audit';
import type { Category, EntityId, Link, Note, NoteState, Reminder, Tag } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import {
  asId,
  asIdArray,
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

/**
 * Audit a user-visible mutation. Correlation ids link the event to the RPC
 * that caused it; audit failures never fail the user's operation (the
 * mutation already committed) but are surfaced on the console.
 */
async function auditUserAction(
  ctx: RpcDispatchContext,
  input: {
    action: string;
    targetId: EntityId | null;
    outcome: 'succeeded' | 'failed';
    changedFields?: readonly string[];
    detail: string;
  },
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action: input.action,
      targetId: input.targetId,
      targetKind: 'note',
      outcome: input.outcome,
      correlationId: ctx.correlationId,
      changedFields: input.changedFields ?? [],
      detail: input.detail,
    });
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}

const NOTE_STATES: readonly NoteState[] = ['active', 'archived', 'trashed'];

/** Related entities surfaced on cards (PRD §4.2 chips and indicators). */
export interface RelatedInfo {
  readonly tags: readonly Tag[];
  readonly categories: readonly Category[];
  readonly links: readonly Link[];
  readonly reminders: readonly Reminder[];
}

async function relatedFor(ctx: RepoContextLike, noteId: EntityId): Promise<RelatedInfo> {
  const [tags, categories, links, reminders] = await Promise.all([
    listNoteTags(ctx, noteId),
    listNoteCategories(ctx, noteId),
    listNoteLinks(ctx, noteId),
    listNoteReminders(ctx, noteId),
  ]);
  return { tags, categories, links, reminders };
}

type RepoContextLike = Parameters<typeof listNoteTags>[0];

export function registerNoteApi(router: MessageRouter): void {
  router.register('notes/create', async (payload, ctx) => {
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
    await auditUserAction(ctx, {
      action: 'notes/create',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['title'],
      detail: 'note created',
    });
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

  router.register('notes/save', async (payload, ctx) => {
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
    await auditUserAction(ctx, {
      action: 'notes/save',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['title', 'subtitle', 'editorDoc', 'plainText'],
      detail: 'note content saved',
    });
    return { note };
  });

  router.register('notes/archive', async (payload, ctx) => {
    const p = asObject(payload, 'notes/archive');
    const note = await archiveNote(await repo(), asId(p['noteId'], 'noteId'));
    await auditUserAction(ctx, {
      action: 'notes/archive',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['state'],
      detail: 'note archived',
    });
    return { note };
  });

  router.register('notes/restore', async (payload, ctx) => {
    const p = asObject(payload, 'notes/restore');
    const note = await restoreNote(await repo(), asId(p['noteId'], 'noteId'));
    await auditUserAction(ctx, {
      action: 'notes/restore',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['state'],
      detail: 'note restored',
    });
    return { note };
  });

  router.register('notes/trash', async (payload, ctx) => {
    const p = asObject(payload, 'notes/trash');
    const note = await trashNote(await repo(), asId(p['noteId'], 'noteId'));
    await auditUserAction(ctx, {
      action: 'notes/trash',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['state'],
      detail: 'note moved to trash (recoverable)',
    });
    return { note };
  });

  router.register('notes/delete-permanently', async (payload, ctx) => {
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
    await auditUserAction(ctx, {
      action: 'notes/delete-permanently',
      targetId: noteId,
      outcome: 'succeeded',
      changedFields: ['*'],
      detail: 'note permanently deleted after explicit confirmation',
    });
    return { deleted: true, noteId };
  });

  router.register('notes/duplicate', async (payload, ctx) => {
    const p = asObject(payload, 'notes/duplicate');
    const note = await duplicateNote(await repo(), asId(p['noteId'], 'noteId'));
    await indexNote(note);
    await auditUserAction(ctx, {
      action: 'notes/duplicate',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['title'],
      detail: 'note duplicated',
    });
    return { note };
  });

  router.register('notes/set-flags', async (payload, ctx) => {
    const p = asObject(payload, 'notes/set-flags');
    const changed: string[] = [];
    if (p['pinned'] !== undefined) changed.push('pinned');
    if (p['favorite'] !== undefined) changed.push('favorite');
    const note = await setFlags(await repo(), asId(p['noteId'], 'noteId'), {
      pinned: asOptionalBoolean(p['pinned'], 'pinned'),
      favorite: asOptionalBoolean(p['favorite'], 'favorite'),
    });
    await auditUserAction(ctx, {
      action: 'notes/set-flags',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: changed,
      detail: 'pin/favorite flags updated',
    });
    return { note };
  });

  router.register('notes/restore-revision', async (payload, ctx) => {
    const p = asObject(payload, 'notes/restore-revision');
    const note = await restoreRevision(await repo(), {
      noteId: asId(p['noteId'], 'noteId'),
      revisionId: asId(p['revisionId'], 'revisionId'),
      expectedRevisionId: asOptionalId(p['expectedRevisionId'], 'expectedRevisionId') ?? null,
    });
    await indexNote(note);
    await auditUserAction(ctx, {
      action: 'notes/restore-revision',
      targetId: note.id,
      outcome: 'succeeded',
      changedFields: ['editorDoc', 'title', 'subtitle'],
      detail: 'revision restored as new revision',
    });
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
    const context = await repo();
    const [note, related] = await Promise.all([
      getNoteOrFail(context, noteId),
      relatedFor(context, noteId),
    ]);
    return { note, ...related };
  });

  /** Bulk variant for card grids: one round trip per results page. */
  router.register('notes/related-bulk', async (payload) => {
    const p = asObject(payload, 'notes/related-bulk');
    const noteIds = asIdArray(p['noteIds'], 'noteIds', { max: 200 });
    const context = await repo();
    const related: Record<string, RelatedInfo> = {};
    for (const noteId of noteIds) {
      related[noteId] = await relatedFor(context, noteId);
    }
    return { related };
  });

  /** Per-state counts for navigation and the trash guard (FR-NOTE-03). */
  router.register('notes/counts', async () => {
    const notes = await listAllNotes(await repo());
    const counts = { active: 0, archived: 0, trashed: 0 };
    for (const note of notes) counts[note.state] += 1;
    return { counts };
  });
}
