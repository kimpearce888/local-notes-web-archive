import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-054 regression guard (user report, 2026-10-13): the "Add reminder"
 * dialog rendered every form control ~352px (22rem) tall and overflowed
 * the viewport so the Time zone field was cut off. Root cause:
 * `.search-input { flex: 1 1 22rem }` was authored for the HORIZONTAL
 * dashboard search form — inside `.dialog__field`, a
 * flex-direction: column container, the 22rem flex-basis (and the grow)
 * applied to the field HEIGHT. The fix resets flex sizing for dialog
 * fields. The real-browser counterpart (measured field heights, zone
 * visibility) lives in tests/e2e/user-report-regressions.spec.ts.
 */

const root = join(__dirname, '..', '..', '..', '..');
const css = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');

describe('dialog field sizing (T-054)', () => {
  it('resets the search-form flex sizing inside dialog fields', () => {
    // The scoped rule must neutralise the 22rem flex-basis for every
    // .search-input that lives inside a .dialog__field label.
    expect(css).toMatch(
      /\.dialog__field\s*>\s*\.search-input\s*\{\s*flex:\s*0 0 auto;?\s*width:\s*100%;?\s*\}/,
    );
  });

  it('declares dialog fields as column flex containers (the bug precondition)', () => {
    // If .dialog__field stops being a column flex container this test (and
    // the bug narrative) must be revisited — the reset is only needed
    // because flex-basis applies to height in a column container.
    const rule = css.slice(
      css.indexOf('.dialog__field {'),
      css.indexOf('}', css.indexOf('.dialog__field {')),
    );
    expect(rule).toMatch(/flex-direction:\s*column/);
  });

  it('keeps the horizontal search-form sizing intact outside dialogs', () => {
    // The dashboard search bar itself must keep its original sizing: the
    // fix is scoped to dialog fields, not a global search-input change.
    const rule = css.slice(
      css.indexOf('.search-input {'),
      css.indexOf('}', css.indexOf('.search-input {')),
    );
    expect(rule).toMatch(/flex:\s*1 1 22rem/);
  });

  it('wins on specificity without relying on source order', () => {
    // Two class selectors (0,2,0) beat the single-class .search-input
    // (0,1,0) regardless of rule order — but assert the reset also comes
    // after the base rule so plain cascade reading stays intuitive.
    const baseIndex = css.indexOf('.search-input {');
    const resetIndex = css.indexOf('.dialog__field > .search-input {');
    expect(baseIndex).toBeGreaterThan(0);
    expect(resetIndex).toBeGreaterThan(baseIndex);
  });
});
