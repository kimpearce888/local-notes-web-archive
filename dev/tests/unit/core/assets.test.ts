import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../src/core/db/open';
import { RepoContext } from '../../../../src/core/repo/context';
import { createNote } from '../../../../src/core/repo/notes';
import {
  InvalidUrlError,
  createLink,
  deleteLink,
  findLinkByDedup,
  findLinksByUrl,
  listNoteLinks,
  setLinkSnapshot,
} from '../../../../src/core/repo/links';
import {
  createSnapshot,
  deleteSnapshot,
  listNoteSnapshots,
  listLinkSnapshots,
  markMhtmlArtifact,
  markPngArtifact,
  markTextArtifact,
  renameSnapshot,
  saveMhtmlArtifact,
  savePngArtifact,
  saveTextArtifact,
  verifySnapshotIntegrity,
  cancelSnapshot,
} from '../../../../src/core/repo/snapshots';
import {
  AttachmentTooLargeError,
  createAttachment,
  findDuplicateAttachment,
  getAttachmentBlob,
  listNoteAttachments,
  verifyMimeType,
} from '../../../../src/core/repo/attachments';
import {
  blobBytes,
  collectGarbageBlobs,
  countHashReferences,
  getBlob,
  putBlob,
  removeBlobIfUnreferenced,
} from '../../../../src/core/repo/blobs';
import { sha256Hex } from '../../../../src/core/util/hash';
import { newId } from '../../../../src/core/util/ids';
import type { ContentHash } from '../../../../src/core/types';

let db: IDBDatabase;
let ctx: RepoContext;

beforeEach(async () => {
  db = await openDatabase({ name: `assets-test-${newId()}` });
  ctx = new RepoContext(db);
});

afterEach(() => {
  db.close();
});

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pngBlob = new Blob([pngBytes], { type: 'image/png' });

describe('links repository', () => {
  it('creates links with dedup per note and origin tracking', async () => {
    const note = await createNote(ctx, {});
    const first = await createLink(ctx, note.id, 'https://Example.com/a?x=1', 'A link');
    expect(first.link.origin).toBe('https://example.com');
    expect(first.created).toBe(true);
    const again = await createLink(ctx, note.id, 'https://example.com/a?x=1');
    expect(again.created).toBe(false);
    expect(again.link.id).toBe(first.link.id);
    // Different path → different link.
    const other = await createLink(ctx, note.id, 'https://example.com/b');
    expect(other.created).toBe(true);
    expect((await listNoteLinks(ctx, note.id)).length).toBe(2);
  });

  it('rejects invalid URLs', async () => {
    const note = await createNote(ctx, {});
    await expect(createLink(ctx, note.id, 'not a url')).rejects.toBeInstanceOf(InvalidUrlError);
    await expect(createLink(ctx, note.id, '')).rejects.toBeInstanceOf(InvalidUrlError);
  });

  it('finds duplicate URLs across notes and associates snapshots', async () => {
    const n1 = await createNote(ctx, {});
    const n2 = await createNote(ctx, {});
    await createLink(ctx, n1.id, 'https://example.com/shared');
    await createLink(ctx, n2.id, 'https://example.com/shared');
    expect(await findLinksByUrl(ctx, 'https://EXAMPLE.com/shared')).toHaveLength(2);
    const noteLink = (await listNoteLinks(ctx, n1.id))[0]!;
    const snapshotId = newId();
    await setLinkSnapshot(ctx, noteLink.id, snapshotId);
    expect((await findLinkByDedup(ctx, n1.id, noteLink.dedupKey))?.snapshotId).toBe(snapshotId);
    await deleteLink(ctx, noteLink.id);
    expect(await listNoteLinks(ctx, n1.id)).toHaveLength(0);
  });
});

describe('snapshots repository', () => {
  it('derives status from per-artifact states (FR-CAP-07)', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'Example',
    });
    expect(snapshot.status).toBe('queued');
    const withText = await saveTextArtifact(ctx, snapshot.id, 'readable text');
    expect(withText.status).toBe('capturing');
    expect(withText.extractedText).toBe('readable text');
    const withMhtml = await saveMhtmlArtifact(ctx, snapshot.id, new Blob(['MIME'], { type: 'message/rfc822' }));
    expect(withMhtml.status).toBe('capturing');
    expect(withMhtml.mhtmlHash).toBeTruthy();
    const failedPng = await markPngArtifact(ctx, snapshot.id, 'failed');
    expect(failedPng.status).toBe('partial');
    expect(failedPng.mhtml).toBe('saved');
    // Complete when PNG later succeeds (retry).
    const complete = await savePngArtifact(ctx, snapshot.id, pngBlob);
    expect(complete.status).toBe('complete');
    expect(complete.mhtmlSize).toBe(4);
    expect(complete.pngSize).toBe(pngBlob.size);
  });

  it('derives canceled (not failed) when nothing saved and the user stopped the job', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/stopped',
      finalUrl: 'https://example.com/stopped',
      title: 'X',
    });
    // Mid-capture cancel: MHTML pending→canceled, the steps that never ran
    // stay not-attempted (T-023 production steps mark them after the MHTML).
    // While one artifact is still pending the record stays `capturing`.
    await markMhtmlArtifact(ctx, snapshot.id, 'canceled');
    expect((await markTextArtifact(ctx, snapshot.id, 'not-attempted')).status).toBe('capturing');
    const stopped = await markPngArtifact(ctx, snapshot.id, 'not-attempted');
    expect(stopped.status).toBe('canceled');
  });

  it('derives partial for a saved artifact with steps not attempted (T-023 MHTML-only captures)', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/mhtml-only',
      finalUrl: 'https://example.com/mhtml-only',
      title: 'X',
    });
    await saveMhtmlArtifact(ctx, snapshot.id, new Blob(['MIME'], { type: 'message/rfc822' }));
    expect((await markTextArtifact(ctx, snapshot.id, 'not-attempted')).status).toBe('capturing');
    const partial = await markPngArtifact(ctx, snapshot.id, 'not-attempted');
    expect(partial.status).toBe('partial');
    expect(partial.mhtml).toBe('saved');
  });

  it('marks all artifacts failed → status failed', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'X',
    });
    await markMhtmlArtifact(ctx, snapshot.id, 'failed');
    await markPngArtifact(ctx, snapshot.id, 'failed');
    const failed = await markTextArtifact(ctx, snapshot.id, 'failed');
    expect(failed.status).toBe('failed');
  });

  it('cancels pending artifacts without touching saved ones', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'X',
    });
    await saveTextArtifact(ctx, snapshot.id, 'text');
    const canceled = await cancelSnapshot(ctx, snapshot.id);
    expect(canceled.text).toBe('saved');
    expect(canceled.mhtml).toBe('canceled');
    expect(canceled.png).toBe('canceled');
    expect(canceled.status).toBe('partial');
  });

  it('keeps a recapture chain via previousSnapshotId (FR-CAP-08)', async () => {
    const note = await createNote(ctx, {});
    const first = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'First',
    });
    const second = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'Second',
      previousSnapshotId: first.id,
    });
    const history = await listNoteSnapshots(ctx, note.id);
    expect(history.map((s) => s.title)).toEqual(['Second', 'First']);
    expect(second.previousSnapshotId).toBe(first.id);
    await renameSnapshot(ctx, second.id, 'Second (renamed)');
    expect((await listNoteSnapshots(ctx, note.id))[0]?.title).toBe('Second (renamed)');
  });

  it('verifies integrity and detects hash mismatch', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'X',
    });
    await saveMhtmlArtifact(ctx, snapshot.id, new Blob(['original'], { type: 'message/rfc822' }));
    const ok = await verifySnapshotIntegrity(ctx, snapshot.id);
    expect(ok.mhtml).toBe('ok');
    expect(ok.png).toBe('not-saved');
    // Tamper with the stored blob directly.
    const key = (await verifySnapshotIntegrityTestHelper(ctx, snapshot.id)) as ContentHash;
    await putBlob(ctx, 'mhtml', new Blob(['tampered'], { type: 'message/rfc822' }), key);
    const tampered = await verifySnapshotIntegrity(ctx, snapshot.id);
    expect(tampered.mhtml).toBe('hash-mismatch');
  });

  it('deletes snapshot record and collects unreferenced blobs', async () => {
    const note = await createNote(ctx, {});
    const snapshot = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: null,
      sourceUrl: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'X',
    });
    const saved = await saveMhtmlArtifact(ctx, snapshot.id, new Blob(['data'], { type: 'message/rfc822' }));
    expect(saved.mhtmlBlobKey).not.toBeNull();
    const key = saved.mhtmlBlobKey!;
    expect(await getBlob(ctx, key)).not.toBeNull();
    await deleteSnapshot(ctx, snapshot.id);
    // Blob removal is reference-aware: no references remain → removed.
    expect(await getBlob(ctx, key)).toBeNull();
  });
});

/** Extract the mhtml hash from a saved snapshot (test helper). */
async function verifySnapshotIntegrityTestHelper(
  ctx: RepoContext,
  snapshotId: ReturnType<typeof newId>,
): Promise<ContentHash> {
  const { getSnapshot } = await import('../../../../src/core/repo/snapshots');
  const snapshot = await getSnapshot(ctx, snapshotId);
  return snapshot?.mhtmlHash as ContentHash;
}

describe('attachments repository', () => {
  it('verifies MIME types from magic bytes', () => {
    expect(verifyMimeType('image/png', pngBytes)).toBe('image/png');
    expect(verifyMimeType('text/plain', new Uint8Array([0x89, 0x50]))).toBe('application/octet-stream');
    expect(verifyMimeType('application/x-shockwave-flash', pngBytes)).toBe('image/png');
    expect(verifyMimeType('text/plain', new Uint8Array([104, 105]))).toBe('text/plain');
    expect(verifyMimeType('whatever/binary', new Uint8Array([0, 1, 2]))).toBe('application/octet-stream');
    expect(verifyMimeType('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(verifyMimeType('application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf');
  });

  it('recognises HEIC/HEIF containers by ftyp brand (T-086, UX-07)', () => {
    // ISO-BMFF box: size (4 bytes) + 'ftyp' + major brand + minor version.
    const heicBrand = (brand: string): Uint8Array => {
      const bytes = new Uint8Array(16);
      bytes.set([0x00, 0x00, 0x00, 0x18], 0);
      bytes.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4);
      bytes.set([...brand].map((c) => c.charCodeAt(0)), 8);
      return bytes;
    };
    // iPhone photo brands.
    expect(verifyMimeType('image/heic', heicBrand('heic'))).toBe('image/heic');
    expect(verifyMimeType('application/octet-stream', heicBrand('heic'))).toBe('image/heic');
    expect(verifyMimeType('image/heic', heicBrand('heix'))).toBe('image/heic');
    expect(verifyMimeType('image/heic', heicBrand('hevc'))).toBe('image/heic');
    // Plain HEIF still-image brands.
    expect(verifyMimeType('image/heif', heicBrand('mif1'))).toBe('image/heif');
    expect(verifyMimeType('image/heif', heicBrand('msf1'))).toBe('image/heif');
    // AVIF is NOT HEIC (Chromium renders it natively; never relabel it).
    expect(verifyMimeType('image/avif', heicBrand('avic'))).toBe('application/octet-stream');
    // A random ftyp brand that is neither family stays opaque.
    expect(verifyMimeType('image/heic', heicBrand('isom'))).toBe('application/octet-stream');
  });

  it('creates attachments with hash and blob storage', async () => {
    const note = await createNote(ctx, {});
    const attachment = await createAttachment(ctx, {
      noteId: note.id,
      filename: 'pic.png',
      declaredMimeType: 'image/png',
      data: pngBlob,
    });
    expect(attachment.mimeType).toBe('image/png');
    expect(attachment.size).toBe(pngBytes.byteLength);
    const blob = await getAttachmentBlob(ctx, attachment);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe('image/png');
    // Duplicate detection by hash within the note.
    const dup = await findDuplicateAttachment(ctx, note.id, attachment.hash);
    expect(dup?.id).toBe(attachment.id);
    expect((await listNoteAttachments(ctx, note.id)).map((a) => a.filename)).toEqual(['pic.png']);
  });

  it('enforces the size limit truthfully', async () => {
    const note = await createNote(ctx, {});
    const big = new Uint8Array(1000);
    await expect(
      createAttachment(ctx, {
        noteId: note.id,
        filename: 'big.bin',
        declaredMimeType: 'application/octet-stream',
        data: big,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(await listNoteAttachments(ctx, note.id)).toHaveLength(0);
  });

  it('shares content-addressed blobs between identical attachments', async () => {
    const n1 = await createNote(ctx, {});
    const n2 = await createNote(ctx, {});
    const a1 = await createAttachment(ctx, {
      noteId: n1.id,
      filename: 'same.png',
      declaredMimeType: 'image/png',
      data: pngBlob,
    });
    const a2 = await createAttachment(ctx, {
      noteId: n2.id,
      filename: 'copy.png',
      declaredMimeType: 'image/png',
      data: pngBlob,
    });
    expect(a1.blobKey).toBe(a2.blobKey);
    expect(await countHashReferences(ctx, a1.hash)).toBe(2);
    // Removing one reference keeps the blob; GC only reclaims when unreferenced.
    const removed = await removeBlobIfUnreferenced(ctx, a1.blobKey);
    expect(removed).toBe(false);
    expect(await getBlob(ctx, a1.blobKey)).not.toBeNull();
  });
});

describe('blob store', () => {
  it('reports storage usage and collects garbage', async () => {
    const hash = await sha256Hex('orphan-data');
    await putBlob(ctx, 'mhtml', new Blob(['orphan-data']), hash);
    expect(await blobBytes(ctx)).toBe('orphan-data'.length);
    const reclaimed = await collectGarbageBlobs(ctx);
    expect(reclaimed).toBe('orphan-data'.length);
    expect(await blobBytes(ctx)).toBe(0);
  });

  it('listLinkSnapshots returns newest first', async () => {
    const note = await createNote(ctx, {});
    const link = await createLink(ctx, note.id, 'https://example.com/x');
    const s1 = await createSnapshot(ctx, {
      noteId: note.id,
      linkId: link.link.id,
      sourceUrl: 'https://example.com/x',
      finalUrl: 'https://example.com/x',
      title: '1',
    });
    await createSnapshot(ctx, {
      noteId: note.id,
      linkId: link.link.id,
      sourceUrl: 'https://example.com/x',
      finalUrl: 'https://example.com/x',
      title: '2',
      previousSnapshotId: s1.id,
    });
    const snapshots = await listLinkSnapshots(ctx, link.link.id);
    expect(snapshots.map((s) => s.title)).toEqual(['2', '1']);
  });
});
