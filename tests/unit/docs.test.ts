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

describe('release verification report (T-043, PRD §13)', () => {
  it('exists with a PASS verdict and every required section', () => {
    const report = readDoc('docs/RELEASE_VERIFICATION.md');
    expect(report).toContain('**PASS**');
    for (const section of [
      '## Verification environment',
      '## Gate matrix',
      '### Dashboard shell',
      '### Search over 10,000 notes',
      '## Accessibility keyboard pass',
      '## Release artifacts',
      '## Verification commands',
    ]) {
      expect(report, `section ${section} missing`).toContain(section);
    }
  });

  it('records measured numbers against the PRD §11 budgets', () => {
    const report = readDoc('docs/RELEASE_VERIFICATION.md');
    // Both budgets are stated with their targets and PASS verdicts.
    expect(report).toContain('< 1,500 ms');
    expect(report).toMatch(/p95.*< 500 ms → PASS|PASS.*p95 < 500 ms/);
    // The release artifact is identified with name and checksum.
    expect(report).toContain('local-notes-web-archive-1.0.7.zip');
    expect(report).toMatch(/[0-9a-f]{64}/);
    // Environment honesty is documented, not concealed.
    expect(report).toContain('Environment honesty');
  });
});

describe('repository audit report (T-049)', () => {
  it('exists with a PASS verdict and every required section', () => {
    const report = readDoc('docs/REPOSITORY_AUDIT.md');
    expect(report).toContain('**PASS**');
    for (const section of [
      '## Executive summary',
      '## Repository structure and statistics',
      '## Commit history',
      '## Code metrics',
      '## Secrets scan',
      '## Dependency audit',
      '## Manifest, permissions and CSP verification (re-run)',
      '## Documentation completeness',
      '## Release artifact integrity',
      '## Test verification (this audit session)',
      '## Verification commands',
    ]) {
      expect(report, `section ${section} missing`).toContain(section);
    }
  });

  it('records the honest audit outcome and how every number was produced', () => {
    const report = readDoc('docs/REPOSITORY_AUDIT.md');
    // Secrets scan of worktree AND full git history: zero findings.
    expect(report).toContain('**Result: 0 findings.**');
    expect(report).toContain('full git\nhistory');
    // Dependency audit: zero vulnerabilities in both graphs.
    expect(report).toContain('(production graph): **0 vulnerabilities**');
    expect(report).toContain('(full graph incl. dev tooling): **0 vulnerabilities**');
    // Release integrity: artifact identified with name and checksum, and the
    // GitHub Release API cross-check agrees with the local artifact.
    expect(report).toContain('local-notes-web-archive-1.0.7.zip');
    expect(report).toMatch(/[0-9a-f]{64}/);
    expect(report).toContain('digest');
    // Reproducibility: the generating script and honest environment note.
    expect(report).toContain('scripts/audit.mjs');
    expect(report).toContain('Environment honesty');
  });
});

describe('screenshot gallery (T-050)', () => {
  it('ships twelve app screenshots and the social banner, referenced with alt text', () => {
    const readme = readDoc('README.md');
    const PNG_MAGIC = '89504e47';
    for (const name of [
      'dashboard-light.png',
      'editor.png',
      'search.png',
      'dashboard-dark.png',
      'diagnostics.png',
      'command-palette.png',
      'reminders.png',
      'ai-panel.png',
      'settings.png',
      'archives.png',
      'responsive-rail.png',
      'responsive-narrow.png',
      'social-banner.png',
    ]) {
      const path = join(root, 'docs', 'screenshots', name);
      expect(existsSync(path), `docs/screenshots/${name} is missing`).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.length, `${name} is stub-sized`).toBeGreaterThan(50_000);
      expect(bytes.subarray(0, 4).toString('hex'), `${name} is not a PNG`).toBe(PNG_MAGIC);
      expect(readme, `README must reference ${name}`).toContain(`](./docs/screenshots/${name})`);
    }
    // Every gallery reference carries descriptive alt text.
    const galleryRefs = [...readme.matchAll(/!\[([^\]]{20,})\]\(\.\/docs\/screenshots\//g)];
    expect(galleryRefs.length).toBeGreaterThanOrEqual(6);
  });
});

describe('marketing README (T-051)', () => {
  it('leads with the value proposition, badges and the social banner', () => {
    const readme = readDoc('README.md');
    expect(readme).toContain('no cloud, no accounts, no telemetry, no remote code');
    expect(readme).toContain('./docs/screenshots/social-banner.png');
    expect(readme).toMatch(/img\.shields\.io/);
    // SEO keywords in the leading copy.
    expect(readme).toContain('Chrome note-taking extension');
    expect(readme).toContain('MHTML web page archiving');
  });

  it('documents the search syntax truthfully (FR-SEARCH-04 operators)', () => {
    const readme = readDoc('README.md');
    for (const op of [
      '"exact phrase"',
      'tag:work',
      'category:projects',
      'is:pinned',
      'has:snapshot',
      'before:2026-01-01',
      'after:2026-06-01',
      'in:title',
    ]) {
      expect(readme, `search syntax operator ${op} missing`).toContain(op);
    }
  });

  it('carries the FAQ and honest privacy/limits copy', () => {
    const readme = readDoc('README.md');
    expect(readme).toContain('## FAQ');
    expect(readme).toContain('Where is my data?');
    expect(readme).toContain('Will reminders fire while my computer is off?');
    expect(readme).toContain('loopback');
    expect(readme).toContain('KNOWN_LIMITATIONS.md');
  });

  it('states the measured quality numbers from the audit', () => {
    const readme = readDoc('README.md');
    expect(readme).toContain('913/913');
    expect(readme).toContain('77/77');
    expect(readme).toContain('0 vulnerabilities');
    expect(readme).toContain('docs/REPOSITORY_AUDIT.md');
    expect(readme).toContain('docs/RELEASE_VERIFICATION.md');
  });
});
