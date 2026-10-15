import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import {
  newCorrelationId,
  RPC_KIND,
  type RpcRequest,
  type RpcResponse,
} from '../../../../src/background/protocol';
import { listAuditEvents } from '../../../../src/core/repo/audit';
import { setLinkSnapshot } from '../../../../src/core/repo/links';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId, Link, Note } from '../../../../src/core/types';

/**
 * T-020 links/detect-and-queue: the FR-CAP-01 policy (pasted URLs queue only
 * under the auto-capture setting; manual URLs are detected but never
 * auto-visited), the FR-CAP-04 gate interaction (ineligible URLs stay links,
 * non-http(s) ones are rejected), dedup without state downgrade, the
 * explicit queue-capture entry point and audited transitions.
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

async function fail(type: string, payload: unknown): Promise<RpcResponse> {
  const response = await call(type, payload);
  if (response.ok) throw new Error(`${type} unexpectedly succeeded`);
  return response;
}

async function seedNote(title: string): Promise<Note> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return result['note'] as Note;
}

interface DetectionResult {
  url: string;
  outcome: 'created' | 'existing' | 'rejected';
  reason?: string;
  captureEligible?: boolean;
  gateReason?: string;
  link?: Link;
}

async function detect(
  noteId: EntityId,
  urls: string[],
  source: 'paste' | 'manual',
): Promise<DetectionResult[]> {
  const result = (await ok('links/detect-and-queue', { noteId, urls, source })) as {
    results: DetectionResult[];
  };
  return result.results;
}

async function setAutoCapture(enabled: boolean): Promise<void> {
  await ok('settings/patch', { patch: { autoCaptureOnPaste: enabled } });
}

/** Pre-grant an origin in the chrome mock (queue-time access check, T-021). */
function grantOrigin(origin: string): void {
  installed.permissions.grantedPatterns.add(`${origin}/*`);
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

describe('links/detect-and-queue (FR-CAP-01 policy)', () => {
  it('queues pasted eligible URLs when auto-capture is enabled (default)', async () => {
    grantOrigin('https://example.com');
    const note = await seedNote('Queue note');
    const results = await detect(note.id, ['https://example.com/post/123'], 'paste');
    expect(results[0]!.outcome).toBe('created');
    expect(results[0]!.captureEligible).toBe(true);
    expect(results[0]!.link?.captureState).toBe('queued');
  });

  it('only detects pasted URLs when auto-capture is disabled', async () => {
    const note = await seedNote('No-queue note');
    await setAutoCapture(false);
    const results = await detect(note.id, ['https://example.com/a'], 'paste');
    expect(results[0]!.link?.captureState).toBe('detected');
  });

  it('never auto-visits manually typed URLs even with auto-capture on', async () => {
    const note = await seedNote('Manual note');
    const results = await detect(note.id, ['https://example.com/typed'], 'manual');
    expect(results[0]!.link?.captureState).toBe('detected');
  });

  it('keeps capture-ineligible http(s) URLs as links with the gate reason', async () => {
    grantOrigin('https://example.com');
    const note = await seedNote('Ineligible note');
    const results = await detect(
      note.id,
      ['http://localhost:8080/', 'https://10.0.0.1/x', 'https://example.com/ok'],
      'paste',
    );
    expect(results[0]!.outcome).toBe('created');
    expect(results[0]!.captureEligible).toBe(false);
    expect(results[0]!.gateReason).toBe('loopback-host');
    // Ineligible URLs are never queued — only detected.
    expect(results[0]!.link?.captureState).toBe('detected');
    expect(results[1]!.gateReason).toBe('private-network');
    expect(results[2]!.link?.captureState).toBe('queued');
  });

  it('rejects non-http(s) and credential-bearing URLs outright', async () => {
    const note = await seedNote('Reject note');
    const results = await detect(
      note.id,
      ['javascript:alert(1)', 'ftp://example.com/', 'not a url', 'https://user:pass@example.com/'],
      'paste',
    );
    expect(results.map((r) => r.outcome)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect(results[3]!.reason).toBe('credentials-in-url');
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    expect(links).toHaveLength(0);
  });

  it('deduplicates and never downgrades queue progress', async () => {
    grantOrigin('https://example.com');
    const note = await seedNote('Dedup note');
    await detect(note.id, ['https://example.com/dup'], 'paste');
    // Second paste with auto-capture OFF: existing queued link stays queued.
    await setAutoCapture(false);
    const results = await detect(note.id, ['https://example.com/dup'], 'paste');
    expect(results[0]!.outcome).toBe('existing');
    expect(results[0]!.link?.captureState).toBe('queued');
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    expect(links).toHaveLength(1);
  });

  it('rejects unknown notes and oversized URL batches', async () => {
    const { newId } = await import('../../../../src/core/util/ids');
    const missing = await fail('links/detect-and-queue', {
      noteId: newId(),
      urls: ['https://example.com/'],
      source: 'paste',
    });
    if (!missing.ok) expect(missing.error.code).toBe('not-found');

    const note = await seedNote('Bound note');
    const many = Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`);
    const bounded = await fail('links/detect-and-queue', {
      noteId: note.id,
      urls: many,
      source: 'paste',
    });
    if (!bounded.ok) expect(bounded.error.code).toBe('invalid-request');
  });

  it('records audited detection summaries with counts only', async () => {
    grantOrigin('https://example.com');
    const note = await seedNote('Audit note');
    await detect(note.id, ['https://example.com/audited', 'javascript:x'], 'paste');
    const events = await listAuditEvents(await repo(), { limit: 20 });
    const event = events.find((e) => e.action === 'links/detect-and-queue');
    expect(event).toBeDefined();
    expect(event!.detail).toContain('source=paste');
    expect(event!.detail).toContain('queued=1');
    expect(event!.detail).toContain('rejected=1');
  });
});

describe('links/queue-capture and state transitions', () => {
  it('queues an existing detected link on explicit user request', async () => {
    grantOrigin('https://example.com');
    const note = await seedNote('Explicit note');
    await setAutoCapture(false);
    await detect(note.id, ['https://example.com/want-it'], 'paste');
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    expect(links[0]!.captureState).toBe('detected');

    const result = (await ok('links/queue-capture', { linkId: links[0]!.id })) as { link: Link };
    expect(result.link.captureState).toBe('queued');
  });

  it('refuses to queue capture-ineligible URLs with the gate reason', async () => {
    const note = await seedNote('Refuse note');
    await detect(note.id, ['http://127.0.0.1:9000/'], 'paste');
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    const response = await fail('links/queue-capture', { linkId: links[0]!.id });
    if (!response.ok) {
      expect(response.error.code).toBe('invalid-request');
      expect(response.error.message).toContain('loopback-host');
    }
    // The link record itself survives — only the queue request failed.
    const after = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    expect(after.links[0]!.captureState).toBe('detected');
  });

  it('reports unknown links as not-found', async () => {
    const { newId } = await import('../../../../src/core/util/ids');
    const response = await fail('links/queue-capture', { linkId: newId() });
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('transitions state explicitly and snapshot association derives captured', async () => {
    const note = await seedNote('Transition note');
    await detect(note.id, ['https://example.com/transitions'], 'paste');
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    const link = links[0]!;

    const cancelled = (await ok('links/set-capture-state', {
      linkId: link.id,
      captureState: 'failed',
    })) as { link: Link };
    expect(cancelled.link.captureState).toBe('failed');

    // A snapshot association flips the derived state to captured.
    const snapshotId = (
      await import('../../../../src/core/util/ids')
    ).newId();
    await setLinkSnapshot(await repo(), link.id, snapshotId);
    const refreshed = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    expect(refreshed.links[0]!.captureState).toBe('captured');
    expect(refreshed.links[0]!.snapshotId).toBe(snapshotId);
  });

  it('normalises legacy link records written before captureState existed', async () => {
    const note = await seedNote('Legacy note');
    const { createLink } = await import('../../../../src/core/repo/links');
    const { Store } = await import('../../../../src/core/db/schema');
    const ctx = await repo();
    const { link: modern } = await createLink(ctx, note.id, 'https://example.com/legacy', '');
    const legacyRecord = { ...modern } as Record<string, unknown>;
    delete legacyRecord.captureState;
    // Overwrite the record without the T-020 field, exactly as an old
    // database row would look after the upgrade.
    await ctx.transaction([Store.Links], 'readwrite', (stores) => {
      stores[Store.Links]?.put(legacyRecord);
    });
    const { links } = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
    const restored = links.find((l) => l.originalUrl.includes('legacy'));
    expect(restored?.captureState).toBe('detected');
  });
});
