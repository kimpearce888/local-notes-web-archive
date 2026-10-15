import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { readStorageHealth, requestPersistence } from '../../../../src/background/api/storage-health';
import { createSnapshot, saveMhtmlArtifact, savePngArtifact } from '../../../../src/core/repo/snapshots';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId, Note } from '../../../../src/core/types';

/**
 * T-036 storage health (FR-DATA-02/07): per-kind size reporting (archives,
 * screenshots, attachments), counts, persistence request, honest quota
 * reporting and the explicit data-loss warning text.
 */

let router: MessageRouter;
let installed: InstalledMock;

function call(type: string, payload: unknown): Promise<RpcResponse> {
  const request: RpcRequest = { kind: RPC_KIND, id: newCorrelationId(), type, payload };
  return router.dispatch(request);
}

async function ok(type: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await call(type, payload);
  if (!response.ok) {
    throw new Error(`${type} failed: ${response.error.code} ${response.error.message}`);
  }
  return response.result as Record<string, unknown>;
}

beforeEach(() => {
  installed = installChromeMock();
  router = new MessageRouter();
  registerAllApi(router);
});

afterEach(async () => {
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  installed.uninstall();
});

describe('readStorageHealth', () => {
  it('reports per-kind blob bytes, counts and no false warning when empty', async () => {
    const report = await readStorageHealth();
    expect(report.blobKinds).toEqual({ mhtml: 0, png: 0, attachments: 0 });
    expect(report.blobBytesTotal).toBe(0);
    expect(report.counts.notes).toBe(0);
    expect(report.logEntries).toBe(0);
    expect(report.warning.active).toBe(false);
    // Node has no navigator.storage: quota/persisted report as null (honest).
    expect(report.quota).toBeNull();
    expect(report.persisted).toBeNull();
  });

  it('classifies blob bytes by kind (mhtml archives vs png screenshots)', async () => {
    const note = (await ok('notes/create', { title: 'health', plainText: 'x' }))['note'] as Note;
    const link = (await ok('links/create', { noteId: note.id, url: 'https://example.com/health' }))['link'] as {
      id: EntityId;
    };
    const ctx = await repo();
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: link.id,
      sourceUrl: 'https://example.com/health',
      finalUrl: 'https://example.com/health',
      title: 'health page',
    });
    await saveMhtmlArtifact(ctx, snapshot.id, new Blob([new Uint8Array(1000)]));
    await savePngArtifact(ctx, snapshot.id, new Blob([new Uint8Array(2000)]));

    const report = await readStorageHealth();
    expect(report.blobKinds.mhtml).toBeGreaterThanOrEqual(1000);
    expect(report.blobKinds.png).toBeGreaterThanOrEqual(2000);
    expect(report.blobBytesTotal).toBeGreaterThanOrEqual(3000);
    expect(report.counts.notes).toBe(1);
    expect(report.counts.snapshots).toBe(1);
  });

  it('fires the warning when quota usage crosses 90%', async () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          estimate: async () => ({ usage: 95, quota: 100 }),
          persisted: async () => false,
        },
      },
      configurable: true,
    });
    try {
      const report = await readStorageHealth();
      expect(report.quota).toEqual({ usage: 95, quota: 100 });
      expect(report.persisted).toBe(false);
      expect(report.warning.active).toBe(true);
      expect(report.warning.detail).toContain('95%');
      expect(report.warning.detail).toContain('backup');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });
});

describe('requestPersistence (FR-DATA-02)', () => {
  it('reports unsupported environments honestly', async () => {
    const result = await requestPersistence();
    expect(result.requested).toBe(false);
    expect(result.persisted).toBeNull();
  });

  it('requests persistence where the API exists', async () => {
    const original = globalThis.navigator;
    let persistCalled = false;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          persist: async () => {
            persistCalled = true;
            return true;
          },
        },
      },
      configurable: true,
    });
    try {
      const result = await requestPersistence();
      expect(persistCalled).toBe(true);
      expect(result.requested).toBe(true);
      expect(result.persisted).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
    }
  });
});

describe('RPCs and the data-loss warning (FR-DATA-07)', () => {
  it('serves health and warning through the router', async () => {
    const health = await ok('storage/health', {});
    expect((health['report'] as { counts: { notes: number } }).counts).toBeDefined();
    const warning = await ok('storage/data-loss-warning', {});
    const text = warning['warning'] as string;
    expect(text).toContain('Uninstalling');
    expect(text).toContain('no cloud copy');
    expect(text).toContain('backup');
    // Manifest already requests unlimitedStorage (verified in T-013 tests).
  });

  it('request-persistence RPC reports the environment', async () => {
    const result = await ok('storage/request-persistence', {});
    expect(result['requested']).toBe(false);
    expect(result['persisted']).toBeNull();
  });
});
