import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-052 regression guard: components toggle visibility with the `hidden`
 * attribute while their CSS classes carry author `display` rules
 * (`.editor-find` flex, `.settings__check` inline-flex). Author display
 * rules override the UA stylesheet's [hidden] { display: none }, so those
 * two elements leaked on screen — the editor find bar was permanently
 * visible without ever pressing Ctrl+F (caught by vision QA over the
 * T-050 screenshots). `.editor-image__controls` already carried a specific
 * per-class [hidden] rule; the new global guard generalises that pattern
 * to every current and future element.
 *
 * The fix is the global [hidden] { display: none !important } guard at
 * the END of src/dashboard/styles.css. This test pins that the guard
 * exists and that it comes after every display-carrying rule it must
 * defeat. The real-browser counterpart (computed style of the find bar
 * before/after Ctrl+F) lives in tests/e2e/extension.spec.ts.
 */

const root = join(__dirname, '..', '..', '..');
const css = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');

/** Classes toggled through the hidden attribute that carry display rules. */
const HIDDEN_WITH_DISPLAY = ['.editor-find', '.editor-image__controls', '.settings__check'] as const;

describe('hidden-attribute CSS guard (T-052)', () => {
  it('declares the global guard so the hidden attribute always wins', () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it('places the guard AFTER every display rule it must defeat', () => {
    // The GLOBAL guard is the [hidden] rule carrying !important — earlier
    // [hidden] occurrences (the pre-existing per-class
    // .editor-image__controls rule) are scoped overrides, not the guard.
    const guardIndex = css.indexOf('[hidden] {\n  display: none !important');
    expect(guardIndex).toBeGreaterThan(0);
    for (const className of HIDDEN_WITH_DISPLAY) {
      const ruleIndex = css.indexOf(`${className} {`);
      expect(ruleIndex, `rule for ${className} not found`).toBeGreaterThan(0);
      // Same-specificity author rules apply in document order — the guard
      // must not appear before any rule it needs to beat.
      expect(guardIndex, `${className} rule must precede the guard`).toBeGreaterThan(ruleIndex);
    }
  });

  it('keeps every hidden-toggled class paired with a display rule (rename detector)', () => {
    // If one of these classes is renamed or its display property is removed,
    // the pairing documented above changes and this file must be updated.
    for (const className of HIDDEN_WITH_DISPLAY) {
      const rule = css.slice(css.indexOf(`${className} {`), css.indexOf('}', css.indexOf(`${className} {`)));
      expect(rule, `${className} rule body not found`).toMatch(/display:\s*(flex|inline-flex|grid|block|inline-block)/);
    }
  });
});
