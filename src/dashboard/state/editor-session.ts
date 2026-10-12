/**
 * Editor session (T-018): owns the editor screen for one note — panel,
 * debounced autosave with visible state, crash-journal recovery, revision
 * history, the multi-tab conflict flow and the attachments pipeline (T-019:
 * image insert/paste/drop, file attachments, object-URL resolver). The
 * session never lies about durability: the save indicator reflects the
 * controller's save flow.
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
import { createAttachmentsPanel, type AttachmentsPanel } from '../editor/attachments-panel';
import { attachmentIdFromSrc } from '../editor/local-image';
import { editorDocToPlainText } from '../../core/repo/notes';
import { detectHttpUrlsInText } from '../../core/util/urls';
import type { Attachment, EntityId, Note, Revision } from '../../core/types';
import type { RpcErrorCode } from '../../background/protocol';

export type SaveOutcome = { ok: true; note: Note } | { ok: false; code: RpcErrorCode };

/** Attachment operations the session needs (backed by the RPC client). */
export interface AttachmentApi {
  add(input: {
    noteId: EntityId;
    filename: string;
    declaredMimeType: string;
    data: Blob;
  }): Promise<{ attachment: Attachment; deduplicated: boolean }>;
  list(noteId: EntityId): Promise<readonly Attachment[]>;
  getBlob(attachmentId: EntityId): Promise<Blob | null>;
  rename(attachmentId: EntityId, filename: string): Promise<boolean>;
  remove(attachmentId: EntityId): Promise<boolean>;
}

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
  /** Attachment pipeline (T-019). */
  attachments: AttachmentApi;
  /** URL detection policy call (T-020, FR-CAP-01). Returns null on failure. */
  detectLinks(input: {
    noteId: EntityId;
    urls: readonly string[];
    source: 'paste' | 'manual';
  }): Promise<{ created: number; queued: number; existing: number; rejected: number } | null>;
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
  const attachmentApi = callbacks.attachments;

  let current = note;
  let lastRecoveryWrite = 0;

  /* --------------------- Recovery offer on open -------------------- */

  const recoverable = readRecoveryEntry(noteId, note.updatedAt);
  const initialDoc = recoverable ? recoverable.editorDoc : note.editorDoc;
  const initialTitle = recoverable ? recoverable.title : note.title;
  const initialSubtitle = recoverable ? recoverable.subtitle : note.subtitle;

  /* --------------- Object-URL resolver for image refs -------------- */

  // Session-scoped cache: one object URL per attachment id, revoked when
  // the session closes. The saved document only ever holds the durable
  // `attachment:<uuid>` reference — never a session-limited blob: URL.
  const objectUrls = new Map<string, string>();
  const resolveImageSrc = async (src: string): Promise<string | null> => {
    const id = attachmentIdFromSrc(src);
    if (id === null) return null;
    const cached = objectUrls.get(id);
    if (cached) return cached;
    try {
      const blob = await attachmentApi.getBlob(id as EntityId);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      objectUrls.set(id, url);
      return url;
    } catch {
      return null;
    }
  };
  const revokeObjectUrls = (): void => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  };

  /* ----------------------- Attachment flows ------------------------ */

  const attachFile = async (
    file: File,
  ): Promise<{ attachment: Attachment; deduplicated: boolean } | { message: string }> => {
    try {
      return await attachmentApi.add({
        noteId,
        filename: file.name,
        declaredMimeType: file.type.length > 0 ? file.type : 'application/octet-stream',
        data: file,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'storing the file in local storage failed';
      return { message };
    }
  };

  const onAttachImage = async (
    file: File,
  ): Promise<
    { ok: true; src: string; deduplicated: boolean } | { ok: false; message: string }
  > => {
    const outcome = await attachFile(file);
    if ('message' in outcome) return { ok: false, message: outcome.message };
    void refreshAttachmentCount();
    if (!outcome.attachment.mimeType.startsWith('image/')) {
      // Truthful outcome: the bytes were stored, but they are not an image —
      // keep them as a file attachment instead of inserting a broken node.
      return {
        ok: false,
        message: `${file.name} was verified as ${outcome.attachment.mimeType} and was attached as a file instead.`,
      };
    }
    return { ok: true, src: `attachment:${outcome.attachment.id}`, deduplicated: outcome.deduplicated };
  };

  const onAttachFile = async (
    file: File,
  ): Promise<
    { ok: true; filename: string; deduplicated: boolean } | { ok: false; message: string }
  > => {
    const outcome = await attachFile(file);
    if ('message' in outcome) return { ok: false, message: outcome.message };
    void refreshAttachmentCount();
    return {
      ok: true,
      filename: outcome.attachment.filename,
      deduplicated: outcome.deduplicated,
    };
  };

  const attachFiles = async (
    files: readonly File[],
  ): Promise<readonly { ok: boolean; message: string }[]> => {
    const outcomes: { ok: boolean; message: string }[] = [];
    for (const file of files) {
      const outcome = await onAttachFile(file);
      outcomes.push(
        outcome.ok
          ? { ok: true, message: `Attached ${outcome.filename}.` }
          : { ok: false, message: outcome.message },
      );
    }
    return outcomes;
  };

  /* --------------------- URL detection (T-020) --------------------- */

  const detectAndQueue = async (
    urls: readonly string[],
    source: 'paste' | 'manual',
  ): Promise<void> => {
    if (urls.length === 0) return;
    const summary = await callbacks.detectLinks({ noteId, urls, source }).catch(() => null);
    if (!summary) {
      if (source === 'paste') {
        callbacks.announce('Link detection failed — the URL was still pasted as text.');
      }
      return;
    }
    if (source === 'paste' && summary.queued > 0) {
      callbacks.announce(
        `Link saved — ${summary.queued} capture${summary.queued === 1 ? '' : 's'} queued.`,
      );
    } else if (source === 'paste' && summary.rejected === urls.length) {
      callbacks.announce('No capturable http(s) link found in the pasted text.');
    }
  };

  const onPastedText = (text: string): void => {
    void detectAndQueue(detectHttpUrlsInText(text), 'paste');
  };

  /**
   * Typed URLs are detected after a successful save — never auto-visited.
   * The scan covers the title and the full plain-text projection, so URLs
   * that were typed without becoming link marks are still detected.
   */
  const syncDetectedLinks = async (snapshot: {
    title: string;
    plainText: string;
  }): Promise<void> => {
    const urls = [
      ...detectHttpUrlsInText(snapshot.title),
      ...detectHttpUrlsInText(snapshot.plainText),
    ];
    if (urls.length === 0) return;
    const unique = [...new Set(urls)].slice(0, 50);
    await detectAndQueue(unique, 'manual');
  };

  /* --------------------------- Editor ------------------------------ */

  const container = document.createElement('div');
  container.className = 'editor-session';

  const panel: EditorPanel = createEditorPanel(
    container,
    {
      onChange: () => autosave.schedule(),
      onOpenLink: callbacks.onOpenLink,
      onAttachImage: (file) => onAttachImage(file),
      onAttachFile: (file) => onAttachFile(file),
      onNotify: (message) => callbacks.announce(message),
      onPastedText,
    },
    {
      initial: { title: initialTitle, subtitle: initialSubtitle, editorDoc: initialDoc },
      resolveImageSrc,
    },
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
        // Typed URLs (title/body) are detected post-save (FR-CAP-01: never
        // auto-visited); failures never disturb the save outcome.
        void syncDetectedLinks(snapshot).catch(() => undefined);
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
          if (panel.editor.isDestroyed) return; // session closed mid-restore
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
          if (panel.editor.isDestroyed) return; // session closed mid-conflict
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

  /* -------------------- Attachments region (T-019) ------------------ */

  let attachmentsElement: HTMLElement | null = null;
  let attachmentsPanelInstance: AttachmentsPanel | null = null;
  let attachmentsCount = 0;
  let attachmentsCountLoaded = false;

  const attachmentsButton = document.createElement('button');
  attachmentsButton.type = 'button';
  attachmentsButton.className = 'btn';
  attachmentsButton.setAttribute('aria-expanded', 'false');
  attachmentsButton.textContent = 'Attachments';
  attachmentsButton.addEventListener('click', () => void toggleAttachments());

  async function toggleAttachments(): Promise<void> {
    if (attachmentsElement) {
      attachmentsPanelInstance?.dispose();
      attachmentsElement.remove();
      attachmentsElement = null;
      attachmentsPanelInstance = null;
      attachmentsButton.setAttribute('aria-expanded', 'false');
      return;
    }
    attachmentsPanelInstance = createAttachmentsPanel(noteId, {
      listAttachments: (id) => attachmentApi.list(id),
      getBlob: (id) => attachmentApi.getBlob(id),
      rename: (id, filename) => attachmentApi.rename(id, filename),
      remove: (id) => attachmentApi.remove(id),
      attachFiles,
      announce: (message) => callbacks.announce(message),
    });
    attachmentsElement = attachmentsPanelInstance.element;
    // Listed under the header, above the editor, mirroring the revision panel.
    container.insertBefore(attachmentsElement, header.nextSibling);
    attachmentsButton.setAttribute('aria-expanded', 'true');
    await attachmentsPanelInstance.refresh();
    await updateAttachmentCount();
  }

  async function updateAttachmentCount(): Promise<void> {
    try {
      const attachments = await attachmentApi.list(noteId);
      attachmentsCount = attachments.length;
      attachmentsCountLoaded = true;
    } catch {
      // Honest label when storage cannot be reached; the panel shows detail.
      attachmentsCountLoaded = false;
    }
    attachmentsButton.textContent =
      attachmentsCountLoaded && attachmentsCount > 0
        ? `Attachments (${attachmentsCount})`
        : 'Attachments';
  }

  /** Called after add/delete so the toggle reflects reality immediately. */
  async function refreshAttachmentCount(): Promise<void> {
    await updateAttachmentCount();
    if (attachmentsPanelInstance) await attachmentsPanelInstance.refresh();
  }

  void updateAttachmentCount();

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn';
  closeButton.textContent = 'Back to notes';
  closeButton.addEventListener('click', () => void session.close());

  const header = document.createElement('div');
  header.className = 'editor-session__header';
  header.append(closeButton, revisionsButton, attachmentsButton);
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
      attachmentsPanelInstance?.dispose();
      attachmentsElement = null;
      attachmentsPanelInstance = null;
      revokeObjectUrls();
      container.remove();
    },
  };

  return session;
}
