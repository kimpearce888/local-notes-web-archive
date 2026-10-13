/**
 * Command palette (T-056, redesign brief "Command Palette (Ctrl+K)").
 *
 * A pure view-layer component: it surfaces EXISTING dashboard actions
 * (new note, import, smart-list navigation, settings, diagnostics, theme
 * preference, focus search) behind one keyboard-first dialog. It owns no
 * business logic — every entry simply invokes the callback supplied at
 * construction time, which in the app wiring activates the very same
 * buttons/events the rest of the UI uses. Nothing about data, storage,
 * search, reminders, capture or AI is touched.
 *
 * Accessibility model (Radix-style, no dependency):
 * - Native <dialog>.showModal() for focus containment and Escape close.
 * - The filter field is a combobox (aria-controls + aria-activedescendant)
 *   driving a role="listbox" of role="option" entries; ArrowUp/ArrowDown/
 *   Home/End move the active option, Enter activates it.
 * - Opening is announced through the app live region; options carry text
 *   labels only (icons are decorative, aria-hidden).
 */

import { icon, type IconName } from './icons';

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** Right-aligned decorative hint (e.g. "Ctrl+K"). */
  readonly hint?: string;
  readonly icon?: IconName;
  /** Marks the currently-effective choice (theme entries). */
  readonly active?: boolean;
  run(): void;
}

export interface CommandPalette {
  readonly element: HTMLDialogElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface CommandPaletteInput {
  /** Entries evaluated on every open so state (theme, view) stays truthful. */
  entries: () => readonly PaletteEntry[];
  /** Live-region announcer (the shell's). */
  announce: (message: string) => void;
}

interface RenderedEntry {
  readonly entry: PaletteEntry;
  readonly option: HTMLLIElement;
}

export function createCommandPalette(input: CommandPaletteInput): CommandPalette {
  const disposers: Array<() => void> = [];

  const dialog = document.createElement('dialog');
  dialog.className = 'dialog dialog--command-palette';
  dialog.setAttribute('aria-label', 'Command palette');

  /* ------------------------------ Structure ------------------------------ */

  const form = document.createElement('form');
  form.className = 'palette__form';
  form.method = 'dialog'; // Enter inside the field submits -> handled below

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'palette__field';

  const searchIcon = icon('search');
  searchIcon.classList.add('palette__field-icon');

  const label = document.createElement('label');
  label.className = 'visually-hidden';
  label.htmlFor = 'command-palette-input';
  label.textContent = 'Filter commands';

  const field = document.createElement('input');
  field.className = 'palette__input';
  field.id = 'command-palette-input';
  field.type = 'text';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.placeholder = 'Type a command…';
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-expanded', 'true');
  field.setAttribute('aria-controls', 'command-palette-list');

  fieldWrap.append(searchIcon, field);

  const list = document.createElement('ul');
  list.className = 'palette__list';
  list.id = 'command-palette-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commands');

  const hints = document.createElement('div');
  hints.className = 'palette__hints';
  hints.setAttribute('aria-hidden', 'true');
  const hintUp = document.createElement('span');
  hintUp.className = 'palette__hint';
  hintUp.textContent = '↑↓ navigate';
  const hintEnter = document.createElement('span');
  hintEnter.className = 'palette__hint';
  hintEnter.textContent = '↵ run';
  const hintEsc = document.createElement('span');
  hintEsc.className = 'palette__hint';
  hintEsc.textContent = 'esc close';
  hints.append(hintUp, hintEnter, hintEsc);

  form.append(label, fieldWrap, list);
  dialog.append(form, hints);
  document.body.append(dialog);

  /* ------------------------------- State --------------------------------- */

  let rendered: RenderedEntry[] = [];
  let activeIndex = -1;

  function match(entry: PaletteEntry, query: string): boolean {
    if (query.length === 0) return true;
    const haystack = `${entry.group} ${entry.label}`.toLowerCase();
    return haystack.includes(query);
  }

  function renderList(query: string): void {
    const entries = input.entries().filter((entry) => match(entry, query));
    list.replaceChildren();
    rendered = [];
    let previousGroup = '';
    for (const entry of entries) {
      if (entry.group !== previousGroup) {
        previousGroup = entry.group;
        const heading = document.createElement('li');
        heading.className = 'palette__group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = entry.group;
        list.append(heading);
      }
      const option = document.createElement('li');
      option.className = 'palette__option';
      option.id = `command-palette-option-${entry.id}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      if (entry.icon !== undefined) option.append(icon(entry.icon));
      const text = document.createElement('span');
      text.className = 'palette__option-label';
      text.textContent = entry.label;
      option.append(text);
      if (entry.active) {
        const activeMark = document.createElement('span');
        activeMark.className = 'palette__option-active';
        activeMark.textContent = 'Active';
        option.append(activeMark);
      }
      if (entry.hint !== undefined) {
        const hint = document.createElement('span');
        hint.className = 'palette__option-hint';
        hint.textContent = entry.hint;
        option.append(hint);
      }
      rendered.push({ entry, option });
      list.append(option);
    }

    if (rendered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'palette__empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = 'No matching command.';
      list.append(empty);
    }

    activeIndex = rendered.length > 0 ? 0 : -1;
    syncActive();
  }

  function syncActive(): void {
    for (let index = 0; index < rendered.length; index += 1) {
      const item = rendered[index];
      if (item === undefined) continue;
      const { option } = item;
      const isActive = index === activeIndex;
      option.setAttribute('aria-selected', String(isActive));
      option.classList.toggle('palette__option--active', isActive);
    }
    const active = rendered[activeIndex];
    if (active !== undefined) {
      field.setAttribute('aria-activedescendant', active.option.id);
      // jsdom has no scrollIntoView; the real browser keeps the active
      // option in view while arrowing through the list.
      if (typeof active.option.scrollIntoView === 'function') {
        active.option.scrollIntoView({ block: 'nearest' });
      }
    } else {
      field.removeAttribute('aria-activedescendant');
    }
  }

  function activate(index: number): void {
    const target = rendered[index];
    if (target === undefined) return;
    const { entry } = target;
    close();
    entry.run();
  }

  /* ------------------------------ Keyboard ------------------------------- */

  const onFieldKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rendered.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + rendered.length) % rendered.length;
      syncActive();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      activeIndex = rendered.length > 0 ? 0 : -1;
      syncActive();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      activeIndex = rendered.length - 1;
      syncActive();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activate(activeIndex);
    }
  };
  field.addEventListener('keydown', onFieldKeyDown);
  disposers.push(() => field.removeEventListener('keydown', onFieldKeyDown));

  const onFieldInput = (): void => {
    renderList(field.value.trim().toLowerCase());
  };
  field.addEventListener('input', onFieldInput);
  disposers.push(() => field.removeEventListener('input', onFieldInput));

  // Clicking an option activates it (pointer parity with keyboard).
  const onListClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest('.palette__option');
    if (!option) return;
    const index = rendered.findIndex((item) => item.option === option);
    if (index >= 0) activate(index);
  };
  list.addEventListener('click', onListClick);
  disposers.push(() => list.removeEventListener('click', onListClick));

  // The form must never actually submit (method=dialog would close it
  // without running an entry) — Enter is fully handled by the field.
  const onFormSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    activate(activeIndex);
  };
  form.addEventListener('submit', onFormSubmit);
  disposers.push(() => form.removeEventListener('submit', onFormSubmit));

  // Escape arrives as a `cancel` event on <dialog> (native close); the
  // close handler below performs the shared teardown.
  const onCancel = (event: Event): void => {
    event.preventDefault();
    close();
  };
  dialog.addEventListener('cancel', onCancel);
  disposers.push(() => dialog.removeEventListener('cancel', onCancel));

  /* ------------------------------ Lifecycle ------------------------------ */

  let openState = false;

  function open(): void {
    if (openState) {
      field.select();
      return;
    }
    openState = true;
    field.value = '';
    renderList('');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    field.focus();
    input.announce(`Command palette opened, ${rendered.length} commands available.`);
  }

  function close(): void {
    if (!openState) return;
    openState = false;
    // jsdom implements neither showModal nor close; the attribute fallback
    // keeps the component testable outside a real browser.
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  return {
    element: dialog,
    open,
    close,
    isOpen(): boolean {
      return openState;
    },
    dispose(): void {
      close();
      for (const dispose of disposers) dispose();
      dialog.remove();
    },
  };
}
