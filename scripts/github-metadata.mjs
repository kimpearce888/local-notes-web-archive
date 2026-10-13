#!/usr/bin/env node
/**
 * T-051 repository metadata publisher (dev machine only). Sets the GitHub
 * repository description, homepage and topics through the REST API so the
 * repo presents itself the way the README does (SEO/SMO round).
 *
 * Credentials are read at RUNTIME from (in order): the GITHUB_TOKEN env var
 * or the local git credential store (~/.git-credentials). No token is ever
 * committed to the repository (rule.md §6).
 *
 * Usage: node scripts/github-metadata.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function fail(message) {
  console.error(`METADATA ABORTED: ${message}`);
  process.exit(1);
}

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
  } catch {
    /* fall through to the default */
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
  'User-Agent': 'local-notes-web-archive-metadata-script',
};

const DESCRIPTION =
  'Local-first Chrome extension: rich-text notes, MHTML web page archiving, reminders and optional LM Studio local AI. No cloud, no accounts, no telemetry — everything stays on your device.';
const HOMEPAGE = `https://github.com/${slug}/releases`;
const TOPICS = [
  'chrome-extension',
  'note-taking',
  'notes-app',
  'web-archive',
  'mhtml',
  'local-first',
  'offline-first',
  'privacy-focused',
  'no-telemetry',
  'manifest-v3',
  'rich-text-editor',
  'tiptap',
  'reminders',
  'lm-studio',
  'local-ai',
  'typescript',
  'vite',
  'playwright',
  'vitest',
  'indexeddb',
];

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders, ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

console.log(`[metadata] target ${slug}`);

const patch = await api(`https://api.github.com/repos/${slug}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ description: DESCRIPTION, homepage: HOMEPAGE }),
});
if (patch.status !== 200) fail(`description/homepage update failed: HTTP ${patch.status} ${JSON.stringify(patch.body)}`);
console.log(`[metadata] description set (${DESCRIPTION.length} chars)`);
console.log(`[metadata] homepage set to ${patch.body.homepage}`);

const topics = await api(`https://api.github.com/repos/${slug}/topics`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ names: TOPICS }),
});
if (topics.status !== 200) fail(`topics update failed: HTTP ${topics.status} ${JSON.stringify(topics.body)}`);
console.log(`[metadata] ${topics.body.names.length} topics set: ${topics.body.names.join(', ')}`);
console.log('[metadata] done — https://github.com/' + slug);
