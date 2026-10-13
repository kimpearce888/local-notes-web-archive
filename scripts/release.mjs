import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

/**
 * Release pipeline (dev machine only — never needed to install the extension):
 *   1. vite build  -> dist/   (the loadable unpacked extension folder)
 *   2. scan dist/  -> refuse release on remote URLs or dynamic code patterns
 *   3. zip dist/   -> release/local-notes-web-archive-<version>.zip
 *   4. write       -> release/local-notes-web-archive-<version>.zip.sha256
 *   5. inventory   -> release/RELEASE_MANIFEST.txt (file list + sizes)
 *
 * The zip + checksums are the portable release artifacts. The unpacked dist/
 * folder remains the primary installation target (PRD §8.3).
 */

const root = new URL('..', import.meta.url).pathname;
const distDir = join(root, 'dist');
const releaseDir = join(root, 'release');

function fail(message) {
  console.error(`RELEASE ABORTED: ${message}`);
  process.exit(1);
}

// 1. Build
console.log('[release] building dist/ ...');
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });

// 1b. Dependency inventory (PRD §14): regenerate from the actual lockfile so
// DEPENDENCIES.json / THIRD_PARTY_NOTICES.md can never drift from reality.
console.log('[release] regenerating dependency inventory ...');
execFileSync('node', ['scripts/generate-dependencies.mjs'], { cwd: root, stdio: 'inherit' });

// 2. Static release gate: no remote runtime URLs, no dynamic code in shipped JS.
// Inert literal constants embedded by bundled dependencies — never fetched
// at runtime (the E2E network privacy test, FR-SET-04, proves this):
//   - W3C XML namespace identifiers carried by DOMPurify/ProseMirror
//     (http://www.w3.org/2000/svg etc. are namespace URIs, not endpoints)
//   - documentation links inside dependency error/deprecation messages
//     (prosemirror.net/docs, github.com/highlightjs|markedjs issues)
const INERT_URL_ALLOWLIST = [
  /https?:\/\/www\.w3\.org\//g,
  /https?:\/\/prosemirror\.net\/docs\//g,
  /https?:\/\/github\.com\/(?:highlightjs|markedjs)\//g,
];
const forbiddenUrl = /https?:\/\/(?!127\.0\.0\.1|localhost)[\w.-]+/;
const dynamicCode = /\beval\s*\(|\bnew\s+Function\s*\(/;

/** Remove allowlisted inert literals, then test the remainder. */
function hasForbiddenRemoteUrl(content) {
  let remaining = content;
  for (const pattern of INERT_URL_ALLOWLIST) {
    remaining = remaining.replace(pattern, '');
  }
  return forbiddenUrl.test(remaining);
}
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
})(distDir);

const jsFiles = files.filter((f) => f.endsWith('.js'));
const jsonFiles = files.filter((f) => f.endsWith('.json'));
if (!jsonFiles.some((f) => f.endsWith('manifest.json'))) fail('dist/manifest.json missing');
if (jsFiles.length === 0) fail('no built JavaScript found in dist/');

for (const file of jsFiles) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(distDir, file);
  if (dynamicCode.test(content)) fail(`dynamic code pattern in ${rel}`);
  if (hasForbiddenRemoteUrl(content)) fail(`remote runtime URL in ${rel}`);
}
console.log(`[release] static gate passed (${files.length} files, ${jsFiles.length} JS files scanned)`);

// 2b. Manifest/CSP/assets/permissions verification gate (T-043, PRD §13):
// runs the standalone verifier against the freshly built dist/ so the
// release pipeline can never produce an artifact that fails it.
execFileSync('node', [join(root, 'scripts', 'verify-release.mjs')], { cwd: root, stdio: 'inherit' });

// 3-4. Zip + checksum
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
mkdirSync(releaseDir, { recursive: true });
const zipName = `local-notes-web-archive-${version}.zip`;
const zipPath = join(releaseDir, zipName);
const zipEntries = {};
for (const file of files) {
  const rel = relative(distDir, file).replaceAll('\\', '/');
  zipEntries[rel] = new Uint8Array(readFileSync(file));
}
writeFileSync(zipPath, zipSync(zipEntries, { level: 6 }));
const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipName}\n`);

// 5. Inventory
const manifestLines = [
  `artifact: ${zipName}`,
  `sha256: ${sha256}`,
  `version: ${version}`,
  `built: ${new Date().toISOString()}`,
  'files:',
  ...files
    .map((f) => `  ${relative(distDir, f).replaceAll('\\', '/')} (${statSync(f).size} bytes)`)
    .sort(),
];
writeFileSync(join(releaseDir, 'RELEASE_MANIFEST.txt'), `${manifestLines.join('\n')}\n`);
console.log(`[release] wrote ${relative(root, zipPath)} (${statSync(zipPath).size} bytes)`);
console.log(`[release] sha256 ${sha256}`);
console.log('[release] done');
