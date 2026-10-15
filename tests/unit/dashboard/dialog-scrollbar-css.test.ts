import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-105 regression guard (user report 2026-10-15, screenshot: "settings
 * popup still has double scrollbar").
 *
 * Root cause: Chromium's UA stylesheet gives every dialog:modal
 * `overflow-y: auto` + `max-height: calc(100% - 6px - 2rem)`, and the
 * dialog's scrollHeight is inflated far past its visible children by the
 * settings panel's layout extent leaking through the capped content box
 * (measured 2532px against ~700px of children; hiding the "Permission
 * mode" row collapses it 2532 → 637). The Settings dialog therefore
 * rendered its OWN scrollbar beside the inner `.settings__content` one —
 * the screenshot's two side-by-side bars — and scrolling the outer bar
 * swept the pinned heading and Save/Reset/Close actions away over phantom
 * empty space. The Diagnostics dialog (`.diagnostics__content`, identical
 * inner-scorer pattern) and the diagnostics export review
 * (`.diagnostics__review` at `max-height: 50vh`) carry the same landmine.
 *
 * Fix (src/dashboard/styles.css): the affected dialogs become flex-column
 * sheets with `overflow: hidden` — the dialog element itself NEVER
 * scrolls — and their single scroll body (`flex: 1 1 auto;
 * min-height: 0`) fills the remaining track (dropping the
 * `min(60vh, 34rem)`/`50vh` caps, which also grows the visible settings
 * area). A `dialog:not([open]) { display: none }` guard restores the UA
 * closed state the author `display: flex` would otherwise defeat. This
 * test pins every rule so a rename or a reorder cannot silently
 * reintroduce the double scrollbar. The real-browser counterpart (own
 * scrollbar widths, pinned heading/actions, closed-dialog hiding, at the
 * user's viewport and a short viewport) lives in
 * tests/e2e/user-report-regressions.spec.ts.
 */

const root = join(__dirname, '..', '..', '..');
const css = readFileSync(join(root, 'src', 'dashboard', 'styles.css'), 'utf8');

describe('dialog single-scrollbar CSS guard (T-105)', () => {
  it('restores the UA closed state the flex-sheet dialogs would defeat', () => {
    // .dialog--settings/.dialog--diagnostics/.dialog--review set author
    // `display: flex`, which outranks the UA's dialog:not([open])
    // { display: none } regardless of specificity — without this guard a
    // closed dialog stays visible on the page.
    expect(css).toMatch(/^dialog:not\(\[open\]\)\s*\{\s*display:\s*none;\s*\}/m);
  });

  it('makes the settings dialog a non-scrolling flex-column sheet', () => {
    expect(css).toMatch(
      /^\.dialog--settings\s*\{\s*max-width:\s*46rem;\s*display:\s*flex;\s*flex-direction:\s*column;\s*overflow:\s*hidden;\s*\}/m,
    );
  });

  it('makes the settings content box the single flex-sized scroll body', () => {
    expect(css).toMatch(
      /^\.settings__content\s*\{\s*flex:\s*1 1 auto;\s*min-height:\s*0;\s*overflow-y:\s*auto;/m,
    );
  });

  it('makes the diagnostics dialog a non-scrolling flex-column sheet', () => {
    expect(css).toMatch(
      /^\.dialog--diagnostics\s*\{\s*max-width:\s*46rem;\s*display:\s*flex;\s*flex-direction:\s*column;\s*overflow:\s*hidden;\s*\}/m,
    );
  });

  it('makes the diagnostics content box the single flex-sized scroll body', () => {
    expect(css).toMatch(
      /^\.diagnostics__content\s*\{\s*flex:\s*1 1 auto;\s*min-height:\s*0;\s*overflow-y:\s*auto;/m,
    );
  });

  it('makes the export review dialog a non-scrolling flex-column sheet', () => {
    expect(css).toMatch(
      /^\.dialog--review\s*\{\s*max-width:\s*52rem;\s*display:\s*flex;\s*flex-direction:\s*column;\s*overflow:\s*hidden;\s*\}/m,
    );
  });

  it('makes the review pre the single flex-sized scroll body', () => {
    expect(css).toMatch(
      /^\.diagnostics__review\s*\{\s*flex:\s*1 1 auto;\s*min-height:\s*0;\s*overflow:\s*auto;/m,
    );
  });

  it('drops the viewport-height caps that fought the dialog UA cap', () => {
    // The old caps made BOTH the dialog and the content box scroll
    // containers over the same content — the double-scrollbar setup. The
    // flex track inside the UA-capped dialog now sizes each scroll body.
    expect(css).not.toMatch(/max-height:\s*min\(60vh,\s*34rem\)/);
    expect(css).not.toMatch(/\.diagnostics__review\s*\{[^}]*max-height:\s*50vh/);
  });
});
