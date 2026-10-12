/**
 * Dashboard controller (T-015): the only writer of the store. Wires shell
 * events to typed service-worker calls, applies optimistic updates with
 * truthful rollback, drives the save-state indicator, and renders result
 * states into the results region. The navigation guard blocks unload while
 * a save is in flight (PRD §4.3).
 */

import type { DashboardShell } from '../shell';
import type { ThemeManager } from '../theme';
import { showContent, showEmpty, showError, showLoading } from '../states';
import type { ApiClient } from './client';
import { RpcClientError } from './client';
import {
  createDashboardStore,
  INITIAL_DASHBOARD_STATE,
  type DashboardStore,
  type DashboardState,
} from './store';
import type { EntityId, Note } from '../../core/types';

export interface DashboardController {
  readonly store: DashboardStore;
  /** Reloads settings, counts and results from durable state. */
  refresh(): Promise<void>;
  /** Creates a note (New Note action). Optimistic with truthful rollback. */
  createNote(): Promise<EntityId | null>;
  /**
   * Saves note content transactionally through the service worker with a
   * visible save flow (Saving → Saved / Save failed + rollback).
   */
  saveNote(input: {
    noteId: EntityId;
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
    expectedRevisionId: EntityId | null;
    changeSummary: string;
  }): Promise<Note | null>;
  /** Re-runs the current query (filters/sort changes). */
  requery(): Promise<void>;
  dispose(): void;
}

function formatCount(total: number): string {
  return `${total} ${total === 1 ? 'note' : 'notes'}`;
}

export function createDashboardController(options: {
  shell: DashboardShell;
  theme: ThemeManager;
  client: ApiClient;
  store?: DashboardStore;
}): DashboardController {
  const { shell, theme, client } = options;
  const store = options.store ?? createDashboardStore();

  const disposers: Array<() => void> = [];
  let disposed = false;

  /* --------------------------- rendering ---------------------------- */

  function render(state: DashboardState): void {
    shell.setResultsHeading(
      state.query.trim().length > 0 ? 'Search results' : 'All notes',
      formatCount(state.total),
    );
    const region = shell.elements.resultsRegion;

    if (state.status === 'loading') {
      region.setAttribute('aria-busy', 'true');
      showLoading(region, 'Loading notes…', 'Reading your local database.');
      return;
    }
    region.setAttribute('aria-busy', 'false');

    if (state.status === 'error' && state.loadError) {
      showError(region, 'Could not load notes', state.loadError.message, {
        label: 'Try again',
        onRetry: () => void refresh(),
      });
      return;
    }

    if (state.notes.length === 0) {
      showEmpty(
        region,
        state.query.trim().length > 0 ? 'No matching notes' : 'No notes yet',
        state.query.trim().length > 0
          ? 'Try different search terms or clear the search.'
          : 'Notes you create and pages you save will appear here.',
      );
      return;
    }

    showContent(region);
    // Minimal accessible result list; the card views (T-016) replace this
    // presentation with the full PRD §4.2 card design.
    const list = document.createElement('ul');
    list.className = 'results-list';
    for (const note of state.notes) {
      const item = document.createElement('li');
      item.dataset['noteId'] = note.id;
      const label = document.createElement('span');
      label.className = 'note-row__title';
      label.textContent = note.title.trim().length > 0 ? note.title : 'Untitled';
      const meta = document.createElement('span');
      meta.className = 'note-row__meta';
      meta.textContent = `Modified ${note.updatedAt.slice(0, 10)}`;
      item.append(label, meta);
      list.append(item);
    }
    region.append(list);
  }

  disposers.push(store.subscribe(render));

  /* ---------------------------- actions ----------------------------- */

  async function refresh(): Promise<void> {
    store.setState({ status: 'loading', loadError: null });
    try {
      const [{ settings }, { counts }, result] = await Promise.all([
        client.request('settings/get', {}),
        client.request('notes/counts', {}),
        client.request('search/query', {
          query: store.getState().query,
          filters: store.getState().filters,
          sort: store.getState().sort,
        }),
      ]);
      if (disposed) return;
      theme.setPreference(settings.theme);
      const state = store.getState();
      const notes = await resolveNotes(result.hits.map((hit) => hit.noteId));
      if (disposed) return;
      store.setState({
        status: 'ready',
        loadError: null,
        settings,
        counts,
        total: result.total,
        notes,
        viewMode: state.viewMode,
        sort: settings.defaultSort,
      });
      shell.announce(
        result.total === 0
          ? 'No notes found.'
          : `${result.total} ${result.total === 1 ? 'note' : 'notes'} loaded.`,
      );
    } catch (error) {
      if (disposed) return;
      const coded = error instanceof RpcClientError ? error : null;
      store.setState({
        status: 'error',
        loadError: {
          code: coded?.code ?? 'internal-error',
          message:
            error instanceof Error ? error.message : 'Loading notes failed unexpectedly.',
        },
      });
    }
  }

  /** Hydrates the current result page's notes in list order. */
  async function resolveNotes(ids: readonly EntityId[]): Promise<Note[]> {
    const notes: Note[] = [];
    for (const noteId of ids) {
      try {
        const { note } = await client.request('notes/get', { noteId });
        notes.push(note);
      } catch {
        // A note deleted between search and hydration: skip honestly.
      }
    }
    return notes;
  }

  async function requery(): Promise<void> {
    const state = store.getState();
    try {
      const result = await client.request('search/query', {
        query: state.query,
        filters: state.filters,
        sort: state.sort,
      });
      if (disposed) return;
      const notes = await resolveNotes(result.hits.map((hit) => hit.noteId));
      if (disposed) return;
      store.setState({ total: result.total, notes, status: 'ready', loadError: null });
    } catch (error) {
      if (disposed) return;
      store.setState({
        status: 'error',
        loadError: {
          code: error instanceof RpcClientError ? error.code : 'internal-error',
          message: error instanceof Error ? error.message : 'Search failed.',
        },
      });
    }
  }

  async function createNote(): Promise<EntityId | null> {
    // Optimistic placeholder entry — replaced by the persisted note, or
    // rolled back truthfully on failure.
    const optimistic: Note = {
      id: `optimistic-${Date.now()}` as EntityId,
      title: 'Untitled',
      subtitle: '',
      editorDoc: null,
      plainText: '',
      createdAt: new Date().toISOString() as Note['createdAt'],
      updatedAt: new Date().toISOString() as Note['updatedAt'],
      state: 'active',
      pinned: false,
      favorite: false,
      trashedAt: null,
      archivedAt: null,
      revisionId: null,
      duplicatedFrom: null,
    };
    const before = store.getState().notes;
    store.setState({ notes: [optimistic, ...before], total: store.getState().total + 1 });
    try {
      const { note } = await client.request('notes/create', { title: 'Untitled' });
      if (disposed) return null;
      store.setState({
        notes: [note, ...store.getState().notes.filter((n) => n.id !== optimistic.id)],
      });
      shell.announce('Note created.');
      return note.id;
    } catch (error) {
      if (disposed) return null;
      store.setState({
        notes: store.getState().notes.filter((n) => n.id !== optimistic.id),
        total: store.getState().total - 1,
      });
      shell.announce(
        `Creating the note failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  async function saveNote(input: Parameters<DashboardController['saveNote']>[0]): Promise<Note | null> {
    store.setState({ saveState: 'saving' });
    const before = store.getState().notes;
    const previous = before.find((note) => note.id === input.noteId) ?? null;
    // Optimistic projection of the saved content, only when the note is
    // visible in the current results.
    if (previous) {
      const optimistic: Note = {
        ...previous,
        title: input.title,
        subtitle: input.subtitle,
        plainText: input.plainText,
        updatedAt: new Date().toISOString() as Note['updatedAt'],
      };
      store.setState({
        notes: before.map((note) => (note.id === input.noteId ? optimistic : note)),
      });
    }
    try {
      const { note } = await client.request('notes/save', input);
      if (disposed) return null;
      store.setState({
        saveState: 'saved',
        notes: store.getState().notes.map((n) => (n.id === note.id ? note : n)),
      });
      shell.announce('Note saved.');
      return note;
    } catch (error) {
      if (disposed) return null;
      store.setState({
        saveState: 'save-failed',
        notes: store.getState().notes.map((n) =>
          n.id === input.noteId ? (previous ?? n) : n,
        ),
      });
      shell.announce(
        error instanceof RpcClientError && error.code === 'conflict'
          ? 'Save failed: this note changed in another tab. Reload or save as a duplicate.'
          : 'Save failed. Your latest edit was not written.',
      );
      return null;
    }
  }

  /* --------------------------- shell wiring ------------------------- */

  disposers.push(shell.on('newNote', () => void createNote()));
  disposers.push(shell.on('searchInput', (query) => {
    store.setState({ query });
    void requery();
  }));
  disposers.push(shell.on('searchSubmit', (query) => {
    store.setState({ query });
    void requery();
  }));
  disposers.push(shell.on('sortChange', (field) => {
    const sort = { field: field as DashboardState['sort']['field'], direction: store.getState().sort.direction };
    store.setState({ sort });
    void requery();
  }));
  disposers.push(shell.on('viewModeChange', (viewMode) => {
    store.setState({ viewMode });
  }));

  /* ------------------------ save-state mirror ----------------------- */

  disposers.push(
    store.subscribe((state) => {
      shell.setSaveState(state.saveState);
    }),
  );

  /* ---------------------- navigation guard -------------------------- */

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (store.getState().saveState === 'saving') {
      // Prevents navigation from discarding a pending save (PRD §4.3).
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  disposers.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

  /* ------------------------------ boot ------------------------------ */

  void refresh();

  return {
    store,
    refresh,
    createNote,
    saveNote,
    requery,
    dispose(): void {
      disposed = true;
      for (const dispose of disposers) dispose();
    },
  };
}

export { INITIAL_DASHBOARD_STATE };
