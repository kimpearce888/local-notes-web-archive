import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import { appendLog } from '../../../src/core/repo/logs';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { DB_NAME } from '../../../src/core/version';
import type { DiagnosticsOverview } from '../../../src/background/api/diagnostics';
import { parseChromeVersion } from '../../../src/background/api/diagnostics';

/**
 * T-038 diagnostics API (FR-LOG-05 / FR-SET-04): the overview aggregates
 * every operational surface honestly, the trails paginate with filters,
 * the network privacy self-test passes against the REAL shipped manifest
 * (the chrome mock's getManifest reads public/manifest.json), and the
 * export bundle carries no note bodies.
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

describe('parseChromeVersion', () => {
  it('extracts the Chrome version and rejects non-Chrome agents honestly', () => {
    expect(parseChromeVersion('Mozilla/5.0 (X11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.62 Safari/537.36')).toBe('126.0.6478.62');
    expect(parseChromeVersion('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.61')).toBe('120.0.0.0');
    expect(parseChromeVersion('Node.js/24')).toBeNull();
    expect(parseChromeVersion('Mozilla/5.0 (Macintosh) Firefox/128.0')).toBeNull();
  });
});

describe('diagnostics/overview', () => {
  it('aggregates environment, storage, index, permissions, notifications and AI truthfully', async () => {
    const note = (await ok('notes/create', { title: 'indexed note' }))['note'] as { id: string };
    const result = await ok('diagnostics/overview', {});
    const overview = result['overview'] as DiagnosticsOverview;

    expect(overview.app.name).toBe('Local Notes & Web Archive');
    expect(overview.app.version).toBe('1.0.3');
    expect(overview.app.schemaVersion).toBe(2);
    expect(overview.app.databaseName).toBe(DB_NAME);
    // Node test host: honest null, never a fabricated Chrome version.
    expect(overview.chrome.version).toBeNull();

    expect(overview.storage.counts.notes).toBe(1);
    expect(overview.searchIndex.documentCount).toBe(1);

    // Permissions come from the real manifest via the mock's getManifest.
    expect(overview.permissions.required).toContain('pageCapture');
    expect(overview.permissions.hostPatterns).toEqual(['http://127.0.0.1/*', 'http://localhost/*']);
    expect(overview.permissions.optionalHostPatterns).toEqual(['http://*/*', 'https://*/*']);
    expect(overview.permissions.grantedOrigins).toEqual([]);

    expect(overview.notifications.manifestPermission).toBe(true);
    expect(overview.notifications.settingEnabled).toBe(true);
    expect(overview.notifications.osLevel).toBe('not-queryable');

    expect(overview.ai.enabled).toBe(false);
    expect(overview.ai.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(overview.ai.loopback).toBe(true);
    expect(overview.ai.permissionMode).toBe('ask-per-write');

    expect(overview.recentCaptureFailures).toEqual([]);
    expect(overview.recentErrors).toEqual([]);
    void note;
  });

  it('surfaces capture failures and recent errors newest-first', async () => {
    const ctx = await repo();
    await appendLog(ctx, {
      level: 'error',
      component: 'capture',
      operationId: 'capture/run',
      resultCode: 'capture-failed',
      message: 'page fetch timed out',
    });
    await appendLog(ctx, {
      level: 'error',
      component: 'rpc',
      operationId: 'notes/save',
      resultCode: 'internal-error',
      message: 'transaction aborted',
    });
    await appendLog(ctx, {
      level: 'info',
      component: 'capture',
      operationId: 'capture/run',
      resultCode: 'capture-complete',
      message: 'saved',
    });

    const result = await ok('diagnostics/overview', {});
    const overview = result['overview'] as DiagnosticsOverview;

    expect(overview.recentCaptureFailures.length).toBe(1);
    expect(overview.recentCaptureFailures[0]?.message).toBe('page fetch timed out');
    expect(overview.recentErrors.length).toBe(2);
    expect(overview.recentErrors[0]?.message).toBe('transaction aborted');
  });
});

describe('diagnostics/logs and diagnostics/audit', () => {
  it('paginates logs and filters by level', async () => {
    const ctx = await repo();
    for (let i = 0; i < 5; i++) {
      await appendLog(ctx, {
        level: i % 2 === 0 ? 'error' : 'info',
        component: 'test',
        operationId: `op-${i}`,
        resultCode: 'ok',
        message: `entry ${i}`,
      });
    }
    const all = await ok('diagnostics/logs', { limit: 3, offset: 0 });
    expect(all['total']).toBe(5);
    expect((all['logs'] as unknown[]).length).toBe(3);

    const errorsOnly = await ok('diagnostics/logs', { level: 'error' });
    expect(errorsOnly['total']).toBe(3);
    const errorLogs = errorsOnly['logs'] as { level: string }[];
    expect(errorLogs.every((entry) => entry.level === 'error')).toBe(true);

    const combined = await ok('diagnostics/logs', { level: 'error+warn' });
    expect(combined['total']).toBe(3);
  });

  it('paginates the audit trail and filters by actor', async () => {
    await ok('tags/create', { name: 'audited' });
    const page = await ok('diagnostics/audit', { limit: 10 });
    expect(page['total']).toBeGreaterThanOrEqual(1);
    const events = page['events'] as { actor: string; action: string }[];
    expect(events.some((event) => event.action === 'tags/create' && event.actor === 'user')).toBe(true);

    const aiOnly = await ok('diagnostics/audit', { actor: 'ai' });
    const aiEvents = aiOnly['events'] as { actor: string }[];
    expect(aiEvents.every((event) => event.actor === 'ai')).toBe(true);
  });
});

describe('diagnostics/network-self-test', () => {
  it('passes every check against the real shipped manifest', async () => {
    const result = await ok('diagnostics/network-self-test', {});
    const selfTest = result['result'] as {
      checks: { id: string; label: string; passed: boolean; detail: string }[];
      passed: boolean;
      scope: string;
    };
    const failed = selfTest.checks.filter((check) => !check.passed);
    expect(failed, `failing checks: ${failed.map((c) => c.id).join(', ')}`).toEqual([]);
    expect(selfTest.passed).toBe(true);
    expect(selfTest.checks.map((check) => check.id).sort()).toEqual([
      'ai-endpoint-loopback',
      'csp-connect-src',
      'csp-script-src',
      'host-permissions',
      'no-remote-resources',
      'optional-host-permissions',
      'required-permissions',
    ]);
    expect(selfTest.scope).toContain('release gate');
  });
});

describe('diagnostics/export-bundle', () => {
  it('carries sanitized diagnostics and never note bodies', async () => {
    await ok('notes/create', {
      title: 'private title',
      editorDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SECRET-BODY-NEVER-EXPORT' }] }] },
    });
    const result = await ok('diagnostics/export-bundle', {});
    const bundle = result['bundle'] as Record<string, unknown>;
    const serialized = JSON.stringify(bundle);

    expect(bundle['format']).toBe('lnwa-diagnostics');
    expect(bundle['version']).toBe(1);
    expect(typeof bundle['exportedAt']).toBe('string');
    expect(bundle['overview']).toBeDefined();
    expect(bundle['networkSelfTest']).toBeDefined();
    expect(Array.isArray(bundle['recentLogs'])).toBe(true);
    expect(Array.isArray(bundle['recentAuditEvents'])).toBe(true);
    // FR-LOG-05: the review step exists because the bundle is sanitized —
    // note content must never appear.
    expect(serialized).not.toContain('SECRET-BODY-NEVER-EXPORT');
    expect(serialized).not.toContain('private title');
  });
});
