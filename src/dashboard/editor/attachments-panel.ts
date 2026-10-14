/**
 * Attachments panel (T-019, PRD §4.4 "file attachments, with filename/type/
 * size shown and local download/open actions"): a collapsible region inside
 * the editor session. All binary traffic goes through the attachment API;
 * downloads/open use object URLs created in the dashboard context (the
 * chrome.downloads API is deliberately not requested). Every failure is
 * surfaced truthfully — never a silent no-op.
 */

import type { Attachment, EntityId } from '../../core/types';
import { createPanelHeader } from './panel-header';

/** Human-readable byte sizes (storage reporting uses the same scale). */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentsPanelCallbacks {
  listAttachments(noteId: EntityId): Promise<readonly Attachment[]>;
  getBlob(attachmentId: EntityId): Promise<Blob | null>;
  rename(attachmentId: EntityId, filename: string): Promise<boolean>;
  remove(attachmentId: EntityId): Promise<boolean>;
  attachFiles(files: readonly File[]): Promise<readonly { ok: boolean; message: string }[]>;
  announce(message: string): void;
  /** T-085 (UX-01): the panel's own Close control. */
  onClose(): void;
}

export interface AttachmentsPanel {
  readonly element: HTMLElement;
  /** Refresh the list from storage; keeps the toggle count in sync. */
  refresh(): Promise<void>;
  dispose(): void;
}

const OPENABLE_PREFIXES: readonly string[] = [
  'image/',
  'text/',
  'application/pdf',
  'application/json',
  'audio/',
  'video/',
];

function isProbablyOpenable(mimeType: string): boolean {
  return OPENABLE_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function createAttachmentsPanel(
  noteId: EntityId,
  callbacks: AttachmentsPanelCallbacks,
): AttachmentsPanel {
  const element = document.createElement('section');
  element.className = 'attachments-panel';
  element.setAttribute('aria-label', 'Note attachments');

  // T-085 (UX-01): the bar itself carries its Close control — the toggle
  // button above the editor is no longer the only way to dismiss it.
  const header = createPanelHeader({
    title: 'Attachments',
    titleClassName: 'attachments-panel__heading',
    countClassName: 'attachments-panel__count',
    closeAriaLabel: 'Close attachments',
    onClose: () => callbacks.onClose(),
  });

  const listbox = document.createElement('ul');
  listbox.className = 'attachments-panel__list';
  listbox.setAttribute('role', 'list');

  const empty = document.createElement('p');
  empty.className = 'attachments-panel__empty';
  empty.textContent = 'No attachments yet. Attach images or files with the button below, or paste/drop them into the note.';

  const status = document.createElement('p');
  status.className = 'attachments-panel__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const attachButton = document.createElement('button');
  attachButton.type = 'button';
  attachButton.className = 'btn';
  attachButton.textContent = 'Attach files…';
  // T-063: the button finally does what its label promises — it opens the
  // adjacent (visible) file input. It previously had no handler at all, so
  // the input was the only working control.
  attachButton.addEventListener('click', () => fileInput.click());
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.className = 'dialog__file';
  fileInput.setAttribute('aria-label', 'Files to attach');
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) return;
    void (async () => {
      const outcomes = await callbacks.attachFiles(files);
      const failures = outcomes.filter((outcome) => !outcome.ok);
      if (failures.length > 0) {
        setStatus(failures.map((failure) => failure.message).join(' '), true);
      } else {
        setStatus(`Attached ${files.length} file${files.length === 1 ? '' : 's'}.`, false);
      }
      fileInput.value = '';
      await refresh();
    })();
  });

  const toolbarRow = document.createElement('div');
  toolbarRow.className = 'attachments-panel__toolbar';
  toolbarRow.append(attachButton, fileInput);

  element.append(header.row, status, listbox, empty, toolbarRow);

  function setStatus(message: string, isError: boolean): void {
    status.textContent = message;
    status.hidden = message.length === 0;
    status.classList.toggle('attachments-panel__status--error', isError);
  }

  /* --------------------------- Row actions -------------------------- */

  const downloadAttachment = async (attachment: Attachment): Promise<void> => {
    const blob = await callbacks.getBlob(attachment.id).catch(() => null);
    if (!blob) {
      setStatus(
        `Downloading ${attachment.filename} failed: the stored content could not be read.`,
        true,
      );
      return;
    }
    triggerAnchorDownload(attachment.filename, blob, 'download');
    setStatus(`Downloading ${attachment.filename} (${formatByteSize(attachment.size)}).`, false);
  };

  const openAttachment = async (attachment: Attachment): Promise<void> => {
    const blob = await callbacks.getBlob(attachment.id).catch(() => null);
    if (!blob) {
      setStatus(`Opening ${attachment.filename} failed: the stored content could not be read.`, true);
      return;
    }
    triggerAnchorDownload(attachment.filename, blob, 'open');
    setStatus(`Opening ${attachment.filename}…`, false);
  };

  /**
   * Anchor-driven download/open via object URLs in the dashboard context
   * (chrome.downloads is not requested; PRD §8.2 narrowest permissions).
   */
  function triggerAnchorDownload(filename: string, blob: Blob, mode: 'download' | 'open'): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    if (mode === 'download') {
      anchor.download = filename;
    } else {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser the click before releasing the object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  const confirmDelete = (attachment: Attachment, onConfirmed: () => void): void => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--confirm';
    const heading = document.createElement('h2');
    heading.textContent = 'Delete attachment?';
    const body = document.createElement('p');
    body.textContent = `This removes ${attachment.filename} (${attachment.mimeType}, ${formatByteSize(attachment.size)}) from this note. The file content stays in local storage only while another note references identical content.`;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn--danger';
    confirmButton.textContent = 'Delete attachment';
    confirmButton.addEventListener('click', () => {
      dialog.close();
      onConfirmed();
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => dialog.close());
    actions.append(cancelButton, confirmButton);
    dialog.append(heading, body, actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  };

  const promptRename = (attachment: Attachment): void => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Rename attachment';
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'Filename';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.value = attachment.filename;
    field.append(input);
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = 'Rename';
    save.addEventListener('click', () => {
      const filename = input.value.trim();
      if (filename.length === 0) {
        input.focus();
        return;
      }
      void (async () => {
        const ok = await callbacks.rename(attachment.id, filename);
        if (ok) {
          setStatus(`Renamed to ${filename}.`, false);
          dialog.close();
          await refresh();
        } else {
          setStatus('Renaming failed.', true);
        }
      })();
    });
    actions.append(cancel, save);
    dialog.append(heading, field, actions);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  };

  /* ----------------------------- Listing ---------------------------- */

  const rowFor = (attachment: Attachment): HTMLElement => {
    const row = document.createElement('li');
    row.className = 'attachments-panel__row';
    row.dataset.attachmentId = attachment.id;

    const icon = document.createElement('span');
    icon.className = 'attachments-panel__icon';
    icon.textContent = attachment.mimeType.startsWith('image/')
      ? 'IMG'
      : attachment.mimeType === 'application/pdf'
        ? 'PDF'
        : attachment.mimeType.startsWith('text/')
          ? 'TXT'
          : 'BIN';
    icon.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'attachments-panel__name';
    name.textContent = attachment.filename;

    const meta = document.createElement('span');
    meta.className = 'attachments-panel__meta';
    meta.textContent = `${attachment.mimeType} · ${formatByteSize(attachment.size)}`;

    const actions = document.createElement('div');
    actions.className = 'attachments-panel__actions';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'btn btn--ghost';
    downloadButton.textContent = 'Download';
    downloadButton.setAttribute('aria-label', `Download ${attachment.filename}`);
    downloadButton.addEventListener('click', () => void downloadAttachment(attachment));

    actions.append(downloadButton);
    if (isProbablyOpenable(attachment.mimeType)) {
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'btn btn--ghost';
      openButton.textContent = 'Open';
      openButton.setAttribute('aria-label', `Open ${attachment.filename}`);
      openButton.addEventListener('click', () => void openAttachment(attachment));
      actions.append(openButton);
    }

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'btn btn--ghost';
    renameButton.textContent = 'Rename';
    renameButton.setAttribute('aria-label', `Rename ${attachment.filename}`);
    renameButton.addEventListener('click', () => promptRename(attachment));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--ghost btn--danger';
    deleteButton.textContent = 'Delete…';
    deleteButton.setAttribute('aria-label', `Delete ${attachment.filename}`);
    deleteButton.addEventListener('click', () => {
      confirmDelete(attachment, () => {
        void (async () => {
          const ok = await callbacks.remove(attachment.id);
          setStatus(
            ok ? `Deleted ${attachment.filename}.` : `Deleting ${attachment.filename} failed.`,
            !ok,
          );
          await refresh();
        })();
      });
    });
    actions.append(renameButton, deleteButton);

    row.append(icon, name, meta, actions);
    return row;
  };

  async function refresh(): Promise<void> {
    let attachments: readonly Attachment[];
    try {
      attachments = await callbacks.listAttachments(noteId);
    } catch (error) {
      setStatus(
        `Listing attachments failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        true,
      );
      return;
    }
    listbox.replaceChildren(...attachments.map(rowFor));
    empty.hidden = attachments.length > 0;
    header.count.textContent =
      attachments.length === 0 ? '' : `${attachments.length} file${attachments.length === 1 ? '' : 's'}`;
  }

  void refresh();

  return {
    element,
    refresh,
    dispose(): void {
      element.remove();
    },
  };
}
