// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDashboardShell } from '../../../src/dashboard/shell';
import { createThemeManager } from '../../../src/dashboard/theme';
import { createApiClient } from '../../../src/dashboard/state/client';
import { createDashboardController } from '../../../src/dashboard/state/controller';
import { PAGE_SIZE } from '../../../src/dashboard/state/store';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId } from '../../../src/core/types';

/**
 * T-016 integration: smart lists, pagination, card rendering with related
 * data, multi-select bulk actions with truthful per-item failure reporting
 * and audit events — all through the REAL router + repositories.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let shell: ReturnType<typeof mountDashboardShell>;
let theme: ReturnType<typeof createThemeManager>;
let router: MessageRouter;

const transport: Transport = async (message) => router.dispatch(message);

async function flush(millis = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
}

let controller: ReturnType<typeof createDashboardController> | null = null;

beforeEach(() => {
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
  root = document.createElement('div');
  document.body.appendChild(root);
  shell = mountDashboardShell(root);
  theme = createThemeManager(document.documentElement, 'system');
  router = new MessageRouter();
  registerAllApi(router);
  controller = createDashboardController({ shell, theme, client: createApiClient(transport) });
});

afterEach(async () => {
  controller?.dispose();
  shell.dispose();
  root.remove();
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

const client = () => createApiClient(transport);

/** Toggles a card's selection checkbox via a change event (robust across
 * the re-renders that follow each selection). */
function toggleCard(noteId: string): void {
  const box = root.querySelector<HTMLInputElement>(`[data-note-id="${noteId}"] .card__select`);
  box?.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Selects every note on the current page through the select-all control. */
async function selectAllOnPage(): Promise<void> {
  const box = shell.elements.selectAllCheckbox;
  box.checked = true; // a raw change event does not toggle the checkbox
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => controller!.store.getState().selection.size > 0);
}

async function seed(title: string, plainText = 'body'): Promise<EntityId> {
  const { note } = await client().request('notes/create', { title, plainText });
  return note.id;
}

function smartListButton(id: string): HTMLButtonElement {
  const button = shell.elements.smartNav.querySelector<HTMLButtonElement>(
    `[data-smart-list="${id}"]`,
  );
  if (!button) throw new Error(`smart list button ${id} missing`);
  return button;
}

describe('card rendering with related data', () => {
  it('renders full cards with tag and link indicators', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await seed('Cards test', 'a note about cards');
    const { tag } = await client().request('tags/create', { name: 'visual' });
    await client().request('tags/set-note-tags', { noteId, tagIds: [tag.id] });
    await client().request('links/create', {
      noteId,
      url: 'https://example.org/cards',
      anchorText: 'Cards',
    });
    await controller!.requery();

    await waitFor(() => controller!.store.getState().related[noteId]?.tags.length === 1);
    const card = root.querySelector(`[data-note-id="${noteId}"]`);
    expect(card).not.toBeNull();
    const chips = [...root.querySelectorAll(`[data-note-id="${noteId}"] .chip`)].map(
      (el) => el.textContent,
    );
    expect(chips).toContain('Tag: visual');
    expect(chips).toContain('Link');
    expect(root.querySelector(`[data-note-id="${noteId}"] .card__meta-rows`)?.textContent).toContain(
      'Modified',
    );
  });

  it('toggles between grid and list card layouts', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await seed('Layout');
    await controller!.requery();
    await waitFor(() => root.querySelector('.card--grid') !== null);
    const listOption = shell.elements.viewToggle.querySelector<HTMLButtonElement>(
      '[data-view="list"]',
    );
    listOption?.click();
    await waitFor(() => root.querySelector('.card--list') !== null);
    expect(controller!.store.getState().viewMode).toBe('list');
  });
});

describe('smart lists', () => {
  it('filters to pinned notes only', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const pinnedId = await seed('Pinned one');
    await seed('Unpinned two');
    await client().request('notes/set-flags', { noteId: pinnedId, pinned: true });
    await controller!.requery();

    smartListButton('pinned').click();
    await waitFor(() => controller!.store.getState().smartList === 'pinned');
    await waitFor(() => controller!.store.getState().total === 1);
    expect(controller!.store.getState().notes[0]?.title).toBe('Pinned one');
    expect(smartListButton('pinned').getAttribute('aria-current')).toBe('true');
    expect(smartListButton('all').getAttribute('aria-current')).toBe(null);
    expect(shell.elements.resultsTitle.textContent).toBe('Pinned');
  });

  it('separates archived and trashed notes with restore support', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const archivedId = await seed('To archive');
    const trashedId = await seed('To trash');
    await client().request('notes/archive', { noteId: archivedId });
    await client().request('notes/trash', { noteId: trashedId });

    smartListButton('archived').click();
    await waitFor(() => controller!.store.getState().smartList === 'archived');
    await waitFor(() => controller!.store.getState().total === 1);
    expect(controller!.store.getState().notes[0]?.title).toBe('To archive');

    smartListButton('trashed').click();
    await waitFor(() => controller!.store.getState().smartList === 'trashed');
    await waitFor(() => controller!.store.getState().notes[0]?.title === 'To trash');
    expect(shell.elements.resultsCount.textContent).toBe('1 note');
  });
});

describe('pagination (windowed rendering)', () => {
  it('pages through large result sets', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const total = PAGE_SIZE + 5;
    for (let i = 1; i <= total; i += 1) {
      await seed(`Note ${String(i).padStart(3, '0')}`);
    }
    await controller!.requery();

    await waitFor(() => controller!.store.getState().notes.length === PAGE_SIZE);
    expect(controller!.store.getState().total).toBe(total);
    expect(root.querySelectorAll('.card').length).toBe(PAGE_SIZE); // windowed, not all
    expect(shell.elements.paginationPrev.disabled).toBe(true);
    expect(shell.elements.paginationNext.disabled).toBe(false);
    expect(shell.elements.paginationLabel.textContent).toContain(`Page 1 of 2`);

    shell.elements.paginationNext.click();
    await waitFor(() => controller!.store.getState().page === 2);
    await waitFor(() => controller!.store.getState().notes.length === 5);
    expect(root.querySelectorAll('.card').length).toBe(5);
    expect(shell.elements.paginationPrev.disabled).toBe(false);
    expect(shell.elements.paginationLabel.textContent).toContain('Page 2 of 2');
  });
});

describe('multi-select bulk actions', () => {
  it('selects cards, archives them and reports honestly', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const first = await seed('Bulk A');
    const second = await seed('Bulk B');
    await seed('Bulk C');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 3);

    toggleCard(first);
    toggleCard(second);
    await waitFor(() => controller!.store.getState().selection.size === 2);

    // Bulk bar is visible with counts.
    expect(shell.elements.bulkBarMount.textContent).toContain('2 selected on this page (2 total)');

    await controller!.applyBulkAction({ kind: 'archive' });

    await waitFor(() => controller!.store.getState().selection.size === 0);
    await waitFor(() => controller!.store.getState().total === 1);
    expect(controller!.store.getState().notes.map((n) => n.title)).toEqual(['Bulk C']);

    // Archive was audited (FR-LOG-02).
    const audit = await listAuditEvents(await repo(), { limit: 50 });
    const archiveEvents = audit.filter((event) => event.action === 'notes/archive');
    expect(archiveEvents.length).toBe(2);
    expect(archiveEvents.every((event) => event.actor === 'user')).toBe(true);

    await flush();
    expect(shell.elements.liveRegion.textContent).toContain('Archive: 2 notes updated');
  });

  it('assigns newly created tags in bulk and shows the chips', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const first = await seed('Tag me');
    const second = await seed('Tag me too');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 2);
    await selectAllOnPage();

    await controller!.applyBulkAction({
      kind: 'assign-tags',
      tagIds: [],
      newTags: ['research', 'to-read'],
    });

    const { tags } = await client().request('tags/list', {});
    expect(tags.map((tag) => tag.name).sort()).toEqual(['research', 'to-read']);
    await waitFor(() => controller!.store.getState().related[first]?.tags.length === 2);
    expect(
      root.querySelector(`[data-note-id="${second}"]`)?.textContent,
    ).toContain('Tag: research');
  });

  it('assigns a new category in bulk', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await seed('Categorise me');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 1);
    await selectAllOnPage();

    await controller!.applyBulkAction({
      kind: 'assign-category',
      categoryId: null,
      newCategoryName: 'Projects',
    });

    const { categories } = await client().request('categories/list', {});
    expect(categories.map((category) => category.name)).toEqual(['Projects']);
    await waitFor(() => controller!.store.getState().related[noteId]?.categories.length === 1);
    expect(root.querySelector(`[data-note-id="${noteId}"]`)?.textContent).toContain(
      'Category: Projects',
    );
  });

  it('trashes in bulk from the confirm-free path and restores', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await seed('Trash flow');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 1);
    await selectAllOnPage();

    await controller!.applyBulkAction({ kind: 'trash' });
    await waitFor(() => controller!.store.getState().total === 0);
    const { note } = await client().request('notes/get', { noteId });
    expect(note.state).toBe('trashed');

    smartListButton('trashed').click();
    await waitFor(() => controller!.store.getState().notes[0]?.id === noteId);
    await selectAllOnPage();

    await controller!.applyBulkAction({ kind: 'restore' });
    await waitFor(() => controller!.store.getState().total === 0); // trash empty now
    const restored = await client().request('notes/get', { noteId });
    expect(restored.note.state).toBe('active');
  });

  it('permanently deletes only from the trash view', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await seed('Delete forever');
    await client().request('notes/trash', { noteId });

    smartListButton('trashed').click();
    await waitFor(() => controller!.store.getState().notes[0]?.id === noteId);
    await selectAllOnPage();

    await controller!.applyBulkAction({ kind: 'delete-permanently' });
    await waitFor(() => controller!.store.getState().total === 0);
    const gone = await client()
      .request('notes/get', { noteId })
      .catch((error: unknown) => error);
    expect(gone).toBeInstanceOf(Error);
    expect((gone as { code?: string }).code).toBe('not-found');

    const audit = await listAuditEvents(await repo(), { limit: 50 });
    expect(audit.some((event) => event.action === 'notes/delete-permanently')).toBe(true);
  });

  it('select-all syncs the checkbox state across pages', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await seed('One');
    await seed('Two');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 2);

    shell.elements.selectAllCheckbox.click();
    await waitFor(() => controller!.store.getState().selection.size === 2);
    expect(shell.elements.selectAllCheckbox.checked).toBe(true);
    expect(shell.elements.bulkBarMount.textContent).toContain('2 selected');

    shell.elements.selectAllCheckbox.click();
    await waitFor(() => controller!.store.getState().selection.size === 0);
    expect(
      shell.elements.bulkBarMount.querySelector<HTMLElement>('.bulk-bar')?.hidden ?? true,
    ).toBe(true);
  });
});

describe('audit trail from earlier tasks stays intact', () => {
  it('records audit events for note creation', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await seed('Audited');
    const audit = await listAuditEvents(await repo(), { limit: 10 });
    expect(audit.some((event) => event.action === 'notes/create')).toBe(true);
  });
});

describe('favorites (T-064, audit D-01)', () => {
  it('favorites notes in bulk and populates the Favorites smart list', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const first = await seed('Fav A');
    const second = await seed('Fav B');
    await seed('Unloved C');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 3);

    toggleCard(first);
    toggleCard(second);
    await waitFor(() => controller!.store.getState().selection.size === 2);
    // The bulk bar actually offers the action the audit proved missing.
    expect(shell.elements.bulkBarMount.textContent).toContain('Favorite');

    await controller!.applyBulkAction({ kind: 'favorite', value: true });
    await waitFor(() => controller!.store.getState().selection.size === 0);

    const favA = (await client().request('notes/get', { noteId: first })).note;
    const favB = (await client().request('notes/get', { noteId: second })).note;
    expect(favA.favorite).toBe(true);
    expect(favB.favorite).toBe(true);
    await flush();
    expect(shell.elements.liveRegion.textContent).toContain('Favorite: 2 notes updated');

    // The previously permanently-empty smart list now has content.
    smartListButton('favorites').click();
    await waitFor(() => controller!.store.getState().smartList === 'favorites');
    await waitFor(() => controller!.store.getState().total === 2);
    expect(controller!.store.getState().notes.map((n) => n.title).sort()).toEqual(['Fav A', 'Fav B']);
    expect(shell.elements.resultsTitle.textContent).toBe('Favorites');

    // Unfavorite from the favorites view removes it honestly.
    const remaining = controller!.store.getState().notes[0]!.id;
    toggleCard(remaining);
    await waitFor(() => controller!.store.getState().selection.size === 1);
    await controller!.applyBulkAction({ kind: 'favorite', value: false });
    await waitFor(() => controller!.store.getState().total === 1);
    const unfavored = (await client().request('notes/get', { noteId: remaining })).note;
    expect(unfavored.favorite).toBe(false);
  });

  it('hides the favorite action in views where it is not offered', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await seed('Trash fav target');
    await client().request('notes/trash', { noteId });
    smartListButton('trashed').click();
    await waitFor(() => controller!.store.getState().smartList === 'trashed');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 1);

    toggleCard(controller!.store.getState().notes[0]!.id);
    await waitFor(() => controller!.store.getState().selection.size === 1);
    // Pin is equally hidden in trash — favorite mirrors it (D-01 fix).
    expect(shell.elements.bulkBarMount.textContent).not.toContain('Favorite');
  });
});

describe('page-slice invariant (T-068, audit D-07)', () => {
  it('rapid creation never renders more cards than the page size', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    // The audit's scenario: 52 New Note clicks on an empty library
    // rendered 52 cards on "Page 1 of 2" until a reload self-healed.
    const total = PAGE_SIZE + 2;
    for (let i = 0; i < total; i += 1) {
      await controller!.createNote();
      // The invariant at EVERY step — the audit observed it breaking from
      // creation #51 onward (51+ cards on "Page 1 of 2").
      expect(controller!.store.getState().notes.length).toBeLessThanOrEqual(PAGE_SIZE);
    }
    await waitFor(() => controller!.store.getState().total === total);

    // The invariant holds at every step: the slice never exceeds pageSize
    // and the pagination chrome stays consistent with the rendered cards.
    expect(controller!.store.getState().notes.length).toBeLessThanOrEqual(PAGE_SIZE);
    await waitFor(() => controller!.store.getState().notes.length === PAGE_SIZE);
    expect(root.querySelectorAll('.card').length).toBe(PAGE_SIZE);
    expect(shell.elements.paginationLabel.textContent).toContain(`of ${total}`);
    expect(shell.elements.paginationLabel.textContent).toContain('Page 1 of 2');

    // The overflow notes are honestly on page 2.
    shell.elements.paginationNext.click();
    await waitFor(() => controller!.store.getState().page === 2);
    await waitFor(() => controller!.store.getState().notes.length === 2);
    expect(root.querySelectorAll('.card').length).toBe(2);
  });

  it('creation on a non-full page keeps the instant optimistic placeholder', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await controller!.createNote();
    expect(noteId).not.toBeNull();
    // The optimistic swap-in kept the card visible without a requery.
    expect(controller!.store.getState().notes.length).toBe(1);
    expect(controller!.store.getState().notes[0]?.id).toBe(noteId);
  });
});
