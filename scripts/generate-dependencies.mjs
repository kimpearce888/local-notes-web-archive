import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generates the dependency inventory (PRD §14) from the ACTUAL pinned
 * lockfile and installed packages — no manual drift:
 *
 *   DEPENDENCIES.json      machine-readable: runtime + development,
 *                          direct + transitive, exact versions, SPDX
 *                          license, source URLs.
 *   THIRD_PARTY_NOTICES.md human-readable notices for every RUNTIME
 *                          package (the code actually bundled into
 *                          dist/), with full license texts read from the
 *                          installed packages. Development dependencies
 *                          never ship and are only listed in the JSON.
 *
 * Run via `npm run deps`; the release pipeline re-runs it before packaging.
 */

const root = new URL('..', import.meta.url).pathname;
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* ---------------------------------------------------------------- */
/* Lockfile graph                                                    */
/* ---------------------------------------------------------------- */

/** lock.packages keys: "" (root), "node_modules/a", "node_modules/a/node_modules/b". */
const packages = lock.packages ?? {};

/** Resolve the lock key that `depName` maps to from `fromKey` (npm resolution). */
function resolveKey(fromKey, depName) {
  const prefix = fromKey === '' ? '' : `${fromKey}/`;
  // Nearest-ancestor node_modules lookup, exactly like Node resolution.
  let ancestor = fromKey;
  for (;;) {
    const candidate = ancestor === '' ? `node_modules/${depName}` : `${ancestor}/node_modules/${depName}`;
    if (packages[candidate] !== undefined) return candidate;
    if (ancestor === '') return null;
    const cut = ancestor.lastIndexOf('/node_modules/');
    ancestor = cut === -1 ? '' : ancestor.slice(0, cut);
    void prefix;
  }
}

/** Read the installed package.json for a lock key (metadata source). */
function installedMeta(key) {
  const path = join(root, key);
  const file = join(path, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Full license text for a lock key, when the package ships one. */
function licenseText(key) {
  const dir = join(root, key);
  if (!existsSync(dir)) return null;
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.txt', 'LICENCE'];
  for (const name of candidates) {
    const file = join(dir, name);
    if (existsSync(file)) {
      try {
        const text = readFileSync(file, 'utf8').trim();
        if (text.length > 0 && text.length < 200_000) return text;
      } catch {
        /* unreadable — fall through */
      }
    }
  }
  return null;
}

function entryFor(key) {
  const lockEntry = packages[key];
  const meta = installedMeta(key) ?? {};
  const repository =
    typeof meta.repository === 'string'
      ? meta.repository
      : meta.repository?.url
        ? meta.repository.url.replace(/^git\+/, '')
        : null;
  const author =
    typeof meta.author === 'string'
      ? meta.author
      : meta.author?.name
        ? meta.author.name
        : null;
  return {
    name: meta.name ?? lockEntry.name ?? key.split('/').pop(),
    version: lockEntry.version ?? meta.version ?? 'unknown',
    license: meta.license ?? lockEntry.license ?? 'UNKNOWN',
    sourceUrl: repository ?? meta.homepage ?? lockEntry.resolved ?? null,
    homepage: meta.homepage ?? null,
    copyright: author,
  };
}

/** BFS the dependency closure of `roots` over the lockfile graph. */
function closure(roots) {
  const seen = new Set();
  const queue = [];
  for (const name of roots) {
    const key = resolveKey('', name);
    if (key && !seen.has(key)) {
      seen.add(key);
      queue.push(key);
    }
  }
  while (queue.length > 0) {
    const key = queue.shift();
    const meta = installedMeta(key);
    const deps = { ...(packages[key]?.dependencies ?? {}), ...(meta?.dependencies ?? {}) };
    for (const depName of Object.keys(deps)) {
      const resolved = resolveKey(key, depName);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return seen;
}

const runtimeDirectNames = Object.keys(pkg.dependencies ?? {});
const devDirectNames = Object.keys(pkg.devDependencies ?? {});
const runtimeClosure = closure(runtimeDirectNames);
const devClosure = closure(devDirectNames);
// A package both closures reach counts as runtime (it is bundled).
for (const key of runtimeClosure) devClosure.delete(key);

const runtimeDirect = [...runtimeClosure]
  .filter((key) => runtimeDirectNames.includes(packages[key]?.name ?? key.split('/').pop()) || runtimeDirectNames.includes(key.split('node_modules/').pop()))
  .map(entryFor)
  .sort((a, b) => a.name.localeCompare(b.name));
const runtimeTransitive = [...runtimeClosure]
  .filter((key) => !runtimeDirect.includes(key))
  .filter((key) => {
    const meta = installedMeta(key);
    const name = meta?.name ?? key.split('node_modules/').pop();
    return !runtimeDirectNames.includes(name);
  })
  .map(entryFor)
  .sort((a, b) => a.name.localeCompare(b.name));
const devDirect = [...devClosure]
  .filter((key) => {
    const meta = installedMeta(key);
    const name = meta?.name ?? key.split('node_modules/').pop();
    return devDirectNames.includes(name);
  })
  .map(entryFor)
  .sort((a, b) => a.name.localeCompare(b.name));
const devTransitive = [...devClosure]
  .filter((key) => {
    const meta = installedMeta(key);
    const name = meta?.name ?? key.split('node_modules/').pop();
    return !devDirectNames.includes(name);
  })
  .map(entryFor)
  .sort((a, b) => a.name.localeCompare(b.name));

/* ---------------------------------------------------------------- */
/* DEPENDENCIES.json                                                 */
/* ---------------------------------------------------------------- */

const inventory = {
  format: 'lnwa-dependencies',
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'package-lock.json (exact pinned versions)',
  runtime: {
    bundled: true,
    direct: runtimeDirect,
    transitive: runtimeTransitive,
  },
  development: {
    bundled: false,
    note: 'Build, lint, typecheck and test tooling only — never shipped in dist/.',
    direct: devDirect,
    transitive: devTransitive,
  },
};
writeFileSync(join(root, 'DEPENDENCIES.json'), `${JSON.stringify(inventory, null, 2)}\n`);

/* ---------------------------------------------------------------- */
/* THIRD_PARTY_NOTICES.md                                            */
/* ---------------------------------------------------------------- */

/**
 * Subcomponent notices for packages that EMBED third-party code inside
 * their own bundle (not separate lockfile entries, so the graph walk
 * cannot see them). Kept here so regeneration stays deterministic and
 * drift-free. T-086: heic-to embeds libheif + libde265 compiled to asm.js
 * (both LGPL-3.0) as its decoder core.
 */
const EMBEDDED_SUBCOMPONENTS = {
  'heic-to': [
    '**Embedded subcomponents:** heic-to bundles [libheif](https://github.com/strukturag/libheif) and [libde265](https://github.com/strukturag/libde265), both LGPL-3.0-or-later, compiled to plain asm.js (no dynamic evaluation, no WebAssembly) as its HEIC/HEIF decoder core. The full LGPL-3.0 text is reproduced above from the package license file and is available at https://www.gnu.org/licenses/lgpl-3.0.html and in the component source repositories.',
  ],
};

function notice(entry) {
  const lines = [
    `### ${entry.name} ${entry.version}`,
    '',
    `- License (SPDX): ${entry.license}`,
    `- Source: ${entry.sourceUrl ?? 'see package registry'}`,
    entry.copyright ? `- Copyright: ${entry.copyright}` : null,
    '',
  ].filter((line) => line !== null);
  const text = licenseText(`node_modules/${entry.name}`);
  if (text) {
    lines.push('Full license text as shipped with the package:', '', '```', text, '```', '');
  } else {
    lines.push('The package does not ship a standalone license file; the SPDX identifier above', 'identifies the license. See the source repository for the full text.', '');
  }
  for (const extra of EMBEDDED_SUBCOMPONENTS[entry.name] ?? []) {
    lines.push(extra, '');
  }
  return lines.join('\n');
}

const notices = [
  '# Third-Party Notices',
  '',
  'Runtime dependencies bundled into `dist/` of **Local Notes & Web Archive for Chrome**.',
  `Generated from the pinned \`package-lock.json\` by \`scripts/generate-dependencies.mjs\` at ${inventory.generatedAt} — never edited by hand.`,
  '',
  `First-party code is MIT (see [LICENSE](./LICENSE)). The ${runtimeDirect.length + runtimeTransitive.length} packages below form the runtime dependency closure of \`dist/\` (bundled code plus its declared dependency tree) and are free/open-source software; their licenses permit bundling and are reproduced here from the installed packages.`,
  '',
  'Development-only tooling (TypeScript, Vite, Vitest, ESLint, Playwright and their dependencies) is NOT shipped in the extension — the complete inventory including those lives in [DEPENDENCIES.json](./DEPENDENCIES.json).',
  '',
  'LM Studio (optional local AI runtime) is external, proprietary, user-installed software — never bundled, never required.',
  '',
  '---',
  '',
  '## Direct runtime dependencies',
  '',
  ...runtimeDirect.map(notice),
  '## Transitive runtime dependencies',
  '',
  ...(runtimeTransitive.length > 0 ? runtimeTransitive.map(notice) : ['_(none)_', '']),
].join('\n');
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${notices}\n`);

console.log(
  `[deps] DEPENDENCIES.json + THIRD_PARTY_NOTICES.md generated: ` +
    `${runtimeDirect.length} runtime direct, ${runtimeTransitive.length} runtime transitive, ` +
    `${devDirect.length} dev direct, ${devTransitive.length} dev transitive`,
);
