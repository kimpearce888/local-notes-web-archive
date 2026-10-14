/**
 * Snapshots panel (T-026, FR-CAP-06/07/08): a collapsible region inside the
 * editor session listing every capture of the note's links — per-artifact
 * states, warnings, preview, rename, delete, compare and USER-INITIATED
 * exports.
 *
 * FR-CAP-06 is a hard rule here: the stored MHTML archive is NEVER rendered
 * or injected into the dashboard. In-app preview shows the saved PNG and
 * the extracted text only, and says so; the full archive leaves storage
 * exclusively through an explicit export download.
 */

import type { CaptureArtifactState, CaptureStatus, EntityId, Snapshot } from '../../core/types';
import { formatByteSize } from './attachments-panel';
import { createPanelHeader } from './panel-header';

/** Human labels for the per-artifact capture states (FR-CAP-07). */
export const ARTIFACT_STATE_LABELS: Readonly<Record<CaptureArtifactState, string>> = {
  pending: 'pending',
  saved: 'saved',
  failed: 'failed',
  canceled: 'canceled',
  'not-attempted': 'not attempted',
};

/** Status → presentational class (never color-only: text carries the state). */
export function statusClass(status: CaptureStatus): string {
  if (status === 'complete') return 'snapshot-status--complete';
  if (status === 'partial') return 'snapshot-status--partial';
  if (status === 'failed') return 'snapshot-status--failed';
  return 'snapshot-status--other';
}

export function statusLabel(status: CaptureStatus): string {
  return status === 'permission-required' ? 'permission required' : status;
}

/** One-line artifact summary, e.g. "Page copy saved · Screenshot saved · Text saved" (T-088, UX-12: no raw MHTML jargon). */
export function artifactSummary(snapshot: Snapshot): string {
  return [
    `Page copy ${ARTIFACT_STATE_LABELS[snapshot.mhtml]}`,
    `Screenshot ${ARTIFACT_STATE_LABELS[snapshot.png]}`,
    `Text ${ARTIFACT_STATE_LABELS[snapshot.text]}`,
  ].join(' · ');
}

export interface SnapshotsPanelCallbacks {
  listForNote(noteId: EntityId): Promise<readonly Snapshot[]>;
  /** Saved PNG bytes for preview (FR-CAP-06); null when not saved. */
  getPng(snapshotId: EntityId): Promise<Blob | null>;
  /** User-initiated export of one artifact (FR-CAP-06). */
  exportArtifact(
    snapshotId: EntityId,
    format: 'mhtml' | 'png' | 'text',
  ): Promise<{ blob: Blob; filename: string }>;
  rename(snapshotId: EntityId, title: string): Promise<boolean>;
  remove(snapshotId: EntityId): Promise<boolean>;
  announce(message: string): void;
  /** T-085 (UX-02): the panel's own Close control. */
  onClose(): void;
}

export interface SnapshotsPanel {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  dispose(): void;
}

export function createSnapshotsPanel(
  noteId: EntityId,
  callbacks: SnapshotsPanelCallbacks,
): SnapshotsPanel {
  const element = document.createElement('section');
  element.className = 'snapshots-panel';
  element.setAttribute('aria-label', 'Captured snapshots');

  // T-085 (UX-02): in-surface Close control (see panel-header.ts).
  const header = createPanelHeader({
    title: 'Snapshots',
    titleClassName: 'snapshots-panel__heading',
    countClassName: 'snapshots-panel__count',
    closeAriaLabel: 'Close snapshots',
    onClose: () => callbacks.onClose(),
  });

  const listbox = document.createElement('ul');
  listbox.className = 'snapshots-panel__list';
  listbox.setAttribute('role', 'list');

  const empty = document.createElement('p');
  empty.className = 'snapshots-panel__empty';
  empty.textContent =
    'No snapshots yet. Save a web page — the "Save a web page…" button on the left, or right-click a page in Chrome and choose "Save page as note" — and its archived copy, text and screenshot appear here.';

  const status = document.createElement('p');
  status.className = 'snapshots-panel__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  element.append(header.row, status, listbox, empty);

  function setStatus(message: string, isError: boolean): void {
    status.textContent = message;
    status.hidden = message.length === 0;
    status.classList.toggle('snapshots-panel__status--error', isError);
  }

  /* ------------------------- Object URLs ---------------------------- */

  const objectUrls = new Set<string>();
  const trackObjectUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return url;
  };
  const releaseObjectUrls = (): void => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  };

  /* ---------------------- Open dialog registry ---------------------- */

  /** Dialogs this panel opened; dispose() closes them so a session teardown
   * never strands a modal over the dashboard. */
  const openDialogs = new Set<HTMLDialogElement>();
  const presentDialog = (dialog: HTMLDialogElement): void => {
    openDialogs.add(dialog);
    dialog.addEventListener('close', () => {
      openDialogs.delete(dialog);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  };
  const closeOpenDialogs = (): void => {
    for (const dialog of Array.from(openDialogs)) {
      // close() fires the listener above (remove + registry cleanup).
      dialog.close();
    }
  };

  function triggerAnchorDownload(filename: string, blob: Blob): void {
    const url = trackObjectUrl(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatus(`Downloading ${filename} (${formatByteSize(blob.size)}).`, false);
  }

  /* --------------------------- Exports ------------------------------ */

  const exportSnapshot = async (
    snapshot: Snapshot,
    format: 'mhtml' | 'png' | 'text',
  ): Promise<void> => {
    try {
      const { blob, filename } = await callbacks.exportArtifact(snapshot.id, format);
      triggerAnchorDownload(filename, blob);
      callbacks.announce(`Exporting ${filename}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      setStatus(`Exporting the ${format} artifact failed: ${message}`, true);
    }
  };

  /* --------------------------- Preview ------------------------------ */

  const previewSnapshot = async (snapshot: Snapshot): Promise<void> => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--preview';
    const headingElement = document.createElement('h2');
    headingElement.textContent = snapshot.title || 'Untitled snapshot';

    const meta = document.createElement('dl');
    meta.className = 'snapshot-preview__meta';
    const addMeta = (term: string, value: string): void => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      meta.append(dt, dd);
    };
    addMeta('Captured', snapshot.capturedAt.replace('T', ' ').slice(0, 19) + ' UTC');
    addMeta('Status', statusLabel(snapshot.status));
    addMeta('Artifacts', artifactSummary(snapshot));
    addMeta('Archive size', snapshot.mhtmlSize > 0 ? formatByteSize(snapshot.mhtmlSize) : 'not saved');
    if (snapshot.warnings.length > 0) {
      addMeta('Warnings', snapshot.warnings.map((w) => w.detail).join(' | '));
    }

    // FR-CAP-06: preview = PNG + extracted text. The MHTML archive itself is
    // never rendered here; the honest note says how to view it.
    const mhtmlNote = document.createElement('p');
    mhtmlNote.className = 'snapshot-preview__mhtml-note';
    mhtmlNote.textContent =
      'The offline preview shows the saved screenshot and extracted text. The complete saved copy of the page (an .mhtml file) is never opened inside the app — export it below and open the file in Chrome to browse the page exactly as it was saved.';

    const pngContainer = document.createElement('div');
    pngContainer.className = 'snapshot-preview__png';
    const pngHeading = document.createElement('h3');
    pngHeading.textContent = 'Screenshot';
    pngContainer.append(pngHeading);
    if (snapshot.png === 'saved') {
      const img = document.createElement('img');
      img.alt = `Full-page screenshot captured ${snapshot.capturedAt.slice(0, 10)}`;
      img.className = 'snapshot-preview__image';
      let url: string | null = null;
      try {
        const blob = await callbacks.getPng(snapshot.id);
        if (blob) {
          url = trackObjectUrl(blob);
          img.src = url;
          pngContainer.append(img);
        }
      } catch {
        // falls through to the placeholder below
      }
      if (url === null) {
        const missing = document.createElement('p');
        missing.textContent = 'The saved screenshot could not be loaded from storage.';
        pngContainer.append(missing);
      }
    } else {
      const missing = document.createElement('p');
      missing.textContent = `No screenshot in this snapshot (PNG ${ARTIFACT_STATE_LABELS[snapshot.png]}).`;
      pngContainer.append(missing);
    }

    const textContainer = document.createElement('div');
    textContainer.className = 'snapshot-preview__text';
    const textHeading = document.createElement('h3');
    textHeading.textContent = 'Extracted text';
    textContainer.append(textHeading);
    const textBlock = document.createElement('pre');
    textBlock.className = 'snapshot-preview__text-block';
    textBlock.textContent =
      snapshot.text === 'saved' && snapshot.extractedText.length > 0
        ? snapshot.extractedText
        : '(no extracted text in this snapshot)';
    textContainer.append(textBlock);

    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const exportMhtml = document.createElement('button');
    exportMhtml.type = 'button';
    exportMhtml.className = 'btn';
    exportMhtml.textContent = 'Export saved page…';
    exportMhtml.addEventListener('click', () => void exportSnapshot(snapshot, 'mhtml'));
    const exportPng = document.createElement('button');
    exportPng.type = 'button';
    exportPng.className = 'btn';
    exportPng.textContent = 'Export PNG…';
    exportPng.addEventListener('click', () => void exportSnapshot(snapshot, 'png'));
    if (snapshot.png !== 'saved') {
      exportPng.disabled = true;
      exportPng.title = 'The PNG artifact was not saved in this snapshot.';
    }
    const exportText = document.createElement('button');
    exportText.type = 'button';
    exportText.className = 'btn';
    exportText.textContent = 'Export text…';
    exportText.addEventListener('click', () => void exportSnapshot(snapshot, 'text'));
    if (snapshot.text !== 'saved') {
      exportText.disabled = true;
      exportText.title = 'No extracted text was saved in this snapshot.';
    }
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--primary';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => dialog.close());
    actions.append(exportMhtml, exportPng, exportText, closeButton);

    dialog.append(headingElement, meta, mhtmlNote, pngContainer, textContainer, actions);
    presentDialog(dialog);
  };

  /* --------------------------- Compare ------------------------------ */

  const compareSnapshots = (a: Snapshot, b: Snapshot): void => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--compare';
    const heading = document.createElement('h2');
    heading.textContent = 'Compare snapshots';

    const columns = document.createElement('div');
    columns.className = 'snapshot-compare__columns';

    const columnFor = (snapshot: Snapshot, label: string): HTMLElement => {
      const column = document.createElement('div');
      column.className = 'snapshot-compare__column';
      const title = document.createElement('h3');
      title.textContent = `${label}: ${snapshot.title || 'Untitled'}`;
      const meta = document.createElement('ul');
      meta.className = 'snapshot-compare__meta';
      const addRow = (text: string): void => {
        const li = document.createElement('li');
        li.textContent = text;
        meta.append(li);
      };
      addRow(`Captured ${snapshot.capturedAt.replace('T', ' ').slice(0, 19)} UTC`);
      addRow(`Status: ${statusLabel(snapshot.status)} (${artifactSummary(snapshot)})`);
      addRow(`Archive ${formatByteSize(snapshot.mhtmlSize)} · text ${snapshot.textSize} characters`);
      if (snapshot.warnings.length > 0) {
        addRow(`Warnings: ${snapshot.warnings.map((w) => w.detail).join(' | ')}`);
      }
      column.append(title, meta);

      if (snapshot.png === 'saved') {
        const img = document.createElement('img');
        img.alt = `Screenshot of the ${label} snapshot`;
        img.className = 'snapshot-compare__image';
        void callbacks
          .getPng(snapshot.id)
          .then((blob) => {
            if (blob && dialog.open) img.src = trackObjectUrl(blob);
          })
          .catch(() => undefined);
        column.append(img);
      }

      if (snapshot.text === 'saved' && snapshot.extractedText.length > 0) {
        const excerpt = document.createElement('p');
        excerpt.className = 'snapshot-compare__excerpt';
        const text = snapshot.extractedText.slice(0, 400);
        excerpt.textContent = text + (snapshot.extractedText.length > 400 ? '…' : '');
        column.append(excerpt);
      }
      return column;
    };

    // Oldest first so the visual reading order matches the timeline.
    columns.append(columnFor(a, 'Earlier'), columnFor(b, 'Later'));

    const closeRow = document.createElement('div');
    closeRow.className = 'dialog__actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--primary';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => dialog.close());
    closeRow.append(closeButton);

    dialog.append(heading, columns, closeRow);
    presentDialog(dialog);
  };

  /* ----------------------- Rename / delete -------------------------- */

  const promptRename = (snapshot: Snapshot): void => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Rename snapshot';
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'Title';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.value = snapshot.title;
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
      const title = input.value.trim();
      if (title.length === 0) {
        input.focus();
        return;
      }
      void (async () => {
        const ok = await callbacks.rename(snapshot.id, title);
        if (ok) {
          setStatus(`Renamed the snapshot to ${title}.`, false);
          dialog.close();
          await refresh();
        } else {
          setStatus('Renaming the snapshot failed.', true);
        }
      })();
    });
    actions.append(cancel, save);
    dialog.append(heading, field, actions);
    presentDialog(dialog);
    input.focus();
  };

  const confirmDelete = (snapshot: Snapshot, onConfirmed: () => void): void => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--confirm';
    const heading = document.createElement('h2');
    heading.textContent = 'Delete snapshot?';
    const body = document.createElement('p');
    body.textContent = `This deletes the capture from ${snapshot.capturedAt.slice(0, 10)} (archive ${formatByteSize(snapshot.mhtmlSize)}, ${snapshot.warnings.length} warning${snapshot.warnings.length === 1 ? '' : 's'}). When the same link has an earlier revision, the link falls back to it; otherwise the link keeps its URL without an archive.`;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn--danger';
    confirmButton.textContent = 'Delete snapshot';
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
    presentDialog(dialog);
  };

  /* ----------------------------- Rows ------------------------------- */

  let compareSelection: Snapshot | null = null;

  const rowFor = (snapshot: Snapshot): HTMLElement => {
    const row = document.createElement('li');
    row.className = 'snapshots-panel__row';
    row.dataset['snapshotId'] = snapshot.id;

    const statusChip = document.createElement('span');
    statusChip.className = `snapshot-status ${statusClass(snapshot.status)}`;
    statusChip.textContent = statusLabel(snapshot.status);

    const title = document.createElement('span');
    title.className = 'snapshots-panel__title';
    title.textContent = snapshot.title.trim().length > 0 ? snapshot.title : 'Untitled snapshot';

    const meta = document.createElement('span');
    meta.className = 'snapshots-panel__meta';
    meta.textContent = `${snapshot.capturedAt.slice(0, 10)} · ${artifactSummary(snapshot)}`;

    const warningsNote =
      snapshot.warnings.length > 0
        ? ` · ${snapshot.warnings.length} warning${snapshot.warnings.length === 1 ? '' : 's'}`
        : '';
    meta.textContent += warningsNote;

    const actions = document.createElement('div');
    actions.className = 'snapshots-panel__actions';

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'btn btn--ghost';
    previewButton.textContent = 'Preview';
    previewButton.setAttribute('aria-label', `Preview ${snapshot.title || 'snapshot'}`);
    previewButton.addEventListener('click', () => void previewSnapshot(snapshot));

    const compareButton = document.createElement('button');
    compareButton.type = 'button';
    compareButton.className = 'btn btn--ghost';
    compareButton.textContent = 'Compare…';
    compareButton.setAttribute('aria-label', `Compare ${snapshot.title || 'snapshot'} with another snapshot`);
    compareButton.addEventListener('click', () => {
      if (compareSelection === null) {
        compareSelection = snapshot;
        setStatus('Selected for comparison — choose Compare… on another snapshot of the same link.', false);
        return;
      }
      if (compareSelection.id === snapshot.id) {
        setStatus('Choose a DIFFERENT snapshot to compare against.', false);
        return;
      }
      const earlier = compareSelection.capturedAt <= snapshot.capturedAt ? compareSelection : snapshot;
      const later = earlier === compareSelection ? snapshot : compareSelection;
      compareSelection = null;
      compareSnapshots(earlier, later);
    });

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'btn btn--ghost';
    exportButton.textContent = 'Export saved page…';
    exportButton.setAttribute('aria-label', `Export the complete saved copy of ${snapshot.title || 'snapshot'}`);
    exportButton.addEventListener('click', () => void exportSnapshot(snapshot, 'mhtml'));
    if (snapshot.mhtml !== 'saved') {
      exportButton.disabled = true;
      exportButton.title = 'The complete saved copy of the page was not stored in this snapshot.';
    }

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'btn btn--ghost';
    renameButton.textContent = 'Rename';
    renameButton.addEventListener('click', () => promptRename(snapshot));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'btn btn--ghost btn--danger';
    deleteButton.textContent = 'Delete…';
    deleteButton.addEventListener('click', () => {
      confirmDelete(snapshot, () => {
        void (async () => {
          const ok = await callbacks.remove(snapshot.id);
          setStatus(
            ok ? 'Deleted the snapshot.' : 'Deleting the snapshot failed.',
            !ok,
          );
          compareSelection = null;
          await refresh();
        })();
      });
    });

    actions.append(previewButton, compareButton, exportButton, renameButton, deleteButton);
    row.append(statusChip, title, meta, actions);
    return row;
  };

  async function refresh(): Promise<void> {
    let snapshots: readonly Snapshot[];
    try {
      snapshots = await callbacks.listForNote(noteId);
    } catch (error) {
      setStatus(
        `Listing snapshots failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        true,
      );
      return;
    }
    compareSelection = null;
    listbox.replaceChildren(...snapshots.map(rowFor));
    empty.hidden = snapshots.length > 0;
    header.count.textContent =
      snapshots.length === 0
        ? ''
        : `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}`;
  }

  void refresh();

  return {
    element,
    refresh,
    dispose(): void {
      compareSelection = null;
      closeOpenDialogs();
      releaseObjectUrls();
      element.remove();
    },
  };
}
