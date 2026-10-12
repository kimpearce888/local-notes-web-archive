import { LINKS_ORIGIN_INDEX, SCHEMA_V1, Store, type StoreSpec } from './schema';

/**
 * Versioned, idempotent migrations (FR-DATA-06).
 *
 * Rules:
 *  - Each migration step runs exactly once, inside the version-change
 *    transaction provided by IndexedDB; a failure aborts the transaction,
 *    leaving the database at its previous version with data preserved.
 *  - Migrations must be idempotent per step (createStore checks existence).
 *  - The open layer converts aborts into a MigrationFailedError and stops
 *    writes; the UI surfaces an actionable message (see diagnostics task).
 */

export interface MigrationContext {
  readonly db: IDBDatabase;
  readonly transaction: IDBTransaction;
}

export interface Migration {
  /** Target version this migration brings the database to. */
  readonly toVersion: number;
  readonly description: string;
  readonly apply: (context: MigrationContext) => void;
}

function ensureStore(context: MigrationContext, spec: StoreSpec): void {
  const { db } = context;
  if (db.objectStoreNames.contains(spec.name)) return; // idempotent
  const store = db.createObjectStore(spec.name, {
    keyPath: spec.keyPath as string | string[],
  });
  for (const index of spec.indexes) {
    store.createIndex(index.name, index.keyPath as string | string[], {
      unique: index.unique ?? false,
    });
  }
}

/** v1: initial canonical schema. */
const migrationV1: Migration = {
  toVersion: 1,
  description: 'initial schema: notes, tags, categories, links, snapshots, attachments, reminders, revisions, audit, logs, settings, blobs, search meta',
  apply: (context) => {
    for (const spec of SCHEMA_V1) ensureStore(context, spec);
  },
};

/**
 * v2: `links.origin` index — per-origin permission bookkeeping so revoking
 * an origin's site access (FR-CAP-02/FR-SET-03) resolves every affected link
 * through the index instead of a full scan. Idempotent per step.
 */
const migrationV2: Migration = {
  toVersion: 2,
  description: 'links.origin index for per-origin permission bookkeeping (FR-CAP-02)',
  apply: (context) => {
    const { db, transaction } = context;
    if (!db.objectStoreNames.contains(Store.Links)) {
      // v1 creates the store; a v2 upgrade on a database without it is corrupt.
      throw new Error('links store missing before v2 migration');
    }
    const store = transaction.objectStore(Store.Links);
    if (!store.indexNames.contains(LINKS_ORIGIN_INDEX.name)) {
      store.createIndex(LINKS_ORIGIN_INDEX.name, LINKS_ORIGIN_INDEX.keyPath as string, {
        unique: false,
      });
    }
  },
};

/**
 * Registered migrations, ascending. Future schema changes append here —
 * existing entries are immutable once released.
 */
export const MIGRATIONS: readonly Migration[] = [migrationV1, migrationV2];

export function migrationsUpTo(version: number): readonly Migration[] {
  return MIGRATIONS.filter((m) => m.toVersion <= version);
}

/** Highest supported schema version (max registered migration target). */
export function latestVersion(): number {
  return MIGRATIONS.reduce((max, m) => Math.max(max, m.toVersion), 0);
}

/**
 * Apply pending migrations for a version-change event. Throws inside the
 * upgrade transaction on failure so IndexedDB aborts and preserves data.
 */
export function applyMigrations(
  db: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
): void {
  const target = newVersion ?? latestVersion();
  const pending = migrationsUpTo(target).filter((m) => m.toVersion > oldVersion);
  for (const migration of pending) {
    try {
      migration.apply({ db, transaction });
    } catch (error) {
      // Re-throw with context; the aborted transaction rolls everything back.
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`migration to v${migration.toVersion} failed: ${detail}`, {
        cause: error,
      });
    }
  }
}
