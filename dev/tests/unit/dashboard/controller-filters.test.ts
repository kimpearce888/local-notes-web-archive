// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountDashboardShell } from '../../../../src/dashboard/shell';
import { createThemeManager } from '../../../../src/dashboard/theme';
import { createApiClient } from '../../../../src/dashboard/state/client';
import { createDashboardController } from '../../../../src/dashboard/state/controller';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { closeWorkerResources } from '../../../../src/background/db';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId } from '../../../../src/core/types';

/**
 * T-065 integration (audit D-02, FR-SEARCH-03): the Filters disclosure
 * holds real controls wired to the controller — filter application
 * narrows results through the real search engine, active-filter chips are
 * removable, and saved named views persist through settings/patch and
 * re-apply with their query.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let shell: ReturnType<typeof mountDashboardShell>;
let theme: ReturnType<typeof createThemeManager>;
let router: MessageRouter;

const transport: Transport = async (message) => router.dispatch(message);
const client = () => createApiClient(transport);

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

async function seed(title: string, plainText = 'body'): Promise<EntityId> {
  const { note } = await client().request('notes/create', { title, plainText });
  return note.id;
}

function openFilters(): void {
  const button = shell.elements.filtersButton;
  if (button.getAttribute('aria-expanded') !== 'true') button.click();
}

describe('filters wiring (T-065, audit D-02)', () => {
  it('the Filters disclosure opens real controls instead of an empty region', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    openFilters();
    expect(shell.elements.filtersRegion.hidden).toBe(false);
    // The audit measured ZERO children here; now the control families exist.
    expect(shell.elements.filtersRegion.querySelectorAll('input, select, button').length).toBeGreaterThan(10);
    expect(shell.elements.filtersRegion.textContent).toContain('Apply filters');
  });

  it('applies filters, renders removable chips and narrows results', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const pinnedId = await seed('Pinned target');
    await seed('Plain note');
    await client().request('notes/set-flags', { noteId: pinnedId, pinned: true });
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 2);

    await controller!.setFilters({ pinned: true });
    await waitFor(() => controller!.store.getState().total === 1);
    expect(controller!.store.getState().notes[0]?.id).toBe(pinnedId);

    // One removable chip per active filter.
    await waitFor(() => shell.elements.activeFilters.children.length === 1);
    expect(shell.elements.activeFilters.textContent).toContain('Pinned only');

    // Removing the chip clears the filter through the controller.
    shell.elements.activeFilters.querySelector<HTMLButtonElement>('.chip__remove')?.click();
    await waitFor(() => controller!.store.getState().total === 2);
    await waitFor(() => shell.elements.activeFilters.children.length === 0);

    await controller!.clearFilters();
    expect(controller!.store.getState().filters).toEqual({});
  });

  it('saves the current query + filters as a named view, re-applies and deletes it', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const pinnedId = await seed('View target');
    await seed('Other note');
    await client().request('notes/set-flags', { noteId: pinnedId, pinned: true });
    shell.elements.searchInput.value = 'view';
    controller!.store.setState({ query: 'view' });
    await controller!.setFilters({ pinned: true });

    await controller!.saveCurrentView('My pinned views');
    const settings = controller!.store.getState().settings;
    expect(settings?.savedViews).toHaveLength(1);
    expect(settings?.savedViews[0]?.name).toBe('My pinned views');
    expect(settings?.savedViews[0]?.query).toBe('view');
    expect(settings?.savedViews[0]?.filters.pinned).toBe(true);
    await waitFor(() => shell.elements.savedViewsHost.textContent?.includes('My pinned views'));

    // Durable: the persisted settings record carries the view.
    const persisted = (await client().request('settings/get', {})).settings;
    expect(persisted.savedViews).toHaveLength(1);

    // Reset, then apply the view: query AND filters return together, and
    // the search input mirrors the applied query.
    shell.elements.searchInput.value = '';
    await controller!.clearFilters();
    await controller!.setFilters({});
    const viewId = controller!.store.getState().settings?.savedViews[0]?.id as EntityId;
    await controller!.applySavedView(viewId);
    expect(controller!.store.getState().query).toBe('view');
    expect(controller!.store.getState().filters.pinned).toBe(true);
    expect(shell.elements.searchInput.value).toBe('view');
    await waitFor(() => controller!.store.getState().total === 1);
    expect(controller!.store.getState().notes[0]?.id).toBe(pinnedId);

    // Delete removes the chip and the persisted record.
    await controller!.deleteSavedView(viewId);
    expect(controller!.store.getState().settings?.savedViews).toHaveLength(0);
    await waitFor(() => shell.elements.savedViewsHost.children.length === 0);
    const afterDelete = (await client().request('settings/get', {})).settings;
    expect(afterDelete.savedViews).toHaveLength(0);
  });

  it('saved views survive a controller remount (durable named views)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await seed('Durable view note');
    await controller!.saveCurrentView('Durable');
    controller?.dispose();
    shell.dispose();
    root.remove();

    root = document.createElement('div');
    document.body.appendChild(root);
    shell = mountDashboardShell(root);
    controller = createDashboardController({ shell, theme, client: createApiClient(transport) });
    await waitFor(() => controller!.store.getState().status === 'ready');
    expect(controller!.store.getState().settings?.savedViews[0]?.name).toBe('Durable');
    await waitFor(() => shell.elements.savedViewsHost.textContent?.includes('Durable'));
  });
});
