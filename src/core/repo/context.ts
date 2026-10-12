import { Store, type StoreName } from '../db/schema';
import { withStores } from '../db/open';

/**
 * Repository context: wraps an open database connection with typed request
 * helpers. All repository methods run inside IndexedDB transactions so that
 * multi-record invariants hold atomically (PRD §6: no note is reported saved
 * until its transaction commits).
 */
export class RepoContext {
  constructor(readonly db: IDBDatabase) {}

  transaction(
    storeNames: readonly StoreName[],
    mode: IDBTransactionMode,
    work: (stores: Readonly<Record<string, IDBObjectStore>>, tx: IDBTransaction) => void | Promise<void>,
  ): Promise<void> {
    return withStores(this.db, storeNames, mode, work);
  }

  /** Read one record by key from a single store (null when missing). */
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction([store], 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error(`get from ${store} failed`));
    });
  }

  /** Read all records from a single store. */
  getAll<T>(store: StoreName): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction([store], 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error(`getAll from ${store} failed`));
    });
  }

  /** Read records by index key. */
  getByIndex<T>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const objectStore = this.db.transaction([store], 'readonly').objectStore(store);
      const idx = objectStore.index(index);
      const req = idx.getAll(key);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error(`index get ${store}.${index} failed`));
    });
  }

  count(store: StoreName): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction([store], 'readonly').objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error(`count ${store} failed`));
    });
  }
}

export const STORES = Store;
