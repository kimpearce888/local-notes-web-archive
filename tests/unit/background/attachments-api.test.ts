import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { DEFAULT_MAX_ATTACHMENT_BYTES } from '../../../src/core/repo/attachments';
import { DB_NAME } from '../../../src/core/version';
import type { Attachment, EntityId, Note } from '../../../src/core/types';

/**
 * T-019 attachments API over the real router + repositories: verified MIME
 * from magic bytes, per-note hash dedup, reference-aware blob lifecycle,
 * searchable filenames, truthful size limits and audited mutations.
 */

let router: MessageRouter;
let installed: InstalledMock;

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

async function fail(type: string, payload: unknown): Promise<RpcResponse> {
  const response = await call(type, payload);
  if (response.ok) throw new Error(`${type} unexpectedly succeeded`);
  return response;
}

/** Minimal valid PNG (magic bytes only — the verifier checks the header). */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

async function seedNote(title: string): Promise<Note> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return result['note'] as Note;
}

interface AttachmentResult {
  attachment: Attachment;
  deduplicated: boolean;
}

async function addAttachment(noteId: EntityId, filename: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<AttachmentResult> {
  const blob = new Blob([bytes], { type });
  const result = (await ok('attachments/add', {
    noteId,
    filename,
    declaredMimeType: type,
    data: blob,
  })) as unknown as AttachmentResult;
  return result;
}

beforeEach(() => {
  installed = installChromeMock();
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

describe('attachments/add', () => {
  it('verifies the MIME type from magic bytes and stores the blob', async () => {
    const note = await seedNote('Add note');
    // Declared as text/plain but the bytes are a PNG → verified as image/png.
    const { attachment, deduplicated } = await addAttachment(note.id, 'photo.png', PNG_BYTES, 'text/plain');
    expect(attachment.mimeType).toBe('image/png');
    expect(attachment.size).toBe(PNG_BYTES.byteLength);
    expect(attachment.noteId).toBe(note.id);
    expect(deduplicated).toBe(false);

    const { blob } = (await ok('attachments/get-blob', { attachmentId: attachment.id })) as {
      attachment: Attachment;
      blob: Blob;
    };
    expect(blob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('deduplicates identical content within the same note', async () => {
    const note = await seedNote('Dedup note');
    const first = await addAttachment(note.id, 'a.png', PNG_BYTES, 'image/png');
    const second = await addAttachment(note.id, 'b.png', PNG_BYTES, 'image/png');
    expect(second.deduplicated).toBe(true);
    expect(second.attachment.id).toBe(first.attachment.id);

    const { attachments } = (await ok('attachments/list-for-note', { noteId: note.id })) as {
      attachments: Attachment[];
    };
    expect(attachments).toHaveLength(1);
  });

  it('shares one blob across notes but keeps separate records', async () => {
    const noteA = await seedNote('Shared A');
    const noteB = await seedNote('Shared B');
    const inA = await addAttachment(noteA.id, 'shared.png', PNG_BYTES, 'image/png');
    const inB = await addAttachment(noteB.id, 'shared.png', PNG_BYTES, 'image/png');
    expect(inB.deduplicated).toBe(false);
    expect(inB.attachment.id).not.toBe(inA.attachment.id);
    expect(inB.attachment.blobKey).toBe(inA.attachment.blobKey);

    // Deleting A's attachment keeps the shared blob alive for B.
    await ok('attachments/delete', { attachmentId: inA.attachment.id });
    const { blob } = (await ok('attachments/get-blob', { attachmentId: inB.attachment.id })) as {
      blob: Blob | null;
    };
    expect(blob).not.toBeNull();

    // Removing the last reference collects the blob honestly.
    await ok('attachments/delete', { attachmentId: inB.attachment.id });
    const response = await fail('attachments/get-blob', { attachmentId: inB.attachment.id });
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('rejects oversized files before any write (truthful limit)', async () => {
    const note = await seedNote('Limit note');
    const huge = new Uint8Array(DEFAULT_MAX_ATTACHMENT_BYTES + 1);
    const response = await fail('attachments/add', {
      noteId: note.id,
      filename: 'huge.png',
      declaredMimeType: 'image/png',
      data: new Blob([huge], { type: 'image/png' }),
    });
    if (!response.ok) {
      expect(response.error.code).toBe('attachment-too-large');
      expect(response.error.message).toContain(String(DEFAULT_MAX_ATTACHMENT_BYTES));
    }
    const { attachments } = (await ok('attachments/list-for-note', { noteId: note.id })) as {
      attachments: Attachment[];
    };
    expect(attachments).toHaveLength(0);
  });

  it('rejects empty and non-Blob payloads as invalid-request', async () => {
    const note = await seedNote('Validation note');
    const empty = await fail('attachments/add', {
      noteId: note.id,
      filename: 'empty.png',
      declaredMimeType: 'image/png',
      data: new Blob([], { type: 'image/png' }),
    });
    if (!empty.ok) expect(empty.error.code).toBe('invalid-request');

    const notBlob = await fail('attachments/add', {
      noteId: note.id,
      filename: 'base64.png',
      declaredMimeType: 'image/png',
      data: 'aGVsbG8=',
    });
    if (!notBlob.ok) expect(notBlob.error.code).toBe('invalid-request');
  });

  it('rejects unknown notes as not-found', async () => {
    const missing = (await import('../../../src/core/util/ids')).newId();
    const response = await fail('attachments/add', {
      noteId: missing,
      filename: 'orphan.png',
      declaredMimeType: 'image/png',
      data: new Blob([PNG_BYTES], { type: 'image/png' }),
    });
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('indexes attachment filenames for search (FR-SEARCH-01)', async () => {
    const note = await seedNote('Search attachment note');
    await addAttachment(note.id, 'zt9q-unique-filename.png', PNG_BYTES, 'image/png');

    const found = (await ok('search/query', { query: 'zt9q-unique-filename' })) as {
      hits: { noteId: string }[];
    };
    expect(found.hits.some((hit) => hit.noteId === note.id)).toBe(true);

    // Renaming reindexes: the new name is findable, the old one is not.
    const { attachments } = (await ok('attachments/list-for-note', { noteId: note.id })) as {
      attachments: Attachment[];
    };
    await ok('attachments/rename', {
      attachmentId: attachments[0]!.id,
      filename: 'renamed-7k2v-file.png',
    });
    const afterRenameOld = (await ok('search/query', { query: 'zt9q-unique-filename' })) as {
      hits: { noteId: string }[];
    };
    const afterRenameNew = (await ok('search/query', { query: 'renamed-7k2v-file' })) as {
      hits: { noteId: string }[];
    };
    expect(afterRenameOld.hits.some((hit) => hit.noteId === note.id)).toBe(false);
    expect(afterRenameNew.hits.some((hit) => hit.noteId === note.id)).toBe(true);

    // Deleting removes the filename from the searchable projection.
    await ok('attachments/delete', { attachmentId: attachments[0]!.id });
    const afterDelete = (await ok('search/query', { query: 'renamed-7k2v-file' })) as {
      hits: { noteId: string }[];
    };
    expect(afterDelete.hits.some((hit) => hit.noteId === note.id)).toBe(false);
  });

  it('records audit events with metadata only (FR-LOG-02)', async () => {
    const note = await seedNote('Audit note');
    const { attachment } = await addAttachment(note.id, 'audited.pdf', PDF_BYTES, 'application/pdf');
    await ok('attachments/rename', { attachmentId: attachment.id, filename: 'renamed.pdf' });
    await ok('attachments/delete', { attachmentId: attachment.id });

    const events = await listAuditEvents(await repo(), { limit: 50 });
    const actions = events.map((event) => event.action);
    expect(actions).toContain('attachments/add');
    expect(actions).toContain('attachments/rename');
    expect(actions).toContain('attachments/delete');
    for (const event of events.filter((e) => e.targetKind === 'attachment')) {
      // Details carry filenames and sizes, never content bodies.
      expect(event.detail).not.toContain('PDF-');
    }
  });

  it('sanitizes hostile filenames', async () => {
    const note = await seedNote('Filename note');
    const { attachment } = await addAttachment(
      note.id,
      'evil:name*?.png\x00',
      PNG_BYTES,
      'image/png',
    );
    expect(attachment.filename).toBe('evilname.png');
  });

  it('lists attachments for a note oldest-first', async () => {
    const note = await seedNote('Order note');
    const first = await addAttachment(note.id, 'first.pdf', PDF_BYTES, 'application/pdf');
    const second = await addAttachment(note.id, 'second.png', PNG_BYTES, 'image/png');
    const { attachments } = (await ok('attachments/list-for-note', { noteId: note.id })) as {
      attachments: Attachment[];
    };
    expect(attachments.map((a) => a.id)).toEqual([first.attachment.id, second.attachment.id]);
  });
});
