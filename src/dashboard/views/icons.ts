/**
 * Decorative inline SVG icons for the redesigned UI (T-056).
 *
 * Every icon is a 16×16 stroke glyph rendered inline — no remote asset, no
 * webfont, no CSP interaction. Icons are ALWAYS decorative: callers must
 * keep the accessible name on the surrounding control (button text or
 * aria-label). Nothing here carries meaning on its own (PRD §11: no
 * status by glyph alone).
 */

export type IconName =
  | 'note'
  | 'plus'
  | 'import'
  | 'settings'
  | 'activity'
  | 'layers'
  | 'pin'
  | 'star'
  | 'clock'
  | 'alarm'
  | 'archive'
  | 'trash'
  | 'search'
  | 'command'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'arrow-left'
  | 'arrow-right'
  | 'check';

/** Compact stroke paths on a 16×16 grid (feather-style, 1.5px stroke). */
const PATHS: Readonly<Record<IconName, string>> = {
  // Document with a folded corner and text lines.
  note:
    'M4 1.75h5L12.25 5v9.25H4z M9 1.75V5h3.25 M6 8h4 M6 10.5h4',
  // Simple plus.
  plus: 'M8 3.5v9 M3.5 8h9',
  // Tray with an up arrow (import from file).
  import: 'M8 2.5v7 M5.2 5.3 8 2.5l2.8 2.8 M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2',
  // Sliders (settings).
  settings:
    'M2.5 4.5h6 M11 4.5h2.5 M2.5 11.5h2 M7 11.5h6.5 M9.5 2.75v3.5 M5 9.75v3.5',
  // Heartbeat polyline (diagnostics / observability).
  activity: 'M1.75 8h3l1.5-4 3 8 1.5-4h3.5',
  // Stacked layers (all notes).
  layers:
    'M8 2 14.25 5.25 8 8.5 1.75 5.25z M2.6 8.2 8 11.2l5.4-3 M2.6 11 8 14l5.4-3',
  // Push-pin.
  pin: 'M9.75 1.75l4.5 4.5-1.75.6-2.1 2.1.35 2.6L8 10.1l-3.4 3.4-1.1-1.1L6.9 9 4.9 6.4l2.6.35L9.6 4.6z',
  // Five-point star outline.
  star:
    'M8 1.75l1.9 3.9 4.3.6-3.1 3 .75 4.25L8 11.5l-3.85 2-.75-4.25-3.1-3 4.3-.6z',
  // Clock face (recently edited).
  clock: 'M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5z M8 5v3.2l2.2 1.3',
  // Alarm bell (overdue reminders).
  alarm:
    'M4 7a4 4 0 0 1 8 0c0 2.6.7 3.9 1.4 4.6H2.6C3.3 10.9 4 9.6 4 7z M6.4 13.2a1.7 1.7 0 0 0 3.2 0',
  // Archive box with a lid slot.
  archive: 'M2 4.25h12v2.5H2z M3.25 6.75v7h9.5v-7 M6.4 9.25h3.2',
  // Trash can.
  trash:
    'M3 4.25h10 M6.5 4.25V2.75h3v1.5 M4 4.25l.7 9.5h6.6l.7-9.5 M6.7 7v4 M9.3 7v4',
  // Magnifier (search).
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.4 10.4 13.75 13.75',
  // Command-palette glyph (terminal chevron).
  command: 'M2 3.75h12v8.5H2z M4.5 6.5 6.3 8l-1.8 1.5 M8.6 9.8h3',
  // Sun (dark→light theme).
  sun: 'M8 4.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5z M8 1.25v1.7 M8 13.05v1.7 M1.25 8h1.7 M13.05 8h1.7 M3.3 3.3l1.2 1.2 M11.5 11.5l1.2 1.2 M12.7 3.3l-1.2 1.2 M4.5 11.5l-1.2 1.2',
  // Crescent moon (light→dark theme).
  moon: 'M13 9.8A5.6 5.6 0 0 1 6.2 3 5.75 5.75 0 1 0 13 9.8z',
  // Monitor (system theme).
  monitor: 'M2 3h12v7.5H2z M6 13h4 M8 10.5V13',
  // Left arrow (back to notes).
  'arrow-left': 'M13 8H3 M6.4 4.2 2.8 8l3.6 3.8',
  // Right arrow (pagination next).
  'arrow-right': 'M3 8h10 M9.6 4.2 13.2 8l-3.6 3.8',
  // Check mark.
  check: 'M3 8.4l3.2 3.2L13 4.6',
};

const cache = new Map<IconName, string>();

function svgMarkup(name: IconName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const markup =
    `<svg class="icon" viewBox="0 0 16 16" width="16" height="16" fill="none" ` +
    `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${PATHS[name]}"/></svg>`;
  cache.set(name, markup);
  return markup;
}

/**
 * Creates a decorative inline SVG element for `name`.
 * The returned element carries `aria-hidden` — it never adds meaning.
 */
export function icon(name: IconName): HTMLElement {
  const host = document.createElement('span');
  host.className = 'icon-host';
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = svgMarkup(name);
  return host;
}
