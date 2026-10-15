import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../../src/background/db';
import { MessageRouter, toRpcError } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { newCorrelationId, RPC_KIND, type RpcRequest } from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import { listLogs } from '../../../../src/core/repo/logs';
import { NoteConflictError } from '../../../../src/core/repo/notes';
import { MigrationFailedError } from '../../../../src/core/db/open';
import { InvalidUrlError } from '../../../../src/core/repo/links';
import { AttachmentTooLargeError } from '../../../../src/core/repo/attachments';
import type { DiagnosticLog, EntityId } from '../../../../src/core/types';

/**
 * T-041 §12 error-state matrix sweep: every PRD §12 state maps onto a coded,
 * actionable failure. This suite pins the storage-full mapping (the one
 * behavioral gap the sweep found) and cross-checks the remaining coded
 * states through toRpcError so a regression cannot silently drop a state.
 * Behavioural coverage for each state lives in its dedicated suite:
 * save-failed → controller.test.ts, conflict → editor-session/handlers,
 * migration-failed → db.test.ts + router.test.ts, permission-denied →
 * permissions.test.ts + capture-queue.test.ts, URL-unsupported → util.test.ts,
 * capture timeout/partial/failed → capture-queue/capture-steps, backup-invalid
 * /restore-failed → backup.test.ts, notifications-denied + reminder-missed →
 * reminders-notify.test.ts, AI-unavailable/tool-malformed/tool-denied →
 * ai-client/ai-dispatcher/ai-agent.
 */

let router: MessageRouter;
let installed: InstalledMock;

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

describe('storage-full error state (PRD §12 gap, now coded)', () => {
  it('maps QuotaExceededError onto the coded, actionable storage-full state', () => {
    const quotaError = new Error('The transaction failed: storage quota exceeded');
    quotaError.name = 'QuotaExceededError';
    const mapped = toRpcError(quotaError);
    expect(mapped.code).toBe('storage-full');
    expect(mapped.message).toContain('not saved');
    expect(mapped.message).toContain('export a backup');
  });

  it('maps Firefox-style device-space failures the same way', () => {
    const firefoxError = new Error('NS_ERROR_FILE_NO_DEVICE_SPACE: no device space');
    const mapped = toRpcError(firefoxError);
    expect(mapped.code).toBe('storage-full');
  });

  it('does not misclassify ordinary errors as storage-full', () => {
    expect(toRpcError(new Error('network unavailable')).code).toBe('internal-error');
    expect(toRpcError(new TypeError('cannot read properties of undefined')).code).toBe('internal-error');
  });

  it('a quota failure in a handler surfaces the coded state and a structured log', async () => {
    const failing = new MessageRouter();
    failing.register('notes/save', async () => {
      const error = new Error('quota exceeded while writing the blob store');
      error.name = 'QuotaExceededError';
      throw error;
    });
    const request: RpcRequest = {
      kind: RPC_KIND,
      id: newCorrelationId(),
      type: 'notes/save',
      payload: {},
    };
    const response = await failing.dispatch(request);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('storage-full');
    }

    const logs = await listLogs(await repo(), 50);
    const entry = logs.find(
      (log) => log.component === 'rpc' && log.operationId === 'notes/save',
    ) as DiagnosticLog | undefined;
    expect(entry?.level).toBe('error');
    expect(entry?.resultCode).toBe('storage-full');
  });
});

describe('§12 matrix cross-check (coded states stay mapped)', () => {
  it('maps every domain error family onto its PRD §12 code', () => {
    const noteId = 'note-1' as EntityId;
    const revisionId = 'rev-1' as EntityId;
    expect(toRpcError(new NoteConflictError(noteId, revisionId, null)).code).toBe('conflict');
    expect(toRpcError(new MigrationFailedError(1, 2, 'boom')).code).toBe('migration-failed');
    expect(toRpcError(new InvalidUrlError('ftp://example.com')).code).toBe('invalid-url');
    expect(toRpcError(new AttachmentTooLargeError(10, 5)).code).toBe('attachment-too-large');
    expect(toRpcError(new Error('anything else')).code).toBe('internal-error');
    expect(toRpcError('plain string failure' as unknown as Error).code).toBe('internal-error');
  });
});
