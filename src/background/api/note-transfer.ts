/**
 * Note-level file transfer (FR-DATA-05): portable JSON export of one note
 * with its relationships. Markdown/HTML file export and file import run in
 * the DASHBOARD where DOMPurify/turndown can operate; the background stores
 * only validated structures. Nothing is uploaded — the blob goes to a
 * user-initiated download.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { auditUserAction } from '../observability';
import { getNote, NoteNotFoundError } from '../../core/repo/notes';
import { listNoteTags } from '../../core/repo/tags';
import { listNoteCategories } from '../../core/repo/categories';
import { listNoteReminders } from '../../core/repo/reminders';
import { listNoteSnapshots } from '../../core/repo/snapshots';
import { asId, asObject } from './validate';

export interface NoteExportFile {
  readonly format: 'lnwa-note';
  readonly version: 1;
  readonly exportedAt: string;
  readonly note: Record<string, unknown>;
  readonly tags: string[];
  readonly categories: string[];
  readonly reminders: unknown[];
  readonly links: { url: string; captureState: string }[];
  readonly snapshots: {
    id: string;
    title: string;
    capturedAt: string;
    status: string;
    warnings: number;
  }[];
}

export function registerNoteTransferApi(router: MessageRouter): void {
  router.register('notes/export-file', async (payload, ctx) => {
    const p = asObject(payload, 'notes/export-file');
    const noteId = asId(p['noteId'], 'noteId');
    const repoCtx = await repo();
    const note = await getNote(repoCtx, noteId);
    if (!note) throw new NoteNotFoundError(noteId);

    const [tags, categories, reminders, snapshots] = await Promise.all([
      listNoteTags(repoCtx, noteId),
      listNoteCategories(repoCtx, noteId),
      listNoteReminders(repoCtx, noteId),
      listNoteSnapshots(repoCtx, noteId),
    ]);

    // Links for the note: read the links store by the noteId index.
    const links = await repoCtx
      .getByIndex<{ noteId: string; originalUrl: string; captureState: string }>('links', 'noteId', noteId)
      .catch(() => [] as { noteId: string; originalUrl: string; captureState: string }[]);

    const file: NoteExportFile = {
      format: 'lnwa-note',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: {
        id: note.id,
        title: note.title,
        subtitle: note.subtitle,
        editorDoc: note.editorDoc,
        plainText: note.plainText,
        state: note.state,
        pinned: note.pinned,
        favorite: note.favorite,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      },
      tags: tags.map((tag) => tag.name),
      categories: categories.map((category) => category.name),
      reminders: reminders.map((reminder) => ({
        dueAt: reminder.dueAt,
        recurrence: reminder.recurrence,
        timeZone: reminder.timeZone,
        state: reminder.state,
      })),
      links: links.map((link) => ({ url: link.originalUrl, captureState: link.captureState })),
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        title: snapshot.title,
        capturedAt: snapshot.capturedAt,
        status: snapshot.status,
        warnings: snapshot.warnings.length,
      })),
    };

    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const safeTitle = (note.title.trim() || 'untitled-note').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 60).trim();
    await auditUserAction({
      action: 'notes/export-file',
      targetKind: 'note',
      targetId: note.id,
      outcome: 'succeeded',
      detail:
        `exported note as lnwa-note JSON (${tags.length} tag(s), ${categories.length} categor(y/ies), ` +
        `${snapshots.length} snapshot(s))`,
      correlationId: ctx.correlationId,
    });
    return { blob, filename: `${safeTitle}.json` };
  });
}
