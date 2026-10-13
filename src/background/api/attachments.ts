/**
 * Attachments API (PRD §4.4 media, FR-DATA-01, FR-SEARCH-01, FR-LOG-02):
 * local-file inserts arrive as Blobs rebuilt from base64 envelopes at the
 * channel boundary (T-063), are verified from magic bytes, content-hash
 * deduplicated within the note, and persisted in the blob store. Every mutation keeps the
 * note's search projection (attachment filenames are indexed) in sync and
 * appends an audit event with metadata only — never content.
 */

import type { MessageRouter, RpcDispatchContext } from '../router';
import { repo, searchEngine } from '../db';
import {
  AttachmentNotFoundError,
  AttachmentTooLargeError,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  createAttachment,
  deleteAttachment,
  findDuplicateAttachment,
  getAttachment,
  getAttachmentBlob,
  listNoteAttachments,
  renameAttachment,
} from '../../core/repo/attachments';
import { removeBlobIfUnreferenced } from '../../core/repo/blobs';
import { getNoteOrFail } from '../../core/repo/notes';
import { appendAuditEvent } from '../../core/repo/audit';
import { sha256Hex } from '../../core/util/hash';
import type { EntityId, Note } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import { asId, asObject, asString } from './validate';

/** Reject absurd filenames early (bounded, no control characters). */
function cleanFilename(raw: string): string {
  const stripped = Array.from(raw)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && ch !== '/' && ch !== '\\' && ch !== ':' && ch !== '*' &&
        ch !== '?' && ch !== '"' && ch !== '<' && ch !== '>' && ch !== '|';
    })
    .join('');
  const trimmed = stripped.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 255) : 'untitled-file';
}

async function indexNote(note: Note): Promise<void> {
  const engine = await searchEngine();
  await engine.indexNote(note);
}

/** Audit metadata only: action, ids, verified type and byte size (FR-LOG-02). */
async function auditAttachmentAction(
  ctx: RpcDispatchContext,
  input: {
    action: string;
    targetId: EntityId;
    noteId: EntityId | null;
    outcome: 'succeeded' | 'failed';
    changedFields?: readonly string[];
    detail: string;
  },
): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action: input.action,
      targetId: input.targetId,
      targetKind: 'attachment',
      outcome: input.outcome,
      correlationId: ctx.correlationId,
      changedFields: input.changedFields ?? [],
      detail: input.detail,
    });
  } catch (error) {
    // Audit failures never fail the committed mutation.
    console.error('[audit] failed to record', input.action, error);
  }
}

export function registerAttachmentApi(router: MessageRouter): void {
  router.register('attachments/add', async (payload, ctx) => {
    const p = asObject(payload, 'attachments/add');
    const noteId = asId(p['noteId'], 'noteId');
    const filename = cleanFilename(asString(p['filename'], 'filename', { maxLength: 1024, allowEmpty: true }));
    const declaredMimeType = asString(p['declaredMimeType'], 'declaredMimeType', {
      maxLength: 127,
      allowEmpty: true,
    });
    const data = p['data'];
    if (!(data instanceof Blob)) {
      throw new PayloadValidationError('attachments/add: data must be a Blob');
    }
    if (data.size === 0) {
      throw new PayloadValidationError('attachments/add: the file is empty');
    }
    if (data.size > DEFAULT_MAX_ATTACHMENT_BYTES) {
      // Checked before any write so nothing is ever partially stored.
      throw new AttachmentTooLargeError(data.size, DEFAULT_MAX_ATTACHMENT_BYTES);
    }
    // A note that does not exist must not accumulate attachments.
    const note = await getNoteOrFail(await repo(), noteId);

    const bytes = new Uint8Array(await data.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const duplicate = await findDuplicateAttachment(await repo(), noteId, hash);
    if (duplicate) {
      await auditAttachmentAction(ctx, {
        action: 'attachments/add',
        targetId: duplicate.id,
        noteId,
        outcome: 'succeeded',
        changedFields: [],
        detail: `duplicate content re-attached: ${duplicate.filename} (${duplicate.mimeType}, ${duplicate.size} bytes)`,
      });
      return { attachment: duplicate, deduplicated: true };
    }

    const attachment = await createAttachment(await repo(), {
      noteId,
      filename,
      declaredMimeType: declaredMimeType.length > 0 ? declaredMimeType : 'application/octet-stream',
      data,
    });
    await indexNote(note);
    await auditAttachmentAction(ctx, {
      action: 'attachments/add',
      targetId: attachment.id,
      noteId,
      outcome: 'succeeded',
      changedFields: ['filename', 'mimeType', 'size'],
      detail: `attached ${attachment.filename} (${attachment.mimeType}, ${attachment.size} bytes)`,
    });
    return { attachment, deduplicated: false };
  });

  router.register('attachments/list-for-note', async (payload) => {
    const p = asObject(payload, 'attachments/list-for-note');
    const attachments = await listNoteAttachments(await repo(), asId(p['noteId'], 'noteId'));
    return { attachments };
  });

  router.register('attachments/get-blob', async (payload) => {
    const p = asObject(payload, 'attachments/get-blob');
    const attachmentId = asId(p['attachmentId'], 'attachmentId');
    const attachment = await getAttachment(await repo(), attachmentId);
    if (!attachment) {
      throw new AttachmentNotFoundError(attachmentId);
    }
    const blob = await getAttachmentBlob(await repo(), attachment);
    return { attachment, blob };
  });

  router.register('attachments/rename', async (payload, ctx) => {
    const p = asObject(payload, 'attachments/rename');
    const attachmentId = asId(p['attachmentId'], 'attachmentId');
    const filename = cleanFilename(asString(p['filename'], 'filename', { maxLength: 1024 }));
    const attachment = await getAttachment(await repo(), attachmentId);
    if (!attachment) {
      throw new AttachmentNotFoundError(attachmentId);
    }
    await renameAttachment(await repo(), attachmentId, filename);
    const note = await getNoteOrFail(await repo(), attachment.noteId);
    await indexNote(note);
    await auditAttachmentAction(ctx, {
      action: 'attachments/rename',
      targetId: attachmentId,
      noteId: attachment.noteId,
      outcome: 'succeeded',
      changedFields: ['filename'],
      detail: `renamed to ${filename}`,
    });
    return { updated: true };
  });

  router.register('attachments/delete', async (payload, ctx) => {
    const p = asObject(payload, 'attachments/delete');
    const attachmentId = asId(p['attachmentId'], 'attachmentId');
    const deleted = await deleteAttachment(await repo(), attachmentId);
    // The blob survives when identical content is still referenced elsewhere;
    // reference-aware collection decides honestly.
    await removeBlobIfUnreferenced(await repo(), deleted.blobKey);
    const note = await getNoteOrFail(await repo(), deleted.noteId);
    await indexNote(note);
    await auditAttachmentAction(ctx, {
      action: 'attachments/delete',
      targetId: attachmentId,
      noteId: deleted.noteId,
      outcome: 'succeeded',
      changedFields: ['filename', 'mimeType', 'size'],
      detail: `deleted ${deleted.filename} (${deleted.mimeType}, ${deleted.size} bytes)`,
    });
    return { deleted: true };
  });
}
