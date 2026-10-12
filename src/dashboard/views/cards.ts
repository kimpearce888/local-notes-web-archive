/**
 * Card view models and rendering (PRD §4.2): every card shows title,
 * subtitle, tag/category chips, created date, last-modified date, reminder
 * state and link/snapshot indicators. Body previews are plain text with
 * safe truncation — rich HTML is never rendered into a card.
 */

import type { Category, EntityId, Link, Note, Reminder, Tag, UtcTimestamp } from '../../core/types';

export interface RelatedInfo {
  readonly tags: readonly Tag[];
  readonly categories: readonly Category[];
  readonly links: readonly Link[];
  readonly reminders: readonly Reminder[];
}

export const EMPTY_RELATED: RelatedInfo = { tags: [], categories: [], links: [], reminders: [] };

export const PREVIEW_LENGTH = 220;

export type ReminderChipState =
  | { kind: 'none' }
  | { kind: 'overdue'; label: string }
  | { kind: 'due'; label: string }
  | { kind: 'snoozed'; label: string }
  | { kind: 'completed'; label: string };

/** Pure view model for one card — fully unit-testable, no DOM. */
export interface CardViewModel {
  readonly noteId: EntityId;
  readonly title: string;
  readonly subtitle: string;
  /** Safe plain-text preview (truncated, whitespace-normalised). */
  readonly preview: string;
  readonly truncated: boolean;
  readonly createdLabel: string;
  readonly modifiedLabel: string;
  readonly tagNames: readonly string[];
  readonly categoryNames: readonly string[];
  readonly hasLinks: boolean;
  readonly archivedCount: number;
  readonly reminderChip: ReminderChipState;
  readonly pinned: boolean;
  readonly favorite: boolean;
  readonly state: Note['state'];
}

/** ISO timestamp → human date label (stable, locale-independent). */
export function dateLabel(iso: UtcTimestamp): string {
  const text = iso.slice(0, 10);
  const [year, month, day] = text.split('-');
  if (!year || !month || !day) return text;
  return `${year}-${month}-${day}`;
}

/**
 * Plain-text preview: collapse whitespace and truncate at a word boundary
 * with an ellipsis. Input is always textContent-safe material — never HTML.
 */
export function previewText(plainText: string, maxLength = PREVIEW_LENGTH): {
  text: string;
  truncated: boolean;
} {
  const normalized = plainText.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return { text: normalized, truncated: false };
  const slice = normalized.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.6 ? lastSpace : maxLength;
  return { text: `${slice.slice(0, cut)}…`, truncated: true };
}

/** Reminder chip state from related reminders (first meaningful one). */
export function reminderChipFor(reminders: readonly Reminder[], now: UtcTimestamp): ReminderChipState {
  const active = reminders.find((reminder) => reminder.state === 'active');
  if (reminders.length === 0 || !active) {
    const completed = reminders.find((reminder) => reminder.state === 'completed');
    if (completed) return { kind: 'completed', label: 'Reminder completed' };
    return { kind: 'none' };
  }
  const target = active.snoozedUntil ?? active.nextDueAt ?? active.dueAt;
  if (target === null) return { kind: 'none' };
  if (target < now) return { kind: 'overdue', label: `Overdue since ${dateLabel(target)}` };
  if (active.snoozedUntil !== null) {
    return { kind: 'snoozed', label: `Snoozed until ${dateLabel(target)}` };
  }
  return { kind: 'due', label: `Due ${dateLabel(target)}` };
}

export function cardViewModel(
  note: Note,
  related: RelatedInfo,
  now: UtcTimestamp,
): CardViewModel {
  const preview = previewText(note.plainText);
  return {
    noteId: note.id,
    title: note.title.trim().length > 0 ? note.title : 'Untitled',
    subtitle: note.subtitle,
    preview: preview.text,
    truncated: preview.truncated,
    createdLabel: dateLabel(note.createdAt),
    modifiedLabel: dateLabel(note.updatedAt),
    tagNames: related.tags.map((tag) => tag.name),
    categoryNames: related.categories.map((category) => category.name),
    hasLinks: related.links.length > 0,
    archivedCount: related.links.filter((link) => link.snapshotId !== null).length,
    reminderChip: reminderChipFor(related.reminders, now),
    pinned: note.pinned,
    favorite: note.favorite,
    state: note.state,
  };
}

/* ------------------------------------------------------------------ */
/* DOM rendering                                                       */
/* ------------------------------------------------------------------ */

function chip(
  text: string,
  kind: 'tag' | 'category' | 'indicator' | 'reminder-overdue' | 'reminder-ok',
): HTMLElement {
  const element = document.createElement('span');
  element.className = `chip chip--${kind}`;
  element.textContent = text; // textContent only: previews/chips never parse HTML
  return element;
}

export interface RenderCardOptions {
  readonly viewMode: 'grid' | 'list';
  readonly selected: boolean;
  /** Selection checkbox toggle callback. */
  readonly onToggleSelect: (noteId: EntityId) => void;
  /** Open the note in the editor (title activation). */
  readonly onOpen?: (noteId: EntityId) => void;
}

export function renderCard(model: CardViewModel, options: RenderCardOptions): HTMLElement {
  const card = document.createElement('article');
  card.className = `card card--${options.viewMode}${options.selected ? ' card--selected' : ''}`;
  card.dataset['noteId'] = model.noteId;
  card.setAttribute('aria-label', `${model.title}. Modified ${model.modifiedLabel}.`);

  const select = document.createElement('input');
  select.type = 'checkbox';
  select.className = 'card__select';
  select.checked = options.selected;
  select.setAttribute('aria-label', `Select ${model.title}`);
  select.addEventListener('change', () => options.onToggleSelect(model.noteId));

  const content = document.createElement('div');
  content.className = 'card__content';

  const heading = document.createElement('h3');
  heading.className = 'card__title';
  if (model.pinned) {
    const pin = document.createElement('span');
    pin.className = 'card__badge';
    pin.textContent = 'Pinned';
    pin.setAttribute('title', 'Pinned note');
    heading.append(pin);
  }
  if (model.favorite) {
    const favorite = document.createElement('span');
    favorite.className = 'card__badge card__badge--favorite';
    favorite.textContent = 'Favorite';
    favorite.setAttribute('title', 'Favorite note');
    heading.append(favorite);
  }
  if (options.onOpen) {
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'card__title-button';
    titleButton.textContent = model.title;
    titleButton.setAttribute('aria-label', `Open ${model.title} for editing`);
    titleButton.addEventListener('click', () => options.onOpen?.(model.noteId));
    heading.append(titleButton);
  } else {
    const titleText = document.createElement('span');
    titleText.textContent = model.title;
    heading.append(titleText);
  }

  if (model.subtitle.trim().length > 0) {
    const subtitle = document.createElement('p');
    subtitle.className = 'card__subtitle';
    subtitle.textContent = model.subtitle;
    content.append(subtitle);
  }

  if (model.preview.length > 0) {
    const preview = document.createElement('p');
    preview.className = 'card__preview';
    preview.textContent = model.preview;
    if (model.truncated) {
      preview.setAttribute('title', 'Preview truncated — open the note for full text');
    }
    content.append(preview);
  }

  const meta = document.createElement('p');
  meta.className = 'card__meta';
  meta.textContent = `Created ${model.createdLabel} · Modified ${model.modifiedLabel}`;

  const chipsRow = document.createElement('ul');
  chipsRow.className = 'chips card__chips';
  chipsRow.setAttribute('aria-label', 'Tags, categories and indicators');
  for (const name of model.tagNames) {
    const item = document.createElement('li');
    item.append(chip(`Tag: ${name}`, 'tag'));
    chipsRow.append(item);
  }
  for (const name of model.categoryNames) {
    const item = document.createElement('li');
    item.append(chip(`Category: ${name}`, 'category'));
    chipsRow.append(item);
  }
  if (model.hasLinks) {
    const item = document.createElement('li');
    item.append(
      chip(model.archivedCount > 0 ? `Link · ${model.archivedCount} archived` : 'Link', 'indicator'),
    );
    chipsRow.append(item);
  }
  if (model.reminderChip.kind !== 'none') {
    const item = document.createElement('li');
    const label = model.reminderChip.label;
    item.append(chip(label, model.reminderChip.kind === 'overdue' ? 'reminder-overdue' : 'reminder-ok'));
    chipsRow.append(item);
  }

  content.append(heading, meta, chipsRow);
  card.append(select, content);
  return card;
}
