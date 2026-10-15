import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { installChromeMock, addTab, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import {
  createCaptureQueue,
  onLinkQueued,
  notifyLinkQueued,
  type CaptureProgressEvent,
  type CaptureQueue,
  type CaptureRunContext,
  type CaptureSteps,
} from '../../../../src/background/capture/queue';
import type { DrivenTab } from '../../../../src/background/capture/tab-driver';
import { patchSettings } from '../../../../src/core/repo/settings';
import { createLink, getLink, setLinkSnapshot } from '../../../../src/core/repo/links';
import { createSnapshot } from '../../../../src/core/repo/snapshots';
import { listAuditEvents } from '../../../../src/core/repo/audit';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId, Link, Note } from '../../../../src/core/types';

/**
 * T-022 capture queue and orchestration (FR-CAP-03/04): sequential
 * single-tab processing, cancel/retry, duplicate policy, progress events,
 * budgets, guaranteed tab cleanup, redirect validation and revocation
 * semantics. Artifact steps are injected fakes (the real MHTML/text/PNG
 * steps land in T-023..T-025); the tab driver is faked for determinism and
 * covered separately in capture-tab-driver.test.ts.
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

/** The finally-path tab cleanup is async — wait for it before asserting. */
async function waitForTabCleanup(closeTab: { mock: { calls: unknown[][] } }): Promise<void> {
  await waitFor(() => closeTab.mock.calls.length > 0);
}

/** Outcome shape the fake artifact steps return. */
interface StepsOutcome {
  snapshotId: EntityId | null;
  status: 'complete' | 'partial' | 'failed';
  warnings: never[];
  detail: string;
}

interface StepsController {
  steps: CaptureSteps;
  run: Mock;
  calls: Array<{ job: CaptureRunContext['job']; tab: DrivenTab }>;
  maxActive: number;
}

function makeSteps(
  runImpl: (context: CaptureRunContext, tab: DrivenTab) => Promise<StepsOutcome> = async () => ({
    snapshotId: (await import('../../../../src/core/util/ids')).newId(),
    status: 'complete',
    warnings: [],
    detail: 'fake steps saved all artifacts',
  }),
): StepsController {
  const calls: Array<{ job: CaptureRunContext['job']; tab: DrivenTab }> = [];
  const state = { active: 0, maxActive: 0 };
  const run = vi.fn(async (context: CaptureRunContext, tab: DrivenTab): Promise<StepsOutcome> => {
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      calls.push({ job: context.job, tab });
      return await runImpl(context, tab);
    } finally {
      state.active -= 1;
    }
  });
  return {
    steps: { run: run as unknown as CaptureSteps['run'] },
    run,
    calls,
    get maxActive() {
      return state.maxActive;
    },
  };
}

function makeQueue(
  steps: CaptureSteps,
  overrides: {
    openTab?: (url: string, timeoutMs: number) => Promise<DrivenTab>;
    closeTab?: (tabId: number) => Promise<void>;
  } = {},
): { queue: CaptureQueue; events: CaptureProgressEvent[]; closeTab: Mock; openTab: Mock } {
  const events: CaptureProgressEvent[] = [];
  const openTab: Mock = overrides.openTab
    ? vi.fn(overrides.openTab)
    : vi.fn(async (url: string) => ({ tabId: 777, finalUrl: url, title: 'Driven Page' } as DrivenTab));
  const closeTab: Mock = overrides.closeTab ? vi.fn(overrides.closeTab) : vi.fn(async () => undefined);
  const queue = createCaptureQueue({ steps, openTab, closeTab });
  queue.onProgress((event) => events.push(event));
  return { queue, events, closeTab, openTab };
}

beforeEach(() => {
  installed = installChromeMock();
  installed.permissions.grantedPatterns.add(`${GRANTED_ORIGIN}/*`);
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

describe('sequential capture (FR-CAP-03)', () => {
  it('processes a queued link end-to-end: tab, validation, steps, link captured', async () => {
    const note = await seedNote('Happy note');
    const link = await seedQueuedLink(note.id, 'https://example.com/article');
    const controller = makeSteps();
    const { queue, events, closeTab } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

    const updated = await linkById(link.id);
    expect(updated?.snapshotId).not.toBeNull();
    expect(controller.run).toHaveBeenCalledTimes(1);
    const call0 = controller.calls[0]!;
    expect(call0.tab.finalUrl).toBe('https://example.com/article');
    expect(call0.job.linkId).toBe(link.id);
    expect(call0.job.origin).toBe(GRANTED_ORIGIN);
    // The temporary tab is always cleaned up.
    await waitForTabCleanup(closeTab);
    expect(closeTab).toHaveBeenCalledWith(777);

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('queued');
    expect(phases).toContain('navigating');
    expect(phases).toContain('validating');
    expect(phases).toContain('capturing');
    expect(phases).toContain('succeeded');

    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(audits.some((e) => e.action === 'capture/job-succeeded')).toBe(true);
  });

  it('never runs two jobs at once — concurrency is hard-limited to one', async () => {
    const note = await seedNote('Sequential note');
    const first = await seedQueuedLink(note.id, 'https://example.com/one');
    const second = await seedQueuedLink(note.id, 'https://example.com/two');
    const controller = makeSteps(async () => {
      await flush(30); // deliberate overlap window
      return { snapshotId: (await import('../../../../src/core/util/ids')).newId(), status: 'complete', warnings: [], detail: '' };
    });
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(first);
    queue.enqueue(second);
    await waitFor(async () => (await linkById(second.id))?.captureState === 'captured');
    expect(controller.maxActive).toBe(1);
    expect(controller.run).toHaveBeenCalledTimes(2);
  });

  it('requeues links left queued by a service-worker restart', async () => {
    const note = await seedNote('Restart note');
    const link = await seedQueuedLink(note.id, 'https://example.com/recovered');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    const count = await queue.requeueQueuedLinks();
    expect(count).toBe(1);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(1);
  });
});

describe('pre-flight failures (FR-CAP-02/04)', () => {
  it('refuses ineligible URLs before opening any tab', async () => {
    const note = await seedNote('Gate note');
    // http(s) scheme passes createLink, but the queue's gate re-check
    // rejects loopback hosts (FR-CAP-04).
    const link = await seedQueuedLink(note.id, 'http://localhost:8080/x');
    const controller = makeSteps();
    const { queue, events, openTab } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'failed');
    expect(controller.run).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
    expect(events.some((e) => e.phase === 'failed' && e.detail.includes('loopback-host'))).toBe(true);
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(audits.some((e) => e.action === 'capture/job-failed' && e.detail.includes('loopback-host'))).toBe(true);
  });

  it('parks the link in permission-required when the grant is missing at start', async () => {
    installed.permissions.grantedPatterns.clear();
    const note = await seedNote('Ungranted note');
    const link = await seedQueuedLink(note.id, 'https://example.com/no-access');
    const controller = makeSteps();
    const { queue, events, openTab } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'permission-required');
    expect(controller.run).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
    expect(events.some((e) => e.phase === 'permission-required')).toBe(true);
  });

  it('aborts extraction when navigation redirects to another origin (FR-CAP-04)', async () => {
    const note = await seedNote('Redirect note');
    const link = await seedQueuedLink(note.id, 'https://example.com/redirector');
    const controller = makeSteps();
    const openTab = vi.fn(async (_url: string) => ({ tabId: 888, finalUrl: 'https://evil.example/landed', title: '' } as DrivenTab));
    const { queue, events, closeTab } = makeQueue(controller.steps, { openTab });

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'failed');
    expect(controller.run).not.toHaveBeenCalled(); // extraction stopped before any artifact
    await waitForTabCleanup(closeTab);
    expect(closeTab).toHaveBeenCalledWith(888); // the tab still gets cleaned up
    expect(events.some((e) => e.phase === 'failed' && e.detail.includes('evil.example'))).toBe(true);
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(
      audits.some((e) => e.action === 'capture/job-failed' && e.detail.includes('authorized origin')),
    ).toBe(true);
  });

  it('accepts same-origin redirects and captures normally', async () => {
    const note = await seedNote('Same-origin note');
    const link = await seedQueuedLink(note.id, 'https://example.com/short');
    const controller = makeSteps();
    const openTab = vi.fn(async () => ({ tabId: 889, finalUrl: 'https://example.com/shortened/canonical', title: 'Canonical' } as DrivenTab));
    const { queue } = makeQueue(controller.steps, { openTab });

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(1);
  });

  it('a revocation landing mid-capture wins over the steps outcome', async () => {
    const note = await seedNote('Revoke-mid note');
    const link = await seedQueuedLink(note.id, 'https://example.com/mid');
    // Steps hold the job in the capturing phase until the test revokes.
    let releaseSteps: () => void = () => undefined;
    const stepsGate = new Promise<void>((resolve) => {
      releaseSteps = resolve;
    });
    const controller = makeSteps(async () => {
      await stepsGate;
      return { snapshotId: (await import('../../../../src/core/util/ids')).newId(), status: 'complete', warnings: [], detail: 'saved before the revoke landed' };
    });
    const { queue } = makeQueue(controller.steps);

    // Enqueue, then revoke the grant while the job is between phases.
    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'capturing');
    installed.permissions.grantedPatterns.delete(`${GRANTED_ORIGIN}/*`);
    releaseSteps();

    await waitFor(async () => (await linkById(link.id))?.captureState === 'permission-required');
    // The steps ran, but the finalize re-check refused to link the snapshot.
    expect(controller.run).toHaveBeenCalledTimes(1);
    const updated = await linkById(link.id);
    expect(updated?.snapshotId).toBeNull();
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(
      audits.some((e) => e.action === 'capture/job-permission-required' && e.detail.includes('revoked while the capture was running')),
    ).toBe(true);
  });
});

describe('budgets and cancellation (FR-CAP-03)', () => {
  it('fails a job that exceeds the capture time budget and cleans up the tab', async () => {
    await patchSettings(await repo(), {
      capture: { maxArchiveBytes: 100 * 1024 * 1024, maxScreenshotPixels: 100_000_000, timeoutMs: 80 },
    });
    const note = await seedNote('Timeout note');
    const link = await seedQueuedLink(note.id, 'https://example.com/slow');
    const controller = makeSteps(() => new Promise(() => undefined)); // never resolves
    const { queue, events, closeTab } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'failed');
    await waitForTabCleanup(closeTab);
    expect(closeTab).toHaveBeenCalledWith(777);
    expect(events.some((e) => e.phase === 'failed' && e.detail.includes('time budget'))).toBe(true);
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(audits.some((e) => e.action === 'capture/job-failed' && e.detail.includes('time budget'))).toBe(true);
  });

  it('cancels a pending job before it starts', async () => {
    const note = await seedNote('Cancel-pending note');
    const first = await seedQueuedLink(note.id, 'https://example.com/a');
    const second = await seedQueuedLink(note.id, 'https://example.com/b');
    const controller = makeSteps(async () => {
      await flush(25);
      return { snapshotId: (await import('../../../../src/core/util/ids')).newId(), status: 'complete', warnings: [], detail: '' };
    });
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(first);
    queue.enqueue(second);
    expect(await queue.cancel(second.id)).toBe(true);
    await waitFor(async () => (await linkById(first.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(1);
    expect((await linkById(second.id))?.captureState).toBe('detected');
    expect(await queue.cancel(second.id)).toBe(false); // already gone
  });

  it('cancels the active job and returns the link to detected', async () => {
    const note = await seedNote('Cancel-active note');
    const link = await seedQueuedLink(note.id, 'https://example.com/hang');
    const controller = makeSteps(() => new Promise(() => undefined)); // hangs
    const { queue, closeTab } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'capturing');
    expect(await queue.cancel(link.id)).toBe(true);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'detected');
    await waitForTabCleanup(closeTab);
    expect(closeTab).toHaveBeenCalledWith(777);
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(audits.some((e) => e.action === 'capture/job-canceled' && e.detail.includes('canceled by the user'))).toBe(true);
  });

  it('canceling after a snapshot was created finalizes it as canceled and keeps it linked', async () => {
    const note = await seedNote('Cancel-partial note');
    const link = await seedQueuedLink(note.id, 'https://example.com/partial');
    const controller = makeSteps(async (context) => {
      const snapshot = await createSnapshot(await repo(), {
        noteId: note.id,
        linkId: link.id,
        sourceUrl: context.job.url,
        finalUrl: context.job.url,
        title: 'Partial page',
      });
      context.snapshotCreated(snapshot.id);
      return new Promise(() => undefined); // hang after creating the snapshot
    });
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'capturing');
    await queue.cancel(link.id);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');

    const snapshotId = (await linkById(link.id))?.snapshotId;
    expect(snapshotId).not.toBeNull();
    const { getSnapshot } = await import('../../../../src/core/repo/snapshots');
    const snapshot = await getSnapshot(await repo(), snapshotId!);
    expect(snapshot?.mhtml).toBe('canceled');
    expect(snapshot?.png).toBe('canceled');
    expect(snapshot?.text).toBe('canceled');
    expect(snapshot?.status).toBe('canceled');
  });

  it('retries a failed link through the queue', async () => {
    const note = await seedNote('Retry note');
    const link = await seedQueuedLink(note.id, 'https://example.com/flaky');
    let attempts = 0;
    const controller = makeSteps(async () => {
      attempts += 1;
      if (attempts === 1) {
        return { snapshotId: null, status: 'failed', warnings: [], detail: 'network hiccup' };
      }
      return { snapshotId: (await import('../../../../src/core/util/ids')).newId(), status: 'complete', warnings: [], detail: 'recovered' };
    });
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'failed');
    expect(await queue.retry(link.id)).toBe(true);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(2);
    expect(await queue.retry((await import('../../../../src/core/util/ids')).newId())).toBe(false);
  });
});

describe('duplicate policy (FR-CAP-08)', () => {
  async function seedCapturedLink(url: string): Promise<{ link: Link; snapshotId: EntityId }> {
    const note = await seedNote('Already captured');
    const link = await createLink(await repo(), note.id, url, '', 'detected');
    const snapshot = await createSnapshot(await repo(), {
      noteId: note.id,
      linkId: link.link.id,
      sourceUrl: url,
      finalUrl: url,
      title: 'Existing',
    });
    await setLinkSnapshot(await repo(), link.link.id, snapshot.id);
    return { link: link.link, snapshotId: snapshot.id };
  }

  it('reuses an existing capture of the same URL under the reuse policy', async () => {
    const existing = await seedCapturedLink('https://example.com/dup');
    await patchSettings(await repo(), { duplicateCapture: 'reuse' });
    const otherNote = await seedNote('Wants the same page');
    const link = await seedQueuedLink(otherNote.id, 'https://example.com/dup');
    const controller = makeSteps();
    const { queue, events } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).not.toHaveBeenCalled();
    expect((await linkById(link.id))?.snapshotId).toBe(existing.snapshotId);
    expect(events.some((e) => e.phase === 'reused')).toBe(true);
    const audits = await listAuditEvents(await repo(), { limit: 50 });
    expect(audits.some((e) => e.action === 'capture/duplicate-reused')).toBe(true);
  });

  it('parks duplicates for a user decision under the ask policy and keeps draining others', async () => {
    await seedCapturedLink('https://example.com/dup');
    const otherNote = await seedNote('Ask note');
    const duplicate = await seedQueuedLink(otherNote.id, 'https://example.com/dup');
    const independent = await seedQueuedLink(otherNote.id, 'https://example.com/other');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(duplicate);
    queue.enqueue(independent);
    await waitFor(async () => (await linkById(independent.id))?.captureState === 'captured');
    // The duplicate is parked; the independent link was still processed.
    expect(controller.run).toHaveBeenCalledTimes(1);
    expect((await linkById(duplicate.id))?.captureState).toBe('queued');
    expect(queue.status().waitingDedupCount).toBe(1);

    // Resolve: capture a fresh archive.
    expect(await queue.resolveDuplicate(duplicate.id, 'new')).toBe(true);
    await waitFor(async () => (await linkById(duplicate.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(2);
    expect((await linkById(duplicate.id))?.snapshotId).not.toBeNull();
    expect(queue.status().waitingDedupCount).toBe(0);
  });

  it('resolving a parked duplicate with reuse links the existing snapshot', async () => {
    const existing = await seedCapturedLink('https://example.com/dup');
    const otherNote = await seedNote('Ask-reuse note');
    const duplicate = await seedQueuedLink(otherNote.id, 'https://example.com/dup');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(duplicate);
    await waitFor(() => queue.status().waitingDedupCount === 1);
    expect(await queue.resolveDuplicate(duplicate.id, 'reuse')).toBe(true);
    await waitFor(async () => (await linkById(duplicate.id))?.captureState === 'captured');
    expect(controller.run).not.toHaveBeenCalled();
    expect((await linkById(duplicate.id))?.snapshotId).toBe(existing.snapshotId);
  });

  it('always-new policy captures a fresh snapshot without parking', async () => {
    await seedCapturedLink('https://example.com/dup');
    await patchSettings(await repo(), { duplicateCapture: 'always-new' });
    const otherNote = await seedNote('Always-new note');
    const link = await seedQueuedLink(otherNote.id, 'https://example.com/dup');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(1);
    expect(queue.status().waitingDedupCount).toBe(0);
  });

  it('cancels a parked duplicate awaiting a decision', async () => {
    await seedCapturedLink('https://example.com/dup');
    const otherNote = await seedNote('Cancel-parked note');
    const duplicate = await seedQueuedLink(otherNote.id, 'https://example.com/dup');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(duplicate);
    await waitFor(() => queue.status().waitingDedupCount === 1);
    expect(await queue.cancel(duplicate.id)).toBe(true);
    expect((await linkById(duplicate.id))?.captureState).toBe('detected');
    expect(queue.status().waitingDedupCount).toBe(0);
  });
});

describe('progress reporting (FR-CAP-03)', () => {
  it('broadcasts progress to the open dashboard tab', async () => {
    const dashboardTab = addTab(installed, chrome.runtime.getURL('dashboard.html'));
    installed.tabsWithListeners.add(dashboardTab);
    const note = await seedNote('Broadcast note');
    const link = await seedQueuedLink(note.id, 'https://example.com/watched');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(chrome.tabs.sendMessage).toHaveBeenCalled();
    const calls = (chrome.tabs.sendMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const progressMessages = calls
      .map((c) => c[1] as CaptureProgressEvent)
      .filter((m) => m?.kind === 'capture-progress');
    expect(progressMessages.length).toBeGreaterThan(4);
    expect(progressMessages.some((m) => m.phase === 'succeeded')).toBe(true);
  });

  it('ignores dashboard tabs without listeners instead of failing the job', async () => {
    addTab(installed, chrome.runtime.getURL('dashboard.html')); // no listener registered
    const note = await seedNote('No-listener note');
    const link = await seedQueuedLink(note.id, 'https://example.com/quiet');
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);

    queue.enqueue(link);
    await waitFor(async () => (await linkById(link.id))?.captureState === 'captured');
    expect(controller.run).toHaveBeenCalledTimes(1);
  });
});

describe('links API integration (queued-link hook)', () => {
  it('notifies subscribers when a paste queues a link for capture', async () => {
    const seen: Link[] = [];
    const unsubscribe = onLinkQueued((link) => seen.push(link));
    try {
      const note = await seedNote('Hook note');
      await ok('links/detect-and-queue', {
        noteId: note.id,
        urls: ['https://example.com/hooked'],
        source: 'paste',
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.originalUrl).toBe('https://example.com/hooked');
      expect(seen[0]!.captureState).toBe('queued');
    } finally {
      unsubscribe();
    }
  });

  it('a queue subscribed to the hook captures pasted links end-to-end', async () => {
    const controller = makeSteps();
    const { queue } = makeQueue(controller.steps);
    const unsubscribe = onLinkQueued((link) => queue.enqueue(link));
    try {
      const note = await seedNote('End-to-end note');
      await ok('links/detect-and-queue', {
        noteId: note.id,
        urls: ['https://example.com/full-circle'],
        source: 'paste',
      });
      await waitFor(async () => {
        const links = (await ok('links/list-for-note', { noteId: note.id })) as { links: Link[] };
        return links.links[0]?.captureState === 'captured';
      });
      expect(controller.run).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('manual typed URLs never fire the queue hook', async () => {
    const seen: Link[] = [];
    const unsubscribe = onLinkQueued((link) => seen.push(link));
    try {
      const note = await seedNote('Manual hook note');
      await ok('links/detect-and-queue', {
        noteId: note.id,
        urls: ['https://example.com/typed'],
        source: 'manual',
      });
      expect(seen).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });

  it('notifyLinkQueued never throws when a listener fails', () => {
    const unsubscribe = onLinkQueued(() => {
      throw new Error('listener bug');
    });
    try {
      expect(() => notifyLinkQueued({ captureState: 'queued' } as Link)).not.toThrow();
    } finally {
      unsubscribe();
    }
  });
});
