/**
 * SnapshotsApi factory (T-026): the RPC-backed snapshot operations shared by
 * the dashboard controller and the editor-session test stacks — one wiring,
 * no drift between production and tests.
 */

import type { ApiClient } from './client';
import type { SnapshotsApi } from './editor-session';

export function createSnapshotsApi(client: ApiClient): SnapshotsApi {
  return {
    listForNote: async (noteId) =>
      (await client.request('snapshots/list-for-note', { noteId })).snapshots,
    getPng: async (snapshotId) =>
      (await client.request('snapshots/get-png', { snapshotId })).png,
    exportArtifact: async (snapshotId, format) =>
      client.request('snapshots/export', { snapshotId, format }),
    rename: async (snapshotId, title) => {
      try {
        await client.request('snapshots/rename', { snapshotId, title });
        return true;
      } catch {
        return false;
      }
    },
    remove: async (snapshotId) => {
      try {
        await client.request('snapshots/delete', { snapshotId });
        return true;
      } catch {
        return false;
      }
    },
    listLinks: async (noteId) =>
      (await client.request('links/list-for-note', { noteId })).links,
    requestCapturePermission: (linkId) =>
      client.request('links/request-capture-permission', { linkId }).then((r) => ({ granted: r.granted })),
    retryCapture: (linkId) =>
      client.request('capture/retry', { linkId }).then((r) => r.retried),
  };
}
