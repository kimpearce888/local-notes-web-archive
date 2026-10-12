/**
 * Capture queue and orchestration (FR-CAP-03, FR-CAP-04).
 *
 * One sequential worker, one temporary tab at a time — never many hidden
 * tabs (FR-CAP-03). Each queued link becomes a job that:
 *
 *   1. re-checks the FR-CAP-04 gate and the origin permission (a grant
 *      revoked between queueing and processing parks the link back in
 *      permission-required — FR-CAP-02),
 *   2. applies the duplicate-capture policy (reuse / ask / always-new,
 *      FR-CAP-08),
 *   3. opens ONE inactive temporary tab and waits for load,
 *   4. validates that the final URL stayed on the authorized origin —
 *      redirects away abort extraction with the reason (FR-CAP-04),
 *   5. runs the artifact capture steps (MHTML, text, PNG — injected via
 *      `CaptureSteps`; the production steps land with T-023/024/025),
 *   6. records the outcome on the link + audit trail, closes the temporary
 *      tab in a finally path and reports progress throughout.
 *
 * Budgets: `settings.capture.timeoutMs` bounds the WHOLE job (navigation,
 * validation and artifact steps together); exceeding it fails the job. The
 * queue is engine-agnostic: it never touches pageCapture/debugger itself.
 */

import { repo } from '../db';
import { getSettings } from '../../core/repo/settings';
import { appendAuditEvent } from '../../core/repo/audit';
import {
  getLink,
  listLinksByDedupKey,
  listLinksInState,
  setLinkCaptureState,
  setLinkSnapshot,
} from '../../core/repo/links';
import { cancelSnapshot, getSnapshot } from '../../core/repo/snapshots';
import { checkCaptureEligibility, originOf, redactUrlForLog } from '../../core/util/urls';
import { hasOriginPermission } from '../permissions';
import { DASHBOARD_PAGE } from '../dashboard-tab';
import { closeDrivenTab, openInactiveTab, type DrivenTab } from './tab-driver';
import type {
  AppSettings,
  CaptureWarning,
  EntityId,
  Link,
  LinkCaptureState,
  Snapshot,
  UtcTimestamp,
} from '../../core/types';
import { newCorrelationId } from '../protocol';
import { nowUtc } from '../../core/util/time';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Observable phases of a capture job (progress events, FR-CAP-03). */
export type CaptureProgressPhase =
  | 'queued'
  | 'preparing'
  | 'waiting-dedup'
  | 'navigating'
  | 'validating'
  | 'capturing'
  | 'finalizing'
  | 'succeeded'
  | 'reused'
  | 'failed'
  | 'canceled'
  | 'permission-required';

export interface CaptureProgressEvent {
  readonly kind: 'capture-progress';
  readonly jobId: string;
  readonly linkId: EntityId;
  readonly phase: CaptureProgressPhase;
  /** Human-readable, log-safe context (redacted URLs, counts, reasons). */
  readonly detail: string;
  readonly at: UtcTimestamp;
}

/** A queued link awaiting capture. */
export interface CaptureJob {
  readonly jobId: string;
  readonly linkId: EntityId;
  readonly noteId: EntityId;
  /** URL as entered (the temporary tab navigates here). */
  readonly url: string;
  /** The origin the user authorized for this capture. */
  readonly origin: string;
  readonly dedupKey: string;
  /** Snapshot this link already references (recapture chain, FR-CAP-08). */
  readonly existingSnapshotId: EntityId | null;
  readonly enqueuedAt: UtcTimestamp;
}

export interface CaptureStepOutcome {
  readonly snapshotId: EntityId | null;
  readonly status: 'complete' | 'partial' | 'failed';
  readonly warnings: readonly CaptureWarning[];
  readonly detail: string;
}

/** Context handed to the artifact steps while a job is capturing. */
export interface CaptureRunContext {
  readonly job: CaptureJob;
  readonly settings: AppSettings;
  readonly correlationId: string;
  /** Wall-time budget left for the whole job. */
  remainingMs(): number;
  /** Report a progress phase (also broadcast to the dashboard). */
  report(phase: CaptureProgressPhase, detail?: string): void;
  isCanceled(): boolean;
  /**
   * Steps call this as soon as a snapshot record is persisted so an abort
   * (cancel/timeout) can finalize that record as canceled.
   */
  snapshotCreated(snapshotId: EntityId): void;
}

/**
 * The artifact capture steps (MHTML, extracted text, PNG) plus snapshot
 * persistence. Injected into the queue — T-023 implements the production
 * steps (MHTML + snapshot record), T-024/T-025 add text and PNG.
 */
export interface CaptureSteps {
  run(context: CaptureRunContext, tab: DrivenTab): Promise<CaptureStepOutcome>;
}

export interface ActiveJobStatus {
  readonly job: CaptureJob;
  readonly phase: CaptureProgressPhase;
  readonly startedAt: UtcTimestamp;
}

export interface CaptureQueueStatus {
  /** True while the single worker is processing a job. */
  readonly busy: boolean;
  readonly active: ActiveJobStatus | null;
  readonly pendingCount: number;
  readonly waitingDedupCount: number;
}

export type DuplicateResolution = 'reuse' | 'new';

export interface CaptureQueue {
  /** Queue a link whose captureState is already `queued`. */
  enqueue(link: Link, enqueueOptions?: { dedupResolved?: boolean }): void;
  /** Re-enqueue every link left `queued` (service-worker restart). */
  requeueQueuedLinks(): Promise<number>;
  /** Cancel a pending, parked or active job. Returns false when unknown. */
  cancel(linkId: EntityId): Promise<boolean>;
  /** Re-queue a failed link for another attempt. */
  retry(linkId: EntityId): Promise<boolean>;
  /** Resolve a parked duplicate decision (FR-CAP-08 `ask` policy). */
  resolveDuplicate(linkId: EntityId, resolution: DuplicateResolution): Promise<boolean>;
  status(): CaptureQueueStatus;
  onProgress(listener: (event: CaptureProgressEvent) => void): () => void;
}

export interface CaptureQueueOptions {
  readonly steps: CaptureSteps;
  /** Injectable tab driver (tests); defaults to the real one. */
  readonly openTab?: (url: string, timeoutMs: number) => Promise<DrivenTab>;
  readonly closeTab?: (tabId: number) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Link-queued notification hook                                       */
/* ------------------------------------------------------------------ */

type QueuedLinkListener = (link: Link) => void;
const queuedLinkListeners = new Set<QueuedLinkListener>();

/**
 * Subscribe to links entering the `queued` state. The links API notifies
 * after every queueing transition (paste policy, explicit queue, permission
 * grant) so the production capture pipeline can enqueue without polling.
 */
export function onLinkQueued(listener: QueuedLinkListener): () => void {
  queuedLinkListeners.add(listener);
  return () => queuedLinkListeners.delete(listener);
}

/** Fire the queued-link notifications (never throws into the caller). */
export function notifyLinkQueued(link: Link): void {
  for (const listener of queuedLinkListeners) {
    try {
      listener(link);
    } catch (error) {
      console.error('[capture] queued-link listener failed', error);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

interface PendingEntry {
  readonly job: CaptureJob;
  phase: 'queued' | 'waiting-dedup';
  readonly duplicateSnapshotId: EntityId | null;
  readonly duplicateUrl: string | null;
  /** True once the user resolved the ask-policy decision (capture anyway). */
  dedupResolved: boolean;
}

/** Abort raised by the queue itself (cancel or the job time budget). */
class CaptureAbortError extends Error {
  constructor(readonly kind: 'canceled' | 'job-timeout') {
    super(kind === 'canceled' ? 'capture job canceled' : 'capture job exceeded its time budget');
    this.name = 'CaptureAbortError';
  }
}

async function auditCapture(
  action: string,
  input: { targetId: EntityId | null; outcome: 'succeeded' | 'failed'; detail: string; correlationId: string },
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action,
      targetId: input.targetId,
      targetKind: 'link',
      outcome: input.outcome,
      correlationId: input.correlationId,
      changedFields: [],
      detail: input.detail,
    });
  } catch (error) {
    // Audit failures never fail the capture flow.
    console.error('[audit] failed to record', action, error);
  }
}

/** Existing capture for the same dedup key on ANOTHER link (FR-CAP-08). */
async function findDuplicateCapture(job: CaptureJob): Promise<{ snapshotId: EntityId; url: string } | null> {
  const links = await listLinksByDedupKey(await repo(), job.dedupKey);
  const other = links.find((l) => l.id !== job.linkId && l.snapshotId !== null);
  return other && other.snapshotId ? { snapshotId: other.snapshotId, url: other.originalUrl } : null;
}

/** Push a progress event to listeners and the open dashboard tab. */
function broadcast(event: CaptureProgressEvent, listeners: Iterable<(event: CaptureProgressEvent) => void>): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('[capture] progress listener failed', error);
    }
  }
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  void (async () => {
    try {
      const url = chrome.runtime.getURL(DASHBOARD_PAGE);
      const tabs = await chrome.tabs.query({ url });
      for (const tab of tabs) {
        if (tab.id !== undefined && tab.id !== null) {
          try {
            await chrome.tabs.sendMessage(tab.id, event);
          } catch {
            // Dashboard tab without a listener (still loading) — progress
            // is also observable through links and the queue status.
          }
        }
      }
    } catch {
      // Chrome tabs API unavailable — progress stays internal.
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Queue implementation                                                */
/* ------------------------------------------------------------------ */

export function createCaptureQueue(options: CaptureQueueOptions): CaptureQueue {
  const openTab = options.openTab ?? openInactiveTab;
  const closeTab = options.closeTab ?? closeDrivenTab;

  const progressListeners = new Set<(event: CaptureProgressEvent) => void>();
  let pending: PendingEntry[] = [];
  let active: {
    job: CaptureJob;
    phase: CaptureProgressPhase;
    startedAt: UtcTimestamp;
    cancelRequested: boolean;
    abort: ((kind: 'canceled' | 'job-timeout') => void) | null;
    snapshotId: EntityId | null;
  } | null = null;
  let draining = false;

  const report = (job: CaptureJob, phase: CaptureProgressPhase, detail = ''): void => {
    if (active && active.job.jobId === job.jobId) active.phase = phase;
    broadcast(
      { kind: 'capture-progress', jobId: job.jobId, linkId: job.linkId, phase, detail, at: nowUtc() },
      progressListeners,
    );
  };

  const jobFor = (link: Link): CaptureJob => ({
    jobId: newCorrelationId(),
    linkId: link.id,
    noteId: link.noteId,
    url: link.originalUrl,
    origin: link.origin,
    dedupKey: link.dedupKey,
    existingSnapshotId: link.snapshotId,
    enqueuedAt: nowUtc(),
  });

  /** Fail the job's link with a truthful reason (never throws). */
  const failJob = async (job: CaptureJob, reason: string, outcome?: CaptureStepOutcome): Promise<void> => {
    try {
      await setLinkCaptureState(await repo(), job.linkId, 'failed');
    } catch (error) {
      console.error('[capture] failed to mark link failed', error);
    }
    await auditCapture('capture/job-failed', {
      targetId: job.linkId,
      outcome: 'failed',
      correlationId: job.jobId,
      detail: `${reason}${outcome ? `; ${outcome.detail}` : ''} url=${redactUrlForLog(job.url)}`,
    });
    report(job, 'failed', reason);
  };

  const reuseExistingCapture = async (job: CaptureJob, duplicate: { snapshotId: EntityId; url: string }): Promise<void> => {
    try {
      await setLinkSnapshot(await repo(), job.linkId, duplicate.snapshotId);
      await auditCapture('capture/duplicate-reused', {
        targetId: job.linkId,
        outcome: 'succeeded',
        correlationId: job.jobId,
        detail: `reused snapshot ${duplicate.snapshotId} for ${redactUrlForLog(job.url)} (already captured as ${redactUrlForLog(duplicate.url)})`,
      });
      report(job, 'reused', 'reused an existing capture of this URL');
    } catch (error) {
      console.error('[capture] reuse failed', error);
      await failJob(job, 'reusing the existing capture failed');
    }
  };

  /** Sequential worker — the concurrency=1 hard limit (FR-CAP-03). */
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const next = pending.find((p) => p.phase === 'queued');
        if (!next) break;
        pending = pending.filter((p) => p !== next);
        try {
          await process(next.job, { skipDuplicateCheck: next.dedupResolved });
        } catch (error) {
          // process() handles its own failures; this belt-and-braces guard
          // keeps one bad job from stalling the queue forever.
          console.error('[capture] job crashed the worker loop', error);
        }
      }
    } finally {
      draining = false;
    }
  };

  const process = async (job: CaptureJob, runOptions: { skipDuplicateCheck?: boolean } = {}): Promise<void> => {
    const settings = await getSettings(await repo());
    const deadlineAt = Date.now() + Math.max(settings.capture.timeoutMs, 1);
    const remaining = (): number => Math.max(deadlineAt - Date.now(), 0);

    active = { job, phase: 'preparing', startedAt: nowUtc(), cancelRequested: false, abort: null, snapshotId: null };
    let tab: DrivenTab | null = null;
    report(job, 'preparing', 'checking eligibility and site access');

    try {
      // 1. Gate re-check (FR-CAP-04): the URL was validated when queued;
      //    re-assert so a settings or data regression cannot slip through.
      const gate = checkCaptureEligibility(job.url);
      if (!gate.ok) {
        await failJob(job, `URL not eligible for capture (${gate.reason})`);
        return;
      }

      // 2. Permission re-check (FR-CAP-02): the grant may have been revoked
      //    between queueing and processing.
      if (!(await hasOriginPermission(job.origin))) {
        await setLinkCaptureState(await repo(), job.linkId, 'permission-required');
        await auditCapture('capture/job-permission-required', {
          targetId: job.linkId,
          outcome: 'failed',
          correlationId: job.jobId,
          detail: `origin ${job.origin} is not authorized; awaiting the user's Allow-access action`,
        });
        report(job, 'permission-required', 'site access was revoked — allow access to continue');
        return;
      }

      // 3. Duplicate policy (FR-CAP-08) — skipped when the user already
      //    resolved the ask decision (or explicitly retried): their decision
      //    to capture a fresh archive must not be asked again.
      const duplicate = runOptions.skipDuplicateCheck ? null : await findDuplicateCapture(job);
      if (duplicate) {
        if (settings.duplicateCapture === 'reuse') {
          await reuseExistingCapture(job, duplicate);
          return;
        }
        if (settings.duplicateCapture === 'ask') {
          pending.push({ job, phase: 'waiting-dedup', duplicateSnapshotId: duplicate.snapshotId, duplicateUrl: duplicate.url, dedupResolved: false });
          report(job, 'waiting-dedup', 'this URL is already captured — choose reuse or a fresh capture');
          return;
        }
        // 'always-new' falls through and captures a fresh snapshot.
      }

      // 4. Claim the link for capture.
      await setLinkCaptureState(await repo(), job.linkId, 'capturing');
      report(job, 'navigating', 'opening a temporary background tab');

      // 5. Temporary inactive tab (never the user's tab, never activated).
      tab = await openTab(job.url, remaining());
      if (active.cancelRequested) throw new CaptureAbortError('canceled');

      // 6. Redirect validation (FR-CAP-04): the final origin must still be
      //    the authorized origin, or extraction stops with the reason.
      report(job, 'validating', 'validating the final destination');
      const finalOrigin = originOf(tab.finalUrl);
      if (finalOrigin !== job.origin) {
        await failJob(
          job,
          `navigation left the authorized origin (landed on ${finalOrigin ?? 'an unreadable URL'}); extraction aborted`,
        );
        return;
      }

      // 7. Artifact steps under the job budget, cancellable at any moment.
      report(job, 'capturing', 'capturing the page archive, text and screenshot');
      let abortTrigger: ((kind: 'canceled' | 'job-timeout') => void) | null = null;
      let abortTimer: ReturnType<typeof setTimeout> | null = null;
      const abortPromise = new Promise<never>((_, reject) => {
        abortTrigger = (kind: 'canceled' | 'job-timeout') => reject(new CaptureAbortError(kind));
        if (active && active.job.jobId === job.jobId) active.abort = abortTrigger;
        abortTimer = setTimeout(() => abortTrigger?.('job-timeout'), Math.max(remaining(), 1));
      });
      let outcome: CaptureStepOutcome;
      try {
        const stepsPromise = options.steps.run(
          {
            job,
            settings,
            correlationId: job.jobId,
            remainingMs: remaining,
            report: (phase, detail) => report(job, phase, detail),
            isCanceled: () => active?.job.jobId === job.jobId && active.cancelRequested,
            snapshotCreated: (snapshotId) => {
              if (active?.job.jobId === job.jobId) active.snapshotId = snapshotId;
            },
          },
          tab,
        );
        outcome = await Promise.race([stepsPromise, abortPromise]);
      } finally {
        if (abortTimer !== null) clearTimeout(abortTimer);
        if (active && active.job.jobId === job.jobId) active.abort = null;
      }

      // 8. Finalize the link from the steps' truthful outcome — but a grant
      //    revoked while the tab was open still wins: the link returns to
      //    permission-required and any saved snapshot stays standalone
      //    (revoking access never deletes captured data, T-021 semantics).
      report(job, 'finalizing', 'recording the capture result');
      if (!(await hasOriginPermission(job.origin))) {
        await setLinkCaptureState(await repo(), job.linkId, 'permission-required');
        await auditCapture('capture/job-permission-required', {
          targetId: job.linkId,
          outcome: 'failed',
          correlationId: job.jobId,
          detail: `origin ${job.origin} access was revoked while the capture was running; snapshot=${outcome.snapshotId ?? 'none'} kept unlinked`,
        });
        report(job, 'permission-required', 'site access was revoked during capture — allow access again to retry');
      } else if (outcome.snapshotId !== null && outcome.status !== 'failed') {
        await setLinkSnapshot(await repo(), job.linkId, outcome.snapshotId);
        await auditCapture('capture/job-succeeded', {
          targetId: job.linkId,
          outcome: 'succeeded',
          correlationId: job.jobId,
          detail: `status=${outcome.status} snapshot=${outcome.snapshotId} warnings=${outcome.warnings.length}; ${outcome.detail}`,
        });
        report(job, 'succeeded', `capture ${outcome.status}${outcome.warnings.length > 0 ? ` (${outcome.warnings.length} warning${outcome.warnings.length === 1 ? '' : 's'})` : ''}`);
      } else {
        // A failed capture never links its snapshot: the link keeps any
        // previous success (FR-CAP-05) and the failed record stays
        // discoverable by linkId for the history UI.
        const reason =
          outcome.snapshotId !== null
            ? `the capture failed (${outcome.status}); ${outcome.detail}`
            : `no snapshot was saved (${outcome.status}); ${outcome.detail}`;
        await failJob(job, reason, outcome);
      }
    } catch (error) {
      if (error instanceof CaptureAbortError && error.kind === 'canceled') {
        // User cancellation: finalize any snapshot the steps created, then
        // return the link to a truthful state (a saved partial stays linked).
        const snapshotId = active?.job.jobId === job.jobId ? active.snapshotId : null;
        if (snapshotId !== null) {
          try {
            await cancelSnapshot(await repo(), snapshotId);
            await setLinkSnapshot(await repo(), job.linkId, snapshotId);
          } catch (snapshotError) {
            console.error('[capture] canceling the snapshot record failed', snapshotError);
          }
        } else {
          try {
            await setLinkCaptureState(await repo(), job.linkId, 'detected');
          } catch (stateError) {
            console.error('[capture] returning the link to detected failed', stateError);
          }
        }
        await auditCapture('capture/job-canceled', {
          targetId: job.linkId,
          outcome: 'failed',
          correlationId: job.jobId,
          detail: `canceled by the user url=${redactUrlForLog(job.url)}`,
        });
        report(job, 'canceled', 'capture canceled');
      } else if (error instanceof CaptureAbortError) {
        // The job exceeded its time budget: a truthful FAILURE (FR-CAP-03),
        // never a silent cancel. Whatever the steps persisted in time stays
        // as a canceled/partial snapshot record, linked for recovery.
        const snapshotId = active?.job.jobId === job.jobId ? active.snapshotId : null;
        if (snapshotId !== null) {
          try {
            await cancelSnapshot(await repo(), snapshotId);
            await setLinkSnapshot(await repo(), job.linkId, snapshotId);
          } catch (snapshotError) {
            console.error('[capture] closing the timed-out snapshot record failed', snapshotError);
          }
        }
        await failJob(job, 'the capture exceeded its time budget');
      } else {
        const reason = error instanceof Error ? error.message : String(error);
        await failJob(job, reason);
      }
    } finally {
      // Guaranteed temporary-tab cleanup, whatever happened above.
      if (tab) await closeTab(tab.tabId);
      if (active?.job.jobId === job.jobId) active = null;
    }
  };

  const findPending = (linkId: EntityId): PendingEntry | undefined =>
    pending.find((p) => p.job.linkId === linkId);

  return {
    enqueue(link: Link, enqueueOptions: { dedupResolved?: boolean } = {}): void {
      if (link.captureState !== 'queued') return;
      if (findPending(link.id) || (active && active.job.linkId === link.id)) return;
      const job = jobFor(link);
      pending.push({
        job,
        phase: 'queued',
        duplicateSnapshotId: null,
        duplicateUrl: null,
        dedupResolved: enqueueOptions.dedupResolved === true,
      });
      report(job, 'queued', 'capture queued');
      void drain();
    },

    async requeueQueuedLinks(): Promise<number> {
      const links = await listLinksInState(await repo(), 'queued');
      for (const link of links) this.enqueue(link);
      return links.length;
    },

    async cancel(linkId: EntityId): Promise<boolean> {
      const parked = findPending(linkId);
      if (parked) {
        pending = pending.filter((p) => p !== parked);
        try {
          await setLinkCaptureState(await repo(), linkId, 'detected');
        } catch (error) {
          console.error('[capture] cancel could not reset the link state', error);
        }
        await auditCapture('capture/job-canceled', {
          targetId: linkId,
          outcome: 'failed',
          correlationId: parked.job.jobId,
          detail: 'canceled by the user before capture started',
        });
        report(parked.job, 'canceled', 'capture canceled before it started');
        return true;
      }
      if (active && active.job.linkId === linkId) {
        active.cancelRequested = true;
        active.abort?.('canceled');
        return true;
      }
      return false;
    },

    async retry(linkId: EntityId): Promise<boolean> {
      const link = await getLink(await repo(), linkId);
      if (!link) return false;
      // `captured` is retryable on purpose: retrying a captured link is the
      // recapture entry point (fresh revision, FR-CAP-08).
      const retryable: LinkCaptureState[] = ['failed', 'detected', 'permission-required', 'captured'];
      if (!retryable.includes(link.captureState)) return false;
      const updated = await setLinkCaptureState(await repo(), linkId, 'queued');
      await auditCapture('capture/job-retry', {
        targetId: linkId,
        outcome: 'succeeded',
        correlationId: newCorrelationId(),
        detail: `re-queued after ${link.captureState} url=${redactUrlForLog(link.originalUrl)}`,
      });
      // An explicit retry is a user decision to capture this link — the
      // duplicate question was already answered by the retry itself.
      this.enqueue(updated, { dedupResolved: true });
      return true;
    },

    async resolveDuplicate(linkId: EntityId, resolution: DuplicateResolution): Promise<boolean> {
      const parked = findPending(linkId);
      if (!parked || parked.phase !== 'waiting-dedup') return false;
      if (resolution === 'reuse' && parked.duplicateSnapshotId && parked.duplicateUrl) {
        pending = pending.filter((p) => p !== parked);
        await reuseExistingCapture(parked.job, { snapshotId: parked.duplicateSnapshotId, url: parked.duplicateUrl });
        return true;
      }
      parked.phase = 'queued';
      parked.dedupResolved = true;
      report(parked.job, 'queued', 'capturing a fresh archive of this URL');
      void drain();
      return true;
    },

    status(): CaptureQueueStatus {
      return {
        busy: active !== null,
        active: active
          ? { job: active.job, phase: active.phase, startedAt: active.startedAt }
          : null,
        pendingCount: pending.filter((p) => p.phase === 'queued').length,
        waitingDedupCount: pending.filter((p) => p.phase === 'waiting-dedup').length,
      };
    },

    onProgress(listener: (event: CaptureProgressEvent) => void): () => void {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
}

/**
 * Read the latest snapshot a link's capture produced (queue-owned helper
 * for tests and later wiring; snapshots themselves are T-023's records).
 */
export async function snapshotForLink(linkId: EntityId): Promise<Snapshot | null> {
  const link = await getLink(await repo(), linkId);
  if (!link?.snapshotId) return null;
  return getSnapshot(await repo(), link.snapshotId);
}
