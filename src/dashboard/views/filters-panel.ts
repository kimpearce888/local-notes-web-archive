/**
 * Filters panel (T-065, FR-SEARCH-03, audit D-02): the topbar Filters
 * disclosure previously opened an EMPTY region — the control implied
 * function the product did not have, while the underlying Filters engine
 * fully supported every FR-SEARCH-03 field. This module renders the real
 * controls into #filters-region, one removable chip per active filter into
 * #active-filters, and the saved named views into the toolbar.
 *
 * Honesty constraints baked into the control set: only engine-honored
 * semantics are offered. The pinned/favorite/link/attachment filters are
 * presence checkboxes (the engine matches `=== true`); the reminder select
 * offers the states the engine distinguishes (has reminders / overdue); the
 * snapshot select offers presence, absence and failed captures (engine
 * support for the latter two shipped with this task); created/modified date
 * bounds map to modifiedAfter/modifiedBefore because the engine compares
 * both against updatedAt.
 */

import type { Category, EntityId, Filters, SavedView, Tag } from '../../core/types';

export interface FiltersPanelCallbacks {
  /** Apply a new filter set (page resets to 1, requery runs). */
  onApply(filters: Filters): void;
  /** Clear every user filter. */
  onClear(): void;
  /** Persist the current query + filters under a name. */
  onSaveView(name: string): void;
  /** Apply a saved view (query + filters). */
  onApplyView(viewId: EntityId): void;
  /** Delete a saved view. */
  onDeleteView(viewId: EntityId): void;
}

export interface FiltersPanelHosts {
  /** #filters-region — the disclosure the Filters button opens. */
  readonly region: HTMLElement;
  /** #active-filters — removable chips for the active user filters. */
  readonly chips: HTMLElement;
  /** Toolbar host for saved named views. */
  readonly savedViews: HTMLElement;
}

export interface FiltersPanel {
  /** Reflects state into the controls and both chip hosts. */
  sync(input: {
    filters: Filters;
    tags: readonly Tag[];
    categories: readonly Category[];
    savedViews: readonly SavedView[];
  }): void;
}

function createDateField(labelText: string, key: string): {
  readonly wrap: HTMLElement;
  readonly input: HTMLInputElement;
} {
  const wrap = document.createElement('label');
  wrap.className = 'filters-panel__field';
  wrap.htmlFor = `filter-${key}`;
  const label = document.createElement('span');
  label.className = 'filters-panel__label';
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'date';
  input.id = `filter-${key}`;
  input.className = 'search-input';
  input.dataset['filter'] = key;
  wrap.append(label, input);
  return { wrap, input };
}

function createSelectField(
  labelText: string,
  key: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): {
  readonly wrap: HTMLElement;
  readonly select: HTMLSelectElement;
} {
  const wrap = document.createElement('label');
  wrap.className = 'filters-panel__field';
  wrap.htmlFor = `filter-${key}`;
  const label = document.createElement('span');
  label.className = 'filters-panel__label';
  label.textContent = labelText;
  const select = document.createElement('select');
  select.className = 'select';
  select.id = `filter-${key}`;
  select.dataset['filter'] = key;
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  wrap.append(label, select);
  return { wrap, select };
}

function createCheckboxField(labelText: string, key: string): {
  readonly wrap: HTMLElement;
  readonly input: HTMLInputElement;
} {
  const wrap = document.createElement('label');
  wrap.className = 'filters-panel__check';
  wrap.htmlFor = `filter-${key}`;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = `filter-${key}`;
  input.dataset['filter'] = key;
  const label = document.createElement('span');
  label.textContent = labelText;
  wrap.append(input, label);
  return { wrap, input };
}

export function createFiltersPanel(hosts: FiltersPanelHosts, callbacks: FiltersPanelCallbacks): FiltersPanel {
  /** The currently-applied filter set (mirrors store state via sync). */
  let appliedFilters: Filters = {};
  /**
   * Filters as of the last control write. Unrelated store changes re-sync
   * with identical filters — in that case the controls keep whatever the
   * user has in progress, instead of resetting under their hands.
   */
  let lastWrittenFilters: Filters | null = null;
  /* ------------------------- Controls ------------------------------- */

  const modifiedAfter = createDateField('Modified after', 'modifiedAfter');
  const modifiedBefore = createDateField('Modified before', 'modifiedBefore');
  const capturedAfter = createDateField('Captured after', 'capturedAfter');
  const capturedBefore = createDateField('Captured before', 'capturedBefore');

  const tagField = document.createElement('fieldset');
  tagField.className = 'filters-panel__field filters-panel__field--options';
  const tagLegend = document.createElement('legend');
  tagLegend.className = 'filters-panel__label';
  tagLegend.textContent = 'Tags';
  tagField.append(tagLegend);
  const tagBoxes = document.createElement('div');
  tagBoxes.className = 'filters-panel__options';
  tagBoxes.dataset['filter'] = 'tagIds';
  tagField.append(tagBoxes);

  const categoryField = document.createElement('fieldset');
  categoryField.className = 'filters-panel__field filters-panel__field--options';
  const categoryLegend = document.createElement('legend');
  categoryLegend.className = 'filters-panel__label';
  categoryLegend.textContent = 'Categories';
  categoryField.append(categoryLegend);
  const categoryBoxes = document.createElement('div');
  categoryBoxes.className = 'filters-panel__options';
  categoryBoxes.dataset['filter'] = 'categoryIds';
  categoryField.append(categoryBoxes);

  const state = createSelectField('State', 'state', [
    { value: '', label: 'Any state' },
    { value: 'active', label: 'Active' },
    { value: 'archived', label: 'Archived' },
    { value: 'trashed', label: 'Trashed' },
  ]);
  const reminder = createSelectField('Reminders', 'reminder', [
    { value: '', label: 'Any' },
    { value: 'any', label: 'Has reminders' },
    { value: 'due', label: 'Due upcoming' },
    { value: 'overdue', label: 'Overdue only' },
    { value: 'completed', label: 'Completed' },
  ]);
  const snapshot = createSelectField('Snapshots', 'snapshot', [
    { value: '', label: 'Any' },
    { value: 'present', label: 'Has snapshots' },
    { value: 'missing', label: 'No snapshots' },
    { value: 'failed', label: 'Failed captures' },
  ]);

  const pinned = createCheckboxField('Pinned only', 'pinned');
  const favorite = createCheckboxField('Favorites only', 'favorite');
  const hasLink = createCheckboxField('Has links', 'hasLink');
  const hasAttachment = createCheckboxField('Has attachments', 'hasAttachment');

  const sourceDomainWrap = document.createElement('label');
  sourceDomainWrap.className = 'filters-panel__field';
  sourceDomainWrap.htmlFor = 'filter-sourceDomain';
  const sourceDomainLabel = document.createElement('span');
  sourceDomainLabel.className = 'filters-panel__label';
  sourceDomainLabel.textContent = 'Source domain';
  const sourceDomain = document.createElement('input');
  sourceDomain.type = 'text';
  sourceDomain.className = 'search-input';
  sourceDomain.id = 'filter-sourceDomain';
  sourceDomain.dataset['filter'] = 'sourceDomain';
  sourceDomain.placeholder = 'example.com';
  sourceDomain.autocomplete = 'off';
  sourceDomain.spellcheck = false;
  sourceDomainWrap.append(sourceDomainLabel, sourceDomain);

  const actions = document.createElement('div');
  actions.className = 'filters-panel__actions';
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'btn btn--primary';
  applyButton.textContent = 'Apply filters';
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'btn';
  clearButton.textContent = 'Clear all';
  const saveViewButton = document.createElement('button');
  saveViewButton.type = 'button';
  saveViewButton.className = 'btn';
  saveViewButton.textContent = 'Save as view…';
  actions.append(applyButton, clearButton, saveViewButton);

  const grid = document.createElement('div');
  grid.className = 'filters-panel';
  grid.append(
    modifiedAfter.wrap,
    modifiedBefore.wrap,
    state.wrap,
    reminder.wrap,
    snapshot.wrap,
    pinned.wrap,
    favorite.wrap,
    hasLink.wrap,
    hasAttachment.wrap,
    sourceDomainWrap,
    capturedAfter.wrap,
    capturedBefore.wrap,
    tagField,
    categoryField,
    actions,
  );
  hosts.region.replaceChildren(grid);

  /* ------------------------ Reading state --------------------------- */

  function readFilters(): Filters {
    const filters: Record<string, unknown> = {};
    if (modifiedAfter.input.value) filters['modifiedAfter'] = modifiedAfter.input.value;
    if (modifiedBefore.input.value) filters['modifiedBefore'] = modifiedBefore.input.value;
    if (capturedAfter.input.value) filters['capturedAfter'] = capturedAfter.input.value;
    if (capturedBefore.input.value) filters['capturedBefore'] = capturedBefore.input.value;
    if (state.select.value) filters['state'] = state.select.value;
    if (reminder.select.value) filters['reminder'] = reminder.select.value;
    if (snapshot.select.value) filters['snapshot'] = snapshot.select.value;
    if (pinned.input.checked) filters['pinned'] = true;
    if (favorite.input.checked) filters['favorite'] = true;
    if (hasLink.input.checked) filters['hasLink'] = true;
    if (hasAttachment.input.checked) filters['hasAttachment'] = true;
    const domain = sourceDomain.value.trim().toLocaleLowerCase('en-US');
    if (domain.length > 0) filters['sourceDomain'] = domain.slice(0, 255);
    const tagIds = [...tagBoxes.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value);
    if (tagIds.length > 0) filters['tagIds'] = tagIds;
    const categoryIds = [...categoryBoxes.querySelectorAll<HTMLInputElement>('input:checked')].map(
      (box) => box.value,
    );
    if (categoryIds.length > 0) filters['categoryIds'] = categoryIds;
    return filters as Filters;
  }

  function writeFilters(filters: Filters): void {
    modifiedAfter.input.value = filters.modifiedAfter ?? '';
    modifiedBefore.input.value = filters.modifiedBefore ?? '';
    capturedAfter.input.value = filters.capturedAfter ?? '';
    capturedBefore.input.value = filters.capturedBefore ?? '';
    state.select.value = filters.state ?? '';
    reminder.select.value = filters.reminder ?? '';
    snapshot.select.value = filters.snapshot ?? '';
    pinned.input.checked = filters.pinned === true;
    favorite.input.checked = filters.favorite === true;
    hasLink.input.checked = filters.hasLink === true;
    hasAttachment.input.checked = filters.hasAttachment === true;
    sourceDomain.value = filters.sourceDomain ?? '';
    const tagIds = new Set((filters.tagIds ?? []).map((id) => id as string));
    for (const box of tagBoxes.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.checked = tagIds.has(box.value);
    }
    const categoryIds = new Set((filters.categoryIds ?? []).map((id) => id as string));
    for (const box of categoryBoxes.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.checked = categoryIds.has(box.value);
    }
  }

  /* -------------------------- Chip hosts ---------------------------- */

  function appendChip(
    host: HTMLElement,
    label: string,
    onRemove: (() => void) | null,
    onClick: (() => void) | null,
  ): void {
    const chip = document.createElement('li');
    chip.className = 'chip';
    if (onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip__label';
      button.textContent = label;
      button.addEventListener('click', onClick);
      chip.append(button);
    } else {
      const text = document.createElement('span');
      text.className = 'chip__label';
      text.textContent = label;
      chip.append(text);
    }
    if (onRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove filter: ${label}`);
      remove.addEventListener('click', onRemove);
      chip.append(remove);
    }
    host.append(chip);
  }

  function renderChips(filters: Filters, tags: readonly Tag[], categories: readonly Category[]): void {
    const host = hosts.chips;
    host.replaceChildren();
    const tagName = (id: EntityId): string => tags.find((tag) => tag.id === id)?.name ?? 'tag';
    const categoryName = (id: EntityId): string =>
      categories.find((category) => category.id === id)?.name ?? 'category';

    const entries: ReadonlyArray<{ label: string; key: keyof Filters; sub?: EntityId }> = [
      ...(filters.modifiedAfter ? [{ label: `Modified after ${filters.modifiedAfter}`, key: 'modifiedAfter' as const }] : []),
      ...(filters.modifiedBefore ? [{ label: `Modified before ${filters.modifiedBefore}`, key: 'modifiedBefore' as const }] : []),
      ...(filters.capturedAfter ? [{ label: `Captured after ${filters.capturedAfter}`, key: 'capturedAfter' as const }] : []),
      ...(filters.capturedBefore ? [{ label: `Captured before ${filters.capturedBefore}`, key: 'capturedBefore' as const }] : []),
      ...(filters.state ? [{ label: `State: ${filters.state}`, key: 'state' as const }] : []),
      ...(filters.reminder
        ? [
            {
              label:
                filters.reminder === 'overdue'
                  ? 'Overdue reminders'
                  : filters.reminder === 'due'
                    ? 'Due upcoming reminders'
                    : filters.reminder === 'completed'
                      ? 'Completed reminders'
                      : 'Has reminders',
              key: 'reminder' as const,
            },
          ]
        : []),
      ...(filters.snapshot
        ? [
            {
              label:
                filters.snapshot === 'missing'
                  ? 'No snapshots'
                  : filters.snapshot === 'failed'
                    ? 'Failed captures'
                    : 'Has snapshots',
              key: 'snapshot' as const,
            },
          ]
        : []),
      ...(filters.pinned === true ? [{ label: 'Pinned only', key: 'pinned' as const }] : []),
      ...(filters.favorite === true ? [{ label: 'Favorites only', key: 'favorite' as const }] : []),
      ...(filters.hasLink === true ? [{ label: 'Has links', key: 'hasLink' as const }] : []),
      ...(filters.hasAttachment === true ? [{ label: 'Has attachments', key: 'hasAttachment' as const }] : []),
      ...(filters.sourceDomain ? [{ label: `Domain: ${filters.sourceDomain}`, key: 'sourceDomain' as const }] : []),
      ...(filters.tagIds ?? []).map((id) => ({ label: `Tag: ${tagName(id)}`, key: 'tagIds' as const, sub: id })),
      ...(filters.categoryIds ?? []).map((id) => ({
        label: `Category: ${categoryName(id)}`,
        key: 'categoryIds' as const,
        sub: id,
      })),
    ];

    for (const entry of entries) {
      appendChip(
        host,
        entry.label,
        () => {
          // Removal edits the APPLIED filter set (what the chips represent),
          // never the raw control state — filter values with no visible
          // control (e.g. a tag deleted from the roster) survive removals.
          const next = { ...appliedFilters } as Record<string, unknown>;
          if (entry.sub !== undefined) {
            const list = (next[entry.key as string] as EntityId[] | undefined) ?? [];
            next[entry.key as string] = list.filter((id) => id !== entry.sub);
          } else {
            delete next[entry.key as string];
          }
          callbacks.onApply(next as Filters);
        },
        null,
      );
    }
  }

  function renderSavedViews(savedViews: readonly SavedView[]): void {
    const host = hosts.savedViews;
    host.replaceChildren();
    for (const view of savedViews) {
      appendChip(
        host,
        view.name,
        () => callbacks.onDeleteView(view.id),
        () => callbacks.onApplyView(view.id),
      );
    }
  }

  /* ------------------------- Save dialog ---------------------------- */

  function promptSaveView(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Save current view';
    const description = document.createElement('p');
    description.textContent =
      'Saves the current search text and filters under a name. Click the chip any time to return to this view.';
    const field = document.createElement('label');
    field.className = 'dialog__field';
    field.textContent = 'View name';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.maxLength = 60;
    input.setAttribute('placeholder', 'e.g. Research reading list');
    input.setAttribute('aria-label', 'View name');
    field.append(input);
    const actionsRow = document.createElement('div');
    actionsRow.className = 'dialog__actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = 'Save view';
    save.addEventListener('click', () => {
      const name = input.value.trim();
      if (name.length === 0) {
        input.focus();
        return;
      }
      callbacks.onSaveView(name);
      dialog.close();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actionsRow.append(cancel, save);
    dialog.append(heading, description, field, actionsRow);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  }

  /* -------------------------- Wiring -------------------------------- */

  applyButton.addEventListener('click', () => callbacks.onApply(readFilters()));
  clearButton.addEventListener('click', () => {
    writeFilters({});
    callbacks.onClear();
  });
  saveViewButton.addEventListener('click', () => promptSaveView());
  grid.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target !== sourceDomain) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        event.preventDefault();
        callbacks.onApply(readFilters());
      }
    }
  });
  sourceDomain.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      callbacks.onApply(readFilters());
    }
  });

  return {
    sync(input) {
      appliedFilters = input.filters;
      // Checkbox rosters rebuild from the live organization data.
      const buildBoxes = (
        host: HTMLElement,
        items: ReadonlyArray<{ id: EntityId; name: string }>,
        ariaLabel: string,
      ): void => {
        const previous = new Set(
          [...host.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => box.value),
        );
        host.replaceChildren();
        if (items.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'filters-panel__empty';
          empty.textContent = 'None yet.';
          host.append(empty);
          return;
        }
        for (const item of items) {
          const label = document.createElement('label');
          label.className = 'filters-panel__check';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.value = item.id;
          box.checked = previous.has(item.id);
          box.setAttribute('aria-label', `${ariaLabel}: ${item.name}`);
          const text = document.createElement('span');
          text.textContent = item.name;
          label.append(box, text);
          host.append(label);
        }
      };
      buildBoxes(tagBoxes, input.tags.map((tag) => ({ id: tag.id, name: tag.name })), 'Tag');
      buildBoxes(
        categoryBoxes,
        input.categories.map((category) => ({ id: category.id, name: category.name })),
        'Category',
      );
      // Only rewrite the scalar controls when the applied filters actually
      // changed — identical filters on an unrelated store change must not
      // discard the user's in-progress edits.
      if (JSON.stringify(input.filters) !== JSON.stringify(lastWrittenFilters)) {
        writeFilters(input.filters);
        lastWrittenFilters = input.filters;
      }
      renderChips(input.filters, input.tags, input.categories);
      renderSavedViews(input.savedViews);
    },
  };
}
