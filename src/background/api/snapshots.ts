/**
 * Snapshot API (FR-CAP-06/07/08, PRD §4.x): listing, preview, rename,
 * delete and USER-INITIATED export of capture artifacts.
 *
 * Security/truthfulness rules:
 *
 * - The MHTML archive is NEVER rendered or injected into the dashboard —
 *   only its bytes leave through an explicit export request (FR-CAP-06).
 *   In-app preview = saved PNG + extracted text.
 * - Export blobs leave storage only after the snapshot's artifacts are
 *   verified present; missing artifacts return truthful nulls.
 * - Deleting a snapshot re-points its link along the recapture chain (the
 *   newest remaining revision), or returns the link to `detected` when no
 *   archive is left — never a dangling reference.
 * - Audit events carry metadata only; URLs stay redacted (FR-LOG-02/03).
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
import { repo, searchEngine } from '../db';
import {
  deleteSnapshot,
  getSnapshot,
  listLinkSnapshots,
  listNoteSnapshots,
  renameSnapshot,
  SnapshotNotFoundError,
} from '../../core/repo/snapshots';
import { getBlob } from '../../core/repo/blobs';
import { getLink, setLinkCaptureState, setLinkSnapshot } from '../../core/repo/links';
import { getNote } from '../../core/repo/notes';
import { appendAuditEvent } from '../../core/repo/audit';
import { redactUrlForLog } from '../../core/util/urls';
import type { EntityId, Link, Snapshot } from '../../core/types';
import { asId, asObject, asString, asEnum } from './validate';
import { PayloadValidationError } from '../protocol';

const TITLE_MAX = 500;

export type SnapshotExportFormat = 'mhtml' | 'png' | 'text';

/** Safe filename stem for exports (never path separators or hostiles). */
function filenameStem(snapshot: Snapshot): string {
  const base = snapshot.title.trim().length > 0 ? snapshot.title.trim() : 'snapshot';
  const safe = base
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const date = snapshot.capturedAt.slice(0, 10);
  return `${safe} (${date})`;
}

/** Audit metadata only: hashes/sizes/titles, URLs redacted (FR-LOG-03). */
async function auditSnapshotAction(
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
      targetKind: 'snapshot',
      outcome: input.outcome,
      correlationId: ctx.correlationId,
      changedFields: [],
      detail: `note=${input.noteId ?? '-'} ${input.detail}`,
    });
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}

async function indexNoteById(noteId: EntityId | null): Promise<void> {
  if (noteId === null) return;
  try {
    const note = await getNote(await repo(), noteId);
    if (note) await (await searchEngine()).indexNote(note);
  } catch (error) {
    console.error('[snapshots] re-indexing the note failed', error);
  }
}

async function getSnapshotOrFail(snapshotId: EntityId): Promise<Snapshot> {
  const snapshot = await getSnapshot(await repo(), snapshotId);
  if (!snapshot) throw new SnapshotNotFoundError(snapshotId);
  return snapshot;
}

/**
 * Deleting a snapshot keeps the recapture chain coherent: the link re-points
 * to its newest remaining revision, or returns to `detected` when nothing is
 * left. Returns the (possibly re-pointed) link.
 */
async function repointLinkAfterDelete(snapshot: Snapshot): Promise<Link | null> {
  if (snapshot.linkId === null) return null;
  const link = await getLink(await repo(), snapshot.linkId);
  if (!link) return null;
  if (link.snapshotId !== snapshot.id) return link; // someone else's reference

  const remaining = (await listLinkSnapshots(await repo(), link.id)).filter(
    (s) => s.id !== snapshot.id,
  );
  if (remaining.length > 0) {
    // Newest remaining revision of the chain keeps the link `captured`.
    await setLinkSnapshot(await repo(), link.id, remaining[0]!.id);
  } else {
    await setLinkSnapshot(await repo(), link.id, null);
    // A link without any archive is `detected`, not `captured`.
    await setLinkCaptureState(await repo(), link.id, 'detected');
  }
  return (await getLink(await repo(), link.id)) ?? link;
}

export function registerSnapshotApi(router: MessageRouter): void {
  router.register('snapshots/list-for-note', async (payload) => {
    const p = asObject(payload, 'snapshots/list-for-note');
    const noteId = asId(p['noteId'], 'noteId');
    const snapshots = await listNoteSnapshots(await repo(), noteId);
    return { snapshots };
  });

  router.register('snapshots/list-for-link', async (payload) => {
    const p = asObject(payload, 'snapshots/list-for-link');
    const linkId = asId(p['linkId'], 'linkId');
    const snapshots = await listLinkSnapshots(await repo(), linkId);
    return { snapshots };
  });

  router.register('snapshots/rename', async (payload, ctx) => {
    const p = asObject(payload, 'snapshots/rename');
    const snapshotId = asId(p['snapshotId'], 'snapshotId');
    const title = asString(p['title'], 'title', { maxLength: TITLE_MAX });
    const snapshot = await getSnapshotOrFail(snapshotId);
    const renamed = await renameSnapshot(await repo(), snapshotId, title);
    await indexNoteById(renamed.noteId); // the snapshot title is searchable
    await auditSnapshotAction(ctx, {
      action: 'snapshots/rename',
      targetId: snapshotId,
      noteId: renamed.noteId,
      outcome: 'succeeded',
      detail: `renamed (was ${snapshot.title.slice(0, 60) || 'untitled'})`,
    });
    return { snapshot: renamed };
  });

  router.register('snapshots/delete', async (payload, ctx) => {
    const p = asObject(payload, 'snapshots/delete');
    const snapshotId = asId(p['snapshotId'], 'snapshotId');
    const snapshot = await getSnapshotOrFail(snapshotId);
    const link = await repointLinkAfterDelete(snapshot);
    await deleteSnapshot(await repo(), snapshotId);
    await indexNoteById(snapshot.noteId);
    await auditSnapshotAction(ctx, {
      action: 'snapshots/delete',
      targetId: snapshotId,
      noteId: snapshot.noteId,
      outcome: 'succeeded',
      detail: `deleted (mhtml=${snapshot.mhtmlSize}B png=${snapshot.pngSize}B text=${snapshot.textSize}B)` +
        (link
          ? `; link ${link.snapshotId !== null ? 're-pointed to its previous revision' : 'returned to detected'} url=${redactUrlForLog(link.originalUrl)}`
          : ''),
    });
    return { deleted: true, link };
  });

  router.register('snapshots/get-png', async (payload) => {
    const p = asObject(payload, 'snapshots/get-png');
    const snapshotId = asId(p['snapshotId'], 'snapshotId');
    const snapshot = await getSnapshotOrFail(snapshotId);
    if (snapshot.png !== 'saved' || snapshot.pngBlobKey === null) {
      return { png: null };
    }
    const blob = await getBlob(await repo(), snapshot.pngBlobKey);
    return { png: blob };
  });

  router.register('snapshots/export', async (payload, ctx) => {
    const p = asObject(payload, 'snapshots/export');
    const snapshotId = asId(p['snapshotId'], 'snapshotId');
    const format = asEnum(p['format'], 'format', ['mhtml', 'png', 'text']);
    const snapshot = await getSnapshotOrFail(snapshotId);

    let blob: Blob | null = null;
    if (format === 'mhtml') {
      if (snapshot.mhtml === 'saved' && snapshot.mhtmlBlobKey !== null) {
        blob = await getBlob(await repo(), snapshot.mhtmlBlobKey);
      }
    } else if (format === 'png') {
      if (snapshot.png === 'saved' && snapshot.pngBlobKey !== null) {
        blob = await getBlob(await repo(), snapshot.pngBlobKey);
      }
    } else {
      if (snapshot.text === 'saved') {
        blob = new Blob([snapshot.extractedText], { type: 'text/plain' });
      }
    }

    await auditSnapshotAction(ctx, {
      action: 'snapshots/export',
      targetId: snapshotId,
      noteId: snapshot.noteId,
      outcome: blob !== null ? 'succeeded' : 'failed',
      detail:
        blob !== null
          ? `exported ${format} (${blob.size} bytes) — user-initiated download`
          : `export refused: the ${format} artifact was not saved (state=${format === 'mhtml' ? snapshot.mhtml : format === 'png' ? snapshot.png : snapshot.text})`,
    });

    if (blob === null) {
      // Truthful refusal, never an empty file.
      throw new PayloadValidationError(
        `the ${format} artifact of this snapshot was not saved — nothing to export`,
      );
    }
    const extension = format === 'mhtml' ? 'mhtml' : format === 'png' ? 'png' : 'txt';
    return { blob, filename: `${filenameStem(snapshot)}.${extension}` };
  });
}
