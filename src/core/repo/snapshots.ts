import type {
  BlobKey,
  CaptureArtifactState,
  CaptureStatus,
  CaptureWarning,
  ContentHash,
  EntityId,
  Snapshot,
} from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { sha256Hex } from '../util/hash';
import { Store } from '../db/schema';
import type { RepoContext } from './context';
import { blobKeyFor, getBlob, putBlob, removeBlobIfUnreferenced } from './blobs';

/**
 * Snapshots repository (FR-CAP-05..10): per-artifact states, content-hash
 * verified blobs, recapture chains.
 *
 * Status derivation (FR-CAP-07): complete = all three artifacts saved;
 * partial = at least one saved and one not; failed = none saved; canceled is
 * explicit. A failed artifact never overwrites a previously successful one —
 * artifact updates are per-field and blobs are content-addressed.
 */

export class SnapshotNotFoundError extends Error {
  constructor(readonly snapshotId: EntityId) {
    super(`snapshot ${snapshotId} not found`);
    this.name = 'SnapshotNotFoundError';
  }
}

export interface CreateSnapshotInput {
  readonly noteId: EntityId | null;
  readonly linkId: EntityId | null;
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  /** Previous snapshot of the same link (recapture chain). */
  readonly previousSnapshotId?: EntityId | null;
}

/** Create a queued snapshot record (all artifacts pending). */
export async function createSnapshot(
  ctx: RepoContext,
  input: CreateSnapshotInput,
): Promise<Snapshot> {
  const snapshot: Snapshot = {
    id: newId(),
    noteId: input.noteId,
    linkId: input.linkId,
    sourceUrl: input.sourceUrl,
    finalUrl: input.finalUrl,
    title: input.title,
    capturedAt: nowUtc(),
    status: 'queued',
    mhtml: 'pending',
    png: 'pending',
    text: 'pending',
    mhtmlBlobKey: null,
    pngBlobKey: null,
    extractedText: '',
    mhtmlHash: null,
    pngHash: null,
    format: 'mhtml',
    mhtmlSize: 0,
    pngSize: 0,
    textSize: 0,
    warnings: [],
    previousSnapshotId: input.previousSnapshotId ?? null,
  };
  await ctx.transaction([Store.Snapshots], 'readwrite', (stores) => {
    stores[Store.Snapshots]?.put(snapshot);
  });
  return snapshot;
}

function deriveStatus(
  mhtml: CaptureArtifactState,
  png: CaptureArtifactState,
  text: CaptureArtifactState,
): CaptureStatus {
  const saved = [mhtml, png, text].filter((s) => s === 'saved').length;
  const terminal = [mhtml, png, text].filter(
    (s) => s === 'failed' || s === 'canceled' || s === 'not-attempted',
  ).length;
  if (saved === 3) return 'complete';
  // FR-CAP-07: an all-canceled capture is *canceled*, not failed — the user
  // stopped it; nothing was lost.
  if (saved === 0 && mhtml === 'canceled' && png === 'canceled' && text === 'canceled') {
    return 'canceled';
  }
  if (saved >= 1 && terminal >= 1) return 'partial';
  if (saved === 0 && terminal === 3) return 'failed';
  return 'capturing';
}

async function patchSnapshot(
  ctx: RepoContext,
  id: EntityId,
  patch: Partial<Snapshot> & { warnings?: CaptureWarning[] },
): Promise<Snapshot> {
  let updated: Snapshot | null = null;
  await ctx.transaction([Store.Snapshots], 'readwrite', (stores) => {
    const store = stores[Store.Snapshots];
    if (!store) throw new Error('snapshots store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const snapshot = req.result as Snapshot | undefined;
        if (!snapshot) {
          reject(new SnapshotNotFoundError(id));
          return;
        }
        const next: Snapshot = { ...snapshot, ...patch };
        next.status = deriveStatus(next.mhtml, next.png, next.text);
        store.put(next);
        updated = next;
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('snapshot read failed'));
    });
  });
  if (!updated) throw new SnapshotNotFoundError(id);
  return updated;
}

export async function getSnapshot(ctx: RepoContext, id: EntityId): Promise<Snapshot | null> {
  return ctx.get<Snapshot>(Store.Snapshots, id);
}

export async function listNoteSnapshots(
  ctx: RepoContext,
  noteId: EntityId,
): Promise<Snapshot[]> {
  const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'noteId', noteId);
  return snapshots.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}

export async function listLinkSnapshots(
  ctx: RepoContext,
  linkId: EntityId,
): Promise<Snapshot[]> {
  const snapshots = await ctx.getByIndex<Snapshot>(Store.Snapshots, 'linkId', linkId);
  return snapshots.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
}

/** Mark a snapshot canceled (user action); pending artifacts become canceled. */
export async function cancelSnapshot(ctx: RepoContext, id: EntityId): Promise<Snapshot> {
  const snapshot = await getSnapshot(ctx, id);
  if (!snapshot) throw new SnapshotNotFoundError(id);
  const cancel = (state: CaptureArtifactState): CaptureArtifactState =>
    state === 'pending' ? 'canceled' : state;
  return patchSnapshot(ctx, id, {
    mhtml: cancel(snapshot.mhtml),
    png: cancel(snapshot.png),
    text: cancel(snapshot.text),
  });
}

export async function setSnapshotStatus(
  ctx: RepoContext,
  id: EntityId,
  status: CaptureStatus,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, { status });
}

export async function addSnapshotWarning(
  ctx: RepoContext,
  id: EntityId,
  warning: CaptureWarning,
): Promise<void> {
  const snapshot = await getSnapshot(ctx, id);
  if (!snapshot) throw new SnapshotNotFoundError(id);
  await patchSnapshot(ctx, id, { warnings: [...snapshot.warnings, warning] });
}

/* ------------------------------------------------------------------ */
/* Artifact persistence                                                */
/* ------------------------------------------------------------------ */

export async function saveMhtmlArtifact(
  ctx: RepoContext,
  id: EntityId,
  data: Blob,
): Promise<Snapshot> {
  const bytes = new Uint8Array(await data.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const key = await putBlob(ctx, 'mhtml', data, hash);
  const size = data.size;
  return patchSnapshot(ctx, id, {
    mhtml: 'saved',
    mhtmlBlobKey: key,
    mhtmlHash: hash,
    mhtmlSize: size,
  });
}

export async function markMhtmlArtifact(
  ctx: RepoContext,
  id: EntityId,
  state: Extract<CaptureArtifactState, 'failed' | 'canceled' | 'not-attempted'>,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, { mhtml: state });
}

export async function savePngArtifact(
  ctx: RepoContext,
  id: EntityId,
  data: Blob,
): Promise<Snapshot> {
  const bytes = new Uint8Array(await data.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const key = await putBlob(ctx, 'png', data, hash);
  const size = data.size;
  return patchSnapshot(ctx, id, {
    png: 'saved',
    pngBlobKey: key,
    pngHash: hash,
    pngSize: size,
  });
}

export async function markPngArtifact(
  ctx: RepoContext,
  id: EntityId,
  state: Extract<CaptureArtifactState, 'failed' | 'canceled' | 'not-attempted'>,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, { png: state });
}

export async function saveTextArtifact(
  ctx: RepoContext,
  id: EntityId,
  text: string,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, {
    text: 'saved',
    extractedText: text,
    textSize: text.length,
  });
}

export async function markTextArtifact(
  ctx: RepoContext,
  id: EntityId,
  state: Extract<CaptureArtifactState, 'failed' | 'canceled' | 'not-attempted'>,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, { text: state });
}

export async function renameSnapshot(
  ctx: RepoContext,
  id: EntityId,
  title: string,
): Promise<Snapshot> {
  return patchSnapshot(ctx, id, { title });
}

/* ------------------------------------------------------------------ */
/* Integrity and deletion                                              */
/* ------------------------------------------------------------------ */

export interface IntegrityReport {
  readonly mhtml: 'ok' | 'missing' | 'hash-mismatch' | 'not-saved';
  readonly png: 'ok' | 'missing' | 'hash-mismatch' | 'not-saved';
}

/** Recompute hashes from stored blobs and compare (diagnostics, restore). */
export async function verifySnapshotIntegrity(
  ctx: RepoContext,
  id: EntityId,
): Promise<IntegrityReport> {
  const snapshot = await getSnapshot(ctx, id);
  if (!snapshot) throw new SnapshotNotFoundError(id);
  const check = async (
    saved: CaptureArtifactState,
    blobKey: string | null,
    expected: ContentHash | null,
  ): Promise<IntegrityReport['mhtml']> => {
    if (saved !== 'saved') return 'not-saved';
    if (!blobKey || !expected) return 'missing';
    const blob = await getBlob(ctx, blobKey as BlobKey);
    if (!blob) return 'missing';
    const actual = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    return actual === expected ? 'ok' : 'hash-mismatch';
  };
  return {
    mhtml: await check(snapshot.mhtml, snapshot.mhtmlBlobKey, snapshot.mhtmlHash),
    png: await check(snapshot.png, snapshot.pngBlobKey, snapshot.pngHash),
  };
}

/** Delete a snapshot record; blobs are removed only when unreferenced. */
export async function deleteSnapshot(ctx: RepoContext, id: EntityId): Promise<void> {
  const snapshot = await getSnapshot(ctx, id);
  if (!snapshot) throw new SnapshotNotFoundError(id);
  await ctx.transaction([Store.Snapshots], 'readwrite', (stores) => {
    stores[Store.Snapshots]?.delete(id);
  });
  if (snapshot.mhtmlBlobKey) {
    await removeBlobIfUnreferenced(ctx, snapshot.mhtmlBlobKey);
  }
  if (snapshot.pngBlobKey && snapshot.pngBlobKey !== snapshot.mhtmlBlobKey) {
    await removeBlobIfUnreferenced(ctx, snapshot.pngBlobKey);
  }
}

export { blobKeyFor };
