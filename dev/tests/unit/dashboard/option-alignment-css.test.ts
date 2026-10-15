import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-103 regression guard (user report 2026-10-15, two screenshots): the
 * sidebar and the settings/diagnostics panel actions must read as ONE
 * left-aligned column.
 *
 * Root cause: `.btn { justify-content: center }` is authored later in
 * styles.css than `.sidebar__footer-button { justify-content: flex-start }`
 * with EQUAL (single-class) specificity, so it silently won the cascade and
 * centered the icon+label group of every full-width sidebar action
 * ("Import note…", "Settings", "Diagnostics" — the user's screenshot — plus
 * "New Note" and "Save a web page…") while the smart lists above read
 * left-aligned. In the Settings dialog the same `.btn` center stretched
 * "Test connection" and "Show the introduction again" to the full panel
 * width with centered labels (direct children of the flex-column
 * `.settings__panel`); Diagnostics' "Rebuild search index"/"Test connection"
 * shared the pattern. The rail-mode (≤52rem) rules additionally never listed
 * the T-089 `.sidebar__save-page` button, so its label stayed visible and
 * clipped inside the 59px rail button.
 *
 * Fix (src/dashboard/styles.css): parent-qualified sidebar selectors —
 * `.app-sidebar .sidebar__new-note/.save-page/.footer-button` (0,2,0) beat
 * `.btn` (0,1,0) regardless of source order — and shrink-to-fit
 * `.settings__panel > .btn` / `.diagnostics__panel > .btn` actions. The
 * responsive rail/strip blocks were parent-qualified to match (same
 * specificity, later source order) so they keep winning, and save-page was
 * added to both. This test pins every selector so a rename or a reorder
 * cannot silently reintroduce the centered look. The real-browser
 * counterpart (computed styles + pixel gaps at wide/rail/strip widths)
 * lives in tests/e2e/user-report-regressions.spec.ts.
 */

const root = join(__dirname, '..', '..', '..', '..');
const css = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');

/** Slice from one @media marker to the next (or EOF) for scoped assertions. */
function mediaBlock(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `media block ${marker} not found`).toBeGreaterThan(-1);
  const next = css.indexOf('@media', start + marker.length);
  return css.slice(start, next === -1 ? undefined : next);
}

describe('option alignment CSS guard (T-103)', () => {
  it('keeps the base .btn centered content the sidebar rules must defeat', () => {
    // The base rule is still there (dialogs, empty-state CTAs and rail icons
    // rely on it) — the sidebar fix must win by specificity, not by deleting
    // the base behavior.
    expect(css).toMatch(/^\.btn\s*\{[^}]*justify-content:\s*center/m);
  });

  it('parent-qualifies the sidebar action rules so flex-start always wins', () => {
    // (0,2,0) beats `.btn`'s (0,1,0) regardless of source order. All three
    // action families must be present — a rename breaks the pairing and
    // this test must be updated.
    expect(css).toMatch(
      /\.app-sidebar \.sidebar__new-note,\s*\.app-sidebar \.sidebar__save-page,\s*\.app-sidebar \.sidebar__footer-button\s*\{\s*justify-content:\s*flex-start;\s*\}/,
    );
  });

  it('keeps the original single-class flex-start intent for the footer buttons', () => {
    // The pre-fix rule is still authored (it documents the original intent);
    // the parent-qualified rule above is the one that actually wins.
    expect(css).toMatch(/^\.sidebar__footer-button\s*\{[^}]*justify-content:\s*flex-start/m);
  });

  it('rail mode (≤52rem) hides every sidebar label, including save-page, and centers icons', () => {
    const rail = mediaBlock('@media (max-width: 52rem)');
    // T-089 omission: save-page must be in the visually-hidden label list
    // alongside new-note and the footer buttons.
    expect(rail).toMatch(
      /\.sidebar__new-note span:not\(\.icon-host\),\s*\.sidebar__save-page span:not\(\.icon-host\),\s*\.smart-nav__label,\s*\.sidebar__footer-button span:not\(\.icon-host\)/,
    );
    // Parent-qualified so the centering outranks the wide-width flex-start
    // fix (same specificity, later source order) — and save-page included.
    expect(rail).toMatch(
      /\.app-sidebar \.sidebar__new-note,\s*\.app-sidebar \.sidebar__save-page,\s*\.app-sidebar \.smart-nav__button,\s*\.app-sidebar \.sidebar__footer-button\s*\{\s*justify-content:\s*center;/,
    );
  });

  it('strip mode (≤40rem) restores every label, including save-page, and left-aligns', () => {
    const strip = mediaBlock('@media (max-width: 40rem)');
    expect(strip).toMatch(
      /\.sidebar__new-note span:not\(\.icon-host\),\s*\.sidebar__save-page span:not\(\.icon-host\),\s*\.smart-nav__label,\s*\.sidebar__footer-button span:not\(\.icon-host\)/,
    );
    expect(strip).toMatch(
      /\.app-sidebar \.sidebar__new-note,\s*\.app-sidebar \.sidebar__save-page,\s*\.app-sidebar \.smart-nav__button,\s*\.app-sidebar \.sidebar__footer-button\s*\{\s*justify-content:\s*flex-start;/,
    );
  });

  it('shrink-wraps the settings panel direct actions with left-aligned content', () => {
    // "Test connection" and "Show the introduction again": direct children
    // of the flex-column panel, previously stretched to full width with a
    // centered label.
    expect(css).toMatch(
      /\.settings__panel > \.btn\s*\{\s*align-self:\s*flex-start;\s*justify-content:\s*flex-start;\s*\}/,
    );
  });

  it('shrink-wraps the diagnostics panel direct actions with left-aligned content', () => {
    // "Rebuild search index" and "Test connection" in Diagnostics share the
    // exact pattern of the settings defect — same fix family.
    expect(css).toMatch(
      /\.diagnostics__panel > \.btn\s*\{\s*align-self:\s*flex-start;\s*justify-content:\s*flex-start;\s*\}/,
    );
  });
});
