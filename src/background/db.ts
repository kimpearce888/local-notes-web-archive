/**
 * Worker-scoped resource access. The service worker is stateless by design
 * (PRD §8.1): IndexedDB is the only durable store, and these module-level
 * promises are derived caches — dropped whenever the worker is suspended and
 * rebuilt from durable state on the next request.
 */

import { openDatabase } from '../core/db/open';
import { RepoContext } from '../core/repo/context';
import { SearchEngine } from '../core/search/engine';

let dbPromise: Promise<IDBDatabase> | null = null;
let enginePromise: Promise<SearchEngine> | null = null;

/** Open (and cache) the canonical database. Failures clear the cache so the
 * next request retries honestly instead of caching a rejection forever. */
export function openAppDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Repository context bound to the cached database connection. */
export async function repo(): Promise<RepoContext> {
  return new RepoContext(await openAppDatabase());
}

/** Loaded search engine (index loaded from IndexedDB or rebuilt). */
export function searchEngine(): Promise<SearchEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const engine = new SearchEngine(await repo());
      await engine.load();
      return engine;
    })().catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

/**
 * Close cached resources. Production code never needs this (the worker is
 * torn down wholesale on suspension); it exists so tests and future import
 * flows can release the connection deterministically before destructive
 * operations such as restore-replace (T-034).
 */
export async function closeWorkerResources(): Promise<void> {
  enginePromise = null;
  const pending = dbPromise;
  dbPromise = null;
  if (pending) {
    try {
      const db = await pending;
      db.close();
    } catch {
      // A failed open has nothing to close.
    }
  }
}
