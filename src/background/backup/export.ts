/**
 * Complete ZIP backup export (FR-DATA-03): every canonical record plus
 * blobs, hashes and a manifest with format/schema versions — produced with
 * the bundled open-source fflate library. Nothing is uploaded: the ZIP is
 * handed back as a Blob for a user-initiated download.
 *
 * Manifest carries a SHA-256 hash per file so restore can validate the
 * archive before touching the database (FR-DATA-04).
 */

import { zipSync } from 'fflate';
import { repo } from '../db';
import { Store } from '../../core/db/schema';
import { listBlobs } from '../../core/repo/blobs';
import { getSettings } from '../../core/repo/settings';
import { sha256Hex } from '../../core/util/hash';
import { nowUtc } from '../../core/util/time';
import { APP_VERSION, SCHEMA_VERSION } from '../../core/version';
import type { UtcTimestamp } from '../../core/types';

export const BACKUP_FORMAT = 'lnwa-backup';
export const BACKUP_VERSION = 1;

/** License/version report embedded in every archive (FR-DATA-03). */
export const LICENSE_REPORT = [
  `Local Notes & Web Archive for Chrome ${APP_VERSION} — backup archive`,
  `Extension license: MIT`,
  '',
  'Bundled open-source libraries in the shipped extension:',
  '- fflate 0.8.3 (MIT) — ZIP creation for this backup',
  '- MiniSearch 7.x (MIT) — local search index',
  '- DOMPurify 3.x (Apache-2.0/MIT) — HTML sanitization',
  '- marked 16.x (MIT) — Markdown import',
  '- turndown 7.x (MIT) — Markdown export',
  '- Tiptap 3.x (MIT) and ProseMirror (MIT) — editor',
  '- highlight.js 11.x (BSD-3-Clause) — code highlighting',
  'Full notices ship in THIRD_PARTY_NOTICES.md within the extension package.',
].join('\n');

interface JsonFile {
  readonly path: string;
  readonly data: unknown;
}

export interface BackupCounts {
  readonly notes: number;
  readonly tags: number;
  readonly categories: number;
  readonly links: number;
  readonly snapshots: number;
  readonly reminders: number;
  readonly revisions: number;
  readonly attachments: number;
  readonly blobs: number;
}

export interface BackupExportResult {
  readonly blob: Blob;
  readonly filename: string;
  readonly counts: BackupCounts;
  readonly exportedAt: UtcTimestamp;
}

/** Build the complete archive. Throws truthfully; never partial. */
export async function exportBackup(): Promise<BackupExportResult> {
  const ctx = await repo();
  const exportedAt = nowUtc();

  const [
    notes,
    tags,
    categories,
    noteTags,
    noteCategories,
    links,
    snapshots,
    reminders,
    revisions,
    attachments,
    blobs,
    settings,
  ] = await Promise.all([
    ctx.getAll<unknown>(Store.Notes),
    ctx.getAll<unknown>(Store.Tags),
    ctx.getAll<unknown>(Store.Categories),
    ctx.getAll<unknown>(Store.NoteTags),
    ctx.getAll<unknown>(Store.NoteCategories),
    ctx.getAll<unknown>(Store.Links),
    ctx.getAll<unknown>(Store.Snapshots),
    ctx.getAll<unknown>(Store.Reminders),
    ctx.getAll<unknown>(Store.Revisions),
    ctx.getAll<unknown>(Store.Attachments),
    listBlobs(ctx),
    getSettings(ctx),
  ]);

  const counts: BackupCounts = {
    notes: notes.length,
    tags: tags.length,
    categories: categories.length,
    links: links.length,
    snapshots: snapshots.length,
    reminders: reminders.length,
    revisions: revisions.length,
    attachments: attachments.length,
    blobs: blobs.length,
  };

  const jsonFiles: JsonFile[] = [
    { path: 'data/notes.json', data: notes },
    { path: 'data/tags.json', data: tags },
    { path: 'data/categories.json', data: categories },
    { path: 'data/note-tags.json', data: noteTags },
    { path: 'data/note-categories.json', data: noteCategories },
    { path: 'data/links.json', data: links },
    { path: 'data/snapshots.json', data: snapshots },
    { path: 'data/reminders.json', data: reminders },
    { path: 'data/revisions.json', data: revisions },
    { path: 'data/attachments.json', data: attachments },
    { path: 'data/settings.json', data: settings },
  ];

  const zipped: Record<string, Uint8Array> = {};
  const fileHashes: Record<string, { sha256: string; bytes: number }> = {};

  for (const file of jsonFiles) {
    const bytes = new TextEncoder().encode(JSON.stringify(file.data, null, 2));
    zipped[file.path] = bytes;
    fileHashes[file.path] = { sha256: await sha256Hex(bytes), bytes: bytes.byteLength };
  }

  for (const stored of blobs) {
    const path = `blobs/${stored.key}`;
    const bytes = new Uint8Array(await stored.data.arrayBuffer());
    zipped[path] = bytes;
    fileHashes[path] = { sha256: await sha256Hex(bytes), bytes: bytes.byteLength };
  }

  const report = new TextEncoder().encode(LICENSE_REPORT);
  zipped['LICENSE-REPORT.txt'] = report;
  fileHashes['LICENSE-REPORT.txt'] = {
    sha256: await sha256Hex(report),
    bytes: report.byteLength,
  };

  const manifest = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    counts,
    files: fileHashes,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  zipped['manifest.json'] = manifestBytes;

  const archive = zipSync(zipped, { level: 6 });
  const blob = new Blob([archive as unknown as BlobPart], { type: 'application/zip' });
  const date = exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  return {
    blob,
    filename: `local-notes-backup-${date}.zip`,
    counts,
    exportedAt,
  };
}
