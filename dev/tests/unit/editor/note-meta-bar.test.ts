// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createNoteMetaBar, type MetaBarApi } from '../../../../src/dashboard/editor/note-meta-bar';
import type { EntityId } from '../../../../src/core/types';

/**
 * T-087 (register UX-08): tags and categories reachable from the editor.
 * These tests pin the metadata bar's contract: chips render from applied
 * ids, add commits immediately through the RPC-shaped api (create-or-reuse
 * by normalized name), remove updates the applied set, failures roll back
 * honestly, and every outcome is announced. The real RPC round trip is
 * covered by the session/controller integration and E2E layers.
 */

const NOTE_ID = '00000000-0000-4000-8000-000000000001' as EntityId;
const T1 = 't1' as EntityId;
const T2 = 't2' as EntityId;
const C1 = 'c1' as EntityId;

function keypress(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
}

function makeApi(overrides: Partial<MetaBarApi> = {}): MetaBarApi {
  return {
    createTag: vi.fn(async (name: string) => ({
      id: `tag-${name}` as EntityId as EntityId,
      name,
    })),
    setNoteTags: vi.fn(async () => true),
    createCategory: vi.fn(async (name: string) => ({
      id: `cat-${name}` as EntityId as EntityId,
      name,
    })),
    setNoteCategories: vi.fn(async () => true),
    ...overrides,
  };
}

describe('note-meta-bar rendering', () => {
  it('renders applied tags and categories as removable chips', () => {
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1, T2],
      initialCategoryIds: [C1],
      tags: [
        { id: T1, name: 'work' },
        { id: T2, name: 'travel' },
      ],
      categories: [{ id: C1, name: 'Projects' }],
      api: makeApi(),
      onNotify: () => undefined,
    });
    const tagChips = bar.element.querySelectorAll('.note-meta-bar__chip');
    expect([...tagChips].map((chip) => chip.textContent?.replace('×', '').trim())).toEqual([
      'work',
      'travel',
      'Projects',
    ]);
    // Removable chips: every chip has an accessible remove control.
    for (const chip of tagChips) {
      const remove = chip.querySelector<HTMLButtonElement>('.note-meta-bar__chip-remove');
      expect(remove?.getAttribute('aria-label')).toMatch(/^Remove (tag|category) /);
    }
    // Add inputs carry labels and suggestions exclude applied entries.
    const tagInput = bar.element.querySelector<HTMLInputElement>(
      'input[aria-label="Add a tag"]',
    );
    expect(tagInput).not.toBeNull();
    const suggestions = [
      ...bar.element.querySelectorAll<HTMLDataListElement>('#note-meta-bar-tag-suggestions option'),
    ];
    expect(suggestions).toHaveLength(0); // both roster tags are applied
  });

  it('hides nothing when no tags exist — the add inputs are the affordance', () => {
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [],
      initialCategoryIds: [],
      tags: [],
      categories: [],
      api: makeApi(),
      onNotify: () => undefined,
    });
    expect(
      bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]'),
    ).not.toBeNull();
    expect(
      bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a category"]'),
    ).not.toBeNull();
  });
});

describe('note-meta-bar add flow (immediate application, UX-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commits on Enter, reuses an existing tag by normalized name without creating', async () => {
    const api = makeApi();
    const announced: string[] = [];
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [],
      tags: [{ id: T1, name: 'Work' }],
      categories: [],
      initialCategoryIds: [],
      api,
      onNotify: (message) => announced.push(message),
    });
    const input = bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    input!.value = '  WORK  ';
    input!.dispatchEvent(keypress('Enter'));

    await vi.waitFor(() => {
      expect(api.setNoteTags).toHaveBeenCalledWith(NOTE_ID, [T1]);
    });
    expect(api.createTag).not.toHaveBeenCalled();
    expect(
      [...bar.element.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['Work']);
    expect(announced.at(-1)).toBe('Tag "Work" added to this note.');
  });

  it('creates a NEW tag when the name is unknown, then applies the union', async () => {
    const api = makeApi();
    const onRosterChanged = vi.fn();
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1],
      tags: [{ id: T1, name: 'work' }],
      categories: [],
      initialCategoryIds: [],
      api,
      onNotify: () => undefined,
      onRosterChanged,
    });
    const input = bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    input!.value = 'urgent';
    input!.dispatchEvent(keypress('Enter'));

    await vi.waitFor(() => {
      expect(api.createTag).toHaveBeenCalledWith('urgent');
    });
    await vi.waitFor(() => {
      expect(api.setNoteTags).toHaveBeenCalledWith(NOTE_ID, [T1, 'tag-urgent']);
    });
    expect(onRosterChanged).toHaveBeenCalled();
    expect(
      [...bar.element.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['work', 'urgent']);
  });

  it('comma commits like the bulk bar and clears the field', async () => {
    const api = makeApi();
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [],
      tags: [],
      categories: [],
      initialCategoryIds: [],
      api,
      onNotify: () => undefined,
    });
    const input = bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    input!.value = 'work,';
    input!.dispatchEvent(keypress(','));
    expect(input!.value).toBe('');
    await vi.waitFor(() => {
      expect(api.createTag).toHaveBeenCalledWith('work');
    });
  });

  it('tells the truth when the apply RPC fails — the chip does not appear', async () => {
    const api = makeApi({ setNoteTags: vi.fn(async () => false) });
    const announced: string[] = [];
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [],
      tags: [],
      categories: [],
      initialCategoryIds: [],
      api,
      onNotify: (message) => announced.push(message),
    });
    const input = bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    input!.value = 'work';
    input!.dispatchEvent(keypress('Enter'));

    await vi.waitFor(() => {
      expect(announced.at(-1)).toContain('Saving the tag change failed');
    });
    expect(bar.element.querySelectorAll('.note-meta-bar__chip')).toHaveLength(0);
  });

  it('announces duplicates instead of applying twice', async () => {
    const api = makeApi();
    const announced: string[] = [];
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1],
      tags: [{ id: T1, name: 'work' }],
      categories: [],
      initialCategoryIds: [],
      api,
      onNotify: (message) => announced.push(message),
    });
    const input = bar.element.querySelector<HTMLInputElement>('input[aria-label="Add a tag"]');
    input!.value = 'Work';
    input!.dispatchEvent(keypress('Enter'));

    await vi.waitFor(() => {
      expect(announced.at(-1)).toBe('Tag "work" is already on this note.');
    });
    expect(api.setNoteTags).not.toHaveBeenCalled();
  });

  it('applies categories through the category RPC (not the tag RPC)', async () => {
    const api = makeApi();
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [],
      initialCategoryIds: [],
      tags: [],
      categories: [],
      api,
      onNotify: () => undefined,
    });
    const input = bar.element.querySelector<HTMLInputElement>(
      'input[aria-label="Add a category"]',
    );
    input!.value = 'Projects';
    input!.dispatchEvent(keypress('Enter'));

    await vi.waitFor(() => {
      expect(api.createCategory).toHaveBeenCalledWith('Projects');
    });
    await vi.waitFor(() => {
      expect(api.setNoteCategories).toHaveBeenCalledWith(NOTE_ID, ['cat-Projects']);
    });
    expect(api.setNoteTags).not.toHaveBeenCalled();
  });
});

describe('note-meta-bar remove flow', () => {
  it('removes a chip and persists the remaining set', async () => {
    const api = makeApi();
    const announced: string[] = [];
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1, T2],
      initialCategoryIds: [],
      tags: [
        { id: T1, name: 'work' },
        { id: T2, name: 'travel' },
      ],
      categories: [],
      api,
      onNotify: (message) => announced.push(message),
    });
    const removeTravel = bar.element.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove tag travel"]',
    );
    removeTravel!.click();

    await vi.waitFor(() => {
      expect(api.setNoteTags).toHaveBeenCalledWith(NOTE_ID, [T1]);
    });
    await vi.waitFor(() => {
      expect(announced.at(-1)).toBe('Tag "travel" removed from this note.');
    });
    expect(
      [...bar.element.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['work']);
  });

  it('rolls back honestly when the remove RPC fails', async () => {
    const api = makeApi({ setNoteTags: vi.fn(async () => false) });
    const announced: string[] = [];
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1],
      initialCategoryIds: [],
      tags: [{ id: T1, name: 'work' }],
      categories: [],
      api,
      onNotify: (message) => announced.push(message),
    });
    bar.element.querySelector<HTMLButtonElement>('button[aria-label="Remove tag work"]')!.click();

    await vi.waitFor(() => {
      expect(announced.at(-1)).toContain('Removing the tag failed');
    });
    // The chip is still there — the UI never lies about persisted state.
    expect(
      [...bar.element.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['work']);
  });
});

describe('note-meta-bar refreshRoster', () => {
  it('swaps suggestion rosters and re-renders names', () => {
    const bar = createNoteMetaBar({
      noteId: NOTE_ID,
      initialTagIds: [T1],
      initialCategoryIds: [],
      tags: [{ id: T1, name: 'work' }],
      categories: [],
      api: makeApi(),
      onNotify: () => undefined,
    });
    bar.refreshRoster([{ id: T1, name: 'renamed' }], [{ id: C1, name: 'New' }]);
    expect(
      [...bar.element.querySelectorAll('.note-meta-bar__chip-name')].map((n) => n.textContent),
    ).toEqual(['renamed']);
    const suggestions = [
      ...bar.element.querySelectorAll<HTMLOptionElement>('#note-meta-bar-category-suggestions option'),
    ];
    expect(suggestions.map((option) => option.value)).toEqual(['New']);
  });
});
