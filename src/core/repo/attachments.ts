import type { Attachment, ContentHash, EntityId } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { sha256Hex } from '../util/hash';
import { clamp } from '../util/strings';
import { Store } from '../db/schema';
import type { RepoContext } from './context';
import { blobKeyFor, getBlob, putBlob } from './blobs';

/**
 * Attachments repository (PRD §4.4, §10): verified MIME types from bytes,
 * content-hash dedup, local binary storage with size accounting.
 */

export class AttachmentTooLargeError extends Error {
  constructor(readonly size: number, readonly maxBytes: number) {
    super(`attachment is ${size} bytes; the limit is ${maxBytes} bytes`);
    this.name = 'AttachmentTooLargeError';
  }
}

export class AttachmentNotFoundError extends Error {
  constructor(readonly attachmentId: EntityId) {
    super(`attachment ${attachmentId} was not found`);
    this.name = 'AttachmentNotFoundError';
  }
}

/** Default per-attachment ceiling; configurable downward (FR-SET-01). */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * Verify a declared MIME type against magic bytes. Binary families are
 * identified from content; textual declarations are accepted only when the
 * payload is actually plausible text. Everything else degrades to a safe
 * opaque label.
 */
export function verifyMimeType(declared: string, bytes: Uint8Array): string {
  const startsWith = (...prefix: number[]): boolean =>
    prefix.every((byte, i) => bytes[i] === byte);

  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes.length > 11 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return 'application/zip';
  if (startsWith(0x1f, 0x8b)) return 'application/gzip';
  if (startsWith(0x42, 0x4d)) return 'image/bmp';
  // T-086 (register UX-07): HEIC/HEIF containers — ISO-BMFF files whose
  // bytes 4..7 spell "ftyp" with a major brand at 8..11. Recognising them
  // keeps iPhone photos from degrading to an opaque octet-stream label
  // when they are attached as files (AVIF's avic/avis brands are excluded —
  // Chromium renders those natively and they are not HEIC photos).
  if (bytes.length >= 12 && startsWith(0, 0, 0) && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(heic|heix|heim|heis|hevc|hevx|hevm|hevs)$/.test(brand)) return 'image/heic';
    if (/^(mif1|msf1|heif|heifm|heifs)$/.test(brand)) return 'image/heif';
  }

  if (isLikelyText(bytes)) {
    if (/^text\/(plain|markdown|html|css|csv)$/.test(declared)) return declared;
    if (declared === 'application/json') return declared;
    if (/^image\/svg\+xml$/.test(declared)) return 'image/svg+xml';
    if (/^text\//.test(declared)) return 'text/plain';
  }
  return 'application/octet-stream';
}

/** Heuristic text validation: strict UTF-8 decode of the first 512 bytes
 * without binary control characters. */
function isLikelyText(bytes: Uint8Array): boolean {
  try {
    const sample = bytes.subarray(0, Math.min(bytes.length, 512));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(sample);
    for (const ch of decoded) {
      const code = ch.charCodeAt(0);
      const isControl =
        (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
      if (isControl) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface CreateAttachmentInput {
  readonly noteId: EntityId;
  readonly filename: string;
  readonly declaredMimeType: string;
  readonly data: Blob | ArrayBuffer | Uint8Array;
  readonly maxBytes?: number;
}

/** Create an attachment: hash, verify, store blob, record metadata. */
export async function createAttachment(
  ctx: RepoContext,
  input: CreateAttachmentInput,
): Promise<Attachment> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const raw: Uint8Array =
    input.data instanceof Blob
      ? new Uint8Array(await input.data.arrayBuffer())
      : input.data instanceof Uint8Array
        ? input.data
        : new Uint8Array(input.data);
  // Copy into a definite ArrayBuffer-backed view for Blob construction.
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  if (bytes.byteLength > maxBytes) {
    throw new AttachmentTooLargeError(bytes.byteLength, maxBytes);
  }
  const hash = await sha256Hex(bytes);
  const mimeType = verifyMimeType(input.declaredMimeType, bytes);
  const blob =
    input.data instanceof Blob && input.data.type === mimeType
      ? input.data
      : new Blob([bytes], { type: mimeType });
  const key = await putBlob(ctx, 'attachment', blob, hash);
  const attachment: Attachment = {
    id: newId(),
    noteId: input.noteId,
    filename: input.filename,
    mimeType,
    size: bytes.byteLength,
    hash,
    blobKey: key,
    createdAt: nowUtc(),
  };
  await ctx.transaction([Store.Attachments], 'readwrite', (stores) => {
    stores[Store.Attachments]?.put(attachment);
  });
  return attachment;
}

export async function getAttachment(
  ctx: RepoContext,
  id: EntityId,
): Promise<Attachment | null> {
  return ctx.get<Attachment>(Store.Attachments, id);
}

export async function listNoteAttachments(
  ctx: RepoContext,
  noteId: EntityId,
): Promise<Attachment[]> {
  const attachments = await ctx.getByIndex<Attachment>(Store.Attachments, 'noteId', noteId);
  return attachments.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function getAttachmentBlob(
  ctx: RepoContext,
  attachment: Attachment,
): Promise<Blob | null> {
  return getBlob(ctx, attachment.blobKey);
}

/** Total attachment bytes (storage reporting). */
export async function attachmentBytes(ctx: RepoContext): Promise<number> {
  const attachments = await ctx.getAll<Attachment>(Store.Attachments);
  return attachments.reduce((sum, a) => sum + a.size, 0);
}

/** Rename an attachment's display filename. */
export async function renameAttachment(
  ctx: RepoContext,
  id: EntityId,
  filename: string,
): Promise<void> {
  await ctx.transaction([Store.Attachments], 'readwrite', (stores) => {
    const store = stores[Store.Attachments];
    if (!store) throw new Error('attachments store unavailable');
    const req = store.get(id);
    req.onsuccess = () => {
      const attachment = req.result as Attachment | undefined;
      if (attachment) store.put({ ...attachment, filename });
    };
  });
}

/**
 * Dedup by hash within a note: returns the existing attachment when the same
 * content is already attached, so repeated pastes do not duplicate payloads.
 */
export async function findDuplicateAttachment(
  ctx: RepoContext,
  noteId: EntityId,
  hash: ContentHash,
): Promise<Attachment | null> {
  const attachments = await listNoteAttachments(ctx, noteId);
  return attachments.find((a) => a.hash === hash) ?? null;
}

/** Clamp helper re-export for size-limit UIs. */
export { clamp };

/**
 * Delete one attachment record and return it (the caller re-indexes the
 * note and garbage-collects the blob when unreferenced). Throws
 * AttachmentNotFoundError for unknown ids — never a silent no-op.
 */
export async function deleteAttachment(
  ctx: RepoContext,
  id: EntityId,
): Promise<Attachment> {
  const existing = await getAttachment(ctx, id);
  if (!existing) throw new AttachmentNotFoundError(id);
  await ctx.transaction([Store.Attachments], 'readwrite', (stores) => {
    stores[Store.Attachments]?.delete(id);
  });
  return existing;
}

export { blobKeyFor };
