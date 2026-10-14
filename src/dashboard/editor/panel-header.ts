/**
 * Shared disclosure-panel header (T-085, T-084 register UX-01..05): every
 * bar that pops out under the editor header (attachments, snapshots,
 * reminders, AI) and the filters region now carries its own Close control
 * in the surfaced surface itself — a user looking at the bar no longer has
 * to know that the small toolbar toggle is the only way to dismiss it.
 *
 * One mechanism, not five patches: a flex row (title · live count · Close
 * pushed to the end) with the panel's existing heading/count class names so
 * per-panel styling keeps working. Escape handling lives with the panel
 * stack in editor-session.ts; the filters region pairs this header with
 * close-on-apply.
 */

export interface PanelHeaderInput {
  /** Visible panel title, e.g. "Attachments". */
  readonly title: string;
  /** Existing per-panel heading class (styling hook preserved). */
  readonly titleClassName: string;
  /** Existing per-panel count class (aria-live target preserved). */
  readonly countClassName: string;
  /** Screen-reader label for the close control, e.g. "Close attachments". */
  readonly closeAriaLabel: string;
  /** Invoked by the Close button. */
  readonly onClose: () => void;
}

export interface PanelHeader {
  /** The row to append as the panel's first child. */
  readonly row: HTMLElement;
  /** The heading element (title text). */
  readonly title: HTMLHeadingElement;
  /** The count element (live region; empty text renders nothing). */
  readonly count: HTMLElement;
}

export function createPanelHeader(input: PanelHeaderInput): PanelHeader {
  const row = document.createElement('div');
  row.className = 'panel-header';

  const title = document.createElement('h2');
  title.className = input.titleClassName;
  title.textContent = input.title;

  const count = document.createElement('span');
  count.className = input.countClassName;
  count.setAttribute('aria-live', 'polite');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost panel-header__close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', input.closeAriaLabel);
  close.addEventListener('click', () => input.onClose());

  row.append(title, count, close);
  return { row, title, count };
}
