/**
 * Revision history panel (FR-NOTE-06) and the multi-tab conflict dialog
 * (FR-NOTE-07). The revision panel lists a note's bounded revision chain
 * with previews and restores through the conflict-guarded RPC. The
 * conflict dialog offers exactly the three PRD options: reload the newer
 * version, compare, or save your version as a duplicate.
 */

import type { Revision } from '../../core/types';
import { editorDocToPlainText } from '../../core/repo/notes';

export interface RevisionPanelCallbacks {
  onRestore(revision: Revision): void;
  onClose(): void;
}

export interface RevisionPanel {
  readonly element: HTMLElement;
}

function revisionPreview(revision: Revision): string {
  const text = editorDocToPlainText(revision.editorDoc).replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const slice = text.slice(0, 160);
  const lastSpace = slice.lastIndexOf(' ');
  return `${lastSpace > 96 ? slice.slice(0, lastSpace) : slice}…`;
}

export function createRevisionPanel(
  revisions: readonly Revision[],
  callbacks: RevisionPanelCallbacks,
): RevisionPanel {
  const element = document.createElement('section');
  element.className = 'revision-panel';
  element.setAttribute('aria-label', 'Revision history');

  const heading = document.createElement('h3');
  heading.textContent = 'Revision history';
  const hint = document.createElement('p');
  hint.className = 'revision-panel__hint';
  hint.textContent =
    'Restoring a revision records it as a new revision — history is never rewritten.';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost';
  close.textContent = 'Close';
  close.addEventListener('click', callbacks.onClose);

  const list = document.createElement('ul');
  list.className = 'revision-panel__list';
  if (revisions.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No revisions yet — revisions are created as you save.';
    list.append(empty);
  }
  for (const revision of revisions) {
    const item = document.createElement('li');
    item.className = 'revision-panel__item';
    const meta = document.createElement('p');
    meta.className = 'revision-panel__meta';
    meta.textContent = `${revision.createdAt.slice(0, 19).replace('T', ' ')} · ${
      revision.summary.trim().length > 0 ? revision.summary : 'autosave'
    }`;
    const preview = document.createElement('p');
    preview.className = 'revision-panel__preview';
    preview.textContent = revisionPreview(revision) || '(empty note)';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn';
    restore.textContent = 'Restore this revision';
    restore.setAttribute(
      'aria-label',
      `Restore revision from ${revision.createdAt.slice(0, 10)}`,
    );
    restore.addEventListener('click', () => callbacks.onRestore(revision));
    item.append(meta, preview, restore);
    list.append(item);
  }

  element.append(heading, hint, close, list);
  return { element };
}

/* ------------------------------------------------------------------ */
/* Conflict dialog (FR-NOTE-07)                                        */
/* ------------------------------------------------------------------ */

export type ConflictChoice = 'reload' | 'compare' | 'duplicate';

export interface ConflictSnapshot {
  readonly title: string;
  readonly plainText: string;
  readonly updatedAt: string;
}

/**
 * Presents the three PRD options. `present` is injectable so tests can
 * drive the flow without a live <dialog>; production uses a modal.
 */
export function presentConflictDialog(
  local: ConflictSnapshot,
  remote: ConflictSnapshot,
  choose: (choice: ConflictChoice) => void,
): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--confirm';
  const heading = document.createElement('h2');
  heading.textContent = 'This note changed in another tab';
  const body = document.createElement('p');
  body.textContent =
    'Your edit was not saved because the note was modified elsewhere. Choose how to continue — nothing is overwritten silently.';

  const localBox = document.createElement('div');
  localBox.className = 'conflict__side';
  const localTitle = document.createElement('h3');
  localTitle.textContent = 'Your version';
  const localText = document.createElement('p');
  localText.textContent = `${local.title} — ${local.plainText.slice(0, 300) || '(empty)'}`;
  localBox.append(localTitle, localText);

  const remoteBox = document.createElement('div');
  remoteBox.className = 'conflict__side';
  const remoteTitle = document.createElement('h3');
  remoteTitle.textContent = `Newer version (${remote.updatedAt.slice(0, 19).replace('T', ' ')})`;
  const remoteText = document.createElement('p');
  remoteText.textContent = `${remote.title} — ${remote.plainText.slice(0, 300) || '(empty)'}`;
  remoteBox.append(remoteTitle, remoteText);

  const actions = document.createElement('div');
  actions.className = 'dialog__actions';
  const addChoice = (label: string, description: string, choice: ConflictChoice): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = label;
    button.title = description;
    button.addEventListener('click', () => {
      dialog.close();
      choose(choice);
    });
    actions.append(button);
  };
  addChoice('Reload newer version', 'Discard your edit and load the newer version.', 'reload');
  addChoice('Keep both (compare above)', 'Keep the versions side by side; edit again before choosing.', 'compare');
  addChoice('Save mine as a duplicate', 'Create a new note from your version.', 'duplicate');

  dialog.append(heading, body, localBox, remoteBox, actions);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
