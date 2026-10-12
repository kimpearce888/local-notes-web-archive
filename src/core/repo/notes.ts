import type {
  EntityId,
  Note,
  Revision,
  RevisionMetadataSnapshot,
} from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { Store } from '../db/schema';
import type { RepoContext } from './context';
import {
  DEFAULT_REVISION_RETENTION,
  listRevisions,
  pruneRevisions,
} from './revisions';

/**
 * Notes repository (FR-NOTE-01..08).
 *
 * Semantics enforced here:
 *  - `createdAt` is set once and never changes (FR-NOTE-03).
 *  - `updatedAt` bumps only after the transaction commits; failed writes
 *    throw and the caller must not report success (FR-NOTE-03).
 *  - Optimistic concurrency: saves pass `expectedRevisionId`; a mismatch
 *    throws NoteConflictError instead of silently overwriting (FR-NOTE-07).
 *  - Trash is a state, not a deletion; permanent deletion is an explicit,
 *    confirmed cascade (FR-NOTE-01/05).
 */

export class NoteConflictError extends Error {
  constructor(
    readonly noteId: EntityId,
    readonly storedRevisionId: EntityId | null,
    readonly expectedRevisionId: EntityId | null,
  ) {
    super('note was modified by another tab (edit conflict)');
    this.name = 'NoteConflictError';
  }
}

export class NoteNotFoundError extends Error {
  constructor(readonly noteId: EntityId) {
    super(`note ${noteId} not found`);
    this.name = 'NoteNotFoundError';
  }
}

export interface CreateNoteInput {
  readonly title?: string;
  readonly subtitle?: string;
  readonly editorDoc?: object | null;
  readonly plainText?: string;
  readonly pinned?: boolean;
  readonly favorite?: boolean;
}

export interface SaveNoteInput {
  readonly noteId: EntityId;
  readonly title: string;
  readonly subtitle: string;
  /** Full editor document. */
  readonly editorDoc: object | null;
  /** Derived plain-text projection, written in the same transaction (PRD §4.3). */
  readonly plainText: string;
  /** Revision the caller last saw; null only for notes never saved before. */
  readonly expectedRevisionId: EntityId | null;
  readonly changeSummary: string;
  readonly revisionRetention?: number;
  readonly metadataSnapshot?: RevisionMetadataSnapshot;
}

export async function createNote(ctx: RepoContext, input: CreateNoteInput): Promise<Note> {
  const now = nowUtc();
  const note: Note = {
    id: newId(),
    title: input.title ?? '',
    subtitle: input.subtitle ?? '',
    editorDoc: input.editorDoc ?? null,
    plainText: input.plainText ?? '',
    createdAt: now,
    updatedAt: now,
    state: 'active',
    pinned: input.pinned ?? false,
    favorite: input.favorite ?? false,
    trashedAt: null,
    archivedAt: null,
    revisionId: null,
    duplicatedFrom: null,
  };
  await ctx.transaction([Store.Notes], 'readwrite', (stores) => {
    stores[Store.Notes]?.put(note);
  });
  return note;
}

export async function getNote(ctx: RepoContext, id: EntityId): Promise<Note | null> {
  return ctx.get<Note>(Store.Notes, id);
}

export async function getNoteOrFail(ctx: RepoContext, id: EntityId): Promise<Note> {
  const note = await getNote(ctx, id);
  if (!note) throw new NoteNotFoundError(id);
  return note;
}

export async function listAllNotes(ctx: RepoContext): Promise<Note[]> {
  const notes = await ctx.getAll<Note>(Store.Notes);
  return notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Save a note: note record + new revision in one transaction; revision
 * pruning follows. Conflict is checked against the stored current revision.
 */
export async function saveNote(ctx: RepoContext, input: SaveNoteInput): Promise<Note> {
  let saved: Note | null = null;
  let conflict: NoteConflictError | null = null;
  let missing: NoteNotFoundError | null = null;

  await ctx.transaction([Store.Notes, Store.Revisions], 'readwrite', (stores) => {
    const noteStore = stores[Store.Notes];
    const revisionStore = stores[Store.Revisions];
    if (!noteStore || !revisionStore) throw new Error('stores unavailable');
    return new Promise<void>((resolve, reject) => {
      const getReq = noteStore.get(input.noteId);
      getReq.onsuccess = () => {
        const existing = getReq.result as Note | undefined;
        if (!existing) {
          missing = new NoteNotFoundError(input.noteId);
          reject(missing);
          return;
        }
        if (existing.revisionId !== input.expectedRevisionId) {
          conflict = new NoteConflictError(input.noteId, existing.revisionId, input.expectedRevisionId);
          reject(conflict);
          return;
        }
        const now = nowUtc();
        const revision: Revision = {
          id: newId(),
          noteId: input.noteId,
          editorDoc: input.editorDoc,
          metadataSnapshot:
            input.metadataSnapshot ??
            { title: input.title, subtitle: input.subtitle, tagIds: [], categoryId: [] },
          createdAt: now,
          summary: input.changeSummary,
        };
        const updated: Note = {
          ...existing,
          title: input.title,
          subtitle: input.subtitle,
          editorDoc: input.editorDoc,
          plainText: input.plainText,
          updatedAt: now,
          revisionId: revision.id,
        };
        revisionStore.put(revision);
        noteStore.put(updated);
        saved = updated;
        resolve();
      };
      getReq.onerror = () => reject(getReq.error ?? new Error('note read failed'));
    });
  });

  if (missing) throw missing;
  if (conflict) throw conflict;
  if (!saved) throw new Error('save produced no note (unexpected)');

  // Prune after commit; retention floor enforced inside pruneRevisions.
  const retention = input.revisionRetention ?? DEFAULT_REVISION_RETENTION;
  await pruneRevisions(ctx, input.noteId, retention);

  return saved;
}

/* ------------------------------------------------------------------ */
/* State transitions (FR-NOTE-05)                                      */
/* ------------------------------------------------------------------ */

async function transitionState(
  ctx: RepoContext,
  id: EntityId,
  to: Note['state'],
  timestampField: 'archivedAt' | 'trashedAt',
): Promise<Note> {
  let result: Note | null = null;
  await ctx.transaction([Store.Notes], 'readwrite', (stores) => {
    const store = stores[Store.Notes];
    if (!store) throw new Error('notes store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const note = req.result as Note | undefined;
        if (!note) {
          reject(new NoteNotFoundError(id));
          return;
        }
        const next: Note = {
          ...note,
          state: to,
          archivedAt: to === 'archived' ? nowUtc() : null,
          trashedAt: to === 'trashed' ? nowUtc() : null,
        };
        void timestampField;
        store.put(next);
        result = next;
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('note read failed'));
    });
  });
  if (!result) throw new NoteNotFoundError(id);
  return result;
}

export async function archiveNote(ctx: RepoContext, id: EntityId): Promise<Note> {
  return transitionState(ctx, id, 'archived', 'archivedAt');
}

export async function restoreNote(ctx: RepoContext, id: EntityId): Promise<Note> {
  // Restore from archive OR trash returns the note to active.
  return transitionState(ctx, id, 'active', 'archivedAt');
}

export async function trashNote(ctx: RepoContext, id: EntityId): Promise<Note> {
  return transitionState(ctx, id, 'trashed', 'trashedAt');
}

export async function setFlags(
  ctx: RepoContext,
  id: EntityId,
  flags: { pinned?: boolean; favorite?: boolean },
): Promise<Note> {
  let result: Note | null = null;
  await ctx.transaction([Store.Notes], 'readwrite', (stores) => {
    const store = stores[Store.Notes];
    if (!store) throw new Error('notes store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const note = req.result as Note | undefined;
        if (!note) {
          reject(new NoteNotFoundError(id));
          return;
        }
        const next: Note = {
          ...note,
          pinned: flags.pinned ?? note.pinned,
          favorite: flags.favorite ?? note.favorite,
          updatedAt: nowUtc(),
        };
        store.put(next);
        result = next;
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('note read failed'));
    });
  });
  if (!result) throw new NoteNotFoundError(id);
  return result;
}

/* ------------------------------------------------------------------ */
/* Duplicate (FR-NOTE-01)                                              */
/* ------------------------------------------------------------------ */

export async function duplicateNote(ctx: RepoContext, id: EntityId): Promise<Note> {
  const source = await getNoteOrFail(ctx, id);
  const now = nowUtc();
  const copy: Note = {
    ...source,
    id: newId(),
    title: source.title === '' ? 'Copy' : `${source.title} (copy)`,
    createdAt: now,
    updatedAt: now,
    state: 'active',
    trashedAt: null,
    archivedAt: null,
    revisionId: null,
    duplicatedFrom: source.id,
  };
  await ctx.transaction([Store.Notes], 'readwrite', (stores) => {
    stores[Store.Notes]?.put(copy);
  });
  return copy;
}

/* ------------------------------------------------------------------ */
/* Permanent deletion (FR-NOTE-01: explicit confirmation required)      */
/* ------------------------------------------------------------------ */

export interface PermanentDeleteInput {
  readonly noteId: EntityId;
  /** Must be literally true; the UI collects an explicit confirmation. */
  readonly confirm: boolean;
}

/**
 * Permanently delete a note and its owned records. The `confirm` flag is the
 * repo-level guard; UI confirmation flows feed it (FR-NOTE-01). Deletion is
 * a single transaction across stores.
 */
export async function permanentlyDeleteNote(
  ctx: RepoContext,
  input: PermanentDeleteInput,
): Promise<void> {
  if (input.confirm !== true) {
    throw new Error('permanent deletion requires explicit confirmation');
  }
  const storesNeeded = [
    Store.Notes,
    Store.Revisions,
    Store.NoteTags,
    Store.NoteCategories,
    Store.Links,
    Store.Reminders,
    Store.Attachments,
    Store.Blobs,
  ] as const;
  await ctx.transaction([...storesNeeded], 'readwrite', (stores) => {
    const notes = stores[Store.Notes];
    const revisions = stores[Store.Revisions];
    const noteTags = stores[Store.NoteTags];
    const noteCategories = stores[Store.NoteCategories];
    const links = stores[Store.Links];
    const reminders = stores[Store.Reminders];
    const attachments = stores[Store.Attachments];
    const blobs = stores[Store.Blobs];
    if (!notes || !revisions || !noteTags || !noteCategories || !links || !reminders || !attachments || !blobs) {
      throw new Error('stores unavailable for permanent deletion');
    }
    const noteId = input.noteId;
    notes.delete(noteId);

    const deleteByIndex = (store: IDBObjectStore, indexName: string): void => {
      const req = store.index(indexName).getAllKeys(noteId);
      req.onsuccess = () => {
        for (const key of req.result) store.delete(key);
      };
    };

    deleteByIndex(revisions, 'noteId');
    deleteByIndex(noteTags, 'noteId');
    deleteByIndex(noteCategories, 'noteId');
    deleteByIndex(reminders, 'noteId');
    deleteByIndex(links, 'noteId');

    // Attachments: delete rows and their blobs together.
    const attachmentReq = attachments.index('noteId').getAllKeys(noteId);
    attachmentReq.onsuccess = () => {
      for (const attachmentId of attachmentReq.result) {
        const getReq = attachments.get(attachmentId);
        getReq.onsuccess = () => {
          const attachment = getReq.result as { id: IDBValidKey; blobKey: string } | undefined;
          if (attachment) {
            attachments.delete(attachment.id);
            blobs.delete(attachment.blobKey);
          }
        };
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Revision restore (FR-NOTE-06)                                       */
/* ------------------------------------------------------------------ */

export interface RestoreRevisionInput {
  readonly noteId: EntityId;
  readonly revisionId: EntityId;
  /** Revision the caller last saw (conflict guard, FR-NOTE-07). */
  readonly expectedRevisionId: EntityId | null;
  readonly revisionRetention?: number;
}

/** Restore a revision; the restore itself is recorded as a new revision. */
export async function restoreRevision(
  ctx: RepoContext,
  input: RestoreRevisionInput,
): Promise<Note> {
  const revisions = await listRevisions(ctx, input.noteId);
  const target = revisions.find((r) => r.id === input.revisionId);
  if (!target) throw new NoteNotFoundError(input.noteId);
  return saveNote(ctx, {
    noteId: input.noteId,
    title: target.metadataSnapshot.title,
    subtitle: target.metadataSnapshot.subtitle,
    editorDoc: target.editorDoc,
    plainText: editorDocToPlainText(target.editorDoc),
    expectedRevisionId: input.expectedRevisionId,
    changeSummary: `restored revision from ${target.createdAt}`,
    revisionRetention: input.revisionRetention,
    metadataSnapshot: target.metadataSnapshot,
  });
}

/** Best-effort plain-text projection from a Tiptap document. */
export function editorDocToPlainText(doc: object | null): string {
  if (!doc) return '';
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record['type'] === 'string') {
      const type = record['type'];
      if (type === 'text' && typeof record['text'] === 'string') {
        parts.push(record['text']);
      }
      if (type === 'hardBreak' || type === 'horizontalRule') parts.push('\n');
      if (type === 'paragraph' || type === 'heading' || type === 'codeBlock' || type === 'listItem' || type === 'blockquote') {
        parts.push('\n');
      }
    }
    if (Array.isArray(record['content'])) {
      for (const child of record['content']) walk(child);
    }
  };
  walk(doc);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
