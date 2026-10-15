// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommandPalette, type PaletteEntry } from '../../../../src/dashboard/views/command-palette';

/**
 * T-056 validation: the command palette is a pure view layer over existing
 * actions. These tests pin its accessibility contract (combobox + listbox,
 * aria-activedescendant), filtering, keyboard navigation, activation and
 * lifecycle — no business logic exists here to test, by design.
 */

const announcements: string[] = [];

function entries(overrides: Partial<PaletteEntry> = {}): PaletteEntry[] {
  return [
    {
      id: 'new-note',
      label: 'New note',
      group: 'Actions',
      run: vi.fn(),
      ...overrides,
    },
    {
      id: 'go-pinned',
      label: 'Go to Pinned',
      group: 'Go to',
      run: vi.fn(),
    },
    {
      id: 'theme-dark',
      label: 'Dark theme',
      group: 'Preferences',
      active: true,
      run: vi.fn(),
    },
  ];
}

afterEach(() => {
  announcements.length = 0;
  document.body.replaceChildren();
});

function mount(entriesList: PaletteEntry[] = entries()) {
  const palette = createCommandPalette({
    entries: () => entriesList,
    announce: (message) => announcements.push(message),
  });
  return { palette, entriesList };
}

describe('command palette semantics', () => {
  it('renders a labelled dialog with a combobox driving a listbox', () => {
    const { palette } = mount();
    expect(palette.element.getAttribute('aria-label')).toBe('Command palette');
    const field = palette.element.querySelector('#command-palette-input');
    expect(field?.getAttribute('role')).toBe('combobox');
    expect(field?.getAttribute('aria-controls')).toBe('command-palette-list');
    const list = palette.element.querySelector('#command-palette-list');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.getAttribute('aria-label')).toBe('Commands');
  });

  it('starts closed and opens with every entry rendered in groups', () => {
    const { palette } = mount();
    expect(palette.isOpen()).toBe(false);
    palette.open();
    expect(palette.isOpen()).toBe(true);
    const labels = [...palette.element.querySelectorAll('.palette__option-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['New note', 'Go to Pinned', 'Dark theme']);
    const groups = [...palette.element.querySelectorAll('.palette__group')].map(
      (node) => node.textContent,
    );
    expect(groups).toEqual(['Actions', 'Go to', 'Preferences']);
  });

  it('announces the command count on open', () => {
    const { palette } = mount();
    palette.open();
    expect(announcements.some((message) => /3 commands available/.test(message))).toBe(true);
  });

  it('marks the first option active and mirrors it to aria-activedescendant', () => {
    const { palette } = mount();
    palette.open();
    const first = palette.element.querySelector('#command-palette-option-new-note');
    expect(first?.getAttribute('aria-selected')).toBe('true');
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input');
    expect(field?.getAttribute('aria-activedescendant')).toBe('command-palette-option-new-note');
  });
});

describe('filtering', () => {
  it('narrows the list to matching entries as the user types', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input');
    field!.value = 'dark';
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    const labels = [...palette.element.querySelectorAll('.palette__option-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['Dark theme']);
  });

  it('shows an honest empty state when nothing matches', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input');
    field!.value = 'zzz';
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(palette.element.textContent).toContain('No matching command.');
  });

  it('matches case-insensitively across group and label', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input');
    field!.value = 'GO TO';
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    const labels = [...palette.element.querySelectorAll('.palette__option-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['Go to Pinned']);
  });
});

describe('keyboard navigation and activation', () => {
  function key(field: HTMLInputElement, key: string): void {
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  }

  it('ArrowDown and ArrowUp move the active option cyclically', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input')!;
    key(field, 'ArrowDown');
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-go-pinned');
    key(field, 'ArrowDown');
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-theme-dark');
    key(field, 'ArrowDown'); // wraps to the first
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-new-note');
    key(field, 'ArrowUp'); // wraps backwards
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-theme-dark');
  });

  it('Home and End jump to the first and last options', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input')!;
    key(field, 'End');
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-theme-dark');
    key(field, 'Home');
    expect(field.getAttribute('aria-activedescendant')).toBe('command-palette-option-new-note');
  });

  it('Enter activates the highlighted entry and closes the palette', () => {
    const { palette, entriesList } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input')!;
    key(field, 'ArrowDown');
    key(field, 'Enter');
    expect(palette.isOpen()).toBe(false);
    expect(entriesList[1]?.run).toHaveBeenCalledTimes(1);
    expect(entriesList[0]?.run).not.toHaveBeenCalled();
  });

  it('Enter on the empty list is a no-op, not a crash', () => {
    const { palette, entriesList } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input')!;
    field.value = 'zzz';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    key(field, 'Enter');
    expect(palette.isOpen()).toBe(true);
    for (const entry of entriesList) expect(entry.run).not.toHaveBeenCalled();
  });

  it('clicking an option activates that exact entry', () => {
    const { palette, entriesList } = mount();
    palette.open();
    const option = palette.element.querySelector('#command-palette-option-theme-dark')!;
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(palette.isOpen()).toBe(false);
    expect(entriesList[2]?.run).toHaveBeenCalledTimes(1);
  });

  it('Escape (dialog cancel) closes the palette without running anything', () => {
    const { palette, entriesList } = mount();
    palette.open();
    palette.element.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
    expect(palette.isOpen()).toBe(false);
    for (const entry of entriesList) expect(entry.run).not.toHaveBeenCalled();
  });
});

describe('lifecycle', () => {
  it('reopening resets the query and re-renders the full list', () => {
    const { palette } = mount();
    palette.open();
    const field = palette.element.querySelector<HTMLInputElement>('#command-palette-input')!;
    field.value = 'dark';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    palette.close();
    palette.open();
    const labels = [...palette.element.querySelectorAll('.palette__option-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['New note', 'Go to Pinned', 'Dark theme']);
    expect(field.value).toBe('');
  });

  it('re-evaluates entries on every open (state stays truthful)', () => {
    const list = entries();
    const palette = createCommandPalette({
      entries: () => list.slice(0, 1),
      announce: () => undefined,
    });
    palette.open();
    palette.close();
    palette.open();
    const labels = [...palette.element.querySelectorAll('.palette__option-label')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['New note']);
    palette.dispose();
  });

  it('dispose closes the dialog and removes it from the document', () => {
    const { palette } = mount();
    palette.open();
    palette.dispose();
    expect(palette.isOpen()).toBe(false);
    expect(palette.element.isConnected).toBe(false);
  });
});
