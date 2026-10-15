/**
 * Card view models and rendering (PRD §4.2): every card shows title,
 * subtitle, tag/category chips, created date, last-modified date, reminder
 * state and link/snapshot indicators. Body previews are plain text with
 * safe truncation — rich HTML is never rendered into a card.
 */

import type { Category, EntityId, Link, Note, Reminder, Tag, UtcTimestamp } from '../../core/types';
import { resolveCardColors, type ResolvedCardColors } from './card-colors';

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
  /** Links waiting for the capture queue (T-020 surfacing). */
  readonly queuedCount: number;
  /** Links whose capture failed (T-026 indicator, FR-CAP-07). */
  readonly failedCaptureCount: number;
  readonly reminderChip: ReminderChipState;
  readonly pinned: boolean;
  readonly favorite: boolean;
  readonly state: Note['state'];
  /** Stored card colors (T-107): null = default (present condition). */
  readonly cardBackgroundColor: string | null;
  readonly cardForegroundColor: string | null;
  /** Resolved render colors (T-107): null = NOT tinted (default styling). */
  readonly resolvedCardColors: ResolvedCardColors | null;
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
    queuedCount: related.links.filter((link) => link.captureState === 'queued').length,
    failedCaptureCount: related.links.filter((link) => link.captureState === 'failed').length,
    reminderChip: reminderChipFor(related.reminders, now),
    pinned: note.pinned,
    favorite: note.favorite,
    state: note.state,
    cardBackgroundColor: note.cardBackgroundColor ?? null,
    cardForegroundColor: note.cardForegroundColor ?? null,
    resolvedCardColors: resolveCardColors(note.cardBackgroundColor, note.cardForegroundColor),
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

  // T-107 card colors: a tinted card carries its resolved colors as CSS
  // custom properties + data-tinted. The background uses the safe
  // setProperty API with an already-strict #rrggbb value — never string
  // concatenation into style.cssText. No tint (colors null) keeps every
  // default rule exactly (present condition preserved).
  if (model.resolvedCardColors) {
    card.dataset['tinted'] = 'true';
    if (model.resolvedCardColors.bg !== null) {
      card.style.setProperty('--card-bg', model.resolvedCardColors.bg);
    }
    card.style.setProperty('--card-fg', model.resolvedCardColors.fg);
  }

  const select = document.createElement('input');
  select.type = 'checkbox';
  select.className = 'card__select';
  select.checked = options.selected;
  select.setAttribute('aria-label', `Select ${model.title}`);
  select.addEventListener('change', () => options.onToggleSelect(model.noteId));

  const content = document.createElement('div');
  content.className = 'card__content';

  /* T-060 reading order + T-107 separated blocks: title on top, then
     subtitle, then the body preview, then tags and categories on
     SEPARATE rows (never inline with each other), then link indicators,
     then the reminder ON ITS OWN row, then one meta row PER fact
     (Created and Modified are never inline on one line). Empty rows are
     omitted entirely. */

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
  content.append(heading);

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

  const tagsRow = document.createElement('ul');
  tagsRow.className = 'chips card__chips card__chips--tags';
  tagsRow.setAttribute('aria-label', 'Tags');
  for (const name of model.tagNames) {
    const item = document.createElement('li');
    item.append(chip(`Tag: ${name}`, 'tag'));
    tagsRow.append(item);
  }

  const categoriesRow = document.createElement('ul');
  categoriesRow.className = 'chips card__chips card__chips--categories';
  categoriesRow.setAttribute('aria-label', 'Categories');
  for (const name of model.categoryNames) {
    const item = document.createElement('li');
    item.append(chip(`Category: ${name}`, 'category'));
    categoriesRow.append(item);
  }

  const indicatorsRow = document.createElement('ul');
  indicatorsRow.className = 'chips card__chips card__chips--indicators';
  indicatorsRow.setAttribute('aria-label', 'Link indicators');
  if (model.hasLinks) {
    const item = document.createElement('li');
    item.append(
      chip(
        model.archivedCount > 0
          ? `Link · ${model.archivedCount} archived`
          : model.queuedCount > 0
            ? `Link · ${model.queuedCount} capture${model.queuedCount === 1 ? '' : 's'} queued`
            : 'Link',
        'indicator',
      ),
    );
    indicatorsRow.append(item);
  }
  if (model.failedCaptureCount > 0) {
    const item = document.createElement('li');
    item.append(
      chip(
        `Capture failed · ${model.failedCaptureCount} link${model.failedCaptureCount === 1 ? '' : 's'}`,
        'indicator',
      ),
    );
    item.title = 'A capture attempt failed — open the note to retry from its snapshots panel.';
    indicatorsRow.append(item);
  }

  // T-107: the reminder chip renders on its OWN row — never inline with
  // the link indicators, so a due/overdue reminder is instantly
  // noticeable at a glance.
  const remindersRow = document.createElement('ul');
  remindersRow.className = 'chips card__chips card__chips--reminders';
  remindersRow.setAttribute('aria-label', 'Reminder');
  if (model.reminderChip.kind !== 'none') {
    const item = document.createElement('li');
    const label = model.reminderChip.label;
    item.append(chip(label, model.reminderChip.kind === 'overdue' ? 'reminder-overdue' : 'reminder-ok'));
    remindersRow.append(item);
  }

  if (tagsRow.firstElementChild !== null) content.append(tagsRow);
  if (categoriesRow.firstElementChild !== null) content.append(categoriesRow);
  if (indicatorsRow.firstElementChild !== null) content.append(indicatorsRow);
  if (remindersRow.firstElementChild !== null) content.append(remindersRow);

  // T-107: the meta line splits into ONE row per fact — Created and
  // Modified each get their own block, nothing inline.
  const metaRows = document.createElement('ul');
  metaRows.className = 'card__meta-rows';
  const createdRow = document.createElement('li');
  createdRow.className = 'card__meta-row card__meta-row--created';
  createdRow.textContent = `Created ${model.createdLabel}`;
  const modifiedRow = document.createElement('li');
  modifiedRow.className = 'card__meta-row card__meta-row--modified';
  modifiedRow.textContent = `Modified ${model.modifiedLabel}`;
  metaRows.append(createdRow, modifiedRow);
  content.append(metaRows);

  card.append(select, content);
  return card;
}
