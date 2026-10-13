/**
 * Bulk action bar + dialogs (PRD §4.2 selectable bulk actions, FR-NOTE-05/08):
 * assign tags, assign category, pin/unpin, archive/restore and trash with
 * explicit confirmation. Destructive confirmations use in-page modal
 * dialogs with clear worded warnings — never colour-only cues. Every dialog
 * resolves asynchronously when it closes (showModal() is non-blocking — a
 * synchronous return would always read the pre-interaction value, a bug
 * the T-042 E2E suite caught).
 */

import type { Category, EntityId, Tag } from '../../core/types';

export type BulkAction =
  | { kind: 'pin'; value: boolean }
  | { kind: 'archive' }
  | { kind: 'restore' }
  | { kind: 'trash' }
  | { kind: 'delete-permanently' }
  | { kind: 'assign-tags'; tagIds: readonly EntityId[]; newTags: readonly string[] }
  | { kind: 'assign-category'; categoryId: EntityId | null; newCategoryName: string | null };

export interface BulkBarCallbacks {
  onAction(action: BulkAction): void;
  onClearSelection(): void;
}

export interface BulkBar {
  readonly element: HTMLElement;
  /** Re-render for the current selection and available tags/categories. */
  update(input: {
    selectedCount: number;
    totalSelected: number;
    viewAllows: {
      archive: boolean;
      restore: boolean;
      trash: boolean;
      deletePermanently: boolean;
      pin: boolean;
    };
    tags: readonly Tag[];
    categories: readonly Category[];
  }): void;
}

export function createBulkBar(callbacks: BulkBarCallbacks): BulkBar {
  const element = document.createElement('div');
  element.className = 'bulk-bar';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', 'Bulk actions');
  element.hidden = true;

  function update(input: Parameters<BulkBar['update']>[0]): void {
    element.replaceChildren();
    if (input.selectedCount === 0) {
      element.hidden = true;
      return;
    }
    element.hidden = false;

    const summary = document.createElement('span');
    summary.className = 'bulk-bar__summary';
    summary.textContent = `${input.selectedCount} selected on this page (${input.totalSelected} total)`;
    element.append(summary);

    const button = (label: string, onClick: () => void, variant?: 'danger' | 'primary'): void => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = variant === 'danger' ? 'btn btn--danger' : 'btn';
      if (variant === 'primary') el.classList.add('btn--primary');
      el.textContent = label;
      el.addEventListener('click', onClick);
      element.append(el);
    };

    if (input.viewAllows.pin) {
      button('Pin', () => callbacks.onAction({ kind: 'pin', value: true }));
      button('Unpin', () => callbacks.onAction({ kind: 'pin', value: false }));
    }
    button('Assign tags…', () => {
      void (async () => {
        const plan = await promptTagAssignment(input.tags);
        if (plan) {
          callbacks.onAction({
            kind: 'assign-tags',
            tagIds: plan.tagIds,
            newTags: plan.newTags,
          });
        }
      })();
    });
    button('Assign category…', () => {
      void (async () => {
        const plan = await promptCategoryAssignment(input.categories);
        if (plan) {
          callbacks.onAction({
            kind: 'assign-category',
            categoryId: plan.categoryId,
            newCategoryName: plan.newCategoryName,
          });
        }
      })();
    });
    if (input.viewAllows.archive) {
      button('Archive', () => callbacks.onAction({ kind: 'archive' }));
    }
    if (input.viewAllows.restore) {
      button('Restore', () => callbacks.onAction({ kind: 'restore' }));
    }
    if (input.viewAllows.trash) {
      button('Move to trash…', () => {
        void (async () => {
          const confirmed = await confirmDialog(
            'Move notes to trash?',
            `Move ${input.totalSelected} note${input.totalSelected === 1 ? '' : 's'} to trash. Trashed notes stay recoverable until permanently deleted.`,
            'Move to trash',
          );
          if (confirmed) callbacks.onAction({ kind: 'trash' });
        })();
      }, 'danger');
    }
    if (input.viewAllows.deletePermanently) {
      button('Delete permanently…', () => {
        void (async () => {
          const confirmed = await confirmDialog(
            'Permanently delete notes?',
            `This permanently deletes ${input.totalSelected} note${input.totalSelected === 1 ? '' : 's'} with all revisions, links, snapshots metadata and reminders. This cannot be undone.`,
            'Delete permanently',
          );
          if (confirmed) callbacks.onAction({ kind: 'delete-permanently' });
        })();
      }, 'danger');
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn--ghost';
    clear.textContent = 'Clear selection';
    clear.addEventListener('click', () => callbacks.onClearSelection());
    element.append(clear);
  }

  return { element, update };
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

/**
 * Shared confirmation dialog (T-054): used by the bulk bar's destructive
 * actions and by the editor's Move-to-trash flow.
 */
export function confirmDialog(title: string, detail: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--confirm';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const body = document.createElement('p');
    body.textContent = detail;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    let confirmed = false;
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn--danger';
    confirmButton.textContent = confirmLabel;
    confirmButton.addEventListener('click', () => {
      confirmed = true;
      dialog.close();
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => dialog.close());
    actions.append(cancelButton, confirmButton);
    dialog.append(heading, body, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

interface TagAssignmentPlan {
  readonly tagIds: readonly EntityId[];
  readonly newTags: readonly string[];
}

function promptTagAssignment(existingTags: readonly Tag[]): Promise<TagAssignmentPlan | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Assign tags';
    const description = document.createElement('p');
    description.textContent =
      'Pick existing tags and/or name new ones. Existing assignments are kept.';

    const list = document.createElement('fieldset');
    list.className = 'dialog__list';
    const legend = document.createElement('legend');
    legend.textContent = 'Existing tags';
    list.append(legend);
    for (const tag of existingTags) {
      const label = document.createElement('label');
      label.className = 'dialog__option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = tag.id;
      label.append(box, document.createTextNode(` ${tag.name}`));
      list.append(label);
    }
    if (existingTags.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No tags yet.';
      list.append(empty);
    }

    const newTagLabel = document.createElement('label');
    newTagLabel.className = 'dialog__field';
    newTagLabel.textContent = 'New tags (comma-separated)';
    const newTagInput = document.createElement('input');
    newTagInput.type = 'text';
    newTagInput.className = 'search-input';
    newTagInput.setAttribute('placeholder', 'research, to-read');
    newTagInput.setAttribute('aria-label', 'New tags, comma-separated');
    newTagLabel.append(newTagInput);

    let plan: TagAssignmentPlan | null = null;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'Assign';
    apply.addEventListener('click', () => {
      const tagIds = [...list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map(
        (box) => box.value as EntityId,
      );
      const newTags = newTagInput.value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .slice(0, 20);
      plan = { tagIds, newTags };
      dialog.close();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(cancel, apply);

    dialog.append(heading, description, list, newTagLabel, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(plan);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

interface CategoryAssignmentPlan {
  readonly categoryId: EntityId | null;
  readonly newCategoryName: string | null;
}

function promptCategoryAssignment(existing: readonly Category[]): Promise<CategoryAssignmentPlan | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Assign category';
    const description = document.createElement('p');
    description.textContent =
      'Choose one category for the selected notes. Existing category assignments are replaced.';

    const list = document.createElement('fieldset');
    list.className = 'dialog__list';
    const legend = document.createElement('legend');
    legend.textContent = 'Categories';
    list.append(legend);
    const none = document.createElement('label');
    none.className = 'dialog__option';
    const noneBox = document.createElement('input');
    noneBox.type = 'radio';
    noneBox.name = 'category';
    noneBox.value = '';
    noneBox.checked = true;
    none.append(noneBox, document.createTextNode(' No category'));
    list.append(none);
    for (const category of existing) {
      const label = document.createElement('label');
      label.className = 'dialog__option';
      const box = document.createElement('input');
      box.type = 'radio';
      box.name = 'category';
      box.value = category.id;
      label.append(box, document.createTextNode(` ${category.name}`));
      list.append(label);
    }

    const newLabel = document.createElement('label');
    newLabel.className = 'dialog__field';
    newLabel.textContent = 'Or create a new category';
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.className = 'search-input';
    newInput.setAttribute('placeholder', 'New category name');
    newInput.setAttribute('aria-label', 'New category name');
    newLabel.append(newInput);

    let plan: CategoryAssignmentPlan | null = null;
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'btn btn--primary';
    apply.textContent = 'Assign';
    apply.addEventListener('click', () => {
      const chosen = list.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? '';
      const newName = newInput.value.trim();
      if (newName.length > 0) {
        plan = { categoryId: null, newCategoryName: newName };
      } else {
        plan = { categoryId: (chosen || null) as EntityId | null, newCategoryName: null };
      }
      dialog.close();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(cancel, apply);

    dialog.append(heading, description, list, newLabel, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(plan);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
