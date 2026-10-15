// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBulkBar, type BulkAction } from '../../../../src/dashboard/views/bulk-bar';
import type { Category, EntityId, Tag } from '../../../../src/core/types';

/**
 * T-042 regression: the bulk bar's modal dialogs must resolve
 * ASYNCHRONOUSLY when closed. The original synchronous-return-after-
 * showModal() implementation always read the pre-interaction value, so
 * trash, permanent delete and tag/category assignment never fired from the
 * real UI (caught by the E2E suite). These tests drive the actual dialogs.
 */

const TAGS: readonly Tag[] = [
  { id: 'tag-1' as EntityId, name: 'research', normalizedKey: 'research', createdAt: '2026-01-01T00:00:00.000Z' },
] as unknown as readonly Tag[];
const CATEGORIES: readonly Category[] = [
  { id: 'cat-1' as EntityId, name: 'Projects', parentId: null, createdAt: '2026-01-01T00:00:00.000Z' },
] as unknown as readonly Category[];

const INPUT = {
  selectedCount: 1,
  totalSelected: 1,
  viewAllows: { archive: true, restore: true, trash: true, deletePermanently: true, pin: true, favorite: true },
  tags: TAGS,
  categories: CATEGORIES,
};

function flush(millis = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('bulk bar dialogs resolve on close (T-042 regression)', () => {
  it('fires the trash action only after the confirmation is accepted', async () => {
    const actions: BulkAction[] = [];
    const bar = createBulkBar({ onAction: (action) => actions.push(action), onClearSelection: () => undefined });
    document.body.append(bar.element);
    bar.update(INPUT);

    bar.element.querySelector<HTMLButtonElement>('button:last-of-type')?.remove(); // keep Clear out of the way
    const trashButton = [...bar.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Move to trash…',
    );
    trashButton?.click();
    const dialog = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    expect(dialog?.open).toBe(true);
    // Before any interaction the action must NOT have fired.
    await flush();
    expect(actions).toEqual([]);

    document.querySelector<HTMLButtonElement>('.dialog--confirm .btn--danger')?.click();
    await waitFor(() => actions.length > 0);
    expect(actions[0]).toEqual({ kind: 'trash' });
    expect(document.querySelector('.dialog--confirm')).toBeNull();
  });

  it('cancel resolves without firing the destructive action', async () => {
    const actions: BulkAction[] = [];
    const bar = createBulkBar({ onAction: (action) => actions.push(action), onClearSelection: () => undefined });
    document.body.append(bar.element);
    bar.update(INPUT);

    const trashButton = [...bar.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Move to trash…',
    );
    trashButton?.click();
    const cancel = [...document.querySelectorAll('.dialog--confirm button')].find(
      (button) => button.textContent === 'Cancel',
    ) as HTMLButtonElement | undefined;
    cancel?.click();
    await flush(50);
    expect(actions).toEqual([]);
    expect(document.querySelector('.dialog--confirm')).toBeNull();
  });

  it('fires delete-permanently after confirmation', async () => {
    const actions: BulkAction[] = [];
    const bar = createBulkBar({ onAction: (action) => actions.push(action), onClearSelection: () => undefined });
    document.body.append(bar.element);
    bar.update(INPUT);

    const deleteButton = [...bar.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete permanently…',
    );
    deleteButton?.click();
    document.querySelector<HTMLButtonElement>('.dialog--confirm .btn--danger')?.click();
    await waitFor(() => actions.length > 0);
    expect(actions[0]).toEqual({ kind: 'delete-permanently' });
  });

  it('fires tag assignment with checked ids and parsed new names', async () => {
    const actions: BulkAction[] = [];
    const bar = createBulkBar({ onAction: (action) => actions.push(action), onClearSelection: () => undefined });
    document.body.append(bar.element);
    bar.update(INPUT);

    const assignButton = [...bar.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Assign tags…',
    );
    assignButton?.click();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) checkbox.checked = true;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]');
    if (input) input.value = 'alpha, beta ,, gamma';

    const apply = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Assign');
    apply?.click();
    await waitFor(() => actions.length > 0);
    expect(actions[0]).toEqual({
      kind: 'assign-tags',
      tagIds: ['tag-1'],
      newTags: ['alpha', 'beta', 'gamma'],
    });
  });

  it('fires category assignment for a new category name', async () => {
    const actions: BulkAction[] = [];
    const bar = createBulkBar({ onAction: (action) => actions.push(action), onClearSelection: () => undefined });
    document.body.append(bar.element);
    bar.update(INPUT);

    const assignButton = [...bar.element.querySelectorAll('button')].find(
      (button) => button.textContent === 'Assign category…',
    );
    assignButton?.click();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('input[type="text"]');
    if (input) input.value = 'New Area';
    const apply = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Assign');
    apply?.click();
    await waitFor(() => actions.length > 0);
    expect(actions[0]).toEqual({ kind: 'assign-category', categoryId: null, newCategoryName: 'New Area' });
  });
});
