/**
 * Dashboard controller (T-015/T-016): the only writer of the store. Wires
 * shell events to typed service-worker calls, applies optimistic updates
 * with truthful rollback, drives the save-state indicator, renders card
 * views with pagination and multi-select bulk actions, and guards
 * navigation while a save is in flight (PRD §4.2/§4.3).
 */

import type { DashboardShell } from '../shell';
import type { ThemeManager } from '../theme';
import { showContent, showEmpty, showError, showLoading } from '../states';
import { cardViewModel, renderCard, EMPTY_RELATED } from '../views/cards';
import { effectiveFilters, smartListById, type SmartListId } from '../views/smart-lists';
import { createBulkBar, type BulkAction, type BulkBar } from '../views/bulk-bar';
import type { ApiClient } from './client';
import { RpcClientError } from './client';
import { createSnapshotsApi } from './snapshot-client';
import { createRemindersApi } from './reminders-client';
import { createAiApi } from './ai-client';
import { parseNoteFile, exportFileStem } from '../editor/note-transfer';
import { noteMarkdownExport, noteHtmlExport } from '../editor/note-transfer';
import {
  createDashboardStore,
  INITIAL_DASHBOARD_STATE,
  type DashboardStore,
  type DashboardState,
} from './store';
import type { EntityId, Note } from '../../core/types';
import type { RpcErrorCode } from '../../background/protocol';
import { openEditorSession, type EditorSession, type SaveOutcome } from './editor-session';

export interface DashboardController {
  readonly store: DashboardStore;
  /** Reloads settings, counts and results from durable state. */
  refresh(): Promise<void>;
  /** Creates a note (New Note action). Optimistic with truthful rollback. */
  createNote(): Promise<EntityId | null>;
  /** Import a note file (JSON/Markdown/HTML) as a NEW note (FR-DATA-05). */
  importNoteFile(file: File): Promise<EntityId | null>;
  /** Export the note currently open in the editor as a file download. */
  exportOpenNote(format: 'json' | 'markdown' | 'html'): Promise<boolean>;
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
  /** Save with a coded failure outcome (conflict-aware editor flow). */
  saveNoteDetailed(input: {
    noteId: EntityId;
    title: string;
    subtitle: string;
    editorDoc: object | null;
    plainText: string;
    expectedRevisionId: EntityId | null;
    changeSummary: string;
  }): Promise<SaveOutcome>;
  /** Opens the note editor screen (T-018). */
  openEditor(noteId: EntityId): Promise<void>;
  /** Flushes pending autosave and returns to the results list. */
  closeEditor(): Promise<void>;
  /** Re-runs the current query (filters/sort/page changes). */
  requery(): Promise<void>;
  /** Applies a bulk action to the current selection. */
  applyBulkAction(action: BulkAction): Promise<void>;
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

  /* --------------------------- bulk bar ----------------------------- */

  const bulkBar: BulkBar = createBulkBar({
    onAction: (action) => void applyBulkAction(action),
    onClearSelection: () => store.setState({ selection: new Set<EntityId>() }),
  });
  shell.elements.bulkBarMount.append(bulkBar.element);

  /* --------------------------- editor route -------------------------- */

  let editorSession: EditorSession | null = null;
  const editorMount = document.createElement('div');
  editorMount.className = 'editor-mount';
  editorMount.hidden = true;
  shell.elements.resultsRegion.parentElement?.appendChild(editorMount);

  function showView(view: 'list' | 'editor'): void {
    const editing = view === 'editor';
    shell.elements.resultsRegion.hidden = editing;
    shell.elements.resultsHeading.hidden = editing;
    shell.elements.paginationPrev.parentElement?.toggleAttribute('hidden', editing);
    editorMount.hidden = !editing;
    store.setState({ view });
  }

  /* --------------------------- rendering ---------------------------- */

  function nowIso(): string {
    return new Date().toISOString();
  }

  function render(state: DashboardState): void {
    const list = smartListById(state.smartList);
    shell.setResultsHeading(
      state.query.trim().length > 0 ? 'Search results' : list.label,
      formatCount(state.total),
    );
    shell.setActiveSmartList(state.smartList);

    const region = shell.elements.resultsRegion;
    if (state.status === 'loading') {
      region.setAttribute('aria-busy', 'true');
      showLoading(region, 'Loading notes…', 'Reading your local database.');
      syncChrome(state);
      return;
    }
    region.setAttribute('aria-busy', 'false');

    if (state.status === 'error' && state.loadError) {
      showError(region, 'Could not load notes', state.loadError.message, {
        label: 'Try again',
        onRetry: () => void refresh(),
      });
      syncChrome(state);
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
      syncChrome(state);
      return;
    }

    showContent(region);
    const grid = document.createElement('div');
    grid.className = state.viewMode === 'grid' ? 'results-grid' : 'results-list';
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Notes');
    const now = nowIso() as Note['updatedAt'];
    for (const note of state.notes) {
      const related = state.related[note.id] ?? EMPTY_RELATED;
      const model = cardViewModel(note, related, now);
      const card = renderCard(model, {
        viewMode: state.viewMode,
        selected: state.selection.has(note.id),
        onToggleSelect: (noteId) => toggleSelection(noteId),
        onOpen: (noteId) => void openEditor(noteId),
      });
      const wrapper = document.createElement('div');
      wrapper.className = 'results-item';
      wrapper.setAttribute('role', 'listitem');
      wrapper.append(card);
      grid.append(wrapper);
    }
    region.append(grid);
    syncChrome(state);
  }

  /** Mirrors store state into shell chrome (pagination, select-all, bulk). */
  function syncChrome(state: DashboardState): void {
    const pageCount = Math.max(1, Math.ceil(state.total / state.pageSize));
    const from = (state.page - 1) * state.pageSize;
    const to = Math.min(from + state.notes.length, state.total);
    shell.setPagination({ page: state.page, pageCount, from, to, total: state.total });

    const pageNoteIds = state.notes.map((note) => note.id);
    const selectedOnPage = pageNoteIds.filter((id) => state.selection.has(id));
    shell.setSelectAllState({
      checked: pageNoteIds.length > 0 && selectedOnPage.length === pageNoteIds.length,
      indeterminate: selectedOnPage.length > 0 && selectedOnPage.length < pageNoteIds.length,
      pageNoteIds,
    });

    const list = state.smartList;
    bulkBar.update({
      selectedCount: selectedOnPage.length,
      totalSelected: state.selection.size,
      viewAllows: {
        pin: list !== 'trashed' && list !== 'archived',
        archive: list !== 'trashed' && list !== 'archived',
        restore: list === 'archived' || list === 'trashed',
        trash: list !== 'trashed',
        deletePermanently: list === 'trashed',
      },
      tags: state.allTags,
      categories: state.allCategories,
    });
  }

  disposers.push(store.subscribe(render));

  /* ---------------------------- actions ----------------------------- */

  async function loadOrganization(): Promise<void> {
    try {
      const [{ tags }, { categories }] = await Promise.all([
        client.request('tags/list', {}),
        client.request('categories/list', {}),
      ]);
      if (disposed) return;
      store.setState({ allTags: tags, allCategories: categories });
    } catch {
      // Organization data is decorative for cards; failing to load it must
      // not fail the results view.
    }
  }

  async function refresh(): Promise<void> {
    store.setState({ status: 'loading', loadError: null });
    try {
      const [{ settings }, { counts }] = await Promise.all([
        client.request('settings/get', {}),
        client.request('notes/counts', {}),
      ]);
      if (disposed) return;
      theme.setPreference(settings.theme);
      store.setState({ settings, counts });
      await Promise.all([requery(), loadOrganization()]);
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

  async function hydrateRelated(notes: readonly Note[]): Promise<void> {
    if (notes.length === 0) {
      store.setState({ related: {} });
      return;
    }
    try {
      const { related } = await client.request('notes/related-bulk', {
        noteIds: notes.map((note) => note.id),
      });
      if (disposed) return;
      store.setState({ related });
    } catch {
      // Cards degrade to note-only fields; indicators simply hide.
    }
  }

  async function requery(): Promise<void> {
    const state = store.getState();
    const list = smartListById(state.smartList);
    try {
      const result = await client.request('search/query', {
        query: state.query,
        filters: effectiveFilters(list, state.filters),
        sort: state.sort,
        limit: state.pageSize,
        offset: (state.page - 1) * state.pageSize,
      });
      if (disposed) return;
      const notes = await resolveNotes(result.hits.map((hit) => hit.noteId));
      if (disposed) return;
      // Drop selections that no longer appear anywhere in the results.
      const visible = new Set(notes.map((note) => note.id));
      const selection = new Set<EntityId>([...state.selection].filter((id) => visible.has(id)));
      const selectionChanged = selection.size !== state.selection.size;
      store.setState({
        total: result.total,
        notes,
        status: 'ready',
        loadError: null,
        ...(selectionChanged ? { selection } : {}),
      });
      await hydrateRelated(notes);
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
      createdAt: nowIso() as Note['createdAt'],
      updatedAt: nowIso() as Note['updatedAt'],
      state: 'active',
      pinned: false,
      favorite: false,
      trashedAt: null,
      archivedAt: null,
      revisionId: null,
      duplicatedFrom: null,
    };
    store.setState({ notes: [optimistic, ...store.getState().notes], total: store.getState().total + 1 });
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
    const outcome = await saveNoteDetailed(input);
    return outcome.ok ? outcome.note : null;
  }

  async function saveNoteDetailed(input: Parameters<DashboardController['saveNote']>[0]): Promise<SaveOutcome> {
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
        updatedAt: nowIso() as Note['updatedAt'],
      };
      store.setState({
        notes: before.map((note) => (note.id === input.noteId ? optimistic : note)),
      });
    }
    try {
      const { note } = await client.request('notes/save', input);
      if (disposed) return { ok: false, code: 'internal-error' as RpcErrorCode };
      store.setState({
        saveState: 'saved',
        notes: store.getState().notes.map((n) => (n.id === note.id ? note : n)),
      });
      shell.announce('Note saved.');
      return { ok: true, note };
    } catch (error) {
      if (disposed) return { ok: false, code: 'internal-error' as RpcErrorCode };
      const code: RpcErrorCode = error instanceof RpcClientError ? error.code : 'internal-error';
      store.setState({
        saveState: 'save-failed',
        notes: store.getState().notes.map((n) => (n.id === input.noteId ? (previous ?? n) : n)),
      });
      shell.announce(
        code === 'conflict'
          ? 'Save failed: this note changed in another tab. Reload or save as a duplicate.'
          : 'Save failed. Your latest edit was not written.',
      );
      return { ok: false, code };
    }
  }

  async function importNoteFile(file: File): Promise<EntityId | null> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      shell.announce('Reading the file failed — nothing was imported.');
      return null;
    }
    const parsed = parseNoteFile(file.name, text);
    if (!parsed.ok) {
      shell.announce(`Import failed: ${parsed.error}`);
      return null;
    }
    const draft = parsed.file;
    try {
      const { note } = await client.request('notes/create', {
        title: draft.title,
        editorDoc: draft.editorDoc,
        plainText: draft.plainText,
      });
      // Recreate tags/categories by name (best effort, truthful report).
      for (const name of draft.tags) {
        try {
          const { tag } = await client.request('tags/create', { name });
          await client.request('tags/set-note-tags', { noteId: note.id, tagIds: [tag.id] });
        } catch {
          // A duplicate name just means the tag exists; assignment below.
        }
      }
      for (const name of draft.categories) {
        try {
          const { category } = await client.request('categories/create', { name });
          await client.request('categories/set-note-categories', {
            noteId: note.id,
            categoryIds: [category.id],
          });
        } catch {
          // Same tolerance as tags.
        }
      }
      await openEditor(note.id);
      // Rich body (Markdown/HTML imports): load the sanitized HTML into the
      // freshly opened editor; the session's autosave persists it.
      if (parsed.file.bodyHtml !== null && editorSession) {
        editorSession.editor.commands.setContent(parsed.file.bodyHtml);
      }
      const removalNote =
        parsed.file.removed.length > 0
          ? ` ${parsed.file.removed.length} unsafe element(s) were removed during import.`
          : '';
      shell.announce(`Imported "${draft.title}" as a new note.${removalNote}`);
      await refresh();
      return note.id;
    } catch (error) {
      shell.announce(
        `Creating the imported note failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  async function exportOpenNote(format: 'json' | 'markdown' | 'html'): Promise<boolean> {
    const noteId = store.getState().editingNoteId;
    if (noteId === null || editorSession === null) {
      shell.announce('Open a note in the editor before exporting it.');
      return false;
    }
    const title = editorSession.editor.getText().length > 0 ? store.getState().notes.find((n) => n.id === noteId)?.title ?? 'Untitled note' : 'Untitled note';
    const subtitle = '';
    const stem = exportFileStem(title);
    try {
      if (format === 'json') {
        const { blob, filename } = await client.request('notes/export-file', { noteId });
        triggerDownload(filename, blob);
        shell.announce(`Exported ${filename}.`);
        return true;
      }
      const editorHtml = editorSession.editor.getHTML();
      if (format === 'markdown') {
        const blob = new Blob([noteMarkdownExport(title, subtitle, editorHtml)], {
          type: 'text/markdown',
        });
        triggerDownload(`${stem}.md`, blob);
        shell.announce(`Exported ${stem}.md.`);
        return true;
      }
      const blob = new Blob([noteHtmlExport(title, subtitle, editorHtml)], {
        type: 'text/html',
      });
      triggerDownload(`${stem}.html`, blob);
      shell.announce(`Exported ${stem}.html.`);
      return true;
    } catch (error) {
      shell.announce(
        `Exporting the note failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  function triggerDownload(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function openEditor(noteId: EntityId): Promise<void> {
    if (editorSession) await closeEditor();
    try {
      const { note } = await client.request('notes/get', { noteId });
      if (disposed) return;
      editorSession = await openEditorSession({
        mount: editorMount,
        note,
        callbacks: {
          getRevisions: async (id) => (await client.request('notes/revisions', { noteId: id })).revisions,
          saveNoteDetailed,
          getNote: async (id) => (await client.request('notes/get', { noteId: id })).note,
          duplicateWithContent: async (input) => {
            try {
              const { note: duplicate } = await client.request('notes/duplicate', {
                noteId: input.sourceNoteId,
              });
              await client.request('notes/save', {
                noteId: duplicate.id,
                title: input.title,
                subtitle: input.subtitle,
                editorDoc: input.editorDoc,
                plainText: input.plainText,
                expectedRevisionId: duplicate.revisionId,
                changeSummary: 'saved as duplicate after conflict',
              });
              return duplicate.id;
            } catch {
              return null;
            }
          },
          announce: (message) => shell.announce(message),
          onOpenLink: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
          detectLinks: async (input) => {
            try {
              const { results } = await client.request('links/detect-and-queue', {
                noteId: input.noteId,
                urls: [...input.urls],
                source: input.source,
              });
              return {
                created: results.filter((r) => r.outcome === 'created').length,
                queued: results.filter((r) => r.link?.captureState === 'queued').length,
                existing: results.filter((r) => r.outcome === 'existing').length,
                rejected: results.filter((r) => r.outcome === 'rejected').length,
              };
            } catch {
              return null;
            }
          },
          attachments: {
            add: async (input) =>
              client.request('attachments/add', {
                noteId: input.noteId,
                filename: input.filename,
                declaredMimeType: input.declaredMimeType,
                data: input.data,
              }),
            list: async (id) => (await client.request('attachments/list-for-note', { noteId: id })).attachments,
            getBlob: async (attachmentId) =>
              (await client.request('attachments/get-blob', { attachmentId })).blob,
            rename: async (attachmentId, filename) => {
              try {
                await client.request('attachments/rename', { attachmentId, filename });
                return true;
              } catch {
                return false;
              }
            },
            remove: async (attachmentId) => {
              try {
                await client.request('attachments/delete', { attachmentId });
                return true;
              } catch {
                return false;
              }
            },
          },
          snapshots: createSnapshotsApi(client),
          reminders: createRemindersApi(client),
          ai: createAiApi(client),
          transfer: {
            exportFile: async (noteId) => client.request('notes/export-file', { noteId }),
          },
        },
      });
      showView('editor');
      store.setState({ editingNoteId: noteId });
      shell.announce(`Editing ${note.title.trim().length > 0 ? note.title : 'untitled note'}.`);
    } catch (error) {
      shell.announce(
        `Opening the note failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  async function closeEditor(): Promise<void> {
    await editorSession?.close();
    editorSession = null;
    showView('list');
    store.setState({ editingNoteId: null });
    await requery();
  }

  /* ------------------------- selection / bulk ----------------------- */

  function toggleSelection(noteId: EntityId): void {
    const state = store.getState();
    const selection = new Set(state.selection);
    if (selection.has(noteId)) selection.delete(noteId);
    else selection.add(noteId);
    store.setState({ selection });
  }

  function selectAllOnPage(checked: boolean): void {
    const state = store.getState();
    const selection = new Set(state.selection);
    for (const note of state.notes) {
      if (checked) selection.add(note.id);
      else selection.delete(note.id);
    }
    store.setState({ selection });
  }

  async function applyBulkAction(action: BulkAction): Promise<void> {
    const state = store.getState();
    const targets = [...state.selection];
    if (targets.length === 0) return;

    let succeeded = 0;
    const failures: string[] = [];

    const runOne = async (operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
        succeeded += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'unknown failure');
      }
    };

    if (action.kind === 'pin') {
      for (const noteId of targets) {
        await runOne(() => client.request('notes/set-flags', { noteId, pinned: action.value }));
      }
    } else if (action.kind === 'archive') {
      for (const noteId of targets) {
        await runOne(() => client.request('notes/archive', { noteId }));
      }
    } else if (action.kind === 'restore') {
      for (const noteId of targets) {
        await runOne(() => client.request('notes/restore', { noteId }));
      }
    } else if (action.kind === 'trash') {
      for (const noteId of targets) {
        await runOne(() => client.request('notes/trash', { noteId }));
      }
    } else if (action.kind === 'delete-permanently') {
      for (const noteId of targets) {
        await runOne(() =>
          client.request('notes/delete-permanently', { noteId, confirm: true }),
        );
      }
    } else if (action.kind === 'assign-tags') {
      const tagIds: EntityId[] = [...action.tagIds];
      for (const name of action.newTags) {
        await runOne(async () => {
          const { tag } = await client.request('tags/create', { name });
          tagIds.push(tag.id);
        });
      }
      if (tagIds.length > 0) {
        await runOne(() =>
          client.request('tags/assign-to-notes', { noteIds: targets, tagIds }),
        );
      }
    } else if (action.kind === 'assign-category') {
      let categoryId: EntityId | null = action.categoryId;
      if (action.newCategoryName) {
        try {
          const { category } = await client.request('categories/create', {
            name: action.newCategoryName,
          });
          categoryId = category.id;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : 'category creation failed');
        }
      }
      if (categoryId) {
        await runOne(() =>
          client.request('categories/assign-to-notes', { noteIds: targets, categoryIds: [categoryId] }),
        );
      }
    }

    const verb =
      action.kind === 'pin'
        ? action.value ? 'Pin' : 'Unpin'
        : action.kind === 'assign-tags'
          ? 'Tag assignment'
          : action.kind === 'assign-category'
            ? 'Category assignment'
            : action.kind === 'delete-permanently'
              ? 'Permanent deletion'
              : action.kind.charAt(0).toUpperCase() + action.kind.slice(1);

    if (disposed) return;
    store.setState({ selection: new Set<EntityId>() });
    await requery();
    await loadOrganization();

    if (failures.length === 0) {
      shell.announce(`${verb}: ${succeeded} ${succeeded === 1 ? 'note' : 'notes'} updated.`);
    } else {
      shell.announce(
        `${verb}: ${succeeded} succeeded, ${failures.length} failed — ${failures[0]}`,
      );
    }
  }

  /* --------------------------- shell wiring ------------------------- */

  disposers.push(shell.on('newNote', () => void createNote()));
  disposers.push(shell.on('importNote', (file) => void importNoteFile(file)));
  disposers.push(shell.on('searchInput', (query) => {
    store.setState({ query, page: 1 });
    void requery();
  }));
  disposers.push(shell.on('searchSubmit', (query) => {
    store.setState({ query, page: 1 });
    void requery();
  }));
  disposers.push(shell.on('sortChange', (field) => {
    const sort = {
      field: field as DashboardState['sort']['field'],
      direction: store.getState().sort.direction,
    };
    store.setState({ sort, page: 1 });
    void requery();
  }));
  disposers.push(shell.on('viewModeChange', (viewMode) => {
    store.setState({ viewMode });
  }));
  disposers.push(shell.on('smartListChange', (smartList: SmartListId) => {
    store.setState({ smartList, page: 1, selection: new Set<EntityId>() });
    void requery();
    shell.setActiveSmartList(smartList);
  }));
  disposers.push(shell.on('pagePrev', () => {
    const page = Math.max(1, store.getState().page - 1);
    if (page === store.getState().page) return;
    store.setState({ page });
    void requery();
  }));
  disposers.push(shell.on('pageNext', () => {
    const state = store.getState();
    const pageCount = Math.max(1, Math.ceil(state.total / state.pageSize));
    const page = Math.min(pageCount, state.page + 1);
    if (page === state.page) return;
    store.setState({ page });
    void requery();
  }));
  disposers.push(shell.on('selectAllPage', (checked) => selectAllOnPage(checked)));

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
    importNoteFile,
    exportOpenNote,
    saveNote,
    saveNoteDetailed,
    openEditor,
    closeEditor,
    requery,
    applyBulkAction,
    dispose(): void {
      disposed = true;
      void editorSession?.close();
      editorMount.remove();
      for (const dispose of disposers) dispose();
      bulkBar.element.remove();
    },
  };
}

export { INITIAL_DASHBOARD_STATE };
