import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, withStores, DatabaseUnavailableError, MigrationFailedError } from '../../../src/core/db/open';
import { SCHEMA_V1, Store, DB_VERSION } from '../../../src/core/db/schema';
import { latestVersion, MIGRATIONS, type Migration } from '../../../src/core/db/migrations';
import { newId } from '../../../src/core/util/ids';

/**
 * T-006 validation (fake-indexeddb): fresh schema creation, index layout,
 * reopen stability, versionchange step-aside, and the critical migration
 * rollback invariant (FR-DATA-06: failed migration preserves all data).
 */

const dbs: IDBDatabase[] = [];

async function openFresh(): Promise<IDBDatabase> {
  const db = await openDatabase({ name: `test-${newId()}` });
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
});

function listStores(db: IDBDatabase): string[] {
  return Array.from(db.objectStoreNames).sort();
}

function storeSpec(name: string) {
  return SCHEMA_V1.find((s) => s.name === name);
}

describe('database open and schema', () => {
  it('creates every canonical store with key paths and indexes', async () => {
    const db = await openFresh();
    expect(db.version).toBe(DB_VERSION);
    expect(latestVersion()).toBe(DB_VERSION);
    const stores = listStores(db);
    for (const spec of SCHEMA_V1) {
      expect(stores, `store ${spec.name}`).toContain(spec.name);
    }
    expect(stores).toHaveLength(SCHEMA_V1.length);
    const tx = db.transaction([Store.Tags], 'readonly');
    const tags = tx.objectStore(Store.Tags);
    expect(Array.from(tags.indexNames).sort()).toEqual(['normalizedKey']);
    const notes = db.transaction([Store.Notes], 'readonly').objectStore(Store.Notes);
    expect(Array.from(notes.indexNames).sort()).toEqual([
      'createdAt',
      'favorite',
      'pinned',
      'state',
      'state_updated',
      'updatedAt',
    ]);
    const noteTags = db.transaction([Store.NoteTags], 'readonly').objectStore(Store.NoteTags);
    expect(noteTags.keyPath).toEqual(['noteId', 'tagId']);
    const settings = db.transaction([Store.Settings], 'readonly').objectStore(Store.Settings);
    expect(settings.keyPath).toBe('key');
  });

  it('reopens at the same version without re-migrating', async () => {
    const first = await openFresh();
    const name = first.name;
    first.close();
    const second = await openDatabase({ name });
    dbs.push(second);
    expect(second.version).toBe(DB_VERSION);
    expect(listStores(second)).toHaveLength(SCHEMA_V1.length);
  });

  it('writes and reads records transactionally', async () => {
    const db = await openFresh();
    const noteId = newId();
    await withStores(db, [Store.Notes], 'readwrite', (stores) => {
      stores[Store.Notes]?.put({
        id: noteId,
        title: 'Hello',
        state: 'active',
        updatedAt: '2026-10-12T08:00:00.000Z',
      });
    });
    const read = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction([Store.Notes], 'readonly').objectStore(Store.Notes).get(noteId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(read).toMatchObject({ id: noteId, title: 'Hello' });
  });

  it('rolls back the whole transaction when work throws', async () => {
    const db = await openFresh();
    const noteId = newId();
    await expect(
      withStores(db, [Store.Notes], 'readwrite', (stores) => {
        stores[Store.Notes]?.put({ id: noteId, title: 'doomed' });
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');
    const count = await new Promise<number>((resolve, reject) => {
      const req = db.transaction([Store.Notes], 'readonly').objectStore(Store.Notes).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(count).toBe(0);
  });

  it('closes the old connection on versionchange (step aside)', async () => {
    const first = await openFresh();
    const name = first.name;
    const closed = new Promise<void>((resolve) => {
      first.onversionchange = () => {
        first.close();
        resolve();
      };
    });
    // A second context requesting a higher version triggers versionchange.
    const higher = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION + 1);
      req.onupgradeneeded = () => {
        // No store changes; the version bump alone triggers versionchange.
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbs.push(higher);
    await expect(closed).resolves.toBeUndefined();
  });

  it('rejects with DatabaseUnavailableError when opening a lower version', async () => {
    const db = await openFresh();
    const name = db.name;
    db.close();
    // The database now exists at DB_VERSION; requesting a lower version fails.
    await expect(openDatabase({ name })).resolves.toBeInstanceOf(IDBDatabase);
    const lower = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open(name, DB_VERSION + 5);
      req.onupgradeneeded = () => {
        /* create nothing — just bump version */
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        throw req.error ?? new Error('unexpected open error');
      };
    }).then((upgraded) => {
      dbs.push(upgraded);
      return upgraded;
    });
    expect(lower.version).toBe(DB_VERSION + 5);
    // Now the canonical open (lower version) must fail cleanly.
    await expect(openDatabase({ name })).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it('failed migration aborts, preserves data, and reports MigrationFailedError', async () => {
    // Arrange: a database at v1 with one record.
    const name = `rollback-${newId()}`;
    const seeded = await openDatabase({ name });
    const noteId = newId();
    await withStores(seeded, [Store.Notes], 'readwrite', (stores) => {
      stores[Store.Notes]?.put({ id: noteId, title: 'precious', state: 'active' });
    });
    seeded.close();

    // Act: register a broken v2 migration (simulates a defective future build).
    const broken: Migration = {
      toVersion: latestVersion() + 1,
      description: 'test: always fails',
      apply: () => {
        throw new Error('intentional test failure');
      },
    };
    (MIGRATIONS as unknown as Migration[]).push(broken);
    try {
      await expect(openDatabase({ name })).rejects.toBeInstanceOf(MigrationFailedError);
    } finally {
      (MIGRATIONS as unknown as Migration[]).pop();
    }

    // Assert: database still at v1, record intact (rollback preserved data).
    const survivor = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbs.push(survivor);
    expect(survivor.version).toBe(DB_VERSION);
    const record = await new Promise<unknown>((resolve, reject) => {
      const req = survivor.transaction([Store.Notes], 'readonly').objectStore(Store.Notes).get(noteId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(record).toMatchObject({ id: noteId, title: 'precious' });
  });

  it('schema spec is self-consistent', () => {
    for (const spec of SCHEMA_V1) {
      expect(spec.name.length).toBeGreaterThan(0);
      for (const index of spec.indexes) {
        expect(index.name.length).toBeGreaterThan(0);
      }
    }
    const names = SCHEMA_V1.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(storeSpec(Store.Blobs)?.keyPath).toBe('key');
  });
});
