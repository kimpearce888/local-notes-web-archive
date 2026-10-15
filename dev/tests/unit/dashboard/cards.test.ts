// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  cardViewModel,
  dateLabel,
  previewText,
  reminderChipFor,
  renderCard,
  EMPTY_RELATED,
  type RelatedInfo,
} from '../../../../src/dashboard/views/cards';
import { SMART_LISTS, effectiveFilters, smartListById } from '../../../../src/dashboard/views/smart-lists';
import { createBulkBar } from '../../../../src/dashboard/views/bulk-bar';
import type { Link, Note, Reminder, Tag, Category, TimeZoneName, UtcTimestamp } from '../../../../src/core/types';

/**
 * T-016 validation: pure card view models (safe truncation, chips,
 * indicators, reminder states), DOM rendering with textContent-only
 * previews, smart-list filter mapping and the bulk action bar.
 */

const NOW = '2026-10-12T12:00:00.000Z' as UtcTimestamp;

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '00000000-0000-4000-8000-000000000001' as Note['id'],
    title: 'Research notes',
    subtitle: 'Reading list',
    editorDoc: null,
    plainText: 'First paragraph of the note body.',
    createdAt: '2026-09-01T09:00:00.000Z' as UtcTimestamp,
    updatedAt: '2026-10-11T18:30:00.000Z' as UtcTimestamp,
    state: 'active',
    pinned: false,
    favorite: false,
    trashedAt: null,
    archivedAt: null,
    revisionId: null,
    duplicatedFrom: null,
    cardBackgroundColor: null,
    cardForegroundColor: null,
    ...overrides,
  };
}

function makeTag(name: string): Tag {
  return {
    id: '00000000-0000-4000-8000-0000000000aa' as Tag['id'],
    name,
    normalizedKey: name.toLowerCase(),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeRelated(overrides: Partial<RelatedInfo> = {}): RelatedInfo {
  return { tags: [], categories: [], links: [], reminders: [], ...overrides };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: '00000000-0000-4000-8000-0000000000bb' as Reminder['id'],
    noteId: '00000000-0000-4000-8000-000000000001' as Reminder['noteId'],
    dueAt: '2026-11-01T09:00:00.000Z' as UtcTimestamp,
    recurrence: null,
    timeZone: 'UTC' as TimeZoneName,
    state: 'active',
    lastFiredAt: null,
    nextDueAt: '2026-11-01T09:00:00.000Z' as UtcTimestamp,
    createdAt: NOW,
    updatedAt: NOW,
    snoozedUntil: null,
    ...overrides,
  };
}

function makeLink(snapshotId: string | null, captureState?: Link['captureState']): Link {
  return {
    captureState: captureState ?? (snapshotId ? ('captured' as const) : ('detected' as const)),
    id: '00000000-0000-4000-8000-0000000000cc' as Link['id'],
    noteId: '00000000-0000-4000-8000-000000000001' as Link['noteId'],
    originalUrl: 'https://example.org/article',
    dedupKey: 'https://example.org/article',
    anchorText: 'Example article',
    origin: 'https://example.org',
    createdAt: NOW,
    snapshotId: snapshotId as Link['snapshotId'],
  };
}

describe('previewText (safe truncation, PRD §4.2)', () => {
  it('normalises whitespace without truncating short text', () => {
    const result = previewText('  hello   \n\n  world  ');
    expect(result).toEqual({ text: 'hello world', truncated: false });
  });

  it('truncates long text at a word boundary with an ellipsis', () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const result = previewText(words, 50);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(52);
    expect(result.text).not.toMatch(/word\d+\s*$/);
  });

  it('falls back to a hard cut when no usable word boundary exists', () => {
    const result = previewText('x'.repeat(300), 50);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(51); // 50 chars + ellipsis
  });

  it('returns empty text for blank bodies', () => {
    expect(previewText('   \n\t ')).toEqual({ text: '', truncated: false });
  });
});

describe('dateLabel', () => {
  it('formats ISO timestamps as stable dates', () => {
    expect(dateLabel('2026-10-11T18:30:00.000Z' as UtcTimestamp)).toBe('2026-10-11');
  });
});

describe('reminderChipFor', () => {
  it('reports none without reminders', () => {
    expect(reminderChipFor([], NOW)).toEqual({ kind: 'none' });
  });

  it('flags overdue reminders with the date', () => {
    const reminder = makeReminder({ nextDueAt: '2026-10-01T09:00:00.000Z' as UtcTimestamp });
    expect(reminderChipFor([reminder], NOW)).toEqual({
      kind: 'overdue',
      label: 'Overdue since 2026-10-01',
    });
  });

  it('prefers the snooze target while snoozed', () => {
    const reminder = makeReminder({
      snoozedUntil: '2026-10-20T09:00:00.000Z' as UtcTimestamp,
      nextDueAt: '2026-10-20T09:00:00.000Z' as UtcTimestamp,
    });
    expect(reminderChipFor([reminder], NOW)).toEqual({
      kind: 'snoozed',
      label: 'Snoozed until 2026-10-20',
    });
  });

  it('labels upcoming reminders', () => {
    expect(reminderChipFor([makeReminder()], NOW)).toEqual({
      kind: 'due',
      label: 'Due 2026-11-01',
    });
  });

  it('acknowledges completed reminders', () => {
    const reminder = makeReminder({ state: 'completed' });
    expect(reminderChipFor([reminder], NOW)).toEqual({
      kind: 'completed',
      label: 'Reminder completed',
    });
  });
});

describe('cardViewModel', () => {
  it('maps note + related into the full card field set', () => {
    const note = makeNote({ pinned: true, favorite: true });
    const related = makeRelated({
      tags: [makeTag('research'), makeTag('to-read')],
      links: [makeLink(null), makeLink('00000000-0000-4000-8000-0000000000dd' as never)],
    });
    const model = cardViewModel(note, related, NOW);
    expect(model.title).toBe('Research notes');
    expect(model.subtitle).toBe('Reading list');
    expect(model.preview).toBe('First paragraph of the note body.');
    expect(model.createdLabel).toBe('2026-09-01');
    expect(model.modifiedLabel).toBe('2026-10-11');
    expect(model.tagNames).toEqual(['research', 'to-read']);
    expect(model.hasLinks).toBe(true);
    expect(model.archivedCount).toBe(1);
    expect(model.pinned).toBe(true);
    expect(model.favorite).toBe(true);
  });

  it('surfaces queued captures in the link indicator (T-020)', () => {
    const note = makeNote({});
    const queued = makeRelated({ links: [makeLink(null, 'queued')] });
    const model = cardViewModel(note, queued, NOW);
    expect(model.queuedCount).toBe(1);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const chips = [...card.querySelectorAll('.chip')].map((el) => el.textContent);
    expect(chips).toContain('Link · 1 capture queued');

    // Archived beats queued in the label — a finished capture is the more
    // informative state once at least one exists.
    const mixed = makeRelated({
      links: [
        makeLink(null, 'queued'),
        makeLink('00000000-0000-4000-8000-0000000000dd' as never),
      ],
    });
    const mixedModel = cardViewModel(note, mixed, NOW);
    const mixedCard = renderCard(mixedModel, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const mixedChips = [...mixedCard.querySelectorAll('.chip')].map((el) => el.textContent);
    expect(mixedChips).toContain('Link · 1 archived');
  });

  it('labels untitled notes honestly (PRD §4.3)', () => {
    const model = cardViewModel(makeNote({ title: '   ' }), EMPTY_RELATED, NOW);
    expect(model.title).toBe('Untitled');
  });
});

describe('renderCard', () => {
  it('renders textContent only — previews and chips never parse HTML', () => {
    const note = makeNote({
      plainText: '<img src=x onerror=alert(1)> plain text only',
    });
    const model = cardViewModel(note, EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const preview = card.querySelector('.card__preview');
    expect(preview?.innerHTML).not.toContain('<img');
    expect(preview?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.querySelectorAll('img').length).toBe(0);
  });

  it('shows chips for tags, categories, links and reminder states', () => {
    const related = makeRelated({
      tags: [makeTag('work')],
      categories: [{ id: 'x' as never, name: 'Projects', parentId: null, order: 0, createdAt: NOW, updatedAt: NOW } as Category],
      links: [makeLink(null)],
      reminders: [makeReminder()],
    });
    const model = cardViewModel(makeNote(), related, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const chips = [...card.querySelectorAll('.chip')].map((el) => el.textContent);
    expect(chips).toContain('Tag: work');
    expect(chips).toContain('Category: Projects');
    expect(chips).toContain('Link');
    expect(chips).toContain('Due 2026-11-01');
  });

  it('wires the selection checkbox', () => {
    const onToggleSelect = vi.fn();
    const model = cardViewModel(makeNote(), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect });
    const box = card.querySelector<HTMLInputElement>('.card__select');
    expect(box?.getAttribute('aria-label')).toBe('Select Research notes');
    box?.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onToggleSelect).toHaveBeenCalledWith(model.noteId);
  });

  it('renders list and selected variants', () => {
    const model = cardViewModel(makeNote(), EMPTY_RELATED, NOW);
    const listCard = renderCard(model, { viewMode: 'list', selected: true, onToggleSelect: () => undefined });
    expect(listCard.className).toContain('card--list');
    expect(listCard.className).toContain('card--selected');
    expect(listCard.querySelector<HTMLInputElement>('.card__select')?.checked).toBe(true);
  });

  it('marks Pinned and Favorite with worded badges', () => {
    const model = cardViewModel(makeNote({ pinned: true, favorite: true }), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.querySelector('.card__badge')?.textContent).toBe('Pinned');
    expect(card.querySelector('.card__badge--favorite')?.textContent).toBe('Favorite');
  });

  it('stacks card content in the user-directed reading order (T-060)', () => {
    // Title on top, then subtitle, then body text, then tags and
    // categories on separate rows, then link indicators, then the
    // reminder ON ITS OWN row (T-107), then one meta row PER fact
    // (T-107: created and modified are separate blocks, never inline).
    const related = makeRelated({
      tags: [makeTag('work')],
      categories: [{ id: 'x' as never, name: 'Projects', parentId: null, order: 0, createdAt: NOW, updatedAt: NOW } as Category],
      links: [makeLink(null)],
      reminders: [makeReminder()],
    });
    const model = cardViewModel(makeNote(), related, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const content = card.querySelector('.card__content');
    expect(content).not.toBeNull();
    const classes = [...(content as HTMLElement).children].map((el) => el.className);
    expect(classes).toHaveLength(8);
    expect(classes[0]).toContain('card__title');
    expect(classes[1]).toContain('card__subtitle');
    expect(classes[2]).toContain('card__preview');
    expect(classes[3]).toContain('card__chips--tags');
    expect(classes[4]).toContain('card__chips--categories');
    expect(classes[5]).toContain('card__chips--indicators');
    expect(classes[6]).toContain('card__chips--reminders');
    expect(classes[7]).toContain('card__meta-rows');
  });

  it('never renders tags and categories inline on one row (T-060)', () => {
    const related = makeRelated({
      tags: [makeTag('work'), makeTag('urgent')],
      categories: [{ id: 'x' as never, name: 'Projects', parentId: null, order: 0, createdAt: NOW, updatedAt: NOW } as Category],
      links: [makeLink(null)],
      reminders: [makeReminder()],
    });
    const model = cardViewModel(makeNote(), related, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });

    const tagsRow = card.querySelector('.card__chips--tags');
    const categoriesRow = card.querySelector('.card__chips--categories');
    const indicatorsRow = card.querySelector('.card__chips--indicators');
    const remindersRow = card.querySelector('.card__chips--reminders');
    expect(tagsRow).not.toBeNull();
    expect(categoriesRow).not.toBeNull();
    expect(indicatorsRow).not.toBeNull();
    expect(remindersRow, 'T-107: the reminder row exists (even when empty it is queried)').not.toBeNull();

    // Each row carries ONLY its own kind of chip.
    expect([...tagsRow!.querySelectorAll('.chip')].map((el) => el.textContent)).toEqual([
      'Tag: work',
      'Tag: urgent',
    ]);
    expect([...categoriesRow!.querySelectorAll('.chip')].map((el) => el.textContent)).toEqual([
      'Category: Projects',
    ]);
    expect([...indicatorsRow!.querySelectorAll('.chip')].map((el) => el.textContent)).toEqual(['Link']);
    // T-107: the reminder chip lives on its OWN row — never inline with
    // the link indicators.
    expect([...remindersRow!.querySelectorAll('.chip')].map((el) => el.textContent)).toEqual([
      'Due 2026-11-01',
    ]);
    expect(tagsRow!.querySelector('.chip--category')).toBeNull();
    expect(tagsRow!.querySelector('.chip--indicator')).toBeNull();
    expect(categoriesRow!.querySelector('.chip--tag')).toBeNull();
    expect(categoriesRow!.querySelector('.chip--indicator')).toBeNull();
    expect(indicatorsRow!.querySelector('.chip--tag')).toBeNull();
    expect(indicatorsRow!.querySelector('.chip--category')).toBeNull();
    expect(indicatorsRow!.querySelector('.chip--reminder-ok'), 'the reminder chip must not sit in the indicators row').toBeNull();
    expect(remindersRow!.querySelector('.chip--tag')).toBeNull();
    expect(remindersRow!.querySelector('.chip--indicator')).toBeNull();
  });

  it('omits empty chip rows entirely (T-060)', () => {
    const model = cardViewModel(makeNote(), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.querySelector('.card__chips--tags')).toBeNull();
    expect(card.querySelector('.card__chips--categories')).toBeNull();
    expect(card.querySelector('.card__chips--indicators')).toBeNull();
    // makeNote() carries the default subtitle 'Reading list'.
    const classes = [...(card.querySelector('.card__content') as HTMLElement).children].map(
      (el) => el.className,
    );
    expect(classes).toHaveLength(4); // title, subtitle, preview, meta rows
    expect(classes[0]).toContain('card__title');
    expect(classes[1]).toContain('card__subtitle');
    expect(classes[2]).toContain('card__preview');
    expect(classes[3]).toContain('card__meta-rows');
  });
});

describe('smart lists', () => {
  it('defines the seven PRD §4.2 lists', () => {
    expect(SMART_LISTS.map((list) => list.id)).toEqual([
      'all',
      'pinned',
      'favorites',
      'recent',
      'overdue',
      'archived',
      'trashed',
    ]);
    for (const list of SMART_LISTS) {
      expect(list.label.length).toBeGreaterThan(0);
    }
  });

  it('applies structural filters that the user query cannot drop', () => {
    const pinned = smartListById('pinned');
    expect(effectiveFilters(pinned, { favorite: true })).toEqual({
      favorite: true,
      pinned: true,
      state: 'active',
    });
    const trashed = smartListById('trashed');
    expect(effectiveFilters(trashed, {})).toEqual({ state: 'trashed' });
  });

  it('sorts overdue lists by reminder ascending', () => {
    expect(smartListById('overdue').sort).toEqual({ field: 'reminder', direction: 'asc' });
  });
});

describe('bulk action bar', () => {
  it('hides with no selection and surfaces counts with one', () => {
    const bar = createBulkBar({ onAction: () => undefined, onClearSelection: () => undefined });
    bar.update({
      selectedCount: 0,
      totalSelected: 0,
      viewAllows: { archive: true, restore: false, trash: true, deletePermanently: false, pin: true, favorite: true },
      tags: [],
      categories: [],
    });
    expect(bar.element.hidden).toBe(true);

    bar.update({
      selectedCount: 2,
      totalSelected: 5,
      viewAllows: { archive: true, restore: false, trash: true, deletePermanently: false, pin: true, favorite: true },
      tags: [],
      categories: [],
    });
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.textContent).toContain('2 selected on this page (5 total)');
    expect(bar.element.textContent).toContain('Archive');
    expect(bar.element.textContent).toContain('Move to trash…');
    expect(bar.element.textContent).not.toContain('Delete permanently…');
    expect(bar.element.textContent).not.toContain('Restore');
  });

  it('offers restore and permanent delete only where they apply', () => {
    const bar = createBulkBar({ onAction: () => undefined, onClearSelection: () => undefined });
    bar.update({
      selectedCount: 3,
      totalSelected: 3,
      viewAllows: { archive: false, restore: true, trash: false, deletePermanently: true, pin: false, favorite: false },
      tags: [],
      categories: [],
    });
    expect(bar.element.textContent).toContain('Restore');
    expect(bar.element.textContent).toContain('Delete permanently…');
    expect(bar.element.textContent).not.toContain('Move to trash…');
    expect(bar.element.textContent).not.toContain('Pin');
  });

  it('emits non-destructive actions directly', () => {
    const actions: string[] = [];
    const bar = createBulkBar({
      onAction: (action) => actions.push(action.kind),
      onClearSelection: () => undefined,
    });
    bar.update({
      selectedCount: 1,
      totalSelected: 1,
      viewAllows: { archive: true, restore: false, trash: true, deletePermanently: false, pin: true, favorite: true },
      tags: [],
      categories: [],
    });
    const buttons = [...bar.element.querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Archive')?.click();
    buttons.find((b) => b.textContent === 'Pin')?.click();
    expect(actions).toEqual(['archive', 'pin']);
  });
});
