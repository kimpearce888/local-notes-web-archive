/**
 * Card color math (T-107): pure, DOM-free, fully unit-tested.
 *
 * The maintainer's requirement: a card with a chosen background must keep
 * EVERY item on it visible, standout and clearly noticeable when the user
 * does not set explicit colors. That is a WCAG contrast problem, so the
 * auto-foreground follows the WCAG 2.x relative-luminance + contrast-ratio
 * formulas exactly (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance):
 *
 *  - `normalizeHexColor` accepts only strict lowercase `#rrggbb` — the
 *    same form the RPC layer validates — so no CSS-injection string can
 *    ever reach a style property through this module.
 *  - `autoForegroundColor(bg)` picks dark `#17181d` vs light `#f2f3f7`
 *    (the theme's own text tokens) by the HIGHER contrast ratio.
 *  - `resolveCardColors(bg, fg)` is the single entry point the card view
 *    model calls: null/null → null (present condition preserved — the
 *    card keeps every default rule); otherwise `{ bg, fg }` where bg may
 *    be null (text-only tint: the card keeps the theme surface). The
 *    muted/faint/chip variants are derived CSS-side with `color-mix`
 *    against the effective surface, so they stay theme-aware in the
 *    text-only case and need no duplicated JS blending.
 */

/** Accepted input form: strict lowercase `#rrggbb`. */
const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** Dark text token (the light theme's --color-text). */
export const AUTO_FG_DARK = '#17181d';
/** Light text token (the dark theme's --color-text). */
export const AUTO_FG_LIGHT = '#f2f3f7';

/**
 * Validate + return a strict `#rrggbb` color, or null for "not set".
 * Anything else (wrong case, 3-digit form, rgb() notation, injection
 * payloads) returns null — callers treat it as unset rather than trust it.
 */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && HEX_PATTERN.test(value) ? value : null;
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

/** Hex → [r, g, b] with each channel in 0..255. */
function rgb(hex: string): [number, number, number] {
  return [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
}

/** One WCAG sRGB channel: c/12.92 when <= 0.04045 else ((c+0.055)/1.055)^2.4. */
function linearChannel(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The auto foreground for a background: the dark/light token with the
 * HIGHER contrast ratio (ties → light). Mid-tone backgrounds where both
 * candidates sit below 4.5:1 still get the better of the two; the card
 * border and chip tints keep the content readable there (documented in
 * KNOWN_LIMITATIONS.md).
 */
export function autoForegroundColor(background: string): string {
  const dark = contrastRatio(background, AUTO_FG_DARK);
  const light = contrastRatio(background, AUTO_FG_LIGHT);
  return light >= dark ? AUTO_FG_LIGHT : AUTO_FG_DARK;
}

/** The resolved color pair a tinted card renders with. */
export interface ResolvedCardColors {
  /** Card background — null = keep the theme surface (text-only tint). */
  readonly bg: string | null;
  /** Main text color: the user's choice, or auto-picked by WCAG contrast. */
  readonly fg: string;
}

/**
 * Resolve a card's colors from the stored appearance (T-107):
 *  - bg null and fg null → null: the card keeps the DEFAULT styling
 *    (present condition preserved — not a single existing rule changes).
 *  - bg set, fg null → fg auto-picked by WCAG contrast (the maintainer's
 *    "if the user does not setup those color" requirement).
 *  - fg set, bg null → the text-only tint: fg applies over the theme
 *    surface (an honest, predictable combination).
 */
export function resolveCardColors(
  background: string | null | undefined,
  foreground: string | null | undefined,
): ResolvedCardColors | null {
  const bg = normalizeHexColor(background);
  const fg = normalizeHexColor(foreground);
  if (bg === null && fg === null) return null;
  const effectiveFg = fg ?? (bg !== null ? autoForegroundColor(bg) : AUTO_FG_DARK);
  return { bg, fg: effectiveFg };
}
