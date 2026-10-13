#!/usr/bin/env node
/**
 * GitHub Release publisher (T-047, dev machine only — never needed to
 * install the extension).
 *
 * Creates the versioned GitHub Release for the current main branch and
 * uploads the release artifacts produced by `npm run release`:
 *   - local-notes-web-archive-<version>.zip        (the loadable package)
 *   - local-notes-web-archive-<version>.zip.sha256 (integrity checksum)
 *   - RELEASE_MANIFEST.txt                          (verified file inventory)
 *
 * Idempotent: an existing release is reused; assets are uploaded only when
 * missing or when their byte size differs from the local artifact.
 *
 * Credentials are read at RUNTIME from (in order): the GITHUB_TOKEN env var
 * or the local git credential store (~/.git-credentials). No token is ever
 * committed to the repository (rule.md §6).
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

function fail(message) {
  console.error(`PUBLISH ABORTED: ${message}`);
  process.exit(1);
}

/** Runtime token: env first, then the persistent git credential store. */
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

function repoSlug() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const https = /^https:\/\/github\.com\/([^/]+)\/([^.\s]+?)(?:\.git)?$/.exec(remote);
    if (https) return `${https[1]}/${https[2]}`;
    const ssh = /^git@github\.com:([^/]+)\/([^.\s]+?)(?:\.git)?$/.exec(remote);
    if (ssh) return `${ssh[1]}/${ssh[2]}`;
  } catch {
    // fall through to the default
  }
  return 'kimpearce888/local-notes-web-archive';
}

const token = readToken();
if (!token) fail('no GitHub token: set GITHUB_TOKEN or store one via git credential.helper=store');
const slug = repoSlug();
const authHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'local-notes-web-archive-release-script',
};

const releaseDir = join(root, 'release');
const zipName = `local-notes-web-archive-${version}.zip`;
const assets = [
  { path: join(releaseDir, zipName), name: zipName, type: 'application/zip' },
  { path: `${join(releaseDir, zipName)}.sha256`, name: `${zipName}.sha256`, type: 'text/plain' },
  { path: join(releaseDir, 'RELEASE_MANIFEST.txt'), name: 'RELEASE_MANIFEST.txt', type: 'text/plain' },
];
for (const asset of assets) {
  if (!existsSync(asset.path)) fail(`${asset.name} missing — run "npm run release" first`);
}

const notes = `# Local Notes & Web Archive v${version}

Local-first, offline-first Chrome (Manifest V3) extension: rich-text notes,
web page archiving (MHTML + full-page PNG + extracted text), reminders and
optional local LM Studio AI. No cloud services, no accounts, no telemetry,
no remote code.

## Install (no build steps)

1. Download **${zipName}** below.
2. Extract the ZIP anywhere.
3. Open \`chrome://extensions\`, enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.
5. Use the extension — the toolbar action opens the notes dashboard.

Chrome 120+ required. Everything stays on your device.

## Verification

- Full gate matrix and measured numbers: [\`docs/RELEASE_VERIFICATION.md\`](https://github.com/${slug}/blob/main/docs/RELEASE_VERIFICATION.md)
- File inventory: **RELEASE_MANIFEST.txt** below (byte-for-byte with the zip contents)
- Integrity: **${zipName}.sha256** below
- Automated acceptance: unit 797/797, Playwright E2E 58/58 over the real
  unpacked build, including a dedicated extract-zip-and-load acceptance suite
  (the artifact in this release is the exact folder layout that was tested)

## What's new in v1.0.4 — post-redesign fixes

Two defects reported against the v1.0.3 redesign are fixed. No other
changes — 100% feature parity with v1.0.3.

- **Sidebar "All notes" button invisible**: under the default *System*
  appearance preference with a light OS, the active smart-list pill painted
  the dark-theme navy behind near-black text (~1.2:1 contrast). The dark
  active-nav override now applies only to the explicit dark theme (and
  system + dark OS); system + light renders the light accent-soft pill
  (~13:1 contrast)
- **Note cards read body-first with jumbled chips**: cards now read
  title → subtitle → body preview → **tags row** → **categories row** →
  link/reminder indicators → dates, with tags and categories on separate
  rows and empty rows omitted entirely

## What's new in v1.0.3 — redesigned UI/UX

The whole interface was redesigned ("a local-first Obsidian alternative
with Linear's polish and Arc's modern feel") with **100% feature parity**:
no change to business logic, data structures, storage, APIs, permissions,
search/AI/reminder/archive logic or import/export behavior.

- Persistent sidebar layout (brand, New Note, smart lists, secondary
  actions) with a sticky search topbar and a command-center content column
- New **command palette (Ctrl+K)**: keyboard-first launcher over existing
  actions — new note, import, smart-list navigation, settings, diagnostics,
  theme preference
- Refined dark-first design language (deep neutral palette, indigo accent,
  hairline borders, subtle motion) with light and system themes kept in
  WCAG-AA parity
- Editor: document-grade title, calm prose typography, grouped session
  header with icons, sticky formatting toolbar
- Uniform dialog rhythm, unified editor sub-panels, small-caps settings and
  diagnostics sections, floating bulk action bar, responsive sidebar
  collapse (icon rail -> top strip)

## Checksum

\`\`\`
${readFileSync(`${join(releaseDir, zipName)}.sha256`, 'utf8').trim()}
\`\`\``;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

console.log(`[publish] target ${slug} tag ${tag}`);

// 1. Find or create the release.
let release;
const found = await api(`https://api.github.com/repos/${slug}/releases/tags/${tag}`);
if (found.status === 200) {
  release = found.body;
  console.log(`[publish] release ${tag} already exists (id ${release.id}) — reusing`);
} else {
  const created = await api(`https://api.github.com/repos/${slug}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: `v${version}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  });
  if (created.status !== 201) fail(`release creation failed: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  release = created.body;
  console.log(`[publish] created release ${tag} (id ${release.id})`);
}

// 2. Upload assets idempotently (replace only when the bytes differ).
let existing = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
for (const asset of assets) {
  const bytes = readFileSync(asset.path);
  const size = statSync(asset.path).size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const current = existing.get(asset.name);
  if (current && current.size === size) {
    console.log(`[publish] ${asset.name} already uploaded (${size} bytes) — skipped`);
    continue;
  }
  if (current) {
    const deleted = await api(
      `https://api.github.com/repos/${slug}/releases/assets/${current.id}`,
      { method: 'DELETE' },
    );
    if (deleted.status !== 204) fail(`asset delete failed for ${asset.name}: HTTP ${deleted.status}`);
    console.log(`[publish] ${asset.name} size changed — old asset removed`);
  }
  const upload = await fetch(
    `https://uploads.github.com/repos/${slug}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': asset.type, 'Content-Length': String(size) },
      body: bytes,
    },
  );
  if (upload.status !== 201) {
    fail(`asset upload failed for ${asset.name}: HTTP ${upload.status} ${await upload.text()}`);
  }
  console.log(`[publish] uploaded ${asset.name} (${size} bytes, sha256 ${sha256.slice(0, 16)}…)`);
}

console.log(`[publish] release live: ${release.html_url}`);
