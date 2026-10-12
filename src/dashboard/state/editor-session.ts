/**
 * Editor session (T-018): owns the editor screen for one note — panel,
 * debounced autosave with visible state, crash-journal recovery, revision
 * history and the multi-tab conflict flow. The session never lies about
 * durability: the save indicator reflects the controller's save flow.
 */

import { createEditorPanel, type EditorPanel } from '../editor/editor-panel';
import { createAutosave, type AutosaveManager } from '../editor/autosave';
import {
  clearRecoveryEntry,
  readRecoveryEntry,
  writeRecoveryEntry,
  type RecoveryEntry,
} from '../editor/recovery';
import {
  createRevisionPanel,
  presentConflictDialog,
  type ConflictChoice,
  type ConflictSnapshot,
} from '../editor/revisions';
import { editorDocToPlainText } from '../../core/repo/notes';
import type { EntityId, Note, Revision } from '../../core/types';
import type { RpcErrorCode } from '../../background/protocol';

export type SaveOutcome = { ok: true; note: Note } | { ok: false; code: RpcErrorCode };

export interface EditorSessionCallbacks {
  /** Revision listing (FR-NOTE-06). */
  getRevisions(noteId: EntityId): Promise<readonly Revision[]>;
  /** Persist through the controller's conflict-aware save flow. */
  saveNoteDetailed(input: {
    noteId: EntityId;
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
    expectedRevisionId: EntityId | null;
    changeSummary: string;
  }): Promise<SaveOutcome>;
  /** Fetch the newest revision head (for conflict reload). */
  getNote(noteId: EntityId): Promise<Note>;
  /** Duplicate the note and save local content onto the copy. */
  duplicateWithContent(input: {
    sourceNoteId: EntityId;
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
  }): Promise<EntityId | null>;
  /** Announce state changes to screen readers. */
  announce(message: string): void;
  /** Safe external link opening. */
  onOpenLink(url: string): void;
}

export interface EditorSession {
  readonly element: HTMLElement;
  readonly noteId: EntityId;
  /** The live editor instance (typing drives autosave). */
  readonly editor: EditorPanel['editor'];
  /** Flushes pending autosave and tears down. */
  close(): Promise<void>;
}

const RECOVERY_THROTTLE_MS = 500;

export async function openEditorSession(options: {
  mount: HTMLElement;
  note: Note;
  callbacks: EditorSessionCallbacks;
  conflictPresenter?: (local: ConflictSnapshot, remote: ConflictSnapshot, choose: (choice: ConflictChoice) => void) => void;
}): Promise<EditorSession> {
  const { mount, note, callbacks } = options;
  const presentConflict = options.conflictPresenter ?? presentConflictDialog;
  const noteId = note.id;

  let current = note;
  let lastRecoveryWrite = 0;

  /* --------------------- Recovery offer on open -------------------- */

  const recoverable = readRecoveryEntry(noteId, note.updatedAt);
  const initialDoc = recoverable ? recoverable.editorDoc : note.editorDoc;
  const initialTitle = recoverable ? recoverable.title : note.title;
  const initialSubtitle = recoverable ? recoverable.subtitle : note.subtitle;

  /* --------------------------- Editor ------------------------------ */

  const container = document.createElement('div');
  container.className = 'editor-session';

  const panel: EditorPanel = createEditorPanel(
    container,
    {
      onChange: () => autosave.schedule(),
      onOpenLink: callbacks.onOpenLink,
    },
    { initial: { title: initialTitle, subtitle: initialSubtitle, editorDoc: initialDoc } },
  );

  /* -------------------------- Autosave ----------------------------- */

  const autosave: AutosaveManager = createAutosave({
    snapshot: () => ({
      title: panel.getTitle(),
      subtitle: panel.getSubtitle(),
      editorDoc: panel.getDocument(),
      plainText: panel.getPlainText(),
    }),
    save: async (snapshot) => {
      const outcome = await callbacks.saveNoteDetailed({
        noteId,
        title: snapshot.title,
        subtitle: snapshot.subtitle,
        editorDoc: snapshot.editorDoc,
        plainText: snapshot.plainText,
        expectedRevisionId: current.revisionId,
        changeSummary: 'autosave',
      });
      if (outcome.ok) {
        current = outcome.note;
        clearRecoveryEntry(noteId);
        panel.markSaved();
        return outcome.note;
      }
      if (outcome.code === 'conflict') void handleConflict();
      return null;
    },
  });

  // Crash journal: throttled, independent of the save cadence, so an
  // unexpected failure never costs more than the throttle window.
  panel.editor.on('update', () => {
    const now = Date.now();
    if (now - lastRecoveryWrite < RECOVERY_THROTTLE_MS) return;
    lastRecoveryWrite = now;
    const entry: RecoveryEntry = {
      noteId,
      title: panel.getTitle(),
      subtitle: panel.getSubtitle(),
      editorDoc: panel.getDocument(),
      plainText: panel.getPlainText(),
      at: new Date(now).toISOString() as RecoveryEntry['at'],
    };
    writeRecoveryEntry(entry);
  });

  if (recoverable) {
    autosave.schedule(); // persist the recovered edit promptly
    callbacks.announce('Recovered your most recent unsaved edit for this note.');
  }

  /* ------------------------ Revisions view -------------------------- */

  let revisionElement: HTMLElement | null = null;
  const toggleRevisions = async (): Promise<void> => {
    if (revisionElement) {
      revisionElement.remove();
      revisionElement = null;
      return;
    }
    const revisions = await callbacks.getRevisions(noteId);
    const panelElement = createRevisionPanel(revisions, {
      onRestore: (revision) => {
        void (async () => {
          const outcome = await callbacks.saveNoteDetailed({
            noteId,
            title: revision.metadataSnapshot.title,
            subtitle: revision.metadataSnapshot.subtitle,
            editorDoc: revision.editorDoc,
            plainText: editorDocToPlainText(revision.editorDoc),
            expectedRevisionId: current.revisionId,
            changeSummary: 'revision restore',
          });
          if (outcome.ok) {
            current = outcome.note;
            panel.editor.commands.setContent(revision.editorDoc ?? { type: 'doc', content: [] });
            (container.querySelector('.editor-panel__title') as HTMLInputElement).value =
              revision.metadataSnapshot.title;
            (container.querySelector('.editor-panel__subtitle') as HTMLInputElement).value =
              revision.metadataSnapshot.subtitle;
            callbacks.announce('Revision restored as a new revision.');
            clearRecoveryEntry(noteId);
          } else {
            callbacks.announce('Restoring the revision failed. Your current text is unchanged.');
          }
        })();
      },
      onClose: () => {
        if (revisionElement) {
          revisionElement.remove();
          revisionElement = null;
        }
      },
    });
    revisionElement = panelElement.element;
    container.prepend(revisionElement);
  };

  /* ---------------------- Conflict handling ------------------------- */

  async function handleConflict(): Promise<void> {
    const fresh = await callbacks.getNote(noteId).catch(() => null);
    if (!fresh) {
      callbacks.announce('Save failed and the newer version could not be loaded.');
      return;
    }
    presentConflict(
      {
        title: panel.getTitle(),
        plainText: panel.getPlainText(),
        updatedAt: new Date().toISOString(),
      },
      {
        title: fresh.title,
        plainText: fresh.plainText,
        updatedAt: fresh.updatedAt,
      },
      (choice: ConflictChoice) => {
        void (async () => {
          if (choice === 'reload') {
            current = fresh;
            panel.editor.commands.setContent(fresh.editorDoc ?? { type: 'doc', content: [] });
            (container.querySelector('.editor-panel__title') as HTMLInputElement).value =
              fresh.title;
            (container.querySelector('.editor-panel__subtitle') as HTMLInputElement).value =
              fresh.subtitle;
            clearRecoveryEntry(noteId);
            autosave.schedule();
            callbacks.announce('Reloaded the newer version.');
          } else if (choice === 'duplicate') {
            const duplicateId = await callbacks.duplicateWithContent({
              sourceNoteId: noteId,
              title: panel.getTitle(),
              subtitle: panel.getSubtitle(),
              editorDoc: panel.getDocument(),
              plainText: panel.getPlainText(),
            });
            callbacks.announce(
              duplicateId
                ? 'Your version was saved as a new note.'
                : 'Saving a duplicate failed.',
            );
          }
          // 'compare' keeps both versions visible; the user continues editing.
        })();
      },
    );
  }

  /* ------------------------ Session chrome -------------------------- */

  const revisionsButton = document.createElement('button');
  revisionsButton.type = 'button';
  revisionsButton.className = 'btn';
  revisionsButton.textContent = 'Revision history';
  revisionsButton.addEventListener('click', () => void toggleRevisions());

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn';
  closeButton.textContent = 'Back to notes';
  closeButton.addEventListener('click', () => void session.close());

  const header = document.createElement('div');
  header.className = 'editor-session__header';
  header.append(closeButton, revisionsButton);
  container.prepend(header);
  mount.append(container);

  const session: EditorSession = {
    element: container,
    noteId,
    editor: panel.editor,
    async close(): Promise<void> {
      await autosave.flush();
      autosave.dispose();
      panel.dispose();
      if (revisionElement) revisionElement.remove();
      container.remove();
    },
  };

  return session;
}
