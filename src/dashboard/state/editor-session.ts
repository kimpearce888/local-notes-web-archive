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
import { createSnapshotsPanel, type SnapshotsPanel } from '../editor/snapshots-panel';
import { createRemindersPanel, type RemindersPanel } from '../editor/reminders-panel';
import { createAiPanel, type AiPanel } from '../ai/ai-panel';
import { confirmDialog } from '../views/bulk-bar';
import { icon } from '../views/icons';
import {
  noteMarkdownExport,
  noteHtmlExport,
  exportFileStem,
} from '../editor/note-transfer';
import type { AiApi } from './ai-client';
import type { AgentTurnResult } from '../../background/ai/agent';
import { attachmentIdFromSrc } from '../editor/local-image';
import { convertHeicToJpeg, looksLikeHeic } from '../editor/heic-image';
import { editorDocToPlainText } from '../../core/repo/notes';
import { detectHttpUrlsInText } from '../../core/util/urls';
import type {
  Attachment,
  EntityId,
  Note,
  RecurrenceRule,
  Reminder,
  Revision,
  Snapshot,
  TimeZoneName,
  UtcTimestamp,
} from '../../core/types';
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

/** Snapshot operations the session needs (T-026, backed by the RPC client). */
export interface SnapshotsApi {
  listForNote(noteId: EntityId): Promise<readonly Snapshot[]>;
  getPng(snapshotId: EntityId): Promise<Blob | null>;
  exportArtifact(
    snapshotId: EntityId,
    format: 'mhtml' | 'png' | 'text',
  ): Promise<{ blob: Blob; filename: string }>;
  rename(snapshotId: EntityId, title: string): Promise<boolean>;
  remove(snapshotId: EntityId): Promise<boolean>;
}

/** Reminder operations the session needs (T-027, RPC-backed). */
export interface RemindersApi {
  listForNote(noteId: EntityId): Promise<readonly Reminder[]>;
  create(input: {
    noteId: EntityId;
    dueAt: UtcTimestamp | null;
    recurrence: RecurrenceRule | null;
    timeZone: TimeZoneName;
  }): Promise<Reminder>;
  updateRule(
    reminderId: EntityId,
    patch: {
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      timeZone?: TimeZoneName;
    },
  ): Promise<Reminder>;
  complete(reminderId: EntityId): Promise<boolean>;
  dismiss(reminderId: EntityId): Promise<boolean>;
  stop(reminderId: EntityId): Promise<boolean>;
  snooze(reminderId: EntityId, until: UtcTimestamp): Promise<boolean>;
  remove(reminderId: EntityId): Promise<boolean>;
}

/** Note file transfer (T-035, FR-DATA-05): JSON export via the RPC. */
export interface TransferApi {
  exportFile(noteId: EntityId): Promise<{ blob: Blob; filename: string }>;
}

/** AI assistant operations the session needs (T-031, RPC-backed). */
export interface SessionAiApi extends AiApi {
  chat(input: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    approvedToolCallIds?: string[];
  }): Promise<AgentTurnResult>;
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
  /**
   * The "Back to notes" action: routed through the CONTROLLER's close flow
   * (flush + teardown + return to list view) when provided — the session
   * never closes itself in production, so the results view can never be
   * left hidden behind the editor. Falls back to a bare session close in
   * isolated tests that have no controller.
   */
  onRequestClose?(): void;
  /**
   * Pin/unpin the open note from the editor (T-054, notes/set-flags).
   * Optional: isolated tests without a controller can omit it; the session
   * then hides the pin action.
   */
  setPinned?(noteId: EntityId, pinned: boolean): Promise<boolean>;
  /**
   * Favorite/unfavorite the open note from the editor (T-064, audit D-01,
   * notes/set-flags). Mirrors setPinned; optional for the same reason.
   */
  setFavorite?(noteId: EntityId, favorite: boolean): Promise<boolean>;
  /**
   * Move the open note to trash from the editor (T-054, notes/trash).
   * Called after pending autosave edits are flushed; the session closes
   * back to the list afterwards. Optional for the same reason as setPinned.
   */
  trashNote?(noteId: EntityId): Promise<boolean>;
  /** Attachment pipeline (T-019). */
  attachments: AttachmentApi;
  /** Snapshot management (T-026, FR-CAP-06/07/08). */
  snapshots: SnapshotsApi;
  /** Reminder management (T-027, FR-REM-01..03). */
  reminders: RemindersApi;
  /** AI assistant (T-031, FR-AI-04/07). */
  ai: SessionAiApi;
  /** Note file export (T-035, FR-DATA-05). */
  transfer: TransferApi;
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
  /** Toolbar group visibility from settings (FR-SET-01). */
  toolbarGroups?: Record<string, boolean>;
}): Promise<EditorSession> {
  const { mount, note, callbacks } = options;
  const presentConflict = options.conflictPresenter ?? presentConflictDialog;
  const noteId = note.id;
  const attachmentApi = callbacks.attachments;
  const snapshotsApi = callbacks.snapshots;
  const remindersApi = callbacks.reminders;
  const aiApi = callbacks.ai;
  const transferApi = callbacks.transfer;

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
    { ok: true; src: string; deduplicated: boolean; detail?: string } | { ok: false; message: string }
  > => {
    // T-086 (UX-07): every local-image path (dialog picker, drag-and-drop,
    // clipboard paste) funnels through here — HEIC/HEIF photos are decoded
    // locally to displayable JPEG BEFORE storage. Chrome cannot render HEIC
    // inline in any version, so inserting the original would show a broken
    // image; the converted JPEG keeps the photo visible AND stores cleanly.
    let stored = file;
    let detail: string | undefined;
    if (looksLikeHeic(file)) {
      const conversion = await convertHeicToJpeg(file);
      if (conversion.ok) {
        stored = conversion.file;
        detail = '(converted from HEIC to JPEG for display)';
      } else {
        // Honest degradation: the photo cannot be shown inline, but it is
        // still preserved as a downloadable file attachment.
        const fallback = await attachFile(file);
        void refreshAttachmentCount();
        if ('message' in fallback) return { ok: false, message: fallback.message };
        return {
          ok: false,
          message: `${conversion.message} The original file was attached to this note instead — open or download it from the attachments panel.`,
        };
      }
    }
    const outcome = await attachFile(stored);
    if ('message' in outcome) return { ok: false, message: outcome.message };
    void refreshAttachmentCount();
    if (!outcome.attachment.mimeType.startsWith('image/')) {
      // Truthful outcome: the bytes were stored, but they are not an image —
      // keep them as a file attachment instead of inserting a broken node.
      return {
        ok: false,
        message: `${stored.name} was verified as ${outcome.attachment.mimeType} and was attached as a file instead.`,
      };
    }
    return {
      ok: true,
      src: `attachment:${outcome.attachment.id}`,
      deduplicated: outcome.deduplicated,
      detail,
    };
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

  /* ------------------- Panel dismissal (T-085) ---------------------- */

  // Every popped-out bar registers its teardown here; Escape closes the
  // most recently opened one (which is also the visually topmost bar —
  // panels insert directly under the header). Native modal <dialog>s own
  // Escape while any of them is open, so the stack stays inert then.
  const panelClosers: Array<() => void> = [];
  const registerPanelCloser = (close: () => void): (() => void) => {
    const wrapped = (): void => {
      const index = panelClosers.indexOf(wrapped);
      if (index !== -1) panelClosers.splice(index, 1);
      close();
    };
    panelClosers.push(wrapped);
    return () => {
      const index = panelClosers.indexOf(wrapped);
      if (index !== -1) panelClosers.splice(index, 1);
    };
  };
  const onSessionKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (document.querySelector('dialog[open]') !== null) return;
    const top = panelClosers[panelClosers.length - 1];
    if (top === undefined) return;
    event.preventDefault();
    top();
  };
  container.addEventListener('keydown', onSessionKeyDown);

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
      toolbarGroups: options.toolbarGroups,
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
  let unregisterRevisionCloser: (() => void) | null = null;

  /** T-085 (UX-09): Close parity — the panel's button AND Escape both land here. */
  function closeRevisions(): void {
    if (!revisionElement) return;
    revisionElement.remove();
    revisionElement = null;
    unregisterRevisionCloser?.();
    unregisterRevisionCloser = null;
  }

  const toggleRevisions = async (): Promise<void> => {
    if (revisionElement) {
      closeRevisions();
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
      onClose: closeRevisions,
    });
    revisionElement = panelElement.element;
    unregisterRevisionCloser = registerPanelCloser(closeRevisions);
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
  let unregisterAttachmentsCloser: (() => void) | null = null;
  let attachmentsCount = 0;
  let attachmentsCountLoaded = false;

  const attachmentsButton = document.createElement('button');
  attachmentsButton.type = 'button';
  attachmentsButton.className = 'btn';
  attachmentsButton.setAttribute('aria-expanded', 'false');
  attachmentsButton.textContent = 'Attachments';
  attachmentsButton.addEventListener('click', () => void toggleAttachments());

  /** T-085 (UX-01): one teardown for the in-surface Close button, Escape and the toggle. */
  function closeAttachments(): void {
    if (!attachmentsElement) return;
    attachmentsPanelInstance?.dispose();
    attachmentsElement.remove();
    attachmentsElement = null;
    attachmentsPanelInstance = null;
    attachmentsButton.setAttribute('aria-expanded', 'false');
    unregisterAttachmentsCloser?.();
    unregisterAttachmentsCloser = null;
  }

  async function toggleAttachments(): Promise<void> {
    if (attachmentsElement) {
      closeAttachments();
      return;
    }
    attachmentsPanelInstance = createAttachmentsPanel(noteId, {
      listAttachments: (id) => attachmentApi.list(id),
      getBlob: (id) => attachmentApi.getBlob(id),
      rename: (id, filename) => attachmentApi.rename(id, filename),
      remove: (id) => attachmentApi.remove(id),
      attachFiles,
      announce: (message) => callbacks.announce(message),
      onClose: closeAttachments,
    });
    attachmentsElement = attachmentsPanelInstance.element;
    // Listed under the header, above the editor, mirroring the revision panel.
    container.insertBefore(attachmentsElement, header.nextSibling);
    attachmentsButton.setAttribute('aria-expanded', 'true');
    unregisterAttachmentsCloser = registerPanelCloser(closeAttachments);
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

  /* ------------------------- Snapshots panel ------------------------ */

  let snapshotsElement: HTMLElement | null = null;
  let snapshotsPanelInstance: SnapshotsPanel | null = null;
  let unregisterSnapshotsCloser: (() => void) | null = null;

  const snapshotsButton = document.createElement('button');
  snapshotsButton.type = 'button';
  snapshotsButton.className = 'btn';
  snapshotsButton.setAttribute('aria-expanded', 'false');
  snapshotsButton.textContent = 'Snapshots';
  snapshotsButton.addEventListener('click', () => void toggleSnapshots());

  /** T-085 (UX-02): one teardown for the in-surface Close button, Escape and the toggle. */
  function closeSnapshots(): void {
    if (!snapshotsElement) return;
    snapshotsPanelInstance?.dispose();
    snapshotsElement.remove();
    snapshotsElement = null;
    snapshotsPanelInstance = null;
    snapshotsButton.setAttribute('aria-expanded', 'false');
    unregisterSnapshotsCloser?.();
    unregisterSnapshotsCloser = null;
  }

  async function toggleSnapshots(): Promise<void> {
    if (snapshotsElement) {
      closeSnapshots();
      return;
    }
    snapshotsPanelInstance = createSnapshotsPanel(noteId, {
      listForNote: (id) => snapshotsApi.listForNote(id),
      getPng: (id) => snapshotsApi.getPng(id),
      exportArtifact: (id, format) => snapshotsApi.exportArtifact(id, format),
      rename: (id, title) => snapshotsApi.rename(id, title),
      remove: (id) => snapshotsApi.remove(id),
      announce: (message) => callbacks.announce(message),
      onClose: closeSnapshots,
    });
    snapshotsElement = snapshotsPanelInstance.element;
    container.insertBefore(snapshotsElement, header.nextSibling);
    snapshotsButton.setAttribute('aria-expanded', 'true');
    unregisterSnapshotsCloser = registerPanelCloser(closeSnapshots);
    await snapshotsPanelInstance.refresh();
    await updateSnapshotCount();
  }

  async function updateSnapshotCount(): Promise<void> {
    try {
      const snapshots = await snapshotsApi.listForNote(noteId);
      snapshotsButton.textContent =
        snapshots.length > 0 ? `Snapshots (${snapshots.length})` : 'Snapshots';
    } catch {
      snapshotsButton.textContent = 'Snapshots';
    }
  }

  void updateSnapshotCount();

  /* ------------------------- Reminders panel ------------------------ */

  let remindersElement: HTMLElement | null = null;
  let remindersPanelInstance: RemindersPanel | null = null;
  let unregisterRemindersCloser: (() => void) | null = null;

  const remindersButton = document.createElement('button');
  remindersButton.type = 'button';
  remindersButton.className = 'btn';
  remindersButton.setAttribute('aria-expanded', 'false');
  remindersButton.textContent = 'Reminders';
  remindersButton.addEventListener('click', () => void toggleReminders());

  /** T-085 (UX-03): one teardown for the in-surface Close button, Escape and the toggle. */
  function closeReminders(): void {
    if (!remindersElement) return;
    remindersPanelInstance?.dispose();
    remindersElement.remove();
    remindersElement = null;
    remindersPanelInstance = null;
    remindersButton.setAttribute('aria-expanded', 'false');
    unregisterRemindersCloser?.();
    unregisterRemindersCloser = null;
  }

  async function toggleReminders(): Promise<void> {
    if (remindersElement) {
      closeReminders();
      return;
    }
    remindersPanelInstance = createRemindersPanel(noteId, {
      listForNote: (id) => remindersApi.listForNote(id),
      create: (input) => remindersApi.create(input),
      updateRule: (id, patch) => remindersApi.updateRule(id, patch),
      complete: (id) => remindersApi.complete(id),
      dismiss: (id) => remindersApi.dismiss(id),
      stop: (id) => remindersApi.stop(id),
      snooze: (id, until) => remindersApi.snooze(id, until),
      remove: (id) => remindersApi.remove(id),
      announce: (message) => callbacks.announce(message),
      onClose: closeReminders,
    });
    remindersElement = remindersPanelInstance.element;
    container.insertBefore(remindersElement, header.nextSibling);
    remindersButton.setAttribute('aria-expanded', 'true');
    unregisterRemindersCloser = registerPanelCloser(closeReminders);
    await remindersPanelInstance.refresh();
    await updateReminderCount();
  }

  async function updateReminderCount(): Promise<void> {
    try {
      const reminders = await remindersApi.listForNote(noteId);
      remindersButton.textContent =
        reminders.length > 0 ? `Reminders (${reminders.length})` : 'Reminders';
    } catch {
      remindersButton.textContent = 'Reminders';
    }
  }

  void updateReminderCount();

  /* --------------------------- File menu ----------------------------- */

  const fileButton = document.createElement('button');
  fileButton.type = 'button';
  fileButton.className = 'btn';
  fileButton.textContent = 'File';
  fileButton.addEventListener('click', () => openFileMenu());

  function triggerFileDownload(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function openFileMenu(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Export this note';
    const body = document.createElement('p');
    body.textContent = 'Note-level files download to your computer. Nothing is uploaded.';
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';

    const addOption = (label: string, run: () => void): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = label;
      button.addEventListener('click', () => {
        dialog.close();
        run();
      });
      actions.append(button);
    };

    addOption('Note file (JSON)', () => {
      void (async () => {
        try {
          const { blob, filename } = await transferApi.exportFile(noteId);
          triggerFileDownload(filename, blob);
          callbacks.announce(`Exported ${filename}.`);
        } catch (error) {
          callbacks.announce(
            `Exporting the note failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      })();
    });
    addOption('Markdown (.md)', () => {
      
      const blob = new Blob(
        [noteMarkdownExport(panel.getTitle(), panel.getSubtitle(), panel.editor.getHTML())],
        { type: 'text/markdown' },
      );
      triggerFileDownload(`${exportFileStem(panel.getTitle())}.md`, blob);
      callbacks.announce(`Exported ${exportFileStem(panel.getTitle())}.md.`);
    });
    addOption('Sanitized HTML (.html)', () => {
      
      const blob = new Blob(
        [noteHtmlExport(panel.getTitle(), panel.getSubtitle(), panel.editor.getHTML())],
        { type: 'text/html' },
      );
      triggerFileDownload(`${exportFileStem(panel.getTitle())}.html`, blob);
      callbacks.announce(`Exported ${exportFileStem(panel.getTitle())}.html.`);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--primary';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(cancel);

    dialog.append(heading, body, actions);
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
  }

  /* ---------------------------- AI panel ----------------------------- */

  let aiElement: HTMLElement | null = null;
  let aiPanelInstance: AiPanel | null = null;
  let unregisterAiCloser: (() => void) | null = null;

  const aiButton = document.createElement('button');
  aiButton.type = 'button';
  aiButton.className = 'btn';
  aiButton.setAttribute('aria-expanded', 'false');
  aiButton.textContent = 'AI';
  aiButton.addEventListener('click', () => void toggleAi());

  /** T-085 (UX-04): one teardown for the in-surface Close button, Escape and the toggle. */
  function closeAi(): void {
    if (!aiElement) return;
    aiPanelInstance?.dispose();
    aiElement.remove();
    aiElement = null;
    aiPanelInstance = null;
    aiButton.setAttribute('aria-expanded', 'false');
    unregisterAiCloser?.();
    unregisterAiCloser = null;
  }

  async function toggleAi(): Promise<void> {
    if (aiElement) {
      closeAi();
      return;
    }
    aiPanelInstance = createAiPanel(
      {
        chat: (input) => aiApi.chat(input),
        isEnabled: () => aiApi.isEnabled(),
        announce: (message) => callbacks.announce(message),
        onClose: closeAi,
      },
      noteId,
    );
    aiElement = aiPanelInstance.element;
    container.insertBefore(aiElement, header.nextSibling);
    aiButton.setAttribute('aria-expanded', 'true');
    unregisterAiCloser = registerPanelCloser(closeAi);
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'btn';
  closeButton.textContent = 'Back to notes';
  // Route through the controller when wired: it owns the flush + teardown
  // + the return-to-list view switch. Closing directly (the fallback)
  // would leave the results region hidden (found by the T-042 E2E suite).
  closeButton.addEventListener('click', () => {
    if (callbacks.onRequestClose) callbacks.onRequestClose();
    else void session.close();
  });

  /* -------------------- Pin / trash from the editor (T-054) ---------- */

  /**
   * Pin/unpin the note being edited (notes/set-flags through the
   * controller). The label mirrors the live state; failures announce
   * honestly instead of pretending the flag changed.
   */
  const pinButton = document.createElement('button');
  pinButton.type = 'button';
  pinButton.className = 'btn';
  pinButton.textContent = current.pinned ? 'Unpin' : 'Pin';
  if (!callbacks.setPinned) pinButton.hidden = true;

  async function togglePinned(): Promise<void> {
    if (!callbacks.setPinned || pinButton.disabled) return;
    const target = !current.pinned;
    pinButton.disabled = true;
    try {
      const ok = await callbacks.setPinned(noteId, target);
      if (ok) {
        current = { ...current, pinned: target };
        pinButton.textContent = target ? 'Unpin' : 'Pin';
        callbacks.announce(target ? 'Note pinned.' : 'Note unpinned.');
      } else {
        callbacks.announce('Updating the pin failed — please try again.');
      }
    } catch (error) {
      callbacks.announce(
        `Updating the pin failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      pinButton.disabled = false;
    }
  }
  pinButton.addEventListener('click', () => void togglePinned());

  /**
   * Favorite/unfavorite the note being edited (T-064, audit D-01): the
   * same live-label + honest-failure pattern as the pin button above —
   * before this existed the favorite flag had NO human UI anywhere, so
   * the Favorites smart list could never populate.
   */
  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'btn';
  favoriteButton.textContent = current.favorite ? 'Unfavorite' : 'Favorite';
  if (!callbacks.setFavorite) favoriteButton.hidden = true;

  async function toggleFavorite(): Promise<void> {
    if (!callbacks.setFavorite || favoriteButton.disabled) return;
    const target = !current.favorite;
    favoriteButton.disabled = true;
    try {
      const ok = await callbacks.setFavorite(noteId, target);
      if (ok) {
        current = { ...current, favorite: target };
        favoriteButton.textContent = target ? 'Unfavorite' : 'Favorite';
        callbacks.announce(target ? 'Note favorited.' : 'Note unfavorited.');
      } else {
        callbacks.announce('Updating the favorite failed — please try again.');
      }
    } catch (error) {
      callbacks.announce(
        `Updating the favorite failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      favoriteButton.disabled = false;
    }
  }
  favoriteButton.addEventListener('click', () => void toggleFavorite());

  /**
   * Move the note being edited to trash (notes/trash through the
   * controller). Pending edits are flushed FIRST so the trashed note keeps
   * its newest content; the confirmed destructive action then closes the
   * editor through the controller's close flow, which re-queries the list
   * so the note honestly disappears from it (and shows up in Trash).
   */
  const trashButton = document.createElement('button');
  trashButton.type = 'button';
  trashButton.className = 'btn btn--danger';
  trashButton.textContent = 'Move to trash…';
  if (!callbacks.trashNote) trashButton.hidden = true;

  async function trashFromEditor(): Promise<void> {
    if (!callbacks.trashNote || trashButton.disabled) return;
    const confirmed = await confirmDialog(
      'Move this note to trash?',
      'The note moves to trash with its current content and stays recoverable until permanently deleted.',
      'Move to trash',
    );
    if (!confirmed) return;
    trashButton.disabled = true;
    try {
      // Keep the newest edits: flush BEFORE the note changes state.
      await autosave.flush();
    } catch {
      // The flush's own failure path already surfaced a save state; the
      // last durable revision is what will be trashed.
    }
    try {
      const ok = await callbacks.trashNote(noteId);
      if (!ok) {
        trashButton.disabled = false;
        callbacks.announce('Moving the note to trash failed — please try again.');
        return;
      }
      callbacks.announce('Note moved to trash.');
      if (callbacks.onRequestClose) callbacks.onRequestClose();
      else void session.close();
    } catch (error) {
      trashButton.disabled = false;
      callbacks.announce(
        `Moving the note to trash failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
  trashButton.addEventListener('click', () => void trashFromEditor());

  /* -------------------- Redesigned header (T-057) ------------------- */
  /* Three decorative groups — primary (Back), panel toggles, note
     actions — purely visual. Every button keeps its accessible name and
     the .editor-session__header button queries used by the tests are
     unchanged (group wrappers are not buttons; icons carry no text). */

  const giveIcon = (button: HTMLButtonElement, name: Parameters<typeof icon>[0]): void => {
    button.prepend(icon(name));
  };
  giveIcon(closeButton, 'arrow-left');
  giveIcon(revisionsButton, 'clock');
  giveIcon(attachmentsButton, 'note');
  giveIcon(snapshotsButton, 'archive');
  giveIcon(remindersButton, 'alarm');
  giveIcon(aiButton, 'command');
  giveIcon(fileButton, 'import');
  giveIcon(pinButton, 'pin');
  giveIcon(favoriteButton, 'star');
  giveIcon(trashButton, 'trash');

  const header = document.createElement('div');
  header.className = 'editor-session__header';

  const headerPrimary = document.createElement('div');
  headerPrimary.className = 'editor-session__header-group editor-session__header-group--primary';
  headerPrimary.append(closeButton);

  const headerPanels = document.createElement('div');
  headerPanels.className = 'editor-session__header-group editor-session__header-group--panels';
  headerPanels.append(revisionsButton, attachmentsButton, snapshotsButton, remindersButton, aiButton, fileButton);

  const headerActions = document.createElement('div');
  headerActions.className = 'editor-session__header-group editor-session__header-group--actions';
  headerActions.append(pinButton, favoriteButton, trashButton);

  header.append(headerPrimary, headerPanels, headerActions);
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
      container.removeEventListener('keydown', onSessionKeyDown);
      panelClosers.length = 0;
      if (revisionElement) revisionElement.remove();
      attachmentsPanelInstance?.dispose();
      attachmentsElement = null;
      attachmentsPanelInstance = null;
      snapshotsPanelInstance?.dispose();
      snapshotsElement = null;
      snapshotsPanelInstance = null;
      remindersPanelInstance?.dispose();
      remindersElement = null;
      remindersPanelInstance = null;
      aiPanelInstance?.dispose();
      aiElement = null;
      aiPanelInstance = null;
      revokeObjectUrls();
      container.remove();
    },
  };

  return session;
}
