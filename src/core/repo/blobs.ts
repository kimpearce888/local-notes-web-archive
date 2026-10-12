import type { BlobKey, ContentHash } from '../types';
import { nowUtc } from '../util/time';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Blob store (FR-DATA-01): MHTML archives, PNG screenshots and attachment
 * payloads live in IndexedDB as Blobs, content-addressed by SHA-256 key.
 *
 * Deletion model: blob removal is reference-aware. Records referencing blobs
 * (attachments by `hash` index; snapshots by `mhtmlHash`/`pngHash`) are
 * checked before removal; unreferenced blobs are collected by
 * `collectGarbageBlobs` from the maintenance/diagnostics paths.
 */

export type BlobKind = 'mhtml' | 'png' | 'attachment';

export interface StoredBlob {
  readonly key: string;
  readonly kind: BlobKind;
  readonly data: Blob;
  readonly size: number;
  readonly createdAt: ReturnType<typeof nowUtc>;
}

/** Content-addressed blob key from a hash. */
export function blobKeyFor(hash: ContentHash): BlobKey {
  return `sha256:${hash}` as BlobKey;
}

export async function putBlob(
  ctx: RepoContext,
  kind: BlobKind,
  data: Blob,
  hash: ContentHash,
): Promise<BlobKey> {
  const key = blobKeyFor(hash);
  const record: StoredBlob = {
    key: key as string,
    kind,
    data,
    size: data.size,
    createdAt: nowUtc(),
  };
  await ctx.transaction([Store.Blobs], 'readwrite', (stores) => {
    stores[Store.Blobs]?.put(record);
  });
  return key;
}

export async function getBlob(ctx: RepoContext, key: BlobKey): Promise<Blob | null> {
  const record = await ctx.get<StoredBlob>(Store.Blobs, key as string);
  return record?.data ?? null;
}

export async function getBlobRecord(
  ctx: RepoContext,
  key: BlobKey,
): Promise<StoredBlob | null> {
  return ctx.get<StoredBlob>(Store.Blobs, key as string);
}

export async function listBlobs(ctx: RepoContext): Promise<StoredBlob[]> {
  return ctx.getAll<StoredBlob>(Store.Blobs);
}

/** Total bytes stored in the blob store (storage reporting, FR-DATA-02). */
export async function blobBytes(ctx: RepoContext): Promise<number> {
  const blobs = await listBlobs(ctx);
  return blobs.reduce((sum, b) => sum + b.size, 0);
}

/** Count live references to a content hash across attachments and snapshots. */
export async function countHashReferences(
  ctx: RepoContext,
  hash: ContentHash,
): Promise<number> {
  const key = blobKeyFor(hash) as string;
  let refs = 0;
  const attachments = await ctx.getByIndex<{ hash: ContentHash }>(
    Store.Attachments,
    'hash',
    hash,
  );
  refs += attachments.length;
  const snapshots = await ctx.getAll<{
    mhtmlHash: ContentHash | null;
    pngHash: ContentHash | null;
  }>(Store.Snapshots);
  for (const snapshot of snapshots) {
    if (snapshot.mhtmlHash === hash || snapshot.pngHash === hash) refs += 1;
  }
  void key;
  return refs;
}

/** Remove a blob only when no record references its hash. */
export async function removeBlobIfUnreferenced(
  ctx: RepoContext,
  key: BlobKey,
): Promise<boolean> {
  const record = await getBlobRecord(ctx, key);
  if (!record) return false;
  const hash = (key as string).replace(/^sha256:/, '') as ContentHash;
  if ((await countHashReferences(ctx, hash)) > 0) return false;
  await ctx.transaction([Store.Blobs], 'readwrite', (stores) => {
    stores[Store.Blobs]?.delete(key as string);
  });
  return true;
}

/** Remove all unreferenced blobs; returns bytes reclaimed (maintenance). */
export async function collectGarbageBlobs(ctx: RepoContext): Promise<number> {
  const blobs = await listBlobs(ctx);
  let reclaimed = 0;
  for (const blob of blobs) {
    const hash = blob.key.replace(/^sha256:/, '') as ContentHash;
    if ((await countHashReferences(ctx, hash)) === 0) {
      await ctx.transaction([Store.Blobs], 'readwrite', (stores) => {
        stores[Store.Blobs]?.delete(blob.key);
      });
      reclaimed += blob.size;
    }
  }
  return reclaimed;
}
