/**
 * Capture control API (FR-CAP-03/07/08, PRD §5): the dashboard's handle on
 * the single capture queue. Four operations:
 *
 * - `capture/status`: worker busy/pending/waiting-dedup counts plus the
 *   active job's phase — the live queue indicator.
 * - `capture/cancel`: stop a pending, parked or actively capturing link
 *   (cooperative cancel; whatever was saved stays).
 * - `capture/retry`: re-queue a failed link for another attempt.
 * - `capture/resolve-duplicate`: answer the `ask`-policy question — reuse
 *   the existing archive or capture a fresh one (FR-CAP-08).
 *
 * The queue broadcasts `capture-progress` events to open dashboard tabs on
 * its own (queue.ts); these RPCs are the pull-based control surface.
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
import { getCaptureQueue } from '../capture/pipeline';
import type { DuplicateResolution } from '../capture/queue';
import { appendAuditEvent } from '../../core/repo/audit';
import { repo } from '../db';
import { redactUrlForLog } from '../../core/util/urls';
import { getLink, setLinkCaptureState } from '../../core/repo/links';
import { saveCurrentPageAsNote } from '../quick-capture';
import type { EntityId } from '../../core/types';
import { asEnum, asId, asObject, asString } from './validate';

/** Audit metadata only; URLs stay redacted (FR-LOG-03). */
async function auditCaptureControl(
  ctx: RpcDispatchContext,
  action: string,
  targetId: EntityId | null,
  outcome: 'succeeded' | 'failed',
  detail: string,
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action,
      targetId,
      targetKind: 'link',
      outcome,
      correlationId: ctx.correlationId,
      changedFields: [],
      detail,
    });
  } catch (error) {
    console.error('[audit] failed to record', action, error);
  }
}

export function registerCaptureApi(router: MessageRouter): void {
  router.register('capture/status', async () => {
    return { status: getCaptureQueue().status() };
  });

  /* T-089 (register UX-13): the visible "Save a web page…" entry point.
   * Same pipeline the context menu and paste-into-note use: a note titled
   * after the URL's host whose body links the page, plus a link record
   * queued for capture (the per-origin permission ask happens in the
   * capture pipeline, FR-CAP-04). The link gate can reject the URL — the
   * note survives and the response says so honestly. */
  router.register('capture/save-url', async (payload, ctx) => {
    const p = asObject(payload, 'capture/save-url');
    const url = asString(p['url'], 'url', { maxLength: 2048 }).trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      throw new Error('capture/save-url: url must be an http(s) link');
    }
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      host = ''; // the gate below stays honest even for odd inputs
    }
    const result = await saveCurrentPageAsNote({ pageUrl: url, pageTitle: host });
    await auditCaptureControl(
      ctx,
      'capture/save-url',
      (result.linkId as EntityId | null) ?? null,
      'succeeded',
      result.linkId
        ? `page saved as note; capture queued (${redactUrlForLog(url)})`
        : `page saved as note; URL rejected by the link gate (${redactUrlForLog(url)})`,
    );
    return {
      noteId: result.noteId,
      linkId: result.linkId,
      queued: result.linkId !== null,
    };
  });

  router.register('capture/cancel', async (payload, ctx) => {
    const p = asObject(payload, 'capture/cancel');
    const linkId = asId(p['linkId'], 'linkId');
    const link = await getLink(await repo(), linkId);
    if (!link) {
      await auditCaptureControl(ctx, 'capture/cancel', linkId, 'failed', 'unknown link');
      return { canceled: false };
    }
    let canceled = await getCaptureQueue().cancel(linkId);
    if (!canceled && link.captureState === 'queued') {
      // Queued in the database but not in this worker's memory (a restart
      // gap before requeue, or the enqueue race): canceling means returning
      // the link to `detected` — the user's intent is unambiguous.
      try {
        await setLinkCaptureState(await repo(), linkId, 'detected');
        canceled = true;
      } catch (error) {
        console.error('[capture] cancel could not reset a queued link', error);
      }
    }
    await auditCaptureControl(
      ctx,
      'capture/cancel',
      linkId,
      canceled ? 'succeeded' : 'failed',
      canceled
        ? `canceled the capture of ${redactUrlForLog(link.originalUrl)} (state was ${link.captureState})`
        : `nothing to cancel for ${redactUrlForLog(link.originalUrl)} (state ${link.captureState})`,
    );
    return { canceled };
  });

  router.register('capture/retry', async (payload, ctx) => {
    const p = asObject(payload, 'capture/retry');
    const linkId = asId(p['linkId'], 'linkId');
    const link = await getLink(await repo(), linkId);
    if (!link) {
      await auditCaptureControl(ctx, 'capture/retry', linkId, 'failed', 'unknown link');
      return { retried: false };
    }
    const retried = await getCaptureQueue().retry(linkId);
    await auditCaptureControl(
      ctx,
      'capture/retry',
      linkId,
      retried ? 'succeeded' : 'failed',
      retried
        ? `re-queued the capture of ${redactUrlForLog(link.originalUrl)} (state was ${link.captureState})`
        : `the link is not retryable (state ${link.captureState})`,
    );
    return { retried };
  });

  router.register('capture/resolve-duplicate', async (payload, ctx) => {
    const p = asObject(payload, 'capture/resolve-duplicate');
    const linkId = asId(p['linkId'], 'linkId');
    const resolution = asEnum<DuplicateResolution>(p['resolution'], 'resolution', ['reuse', 'new']);
    const resolved = await getCaptureQueue().resolveDuplicate(linkId, resolution);
    await auditCaptureControl(
      ctx,
      'capture/resolve-duplicate',
      linkId,
      resolved ? 'succeeded' : 'failed',
      resolved
        ? `duplicate decision: ${resolution === 'reuse' ? 'reuse the existing archive' : 'capture a fresh archive'}`
        : 'no parked duplicate decision was waiting for this link',
    );
    return { resolved };
  });
}
