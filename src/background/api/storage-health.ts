/**
 * Storage health (FR-DATA-02/07): navigator.storage persistence request,
 * usage estimation, per-kind size reporting (archives/attachments/logs and
 * the rest) and the explicit data-loss warning text used before destructive
 * operations. Honest about browser limits: unlimitedStorage is a request,
 * not a guarantee; disk capacity and profile lifecycle still bound usage.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { Store } from '../../core/db/schema';
import { listBlobs, blobBytes } from '../../core/repo/blobs';
import { listLogs, countLogs } from '../../core/repo/logs';

export interface StorageHealthReport {
  /** navigator.storage.estimate() when available (null = unsupported). */
  readonly quota: { usage: number; quota: number } | null;
  /** navigator.storage.persisted() result when available. */
  readonly persisted: boolean | null;
  /** Bytes per blob kind (mhtml archives / png screenshots / attachments). */
  readonly blobKinds: { mhtml: number; png: number; attachments: number };
  readonly blobBytesTotal: number;
  readonly logEntries: number;
  readonly logBytes: number;
  readonly counts: {
    notes: number;
    snapshots: number;
    attachments: number;
    reminders: number;
    revisions: number;
    auditEvents: number;
  };
  /** True when usage crosses the settings warning threshold. */
  readonly warning: { active: boolean; detail: string };
}

/** The explicit data-loss warning (FR-DATA-07), shown before resets. */
export const DATA_LOSS_WARNING =
  'Uninstalling the extension, deleting the Chrome profile, or clearing extension data deletes this local database — there is no cloud copy. Export a backup first: the complete ZIP archive restores everything on any machine.';

async function countStore(ctx: Awaited<ReturnType<typeof repo>>, store: string): Promise<number> {
  return ctx.count(store as never).catch(() => 0);
}

export async function readStorageHealth(): Promise<StorageHealthReport> {
  const ctx = await repo();

  const [blobs, logCount, notes, snapshots, attachments, reminders, revisions, auditEvents] =
    await Promise.all([
      listBlobs(ctx),
      countLogs(ctx).catch(() => 0),
      countStore(ctx, Store.Notes),
      countStore(ctx, Store.Snapshots),
      countStore(ctx, Store.Attachments),
      countStore(ctx, Store.Reminders),
      countStore(ctx, Store.Revisions),
      countStore(ctx, Store.AuditEvents),
    ]);

  const blobKinds = { mhtml: 0, png: 0, attachments: 0 };
  for (const blob of blobs) {
    if (blob.kind === 'mhtml') blobKinds.mhtml += blob.size;
    else if (blob.kind === 'png') blobKinds.png += blob.size;
    else blobKinds.attachments += blob.size;
  }

  let quota: { usage: number; quota: number } | null = null;
  let persisted: boolean | null = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      quota = { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    } catch {
      quota = null;
    }
  }
  if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    try {
      persisted = await navigator.storage.persisted();
    } catch {
      persisted = null;
    }
  }

  // Log bytes: sum the serialized entry sizes (bounded sweep, 200 newest).
  const logs = await listLogs(ctx, 200);
  let logBytes = 0;
  for (const entry of logs) {
    logBytes += JSON.stringify(entry).length;
  }

  let warning = { active: false, detail: '' };
  if (quota !== null && quota.quota > 0) {
    const ratio = quota.usage / quota.quota;
    if (ratio >= 0.9) {
      warning = {
        active: true,
        detail: `Browser storage is ${Math.round(ratio * 100)}% full — export a backup and remove unneeded captures.`,
      };
    }
  }

  return {
    quota,
    persisted,
    blobKinds,
    blobBytesTotal: await blobBytes(ctx),
    logEntries: logCount,
    logBytes,
    counts: { notes, snapshots, attachments, reminders, revisions, auditEvents },
    warning,
  };
}

/** Best-effort persistence request (FR-DATA-02); truthful outcome. */
export async function requestPersistence(): Promise<{ requested: boolean; persisted: boolean | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { requested: false, persisted: null };
  }
  try {
    const persisted = await navigator.storage.persist();
    return { requested: true, persisted };
  } catch {
    return { requested: false, persisted: null };
  }
}

export function registerStorageHealthApi(router: MessageRouter): void {
  router.register('storage/health', async () => ({ report: await readStorageHealth() }));
  router.register('storage/request-persistence', async () => requestPersistence());
  router.register('storage/data-loss-warning', async () => ({ warning: DATA_LOSS_WARNING }));
}
