// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountDashboardShell } from '../../../../src/dashboard/shell';
import { createThemeManager, type ThemeManager } from '../../../../src/dashboard/theme';
import { showEmpty, showError, showLoading, showContent } from '../../../../src/dashboard/states';

/**
 * T-014 validation: layout order per PRD §4.1, semantics and labels, focus
 * and keyboard operability, theme resolution, live-region announcements,
 * save-state labeling and the loading/empty/error region states — including
 * "no colour-only status" (states carry text).
 */

function freshRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

let roots: HTMLElement[] = [];

beforeEach(() => {
  roots = [];
});

afterEach(() => {
  for (const root of roots) root.remove();
  roots = [];
});

function mount(): ReturnType<typeof mountDashboardShell> {
  const root = freshRoot();
  roots.push(root);
  return mountDashboardShell(root);
}

describe('shell layout order (PRD §4.1)', () => {
  it('renders New Note above search, above toolbar, above results', () => {
    const shell = mount();
    const order = [
      shell.elements.newNoteButton.compareDocumentPosition(shell.elements.searchInput),
      shell.elements.searchInput.compareDocumentPosition(shell.elements.sortSelect),
      shell.elements.sortSelect.compareDocumentPosition(shell.elements.resultsRegion),
    ];
    // FOLLOWING (4) for each pair: strictly top-to-bottom order.
    expect(order.every((value) => (value & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)).toBe(true);
  });

  it('labels the app with an h1 and the results region with an h2', () => {
    const shell = mount();
    expect(shell.elements.root.querySelector('h1')?.textContent).toContain('Local Notes');
    expect(shell.elements.resultsTitle.tagName).toBe('H2');
  });

  it('exposes a skip link targeting the results region', () => {
    const shell = mount();
    expect(shell.elements.skipLink.getAttribute('href')).toBe('#results');
    expect(shell.elements.resultsRegion.closest('main')?.id).toBe('results');
  });
});

describe('semantics and accessible names', () => {
  it('gives every control an accessible name', () => {
    const shell = mount();
    const label = shell.elements.searchInput.labels?.[0];
    expect(label?.textContent).toMatch(/search notes/i);
    expect(shell.elements.sortSelect.labels?.[0]?.textContent).toMatch(/sort notes/i);
    expect(shell.elements.viewToggle.getAttribute('aria-label')).toBe('View mode');
    expect(shell.elements.newNoteButton.textContent).toBe('New Note');
    expect(shell.elements.filtersButton.getAttribute('aria-controls')).toBe('filters-region');
  });

  it('wires the live region as a polite status', () => {
    const shell = mount();
    expect(shell.elements.liveRegion.getAttribute('role')).toBe('status');
    expect(shell.elements.liveRegion.getAttribute('aria-live')).toBe('polite');
  });

  it('offers the six PRD sort orders with modified as default', () => {
    const shell = mount();
    const values = [...shell.elements.sortSelect.options].map((o) => o.value);
    expect(values).toEqual(['modified', 'created', 'title', 'reminder', 'capture', 'relevance']);
    expect(shell.elements.sortSelect.value).toBe('modified');
  });

  it('marks results as a live region the store can flag busy', () => {
    const shell = mount();
    expect(shell.elements.resultsRegion.getAttribute('aria-live')).toBe('polite');
    expect(shell.elements.resultsRegion.getAttribute('aria-busy')).toBe('false');
  });
});

describe('event wiring', () => {
  it('emits newNote on button activation', () => {
    const shell = mount();
    const onNewNote = vi.fn();
    shell.on('newNote', onNewNote);
    shell.elements.newNoteButton.click();
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });

  it('emits debounced searchInput and immediate searchSubmit', () => {
    vi.useFakeTimers();
    try {
      const shell = mount();
      const onInput = vi.fn();
      const onSubmit = vi.fn();
      shell.on('searchInput', onInput);
      shell.on('searchSubmit', onSubmit);

      shell.elements.searchInput.value = 'needle';
      shell.elements.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onInput).not.toHaveBeenCalled(); // debounced
      vi.advanceTimersByTime(200);
      expect(onInput).toHaveBeenCalledWith('needle');

      shell.elements.searchInput.form?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      expect(onSubmit).toHaveBeenCalledWith('needle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits sortChange with the selected field', () => {
    const shell = mount();
    const onSort = vi.fn();
    shell.on('sortChange', onSort);
    shell.elements.sortSelect.value = 'title';
    shell.elements.sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onSort).toHaveBeenCalledWith('title');
  });

  it('toggles view mode through the radiogroup and keeps aria-checked in sync', () => {
    const shell = mount();
    const onViewMode = vi.fn();
    shell.on('viewModeChange', onViewMode);
    const listOption = shell.elements.viewToggle.querySelector<HTMLButtonElement>(
      '[data-view="list"]',
    );
    listOption?.click();
    expect(onViewMode).toHaveBeenCalledWith('list');
    expect(listOption?.getAttribute('aria-checked')).toBe('true');
    expect(
      shell.elements.viewToggle.querySelector<HTMLButtonElement>('[data-view="grid"]')
        ?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('discloses the filters region with aria-expanded state', () => {
    const shell = mount();
    const onToggle = vi.fn();
    shell.on('filtersToggle', onToggle);
    expect(shell.elements.filtersRegion.hidden).toBe(true);
    shell.elements.filtersButton.click();
    expect(shell.elements.filtersRegion.hidden).toBe(false);
    expect(shell.elements.filtersButton.getAttribute('aria-expanded')).toBe('true');
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('closeFilters dismisses the disclosure and keeps aria truthful (T-085, UX-05)', () => {
    const shell = mount();
    const onToggle = vi.fn();
    shell.on('filtersToggle', onToggle);
    shell.elements.filtersButton.click();
    expect(shell.elements.filtersRegion.hidden).toBe(false);
    shell.closeFilters();
    expect(shell.elements.filtersRegion.hidden).toBe(true);
    expect(shell.elements.filtersButton.getAttribute('aria-expanded')).toBe('false');
    expect(onToggle).toHaveBeenCalledWith(false);
    // Idempotent: closing an already-hidden region is a no-op.
    shell.closeFilters();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('Escape dismisses the open filters region (T-085, UX-05)', () => {
    const shell = mount();
    shell.elements.filtersButton.click();
    expect(shell.elements.filtersRegion.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shell.elements.filtersRegion.hidden).toBe(true);
    expect(shell.elements.filtersButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape leaves a closed filters region and open dialogs untouched', () => {
    const shell = mount();
    // Region hidden: Escape must not emit or flip anything.
    const onToggle = vi.fn();
    shell.on('filtersToggle', onToggle);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onToggle).not.toHaveBeenCalled();
    // A native modal dialog owns Escape: the region stays open underneath.
    shell.elements.filtersButton.click();
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shell.elements.filtersRegion.hidden).toBe(false);
    dialog.remove();
  });

  it('supports unsubscribe', () => {
    const shell = mount();
    const onNewNote = vi.fn();
    const off = shell.on('newNote', onNewNote);
    off();
    shell.elements.newNoteButton.click();
    expect(onNewNote).not.toHaveBeenCalled();
  });
});

describe('keyboard operability', () => {
  it('emits commandPaletteOpen on Ctrl+K (redesign brief: palette owns the shortcut)', () => {
    const shell = mount();
    const onOpen = vi.fn();
    shell.on('commandPaletteOpen', onOpen);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    // The default is prevented so the browser never binds its own search.
    // (dispatchEvent returns false when a listener called preventDefault.)
    const again = document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(again).toBe(false);
  });

  it('emits commandPaletteOpen on Cmd+K (macOS meta key)', () => {
    const shell = mount();
    const onOpen = vi.fn();
    shell.on('commandPaletteOpen', onOpen);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers a palette trigger button with an accessible name and shortcut', () => {
    const shell = mount();
    expect(shell.elements.paletteButton.getAttribute('aria-label')).toBe(
      'Open command palette (Ctrl+K)',
    );
    expect(shell.elements.paletteButton.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    const onOpen = vi.fn();
    shell.on('commandPaletteOpen', onOpen);
    shell.elements.paletteButton.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('focuses the search field on "/" outside text fields', () => {
    const shell = mount();
    shell.elements.searchInput.focus = vi.fn();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
    );
    expect(shell.elements.searchInput.focus).toHaveBeenCalled();
  });

  it('does not hijack "/" while typing in the search field', () => {
    const shell = mount();
    const prevented = vi.fn();
    shell.elements.searchInput.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) prevented();
    });
    shell.elements.searchInput.focus = vi.fn();
    shell.elements.searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }),
    );
    expect(prevented).not.toHaveBeenCalled();
    expect(shell.elements.searchInput.focus).not.toHaveBeenCalled();
  });
});

describe('announcements and save state', () => {
  it('delivers announced text to the live region asynchronously', async () => {
    const shell = mount();
    shell.announce('Notes loaded.');
    expect(shell.elements.liveRegion.textContent).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shell.elements.liveRegion.textContent).toBe('Notes loaded.');
  });

  it('labels the save state with words, not colour alone (PRD §4.3)', () => {
    const shell = mount();
    shell.setSaveState('saving');
    expect(shell.elements.saveState.textContent).toBe('Saving…');
    shell.setSaveState('saved');
    expect(shell.elements.saveState.textContent).toBe('Saved');
    shell.setSaveState('save-failed');
    expect(shell.elements.saveState.textContent).toBe('Save failed');
    expect(shell.elements.saveState.dataset['saveState']).toBe('save-failed');
    shell.setSaveState('idle');
    expect(shell.elements.saveState.textContent).toBe('');
  });
});

describe('theme engine', () => {
  function fakeMedia(matches: boolean): {
    media: MediaQueryList;
    setMatches(next: boolean): void;
  } {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
    return {
      media,
      setMatches(next: boolean): void {
        (media as { matches: boolean }).matches = next;
        for (const listener of listeners) {
          listener({ matches: next } as MediaQueryListEvent);
        }
      },
    };
  }

  it('applies the preference as data-theme and resolves system', () => {
    const root = document.createElement('div');
    const { media } = fakeMedia(true);
    const manager: ThemeManager = createThemeManager(root, 'system', () => media);
    expect(root.getAttribute('data-theme')).toBe('system');
    expect(manager.resolved()).toBe('dark');
    manager.setPreference('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(manager.resolved()).toBe('light');
    manager.dispose();
  });

  it('tracks OS changes while in system mode', () => {
    const root = document.createElement('div');
    const { media, setMatches } = fakeMedia(false);
    const manager = createThemeManager(root, 'system', () => media);
    const changes: Array<'light' | 'dark'> = [];
    manager.onChange((resolved) => changes.push(resolved));
    setMatches(true);
    expect(manager.resolved()).toBe('dark');
    expect(changes).toEqual(['dark']);
    manager.dispose();
  });

  it('stops notifying after dispose (resolution stays live, listeners stop)', () => {
    const root = document.createElement('div');
    const { media, setMatches } = fakeMedia(false);
    const manager = createThemeManager(root, 'system', () => media);
    const changes: Array<'light' | 'dark'> = [];
    manager.onChange((resolved) => changes.push(resolved));
    manager.dispose();
    setMatches(true);
    // Disposed managers no longer emit change notifications...
    expect(changes).toEqual([]);
    // ...while resolving the OS state on demand remains truthful.
    expect(manager.resolved()).toBe('dark');
    expect(media).toBeDefined();
  });
});

describe('region states (PRD §11: text always carries the status)', () => {
  it('shows empty with title and detail text', () => {
    const region = document.createElement('div');
    showEmpty(region, 'No notes yet', 'Notes you create will appear here.');
    expect(region.querySelector('.state--empty')).not.toBeNull();
    expect(region.querySelector('.state__title')?.textContent).toBe('No notes yet');
    expect(region.querySelector('.state__detail')?.textContent).toBe(
      'Notes you create will appear here.',
    );
  });

  it('shows loading with text (spinner is decorative reinforcement)', () => {
    const region = document.createElement('div');
    showLoading(region, 'Loading notes…', 'Reading your local database.');
    expect(region.querySelector('.state--loading')).not.toBeNull();
    expect(region.querySelector('.state__title')?.textContent).toBe('Loading notes…');
    expect(region.querySelector('.state__glyph')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows errors with words and a retry action', () => {
    const region = document.createElement('div');
    const onRetry = vi.fn();
    const state = showError(region, 'Could not load notes', 'The local database is unavailable.', {
      label: 'Try again',
      onRetry,
    });
    expect(region.querySelector('.state--error')).not.toBeNull();
    expect(region.querySelector('.state__error-text')?.textContent).toBe(
      'The local database is unavailable.',
    );
    state.retry?.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('clears state presentation for real content', () => {
    const region = document.createElement('div');
    showLoading(region, 'Loading…', 'Reading your local database.');
    showContent(region);
    expect(region.children.length).toBe(0);
  });
});

describe('design system stylesheet (single source of visual truth)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src', 'dashboard', 'styles.css'), 'utf8');

  it('defines the token layers, focus visibility and reduced motion', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain("--color-accent");
    expect(css).toContain('--space-');
    expect(css).toContain('.visually-hidden');
    expect(css).toContain('.state--empty');
    expect(css).toContain('.state--loading');
    expect(css).toContain('.state--error');
    expect(css).toContain('.save-state');
  });

  it('styles both dark themes: explicit and system-following', () => {
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain("[data-theme='system']");
  });

  it('keeps one stylesheet with no remote imports or font fetches', () => {
    const remote = /url\(\s*['"]?https?:|@import\s+['"]?https?:|@font-face/;
    expect(remote.test(css)).toBe(false);
  });
});
