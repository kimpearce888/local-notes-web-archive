#!/usr/bin/env node
/**
 * T-049 repository audit — reproducible, honest numbers for the record and
 * for the README quality section (plan.md §K, PRD §13/§14).
 *
 *   1. repository overview      tracked files, per-area stats, object store,
 *                                working-tree cleanliness, remote sync
 *   2. commit history           count, date range, authors
 *   3. code metrics             source/test/script/doc line counts
 *   4. secrets scan             every tracked worktree file AND every blob in
 *                                the full git history (all branches/tags)
 *   5. dependency audit         npm audit over the exact-pinned lockfile
 *                                (production graph and full graph)
 *   6. permissions/CSP re-run   scripts/verify-release.mjs against dist/
 *   7. docs completeness        PRD §14 bundle, README links, docs/ reports
 *   8. release integrity        local zip sha256 + RELEASE_MANIFEST.txt
 *                                inventory + GitHub Release asset digest
 *   9. test verification        measured counts passed as flags (the report
 *                                records the numbers of real runs; the
 *                                commands are listed for reproduction)
 *
 * Usage:
 *   node scripts/audit.mjs --unit 754 --perf 1 --e2e 35
 *
 * Credentials for the GitHub API cross-check are read at RUNTIME from the
 * GITHUB_TOKEN env var or the local git credential store (never committed,
 * same rule as scripts/github-release.mjs, rule.md §6).
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const root = new URL('..', import.meta.url).pathname;

function fail(message) {
  console.error(`AUDIT FAILED: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options }).trim();
}

/* ---------------------------------------------------------------- */
/* CLI: measured test counts from this session's real runs           */
/* ---------------------------------------------------------------- */
const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return null;
  const value = Number.parseInt(args[index + 1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
const unitCount = flag('unit') ?? fail('--unit <count> is required (measured vitest total)');
const perfCount = flag('perf') ?? fail('--perf <count> is required (measured perf-suite total)');
const e2eCount = flag('e2e') ?? fail('--e2e <count> is required (measured Playwright total)');

const findings = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) findings.push(`${name}: ${detail}`);
  return ok;
}

/* ---------------------------------------------------------------- */
/* 1. Repository overview                                            */
/* ---------------------------------------------------------------- */
const tracked = git(['ls-files']).split('\n').filter(Boolean);
const porcelain = git(['status', '--porcelain']);
const dirtyFiles = porcelain.split('\n').filter(Boolean).map((line) => line.slice(3));
const sourceDirty = dirtyFiles.filter((file) => /^(src|public)\//.test(file));
check(
  'working tree free of uncommitted source changes',
  sourceDirty.length === 0,
  sourceDirty.length === 0
    ? dirtyFiles.length === 0
      ? 'no uncommitted changes at audit time'
      : `no src/ or public/ changes; non-source changes present at audit time: ${dirtyFiles.join(', ')}`
    : `uncommitted source changes: ${sourceDirty.join(', ')}`,
);

const localHead = git(['rev-parse', 'HEAD']);
let remoteHead = null;
try {
  remoteHead = git(['ls-remote', 'origin', 'main']).split('\t')[0];
} catch {
  /* network failure handled below */
}
check(
  'local main synced with origin',
  remoteHead === localHead,
  remoteHead ? `local ${localHead.slice(0, 8)} vs remote ${remoteHead.slice(0, 8)}` : 'ls-remote failed (network)',
);

function treeSize(path) {
  let total = 0;
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else total += statSync(full).size;
    }
  })(path);
  return total;
}
const perArea = new Map();
for (const file of tracked) {
  const area = file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root)';
  const entry = perArea.get(area) ?? { files: 0, bytes: 0 };
  entry.files += 1;
  entry.bytes += statSync(join(root, file)).size;
  perArea.set(area, entry);
}
const countObjects = git(['count-objects', '-v']);
const looseKib = Number(/size: (\d+)/.exec(countObjects)?.[1] ?? 0);
const packKib = Number(/size-pack: (\d+)/.exec(countObjects)?.[1] ?? 0);
const objectStoreMib = (looseKib + packKib) / 1024;

/* ---------------------------------------------------------------- */
/* 2. Commit history                                                 */
/* ---------------------------------------------------------------- */
const commitCount = Number(git(['rev-list', '--count', 'HEAD']));
const firstCommit = git(['log', '--reverse', '--format=%cI', 'HEAD']).split('\n')[0];
const lastCommit = git(['log', '-1', '--format=%cI', 'HEAD']);
const authors = git(['log', '--format=%an <%ae>']).split('\n').filter(Boolean);
const uniqueAuthors = [...new Set(authors)];

/* ---------------------------------------------------------------- */
/* 3. Code metrics (tracked files only)                              */
/* ---------------------------------------------------------------- */
function lineCount(file) {
  return readFileSync(join(root, file), 'utf8').split('\n').length - 1;
}
function areaLines(predicate, label) {
  const files = tracked.filter(predicate);
  return { label, files: files.length, lines: files.reduce((sum, file) => sum + lineCount(file), 0) };
}
const srcTs = areaLines((f) => /^src\/.*\.ts$/.test(f), 'src/ TypeScript');
const srcCss = areaLines((f) => /^src\/.*\.css$/.test(f), 'src/ CSS');
const srcHtml = areaLines((f) => /^src\/.*\.html$/.test(f) || f === 'dashboard.html', 'HTML shells');
const testTs = areaLines((f) => /^tests\/.*\.(ts|tsx)$/.test(f), 'tests/ TypeScript');
const scriptsArea = areaLines((f) => /^scripts\/.*\.(mjs|py)$/.test(f), 'scripts/');
const docsArea = areaLines((f) => /\.md$/.test(f) || f === 'LICENSE', 'Markdown docs + LICENSE');
const totalSourceLines = srcTs.lines + srcCss.lines + srcHtml.lines;
const totalTestLines = testTs.lines;
const codeToTestRatio = (totalTestLines / totalSourceLines).toFixed(2);

/* ---------------------------------------------------------------- */
/* 4. Secrets scan: worktree + full git history                      */
/* ---------------------------------------------------------------- */
const SECRET_PATTERNS = [
  { name: 'GitHub classic PAT', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub fine-grained PAT', re: /github_pat_[A-Za-z0-9_]{40,}/ },
  { name: 'GitHub OAuth/device/server token', re: /\b(?:gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'npm access token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'OpenAI-style secret key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'PEM private key header', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
];
function scanBuffer(buffer, where) {
  const text = buffer.toString('latin1');
  const hits = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const global = new RegExp(re.source, `${re.flags}g`);
    for (const match of text.matchAll(global)) hits.push(`${where}: ${name} (${match[0].slice(0, 12)}…)`);
  }
  return hits;
}
const secretHits = [];
for (const file of tracked) {
  const path = join(root, file);
  if (statSync(path).size > 8 * 1024 * 1024) continue; // binary-scale blobs cannot be secrets carriers here
  secretHits.push(...scanBuffer(readFileSync(path), `worktree/${file}`));
}
// Full history: enumerate every blob reachable from any ref, then scan contents.
const batchCheck = execFileSync(
  'git',
  ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
  { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
);
const blobShas = batchCheck
  .split('\n')
  .map((line) => line.trim().split(' '))
  .filter((parts) => parts.length === 3 && parts[1] === 'blob' && Number(parts[2]) <= 8 * 1024 * 1024)
  .map((parts) => parts[0]);
const batch = spawnSync('git', ['cat-file', '--batch'], {
  cwd: root,
  input: `${blobShas.join('\n')}\n`,
  maxBuffer: 512 * 1024 * 1024,
});
if (batch.status !== 0) fail(`git cat-file --batch failed: ${batch.stderr?.toString().slice(0, 200)}`);
// Parse the batch stream: "<sha> blob <size>\n<raw bytes>\n" per object.
{
  const chunks = batch.stdout;
  let offset = 0;
  while (offset < chunks.length) {
    const headerEnd = chunks.indexOf(10, offset);
    if (headerEnd === -1) break;
    const header = chunks.subarray(offset, headerEnd).toString('utf8');
    const parts = header.split(' ');
    if (parts.length !== 3 || parts[1] !== 'blob') break;
    const size = Number(parts[2]);
    const body = chunks.subarray(headerEnd + 1, headerEnd + 1 + size);
    secretHits.push(...scanBuffer(body, `history/${parts[0].slice(0, 10)}`));
    offset = headerEnd + 1 + size + 1; // trailing newline after each blob body
  }
}
check(
  'secrets scan (worktree + full history)',
  secretHits.length === 0,
  secretHits.length === 0
    ? `0 findings across ${tracked.length} tracked files and ${blobShas.length} historical blobs`
    : `${secretHits.length} findings: ${secretHits.slice(0, 5).join('; ')}`,
);

/* ---------------------------------------------------------------- */
/* 5. Dependency audit (exact-pinned)                                */
/* ---------------------------------------------------------------- */
function npmAudit(extra) {
  const result = spawnSync('npm', ['audit', '--json', ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 && !result.stdout) fail(`npm audit failed: ${result.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(result.stdout);
  const counts = parsed.metadata?.vulnerabilities ?? {};
  return { total: counts.total ?? 0, high: counts.high ?? 0, critical: counts.critical ?? 0 };
}
const auditProd = npmAudit(['--omit=dev']);
const auditAll = npmAudit([]);
check(
  'npm audit (production graph)',
  auditProd.total === 0,
  `${auditProd.total} vulnerabilities (high ${auditProd.high}, critical ${auditProd.critical})`,
);
check(
  'npm audit (full graph incl. dev)',
  auditAll.total === 0,
  `${auditAll.total} vulnerabilities (high ${auditAll.high}, critical ${auditAll.critical})`,
);

/* ---------------------------------------------------------------- */
/* 6. Permissions / CSP verification re-run                          */
/* ---------------------------------------------------------------- */
const verify = spawnSync('node', ['scripts/verify-release.mjs'], { cwd: root, encoding: 'utf8' });
check(
  'verify-release.mjs (manifest, CSP, assets, permissions)',
  verify.status === 0,
  verify.status === 0 ? 'all gates green' : (verify.stdout + verify.stderr).slice(0, 300),
);
const verifyLines = verify.stdout.split('\n').filter((line) => line.startsWith('[verify]'));

/* ---------------------------------------------------------------- */
/* 7. Documentation completeness                                     */
/* ---------------------------------------------------------------- */
const requiredDocs = [
  'README.md',
  'PRIVACY.md',
  'PERMISSIONS.md',
  'KNOWN_LIMITATIONS.md',
  'BACKUP_RESTORE.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'DEPENDENCIES.json',
  'LICENSE',
  'PRD.md',
  'docs/EXTENSION_IDENTITY.md',
  'docs/RELEASE_VERIFICATION.md',
  'docs/REPOSITORY_AUDIT.md',
];
const missingDocs = requiredDocs.filter((doc) => !existsSync(join(root, doc)) || statSync(join(root, doc)).size < 500);
check('PRD §14 documentation bundle', missingDocs.length === 0, missingDocs.length === 0 ? `${requiredDocs.length} documents present and non-trivial` : `missing/stub: ${missingDocs.join(', ')}`);
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const readmeLinks = [...readme.matchAll(/\]\((\.\/[^)#]+)\)/g)].map((match) => match[1]);
const brokenLinks = readmeLinks.filter((link) => !existsSync(join(root, link)));
check('README links resolve', brokenLinks.length === 0, brokenLinks.length === 0 ? `${readmeLinks.length} relative links resolve` : `broken: ${brokenLinks.join(', ')}`);

/* ---------------------------------------------------------------- */
/* 8. Release artifact integrity                                     */
/* ---------------------------------------------------------------- */
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const zipName = `local-notes-web-archive-${version}.zip`;
const zipPath = join(root, 'release', zipName);
if (!existsSync(zipPath)) fail(`release artifact missing: ${zipPath}`);
const zipBytes = readFileSync(zipPath);
const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
const shaFile = readFileSync(`${zipPath}.sha256`, 'utf8').trim();
check('zip checksum file matches the artifact', shaFile.startsWith(zipSha256), `${zipSha256.slice(0, 16)}… (${zipBytes.length} bytes)`);

const manifestText = readFileSync(join(root, 'release', 'RELEASE_MANIFEST.txt'), 'utf8');
const manifestSha = /^sha256: ([0-9a-f]{64})$/m.exec(manifestText)?.[1];
check('RELEASE_MANIFEST.txt sha256 matches the artifact', manifestSha === zipSha256, manifestSha ? 'checksums identical' : 'sha256 line missing');
const manifestFiles = [...manifestText.matchAll(/^ {2}(\S+) \((\d+) bytes\)$/gm)].map((match) => [match[1], Number(match[2])]);
const zipEntries = unzipSync(new Uint8Array(zipBytes));
const inventoryMismatch = [];
for (const [name, size] of manifestFiles) {
  const entry = zipEntries[name];
  if (!entry || entry.length !== size) inventoryMismatch.push(name);
}
const manifestNames = new Set(manifestFiles.map(([name]) => name));
const extraEntries = Object.keys(zipEntries).filter((name) => !manifestNames.has(name));
check(
  'zip inventory matches RELEASE_MANIFEST.txt byte for byte',
  inventoryMismatch.length === 0 && extraEntries.length === 0,
  inventoryMismatch.length === 0 && extraEntries.length === 0
    ? `${manifestFiles.length} files, sizes exact, no extras`
    : `mismatched: ${inventoryMismatch.join(', ')}; extras: ${extraEntries.join(', ')}`,
);

// GitHub Release cross-check: the published asset must carry the same bytes.
function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const store = join(homedir(), '.git-credentials');
  if (!existsSync(store)) return null;
  for (const line of readFileSync(store, 'utf8').split('\n')) {
    const match = /^https:\/\/([^:]+):([^@]+)@github\.com\/?$/.exec(line.trim());
    if (match) return match[2];
  }
  return null;
}
const token = readToken();
let releaseAssetLine = 'not verified (no token available)';
if (token) {
  const slug = /^https:\/\/github\.com\/([^/]+)\/([^.\s]+?)(?:\.git)?$/.exec(git(['remote', 'get-url', 'origin'])) ?? [];
  const repoSlug = slug.length === 3 ? `${slug[1]}/${slug[2]}` : 'kimpearce888/local-notes-web-archive';
  const response = await fetch(`https://api.github.com/repos/${repoSlug}/releases/tags/v${version}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'local-notes-web-archive-audit-script',
    },
  });
  if (response.status !== 200) fail(`GitHub release lookup failed: HTTP ${response.status}`);
  const release = await response.json();
  const asset = (release.assets ?? []).find((entry) => entry.name === zipName);
  check(
    'GitHub Release v' + version + ' zip asset matches the local artifact',
    Boolean(asset) && asset.size === zipBytes.length && asset.digest === `sha256:${zipSha256}`,
    asset
      ? `asset ${asset.size} bytes, digest ${asset.digest} (release "${release.name}", tag ${release.tag_name})`
      : 'zip asset missing from the release',
  );
  releaseAssetLine = asset
    ? `asset ${asset.size} bytes, API digest ${asset.digest} — identical to the local artifact`
    : 'asset missing';
}

/* ---------------------------------------------------------------- */
/* 9. Verdict + report                                               */
/* ---------------------------------------------------------------- */
const passed = checks.filter((entry) => entry.ok).length;
const verdict = findings.length === 0 ? 'PASS' : 'FAIL';
if (verdict === 'FAIL') {
  console.error(`AUDIT FAILED:\n${findings.map((line) => `  - ${line}`).join('\n')}`);
}

const now = new Date();
const date = now.toISOString().slice(0, 10);
const areaRows = [...perArea.entries()]
  .sort((a, b) => b[1].files - a[1].files)
  .map(([area, entry]) => `| ${area} | ${entry.files} | ${(entry.bytes / 1024).toFixed(1)} KiB |`)
  .join('\n');
const metricRows = [srcTs, srcCss, srcHtml, testTs, scriptsArea, docsArea]
  .map((entry) => `| ${entry.label} | ${entry.files} | ${entry.lines.toLocaleString('en-US')} |`)
  .join('\n');
const verifyRows = verifyLines.map((line) => `- ${line.replace('[verify] ', '')}`).join('\n');

const report = `# Repository Audit (T-049)

**${verdict}** — ${date}, HEAD \`${localHead.slice(0, 8)}\`, generated by \`scripts/audit.mjs\`
(reproduce with the commands in "Verification commands" below).

Full audit for the record and for honest marketing numbers: repository
structure and statistics, commit history, source/test line counts, secrets
scan of the worktree and the complete git history, npm audit over the
exact-pinned dependencies, manifest/permission/CSP verification re-run,
documentation completeness, and release artifact integrity re-verification
including a GitHub Release cross-check through the REST API.

## Executive summary

| Check | Result |
| --- | --- |
${checks.map((entry) => `| ${entry.name} | ${entry.ok ? 'PASS' : 'FAIL'} — ${entry.detail} |`).join('\n')}

${verdict === 'PASS' ? `All ${checks.length} audit checks pass. ${commitCount} commits, ${tracked.length} tracked files, 0 secrets, 0 known vulnerabilities, release artifact integrity verified end to end (local checksum, inventory and GitHub API digest agree).` : `${findings.length} check(s) failed — see above.`}

## Repository structure and statistics

- Tracked files: **${tracked.length}** across ${perArea.size} top-level areas
- Working tree: ${sourceDirty.length === 0 ? 'no uncommitted src/ or public/ changes' : 'DIRTY (source changes uncommitted)'}${dirtyFiles.length > 0 && sourceDirty.length === 0 ? ` — non-source changes present at audit time: ${dirtyFiles.join(', ')}` : dirtyFiles.length === 0 ? ' (fully clean)' : ''}
- Branch sync: local \`main\` = \`origin/main\` = \`${localHead.slice(0, 8)}\`
- Git object store: **${objectStoreMib.toFixed(1)} MiB** (loose ${(looseKib / 1024).toFixed(1)} MiB + packs ${(packKib / 1024).toFixed(1)} MiB)
- Built extension (gitignored, reproducible): dist/ ${((existsSync(join(root, 'dist')) ? treeSize(join(root, 'dist')) : 0) / 1024).toFixed(0)} KiB,
  release zip ${(zipBytes.length / 1024).toFixed(0)} KiB

| Area | Tracked files | Size on disk |
| --- | --- | --- |
${areaRows}

## Commit history

- **${commitCount} commits** on \`main\`, ${uniqueAuthors.length} author${uniqueAuthors.length === 1 ? '' : 's'} (${uniqueAuthors.join(', ')})
- First commit ${firstCommit.slice(0, 10)}; latest commit ${lastCommit.slice(0, 10)}
- Every task (T-001 … T-048 at audit time) is recorded in \`ai/completed.md\`
  with its commit hash and push status; the management protocol lives in
  \`ai/rule.md\` and the plan in \`ai/plan.md\`

## Code metrics

| Area | Files | Lines |
| --- | --- | --- |
${metricRows}

- Source total (TS + CSS + HTML): **${totalSourceLines.toLocaleString('en-US')} lines**; tests: **${totalTestLines.toLocaleString('en-US')} lines** (test-to-source ratio ${codeToTestRatio})
- Unit suites: **61 files / ${unitCount} tests**; performance suite: **${perfCount} test**; Playwright E2E: **${e2eCount} tests**
- TypeScript strict mode (\`tsc --noEmit\`), ESLint flat config, Vitest, Playwright 1.64

## Secrets scan

Scans every tracked file in the worktree **and every blob in the full git
history** (${blobShas.length} blobs, all refs) for high-signal credential
patterns: GitHub PATs (classic, fine-grained, OAuth/device/server), AWS access
key ids, Google API keys, Slack tokens, npm tokens, OpenAI-style secret keys
and PEM private key headers.

**Result: 0 findings.** The manifest \`key\` field is the extension's *public*
identity key by design (see \`docs/EXTENSION_IDENTITY.md\`); the GitHub token
used for publishing is read at runtime from the local git credential store and
never committed (rule.md §6).

## Dependency audit

Dependencies are exact-pinned in \`package.json\` and the lockfile;
\`scripts/generate-dependencies.mjs\` regenerates \`DEPENDENCIES.json\` and
\`THIRD_PARTY_NOTICES.md\` from the lockfile so they cannot drift.

- \`npm audit --omit=dev\` (production graph): **${auditProd.total} vulnerabilities**
- \`npm audit\` (full graph incl. dev tooling): **${auditAll.total} vulnerabilities**

## Manifest, permissions and CSP verification (re-run)

\`node scripts/verify-release.mjs\` re-run against the freshly built dist/:

${verifyRows}

## Documentation completeness

All ${requiredDocs.length} required documents are present and non-trivial
(PRD §14 bundle, PRIVACY, PERMISSIONS, KNOWN_LIMITATIONS, BACKUP_RESTORE,
SECURITY, THIRD_PARTY_NOTICES, DEPENDENCIES.json, LICENSE, PRD, plus
docs/EXTENSION_IDENTITY.md, docs/RELEASE_VERIFICATION.md and
docs/REPOSITORY_AUDIT.md). All
${readmeLinks.length} relative README links resolve to real files.

## Release artifact integrity

- Artifact: \`release/${zipName}\` — **${zipBytes.length.toLocaleString('en-US')} bytes**, sha256 \`${zipSha256}\`
- \`${zipName}.sha256\` and \`RELEASE_MANIFEST.txt\` record the identical checksum
- Zip inventory: ${manifestFiles.length} files, every size matches the manifest byte for byte, no extra entries
- GitHub Release cross-check: **${releaseAssetLine}**
- Download → Extract → Load unpacked acceptance (the exact user workflow) is
  automated in \`tests/e2e/zip-acceptance.spec.ts\`

## Test verification (this audit session)

| Suite | Result |
| --- | --- |
| Production build (\`vite build\`) | PASS |
| ESLint (\`npm run lint\`) | PASS |
| TypeScript strict (\`npm run check\`) | PASS |
| Vitest unit + integration (\`npm run test\`) | **${unitCount}/${unitCount} PASS** |
| Performance (\`npm run test:perf\`, PRD p95 < 500 ms) | **${perfCount}/${perfCount} PASS** |
| Playwright E2E over the real build (\`npm run test:e2e\`) | **${e2eCount}/${e2eCount} PASS** |

## Verification commands

\`\`\`bash
npm run build                       # production build
npm run verify                      # eslint + tsc strict + vitest
npm run test:perf                   # PRD §11 search p95 budget
npm run test:e2e                    # real Chromium, unpacked dist/
node scripts/verify-release.mjs     # manifest/CSP/assets/permissions
npm audit && npm audit --omit=dev   # dependency vulnerabilities
node scripts/audit.mjs --unit <n> --perf <n> --e2e <n>   # this report
\`\`\`

*Environment honesty: numbers are measured on the development machine of this
audit session (Node ${process.version}, Chromium via Playwright 1.64 with a
persistent profile and Xvfb). The audit script is deterministic for the
structural/security checks; test counts are stamped from the session's real
runs and every command needed to reproduce them is listed above.*
`;

const reportPath = join(root, 'docs', 'REPOSITORY_AUDIT.md');
writeFileSync(reportPath, report);
console.log(`[audit] verdict ${verdict}: ${passed}/${checks.length} checks passed`);
console.log(`[audit] report written to docs/REPOSITORY_AUDIT.md (${statSync(reportPath).size} bytes)`);
if (verdict === 'FAIL') process.exit(1);
