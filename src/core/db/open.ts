import { DB_NAME } from '../version';
import { Store, type StoreName } from './schema';
import { applyMigrations, latestVersion } from './migrations';

/**
 * Database open + migration orchestration (FR-DATA-06).
 *
 * Failure semantics: if a version-change transaction aborts (migration threw),
 * IndexedDB keeps the database at the old version and all data intact. We
 * surface MigrationFailedError so callers stop writes and show an actionable
 * message. `blocked` (another connection holding the old version open) waits
 * with a timeout instead of hanging forever.
 */

export class DatabaseUnavailableError extends Error {
  constructor(detail: string) {
    super(`database unavailable: ${detail}`);
    this.name = 'DatabaseUnavailableError';
  }
}

export class MigrationFailedError extends Error {
  readonly fromVersion: number;
  readonly toVersion: number;
  constructor(fromVersion: number, toVersion: number, detail: string) {
    super(`migration from v${fromVersion} to v${toVersion} failed: ${detail}`);
    this.name = 'MigrationFailedError';
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
  }
}

export interface OpenOptions {
  /** Milliseconds to wait when the upgrade is blocked by another connection. */
  readonly blockedTimeoutMs?: number;
  /** Database name override (tests isolate per-file databases). */
  readonly name?: string;
}

export async function openDatabase(
  options: OpenOptions = {},
): Promise<IDBDatabase> {
  const name = options.name ?? DB_NAME;
  const blockedTimeoutMs = options.blockedTimeoutMs ?? 10_000;

  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, latestVersion());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(new DatabaseUnavailableError(detail));
      return;
    }

    let settled = false;
    const blockedTimer = setTimeout(() => {
      if (!settled) {
        request.onerror = null;
        try {
          request.transaction?.abort();
        } catch {
          /* transaction may not exist; ignore */
        }
        settled = true;
        reject(new DatabaseUnavailableError(`upgrade blocked for over ${blockedTimeoutMs} ms (close other tabs using the extension)`));
      }
    }, blockedTimeoutMs);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) {
        // Cannot happen for upgrade events, but fail safe.
        settled = true;
        clearTimeout(blockedTimer);
        reject(new MigrationFailedError(event.oldVersion, latestVersion(), 'no upgrade transaction'));
        return;
      }
      tx.onabort = () => {
        settled = true;
        clearTimeout(blockedTimer);
        const reason = tx.error instanceof Error ? tx.error.message : String(tx.error);
        reject(new MigrationFailedError(event.oldVersion, event.newVersion ?? latestVersion(), reason));
      };
      try {
        applyMigrations(db, tx, event.oldVersion, event.newVersion ?? latestVersion());
      } catch (error) {
        // applyMigrations throws inside the transaction; aborting rolls back.
        const detail = error instanceof Error ? error.message : String(error);
        settled = true;
        clearTimeout(blockedTimer);
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
        reject(new MigrationFailedError(event.oldVersion, event.newVersion ?? latestVersion(), detail));
      }
    };

    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(blockedTimer);
      const db = request.result;
      // Another context may request a future version upgrade; step aside.
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(blockedTimer);
      const detail = request.error instanceof Error ? request.error.message : String(request.error);
      reject(new DatabaseUnavailableError(detail));
    };

    request.onblocked = () => {
      // Timer above handles the timeout; nothing else to do while waiting.
    };
  });
}

/** Transaction helper with promise wrapper and store accessors. */
export function withStores(
  db: IDBDatabase,
  storeNames: readonly StoreName[],
  mode: IDBTransactionMode,
  work: (stores: Readonly<Record<string, IDBObjectStore>>, tx: IDBTransaction) => void | Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...storeNames], mode);
    const stores: Record<string, IDBObjectStore> = {};
    for (const name of storeNames) stores[name] = tx.objectStore(name);
    tx.onabort = () => {
      const reason = tx.error instanceof Error ? tx.error.message : String(tx.error);
      reject(new Error(`transaction aborted: ${reason}`));
    };
    tx.onerror = () => {
      const reason = tx.error instanceof Error ? tx.error.message : String(tx.error);
      reject(new Error(`transaction error: ${reason}`));
    };
    tx.oncomplete = () => resolve();
    const fail = (error: unknown): void => {
      try {
        tx.abort();
      } catch {
        /* already aborted */
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    let started: void | Promise<void>;
    try {
      started = work(stores as Readonly<Record<string, IDBObjectStore>>, tx);
    } catch (error) {
      fail(error);
      return;
    }
    void Promise.resolve(started).catch(fail);
  });
}

/** All canonical store names (for full-database transactions). */
export const ALL_STORES: readonly StoreName[] = Object.values(Store);
