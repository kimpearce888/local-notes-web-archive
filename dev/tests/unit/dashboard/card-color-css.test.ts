import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-107 CSS regression guard: card colors with auto-contrast + fully
 * separated metadata blocks (maintainer request 2026-10-15).
 *
 * The tinted-card contract (src/dashboard/styles.css):
 *  - `.card[data-tinted='true']` re-bases the card on the inline
 *    `--card-bg`/`--card-fg` custom properties set by renderCard, with
 *    `--card-surface: var(--card-bg, var(--color-surface))` so the
 *    text-only tint keeps the theme surface.
 *  - Every inner item (subtitle, preview, meta rows, badges, chips)
 *    re-derives from the fg/surface pair through color-mix — visible,
 *    standout, clearly noticeable on ANY background (the maintainer's
 *    requirement), while default cards keep every pre-existing rule
 *    unchanged (present condition preserved).
 *  - The overdue reminder chip INVERTS on tinted cards (solid fg
 *    background, surface text) for maximum standout.
 *  - The meta block is a per-fact row list (`.card__meta-rows` /
 *    `.card__meta-row`) — Created and Modified are separate blocks,
 *    never one inline line.
 *  - The editor's Card color pop-out panel (`.card-color-panel*`) ships
 *    the palette UI with the T-085 closability pattern.
 *
 * The real-browser counterpart (computed styles, in-page WCAG contrast,
 * tinted vs default cards, separated blocks) lives in
 * tests/e2e/user-report-regressions.spec.ts.
 */

const root = join(__dirname, '..', '..', '..', '..');
const css = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');

describe('tinted-card CSS guard (T-107)', () => {
  it('defines the effective surface with the theme fallback for text-only tints', () => {
    expect(css).toMatch(
      /\.card\[data-tinted='true'\]\s*\{[^}]*--card-surface:\s*var\(--card-bg,\s*var\(--color-surface\)\);/,
    );
    expect(css).toMatch(/\.card\[data-tinted='true'\]\s*\{[^}]*background:\s*var\(--card-surface\);/);
    expect(css).toMatch(/\.card\[data-tinted='true'\]\s*\{[^}]*color:\s*var\(--card-fg\);/);
  });

  it('derives the border from the fg so a colored card stays delineated', () => {
    expect(css).toMatch(
      /\.card\[data-tinted='true'\]\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--card-fg\) 38%,\s*var\(--card-surface\)\);/,
    );
  });

  it('re-derives subtitle, preview and meta rows from the fg/surface pair', () => {
    expect(css).toMatch(
      /\.card\[data-tinted='true'\] \.card__subtitle\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--card-fg\) 70%,\s*var\(--card-surface\)\);/,
    );
    expect(css).toMatch(/\.card\[data-tinted='true'\] \.card__preview\s*\{[^}]*color:\s*var\(--card-fg\);/);
    expect(css).toMatch(
      /\.card\[data-tinted='true'\] \.card__meta-row\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--card-fg\) 55%,\s*var\(--card-surface\)\);/,
    );
  });

  it('tints every chip kind and INVERTS the overdue reminder for maximum standout', () => {
    expect(css).toMatch(
      /\.card\[data-tinted='true'\] \.chip--tag,\s*\n\.card\[data-tinted='true'\] \.chip--category,\s*\n\.card\[data-tinted='true'\] \.chip--indicator\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--card-fg\) 16%,\s*var\(--card-surface\)\);/,
    );
    expect(css).toMatch(
      /\.card\[data-tinted='true'\] \.chip--reminder-overdue\s*\{[^}]*background:\s*var\(--card-fg\);[^}]*color:\s*var\(--card-surface\);/,
    );
  });

  it('keeps the selection ring visible on tinted cards', () => {
    expect(css).toMatch(
      /\.card\[data-tinted='true'\]\.card--selected\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--card-fg\) 80%,\s*var\(--card-surface\)\);/,
    );
  });

  it('never applies tint styling to DEFAULT cards (present condition preserved)', () => {
    // The base .card rule still reads the theme surface (no unconditional
    // --card-* dependency), and the data-tinted selector is the ONLY
    // place the card background switches.
    expect(css).toMatch(/^\.card\s*\{[^}]*background:\s*var\(--color-surface\);/m);
    const tintedCardBackgrounds = css.match(/^\.card\s*\{[^}]*--card-/gm) ?? [];
    expect(tintedCardBackgrounds).toHaveLength(0);
  });
});

describe('separated metadata blocks CSS guard (T-107)', () => {
  it('renders the meta rows as a one-per-line column list', () => {
    expect(css).toMatch(
      /\.card__meta-rows\s*\{[^}]*display:\s*flex;\s*flex-direction:\s*column;/s,
    );
    expect(css).toMatch(/\.card__meta-row\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/);
  });

  it('retires the old single inline meta line rule', () => {
    // .card__meta as a standalone selector must not come back (the
    // renderer emits .card__meta-rows/.card__meta-row now).
    expect(css).not.toMatch(/^\.card__meta\s*\{/m);
  });
});

describe('card color panel CSS guard (T-107)', () => {
  it('ships the panel with the shared disclosure-panel visual language', () => {
    expect(css).toMatch(/^\.card-color-panel\s*\{[^}]*border:\s*1px solid var\(--color-border\);/m);
    expect(css).toMatch(/^\.panel-header__close\s*\{/m);
  });

  it('marks the selected swatch with the accent ring', () => {
    expect(css).toMatch(
      /\.card-color-panel__swatch\[aria-pressed='true'\]\s*\{[^}]*box-shadow:\s*0 0 0 2px var\(--color-accent\);/,
    );
  });

  it('palette swatches are pill-shaped fixed-size targets', () => {
    expect(css).toMatch(/\.card-color-panel__swatch\s*\{[^}]*border-radius:\s*var\(--radius-pill\);/s);
  });
});

describe('card color renderer contract guard (T-107)', () => {
  const renderer = readFileSync(join(root, 'src', 'dashboard', 'views', 'cards.ts'), 'utf8');
  const colorsModule = readFileSync(join(root, 'src', 'dashboard', 'views', 'card-colors.ts'), 'utf8');
  const panelModule = readFileSync(join(root, 'src', 'dashboard', 'editor', 'card-color-panel.ts'), 'utf8');

  it('renderCard sets data-tinted and the custom properties through setProperty only', () => {
    expect(renderer).toContain("card.dataset['tinted'] = 'true'");
    expect(renderer).toContain("card.style.setProperty('--card-bg'");
    expect(renderer).toContain("card.style.setProperty('--card-fg'");
    // Never string-build the style through cssText assignment with color
    // values (a comment reference is fine — an assignment is not).
    expect(renderer).not.toMatch(/style\.cssText\s*=/);
  });

  it('the auto foreground follows the WCAG contrast formulas', () => {
    expect(colorsModule).toContain('function linearChannel');
    expect(colorsModule).toMatch(/0\.2126\s*\*\s*linearChannel\(r\)/);
    expect(colorsModule).toMatch(/0\.7152\s*\*\s*linearChannel\(g\)/);
    expect(colorsModule).toMatch(/0\.0722\s*\*\s*linearChannel\(b\)/);
    expect(colorsModule).toContain('export function contrastRatio');
    expect(colorsModule).toContain('export function autoForegroundColor');
    // The tokens are the theme's own text colors.
    expect(colorsModule).toContain("export const AUTO_FG_DARK = '#17181d'");
    expect(colorsModule).toContain("export const AUTO_FG_LIGHT = '#f2f3f7'");
  });

  it('the panel palette carries exactly the curated AA-clean swatches', () => {
    const expected = [
      '#f2c94c', '#e8a13c', '#dd5a55', '#e28fa8', '#8b8ff7', '#4c4fd8',
      '#4fa3d1', '#0e7490', '#3fa66a', '#1c6b3c', '#a277bd', '#6b5b4a',
    ];
    for (const hex of expected) {
      expect(panelModule, `palette must contain ${hex}`).toContain(`hex: '${hex}'`);
    }
    expect(panelModule).toMatch(/CARD_COLOR_PALETTE: readonly \{ name: string; hex: string \}\[\]/);
  });
});
