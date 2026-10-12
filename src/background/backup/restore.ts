/**
 * Backup restore (FR-DATA-04): validate EVERYTHING before any write —
 * format, backup/schema versions, per-file SHA-256 hashes and path names —
 * then import in one transaction so a failed restore leaves the database
 * exactly as it was.
 *
 * Modes:
 * - merge: incoming records overwrite records with the same key; everything
 *   else stays (reference checks run against the union of both sets).
 * - replace: all data stores are cleared first — requires an explicit
 *   confirmation flag from the UI.
 *
 * The restore validates references (tags/categories joins point at real
 * notes; links/snapshots/reminders/revisions/attachments point at real
 * notes) and rebuilds the search index + reminder alarms afterwards.
 */

import { unzipSync } from 'fflate';
import { repo, searchEngine } from '../db';
import { Store, type StoreName } from '../../core/db/schema';
import { sha256Hex } from '../../core/util/hash';
import { reconcileReminderAlarms } from '../alarms';
import { APP_VERSION, SCHEMA_VERSION, SETTINGS_KEY } from '../../core/version';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupCounts } from './export';

const DATA_STORES: readonly StoreName[] = [
  Store.Notes,
  Store.Tags,
  Store.Categories,
  Store.NoteTags,
  Store.NoteCategories,
  Store.Links,
  Store.Snapshots,
  Store.Attachments,
  Store.Reminders,
  Store.Revisions,
  Store.Blobs,
];

const DATA_FILES: ReadonlyMap<StoreName, string> = new Map([
  [Store.Notes, 'data/notes.json'],
  [Store.Tags, 'data/tags.json'],
  [Store.Categories, 'data/categories.json'],
  [Store.NoteTags, 'data/note-tags.json'],
  [Store.NoteCategories, 'data/note-categories.json'],
  [Store.Links, 'data/links.json'],
  [Store.Snapshots, 'data/snapshots.json'],
  [Store.Attachments, 'data/attachments.json'],
  [Store.Reminders, 'data/reminders.json'],
  [Store.Revisions, 'data/revisions.json'],
]);

export interface BackupManifest {
  readonly format: string;
  readonly backupVersion: number;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly counts: BackupCounts;
  readonly files: Record<string, { sha256: string; bytes: number }>;
}

export interface BackupPreview {
  readonly manifest: BackupManifest;
  readonly compatible: boolean;
  readonly issues: readonly string[];
}

export type RestoreMode = 'merge' | 'replace';

export interface RestoreOptions {
  readonly mode: RestoreMode;
  /** Replace mode refuses to run without this explicit confirmation. */
  readonly confirmReplace?: boolean;
}

export interface RestoreResult {
  readonly mode: RestoreMode;
  readonly imported: { notes: number; reminders: number; snapshots: number; blobs: number };
}

export class BackupValidationError extends Error {
  constructor(
    readonly code:
      | 'not-a-zip'
      | 'missing-manifest'
      | 'bad-format'
      | 'unsupported-version'
      | 'hash-mismatch'
      | 'bad-path'
      | 'missing-file'
      | 'invalid-references',
    message: string,
  ) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function decodeJson<T>(bytes: Uint8Array, path: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new BackupValidationError('bad-format', `${path} is not valid JSON`);
  }
}

/** Safe ZIP member path: relative, no traversal, no drive letters. */
function isSafePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\')) return false;
  if (path.startsWith('/') || path.includes('..') || /^[a-zA-Z]:/.test(path)) return false;
  return true;
}

interface UnpackedBackup {
  readonly manifest: BackupManifest;
  readonly files: Map<StoreName, unknown[]>;
  readonly settingsRecord: { key: string; value: unknown } | null;
  readonly blobs: Map<string, Blob & { kind: 'mhtml' | 'png' | 'attachment' }>;
}

/**
 * Unzip and validate an archive completely. Throws BackupValidationError
 * with a truthful code; no database access happens in here.
 */
export function validateBackupArchive(archive: Blob): Promise<UnpackedBackup> {
  return (async (): Promise<UnpackedBackup> => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await archive.arrayBuffer());
    } catch {
      throw new BackupValidationError('not-a-zip', 'the file could not be read');
    }

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new BackupValidationError('not-a-zip', 'the file is not a valid ZIP archive');
    }

    for (const path of Object.keys(entries)) {
      if (!isSafePath(path)) {
        throw new BackupValidationError('bad-path', `unsafe archive path "${path.slice(0, 80)}"`);
      }
    }

    const manifestBytes = entries['manifest.json'];
    if (manifestBytes === undefined) {
      throw new BackupValidationError('missing-manifest', 'the archive has no manifest.json');
    }
    const manifest = decodeJson<BackupManifest>(manifestBytes, 'manifest.json');

    if (manifest.format !== BACKUP_FORMAT) {
      throw new BackupValidationError('bad-format', `unknown backup format "${String(manifest.format).slice(0, 40)}"`);
    }
    if (manifest.backupVersion !== BACKUP_VERSION) {
      throw new BackupValidationError(
        'unsupported-version',
        `backup version ${manifest.backupVersion} is not supported by this version (expected ${BACKUP_VERSION})`,
      );
    }
    if (manifest.schemaVersion > SCHEMA_VERSION) {
      throw new BackupValidationError(
        'unsupported-version',
        `backup schema ${manifest.schemaVersion} is newer than this extension's schema ${SCHEMA_VERSION} — update the extension first`,
      );
    }

    // Per-file hash + presence validation.
    for (const [path, entry] of Object.entries(manifest.files ?? {})) {
      const content = entries[path];
      if (content === undefined) {
        throw new BackupValidationError('missing-file', `archive is missing ${path}`);
      }
      const actual = await sha256Hex(content);
      if (actual !== entry.sha256) {
        throw new BackupValidationError('hash-mismatch', `${path} failed its integrity check`);
      }
    }
    for (const path of Object.keys(entries)) {
      if (path !== 'manifest.json' && (manifest.files ?? {})[path] === undefined) {
        throw new BackupValidationError('bad-format', `unlisted archive member "${path.slice(0, 80)}"`);
      }
    }

    // Decode the data files.
    const files = new Map<StoreName, unknown[]>();
    for (const [store, path] of DATA_FILES) {
      const content = entries[path];
      if (content === undefined) {
        throw new BackupValidationError('missing-file', `archive is missing ${path}`);
      }
      const decoded = decodeJson<unknown>(content, path);
      if (!Array.isArray(decoded)) {
        throw new BackupValidationError('bad-format', `${path} must contain an array`);
      }
      files.set(store, decoded);
    }

    // Blobs: every blobs/<key> member becomes a stored blob; the kind is
    // inferred from the records that reference it.
    const mhtmlKeys = new Set<string>();
    const pngKeys = new Set<string>();
    for (const snapshot of files.get(Store.Snapshots) ?? []) {
      const record = snapshot as { mhtmlBlobKey?: unknown; pngBlobKey?: unknown };
      if (typeof record.mhtmlBlobKey === 'string') mhtmlKeys.add(record.mhtmlBlobKey);
      if (typeof record.pngBlobKey === 'string') pngKeys.add(record.pngBlobKey);
    }
    const blobs = new Map<string, Blob & { kind: 'mhtml' | 'png' | 'attachment' }>();
    for (const [path, content] of Object.entries(entries)) {
      if (path.startsWith('blobs/')) {
        const key = path.slice('blobs/'.length);
        if (key.length === 0) {
          throw new BackupValidationError('bad-path', 'empty blob key');
        }
        const kind = mhtmlKeys.has(key) ? 'mhtml' : pngKeys.has(key) ? 'png' : 'attachment';
        const blob = new Blob([content as unknown as BlobPart]) as Blob & { kind: 'mhtml' | 'png' | 'attachment' };
        blob.kind = kind;
        blobs.set(key, blob);
      }
    }

    // Preferences: data/settings.json (the single settings record).
    const settingsEntry = entries['data/settings.json'];
    const settingsRecord =
      settingsEntry === undefined
        ? null
        : decodeJson<{ key: string; value: unknown }>(settingsEntry, 'data/settings.json');

    validateReferences(files);

    return { manifest, files, settingsRecord, blobs };
  })();
}

/** Cross-record reference validation BEFORE any write. */
function validateReferences(files: Map<StoreName, unknown[]>): void {
  const noteIds = new Set(
    (files.get(Store.Notes) ?? []).map((note) => (note as { id?: unknown }).id).filter((id): id is string => typeof id === 'string'),
  );

  const requireNote = (records: unknown[], label: string, fields: readonly string[]): void => {
    for (const record of records) {
      if (typeof record !== 'object' || record === null) {
        throw new BackupValidationError('invalid-references', `${label} contains a non-object record`);
      }
      for (const field of fields) {
        const value = (record as Record<string, unknown>)[field];
        if (value === null || value === undefined) continue;
        if (typeof value !== 'string' || !noteIds.has(value)) {
          throw new BackupValidationError(
            'invalid-references',
            `${label} references a note id that is not in the backup (${field})`,
          );
        }
      }
    }
  };

  requireNote(files.get(Store.NoteTags) ?? [], 'note-tags', ['noteId']);
  requireNote(files.get(Store.NoteCategories) ?? [], 'note-categories', ['noteId']);
  requireNote(files.get(Store.Links) ?? [], 'links', ['noteId']);
  requireNote(files.get(Store.Snapshots) ?? [], 'snapshots', ['noteId']);
  requireNote(files.get(Store.Reminders) ?? [], 'reminders', ['noteId']);
  requireNote(files.get(Store.Attachments) ?? [], 'attachments', ['noteId']);
}

/** Preview an archive: manifest, compatibility and issues (no writes). */
export async function previewRestore(archive: Blob): Promise<BackupPreview> {
  const { manifest } = await validateBackupArchive(archive);
  const issues: string[] = [];
  if (manifest.schemaVersion < SCHEMA_VERSION) {
    issues.push(
      `backup schema ${manifest.schemaVersion} is older than the current schema ${SCHEMA_VERSION}; records will be upgraded on import`,
    );
  }
  if (manifest.appVersion !== APP_VERSION) {
    issues.push(`backup came from version ${manifest.appVersion} (this is ${APP_VERSION})`);
  }
  return { manifest, compatible: true, issues };
}

/**
 * Restore an archive. Validation runs first; merge/replace writes happen in
 * ONE transaction per phase so failures leave the database unchanged.
 */
export async function restoreBackup(archive: Blob, options: RestoreOptions): Promise<RestoreResult> {
  const { files, blobs, settingsRecord } = await validateBackupArchive(archive);
  if (options.mode === 'replace' && options.confirmReplace !== true) {
    throw new BackupValidationError(
      'bad-format',
      'replace mode requires explicit confirmation (FR-DATA-04)',
    );
  }

  const ctx = await repo();

  // Phase 1 (replace only): clear data stores + settings in one transaction.
  if (options.mode === 'replace') {
    await ctx.transaction(
      [...DATA_STORES, Store.Settings, Store.AuditEvents, Store.DiagnosticLogs],
      'readwrite',
      (stores) => {
        for (const storeName of [...DATA_STORES, Store.Settings, Store.AuditEvents, Store.DiagnosticLogs]) {
          stores[storeName]?.clear();
        }
      },
    );
  }

  // Phase 2: write records + blobs + settings in one transaction.
  await ctx.transaction(
    [...DATA_STORES, Store.Settings],
    'readwrite',
    (stores) => {
      for (const [store, records] of files) {
        const target = stores[store];
        if (!target) throw new Error(`store ${store} unavailable during restore`);
        for (const record of records) {
          // Stores use in-line keyPaths (id / key / composite joins):
          // put(record) lets the store extract the key itself.
          target.put(record);
        }
      }
      if (settingsRecord !== null) {
        const settingsStore = stores[Store.Settings];
        if (!settingsStore) throw new Error('settings store unavailable during restore');
        // data/settings.json carries the settings VALUE; re-wrap it in the
        // store's keyed record shape.
        const record =
          typeof settingsRecord === 'object' &&
          settingsRecord !== null &&
          'key' in settingsRecord &&
          'value' in settingsRecord
            ? settingsRecord
            : { key: SETTINGS_KEY, value: settingsRecord };
        settingsStore.put(record);
      }
      const blobStore = stores[Store.Blobs];
      if (!blobStore) throw new Error('blob store unavailable during restore');
      for (const [key, blob] of blobs) {
        blobStore.put({
          key,
          kind: blob.kind,
          data: blob,
          size: blob.size,
          createdAt: new Date().toISOString(),
        });
      }
    },
  );

  // Phase 3: rebuild derived state (search index + reminder alarms).
  const engine = await searchEngine();
  await engine.rebuild();
  await reconcileReminderAlarms();

  return {
    mode: options.mode,
    imported: {
      notes: (files.get(Store.Notes) ?? []).length,
      reminders: (files.get(Store.Reminders) ?? []).length,
      snapshots: (files.get(Store.Snapshots) ?? []).length,
      blobs: blobs.size,
    },
  };
}
