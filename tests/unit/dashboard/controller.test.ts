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

  it('renders query syntax errors inline instead of silently ignoring them (QA-D02, FR-SEARCH-04)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Alpha', 'the needle is here');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 1);

    // Valid results AND a syntax error: the engine keeps the valid tokens,
    // the notice explains what was ignored. (Unknown colon-keys like
    // `bogus:xyz` intentionally fall through as literal terms so URLs and
    // times stay searchable; `is:` with a bad value is a real syntax error.)
    shell.elements.searchInput.value = 'needle is:zebra';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().queryErrors.length > 0);
    expect(controller!.store.getState().notes.length).toBe(1);
    const notice = root.querySelector('.results__query-note');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain('is:zebra');

    // Clearing the query clears the notice.
    shell.elements.searchInput.value = '';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().queryErrors.length === 0);
    expect(root.querySelector('.results__query-note')).toBeNull();
  });

  it('exclusion-only queries return the non-matching notes (QA-D01, FR-SEARCH-04)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Alpha', 'sourdough starter method');
    await clientSeedNote('Beta', 'vegetable soup recipe');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 2);

    shell.elements.searchInput.value = '-sourdough';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().notes.length === 1);
    expect(controller!.store.getState().notes[0]?.title).toBe('Beta');
    expect(controller!.store.getState().queryErrors).toEqual([]);
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
  it('re-sorts results when the sort control changes (engine truth)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Beta', 'b');
    await clientSeedNote('Alpha', 'a');
    await controller!.requery(); // bring the seeded notes into the list
    await waitFor(() => controller!.store.getState().notes.length === 2);

    shell.elements.sortSelect.value = 'title';
    shell.elements.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(controller!.store.getState().sort.field).toBe('title');
    // Title DESC is reverse-alphabetical — the engine's real order (this
    // used to assert the transient pre-requery state, which passed even
    // when no sort ever applied).
    await waitFor(
      () => controller!.store.getState().notes[0]?.title === 'Beta',
    );
  });

  it('sorts ascending through the direction control (audit D-03 repro inverted)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Audit Gamma xray', 'g');
    await clientSeedNote('Audit Alpha zebra', 'a');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 2);

    // The audit's exact observation: Title desc put Gamma first. The
    // direction control now flips it honestly.
    shell.elements.sortSelect.value = 'title';
    shell.elements.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => controller!.store.getState().notes[0]?.title.startsWith('Audit Gamma'));

    shell.elements.sortDirectionSelect.value = 'asc';
    shell.elements.sortDirectionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(controller!.store.getState().sort.direction).toBe('asc');
    await waitFor(() => controller!.store.getState().notes[0]?.title.startsWith('Audit Alpha'));

    // The control mirrors state and hides for relevance (score order has
    // no direction — PRD "where meaningful").
    expect(shell.elements.sortDirectionSelect.hidden).toBe(false);
    shell.elements.sortSelect.value = 'relevance';
    shell.elements.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => shell.elements.sortDirectionSelect.hidden === true);
  });

  it('seeds the session from the persisted default sort on load (FR-SEARCH-06)', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    // Change the persisted default through the real RPC.
    const client = createApiClient(transport);
    await client.request('settings/patch', {
      patch: { defaultSort: { field: 'title', direction: 'asc' } },
    });

    controller?.dispose();
    shell.dispose();
    root.remove();
    root = document.createElement('div');
    document.body.appendChild(root);
    shell = mountDashboardShell(root);
    controller = createDashboardController({ shell, theme, client: createApiClient(transport) });

    await waitFor(() => controller!.store.getState().status === 'ready');
    expect(controller!.store.getState().sort).toEqual({ field: 'title', direction: 'asc' });
    expect(shell.elements.sortSelect.value).toBe('title');
    expect(shell.elements.sortDirectionSelect.value).toBe('asc');
  });
});

/** Seeds a note directly through the real client (bypasses the shell). */

describe('stale requery sequencing (audit D-08)', () => {
  it('a stale in-flight requery cannot overwrite a newer search result', async () => {
    await waitFor(() => controller!.store.getState().status === 'ready');
    await clientSeedNote('Alpha', 'the needle is here');
    await controller!.requery();
    await waitFor(() => controller!.store.getState().notes.length === 1);

    // Hold the FIRST search/query ('needle') in flight at the transport.
    let releaseNeedle: () => void = () => undefined;
    let needleHeld = false;
    interceptor = (message) => {
      const payload = message.payload as { query?: string };
      if (
        message.kind === RPC_KIND &&
        'query' in payload &&
        payload.query === 'needle' &&
        !needleHeld
      ) {
        needleHeld = true;
        return new Promise((resolve) => {
          releaseNeedle = () => resolve(router.dispatch(message));
        }) as unknown;
      }
      return undefined;
    };

    // requery A: query 'needle' — search/query is now held in flight.
    shell.elements.searchInput.value = 'needle';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(170); // debounce fires; A is in flight
    expect(controller!.store.getState().total).toBe(1); // A has not landed yet

    // requery B: query with no matches — resolves immediately.
    shell.elements.searchInput.value = 'zebra-does-not-exist';
    shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => controller!.store.getState().total === 0);
    expect(root.querySelector('.state--empty')?.textContent).toContain('No matching notes');

    // Release A: the STALE requery resolves LAST. It must be dropped —
    // before the fix it overwrote B's empty state with the 'needle' hit.
    releaseNeedle();
    await flush(200);
    expect(controller!.store.getState().total).toBe(0);
    expect(controller!.store.getState().notes.length).toBe(0);
    expect(controller!.store.getState().query).toBe('zebra-does-not-exist');
  });
});

async function clientSeedNote(title: string, plainText: string): Promise<Note> {
  const client = createApiClient(transport);
  const { note } = await client.request('notes/create', { title, plainText });
  return note;
}
