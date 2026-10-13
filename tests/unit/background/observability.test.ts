import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { listLogs } from '../../../src/core/repo/logs';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { DB_NAME } from '../../../src/core/version';
import type { AuditEvent, DiagnosticLog } from '../../../src/core/types';

type RpcFailureResponse = Extract<RpcResponse, { ok: false }>;

/**
 * T-037 sweep: the observability contract of FR-LOG-01..04. Every RPC
 * mutation leaves an audit event with actor/action/target/outcome; failed
 * restores refuse with audited outcomes plus a structured error log; the
 * router records infrastructure failures as sanitized diagnostic logs.
 */

let router: MessageRouter;
let installed: InstalledMock;

function call(type: string, payload: unknown): Promise<RpcResponse> {
  const request: RpcRequest = { kind: RPC_KIND, id: newCorrelationId(), type, payload };
  return router.dispatch(request);
}

async function ok(type: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await call(type, payload);
  if (!response.ok) throw new Error(`${type} failed: ${response.error.code} ${response.error.message}`);
  return response.result as Record<string, unknown>;
}

async function fail(type: string, payload: unknown): Promise<RpcFailureResponse> {
  const response = await call(type, payload);
  if (response.ok) throw new Error(`${type} unexpectedly succeeded`);
  return response;
}

async function audits(): Promise<AuditEvent[]> {
  return listAuditEvents(await repo(), { limit: 500 });
}

async function findAudit(action: string): Promise<AuditEvent> {
  const events = (await audits()).filter((event) => event.action === action);
  expect(events.length, `expected exactly one audit event for ${action}`).toBe(1);
  const event = events[0];
  if (!event) throw new Error(`no audit event for ${action}`);
  return event;
}

async function createNote(title: string): Promise<string> {
  const result = await ok('notes/create', { title });
  return (result['note'] as { id: string }).id;
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

describe('organization mutation audit trail', () => {
  it('records tag create/rename/delete and category create with targets', async () => {
    const tag = (await ok('tags/create', { name: 'research' }))['tag'] as { id: string; name: string };
    await ok('tags/rename', { tagId: tag.id, name: 'deep-research' });
    const category = (await ok('categories/create', { name: 'Projects' }))['category'] as { id: string };
    await ok('tags/delete', { tagId: tag.id });

    const created = await findAudit('tags/create');
    expect(created.actor).toBe('user');
    expect(created.targetKind).toBe('tag');
    expect(created.targetId).toBe(tag.id);
    expect(created.outcome).toBe('succeeded');
    expect(created.detail).toContain('research');

    const renamed = await findAudit('tags/rename');
    expect(renamed.changedFields).toEqual(['name']);

    const categoryCreated = await findAudit('categories/create');
    expect(categoryCreated.targetKind).toBe('category');
    expect(categoryCreated.targetId).toBe(category.id);

    const deleted = await findAudit('tags/delete');
    expect(deleted.outcome).toBe('succeeded');
    expect(deleted.targetId).toBe(tag.id);
  });

  it('records bulk tag assignment with counts, not member lists', async () => {
    const noteId = await createNote('bulk target');
    const tag = (await ok('tags/create', { name: 'bulk' }))['tag'] as { id: string };
    await ok('tags/assign-to-notes', { noteIds: [noteId], tagIds: [tag.id] });

    const event = await findAudit('tags/assign-to-notes');
    expect(event.outcome).toBe('succeeded');
    expect(event.changedFields).toEqual(['tags']);
    expect(event.detail).toContain('1 tag(s)');
    // The other note ids must not be enumerated in the trail.
    expect(event.detail).not.toContain(JSON.stringify(noteId));
  });
});

describe('reminder mutation audit trail', () => {
  it('records create, complete and delete with the reminder target', async () => {
    const noteId = await createNote('reminder host');
    const reminder = (await ok('reminders/create', {
      noteId,
      dueAt: '2026-12-25T09:00:00.000Z',
      timeZone: 'UTC',
    }))['reminder'] as { id: string };
    await ok('reminders/complete', { reminderId: reminder.id });
    await ok('reminders/delete', { reminderId: reminder.id });

    const created = await findAudit('reminders/create');
    expect(created.targetKind).toBe('reminder');
    expect(created.targetId).toBe(reminder.id);
    expect(created.changedFields).toEqual(['dueAt']);
    expect(created.detail).toContain('one-time reminder');

    const completed = await findAudit('reminders/complete');
    expect(completed.changedFields).toEqual(['state']);

    const deleted = await findAudit('reminders/delete');
    expect(deleted.outcome).toBe('succeeded');
  });
});

describe('settings mutation audit trail', () => {
  it('records changed-field NAMES only, never values', async () => {
    await ok('settings/patch', { patch: { revisionRetention: 25, autoCaptureOnPaste: true } });
    await ok('settings/set-onboarding-complete', { complete: true });

    const patched = await findAudit('settings/patch');
    expect(patched.targetKind).toBe('settings');
    expect(patched.outcome).toBe('succeeded');
    expect([...patched.changedFields].sort()).toEqual(['autoCaptureOnPaste', 'revisionRetention']);
    // Values (retention counts, flags) never enter the trail.
    expect(patched.detail).not.toContain('25');
    expect(patched.detail).toContain('2 setting field(s)');

    const onboarding = await findAudit('settings/set-onboarding-complete');
    expect(onboarding.changedFields).toEqual(['onboardingComplete']);
    expect(onboarding.detail).toContain('complete');
  });
});

describe('data lifecycle audit trail', () => {
  it('records note export and backup export with truthful counts', async () => {
    const noteId = await createNote('export me');
    await ok('notes/export-file', { noteId });
    await ok('backup/export', {});

    const noteExport = await findAudit('notes/export-file');
    expect(noteExport.targetKind).toBe('note');
    expect(noteExport.targetId).toBe(noteId);
    expect(noteExport.detail).toContain('lnwa-note JSON');

    const backupExport = await findAudit('backup/export');
    expect(backupExport.targetKind).toBe('backup');
    expect(backupExport.detail).toContain('1 note(s)');
  });

  it('audits a rejected restore as failed and writes a structured error log', async () => {
    const garbage = new Blob(['this is not a zip archive'], { type: 'application/zip' });
    const response = await fail('backup/restore', { archive: garbage, mode: 'merge' });
    expect(response.error.code).toBe('invalid-request');

    const failed = await findAudit('backup/restore');
    expect(failed.outcome).toBe('failed');
    expect(failed.detail).toContain('database untouched');

    const logs = await listLogs(await repo(), 50);
    const restoreLog = logs.find(
      (entry) => entry.component === 'backup' && entry.operationId === 'backup/restore',
    ) as DiagnosticLog | undefined;
    expect(restoreLog).toBeDefined();
    expect(restoreLog?.level).toBe('error');
    expect(restoreLog?.resultCode).toBe('restore-rejected');
    expect(restoreLog?.correlationId).toBe(failed.correlationId);
  });

  it('audits an unconfirmed replace restore as denied, exactly once', async () => {
    const garbage = new Blob(['x'], { type: 'application/zip' });
    const response = await fail('backup/restore', {
      archive: garbage,
      mode: 'replace',
      confirmReplace: false,
    });
    expect(response.error.code).toBe('invalid-request');

    const events = (await audits()).filter((event) => event.action === 'backup/restore');
    expect(events.length).toBe(1);
    const denied = events[0];
    if (!denied) throw new Error('no denied audit event');
    expect(denied.outcome).toBe('denied');
    expect(denied.detail).toContain('confirmation missing');
  });
});

describe('router structured error logging', () => {
  it('writes a sanitized diagnostic log when a handler fails internally', async () => {
    const failing = new MessageRouter();
    failing.register('explode/now', async () => {
      throw new Error('boom with token=super-secret-value');
    });
    const request: RpcRequest = {
      kind: RPC_KIND,
      id: newCorrelationId(),
      type: 'explode/now',
      payload: {},
    };
    const response = await failing.dispatch(request);
    expect(response.ok).toBe(false);

    const logs = await listLogs(await repo(), 50);
    const entry = logs.find((log) => log.operationId === 'explode/now') as DiagnosticLog | undefined;
    expect(entry).toBeDefined();
    expect(entry?.component).toBe('rpc');
    expect(entry?.level).toBe('error');
    expect(entry?.resultCode).toBe('internal-error');
    expect(entry?.correlationId).toBe(request.id);
    // FR-LOG-03: the secret value never survives into the stored message.
    expect(entry?.message).not.toContain('super-secret-value');
    expect(entry?.message).toContain('token');
  });

  it('does not log expected domain failures', async () => {
    await fail('tags/create', {});
    const logs = await listLogs(await repo(), 50);
    const rpcLogs = logs.filter((log) => log.component === 'rpc');
    expect(rpcLogs.length).toBe(0);
  });
});
