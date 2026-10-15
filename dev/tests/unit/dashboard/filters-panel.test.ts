// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFiltersPanel } from '../../../../src/dashboard/views/filters-panel';
import type { FiltersPanelCallbacks } from '../../../../src/dashboard/views/filters-panel';
import type { Category, EntityId, Filters, SavedView, Tag } from '../../../../src/core/types';

/**
 * T-065 (audit D-02, FR-SEARCH-03): the Filters disclosure previously
 * opened an EMPTY region — zero children with and without data. These
 * tests pin the replacement: real controls rendered into the region, the
 * Filters ⇄ controls mapping both directions, removable active-filter
 * chips, and saved named views (apply / delete / save dialog).
 */

let region: HTMLElement;
let chips: HTMLElement;
let savedViewsHost: HTMLElement;
let callbacks: FiltersPanelCallbacks;

const TAG: Tag = {
  id: 'tag-1' as EntityId,
  name: 'research',
  normalizedKey: 'research',
  createdAt: '2026-01-01T00:00:00Z' as Tag['createdAt'],
  updatedAt: '2026-01-01T00:00:00Z' as Tag['updatedAt'],
};

const CATEGORY: Category = {
  id: 'cat-1' as EntityId,
  name: 'Projects',
  parentId: null,
  order: 0,
  createdAt: '2026-01-01T00:00:00Z' as Tag['createdAt'],
  updatedAt: '2026-01-01T00:00:00Z' as Tag['updatedAt'],
};

const VIEW: SavedView = {
  id: 'view-1' as EntityId,
  name: 'Reading list',
  query: 'zebra',
  filters: { pinned: true },
  createdAt: '2026-01-02T00:00:00Z' as SavedView['createdAt'],
};

beforeEach(() => {
  // jsdom knows <dialog> but not showModal/close (same polyfill pattern as
  // the other dashboard suites).
  const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  region = document.createElement('div');
  chips = document.createElement('ul');
  savedViewsHost = document.createElement('ul');
  document.body.append(region, chips, savedViewsHost);
  callbacks = {
    onApply: vi.fn(),
    onClear: vi.fn(),
    onSaveView: vi.fn(),
    onApplyView: vi.fn(),
    onDeleteView: vi.fn(),
    onClose: vi.fn(),
  };
});

describe('filters panel rendering (D-02 regression)', () => {
  it('renders real FR-SEARCH-03 controls into the previously-empty region', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [TAG], categories: [CATEGORY], savedViews: [VIEW] });

    // The audit measured 0 children in #filters-region — now every control
    // family exists and is labelled.
    expect(region.children.length).toBeGreaterThan(0);
    const controls = region.querySelectorAll('input, select, button');
    expect(controls.length).toBeGreaterThan(10);
    expect(region.querySelector('#filter-modifiedAfter')).toBeTruthy();
    expect(region.querySelector('#filter-modifiedBefore')).toBeTruthy();
    expect(region.querySelector('#filter-capturedAfter')).toBeTruthy();
    expect(region.querySelector('#filter-capturedBefore')).toBeTruthy();
    expect(region.querySelector('#filter-state')).toBeTruthy();
    expect(region.querySelector('#filter-reminder')).toBeTruthy();
    expect(region.querySelector('#filter-snapshot')).toBeTruthy();
    expect(region.querySelector('#filter-pinned')).toBeTruthy();
    expect(region.querySelector('#filter-favorite')).toBeTruthy();
    expect(region.querySelector('#filter-hasLink')).toBeTruthy();
    expect(region.querySelector('#filter-hasAttachment')).toBeTruthy();
    expect(region.querySelector('#filter-sourceDomain')).toBeTruthy();
    expect(region.textContent).toContain('Tags');
    expect(region.textContent).toContain('research');
    expect(region.textContent).toContain('Categories');
    expect(region.textContent).toContain('Projects');
    expect(region.textContent).toContain('Apply filters');
    expect(region.textContent).toContain('Clear all');
    expect(region.textContent).toContain('Save as view…');
  });
});

describe('filters ⇄ controls mapping', () => {
  it('reads every control family into a Filters payload on Apply', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [TAG], categories: [CATEGORY], savedViews: [] });

    (region.querySelector('#filter-modifiedAfter') as HTMLInputElement).value = '2026-01-01';
    (region.querySelector('#filter-modifiedBefore') as HTMLInputElement).value = '2026-02-01';
    (region.querySelector('#filter-capturedAfter') as HTMLInputElement).value = '2026-03-01';
    (region.querySelector('#filter-capturedBefore') as HTMLInputElement).value = '2026-04-01';
    (region.querySelector('#filter-state') as HTMLSelectElement).value = 'archived';
    (region.querySelector('#filter-reminder') as HTMLSelectElement).value = 'overdue';
    (region.querySelector('#filter-snapshot') as HTMLSelectElement).value = 'missing';
    (region.querySelector('#filter-pinned') as HTMLInputElement).checked = true;
    (region.querySelector('#filter-favorite') as HTMLInputElement).checked = true;
    (region.querySelector('#filter-hasLink') as HTMLInputElement).checked = true;
    (region.querySelector('#filter-hasAttachment') as HTMLInputElement).checked = true;
    (region.querySelector('#filter-sourceDomain') as HTMLInputElement).value = 'Example.COM ';
    (region.querySelector('input[value="tag-1"]') as HTMLInputElement).checked = true;
    (region.querySelector('input[value="cat-1"]') as HTMLInputElement).checked = true;

    (region.querySelector('button') as HTMLButtonElement).closest('.filters-panel__actions');
    const apply = [...region.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Apply filters',
    );
    apply?.click();

    expect(callbacks.onApply).toHaveBeenCalledWith({
      modifiedAfter: '2026-01-01',
      modifiedBefore: '2026-02-01',
      capturedAfter: '2026-03-01',
      capturedBefore: '2026-04-01',
      state: 'archived',
      reminder: 'overdue',
      snapshot: 'missing',
      pinned: true,
      favorite: true,
      hasLink: true,
      hasAttachment: true,
      sourceDomain: 'example.com',
      tagIds: ['tag-1' as EntityId],
      categoryIds: ['cat-1' as EntityId],
    } satisfies Filters);
  });

  it('reflects an applied filter set back into the controls on sync', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    const filters: Filters = {
      modifiedAfter: '2026-05-01',
      modifiedBefore: '2026-06-01',
      capturedAfter: '2026-07-01',
      capturedBefore: '2026-08-01',
      state: 'trashed',
      reminder: 'any',
      snapshot: 'failed',
      pinned: true,
      favorite: true,
      hasLink: true,
      hasAttachment: true,
      sourceDomain: 'example.com',
      tagIds: ['tag-1' as EntityId],
      categoryIds: ['cat-1' as EntityId],
    };
    panel.sync({ filters, tags: [TAG], categories: [CATEGORY], savedViews: [] });

    expect((region.querySelector('#filter-modifiedAfter') as HTMLInputElement).value).toBe('2026-05-01');
    expect((region.querySelector('#filter-modifiedBefore') as HTMLInputElement).value).toBe('2026-06-01');
    expect((region.querySelector('#filter-capturedAfter') as HTMLInputElement).value).toBe('2026-07-01');
    expect((region.querySelector('#filter-capturedBefore') as HTMLInputElement).value).toBe('2026-08-01');
    expect((region.querySelector('#filter-state') as HTMLSelectElement).value).toBe('trashed');
    expect((region.querySelector('#filter-reminder') as HTMLSelectElement).value).toBe('any');
    expect((region.querySelector('#filter-snapshot') as HTMLSelectElement).value).toBe('failed');
    expect((region.querySelector('#filter-pinned') as HTMLInputElement).checked).toBe(true);
    expect((region.querySelector('#filter-sourceDomain') as HTMLInputElement).value).toBe('example.com');
    expect((region.querySelector('input[value="tag-1"]') as HTMLInputElement).checked).toBe(true);
    expect((region.querySelector('input[value="cat-1"]') as HTMLInputElement).checked).toBe(true);
  });

  it('keeps checked tag boxes across a re-sync (roster rebuild preserves selections)', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [TAG], categories: [], savedViews: [] });
    (region.querySelector('input[value="tag-1"]') as HTMLInputElement).checked = true;
    // A later sync (state change) must not silently drop the in-progress
    // selection when the incoming filters have no tagIds.
    panel.sync({ filters: {}, tags: [TAG], categories: [], savedViews: [] });
    expect((region.querySelector('input[value="tag-1"]') as HTMLInputElement).checked).toBe(true);
  });
});

describe('active-filter chips', () => {
  it('renders one removable chip per active filter with friendly labels', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({
      filters: {
        modifiedAfter: '2026-01-01',
        state: 'archived',
        reminder: 'overdue',
        snapshot: 'missing',
        pinned: true,
        sourceDomain: 'example.com',
        tagIds: ['tag-1' as EntityId],
        categoryIds: ['cat-1' as EntityId],
      },
      tags: [TAG],
      categories: [CATEGORY],
      savedViews: [],
    });

    const labels = [...chips.querySelectorAll('.chip__label')].map((el) => el.textContent);
    expect(labels).toContain('Modified after 2026-01-01');
    expect(labels).toContain('State: archived');
    expect(labels).toContain('Overdue reminders');
    expect(labels).toContain('No snapshots');
    expect(labels).toContain('Pinned only');
    expect(labels).toContain('Domain: example.com');
    expect(labels).toContain('Tag: research');
    expect(labels).toContain('Category: Projects');
    // Empty filters render no chips (the audit's chips-are-always-empty
    // finding inverted).
    expect(chips.children.length).toBe(8);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [] });
    expect(chips.children.length).toBe(0);
  });

  it('removes exactly the clicked filter through onApply', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({
      filters: { pinned: true, tagIds: ['tag-1' as EntityId, 'tag-2' as EntityId] },
      tags: [TAG],
      categories: [],
      savedViews: [],
    });

    const removeTagChip = [...chips.querySelectorAll<HTMLButtonElement>('.chip__remove')].find(
      (button) => button.getAttribute('aria-label') === 'Remove filter: Tag: research',
    );
    removeTagChip?.click();
    expect(callbacks.onApply).toHaveBeenCalledWith({ pinned: true, tagIds: ['tag-2' as EntityId] });

    callbacks.onApply = vi.fn();
    panel.sync({
      filters: { pinned: true, tagIds: ['tag-1' as EntityId, 'tag-2' as EntityId] },
      tags: [TAG],
      categories: [],
      savedViews: [],
    });
    const removePinnedChip = [...chips.querySelectorAll<HTMLButtonElement>('.chip__remove')].find(
      (button) => button.getAttribute('aria-label') === 'Remove filter: Pinned only',
    );
    removePinnedChip?.click();
    expect(callbacks.onApply).toHaveBeenCalledWith({
      tagIds: ['tag-1' as EntityId, 'tag-2' as EntityId],
    });
  });

  it('Clear all empties the controls and calls onClear', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: { pinned: true }, tags: [], categories: [], savedViews: [] });
    const clear = [...region.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Clear all',
    );
    clear?.click();
    expect(callbacks.onClear).toHaveBeenCalledTimes(1);
    expect((region.querySelector('#filter-pinned') as HTMLInputElement).checked).toBe(false);
  });
});

describe('dismissal (T-085, UX-05 regression)', () => {
  it('renders the region header with its own Close control', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [] });
    expect(region.querySelector('.filters-region__heading')?.textContent).toBe('Filters');
    const close = [...region.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.getAttribute('aria-label') === 'Close filters',
    );
    expect(close).toBeTruthy();
    close?.click();
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    // Close is dismissal only — the applied filters are untouched.
    expect(callbacks.onApply).not.toHaveBeenCalled();
    expect(callbacks.onClear).not.toHaveBeenCalled();
  });

  it('Apply filters applies AND dismisses the bar (close-on-apply)', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [] });
    (region.querySelector('#filter-pinned') as HTMLInputElement).checked = true;
    const apply = [...region.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Apply filters',
    );
    apply?.click();
    expect(callbacks.onApply).toHaveBeenCalledTimes(1);
    expect(callbacks.onApply).toHaveBeenCalledWith({ pinned: true });
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it('the Enter shortcut applies and dismisses like the button', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [] });
    const state = region.querySelector<HTMLSelectElement>('#filter-state');
    state?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(callbacks.onApply).toHaveBeenCalledTimes(1);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('saved views (FR-SEARCH-03 named views)', () => {
  it('renders clickable chips: click applies, × deletes', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [VIEW] });

    expect(savedViewsHost.textContent).toContain('Reading list');
    savedViewsHost.querySelector<HTMLButtonElement>('.chip__label')?.click();
    expect(callbacks.onApplyView).toHaveBeenCalledWith('view-1' as EntityId);
    savedViewsHost.querySelector<HTMLButtonElement>('.chip__remove')?.click();
    expect(callbacks.onDeleteView).toHaveBeenCalledWith('view-1' as EntityId);
  });

  it('saves through the dialog and refuses an empty name', () => {
    const panel = createFiltersPanel({ region, chips, savedViews: savedViewsHost }, callbacks);
    panel.sync({ filters: {}, tags: [], categories: [], savedViews: [] });
    const saveButton = [...region.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Save as view…',
    );
    saveButton?.click();

    const dialog = document.querySelector<HTMLDialogElement>('dialog.dialog');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('Save current view');
    const input = dialog?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).toBeTruthy();

    // Empty name: the dialog stays open, nothing saved.
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Save view',
    );
    confirm?.click();
    expect(callbacks.onSaveView).not.toHaveBeenCalled();

    (input as HTMLInputElement).value = '  Weekly review  ';
    confirm?.click();
    expect(callbacks.onSaveView).toHaveBeenCalledWith('Weekly review');
    expect(document.querySelector('dialog.dialog')).toBeNull();
  });
});
