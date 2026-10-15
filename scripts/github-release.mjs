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
- Automated acceptance: unit 917/917, Playwright E2E 78/78 over the real
  unpacked build, including a dedicated extract-zip-and-load acceptance suite
  (the artifact in this release is the exact folder layout that was tested)

## What's new in v1.0.9 — New Note finally takes you to the new note

A user reported it right after v1.0.8: activating **New Note** while you
are already editing something (or while doing anything else in the app)
created the note silently in the background — the app stayed wherever it
was, nothing navigated, and because nothing happened on screen you could
keep clicking and stack an unlimited pile of empty "Untitled" notes
without ever seeing them being born. v1.0.9 fixes exactly that, with a
regression test behind each behavior. No features were added or removed.

- **Creating a note now lands you in it**: every New Note entry point
  (sidebar button, empty-library button, onboarding primary action,
  command palette, Alt+Shift+C) navigates straight into the fresh note so
  you can start typing immediately — the note you were editing before is
  safely flushed by autosave on the way in, nothing is lost
- **Rapid clicking can no longer stack background notes**: while a
  creation is in flight, further activations of New Note are ignored —
  one click means one note, spamming the button (or the keyboard
  shortcut) produces a single fresh note, not a pile of them
- **Honest save indicator when switching notes**: the header's save-state
  used to keep showing the previous note's "Saved" after you opened
  another note; it now resets honestly while the newly opened note loads

## What's new in v1.0.8 — the human-QA program (9 defects fixed)

A full human-behavior QA program (206 individual actions, 22 complete
workflows, 15 interaction combinations, edge/visual sweeps — every one
driven through the real UI with screenshots, session videos and logs on
file in the repo under artifacts/human-qa/)
found nine defects. All nine are fixed in this release, each with a
regression test and real-UI re-verification. No features were added or
removed — v1.0.8 is purely the repaired v1.0.7.

- **Find & Replace no longer destroys rich notes (critical)**: Replace all
  rebuilt the entire note as plain paragraphs — every heading, list, table
  and code block was silently flattened and images were deleted outright,
  then autosaved. Replacements now edit text in place inside the document
  structure; a single Ctrl+Z still restores everything (one transaction)
- **Exclusion-only searches returned nothing**: \`-sourdough\` (documented
  "everything except" syntax) silently emptied the list instead of showing
  the notes that do not match; and invalid syntax like \`is:zebra\` now
  surfaces an inline explanation instead of a bare "no matching notes"
- **Saved settings now apply without a reload**: toolbar-group
  preferences set in Settings previously needed a page reload before new
  editor sessions picked them up
- **Image dialog honors text typed after picking the file**: alt text and
  captions filled in after choosing an image were silently dropped; the
  dialog now stages the file with a real Insert button
- **Save-a-web-page and context-menu captures actually run**: saves from
  the dialog left links parked as "detected" forever while reporting
  success; they now queue and complete the capture
- **The permission flow is reachable**: captures on un-granted sites now
  show a **Grant access** button in the snapshots panel that requests the
  permission and resumes the capture
- **Failed captures are retryable**: the card tooltip always said "open
  the note to retry from its snapshots panel" — the panel had no retry
  button. It has one now, and it works
- **Compare snapshots is finally reachable**: re-capturing a captured link
  (for a second revision to compare) had no UI entry point, making the
  Compare dialog permanently unreachable; captured links now offer
  "Capture fresh copy" and the chain builds revisions you can diff

## What's new in v1.0.7 — the lost-user register (17 UX findings fixed)

A maintainer-reported UX audit ("a lot of areas where a person does not any
clue what they are supposed to do or use that feature") produced a complete
lost-user register: every disclosure surface, every file-picker flow, every
piece of developer jargon in user-facing copy, every discoverability gap —
17 findings (8 severe), each verified live against the shipped build. This
release fixes all 16 actionable findings (the 17th, diagnostics vocabulary,
was accepted as-is: that page's audience opts in).

- **Every popped-out bar now carries its own Close control**: the
  attachments, snapshots, reminders and AI bars previously opened with no
  close button, no Escape, no click-outside — the only dismissal was knowing
  to re-click the small toolbar toggle. Every bar has an in-surface Close,
  Escape unwinds them (while no modal dialog is open), the Filters bar
  additionally closes on Apply, and Revisions now honors Escape too
- **iPhone photos (HEIC) insert from your PC**: the image picker admitted
  no HEIC/HEIF, so the most common photo format was greyed out in the OS
  picker. Inserting now decodes HEIC locally to displayable JPEG through a
  pinned libheif decoder compiled without dynamic evaluation (the strict
  extension CSP is untouched; nothing uploads; decode runs in a dedicated
  worker). Undecodable files stay as attachments with a truthful message.
  The dialog also stopped asking for \`data:image\` "blobs" — it now teaches
  drag-and-drop and Ctrl+V paste instead
- **Tags and categories are editable in the note itself**: previously the
  ONLY path was list → checkboxes → bulk bar. The editor now has a metadata
  bar under the subtitle: removable chips, an add field with suggestions,
  applied immediately like attachments
- **Saving a web page has a visible entry point**: capture was reachable
  only by pasting a URL into a note (feedback: a transient toast). A
  "Save a web page…" action now sits in the sidebar next to New Note (and
  in the command palette) — paste a link, a note is created and the
  capture queued through the same pipeline the context menu uses
- **Onboarding teaches the product**: the five privacy points are now led
  by three concrete first actions, and the primary button IS the first step
  ("Create my first note"); the empty library offers an inline create button
- **Plain language everywhere**: attachment rows say "PNG image", not
  \`image/png\`; snapshot copy says "complete saved copy of the page", not
  raw MHTML vocabulary; the AI panel's MCP disclosure moved into a collapsed
  "Technical details"

## What's new in v1.0.6 — full QA & release validation program

A second external QA protocol (zero-trust validation: DISCOVER -> TEST ->
BREAK -> FIX -> RETEST -> REGRESSION -> VALIDATE) re-verified the entire
application from scratch: all 60 PRD requirements, 27 UI surfaces, 138
controls, 34+ end-to-end workflows, security (XSS/sanitization/permissions/
secrets), performance and memory, data integrity across reloads/restarts/
upgrades/rollbacks, accessibility, and dependencies. Two defects were found
and fixed with dedicated regression coverage; two consecutive independent
verification passes then ran completely clean.

- **Search results can no longer be overwritten by stale background
  refreshes**: rapid note creation left earlier search queries resolving
  out of order, so an older unfiltered result could replace the newer
  view while the search box still held your query. Requests are now
  strictly sequenced — only the latest query can update the list
  (verified with a creation-storm regression test).
- **Card timestamps now meet WCAG AA contrast in both themes**: the
  "Created / Modified" meta text on note cards was 3.3:1 (light) and
  ~3.5-4:1 (dark) against its background — now 5.7:1 / 5.0+, locked by
  per-surface contrast tests.
- **QA evidence on file**: 22 screenshots, a full video walkthrough,
  coverage matrix (every discovered screen has direct test evidence),
  performance measurements (load 207 ms, search 47 ms at 121 notes,
  p95 120-126 ms at 10k), memory-leak loops (bounded heap, net listener
  cleanup), upgrade v1.0.4->v1.0.6 and rollback validation with real
  data, npm audit 0 vulnerabilities.

## What's new in v1.0.5 — QA-audit defect fixes

A full external human-behavior QA audit of v1.0.4 (7 defects, 34 workflows
verified, evidence on file) drove this release. All seven findings are fixed;
no feature was removed or changed beyond the fixes.

- **Attachments and backups work again (critical)**: \`chrome.runtime.sendMessage\`
  JSON-serializes message values, which silently turned every attached file and
  every backup archive into an empty object on the wire — attachments failed
  with "data must be a Blob", backup export failed at \`createObjectURL\`, and
  restore could never read the archive. Binary data now travels as base64
  envelopes at the channel boundary and is rebuilt into real Blobs; the
  attachments panel's "Attach files…" button also finally opens the picker it
  always promised
- **Favorites are reachable**: the favorite flag had no user interface anywhere
  — the Favorites smart list was permanently empty. It now has bulk-bar
  actions and an editor-header toggle (mirroring Pin)
- **The Filters panel exists**: the topbar Filters button opened an empty
  region. It now holds the full FR-SEARCH-03 control set (date ranges, tags,
  categories, state, reminder and snapshot filters, pinned/favorites/links/
  attachments, capture date, source domain) with removable active-filter chips
  and combinable **saved named views** that persist across restarts
- **Sort direction control**: sorting was hard-coded descending with no
  ascending control anywhere. The toolbar now offers ascending/descending
  (hidden for relevance, where direction is meaningless) and the persisted
  default sort finally seeds new sessions
- **Re-shown onboarding can be completed**: Settings → "Show the introduction
  again" presented a permanently disabled Get-started button (Escape was the
  only way out). The button now resets on every presentation
- **Rapid creation keeps the page honest**: creating notes quickly beyond the
  page size rendered 52 cards on "Page 1 of 2" until reload; the paginated
  window now keeps its size invariant at every step

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
