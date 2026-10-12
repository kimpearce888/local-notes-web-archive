/**
 * Links API (FR-CAP-01): URL records attached to notes with normalized
 * dedup keys and a capture lifecycle. T-020 adds paste/manual detection
 * with queue policy (auto-capture only when the setting is enabled and the
 * FR-CAP-04 gate passes) plus the explicit user-driven queue entry point.
 * The capture queue processor itself lands in T-022.
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
import { repo, searchEngine } from '../db';
import {
  createLink,
  deleteLink,
  findLinksByUrl,
  getLink,
  LinkNotFoundError,
  listNoteLinks,
  setLinkCaptureState,
  updateLinkAnchor,
  type CreateLinkResult,
} from '../../core/repo/links';
import { getNoteOrFail } from '../../core/repo/notes';
import { getSettings } from '../../core/repo/settings';
import { appendAuditEvent } from '../../core/repo/audit';
import { checkCaptureEligibility, redactUrlForLog } from '../../core/util/urls';
import type { EntityId, Link, LinkCaptureState, Note } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import { asEnum, asId, asObject, asOptionalString, asString, asStringArray } from './validate';

const CAPTURE_STATES: readonly LinkCaptureState[] = [
  'detected',
  'queued',
  'permission-required',
  'capturing',
  'captured',
  'failed',
];

const DETECTION_URL_LIMIT = 50;

async function indexNote(note: Note): Promise<void> {
  const engine = await searchEngine();
  await engine.indexNote(note);
}

/** Audit metadata only: redacted URLs (FR-LOG-03), never note content. */
async function auditLinkAction(
  ctx: RpcDispatchContext,
  input: {
    action: string;
    targetId: EntityId | null;
    noteId: EntityId | null;
    outcome: 'succeeded' | 'failed';
    detail: string;
  },
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action: input.action,
      targetId: input.targetId,
      targetKind: 'link',
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

export interface LinkDetectionResult {
  readonly url: string;
  /** 'created' | 'existing' for http(s) URLs; 'rejected' for everything else. */
  readonly outcome: 'created' | 'existing' | 'rejected';
  readonly reason?: string;
  /** FR-CAP-04 gate verdict (present for http(s) URLs). */
  readonly captureEligible?: boolean;
  readonly gateReason?: string;
  readonly link?: Link;
}

export function registerLinkApi(router: MessageRouter): void {
  router.register('links/create', async (payload) => {
    const p = asObject(payload, 'links/create');
    const result = await createLink(
      await repo(),
      asId(p['noteId'], 'noteId'),
      asString(p['url'], 'url', { maxLength: 8192 }),
      asOptionalString(p['anchorText'], 'anchorText', { maxLength: 2000, allowEmpty: true }) ?? '',
    );
    return result;
  });

  router.register('links/detect-and-queue', async (payload, ctx) => {
    const p = asObject(payload, 'links/detect-and-queue');
    const noteId = asId(p['noteId'], 'noteId');
    const urls = asStringArray(p['urls'], 'urls', { maxLength: DETECTION_URL_LIMIT });
    const source = asEnum(p['source'], 'source', ['paste', 'manual'] as const);
    if (urls.length === 0) return { results: [] };

    // Policy lives in ONE place: pasted URLs queue automatically only when
    // the user enabled auto-capture; manual (typed) URLs are only detected
    // (FR-CAP-01) and never auto-visit.
    const { autoCaptureOnPaste } = await getSettings(await repo());
    const shouldQueue = source === 'paste' && autoCaptureOnPaste;
    const note = await getNoteOrFail(await repo(), noteId);

    const results: LinkDetectionResult[] = [];
    for (const url of urls) {
      const gate = checkCaptureEligibility(url);
      if (!gate.ok && gate.reason === 'invalid-url') {
        // Not an absolute http(s) URL at all — never a link record.
        results.push({ url, outcome: 'rejected', reason: gate.reason });
        continue;
      }
      if (!gate.ok && (gate.reason === 'unsupported-scheme' || gate.reason === 'credentials-in-url')) {
        // http(s)-adjacent but never storable (script-capable schemes,
        // secrets in URLs).
        results.push({ url, outcome: 'rejected', reason: gate.reason });
        continue;
      }
      // http(s) URL: always preserved as a link (even when capture-ineligible
      // — e.g. localhost — the link itself is safe to keep and click).
      const createdState: LinkCaptureState = shouldQueue && gate.ok ? 'queued' : 'detected';
      let linkResult: CreateLinkResult;
      try {
        linkResult = await createLink(await repo(), noteId, url, '', createdState);
      } catch {
        results.push({ url, outcome: 'rejected', reason: 'invalid-url' });
        continue;
      }
      // Never downgrade progress: an existing queued/capturing/captured link
      // keeps its state; a detected link may be promoted to queued now.
      let link = linkResult.link;
      if (
        !linkResult.created &&
        createdState === 'queued' &&
        link.captureState === 'detected'
      ) {
        link = await setLinkCaptureState(await repo(), link.id, 'queued');
      }
      results.push({
        url,
        outcome: linkResult.created ? 'created' : 'existing',
        captureEligible: gate.ok,
        gateReason: gate.ok ? undefined : gate.reason,
        link,
      });
    }
    await indexNote(note);
    const queued = results.filter((r) => r.link?.captureState === 'queued').length;
    await auditLinkAction(ctx, {
      action: 'links/detect-and-queue',
      targetId: null,
      noteId,
      outcome: 'succeeded',
      detail: `source=${source} urls=${results.length} queued=${queued} rejected=${
        results.filter((r) => r.outcome === 'rejected').length
      }`,
    });
    return { results };
  });

  router.register('links/queue-capture', async (payload, ctx) => {
    const p = asObject(payload, 'links/queue-capture');
    const linkId = asId(p['linkId'], 'linkId');
    const link = await getLink(await repo(), linkId);
    if (!link) {
      throw new LinkNotFoundError(linkId);
    }
    const gate = checkCaptureEligibility(link.originalUrl);
    if (!gate.ok) {
      await auditLinkAction(ctx, {
        action: 'links/queue-capture',
        targetId: linkId,
        noteId: link.noteId,
        outcome: 'failed',
        detail: `rejected ${redactUrlForLog(link.originalUrl)}: ${gate.reason}`,
      });
      // Truthful, coded failure: the UI explains why capture is impossible.
      throw new PayloadValidationError(
        `capture is not allowed for this URL (${gate.reason}: ${gate.detail})`,
      );
    }
    const updated = await setLinkCaptureState(await repo(), linkId, 'queued');
    const note = await getNoteOrFail(await repo(), link.noteId);
    await indexNote(note);
    await auditLinkAction(ctx, {
      action: 'links/queue-capture',
      targetId: linkId,
      noteId: link.noteId,
      outcome: 'succeeded',
      detail: `queued ${redactUrlForLog(link.originalUrl)}`,
    });
    return { link: updated };
  });

  router.register('links/set-capture-state', async (payload, ctx) => {
    const p = asObject(payload, 'links/set-capture-state');
    const linkId = asId(p['linkId'], 'linkId');
    const captureState = asEnum(p['captureState'], 'captureState', CAPTURE_STATES);
    const updated = await setLinkCaptureState(await repo(), linkId, captureState);
    await auditLinkAction(ctx, {
      action: 'links/set-capture-state',
      targetId: linkId,
      noteId: updated.noteId,
      outcome: 'succeeded',
      detail: `state=${captureState}`,
    });
    return { link: updated };
  });

  router.register('links/list-for-note', async (payload) => {
    const p = asObject(payload, 'links/list-for-note');
    const links = await listNoteLinks(await repo(), asId(p['noteId'], 'noteId'));
    return { links };
  });

  router.register('links/find-by-url', async (payload) => {
    const p = asObject(payload, 'links/find-by-url');
    const links = await findLinksByUrl(await repo(), asString(p['url'], 'url', { maxLength: 8192 }));
    return { links };
  });

  router.register('links/update-anchor', async (payload) => {
    const p = asObject(payload, 'links/update-anchor');
    await updateLinkAnchor(
      await repo(),
      asId(p['linkId'], 'linkId'),
      asString(p['anchorText'], 'anchorText', { maxLength: 2000, allowEmpty: true }),
    );
    return { updated: true };
  });

  router.register('links/delete', async (payload) => {
    const p = asObject(payload, 'links/delete');
    await deleteLink(await repo(), asId(p['linkId'], 'linkId'));
    return { deleted: true };
  });
}
