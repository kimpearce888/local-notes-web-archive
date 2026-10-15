import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

/**
 * T-078 (audit D-09): the `--color-text-faint` token is used for small
 * 12px text (.card__meta timestamps, status bar, hint text). WCAG AA
 * requires 4.5:1 for small text — the pre-fix values (light #8a8d9b =
 * 3.3:1 on white cards, dark #74768a = 3.46-4.01:1 on dark surfaces)
 * failed. This suite locks the token to AA-compliant values on every
 * surface it can appear over, in BOTH themes.
 */

const css = readFileSync(
  join(fileURLToPath(new URL('.', import.meta.url)), '../../../../src/dashboard/styles.css'),
  'utf-8',
);

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(raw.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const r = linear[0] ?? 0;
  const g = linear[1] ?? 0;
  const b = linear[2] ?? 0;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function tokenValue(token: string, zone: string): string {
  const re = new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`);
  const match = zone.match(re);
  if (!match) throw new Error(`token --${token} not found in zone`);
  return match[1] ?? '';
}

/** Light theme zone: from :root to the first dark-theme block. */
const rootZone = css.slice(0, css.indexOf('[data-theme=\'dark\']'));
/** Explicit dark theme block. */
const darkZone = css.slice(
  css.indexOf("[data-theme='dark']"),
  css.indexOf('[data-theme=\'dark\']') + 4000,
);

describe('text-faint WCAG AA contrast (audit D-09)', () => {
  it('light theme token clears 4.5:1 on white and off-white surfaces', () => {
    const faint = tokenValue('color-text-faint', rootZone);
    // The faint text sits on cards (#ffffff), the app background (#f6f6f8)
    // and raised surfaces.
    for (const surface of ['#ffffff', '#f6f6f8', '#ececf1']) {
      const ratio = contrast(faint, surface);
      expect(ratio, `light --color-text-faint ${faint} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark theme token clears 4.5:1 on every dark surface', () => {
    const faint = tokenValue('color-text-faint', darkZone);
    // Dark surfaces: app background #101014, cards/sunken #17181d,
    // #1d1e26, #0e0e12.
    for (const surface of ['#101014', '#17181d', '#1d1e26', '#0e0e12']) {
      const ratio = contrast(faint, surface);
      expect(ratio, `dark --color-text-faint ${faint} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the OS-dark media query override matches the explicit dark token', () => {
    // System-following users must get the same compliant token.
    const mediaIndex = css.indexOf('@media (prefers-color-scheme: dark)');
    const mediaZone = css.slice(mediaIndex, mediaIndex + 4000);
    const darkToken = tokenValue('color-text-faint', darkZone);
    expect(mediaZone).toContain(darkToken);
  });

  it('the pre-fix non-compliant values are gone', () => {
    expect(css).not.toContain('#8a8d9b');
    expect(css).not.toContain('#74768a');
  });
});
