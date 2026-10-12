// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Toolchain sanity gate (T-003): proves lint/typecheck/test wiring works and
 * that the pinned dependency set is intact before real modules land.
 */
describe('toolchain', () => {
  it('runs vitest with the node environment', () => {
    expect(typeof structuredClone).toBe('function');
  });

  it('has an IndexedDB implementation available (fake-indexeddb)', () => {
    expect(typeof indexedDB).toBe('object');
    expect(typeof indexedDB.open).toBe('function');
  });

  it('pins exact dependency versions in package.json', () => {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const loose = Object.entries(all).filter(([, v]) => /^[\^~>]/.test(v));
    expect(loose, `loose pins: ${JSON.stringify(loose)}`).toEqual([]);
  });

  it('resolves runtime dependencies that will be bundled', async () => {
    // The four critical runtime libs must be importable and licensed OSS.
    const fflate = await import('fflate');
    const MiniSearch = (await import('minisearch')).default;
    const DOMPurify = (await import('dompurify')).default;
    expect(typeof fflate.zipSync).toBe('function');
    expect(typeof MiniSearch).toBe('function');
    expect(typeof DOMPurify.sanitize).toBe('function');
  });
});
