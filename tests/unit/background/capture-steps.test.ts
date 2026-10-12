import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { getCaptureQueue, resetCapturePipeline } from '../../../src/background/capture/pipeline';
import { handleWorkerStartup, resetWorkerStartupGuard } from '../../../src/background/lifecycle';
import { createLink, getLink, listLinksByDedupKey } from '../../../src/core/repo/links';
import { dedupKey } from '../../../src/core/util/urls';
import { getSnapshot, listLinkSnapshots } from '../../../src/core/repo/snapshots';
import { getBlob } from '../../../src/core/repo/blobs';
import { getSettings, patchSettings } from '../../../src/core/repo/settings';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { newId } from '../../../src/core/util/ids';
import { setLinkCaptureState } from '../../../src/core/repo/links';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Link, Note, Snapshot } from '../../../src/core/types';

/**
 * T-023 MHTML capture and snapshot persistence (FR-CAP-05/07/08): the
 * production artifact steps behind the real queue, tab driver and IndexedDB
 * stack — record fields, content-hash verified blobs, size budget, truthful
 * failure states, recapture chains and the never-overwrite guarantee, plus
 * the pipeline wiring (link-queued hook, worker-startup requeue) and the
 * capture control RPCs.
 */

let installed: InstalledMock;
let router: MessageRouter;

const GRANTED_ORIGIN = 'https://example.com';

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

async function seedNote(title: string): Promise<Note> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return result['note'] as Note;
}

async function seedQueuedLink(noteId: EntityId, url: string): Promise<Link> {
  const { link } = await createLink(await repo(), noteId, url, '', 'queued');
  return link;
}

async function linkById(linkId: EntityId): Promise<Link | null> {
  return getLink(await repo(), linkId);
}

async function snapshotById(id: EntityId): Promise<Snapshot | null> {
  return getSnapshot(await repo(), id);
}

async function flush(millis = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
}

/** Complete any loading mock tab so the REAL tab driver's poll sees it. */
function autoCompleteLoads(overrides: { title?: string } = {}): () => void {
  const timer = setInterval(() => {
    for (const tab of installed.tabs.values()) {
      if (tab.status === 'loading') {
        tab.status = 'complete';
        if (overrides.title !== undefined) tab.title = overrides.title;
      }
    }
  }, 10);
  return () => clearInterval(timer);
}

/** The page the injected extractor runs against (fresh JSDOM document). */
function setPage(html: string): void {
  const dom = new JSDOM(html, { url: 'https://example.com/article' });
  installed.scripting.setPageDocument(dom.window.document);
}

const DEFAULT_PAGE = `
  <html>
    <head>
      <title>Example Article</title>
      <link rel="canonical" href="https://example.com/canonical-article">
    </head>
    <body>
      <h1>Example Article</h1>
      <p>Readable body text with the unique search term xylophonequota.</p>
    </body>
  </html>
`;

/** Enqueue through the production pipeline singleton. */
async function captureThroughPipeline(link: Link): Promise<void> {
  getCaptureQueue().enqueue(link);
  await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
}

beforeEach(() => {
  installed = installChromeMock();
  installed.permissions.grantedPatterns.add(`${GRANTED_ORIGIN}/*`);
  setPage(DEFAULT_PAGE);
  resetCapturePipeline();
  resetWorkerStartupGuard();
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
  resetCapturePipeline();
  installed.uninstall();
});

describe('production MHTML capture steps', () => {
  it('captures a queued link end-to-end: snapshot record, hashed blob, link captured', async () => {
    const stop = autoCompleteLoads({ title: 'Example Article' });
    try {
      const note = await seedNote('Capture me');
      const link = await seedQueuedLink(note.id, 'https://example.com/article');

      await captureThroughPipeline(link);

      const updated = (await linkById(link.id))!;
      expect(updated.captureState).toBe('captured');
      expect(updated.snapshotId).not.toBeNull();

      const snapshot = (await snapshotById(updated.snapshotId!))!;
      expect(snapshot.noteId).toBe(note.id);
      expect(snapshot.linkId).toBe(link.id);
      expect(snapshot.sourceUrl).toBe('https://example.com/article');
      expect(snapshot.finalUrl).toBe('https://example.com/article');
      expect(snapshot.title).toBe('Example Article');
      expect(snapshot.format).toBe('mhtml');
      expect(snapshot.capturedAt.length).toBeGreaterThan(0); // ISO UTC timestamp
      expect(snapshot.mhtml).toBe('saved');
      expect(snapshot.mhtmlBlobKey).not.toBeNull();
      expect(snapshot.mhtmlHash).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.mhtmlSize).toBeGreaterThan(0);
      // T-024 extracted text + T-025 full-page PNG: all three artifacts.
      expect(snapshot.text).toBe('saved');
      expect(snapshot.extractedText).toContain('xylophonequota');
      expect(snapshot.textSize).toBeGreaterThan(0);
      expect(snapshot.canonicalUrl).toBe('https://example.com/canonical-article');
      expect(snapshot.png).toBe('saved');
      expect(snapshot.pngBlobKey).not.toBeNull();
      expect(snapshot.pngHash).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.pngSize).toBeGreaterThan(0);
      expect(snapshot.status).toBe('complete');
      expect(snapshot.previousSnapshotId).toBeNull();
      expect(snapshot.warnings).toEqual([]); // the default fixture is clean

      // The PNG blob round-trips with PNG magic bytes from the CDP payload.
      const pngBlob = await getBlob(await repo(), snapshot.pngBlobKey!);
      expect(pngBlob).not.toBeNull();
      const pngBytes = new Uint8Array(await pngBlob!.arrayBuffer());
      expect([...pngBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // The injected extractor and the debugger both ran on the temporary tab.
      expect(installed.scripting.calls.length).toBeGreaterThan(0);
      expect(installed.debugger.commands.length).toBeGreaterThan(0);

      // The stored blob round-trips with the exact captured bytes.
      const blob = await getBlob(await repo(), snapshot.mhtmlBlobKey!);
      expect(blob).not.toBeNull();
      const text = await blob!.text();
      expect(text).toContain('multipart/related');

      // pageCapture and scripting ran on the temporary tab, which was cleaned up after.
      expect(installed.pageCapture.saveAsMHTML).toHaveBeenCalledWith({ tabId: expect.any(Number) });
      expect(installed.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ target: expect.objectContaining({ tabId: expect.any(Number) }) }),
      );
      expect(installed.tabs.size).toBe(0);
    } finally {
      stop();
    }
  });

  it('searches the captured page text through the note (FR-SEARCH-01/05)', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Searchable capture');
      const link = await seedQueuedLink(note.id, 'https://example.com/searchable');
      await captureThroughPipeline(link);

      const search = await ok('search/query', { query: 'xylophonequota' });
      const hits = (search['hits'] as Array<{ noteId: EntityId }>) ?? [];
      expect(hits.length).toBe(1);
      expect(hits[0]!.noteId).toBe(note.id); // found through the snapshot text
    } finally {
      stop();
    }
  });

  it('refines the snapshot title from the loaded document', async () => {
    const stop = autoCompleteLoads({ title: 'Tab placeholder title' });
    try {
      setPage(`<html><head><title>Refined by page</title></head><body><p>text</p></body></html>`);
      const note = await seedNote('Title refinement');
      const link = await seedQueuedLink(note.id, 'https://example.com/refined');
      await captureThroughPipeline(link);
      const updated = (await linkById(link.id))!;
      const snapshot = (await snapshotById(updated.snapshotId!))!;
      expect(snapshot.title).toBe('Refined by page');
    } finally {
      stop();
    }
  });

  it('falls back to the final URL as the title when the tab and page titles are empty', async () => {
    const stop = autoCompleteLoads({ title: '' });
    try {
      setPage(`<html><head><title></title></head><body><p>body only</p></body></html>`);
      const note = await seedNote('Untitled page');
      const link = await seedQueuedLink(note.id, 'https://example.com/no-title');
      await captureThroughPipeline(link);
      const updated = (await linkById(link.id))!;
      const snapshot = (await snapshotById(updated.snapshotId!))!;
      expect(snapshot.title).toBe('https://example.com/no-title');
    } finally {
      stop();
    }
  });

  it('refuses archives over the size budget: MHTML failed, text kept, snapshot partial', async () => {
    const stop = autoCompleteLoads();
    try {
      const settings = await getSettings(await repo());
      await patchSettings(await repo(), {
        capture: { ...settings.capture, maxArchiveBytes: 1024 },
      });
      const oversized = new Blob([new Uint8Array(2048)], { type: 'multipart/related' });
      installed.pageCapture.saveAsMHTML.mockImplementationOnce(async () => oversized);

      const note = await seedNote('Big page');
      const link = await seedQueuedLink(note.id, 'https://example.com/huge');

      getCaptureQueue().enqueue(link);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

      const updated = (await linkById(link.id))!;
      expect(updated.snapshotId).not.toBeNull(); // the text artifact was kept
      const snapshots = await listLinkSnapshots(await repo(), link.id);
      expect(snapshots).toHaveLength(1);
      const snapshot = snapshots[0]!;
      expect(snapshot.mhtml).toBe('failed');
      expect(snapshot.mhtmlBlobKey).toBeNull();
      expect(snapshot.text).toBe('saved');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings).toEqual([
        expect.objectContaining({ kind: 'oversized' }),
      ]);
    } finally {
      stop();
    }
  });

  it('marks an empty archive as a resource failure while the text artifact survives', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Empty page');
      const link = await seedQueuedLink(note.id, 'https://example.com/empty');
      // The tab capture returns an empty archive.
      installed.pageCapture.saveAsMHTML.mockImplementationOnce(async () => new Blob([], { type: 'multipart/related' }));

      getCaptureQueue().enqueue(link);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

      const updated = (await linkById(link.id))!;
      const snapshots = await listLinkSnapshots(await repo(), link.id);
      const snapshot = snapshots[0]!;
      expect(snapshot.mhtml).toBe('failed');
      expect(snapshot.text).toBe('saved');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings[0]?.kind).toBe('resource-failure');
      expect(updated.snapshotId).toBe(snapshot.id);
    } finally {
      stop();
    }
  });

  it('records a resource-failure warning when pageCapture throws', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Broken page');
      const link = await seedQueuedLink(note.id, 'https://example.com/broken');
      installed.pageCapture.saveAsMHTML.mockImplementationOnce(async () => {
        throw new Error('MHTML generation failed');
      });

      getCaptureQueue().enqueue(link);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

      const snapshots = await listLinkSnapshots(await repo(), link.id);
      const snapshot = snapshots[0]!;
      expect(snapshot.mhtml).toBe('failed');
      expect(snapshot.text).toBe('saved');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings[0]?.kind).toBe('resource-failure');
      expect(snapshot.warnings[0]?.detail).toContain('MHTML generation failed');
    } finally {
      stop();
    }
  });

  it('fails the text artifact alone when the injected script throws (MHTML retained)', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Script-blocked page');
      const link = await seedQueuedLink(note.id, 'https://example.com/script-blocked');
      installed.scripting.executeScript.mockImplementationOnce(async () => {
        throw new Error('cannot access contents of the page');
      });

      getCaptureQueue().enqueue(link);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

      const snapshots = await listLinkSnapshots(await repo(), link.id);
      const snapshot = snapshots[0]!;
      expect(snapshot.mhtml).toBe('saved');
      expect(snapshot.text).toBe('failed');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings.some((w) => w.kind === 'resource-failure' && w.detail.includes('cannot access contents'))).toBe(true);
    } finally {
      stop();
    }
  });

  it('rejects an untrusted extraction result that fails validation', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Hostile page');
      const link = await seedQueuedLink(note.id, 'https://example.com/hostile');
      installed.scripting.executeScript.mockImplementationOnce(async () => [
        { result: { text: 42, title: '<img src=x onerror=alert(1)>', warnings: 'not-an-array' } },
      ]);

      getCaptureQueue().enqueue(link);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

      const snapshots = await listLinkSnapshots(await repo(), link.id);
      const snapshot = snapshots[0]!;
      expect(snapshot.mhtml).toBe('saved');
      expect(snapshot.text).toBe('failed');
      expect(snapshot.extractedText).toBe('');
      expect(snapshot.title).not.toContain('<img');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings.some((w) => w.kind === 'resource-failure')).toBe(true);
    } finally {
      stop();
    }
  });

  it('keeps MHTML and text when the debugger cannot attach (FR-CAP-10)', async () => {
    const stop = autoCompleteLoads();
    try {
      installed.debugger.failNextAttach('Cannot attach to this target');
      const note = await seedNote('No debugger');
      const link = await seedQueuedLink(note.id, 'https://example.com/no-debugger');
      await captureThroughPipeline(link);

      const updated = (await linkById(link.id))!;
      const snapshot = (await snapshotById(updated.snapshotId!))!;
      expect(snapshot.mhtml).toBe('saved');
      expect(snapshot.text).toBe('saved');
      expect(snapshot.png).toBe('failed');
      expect(snapshot.status).toBe('partial');
      expect(snapshot.warnings.some((w) => w.kind === 'screenshot-limits' && w.detail.includes('Cannot attach'))).toBe(true);
    } finally {
      stop();
    }
  });

  it('a failed recapture never overwrites the previous success (FR-CAP-05/08)', async () => {
    const stop = autoCompleteLoads({ title: 'Good capture' });
    try {
      const note = await seedNote('Recapture');
      const link = await seedQueuedLink(note.id, 'https://example.com/recapture');
      await captureThroughPipeline(link);
      const first = (await linkById(link.id))!;
      expect(first.snapshotId).not.toBeNull();
      const goodSnapshot = (await snapshotById(first.snapshotId!))!;
      expect(goodSnapshot.mhtml).toBe('saved');

      // A retry whose capture fails COMPLETELY (all artifacts) must leave
      // the good archive linked.
      installed.pageCapture.saveAsMHTML.mockImplementationOnce(async () => {
        throw new Error('second capture failed');
      });
      installed.scripting.executeScript.mockImplementationOnce(async () => {
        throw new Error('extraction also failed');
      });
      installed.debugger.failNextAttach('debugger conflict');
      const retry = await ok('capture/retry', { linkId: link.id });
      expect(retry['retried']).toBe(true);
      await waitFor(async () => (await linkById(link.id))?.captureState === 'failed');

      const after = (await linkById(link.id))!;
      expect(after.captureState).toBe('failed');
      expect(after.snapshotId).toBe(first.snapshotId); // previous success preserved
      const stillGood = (await snapshotById(first.snapshotId!))!;
      expect(stillGood.mhtml).toBe('saved');
      expect(stillGood.mhtmlBlobKey).toBe(goodSnapshot.mhtmlBlobKey);
    } finally {
      stop();
    }
  });

  it('a successful recapture chains a new revision and re-points the link (FR-CAP-08)', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Chain');
      const link = await seedQueuedLink(note.id, 'https://example.com/chain');
      await captureThroughPipeline(link);
      const first = (await linkById(link.id))!;
      const firstSnapshot = (await snapshotById(first.snapshotId!))!;

      const retry = await ok('capture/retry', { linkId: link.id });
      expect(retry['retried']).toBe(true);
      await waitFor(async () => {
        const current = await linkById(link.id);
        return current?.captureState === 'captured' && current.snapshotId !== first.snapshotId;
      });

      const second = (await linkById(link.id))!;
      expect(second.snapshotId).not.toBe(first.snapshotId);
      const secondSnapshot = (await snapshotById(second.snapshotId!))!;
      expect(secondSnapshot.previousSnapshotId).toBe(firstSnapshot.id); // recapture chain
      // The old revision is preserved, not replaced.
      const history = await listLinkSnapshots(await repo(), link.id);
      expect(history.map((s) => s.id).sort()).toEqual([firstSnapshot.id, secondSnapshot.id].sort());
    } finally {
      stop();
    }
  });

  it('writes audit events for the capture outcome (FR-LOG-02)', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Audited');
      const link = await seedQueuedLink(note.id, 'https://example.com/audited');
      await captureThroughPipeline(link);
      const events = await listAuditEvents(await repo(), {});
      const captureEvents = events.filter((e) => e.action.startsWith('capture/'));
      expect(captureEvents.length).toBeGreaterThan(0);
      const succeeded = captureEvents.find((e) => e.action === 'capture/job-succeeded');
      expect(succeeded).toBeDefined();
      expect(succeeded!.detail).toContain('status=complete');
      // URLs never appear verbatim in audit bodies (redacted).
      expect(succeeded!.detail).not.toContain('https://example.com/audited');
    } finally {
      stop();
    }
  });
});

describe('pipeline wiring', () => {
  it('exposes one queue per worker and re-wires after a reset', () => {
    const first = getCaptureQueue();
    expect(getCaptureQueue()).toBe(first);
    resetCapturePipeline();
    const second = getCaptureQueue();
    expect(second).not.toBe(first);
  });

  it('captures links queued by the paste policy through the production hook', async () => {
    const stop = autoCompleteLoads();
    try {
      getCaptureQueue(); // wire the production singleton first
      const note = await seedNote('Pasted link');
      const result = await ok('links/detect-and-queue', {
        noteId: note.id,
        urls: ['https://example.com/pasted-article'],
        source: 'paste',
      });
      const detection = (result['results'] as Array<{ outcome: string; link: Link }>)[0]!;
      expect(detection.outcome).toBe('created');
      expect(detection.link.captureState).toBe('queued');

      await waitFor(async () => (await linkById(detection.link.id))?.captureState === 'captured');
      const captured = (await linkById(detection.link.id))!;
      expect(captured.snapshotId).not.toBeNull();
      const snapshot = (await snapshotById(captured.snapshotId!))!;
      expect(snapshot.mhtml).toBe('saved');
    } finally {
      stop();
    }
  });

  it('requeues links left queued by a worker restart (FR-CAP-03)', async () => {
    const stop = autoCompleteLoads();
    try {
      getCaptureQueue(); // simulate the worker being alive
      const note = await seedNote('Restart survivor');
      const link = await seedQueuedLink(note.id, 'https://example.com/restart');
      // Simulate suspension: the link is queued but nothing enqueued it.
      resetCapturePipeline(); // the in-memory queue is gone
      resetWorkerStartupGuard();
      await handleWorkerStartup();
      await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    } finally {
      stop();
    }
  });
});

describe('capture control RPCs', () => {
  it('reports an idle status', async () => {
    const result = await ok('capture/status', {});
    const status = result['status'] as { busy: boolean; pendingCount: number; waitingDedupCount: number };
    expect(status.busy).toBe(false);
    expect(status.pendingCount).toBe(0);
    expect(status.waitingDedupCount).toBe(0);
  });

  it('cancels a pending job and reports it', async () => {
    const note = await seedNote('Cancel me');
    const link = await seedQueuedLink(note.id, 'https://example.com/cancel');
    const queue = getCaptureQueue();
    // Park the worker on a job that never completes its load.
    const result = await ok('capture/cancel', { linkId: link.id });
    expect(result['canceled']).toBe(true);
    expect((await linkById(link.id))?.captureState).toBe('detected');
    expect(queue.status().pendingCount).toBe(0);
  });

  it('cancel returns false for an unknown link', async () => {
    const result = await ok('capture/cancel', { linkId: newId() });
    expect(result['canceled']).toBe(false);
  });

  it('rejects malformed payloads with invalid-request', async () => {
    const response = await call('capture/cancel', { nope: true });
    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error.code).toBe('invalid-request');
    const resolution = await call('capture/resolve-duplicate', { linkId: 'x', resolution: 'maybe' });
    expect(resolution.ok).toBe(false);
    expect(resolution.ok ? null : resolution.error.code).toBe('invalid-request');
  });

  it('resolves a parked duplicate with a fresh capture under the ask policy', async () => {
    const stop = autoCompleteLoads();
    try {
      const settings = await getSettings(await repo());
      await patchSettings(await repo(), { duplicateCapture: 'ask' });
      void settings;

      const noteA = await seedNote('First');
      const noteB = await seedNote('Second');
      getCaptureQueue();

      await ok('links/detect-and-queue', {
        noteId: noteA.id,
        urls: ['https://example.com/dup'],
        source: 'paste',
      });
      // First capture completes.
      await waitFor(async () => {
        const links = await listLinksByDedupKeyFor('https://example.com/dup');
        return links.some((l) => l.captureState === 'captured');
      });

      await ok('links/detect-and-queue', {
        noteId: noteB.id,
        urls: ['https://example.com/dup'],
        source: 'paste',
      });
      // The second link parks for a duplicate decision (the job stays
      // pending in `waiting-dedup`).
      const parked = (await waitFor(async () => {
        const links = await listLinksByDedupKeyFor('https://example.com/dup');
        return links.find((l) => l.noteId === noteB.id);
      }))!;
      await waitFor(() => getCaptureQueue().status().waitingDedupCount === 1);
      expect(getCaptureQueue().status().waitingDedupCount).toBe(1);

      const resolved = await ok('capture/resolve-duplicate', {
        linkId: parked.id,
        resolution: 'new',
      });
      expect(resolved['resolved']).toBe(true);

      await waitFor(async () => (await linkById(parked.id))?.captureState === 'captured');
      const capturedB = (await linkById(parked.id))!;
      expect(capturedB.snapshotId).not.toBeNull();
      // Two distinct snapshots for the two notes.
      const links = await listLinksByDedupKeyFor('https://example.com/dup');
      const snapshots = (
        await Promise.all(links.filter((l) => l.snapshotId).map((l) => snapshotById(l.snapshotId!)))
      ).filter((s): s is Snapshot => s !== null);
      expect(new Set(snapshots.map((s) => s.id)).size).toBe(2);
    } finally {
      stop();
    }
  });

  it('reuse resolution links the existing snapshot without a new capture', async () => {
    const stop = autoCompleteLoads();
    try {
      const settings = await getSettings(await repo());
      await patchSettings(await repo(), { duplicateCapture: 'ask' });
      void settings;

      const noteA = await seedNote('Original');
      const noteB = await seedNote('Reuser');
      getCaptureQueue();

      await ok('links/detect-and-queue', {
        noteId: noteA.id,
        urls: ['https://example.com/reuse'],
        source: 'paste',
      });
      const original = (await waitFor(async () => {
        const links = await listLinksByDedupKeyFor('https://example.com/reuse');
        return links.find((l) => l.captureState === 'captured');
      }))!;
      const captureCallsAfterFirst = installed.pageCapture.saveAsMHTML.mock.calls.length;

      await ok('links/detect-and-queue', {
        noteId: noteB.id,
        urls: ['https://example.com/reuse'],
        source: 'paste',
      });
      const parked = (await waitFor(async () => {
        const links = await listLinksByDedupKeyFor('https://example.com/reuse');
        return links.find((l) => l.noteId === noteB.id);
      }))!;
      await waitFor(() => getCaptureQueue().status().waitingDedupCount === 1);

      const resolved = await ok('capture/resolve-duplicate', {
        linkId: parked.id,
        resolution: 'reuse',
      });
      expect(resolved['resolved']).toBe(true);
      await waitFor(async () => (await linkById(parked.id))?.captureState === 'captured');

      // No new pageCapture ran — the existing archive was reused.
      expect(installed.pageCapture.saveAsMHTML.mock.calls.length).toBe(captureCallsAfterFirst);
      const reused = (await linkById(parked.id))!;
      expect(reused.snapshotId).toBe(original.snapshotId);
    } finally {
      stop();
    }
  });

  it('retry refuses links that are not in a retryable state', async () => {
    const stop = autoCompleteLoads();
    try {
      const note = await seedNote('Not retryable');
      const link = await seedQueuedLink(note.id, 'https://example.com/active');
      // A link mid-capture is not retryable — the active job owns it.
      await setLinkCaptureState(await repo(), link.id, 'capturing');
      const result = await ok('capture/retry', { linkId: link.id });
      expect(result['retried']).toBe(false);
    } finally {
      stop();
    }
  });
});

/** Links sharing the normalized dedup key of `url` across all notes. */
async function listLinksByDedupKeyFor(url: string): Promise<Link[]> {
  const key = dedupKey(url);
  if (key === null) throw new Error(`no dedup key for ${url}`);
  return listLinksByDedupKey(await repo(), key);
}
