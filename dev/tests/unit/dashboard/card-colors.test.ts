// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  AUTO_FG_DARK,
  AUTO_FG_LIGHT,
  autoForegroundColor,
  contrastRatio,
  normalizeHexColor,
  relativeLuminance,
  resolveCardColors,
} from '../../../../src/dashboard/views/card-colors';
import { cardViewModel, renderCard, EMPTY_RELATED, type RelatedInfo } from '../../../../src/dashboard/views/cards';
import type { Note, Reminder, UtcTimestamp } from '../../../../src/core/types';

/**
 * T-107 validation: the pure card color math (WCAG relative luminance +
 * contrast ratio, auto foreground pick, strict #rrggbb normalization) and
 * the tinted card rendering contract (data-tinted + custom properties,
 * default cards untouched).
 */

const NOW = '2026-10-15T12:00:00.000Z' as UtcTimestamp;

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '00000000-0000-4000-8000-000000000001' as Note['id'],
    title: 'Colored note',
    subtitle: '',
    editorDoc: null,
    plainText: 'Body text.',
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

function makeReminder(): Reminder {
  return {
    id: '00000000-0000-4000-8000-0000000000bb' as Reminder['id'],
    noteId: '00000000-0000-4000-8000-000000000001' as Reminder['noteId'],
    dueAt: '2026-11-01T09:00:00.000Z' as UtcTimestamp,
    recurrence: null,
    timeZone: 'UTC' as Reminder['timeZone'],
    state: 'active',
    lastFiredAt: null,
    nextDueAt: '2026-11-01T09:00:00.000Z' as UtcTimestamp,
    createdAt: NOW,
    updatedAt: NOW,
    snoozedUntil: null,
  };
}

describe('normalizeHexColor (T-107)', () => {
  it('accepts strict lowercase #rrggbb', () => {
    expect(normalizeHexColor('#f2c94c')).toBe('#f2c94c');
    expect(normalizeHexColor('#000000')).toBe('#000000');
    expect(normalizeHexColor('#ffffff')).toBe('#ffffff');
    expect(normalizeHexColor('#0e7490')).toBe('#0e7490');
  });

  it('treats null/undefined as not set', () => {
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
  });

  it('rejects every non-conforming form — CSS injection can never pass', () => {
    const rejects = [
      '#F2C94C', // uppercase
      '#f2c94', // 5 digits
      '#f2c94cc', // 7 digits
      'f2c94c', // missing #
      '#f2c9', // shorthand
      'rgb(95, 95, 95)', // function notation
      'red', // keyword
      'red; } body { display: none', // injection attempt
      'url(javascript:alert(1))', // url injection
      '#f2c94c; border-width: 99px', // trailing payload
      '', // empty
      'transparent',
    ];
    for (const value of rejects) {
      expect(normalizeHexColor(value as string), `must reject ${JSON.stringify(value)}`).toBeNull();
    }
  });
});

describe('WCAG math (T-107)', () => {
  it('relative luminance: white = 1, black = 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
  });

  it('contrast ratio: black/white = 21, identical colors = 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#4c4fd8', '#4c4fd8')).toBeCloseTo(1, 10);
  });

  it('auto foreground picks the higher-contrast token (T-107 requirement)', () => {
    // Light backgrounds get the dark token; dark backgrounds the light one.
    expect(autoForegroundColor('#f2c94c')).toBe(AUTO_FG_DARK);
    expect(autoForegroundColor('#ffffff')).toBe(AUTO_FG_DARK);
    expect(autoForegroundColor('#e28fa8')).toBe(AUTO_FG_DARK);
    expect(autoForegroundColor('#17181d')).toBe(AUTO_FG_LIGHT);
    expect(autoForegroundColor('#1c6b3c')).toBe(AUTO_FG_LIGHT);
    expect(autoForegroundColor('#0e7490')).toBe(AUTO_FG_LIGHT);
    // Every palette color resolves to a fg with contrast >= 4.5:1.
    const PALETTE = [
      '#f2c94c', '#e8a13c', '#dd5a55', '#e28fa8', '#8b8ff7', '#4c4fd8',
      '#4fa3d1', '#0e7490', '#3fa66a', '#1c6b3c', '#a277bd', '#6b5b4a',
    ];
    for (const bg of PALETTE) {
      const fg = autoForegroundColor(bg);
      expect(contrastRatio(bg, fg), `${fg} on ${bg} must reach 4.5:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('resolveCardColors (T-107)', () => {
  it('null/null → null: the present condition is preserved exactly', () => {
    expect(resolveCardColors(null, null)).toBeNull();
    expect(resolveCardColors(undefined, undefined)).toBeNull();
    // Invalid stored values (legacy/corrupt) normalize to unset too.
    expect(resolveCardColors('red', 'blue')).toBeNull();
  });

  it('background set, text null → auto fg by WCAG contrast', () => {
    expect(resolveCardColors('#f2c94c', null)).toEqual({ bg: '#f2c94c', fg: AUTO_FG_DARK });
    expect(resolveCardColors('#17181d', null)).toEqual({ bg: '#17181d', fg: AUTO_FG_LIGHT });
  });

  it('explicit text color wins over auto (user-set color requirement)', () => {
    expect(resolveCardColors('#f2c94c', '#111111')).toEqual({ bg: '#f2c94c', fg: '#111111' });
  });

  it('text-only tint keeps the theme surface (bg null)', () => {
    expect(resolveCardColors(null, '#dd5a55')).toEqual({ bg: null, fg: '#dd5a55' });
  });
});

describe('card view model + tinted rendering (T-107)', () => {
  it('carries the stored colors and the resolved set', () => {
    const model = cardViewModel(makeNote({ cardBackgroundColor: '#1c6b3c' }), EMPTY_RELATED, NOW);
    expect(model.cardBackgroundColor).toBe('#1c6b3c');
    expect(model.cardForegroundColor).toBeNull();
    expect(model.resolvedCardColors).toEqual({ bg: '#1c6b3c', fg: AUTO_FG_LIGHT });
  });

  it('a DEFAULT card renders with NO data-tinted and NO inline color properties', () => {
    const model = cardViewModel(makeNote(), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.dataset['tinted']).toBeUndefined();
    expect(card.style.getPropertyValue('--card-bg')).toBe('');
    expect(card.style.getPropertyValue('--card-fg')).toBe('');
  });

  it('a tinted card carries data-tinted + the resolved custom properties', () => {
    const model = cardViewModel(
      makeNote({ cardBackgroundColor: '#0e7490' }),
      EMPTY_RELATED,
      NOW,
    );
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.dataset['tinted']).toBe('true');
    expect(card.style.getPropertyValue('--card-bg')).toBe('#0e7490');
    expect(card.style.getPropertyValue('--card-fg')).toBe(AUTO_FG_LIGHT);
  });

  it('a text-only tint sets --card-fg but never --card-bg', () => {
    const model = cardViewModel(makeNote({ cardForegroundColor: '#dd5a55' }), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.dataset['tinted']).toBe('true');
    expect(card.style.getPropertyValue('--card-bg')).toBe('');
    expect(card.style.getPropertyValue('--card-fg')).toBe('#dd5a55');
  });

  it('invalid stored colors render as a default card (never trusted)', () => {
    const model = cardViewModel(
      makeNote({ cardBackgroundColor: 'javascript:alert(1)' }),
      EMPTY_RELATED,
      NOW,
    );
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.dataset['tinted']).toBeUndefined();
    expect(card.style.length).toBe(0);
  });

  it('Created and Modified render as SEPARATE blocks — nothing inline (T-107)', () => {
    const related: RelatedInfo = { ...EMPTY_RELATED, reminders: [makeReminder()] };
    const model = cardViewModel(makeNote(), related, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const rows = [...card.querySelectorAll('.card__meta-row')].map((el) => el.textContent);
    expect(rows).toEqual(['Created 2026-09-01', 'Modified 2026-10-11']);
    // Each fact is its own list item — never one joined line.
    const created = card.querySelector('.card__meta-row--created');
    const modified = card.querySelector('.card__meta-row--modified');
    expect(created).not.toBeNull();
    expect(modified).not.toBeNull();
    expect(created!.textContent).not.toContain('Modified');
    expect(modified!.textContent).not.toContain('Created');
  });

  it('the reminder chip renders on its own row, separate from link indicators (T-107)', () => {
    const related: RelatedInfo = { ...EMPTY_RELATED, reminders: [makeReminder()] };
    const model = cardViewModel(makeNote(), related, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    const remindersRow = card.querySelector('.card__chips--reminders');
    expect(remindersRow).not.toBeNull();
    expect(remindersRow!.querySelector('.chip')?.textContent).toBe('Due 2026-11-01');
    expect(card.querySelector('.card__chips--indicators .chip--reminder-ok')).toBeNull();
  });

  it('omits the empty reminder row entirely', () => {
    const model = cardViewModel(makeNote(), EMPTY_RELATED, NOW);
    const card = renderCard(model, { viewMode: 'grid', selected: false, onToggleSelect: () => undefined });
    expect(card.querySelector('.card__chips--reminders')).toBeNull();
  });
});
