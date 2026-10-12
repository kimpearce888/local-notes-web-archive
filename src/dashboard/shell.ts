/**
 * Dashboard shell (PRD §4.1): renders the top-to-bottom layout —
 *   1. New Note action
 *   2. Global search field and filter controls
 *   3. Active filters, saved views and sort controls
 *   4. Cards/list results region
 *
 * The shell owns structure, semantics, theming hooks and keyboard
 * operability. Data flow (state manager, messaging client) and result
 * cards subscribe through the event API below (T-015/T-016).
 */

import type { ThemePreference } from './theme';

export interface ShellEvents {
  /** New Note action activated (button click or ui-intent). */
  newNote: () => void;
  /** Search input changed (raw value; parsing belongs to the store). */
  searchInput: (query: string) => void;
  /** Search submitted (Enter). */
  searchSubmit: (query: string) => void;
  /** Sort order changed. */
  sortChange: (field: string) => void;
  /** View mode changed (grid/list). */
  viewModeChange: (mode: 'grid' | 'list') => void;
  /** Filters disclosure toggled. */
  filtersToggle: (open: boolean) => void;
}

export interface ShellElements {
  readonly root: HTMLElement;
  readonly skipLink: HTMLAnchorElement;
  readonly newNoteButton: HTMLButtonElement;
  readonly searchInput: HTMLInputElement;
  readonly filtersButton: HTMLButtonElement;
  readonly sortSelect: HTMLSelectElement;
  readonly viewToggle: HTMLElement;
  readonly activeFilters: HTMLElement;
  readonly filtersRegion: HTMLElement;
  readonly resultsRegion: HTMLElement;
  readonly resultsHeading: HTMLElement;
  readonly resultsTitle: HTMLHeadingElement;
  readonly resultsCount: HTMLElement;
  readonly liveRegion: HTMLElement;
  readonly saveState: HTMLElement;
}

export interface DashboardShell {
  readonly elements: ShellElements;
  on<K extends keyof ShellEvents>(event: K, listener: ShellEvents[K]): () => void;
  /** Announces a message politely to assistive technology. */
  announce(message: string): void;
  /** Sets the visible save state label (PRD §4.3: Saving/Saved/Save failed). */
  setSaveState(state: 'idle' | 'saving' | 'saved' | 'save-failed'): void;
  /** Updates the results heading and count label. */
  setResultsHeading(title: string, countText: string): void;
  dispose(): void;
}

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'modified', label: 'Last modified' },
  { value: 'created', label: 'Date created' },
  { value: 'title', label: 'Title' },
  { value: 'reminder', label: 'Reminder due' },
  { value: 'capture', label: 'Capture date' },
  { value: 'relevance', label: 'Relevance' },
];

export function mountDashboardShell(root: HTMLElement): DashboardShell {
  const disposers: Array<() => void> = [];

  /* ---------------------------- Header ------------------------------ */

  const header = document.createElement('header');
  header.className = 'app-header';

  const headerInner = document.createElement('div');
  headerInner.className = 'app-header__inner';

  const headerRow = document.createElement('div');
  headerRow.className = 'app-header__row';

  const title = document.createElement('h1');
  title.className = 'app-title';
  const mark = document.createElement('img');
  mark.className = 'app-title__mark';
  // Relative to dist/dashboard.html; public/icons is copied verbatim.
  mark.src = 'icons/icon-32.png';
  mark.alt = '';
  const titleText = document.createElement('span');
  titleText.textContent = 'Local Notes & Web Archive';
  title.append(mark, titleText);

  const newNoteButton = document.createElement('button');
  newNoteButton.type = 'button';
  newNoteButton.className = 'btn btn--primary';
  newNoteButton.dataset['action'] = 'new-note';
  newNoteButton.textContent = 'New Note';

  headerRow.append(title, newNoteButton);

  /* -------------------------- Search row ---------------------------- */

  const searchForm = document.createElement('form');
  searchForm.role = 'search';
  searchForm.className = 'search-form';
  searchForm.setAttribute('aria-label', 'Note search');

  const searchLabel = document.createElement('label');
  searchLabel.className = 'visually-hidden';
  searchLabel.htmlFor = 'search-input';
  searchLabel.textContent = 'Search notes, tags, archived pages and attachments';

  const searchInput = document.createElement('input');
  searchInput.className = 'search-input';
  searchInput.id = 'search-input';
  searchInput.type = 'search';
  searchInput.name = 'query';
  searchInput.placeholder = 'Search notes, tags, snapshots…';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;

  const filtersButton = document.createElement('button');
  filtersButton.type = 'button';
  filtersButton.className = 'btn';
  filtersButton.dataset['action'] = 'toggle-filters';
  filtersButton.textContent = 'Filters';
  filtersButton.setAttribute('aria-expanded', 'false');
  filtersButton.setAttribute('aria-controls', 'filters-region');

  searchForm.append(searchLabel, searchInput, filtersButton);

  /* --------------------------- Toolbar ------------------------------ */

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Active filters, saved views, view mode and sorting');

  const activeFilters = document.createElement('ul');
  activeFilters.className = 'chips';
  activeFilters.id = 'active-filters';
  activeFilters.setAttribute('aria-label', 'Active filters');

  const spacer = document.createElement('div');
  spacer.className = 'toolbar__spacer';

  const sortLabel = document.createElement('label');
  sortLabel.className = 'visually-hidden';
  sortLabel.htmlFor = 'sort-select';
  sortLabel.textContent = 'Sort notes by';

  const sortSelect = document.createElement('select');
  sortSelect.className = 'select';
  sortSelect.id = 'sort-select';
  sortSelect.dataset['action'] = 'sort';
  for (const option of SORT_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    sortSelect.append(element);
  }
  sortSelect.value = 'modified';

  const viewToggle = document.createElement('div');
  viewToggle.className = 'view-toggle';
  viewToggle.setAttribute('role', 'radiogroup');
  viewToggle.setAttribute('aria-label', 'View mode');
  const gridOption = document.createElement('button');
  gridOption.type = 'button';
  gridOption.className = 'view-toggle__option';
  gridOption.setAttribute('role', 'radio');
  gridOption.setAttribute('aria-checked', 'true');
  gridOption.dataset['view'] = 'grid';
  gridOption.textContent = 'Grid';
  const listOption = document.createElement('button');
  listOption.type = 'button';
  listOption.className = 'view-toggle__option';
  listOption.setAttribute('role', 'radio');
  listOption.setAttribute('aria-checked', 'false');
  listOption.dataset['view'] = 'list';
  listOption.textContent = 'List';
  viewToggle.append(gridOption, listOption);

  toolbar.append(activeFilters, spacer, sortLabel, sortSelect, viewToggle);

  headerInner.append(headerRow, searchForm, toolbar);
  header.append(headerInner);

  /* ------------------------- Filters region ------------------------- */

  const filtersRegion = document.createElement('div');
  filtersRegion.id = 'filters-region';
  filtersRegion.className = 'filters-region';
  filtersRegion.hidden = true;

  /* ------------------------------ Main ------------------------------ */

  const main = document.createElement('main');
  main.id = 'results';
  main.className = 'app-main';
  main.tabIndex = -1;

  const mainInner = document.createElement('div');
  mainInner.className = 'app-main__inner';

  const resultsHeading = document.createElement('div');
  resultsHeading.className = 'results-heading';
  const resultsTitle = document.createElement('h2');
  resultsTitle.textContent = 'All notes';
  const resultsCount = document.createElement('span');
  resultsCount.className = 'results-count';
  resultsCount.id = 'results-count';
  resultsHeading.append(resultsTitle, resultsCount);

  const resultsRegion = document.createElement('div');
  resultsRegion.id = 'results-region';
  resultsRegion.className = 'results';
  resultsRegion.setAttribute('aria-live', 'polite');
  resultsRegion.setAttribute('aria-busy', 'false');

  mainInner.append(resultsHeading, resultsRegion);
  main.append(mainInner);

  /* ---------------------------- Status bar -------------------------- */

  const statusBar = document.createElement('footer');
  statusBar.className = 'status-bar';
  const statusInner = document.createElement('div');
  statusInner.className = 'status-bar__inner';
  const statusMessage = document.createElement('p');
  statusMessage.className = 'status-bar__message';
  const saveState = document.createElement('span');
  saveState.className = 'save-state';
  saveState.id = 'save-state';
  saveState.textContent = '';
  statusInner.append(statusMessage, saveState);
  statusBar.append(statusInner);

  const liveRegion = document.createElement('p');
  liveRegion.id = 'live-region';
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.textContent = '';

  /* ----------------------------- Wiring ----------------------------- */

  const skipLink = document.createElement('a');
  skipLink.className = 'skip-link';
  skipLink.href = '#results';
  skipLink.textContent = 'Skip to notes list';

  const app = document.createElement('div');
  app.className = 'app';
  app.append(header, filtersRegion, main, statusBar);
  root.replaceChildren(skipLink, app, liveRegion);

  type EventKey = keyof ShellEvents;
  const listeners: { [K in EventKey]: Array<ShellEvents[K]> } = {
    newNote: [],
    searchInput: [],
    searchSubmit: [],
    sortChange: [],
    viewModeChange: [],
    filtersToggle: [],
  };

  const emit = <K extends EventKey>(event: K, ...args: Parameters<ShellEvents[K]>): void => {
    for (const listener of [...listeners[event]]) {
      (listener as (...a: Parameters<ShellEvents[K]>) => void)(...args);
    }
  };

  const onNewNoteClick = (): void => emit('newNote');
  newNoteButton.addEventListener('click', onNewNoteClick);
  disposers.push(() => newNoteButton.removeEventListener('click', onNewNoteClick));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const onSearchInput = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      emit('searchInput', searchInput.value);
    }, 150);
  };
  searchInput.addEventListener('input', onSearchInput);
  disposers.push(() => {
    searchInput.removeEventListener('input', onSearchInput);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  });

  const onSearchSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    emit('searchSubmit', searchInput.value);
  };
  searchForm.addEventListener('submit', onSearchSubmit);
  disposers.push(() => searchForm.removeEventListener('submit', onSearchSubmit));

  const onSortChange = (): void => emit('sortChange', sortSelect.value);
  sortSelect.addEventListener('change', onSortChange);
  disposers.push(() => sortSelect.removeEventListener('change', onSortChange));

  const onViewClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const mode = target.dataset['view'];
    if (mode !== 'grid' && mode !== 'list') return;
    for (const option of [gridOption, listOption]) {
      option.setAttribute('aria-checked', option.dataset['view'] === mode ? 'true' : 'false');
    }
    emit('viewModeChange', mode);
  };
  viewToggle.addEventListener('click', onViewClick);
  disposers.push(() => viewToggle.removeEventListener('click', onViewClick));

  const onFiltersClick = (): void => {
    const open = filtersRegion.hidden;
    filtersRegion.hidden = !open;
    filtersButton.setAttribute('aria-expanded', String(open));
    emit('filtersToggle', open);
  };
  filtersButton.addEventListener('click', onFiltersClick);
  disposers.push(() => filtersButton.removeEventListener('click', onFiltersClick));

  /** Global keyboard shortcuts: Ctrl/Cmd+K or "/" focuses search. */
  const onKeyDown = (event: KeyboardEvent): void => {
    const inTextField =
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (event.key === '/' && !inTextField) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  disposers.push(() => document.removeEventListener('keydown', onKeyDown));

  const elements: ShellElements = {
    root,
    skipLink,
    newNoteButton,
    searchInput,
    filtersButton,
    sortSelect,
    viewToggle,
    activeFilters,
    filtersRegion,
    resultsRegion,
    resultsHeading,
    resultsTitle,
    resultsCount,
    liveRegion,
    saveState,
  };

  return {
    elements,
    on<K extends EventKey>(event: K, listener: ShellEvents[K]): () => void {
      listeners[event].push(listener);
      return () => {
        const bucket = listeners[event] as Array<ShellEvents[K]>;
        const index = bucket.indexOf(listener);
        if (index >= 0) bucket.splice(index, 1);
      };
    },
    announce(message: string): void {
      // Replacing the node's text content (rather than mutating a live
      // region in place) reliably triggers re-announcement in assistive
      // tech; the frame callback falls back to a microtask-style timeout
      // where requestAnimationFrame is unavailable (test hosts).
      liveRegion.textContent = '';
      const deliver = (): void => {
        liveRegion.textContent = message;
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(deliver);
      } else {
        window.setTimeout(deliver, 0);
      }
    },
    setSaveState(state: 'idle' | 'saving' | 'saved' | 'save-failed'): void {
      const labels: Record<typeof state, string> = {
        idle: '',
        saving: 'Saving…',
        saved: 'Saved',
        'save-failed': 'Save failed',
      };
      saveState.textContent = labels[state];
      saveState.dataset['saveState'] = state;
      if (state === 'save-failed') {
        saveState.style.color = 'var(--color-danger)';
      } else if (state === 'saved') {
        saveState.style.color = 'var(--color-success)';
      } else {
        saveState.style.color = '';
      }
    },
    setResultsHeading(titleText: string, countText: string): void {
      resultsTitle.textContent = titleText;
      resultsCount.textContent = countText;
    },
    dispose(): void {
      for (const dispose of disposers) dispose();
    },
  };
}

/** Theme preference hint carried by the entry document (set pre-paint). */
export function initialThemePreference(): ThemePreference {
  const value = document.documentElement.dataset['theme'];
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}
