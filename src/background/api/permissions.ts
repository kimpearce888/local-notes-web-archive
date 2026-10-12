/**
 * Origin permission API (FR-CAP-02, FR-SET-03).
 *
 * Three user-facing operations:
 *
 * - `links/request-capture-permission`: the "Allow access and capture"
 *   action. Runs inside the dashboard click's user-gesture window (the
 *   gesture propagates across chrome.runtime.sendMessage), requests the
 *   EXACT origin host permission, and on grant resumes capture (the link
 *   moves permission-required → queued). A decline keeps the link and its
 *   permission-required state — no silent retry (FR-CAP-02).
 * - `permissions/list-granted`: site-access grants with per-origin link
 *   counts for the settings screen (FR-SET-03). chrome.permissions is the
 *   source of truth; the settings mirror is updated on grant/revoke.
 * - `permissions/revoke`: removes the origin grant, returns pending capture
 *   work to permission-required and keeps finished archives (revoking
 *   access never deletes saved data).
 *
 * Queue-time checks: `links/detect-and-queue` and `links/queue-capture`
 * (registered in links.ts) consult `hasOriginPermission` so an unauthorized
 * origin lands in `permission-required` immediately — the capture queue
 * (T-022) re-checks before driving the tab.
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
import { repo } from '../db';
import { getLink, LinkNotFoundError, listLinksByOrigin, nextCaptureStateOnPermissionEvent, setLinkCaptureState } from '../../core/repo/links';
import { appendAuditEvent } from '../../core/repo/audit';
import { getSettings, patchSettings } from '../../core/repo/settings';
import { checkCaptureEligibility, redactUrlForLog } from '../../core/util/urls';
import type { EntityId, Link } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import { originPattern, hasOriginPermission, listGrantedCaptureOrigins, removeOriginPermission, requestOriginPermission } from '../permissions';
import { asId, asObject, asString } from './validate';

/** Audit metadata only: origins are not secrets, URLs stay redacted (FR-LOG-03). */
async function auditPermissionEvent(
  ctx: RpcDispatchContext,
  input: {
    action: string;
    targetId: EntityId | null;
    outcome: 'succeeded' | 'failed';
    detail: string;
  },
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action: input.action,
      targetId: input.targetId,
      targetKind: 'origin',
      outcome: input.outcome,
      correlationId: ctx.correlationId,
      changedFields: [],
      detail: input.detail,
    });
  } catch (error) {
    // Audit failures never fail the committed mutation.
    console.error('[audit] failed to record', input.action, error);
  }
}

export interface GrantedOriginInfo {
  readonly origin: string;
  /** Links recorded for this origin (any capture state). */
  readonly linkCount: number;
  /** Links waiting on this origin's permission (granted out-of-band flows). */
  readonly waitingCount: number;
}

export function registerPermissionApi(router: MessageRouter): void {
  router.register('links/request-capture-permission', async (payload, ctx) => {
    const p = asObject(payload, 'links/request-capture-permission');
    const linkId = asId(p['linkId'], 'linkId');
    const link = await getLink(await repo(), linkId);
    if (!link) {
      throw new LinkNotFoundError(linkId);
    }
    const gate = checkCaptureEligibility(link.originalUrl);
    if (!gate.ok) {
      await auditPermissionEvent(ctx, {
        action: 'permissions/request',
        targetId: linkId,
        outcome: 'failed',
        detail: `rejected ${redactUrlForLog(link.originalUrl)}: ${gate.reason}`,
      });
      throw new PayloadValidationError(
        `capture is not allowed for this URL (${gate.reason}: ${gate.detail})`,
      );
    }

    const alreadyGranted = await hasOriginPermission(link.origin);
    const granted = alreadyGranted || (await requestOriginPermission(link.origin));

    // Apply the FR-CAP-02 transition; a decline changes nothing and a grant
    // only resumes a link that was waiting on permission.
    const next = nextCaptureStateOnPermissionEvent(link.captureState, granted ? 'grant' : 'decline');
    const updated: Link = next ? await setLinkCaptureState(await repo(), linkId, next) : link;

    if (granted && !alreadyGranted) {
      // Mirror the grant in settings.allowedOrigins (FR-SET-01 bookkeeping).
      const settings = await getSettings(await repo());
      if (!settings.allowedOrigins.includes(link.origin)) {
        await patchSettings(await repo(), { allowedOrigins: [...settings.allowedOrigins, link.origin] });
      }
    }

    await auditPermissionEvent(ctx, {
      action: 'permissions/request',
      targetId: linkId,
      outcome: granted ? 'succeeded' : 'failed',
      detail: granted
        ? `granted origin=${link.origin}${alreadyGranted ? ' (already held)' : ''} state=${updated.captureState}`
        : `declined origin=${link.origin} state=${updated.captureState} (retained, no retry)`,
    });
    return { granted, alreadyGranted, link: updated };
  });

  router.register('permissions/list-granted', async () => {
    const origins = await listGrantedCaptureOrigins();
    const entries: GrantedOriginInfo[] = [];
    for (const origin of origins) {
      const links = await listLinksByOrigin(await repo(), origin);
      entries.push({
        origin,
        linkCount: links.length,
        waitingCount: links.filter((l) => l.captureState === 'permission-required').length,
      });
    }
    return { origins: entries };
  });

  router.register('permissions/revoke', async (payload, ctx) => {
    const p = asObject(payload, 'permissions/revoke');
    const origin = asString(p['origin'], 'origin', { maxLength: 2048 });
    if (!originPattern(origin)) {
      throw new PayloadValidationError(
        'permissions/revoke: origin must be a bare http(s) origin (scheme://host[:port])',
      );
    }

    await removeOriginPermission(origin);

    // Drop the settings mirror entry (chrome.permissions stays the truth).
    const settings = await getSettings(await repo());
    if (settings.allowedOrigins.includes(origin)) {
      await patchSettings(await repo(), {
        allowedOrigins: settings.allowedOrigins.filter((o) => o !== origin),
      });
    }

    // Pending capture work returns to permission-required; captured archives
    // and never-asked links are untouched (revoking access deletes nothing).
    const links = await listLinksByOrigin(await repo(), origin);
    let demotedLinks = 0;
    for (const link of links) {
      const next = nextCaptureStateOnPermissionEvent(link.captureState, 'revoke');
      if (next) {
        await setLinkCaptureState(await repo(), link.id, next);
        demotedLinks += 1;
      }
    }

    await auditPermissionEvent(ctx, {
      action: 'permissions/revoke',
      targetId: null,
      outcome: 'succeeded',
      detail: `origin=${origin} links=${links.length} demoted=${demotedLinks}`,
    });
    return { revoked: true, demotedLinks };
  });
}
