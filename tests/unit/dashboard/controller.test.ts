// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDashboardShell } from '../../../src/dashboard/shell';
import { createThemeManager } from '../../../src/dashboard/theme';
import { createApiClient } from '../../../src/dashboard/state/client';
import { createDashboardController } from '../../../src/dashboard/state/controller';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { closeWorkerResources } from '../../../src/background/db';
import { RPC_KIND, type RpcRequest } from '../../../src/background/protocol';
import { DB_NAME } from '../../../src/core/version';
import type { Note } from '../../../src/core/types';

/**
 * T-015 end-to-end: the dashboard controller drives the REAL service-worker
 * router over the REAL repositories (fake-indexeddb) through the typed
 * client — optimistic updates, truthful rollback, save-state flow, search
 * refresh and the beforeunload guard.
 */

type Transport = Parameters<typeof createApiClient>[0];

let root: HTMLElement;
let shell: ReturnType<typeof mountDashboardShell>;
let theme: ReturnType<typeof createThemeManager>;
let router: MessageRouter;

/** Optional per-test interceptor to simulate failures or hangs. */
let interceptor: ((message: RpcRequest) => unknown) | null = null;

const transport: Transport = async (message) => {
  if (interceptor) {
    const replacement = interceptor(message);
    if (replacement !== undefined) return replacement as unknown;
  }
  return router.dispatch(message);
};

async function flush(millis = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T, timeoutMs = 2000): Promise<T> {
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
  interceptor = null;
  // jsdom does not implement matchMedia; the theme engine only needs a
  // non-matching, listener-capable stub here.
  (window as unknown as { matchMedia: unknown }).matchMedia = (
    query: string,
  ): MediaQueryList =>
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
  controller = createDashboardController({
    shell,
    theme,
    client: createApiClient(transport),
  });
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

describe('initial load', () => {
  it('moves from loading to ready with settings, counts and an empty state', async () => {
    const state = controller!.store.getState();
    expect(state.status).toBe('loading');
    await waitFor(() => controller!.store.getState().status === 'ready');
    expect(controller!.store.getState().counts.active).toBe(0);
    expect(controller!.store.getState().settings?.theme).toBe('system');
    expect(root.querySelector('.state--empty')?.textContent).toContain('No notes yet');
    expect(shell.elements.resultsCount.textContent).toBe('0 notes');
  });

  it('shows the database failure honestly with a retry action', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    interceptor = () => ({
      kind: RPC_KIND,
      id: 'x',
      ok: false,
      error: { code: 'database-unavailable', message: 'database unavailable: boom' },
    });
    await controller!.refresh();
    expect(controller!.store.getState().status).toBe('error');
    expect(controller!.store.getState().loadError?.code).toBe('database-unavailable');
    expect(root.querySelector('.state--error')?.textContent).toContain('Could not load notes');
    expect(root.querySelector('.state--error button')?.textContent).toBe('Try again');

    // Retry succeeds once the database returns.
    interceptor = null;
    (root.querySelector('.state--error button') as HTMLButtonElement).click();
    await waitFor(() => controller!.store.getState().status === 'ready');
  });
});

describe('New Note (optimistic with truthful rollback)', () => {
  it('creates a note, replaces the optimistic entry and announces', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = await controller!.createNote();
    expect(noteId).not.toBeNull();
    expect(noteId).toMatch(/^[0-9a-f-]{36}$/); // persisted UUID, not optimistic id

    const state = controller!.store.getState();
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]?.id).toBe(noteId);
    expect(state.notes[0]?.title).toBe('Untitled');
    expect(state.total).toBe(1);
    expect(shell.elements.resultsCount.textContent).toBe('1 note');

    // The card renders with an untitled label (PRD §4.3).
    expect(root.querySelector('.card__title')?.textContent).toContain('Untitled');

    await flush();
    expect(shell.elements.liveRegion.textContent).toContain('Note created.');
  });

  it('rolls the optimistic entry back and announces on failure', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    interceptor = (message) =>
      message.type === 'notes/create'
        ? { kind: RPC_KIND, id: message.id, ok: false, error: { code: 'internal-error', message: 'write failed' } }
        : undefined;
    const noteId = await controller!.createNote();
    expect(noteId).toBeNull();
    const state = controller!.store.getState();
    expect(state.notes).toHaveLength(0);
    expect(state.total).toBe(0);
    expect(root.querySelector('.state--empty')).not.toBeNull();
    await flush();
    expect(shell.elements.liveRegion.textContent).toContain('failed');
  });
});

describe('search refresh', () => {
  it('requeries through the real search engine on input', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await controller!.createNote();
    await clientSeedNote('Alpha', 'the needle is here');
    await controller!.requery(); // bring the seeded note into the list
    await waitFor(() => controller!.store.getState().notes.length === 2);

    shell.elements.searchInput.value = 'needle';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().notes.length === 1);
    expect(controller!.store.getState().notes[0]?.title).toBe('Alpha');
    expect(shell.elements.resultsTitle.textContent).toBe('Search results');
    expect(shell.elements.resultsCount.textContent).toBe('1 note');
  });

  it('shows the no-match empty state with guidance', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await controller!.createNote();
    await waitFor(() => controller!.store.getState().notes.length === 1);

    shell.elements.searchInput.value = 'zebra-does-not-exist';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().total === 0);
    expect(root.querySelector('.state--empty')?.textContent).toContain('No matching notes');
  });
});

describe('save flow (visible state + rollback)', () => {
  it('saves: Saving → Saved, persisted content confirmed via notes/get', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = (await controller!.createNote())!;
    const current = controller!.store.getState().notes[0]!;

    const saved = await controller!.saveNote({
      noteId,
      title: 'Grocery list',
      subtitle: '',
      editorDoc: null,
      plainText: 'milk and eggs',
      expectedRevisionId: current.revisionId,
      changeSummary: 'edit',
    });
    expect(saved).not.toBeNull();
    expect(controller!.store.getState().saveState).toBe('saved');
    expect(shell.elements.saveState.textContent).toBe('Saved');
    expect(controller!.store.getState().notes[0]?.title).toBe('Grocery list');

    const client = createApiClient(transport);
    const { note } = await client.request('notes/get', { noteId });
    expect(note.title).toBe('Grocery list');
    expect(note.plainText).toBe('milk and eggs');
  });

  it('conflict: rolls the optimistic edit back and labels Save failed', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = (await controller!.createNote())!;

    // A second writer saves first (stale revision for the dashboard).
    const client = createApiClient(transport);
    await client.request('notes/save', {
      noteId,
      title: 'Other tab edit',
      subtitle: '',
      editorDoc: null,
      plainText: 'written elsewhere',
      expectedRevisionId: controller!.store.getState().notes[0]?.revisionId ?? null,
      changeSummary: 'other tab',
    });

    const saved = await controller!.saveNote({
      noteId,
      title: 'Dashboard edit',
      subtitle: '',
      editorDoc: null,
      plainText: 'written here',
      expectedRevisionId: '00000000-0000-4000-8000-000000000000' as never,
      changeSummary: 'stale',
    });
    expect(saved).toBeNull();
    expect(controller!.store.getState().saveState).toBe('save-failed');
    expect(shell.elements.saveState.textContent).toBe('Save failed');
    // The optimistic title was rolled back — no silent overwrite.
    expect(controller!.store.getState().notes[0]?.title).not.toBe('Dashboard edit');
    await flush();
    expect(shell.elements.liveRegion.textContent).toContain('another tab');
  });
});

describe('navigation guard (PRD §4.3)', () => {
  it('blocks unload while a save is in flight and releases it after', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    const noteId = (await controller!.createNote())!;

    // A save the test holds open until the guard has been exercised.
    const deferred = { resolve: null as null | ((response: unknown) => void) };
    interceptor = (message) => {
      if (message.type === 'notes/save') {
        return new Promise<unknown>((resolve) => {
          deferred.resolve = resolve;
        });
      }
      return undefined;
    };

    const savePromise = controller!.saveNote({
      noteId,
      title: 'Hanging save',
      subtitle: '',
      editorDoc: null,
      plainText: '',
      expectedRevisionId: null,
      changeSummary: 'hang',
    });
    await waitFor(() => controller!.store.getState().saveState === 'saving');

    const event = new Event('beforeunload', { cancelable: true });
    const spy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();

    // Unblock (the save settles with a failure) and confirm the guard
    // releases: navigation is allowed again.
    deferred.resolve?.({
      kind: RPC_KIND,
      id: 'manual',
      ok: false,
      error: { code: 'internal-error', message: 'settled by test' },
    });
    const settled = await savePromise;
    expect(settled).toBeNull();
    await waitFor(() => controller!.store.getState().saveState === 'save-failed');
    const after = new Event('beforeunload', { cancelable: true });
    const afterSpy = vi.spyOn(after, 'preventDefault');
    window.dispatchEvent(after);
    expect(afterSpy).not.toHaveBeenCalled();
  });
});

describe('sort wiring', () => {
  it('re-sorts results when the sort control changes', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Beta', 'b');
    await clientSeedNote('Alpha', 'a');
    await controller!.requery(); // bring the seeded notes into the list
    await waitFor(() => controller!.store.getState().notes.length === 2);

    shell.elements.sortSelect.value = 'title';
    shell.elements.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(
      () => controller!.store.getState().notes[0]?.title === 'Alpha',
    );
    expect(controller!.store.getState().sort.field).toBe('title');
  });
});

/** Seeds a note directly through the real client (bypasses the shell). */
async function clientSeedNote(title: string, plainText: string): Promise<Note> {
  const client = createApiClient(transport);
  const { note } = await client.request('notes/create', { title, plainText });
  return note;
}
