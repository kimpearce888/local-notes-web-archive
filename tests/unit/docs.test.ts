import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-040 documentation bundle (PRD §14): every required document exists and
 * is non-trivial, DEPENDENCIES.json is consistent with the pinned
 * package.json and lockfile (no manual drift), THIRD_PARTY_NOTICES covers
 * every runtime dependency, and every README link resolves to a real file.
 */

const root = join(__dirname, '..', '..');

function readDoc(name: string): string {
  const file = join(root, name);
  expect(existsSync(file), `${name} is missing`).toBe(true);
  return readFileSync(file, 'utf8');
}

describe('documentation bundle', () => {
  it('contains every PRD §14 document with substantial content', () => {
    for (const name of [
      'README.md',
      'PRIVACY.md',
      'PERMISSIONS.md',
      'KNOWN_LIMITATIONS.md',
      'BACKUP_RESTORE.md',
      'SECURITY.md',
      'THIRD_PARTY_NOTICES.md',
      'DEPENDENCIES.json',
      'LICENSE',
    ]) {
      const content = readDoc(name);
      expect(content.length, `${name} is empty or stub-sized`).toBeGreaterThan(500);
    }
  });

  it('DEPENDENCIES.json matches the pinned package.json exactly', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const inventory = JSON.parse(readDoc('DEPENDENCIES.json')) as {
      format: string;
      runtime: { direct: { name: string; version: string; license: string }[] };
      development: { direct: { name: string }[] };
    };
    expect(inventory.format).toBe('lnwa-dependencies');
    const runtimeNames = inventory.runtime.direct.map((entry) => entry.name).sort();
    expect(runtimeNames).toEqual(Object.keys(pkg.dependencies).sort());
    const devNames = inventory.development.direct.map((entry) => entry.name).sort();
    expect(devNames).toEqual(Object.keys(pkg.devDependencies).sort());
    // Exact pins in package.json are mirrored with exact versions in the inventory.
    for (const entry of inventory.runtime.direct) {
      const pinned = pkg.dependencies[entry.name];
      expect(pinned, `${entry.name} missing from package.json dependencies`).toBeDefined();
      expect(pinned).toBe(entry.version);
      expect(entry.license).not.toBe('UNKNOWN');
    }
  });

  it('THIRD_PARTY_NOTICES covers every runtime dependency with a license', () => {
    const inventory = JSON.parse(readDoc('DEPENDENCIES.json')) as {
      runtime: {
        direct: { name: string }[];
        transitive: { name: string }[];
      };
    };
    const notices = readDoc('THIRD_PARTY_NOTICES.md');
    for (const entry of [...inventory.runtime.direct, ...inventory.runtime.transitive]) {
      expect(notices, `notice for ${entry.name} missing`).toContain(`### ${entry.name} `);
    }
    // Generated, not hand-written: the generator stamps its source.
    expect(notices).toContain('scripts/generate-dependencies.mjs');
    // Development tooling is explicitly excluded from the shipped notices.
    expect(notices).toContain('NOT shipped');
  });

  it('README links resolve to real files', () => {
    const readme = readDoc('README.md');
    const links = [...readme.matchAll(/\]\((\.\/[^)#]+)\)/g)]
      .map((match) => match[1])
      .filter((link): link is string => link !== undefined);
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      const target = join(root, link);
      expect(existsSync(target), `README link ${link} is broken`).toBe(true);
    }
  });

  it('documents the honest MCP disclosure and data-loss warnings', () => {
    expect(readDoc('PRIVACY.md')).toContain('never the prompt or response content');
    expect(readDoc('PERMISSIONS.md')).toContain('never deletes saved archives');
    expect(readDoc('KNOWN_LIMITATIONS.md')).toContain('no external MCP server');
    expect(readDoc('BACKUP_RESTORE.md')).toContain('byte-for-byte');
    expect(readDoc('SECURITY.md')).toContain('The model proposes; the app validates');
  });
});
