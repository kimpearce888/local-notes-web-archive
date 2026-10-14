/**
 * Note metadata bar (T-087, T-084 register UX-08): tags and categories
 * reachable from the NOTE EDITOR.
 *
 * Before this module the ONLY way to tag a note was the list view's bulk
 * bar (select checkbox → New tags / New category) — nothing in the editor,
 * so a user writing a note who wants to tag it never finds the feature.
 * This bar renders under the note subtitle: assigned tags/categories as
 * removable chips plus an add input with suggestions from the existing
 * roster, applied IMMEDIATELY through the RPC layer (exactly like
 * attachments and reminders — never deferred to autosave).
 *
 * CSP-safe construction: every node is createElement/textContent — user
 * data never passes through innerHTML.
 */

import type { EntityId } from '../../core/types';

/** Tag/category operations the bar needs (RPC-backed, see organization-client). */
export interface MetaBarApi {
  createTag(name: string): Promise<{ id: EntityId; name: string } | null>;
  setNoteTags(noteId: EntityId, tagIds: readonly EntityId[]): Promise<boolean>;
  createCategory(name: string): Promise<{ id: EntityId; name: string } | null>;
  setNoteCategories(noteId: EntityId, categoryIds: readonly EntityId[]): Promise<boolean>;
}

export interface NoteMetaBarInput {
  readonly noteId: EntityId;
  readonly initialTagIds: readonly EntityId[];
  readonly initialCategoryIds: readonly EntityId[];
  /** Full rosters for suggestions and name resolution. */
  readonly tags: readonly { id: EntityId; name: string }[];
  readonly categories: readonly { id: EntityId; name: string }[];
  readonly api: MetaBarApi;
  /** Outcome announcements (screen reader + status line). */
  onNotify(message: string, kind: 'info' | 'error'): void;
  /** Roster changed (tag/category created) — lets the controller refresh. */
  onRosterChanged?(): void;
}

export interface NoteMetaBar {
  readonly element: HTMLElement;
  /** Replaces the suggestion rosters (after external roster changes). */
  refreshRoster(tags: readonly { id: EntityId; name: string }[], categories: readonly { id: EntityId; name: string }[]): void;
}

/** Casefold + collapse whitespace — mirrors the repo's normalizedKey rule. */
function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/** One mutable row (tags OR categories) plus its DOM handles. */
interface RowState {
  /** Row label as shown to users, e.g. "Tags". */
  readonly label: string;
  /** Singular noun for aria-labels and announcements, e.g. "tag". */
  readonly singular: string;
  /** Applied ids on THIS note (the full replacement set for the RPC). */
  readonly appliedIds: Set<EntityId>;
  /** Current roster (suggestions + name resolution), swapped by refreshRoster. */
  roster: { id: EntityId; name: string }[];
  readonly create: (name: string) => Promise<{ id: EntityId; name: string } | null>;
  readonly apply: (ids: readonly EntityId[]) => Promise<boolean>;
  readonly chips: HTMLUListElement;
  readonly datalist: HTMLDataListElement;
}

export function createNoteMetaBar(input: NoteMetaBarInput): NoteMetaBar {
  const { noteId, api, onNotify } = input;
  let mutationInFlight = false;

  const element = document.createElement('div');
  element.className = 'note-meta-bar';

  /* --------------------- single render path ------------------------ */

  /** Rebuilds one row's chips + suggestion list from current state. */
  function renderRow(row: RowState): void {
    const byId = new Map(row.roster.map((item) => [item.id, item.name] as const));
    const chipItems: HTMLLIElement[] = [];
    for (const id of row.appliedIds) {
      const name = byId.get(id);
      if (name === undefined) continue; // roster raced behind: skip honestly
      const item = document.createElement('li');
      item.className = 'note-meta-bar__chip';
      const text = document.createElement('span');
      text.className = 'note-meta-bar__chip-name';
      text.textContent = name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'note-meta-bar__chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${row.singular} ${name}`);
      remove.title = `Remove ${name}`;
      remove.addEventListener('click', () => void removeFromNote(row, id, name));
      item.append(text, remove);
      chipItems.push(item);
    }
    row.chips.replaceChildren(...chipItems);
    row.datalist.replaceChildren(
      ...row.roster
        .filter((item) => !row.appliedIds.has(item.id))
        .map((item) => {
          const option = document.createElement('option');
          option.value = item.name;
          return option;
        }),
    );
  }

  /* --------------------- single add path --------------------------- */

  async function commitName(row: RowState, raw: string): Promise<void> {
    const name = raw.trim();
    if (name.length === 0) return;
    if (name.length > 200) {
      onNotify(`${row.singular[0]!.toUpperCase()}${row.singular.slice(1)} names are limited to 200 characters.`, 'error');
      return;
    }
    const normalized = normalizeName(name);
    const existing = row.roster.find(
      (item) => normalizeName(item.name) === normalized,
    );
    if (existing !== undefined && row.appliedIds.has(existing.id)) {
      onNotify(`${row.singular[0]!.toUpperCase()}${row.singular.slice(1)} "${existing.name}" is already on this note.`, 'info');
      return;
    }
    if (mutationInFlight) return;
    mutationInFlight = true;
    try {
      let target = existing ?? null;
      let createdNew = false;
      if (target === null) {
        target = await row.create(name);
        createdNew = target !== null;
      }
      if (target === null) {
        onNotify(`Creating ${row.singular} "${name}" failed.`, 'error');
        return;
      }
      row.appliedIds.add(target.id);
      const applied = await row.apply([...row.appliedIds]);
      if (!applied) {
        row.appliedIds.delete(target.id);
        onNotify(
          `Saving the ${row.singular} change failed — nothing was changed.`,
          'error',
        );
        return;
      }
      renderRow(row);
      const label = `${row.singular[0]!.toUpperCase()}${row.singular.slice(1)}`;
      onNotify(
        createdNew
          ? `${label} "${target.name}" created and added to this note.`
          : `${label} "${target.name}" added to this note.`,
        'info',
      );
      if (createdNew) {
        // A new roster entity exists now: use it locally for suggestions
        // and offer it to the controller for sidebar/filter refresh.
        row.roster = [...row.roster, target];
        renderRow(row);
        input.onRosterChanged?.();
      }
    } finally {
      mutationInFlight = false;
    }
  }

  /* --------------------- single remove path ------------------------ */

  async function removeFromNote(row: RowState, id: EntityId, name: string): Promise<void> {
    if (mutationInFlight) return;
    mutationInFlight = true;
    try {
      row.appliedIds.delete(id);
      const applied = await row.apply([...row.appliedIds]);
      if (!applied) {
        row.appliedIds.add(id);
        onNotify(
          `Removing the ${row.singular} failed — nothing was changed.`,
          'error',
        );
        return;
      }
      renderRow(row);
      onNotify(`${row.singular[0]!.toUpperCase()}${row.singular.slice(1)} "${name}" removed from this note.`, 'info');
    } finally {
      mutationInFlight = false;
    }
  }

  /* ------------------------- row factory --------------------------- */

  function createRow(config: {
    kind: 'tag' | 'category';
    label: string;
    singular: string;
    listAriaLabel: string;
    addAriaLabel: string;
    addPlaceholder: string;
    initialIds: readonly EntityId[];
    initialRoster: readonly { id: EntityId; name: string }[];
    create: (name: string) => Promise<{ id: EntityId; name: string } | null>;
    apply: (ids: readonly EntityId[]) => Promise<boolean>;
  }): RowState {
    const row = document.createElement('div');
    row.className = 'note-meta-bar__row';

    const label = document.createElement('span');
    label.className = 'note-meta-bar__label';
    label.textContent = config.label;

    const chips = document.createElement('ul');
    chips.className = 'chips note-meta-bar__chips';
    chips.setAttribute('aria-label', config.listAriaLabel);

    const datalistId = `note-meta-bar-${config.kind}-suggestions`;
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;

    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'note-meta-bar__add';
    addInput.placeholder = config.addPlaceholder;
    addInput.setAttribute('aria-label', config.addAriaLabel);
    addInput.setAttribute('list', datalistId);
    addInput.setAttribute('autocomplete', 'off');
    addInput.spellcheck = false;
    addInput.addEventListener('keydown', (event) => {
      // Comma keeps the bulk bar's idiom: "work, travel," commits "work"
      // and leaves "travel" for the next Enter.
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      const raw = addInput.value.replace(/,$/, '').trim();
      addInput.value = '';
      if (raw.length === 0) return;
      void commitName(state, raw);
    });

    const state: RowState = {
      label: config.label,
      singular: config.singular,
      appliedIds: new Set(config.initialIds),
      roster: [...config.initialRoster],
      create: config.create,
      apply: config.apply,
      chips,
      datalist,
    };

    row.append(label, chips, addInput, datalist);
    element.append(row);
    renderRow(state);
    return state;
  }

  /* ------------------------- the two rows -------------------------- */

  const tagsRow = createRow({
    kind: 'tag',
    label: 'Tags',
    singular: 'tag',
    listAriaLabel: 'Note tags',
    addAriaLabel: 'Add a tag',
    addPlaceholder: 'Add a tag and press Enter…',
    initialIds: input.initialTagIds,
    initialRoster: input.tags,
    create: (name) => api.createTag(name),
    apply: (ids) => api.setNoteTags(noteId, ids),
  });

  const categoriesRow = createRow({
    kind: 'category',
    label: 'Category',
    singular: 'category',
    listAriaLabel: 'Note categories',
    addAriaLabel: 'Add a category',
    addPlaceholder: 'Add a category and press Enter…',
    initialIds: input.initialCategoryIds,
    initialRoster: input.categories,
    create: (name) => api.createCategory(name),
    apply: (ids) => api.setNoteCategories(noteId, ids),
  });

  return {
    element,
    refreshRoster(tags, categories): void {
      tagsRow.roster = [...tags];
      categoriesRow.roster = [...categories];
      renderRow(tagsRow);
      renderRow(categoriesRow);
    },
  };
}
