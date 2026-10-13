import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-043 release verification gate — dist/ manifest scan (plan.md T-043,
 * PRD §13.1/§13.10/§13.13):
 *
 *   1. manifest sanity: MV3, minimum Chrome 120, key present (stable id)
 *   2. CSP: script-src 'self' only (no unsafe-inline/eval/remote/data),
 *      object-src 'self', connect-src 'self' + loopback only
 *   3. every manifest-referenced asset exists in dist/ (icons, worker, html)
 *      and is a real PNG where declared
 *   4. dashboard.html references only local files that exist
 *   5. manifest permissions match PERMISSIONS.md exactly (API set,
 *      required host patterns, optional host patterns)
 *
 * Run standalone (node scripts/verify-release.mjs) or as part of the
 * release pipeline (release.mjs calls this after its own static JS scan).
 */

const root = new URL('..', import.meta.url).pathname;
const distDir = join(root, 'dist');

function fail(message) {
  console.error(`VERIFY FAILED: ${message}`);
  process.exit(1);
}

if (!existsSync(join(distDir, 'manifest.json'))) {
  fail('dist/manifest.json missing — run "npm run build" first');
}

/* ---------------------------------------------------------------- */
/* 1. Manifest sanity                                               */
/* ---------------------------------------------------------------- */
const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version is not 3');
const minChrome = Number.parseInt(String(manifest.minimum_chrome_version ?? ''), 10);
if (!Number.isFinite(minChrome) || minChrome < 120) {
  fail(`minimum_chrome_version must be >= 120 (found ${manifest.minimum_chrome_version})`);
}
if (typeof manifest.key !== 'string' || manifest.key.length < 100) {
  fail('manifest.key missing — extension id would not be stable');
}
console.log(`[verify] manifest sanity OK (MV3, Chrome >= ${minChrome}, stable key)`);

/* ---------------------------------------------------------------- */
/* 2. Content security policy                                       */
/* ---------------------------------------------------------------- */
const csp = String(manifest.content_security_policy?.extension_pages ?? '');
const directives = new Map();
for (const part of csp.split(';')) {
  const trimmed = part.trim();
  if (!trimmed) continue;
  const [name, ...values] = trimmed.split(/\s+/);
  directives.set(name, values);
}
const scriptSrc = directives.get('script-src') ?? [];
const objectSrc = directives.get('object-src') ?? [];
const connectSrc = directives.get('connect-src') ?? [];

if (!scriptSrc.includes("'self'")) fail("CSP script-src must contain 'self'");
for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", 'data:', 'blob:']) {
  if (scriptSrc.includes(forbidden)) fail(`CSP script-src contains forbidden ${forbidden}`);
}
if (scriptSrc.some((v) => /^[a-z]+:\/\//i.test(v))) fail('CSP script-src contains a remote source');
if (objectSrc.length !== 1 || objectSrc[0] !== "'self'") {
  fail("CSP object-src must be exactly 'self'");
}
const loopbackOnly = (value) => value === "'self'" || /^http:\/\/(127\.0\.0\.1|localhost)(:\*)?$/.test(value);
for (const value of connectSrc) {
  if (!loopbackOnly(value)) fail(`CSP connect-src contains non-loopback source ${value}`);
}
if (!connectSrc.includes("'self'")) fail("CSP connect-src must contain 'self'");
console.log('[verify] CSP OK: script-src self-only, object-src self, connect-src loopback-only');

/* ---------------------------------------------------------------- */
/* 3. Referenced assets exist and are real                          */
/* ---------------------------------------------------------------- */
const referenced = new Set();
const iconDecls = [manifest.icons ?? {}, manifest.action?.default_icon ?? {}];
for (const decl of iconDecls) for (const path of Object.values(decl)) referenced.add(path);
referenced.add(manifest.background?.service_worker);
const htmlEntries = readdirSync(distDir).filter((f) => f.endsWith('.html'));
for (const html of htmlEntries) referenced.add(html);
for (const ref of referenced) {
  if (typeof ref !== 'string' || ref.length === 0) continue;
  if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('//')) fail(`remote reference in manifest: ${ref}`);
  const full = join(distDir, ref);
  if (!existsSync(full)) fail(`referenced asset missing from dist/: ${ref}`);
  if (statSync(full).size === 0) fail(`referenced asset is empty: ${ref}`);
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const decl of iconDecls) {
  for (const path of Object.values(decl)) {
    if (typeof path !== 'string') continue;
    const head = readFileSync(join(distDir, path)).subarray(0, 8);
    if (!head.equals(PNG_MAGIC)) fail(`icon is not a PNG: ${path}`);
  }
}
console.log(`[verify] ${referenced.size} manifest/html-referenced assets present, icons are real PNGs`);

/* ---------------------------------------------------------------- */
/* 4. dashboard.html references only existing local files           */
/* ---------------------------------------------------------------- */
for (const html of htmlEntries) {
  const content = readFileSync(join(distDir, html), 'utf8');
  for (const match of content.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const ref = match[1];
    if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('//')) {
      fail(`remote asset reference in ${html}: ${ref}`);
    }
    if (ref.startsWith('#') || ref.startsWith('data:')) continue;
    const clean = ref.replace(/^\//, '').split(/[?#]/)[0];
    if (!existsSync(join(distDir, clean))) fail(`missing local asset in ${html}: ${ref}`);
  }
}
console.log(`[verify] ${htmlEntries.length} html file(s) reference only existing local assets`);

/* ---------------------------------------------------------------- */
/* 5. Permissions match PERMISSIONS.md                              */
/* ---------------------------------------------------------------- */
const permissionsDoc = readFileSync(join(root, 'PERMISSIONS.md'), 'utf8');
function section(name, next) {
  const start = permissionsDoc.indexOf(name);
  if (start === -1) fail(`PERMISSIONS.md section ${name} missing`);
  const end = next ? permissionsDoc.indexOf(next, start) : permissionsDoc.length;
  return permissionsDoc.slice(start, end === -1 ? permissionsDoc.length : end);
}
function backticks(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}
const apiTable = section('## API permissions', '## Host permissions');
const documentedApi = new Set(
  [...apiTable.matchAll(/^\|(.+)\|/gm)].flatMap((row) => backticks(row[1].split('|')[0])),
);
const manifestApi = new Set(manifest.permissions ?? []);
for (const perm of manifestApi) {
  if (!documentedApi.has(perm)) fail(`manifest permission not documented in PERMISSIONS.md: ${perm}`);
}
for (const perm of documentedApi) {
  if (!manifestApi.has(perm)) fail(`PERMISSIONS.md documents a permission the manifest does not request: ${perm}`);
}

const hostTable = section('## Host permissions', '###');
const documentedRequired = new Set(
  [...hostTable.matchAll(/^\|(.+)\|\s*Required\s*\|/gm)].flatMap((row) => backticks(row[1])),
);
const documentedOptional = new Set(
  [...hostTable.matchAll(/^\|(.+)\|\s*Optional\s*\|/gm)].flatMap((row) => backticks(row[1])),
);
const manifestRequired = new Set(manifest.host_permissions ?? []);
const manifestOptional = new Set(manifest.optional_host_permissions ?? []);
const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
if (!sameSet(manifestRequired, documentedRequired)) {
  fail(`required host permissions differ from PERMISSIONS.md: manifest=[${[...manifestRequired]}] doc=[${[...documentedRequired]}]`);
}
if (!sameSet(manifestOptional, documentedOptional)) {
  fail(`optional host permissions differ from PERMISSIONS.md: manifest=[${[...manifestOptional]}] doc=[${[...documentedOptional]}]`);
}
console.log(
  `[verify] permissions match PERMISSIONS.md (${manifestApi.size} API, ` +
    `${manifestRequired.size} required host, ${manifestOptional.size} optional host)`,
);

/* ---------------------------------------------------------------- */
/* Summary                                                          */
/* ---------------------------------------------------------------- */
let fileCount = 0;
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else fileCount += 1;
  }
})(distDir);
console.log(`[verify] dist/ complete: ${fileCount} files, all checks passed`);
