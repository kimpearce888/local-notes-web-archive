/**
 * Card color panel (T-107): the editor's pop-out panel for choosing the
 * note card's background and text colors.
 *
 * Interaction model (mirrors pin/favorite and the note metadata bar):
 * every pick applies IMMEDIATELY through notes/set-appearance — never
 * deferred to autosave — and failures are announced honestly instead of
 * pretending the color changed. "Default" clears the background (present
 * condition preserved); "Auto" clears an explicit text color so the
 * foreground is derived from the background's WCAG contrast again.
 *
 * CSP-safe construction: createElement/textContent only — color values
 * are validated strict `#rrggbb` hex strings set through the
 * style.setProperty API, never string-built cssText.
 */

import type { EntityId, Note } from '../../core/types';
import { normalizeHexColor } from '../views/card-colors';

/** The curated dashboard palette — distinct hue families, auto-contrasted text. */
export const CARD_COLOR_PALETTE: readonly { name: string; hex: string }[] = [
  { name: 'Amber', hex: '#f2c94c' },
  { name: 'Orange', hex: '#e8a13c' },
  { name: 'Red', hex: '#dd5a55' },
  { name: 'Pink', hex: '#e28fa8' },
  { name: 'Lavender', hex: '#8b8ff7' },
  { name: 'Indigo', hex: '#4c4fd8' },
  { name: 'Sky', hex: '#4fa3d1' },
  { name: 'Teal', hex: '#0e7490' },
  { name: 'Mint', hex: '#3fa66a' },
  { name: 'Forest', hex: '#1c6b3c' },
  { name: 'Violet', hex: '#a277bd' },
  { name: 'Taupe', hex: '#6b5b4a' },
];

/** Appearance operations the panel needs (RPC-backed). */
export interface CardColorApi {
  /**
   * Persist card colors; resolves with the updated note, or null when the
   * write failed (the panel announces the failure honestly).
   */
  setCardAppearance(
    noteId: EntityId,
    appearance: { cardBackgroundColor?: string | null; cardForegroundColor?: string | null },
  ): Promise<Note | null>;
}

export interface CardColorPanelInput {
  readonly noteId: EntityId;
  /** Colors as currently stored (null = default / auto). */
  readonly initial: { cardBackgroundColor: string | null; cardForegroundColor: string | null };
  readonly api: CardColorApi;
  /** Outcome announcements (screen reader + status line). */
  onNotify(message: string, kind: 'info' | 'error'): void;
  /** The stored note changed (color applied) — lets the session sync. */
  onApplied?(note: Note): void;
  /** Invoked by the Close control (T-085: every surfaced surface closes itself). */
  onClose(): void;
}

export interface CardColorPanel {
  readonly element: HTMLElement;
  /** Live preview refresh (the note's colors may change elsewhere). */
  refresh(note: { cardBackgroundColor: string | null; cardForegroundColor: string | null }): void;
  dispose(): void;
}

/** One palette row: reset option + curated swatches + native custom input. */
interface SwatchRowHandles {
  readonly container: HTMLElement;
  /** Buttons whose aria-pressed mirrors the current selection. */
  readonly swatchButtons: HTMLButtonElement[];
  readonly customInput: HTMLInputElement;
}

function createSwatchRow(options: {
  groupLabelId: string;
  rowLabel: string;
  resetLabel: string;
  resetDescription: string;
  initial: string | null;
  onPick: (hex: string | null) => void;
}): SwatchRowHandles {
  const container = document.createElement('div');
  container.className = 'card-color-panel__swatches';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-labelledby', options.groupLabelId);

  const swatchButtons: HTMLButtonElement[] = [];

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--ghost card-color-panel__reset';
  reset.textContent = options.resetLabel;
  reset.setAttribute('aria-label', `${options.resetLabel} — ${options.resetDescription}`);
  reset.dataset['value'] = '';
  reset.addEventListener('click', () => options.onPick(null));
  swatchButtons.push(reset);
  container.append(reset);

  for (const entry of CARD_COLOR_PALETTE) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'card-color-panel__swatch';
    // Curated constant hex — validated shape by construction, applied
    // through the safe setProperty API (never cssText string building).
    swatch.style.setProperty('background-color', entry.hex);
    swatch.setAttribute('aria-label', `${options.rowLabel}: ${entry.name}`);
    swatch.title = `${entry.name} ${entry.hex}`;
    swatch.dataset['value'] = entry.hex;
    swatch.addEventListener('click', () => options.onPick(entry.hex));
    swatchButtons.push(swatch);
    container.append(swatch);
  }

  const customLabel = document.createElement('label');
  customLabel.className = 'card-color-panel__custom';
  customLabel.textContent = 'Custom';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.className = 'card-color-panel__custom-input';
  customInput.setAttribute(
    'aria-label',
    `Custom ${options.rowLabel.toLowerCase()} color picker`,
  );
  // Seed the native picker with the current value (or a neutral default)
  // so it opens on something sensible.
  customInput.value = options.initial ?? '#f2c94c';
  customInput.addEventListener('change', () => {
    const hex = normalizeHexColor(customInput.value);
    if (hex === null) {
      // The native input should only ever emit #rrggbb; guard anyway.
      options.onPick(null);
      return;
    }
    options.onPick(hex);
  });
  customLabel.append(customInput);
  container.append(customLabel);

  return { container, swatchButtons, customInput };
}

/** Reflect the current selection in a row's aria-pressed states. */
function syncRowPressed(row: SwatchRowHandles, current: string | null): void {
  for (const button of row.swatchButtons) {
    const value = button.dataset['value'] ?? '';
    const selected = current === null ? value === '' : value === current;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
}

export function createCardColorPanel(input: CardColorPanelInput): CardColorPanel {
  const { noteId, api, onNotify } = input;
  let colors = {
    cardBackgroundColor: input.initial.cardBackgroundColor,
    cardForegroundColor: input.initial.cardForegroundColor,
  };
  let mutationInFlight = false;

  const element = document.createElement('section');
  element.className = 'card-color-panel';
  element.setAttribute('aria-label', 'Card color');

  const heading = document.createElement('h2');
  heading.className = 'card-color-panel__heading';
  heading.textContent = 'Card color';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost panel-header__close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', 'Close card color');
  close.addEventListener('click', () => input.onClose());

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.append(heading, close);
  element.append(header);

  const hint = document.createElement('p');
  hint.className = 'card-color-panel__hint';
  hint.textContent =
    'Colors apply immediately. By default the text color adapts automatically for readability on the background you choose.';
  element.append(hint);

  const backgroundLabelId = 'card-color-background-label';
  const backgroundLabel = document.createElement('h3');
  backgroundLabel.id = backgroundLabelId;
  backgroundLabel.className = 'card-color-panel__group-label';
  backgroundLabel.textContent = 'Background';
  const backgroundRow = createSwatchRow({
    groupLabelId: backgroundLabelId,
    rowLabel: 'Background',
    resetLabel: 'Default',
    resetDescription: 'keep the standard card look',
    initial: colors.cardBackgroundColor,
    onPick: (hex) => void apply({ cardBackgroundColor: hex }),
  });
  element.append(backgroundLabel, backgroundRow.container);

  const textLabelId = 'card-color-text-label';
  const textLabel = document.createElement('h3');
  textLabel.id = textLabelId;
  textLabel.className = 'card-color-panel__group-label';
  textLabel.textContent = 'Text';
  const textRow = createSwatchRow({
    groupLabelId: textLabelId,
    rowLabel: 'Text',
    resetLabel: 'Auto',
    resetDescription: 'pick the readable text color automatically',
    initial: colors.cardForegroundColor,
    onPick: (hex) => void apply({ cardForegroundColor: hex }),
  });
  element.append(textLabel, textRow.container);

  syncRowPressed(backgroundRow, colors.cardBackgroundColor);
  syncRowPressed(textRow, colors.cardForegroundColor);

  async function apply(
    appearance: { cardBackgroundColor?: string | null; cardForegroundColor?: string | null },
  ): Promise<void> {
    if (mutationInFlight) return; // one in-flight color write, like the meta bar
    mutationInFlight = true;
    try {
      const note = await api.setCardAppearance(noteId, appearance);
      if (!note) {
        onNotify('Updating the card color failed — please try again.', 'error');
        return;
      }
      colors = {
        cardBackgroundColor: note.cardBackgroundColor ?? null,
        cardForegroundColor: note.cardForegroundColor ?? null,
      };
      syncRowPressed(backgroundRow, colors.cardBackgroundColor);
      syncRowPressed(textRow, colors.cardForegroundColor);
      if (appearance.cardBackgroundColor !== undefined) {
        onNotify(
          appearance.cardBackgroundColor === null
            ? 'Card background reset to the default look.'
            : `Card background set to ${appearance.cardBackgroundColor}.`,
          'info',
        );
      }
      if (appearance.cardForegroundColor !== undefined) {
        onNotify(
          appearance.cardForegroundColor === null
            ? 'Card text color set to automatic.'
            : `Card text color set to ${appearance.cardForegroundColor}.`,
          'info',
        );
      }
      input.onApplied?.(note);
    } catch (error) {
      onNotify(
        `Updating the card color failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        'error',
      );
    } finally {
      mutationInFlight = false;
    }
  }

  return {
    element,
    refresh(note: { cardBackgroundColor: string | null; cardForegroundColor: string | null }): void {
      colors = {
        cardBackgroundColor: note.cardBackgroundColor ?? null,
        cardForegroundColor: note.cardForegroundColor ?? null,
      };
      syncRowPressed(backgroundRow, colors.cardBackgroundColor);
      syncRowPressed(textRow, colors.cardForegroundColor);
    },
    dispose(): void {
      // No listeners outside the panel's own subtree; removal suffices.
    },
  };
}
