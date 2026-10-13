import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-060 regression guard (user report, 2026-10-13): the active smart-list
 * button ("All notes") was invisible in the sidebar. The dark-theme
 * active-nav override listed [data-theme='system'] selectors OUTSIDE any
 * media query, so the dark navy #23273f pill painted behind the
 * LIGHT-theme text tokens whenever the theme preference was 'system'
 * (the default) on a light OS — near-black text on near-black navy,
 * contrast ≈ 1.2:1. The fix keeps the unconditional dark override keyed
 * to the EXPLICIT dark theme only; system-following is handled by the
 * existing @media (prefers-color-scheme: dark) block. The real-browser
 * counterpart (computed styles + WCAG contrast under system/light)
 * lives in tests/e2e/user-report-regressions.spec.ts.
 */

const root = join(__dirname, '..', '..', '..');
const rawCss = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');
/* Comments are documentation, not selectors — strip them so an
   explanatory comment can never trip the selector assertions below. */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

describe('smart-list active button theme contrast (T-060)', () => {
  it('bases the active pill on tokens so light theme gets a light pill', () => {
    const baseIndex = css.indexOf('.smart-nav__button--active');
    expect(baseIndex).toBeGreaterThan(0);
    const baseRule = css.slice(baseIndex, css.indexOf('}', baseIndex));
    expect(baseRule).toContain('var(--color-accent-soft)');
    expect(baseRule).toContain('var(--color-text)');
  });

  it('never keys the dark pill off the system theme outside a media query', () => {
    // The bug: [data-theme='system'] joined the unconditional dark rule,
    // so a light OS under the system preference got the #23273f pill
    // behind light-theme text tokens. The zone between the base rule and
    // the OS-dark media query must contain the dark override — but with
    // explicit-dark selectors ONLY.
    const baseIndex = css.indexOf('.smart-nav__button--active');
    const mediaIndex = css.indexOf('@media (prefers-color-scheme: dark)', baseIndex);
    expect(mediaIndex).toBeGreaterThan(baseIndex);

    const unconditionalZone = css.slice(baseIndex, mediaIndex);
    expect(unconditionalZone).toContain('#23273f');
    expect(unconditionalZone).toContain("[data-theme='dark']");
    expect(
      unconditionalZone,
      'the dark active-nav pill must not apply to system theme outside prefers-color-scheme: dark',
    ).not.toContain("[data-theme='system']");
  });

  it('keeps system-following inside the OS-dark media query', () => {
    // The system preference must still get the dark pill — but ONLY when
    // the OS itself is dark.
    const baseIndex = css.indexOf('.smart-nav__button--active');
    const mediaIndex = css.indexOf('@media (prefers-color-scheme: dark)', baseIndex);
    const mediaZone = css.slice(mediaIndex, mediaIndex + 400);
    expect(mediaZone).toContain("[data-theme='system'] .smart-nav__button--active");
    expect(mediaZone).toContain('#23273f');
  });
});
