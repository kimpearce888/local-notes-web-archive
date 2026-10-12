/**
 * Production artifact steps for the capture queue (FR-CAP-05/07/08).
 *
 * T-023 scope: the snapshot record (source URL, validated final URL, title,
 * timestamp, content hash, format, per-artifact states, warnings) plus the
 * MHTML archive itself — `chrome.pageCapture.saveAsMHTML` on the queue's
 * temporary tab, stored as a content-addressed blob. Text extraction
 * (T-024) and the CDP PNG (T-025) extend this module; until they land their
 * artifacts carry the honest `not-attempted` state, never fake success.
 *
 * Truthfulness rules this module guarantees:
 *
 * - The snapshot record exists before any artifact work starts, so a cancel
 *   or timeout always has a record to finalize.
 * - A failed artifact NEVER overwrites a previously saved one: artifact
 *   writes are per-field and the record is only advanced `pending → saved`
 *   on verified bytes.
 * - Cancellation wins over failure reporting: if the queue already canceled
 *   the job, a step that never concluded stays `pending`/`canceled` instead
 *   of being relabeled `failed`.
 * - Saved bytes survive a late cancellation: if the MHTML blob arrives after
 *   the user canceled, it is still stored — the record then truthfully shows
 *   a partial capture rather than discarding data.
 */

import { repo } from '../db';
import type { CaptureSteps, CaptureRunContext, CaptureStepOutcome } from './queue';
import type { DrivenTab } from './tab-driver';
import {
  addSnapshotWarning,
  createSnapshot,
  getSnapshot,
  markMhtmlArtifact,
  markPngArtifact,
  markTextArtifact,
  saveMhtmlArtifact,
} from '../../core/repo/snapshots';
import type { CaptureWarning, Snapshot } from '../../core/types';

const MAX_RECORDED_WARNING_DETAIL = 300;

/** Warnings keep their detail bounded even when Chrome hands us a novel error. */
function boundedDetail(detail: string): string {
  return detail.length <= MAX_RECORDED_WARNING_DETAIL
    ? detail
    : `${detail.slice(0, MAX_RECORDED_WARNING_DETAIL)}…`;
}

/** Only advance an artifact out of `pending`; a cancel that already landed wins. */
async function markIfPending(
  snapshotId: Snapshot['id'],
  field: 'mhtml' | 'png' | 'text',
  state: 'failed' | 'not-attempted',
): Promise<void> {
  const current = await getSnapshot(await repo(), snapshotId);
  if (!current) return; // record gone (deleted) — nothing to relabel
  if (current[field] !== 'pending') return;
  if (field === 'mhtml') await markMhtmlArtifact(await repo(), snapshotId, state);
  else if (field === 'png') await markPngArtifact(await repo(), snapshotId, state);
  else await markTextArtifact(await repo(), snapshotId, state);
}

/**
 * Capture the MHTML archive of the driven tab and persist it.
 * Returns the warning recorded for a failed attempt, or null on success.
 */
async function captureMhtml(
  context: CaptureRunContext,
  tab: DrivenTab,
  snapshotId: Snapshot['id'],
): Promise<{ saved: boolean; warning: CaptureWarning | null; detail: string }> {
  let blob: Blob | undefined;
  try {
    blob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.tabId });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: boundedDetail(`pageCapture failed: ${reason}`) },
      detail: `the MHTML capture failed (${boundedDetail(reason)})`,
    };
  }

  if (blob === undefined || blob.size === 0) {
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: 'Chrome returned an empty MHTML archive' },
      detail: 'the MHTML archive was empty',
    };
  }

  const budget = context.settings.capture.maxArchiveBytes;
  if (blob.size > budget) {
    // FR-CAP-03 size budget: refuse to store, keep the record truthful.
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: {
        kind: 'oversized',
        detail: `the archive (${blob.size} bytes) exceeds the capture size budget (${budget} bytes)`,
      },
      detail: `the MHTML archive exceeded the size budget (${blob.size} > ${budget} bytes)`,
    };
  }

  try {
    const saved = await saveMhtmlArtifact(await repo(), snapshotId, blob);
    return { saved: true, warning: null, detail: `MHTML archive saved (${saved.mhtmlSize} bytes)` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIfPending(snapshotId, 'mhtml', 'failed');
    return {
      saved: false,
      warning: { kind: 'resource-failure', detail: boundedDetail(`storing the archive failed: ${reason}`) },
      detail: `storing the MHTML archive failed (${boundedDetail(reason)})`,
    };
  }
}

export function createProductionCaptureSteps(): CaptureSteps {
  return {
    async run(context: CaptureRunContext, tab: DrivenTab): Promise<CaptureStepOutcome> {
      let snapshot: Snapshot | null = null;
      const warnings: CaptureWarning[] = [];
      const details: string[] = [];

      try {
        // 1. The snapshot record precedes any artifact work (FR-CAP-05) so
        //    cancels/timeouts always have a record to finalize. A recapture
        //    chains to the link's previous snapshot (new revision by
        //    default, FR-CAP-08).
        snapshot = await createSnapshot(await repo(), {
          noteId: context.job.noteId,
          linkId: context.job.linkId,
          sourceUrl: context.job.url,
          finalUrl: tab.finalUrl,
          title: tab.title.trim().length > 0 ? tab.title.trim() : tab.finalUrl,
          previousSnapshotId: context.job.existingSnapshotId,
        });
        context.snapshotCreated(snapshot.id);
        context.report('capturing', 'saving the MHTML archive');

        // 2. MHTML artifact (T-023). Text (T-024) and PNG (T-025) extend the
        //    step list here; marking them not-attempted AFTER the MHTML step
        //    keeps a mid-capture cancel mapping `pending` → `canceled`.
        const mhtml = await captureMhtml(context, tab, snapshot.id);
        details.push(mhtml.detail);
        if (mhtml.warning) warnings.push(mhtml.warning);

        await markIfPending(snapshot.id, 'text', 'not-attempted');
        await markIfPending(snapshot.id, 'png', 'not-attempted');

        // 3. Warnings belong to the record (FR-CAP-05) — appended after the
        //    artifacts so a partial record is never left warning-less.
        for (const warning of warnings) {
          try {
            await addSnapshotWarning(await repo(), snapshot.id, warning);
          } catch (error) {
            console.error('[capture] failed to record a warning', error);
          }
        }

        // 4. The outcome mirrors the persisted record — the source of truth.
        const final = await getSnapshot(await repo(), snapshot.id);
        const status = final
          ? final.status === 'complete'
            ? 'complete'
            : final.status === 'partial'
              ? 'partial'
              : 'failed'
          : 'failed';
        return { snapshotId: snapshot.id, status, warnings, detail: details.join('; ') };
      } catch (error) {
        // Infrastructure failure (database unavailable, store error): never
        // throw — the queue owns failure semantics and an unhandled
        // rejection inside the race would crash the worker.
        const reason = error instanceof Error ? error.message : String(error);
        return {
          snapshotId: snapshot?.id ?? null,
          status: 'failed',
          warnings,
          detail: `the capture steps failed before completing (${boundedDetail(reason)})`,
        };
      }
    },
  };
}
