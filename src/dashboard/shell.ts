/**
 * Dashboard shell (PRD §4.1): renders the app layout —
 *   1. A persistent sidebar: brand, the New Note action, the smart-list
 *      navigation and the secondary actions (import, settings, diagnostics)
 *   2. A content column: global search field and filter controls
 *   3. Active filters, saved views and sort controls
 *   4. Cards/list results region
 *
 * Redesigned in T-056 (Linear/Arc-style sidebar layout) with 100% feature
 * parity: every element id, accessible name, aria attribute, data-action
 * hook and the PRD §4.1 top-to-bottom DOM order (New Note → search →
 * toolbar → results) is preserved — the sidebar simply precedes the
 * content column in the document.
 *
 * The shell owns structure, semantics, theming hooks and keyboard
 * operability. Data flow (state manager, messaging client) and result
 * cards subscribe through the event API below (T-015/T-016).
 */

import type { ThemePreference } from './theme';
import { SMART_LISTS, type SmartListId } from './views/smart-lists';
import { icon, type IconName } from './views/icons';

/** Decorative glyphs per smart list (labels carry the meaning). */
const SMART_LIST_ICONS: Readonly<Record<SmartListId, IconName>> = {
  all: 'layers',
  pinned: 'pin',
  favorites: 'star',
  recent: 'clock',
  overdue: 'alarm',
  archived: 'archive',
  trashed: 'trash',
};

export interface ShellEvents {
  /** New Note action activated (button click or ui-intent). */
  newNote: () => void;
  /** Import a note file (JSON/Markdown/HTML) as a new note (FR-DATA-05). */
  importNote: (file: File) => void;
  /** Diagnostics view requested (FR-LOG-05). */
  diagnosticsOpen: () => void;
  /** Settings view requested (FR-SET-01). */
  settingsOpen: () => void;
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
  /** Smart list switched (all/pinned/favorites/recent/overdue/archived/trashed). */
  smartListChange: (list: SmartListId) => void;
  /** Command palette requested (Ctrl/Cmd+K or the palette button). */
  commandPaletteOpen: () => void;
  /** Previous results page requested. */
  pagePrev: () => void;
  /** Next results page requested. */
  pageNext: () => void;
  /** Select-all-on-page checkbox toggled. */
  selectAllPage: (checked: boolean) => void;
}

export interface ShellElements {
  readonly root: HTMLElement;
  readonly skipLink: HTMLAnchorElement;
  readonly newNoteButton: HTMLButtonElement;
  readonly importNoteButton: HTMLButtonElement;
  readonly settingsButton: HTMLButtonElement;
  readonly diagnosticsButton: HTMLButtonElement;
  readonly paletteButton: HTMLButtonElement;
  readonly searchInput: HTMLInputElement;
  readonly filtersButton: HTMLButtonElement;
  readonly sortSelect: HTMLSelectElement;
  readonly viewToggle: HTMLElement;
  readonly activeFilters: HTMLElement;
  readonly filtersRegion: HTMLElement;
  readonly smartNav: HTMLElement;
  readonly bulkBarMount: HTMLElement;
  readonly resultsRegion: HTMLElement;
  readonly resultsHeading: HTMLElement;
  readonly resultsTitle: HTMLHeadingElement;
  readonly resultsCount: HTMLElement;
  readonly selectAllCheckbox: HTMLInputElement;
  readonly paginationPrev: HTMLButtonElement;
  readonly paginationNext: HTMLButtonElement;
  readonly paginationLabel: HTMLElement;
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
  /** Marks the active smart list button (aria-current). */
  setActiveSmartList(list: SmartListId): void;
  /** Updates pagination controls. */
  setPagination(input: { page: number; pageCount: number; from: number; to: number; total: number }): void;
  /** Syncs the select-all checkbox with the page selection state. */
  setSelectAllState(input: { checked: boolean; indeterminate: boolean; pageNoteIds: readonly string[] }): void;
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

  /* ----------------------------- Sidebar ------------------------------ */

  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar';

  const brand = document.createElement('div');
  brand.className = 'sidebar__brand';

  const title = document.createElement('h1');
  title.className = 'app-title';
  const mark = document.createElement('img');
  mark.className = 'app-title__mark';
  // Relative to dist/dashboard.html; public/icons is copied verbatim.
  mark.src = 'icons/icon-32.png';
  mark.alt = '';
  const titleText = document.createElement('span');
  titleText.className = 'app-title__text';
  titleText.textContent = 'Local Notes & Web Archive';
  title.append(mark, titleText);
  brand.append(title);

  const newNoteButton = document.createElement('button');
  newNoteButton.type = 'button';
  newNoteButton.className = 'btn btn--primary btn--block sidebar__new-note';
  newNoteButton.dataset['action'] = 'new-note';
  const newNoteIcon = icon('plus');
  const newNoteLabel = document.createElement('span');
  newNoteLabel.textContent = 'New Note';
  newNoteButton.append(newNoteIcon, newNoteLabel);

  /* ---------------------- Smart list navigation -------------------- */

  const smartNav = document.createElement('nav');
  smartNav.className = 'smart-nav';
  smartNav.setAttribute('aria-label', 'Note lists');
  const smartListButtons = new Map<SmartListId, HTMLButtonElement>();
  for (const list of SMART_LISTS) {
    const item = document.createElement('span');
    item.className = 'smart-nav__item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'smart-nav__button';
    button.dataset['smartList'] = list.id;
    button.append(icon(SMART_LIST_ICONS[list.id]));
    const label = document.createElement('span');
    label.className = 'smart-nav__label';
    label.textContent = list.label;
    button.append(label);
    if (list.id === 'all') button.setAttribute('aria-current', 'true');
    smartListButtons.set(list.id, button);
    item.append(button);
    smartNav.append(item);
  }

  /* ------------------------ Sidebar footer -------------------------- */

  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'sidebar__footer';

  const importNoteButton = document.createElement('button');
  importNoteButton.type = 'button';
  importNoteButton.className = 'btn btn--ghost btn--block sidebar__footer-button';
  importNoteButton.dataset['action'] = 'import-note';
  importNoteButton.append(icon('import'));
  const importLabel = document.createElement('span');
  importLabel.textContent = 'Import note…';
  importNoteButton.append(importLabel);
  importNoteButton.setAttribute('aria-label', 'Import a note file (JSON, Markdown or HTML)');
  importNoteButton.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,.md,.markdown,.txt,.html,.htm';
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (file) emit('importNote', file);
    });
    picker.click();
  });

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'btn btn--ghost btn--block sidebar__footer-button';
  settingsButton.dataset['action'] = 'open-settings';
  settingsButton.append(icon('settings'));
  const settingsLabel = document.createElement('span');
  settingsLabel.textContent = 'Settings';
  settingsButton.append(settingsLabel);
  settingsButton.setAttribute('aria-label', 'Open settings');

  const diagnosticsButton = document.createElement('button');
  diagnosticsButton.type = 'button';
  diagnosticsButton.className = 'btn btn--ghost btn--block sidebar__footer-button';
  diagnosticsButton.dataset['action'] = 'open-diagnostics';
  diagnosticsButton.append(icon('activity'));
  const diagnosticsLabel = document.createElement('span');
  diagnosticsLabel.textContent = 'Diagnostics';
  diagnosticsButton.append(diagnosticsLabel);
  diagnosticsButton.setAttribute('aria-label', 'Open the diagnostics page');

  sidebarFooter.append(importNoteButton, settingsButton, diagnosticsButton);

  const sidebarSpacer = document.createElement('div');
  sidebarSpacer.className = 'sidebar__spacer';

  sidebar.append(brand, newNoteButton, smartNav, sidebarSpacer, sidebarFooter);

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
  filtersButton.className = 'btn btn--ghost search-form__filters';
  filtersButton.dataset['action'] = 'toggle-filters';
  filtersButton.textContent = 'Filters';
  filtersButton.setAttribute('aria-expanded', 'false');
  filtersButton.setAttribute('aria-controls', 'filters-region');

  searchForm.append(searchLabel, searchInput, filtersButton);

  /* ---------------------- Command palette button -------------------- */

  const paletteButton = document.createElement('button');
  paletteButton.type = 'button';
  paletteButton.className = 'btn btn--ghost palette-trigger';
  paletteButton.dataset['action'] = 'open-command-palette';
  paletteButton.setAttribute('aria-label', 'Open command palette (Ctrl+K)');
  paletteButton.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  paletteButton.append(icon('command'));
  const paletteKbd = document.createElement('span');
  paletteKbd.className = 'palette-trigger__kbd';
  paletteKbd.setAttribute('aria-hidden', 'true');
  paletteKbd.textContent = 'Ctrl K';
  paletteButton.append(paletteKbd);

  const onPaletteClick = (): void => emit('commandPaletteOpen');
  paletteButton.addEventListener('click', onPaletteClick);
  disposers.push(() => paletteButton.removeEventListener('click', onPaletteClick));

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

  /* ------------------------- Topbar / content ----------------------- */

  const topbar = document.createElement('header');
  topbar.className = 'app-topbar';
  const topbarInner = document.createElement('div');
  topbarInner.className = 'app-topbar__inner';
  topbarInner.append(searchForm, paletteButton);
  topbar.append(topbarInner);

  const contentToolbar = document.createElement('div');
  contentToolbar.className = 'content-toolbar';
  contentToolbar.append(toolbar);

  /* ---------------------- Bulk action bar mount -------------------- */

  const bulkBarMount = document.createElement('div');
  bulkBarMount.className = 'bulk-bar-mount';

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
  const selectAll = document.createElement('label');
  selectAll.className = 'results-heading__select-all';
  const selectAllCheckbox = document.createElement('input');
  selectAllCheckbox.type = 'checkbox';
  selectAllCheckbox.id = 'select-all-page';
  selectAllCheckbox.setAttribute('aria-label', 'Select all notes on this page');
  const selectAllText = document.createElement('span');
  selectAllText.textContent = 'Select page';
  selectAll.append(selectAllCheckbox, selectAllText);
  resultsHeading.append(resultsTitle, selectAll, resultsCount);

  const resultsRegion = document.createElement('div');
  resultsRegion.id = 'results-region';
  resultsRegion.className = 'results';
  resultsRegion.setAttribute('aria-live', 'polite');
  resultsRegion.setAttribute('aria-busy', 'false');

  mainInner.append(resultsHeading, resultsRegion);
  main.append(mainInner);

  /* --------------------------- Pagination --------------------------- */

  const pagination = document.createElement('nav');
  pagination.className = 'pagination';
  pagination.setAttribute('aria-label', 'Results pages');
  const paginationPrev = document.createElement('button');
  paginationPrev.type = 'button';
  paginationPrev.className = 'btn btn--ghost';
  paginationPrev.textContent = 'Previous page';
  paginationPrev.disabled = true;
  const paginationLabel = document.createElement('span');
  paginationLabel.className = 'pagination__label';
  paginationLabel.setAttribute('aria-live', 'polite');
  const paginationNext = document.createElement('button');
  paginationNext.type = 'button';
  paginationNext.className = 'btn btn--ghost';
  paginationNext.textContent = 'Next page';
  paginationNext.disabled = true;
  pagination.append(paginationPrev, paginationLabel, paginationNext);

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

  const content = document.createElement('div');
  content.className = 'app-content';
  content.append(topbar, contentToolbar, bulkBarMount, filtersRegion, main, pagination, statusBar);

  const app = document.createElement('div');
  app.className = 'app';
  app.append(sidebar, content);
  root.replaceChildren(skipLink, app, liveRegion);

  type EventKey = keyof ShellEvents;
  const listeners: { [K in EventKey]: Array<ShellEvents[K]> } = {
    newNote: [],
    importNote: [],
    diagnosticsOpen: [],
    settingsOpen: [],
    searchInput: [],
    searchSubmit: [],
    sortChange: [],
    viewModeChange: [],
    filtersToggle: [],
    smartListChange: [],
    commandPaletteOpen: [],
    pagePrev: [],
    pageNext: [],
    selectAllPage: [],
  };

  const emit = <K extends EventKey>(event: K, ...args: Parameters<ShellEvents[K]>): void => {
    for (const listener of [...listeners[event]]) {
      (listener as (...a: Parameters<ShellEvents[K]>) => void)(...args);
    }
  };

  const onNewNoteClick = (): void => emit('newNote');
  newNoteButton.addEventListener('click', onNewNoteClick);
  disposers.push(() => newNoteButton.removeEventListener('click', onNewNoteClick));

  const onDiagnosticsClick = (): void => emit('diagnosticsOpen');
  diagnosticsButton.addEventListener('click', onDiagnosticsClick);
  disposers.push(() => diagnosticsButton.removeEventListener('click', onDiagnosticsClick));

  const onSettingsClick = (): void => emit('settingsOpen');
  settingsButton.addEventListener('click', onSettingsClick);
  disposers.push(() => settingsButton.removeEventListener('click', onSettingsClick));

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

  for (const [listId, button] of smartListButtons) {
    const onSmartListClick = (): void => emit('smartListChange', listId);
    button.addEventListener('click', onSmartListClick);
    disposers.push(() => button.removeEventListener('click', onSmartListClick));
  }

  const onPrevClick = (): void => emit('pagePrev');
  paginationPrev.addEventListener('click', onPrevClick);
  disposers.push(() => paginationPrev.removeEventListener('click', onPrevClick));

  const onNextClick = (): void => emit('pageNext');
  paginationNext.addEventListener('click', onNextClick);
  disposers.push(() => paginationNext.removeEventListener('click', onNextClick));

  const onSelectAllChange = (): void => emit('selectAllPage', selectAllCheckbox.checked);
  selectAllCheckbox.addEventListener('change', onSelectAllChange);
  disposers.push(() => selectAllCheckbox.removeEventListener('change', onSelectAllChange));

  /**
   * Global keyboard shortcuts: Ctrl/Cmd+K opens the command palette
   * (redesign brief) and "/" focuses search. Typing "/" inside a text
   * field is never hijacked.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    const inTextField =
      event.target instanceof HTMLElement &&
      (event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.tagName === 'SELECT' ||
        event.target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      emit('commandPaletteOpen');
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
    importNoteButton,
    settingsButton,
    diagnosticsButton,
    paletteButton,
    searchInput,
    filtersButton,
    sortSelect,
    viewToggle,
    activeFilters,
    filtersRegion,
    smartNav,
    bulkBarMount,
    resultsRegion,
    resultsHeading,
    resultsTitle,
    resultsCount,
    selectAllCheckbox,
    paginationPrev,
    paginationNext,
    paginationLabel,
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
    setActiveSmartList(list: SmartListId): void {
      for (const [listId, button] of smartListButtons) {
        if (listId === list) {
          button.setAttribute('aria-current', 'true');
          button.classList.add('smart-nav__button--active');
        } else {
          button.removeAttribute('aria-current');
          button.classList.remove('smart-nav__button--active');
        }
      }
    },
    setPagination(input: { page: number; pageCount: number; from: number; to: number; total: number }): void {
      paginationPrev.disabled = input.page <= 1;
      paginationNext.disabled = input.page >= input.pageCount;
      paginationLabel.textContent =
        input.total === 0
          ? 'No results'
          : `Showing ${input.from + 1}–${input.to} of ${input.total} · Page ${input.page} of ${input.pageCount}`;
    },
    setSelectAllState(input: { checked: boolean; indeterminate: boolean; pageNoteIds: readonly string[] }): void {
      selectAllCheckbox.checked = input.checked;
      selectAllCheckbox.indeterminate = input.indeterminate;
      selectAllCheckbox.disabled = input.pageNoteIds.length === 0;
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
