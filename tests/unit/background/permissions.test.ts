import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import {
  newCorrelationId,
  RPC_KIND,
  type RpcRequest,
  type RpcResponse,
} from '../../../src/background/protocol';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { getSettings } from '../../../src/core/repo/settings';
import {
  createLink,
  nextCaptureStateOnPermissionEvent,
} from '../../../src/core/repo/links';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Link, Note } from '../../../src/core/types';

/**
 * T-021 origin permission manager (FR-CAP-02, FR-SET-03): the pure
 * permission state machine, exact-origin chrome.permissions requests from a
 * user gesture, decline semantics (retained link, no silent retry),
 * revocation (grants list, per-origin link demotion, settings mirror) and
 * the queue-time access checks in detect-and-queue / queue-capture.
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

async function seedNote(title: string): Promise<Note> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return result['note'] as Note;
}

async function seedLink(noteId: EntityId, url: string, state: Link['captureState']): Promise<Link> {
  const { link } = await createLink(await repo(), noteId, url, '', state);
  return link;
}

async function linksOfNote(noteId: EntityId): Promise<Link[]> {
  const { links } = (await ok('links/list-for-note', { noteId })) as { links: Link[] };
  return links;
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

describe('permission state machine (pure, FR-CAP-02)', () => {
  const ALL_STATES: Link['captureState'][] = [
    'detected',
    'queued',
    'permission-required',
    'capturing',
    'captured',
    'failed',
  ];

  it('grant resumes only links waiting on permission', () => {
    for (const state of ALL_STATES) {
      const next = nextCaptureStateOnPermissionEvent(state, 'grant');
      if (state === 'permission-required') {
        expect(next).toBe('queued');
      } else {
        expect(next, `grant on ${state}`).toBeNull();
      }
    }
  });

  it('decline never changes state — no retry without another user action', () => {
    for (const state of ALL_STATES) {
      expect(nextCaptureStateOnPermissionEvent(state, 'decline'), `decline on ${state}`).toBeNull();
    }
  });

  it('revoke returns pending capture work to permission-required and keeps the rest', () => {
    const expected: Partial<Record<Link['captureState'], Link['captureState'] | null>> = {
      detected: null,
      queued: 'permission-required',
      'permission-required': null,
      capturing: 'permission-required',
      captured: null,
      failed: null,
    };
    for (const state of ALL_STATES) {
      expect(nextCaptureStateOnPermissionEvent(state, 'revoke'), `revoke on ${state}`).toBe(
        expected[state],
      );
    }
  });
});

describe('originPattern (exact-origin match patterns)', () => {
  it('maps bare http(s) origins to exact-origin patterns', async () => {
    const { originPattern } = await import('../../../src/background/permissions');
    expect(originPattern('https://example.com')).toBe('https://example.com/*');
    expect(originPattern('http://example.org')).toBe('http://example.org/*');
    expect(originPattern('https://example.com:8443')).toBe('https://example.com:8443/*');
  });

  it('rejects anything that is not a bare http(s) origin', async () => {
    const { originPattern } = await import('../../../src/background/permissions');
    expect(originPattern('ftp://example.com')).toBeNull();
    expect(originPattern('chrome-extension://abc')).toBeNull();
    expect(originPattern('https://example.com/path')).toBeNull();
    expect(originPattern('https://example.com/?q=1')).toBeNull();
    expect(originPattern('not a url')).toBeNull();
  });
});

describe('listGrantedCaptureOrigins (FR-SET-03)', () => {
  it('reports granted web origins, excluding manifest-required loopback', async () => {
    const { listGrantedCaptureOrigins } = await import('../../../src/background/permissions');
    installed.permissions.grantedPatterns.add('https://example.com/*');
    installed.permissions.grantedPatterns.add('http://other.example:8080/*');
    const origins = await listGrantedCaptureOrigins();
    expect(origins).toEqual(['http://other.example:8080', 'https://example.com']);
  });

  it('permissions/list-granted returns per-origin link and waiting counts', async () => {
    const note = await seedNote('Counts note');
    installed.permissions.grantedPatterns.add('https://example.com/*');
    await seedLink(note.id, 'https://example.com/one', 'permission-required');
    await seedLink(note.id, 'https://example.com/two', 'captured');

    const { origins } = (await ok('permissions/list-granted', {})) as {
      origins: Array<{ origin: string; linkCount: number; waitingCount: number }>;
    };
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({ origin: 'https://example.com', linkCount: 2, waitingCount: 1 });
  });
});

describe('links/request-capture-permission (Allow access and capture)', () => {
  it('requests the exact origin from the user gesture and resumes capture on grant', async () => {
    const note = await seedNote('Grant note');
    const link = await seedLink(note.id, 'https://example.com/article', 'permission-required');
    installed.permissions.gestureActive = true;

    const result = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      alreadyGranted: boolean;
      link: Link;
    };
    expect(result.granted).toBe(true);
    expect(result.alreadyGranted).toBe(false);
    expect(result.link.captureState).toBe('queued');
    expect(installed.permissions.requestCalls).toEqual([['https://example.com/*']]);
    expect(installed.permissions.grantedPatterns.has('https://example.com/*')).toBe(true);

    // Settings mirror records the granted origin (FR-SET-01 bookkeeping).
    const settings = await getSettings(await repo());
    expect(settings.allowedOrigins).toContain('https://example.com');

    const events = await listAuditEvents(await repo(), { limit: 20 });
    const event = events.find((e) => e.action === 'permissions/request' && e.outcome === 'succeeded');
    expect(event?.detail).toContain('origin=https://example.com');
  });

  it('recognizes an already-granted origin without prompting again', async () => {
    const note = await seedNote('Already note');
    const link = await seedLink(note.id, 'https://example.com/held', 'permission-required');
    installed.permissions.grantedPatterns.add('https://example.com/*');

    const result = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      alreadyGranted: boolean;
      link: Link;
    };
    expect(result.granted).toBe(true);
    expect(result.alreadyGranted).toBe(true);
    expect(result.link.captureState).toBe('queued');
    expect(installed.permissions.requestCalls).toHaveLength(0);
  });

  it('keeps the link and its permission-required state when the user declines', async () => {
    const note = await seedNote('Decline note');
    const link = await seedLink(note.id, 'https://example.com/no', 'permission-required');
    installed.permissions.gestureActive = true;
    installed.permissions.forceNextDecline = true;

    const result = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      link: Link;
    };
    expect(result.granted).toBe(false);
    expect(result.link.captureState).toBe('permission-required');

    // No grant recorded anywhere — the link is retained but never retried.
    expect(installed.permissions.grantedPatterns.has('https://example.com/*')).toBe(false);
    const settings = await getSettings(await repo());
    expect(settings.allowedOrigins).not.toContain('https://example.com');
    const links = await linksOfNote(note.id);
    expect(links).toHaveLength(1);

    const events = await listAuditEvents(await repo(), { limit: 20 });
    const event = events.find((e) => e.action === 'permissions/request' && e.outcome === 'failed');
    expect(event?.detail).toContain('declined');
    expect(event?.detail).toContain('no retry');
  });

  it('a request outside a user-gesture window resolves false without state changes', async () => {
    const note = await seedNote('No-gesture note');
    const link = await seedLink(note.id, 'https://example.com/stale', 'permission-required');
    // gestureActive stays false: Chrome refuses permissions.request.

    const result = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      link: Link;
    };
    expect(result.granted).toBe(false);
    expect(result.link.captureState).toBe('permission-required');
  });

  it('refuses gate-ineligible URLs and unknown links', async () => {
    const note = await seedNote('Refuse note');
    const ineligible = await seedLink(note.id, 'http://localhost:9000/x', 'permission-required');
    const gate = await fail('links/request-capture-permission', { linkId: ineligible.id });
    if (!gate.ok) expect(gate.error.code).toBe('invalid-request');

    const { newId } = await import('../../../src/core/util/ids');
    const missing = await fail('links/request-capture-permission', { linkId: newId() });
    if (!missing.ok) expect(missing.error.code).toBe('not-found');
  });

  it('granting does not queue a link that was never waiting on permission', async () => {
    const note = await seedNote('Detected note');
    const link = await seedLink(note.id, 'https://example.com/never-asked', 'detected');
    installed.permissions.gestureActive = true;

    const result = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      link: Link;
    };
    // Access is granted (origin recorded) but a detected link was never
    // asked to capture — only the permission-required state resumes.
    expect(result.granted).toBe(true);
    expect(result.link.captureState).toBe('detected');
  });
});

describe('permissions/revoke (FR-SET-03)', () => {
  it('removes the grant, demotes pending work, keeps captured archives', async () => {
    const note = await seedNote('Revoke note');
    const queued = await seedLink(note.id, 'https://example.com/queued', 'queued');
    const capturing = await seedLink(note.id, 'https://example.com/capturing', 'capturing');
    const captured = await seedLink(note.id, 'https://example.com/captured', 'captured');
    const detected = await seedLink(note.id, 'https://example.com/detected', 'detected');
    await seedLink(note.id, 'https://other.example/untouched', 'queued');
    installed.permissions.grantedPatterns.add('https://example.com/*');
    await ok('settings/patch', { patch: { allowedOrigins: ['https://example.com'] } });

    const result = (await ok('permissions/revoke', { origin: 'https://example.com' })) as {
      revoked: boolean;
      demotedLinks: number;
    };
    expect(result.revoked).toBe(true);
    expect(result.demotedLinks).toBe(2);
    expect(installed.permissions.grantedPatterns.has('https://example.com/*')).toBe(false);

    const settings = await getSettings(await repo());
    expect(settings.allowedOrigins).not.toContain('https://example.com');

    const links = await linksOfNote(note.id);
    const byUrl = new Map(links.map((l) => [l.originalUrl, l.captureState]));
    expect(byUrl.get(queued.originalUrl)).toBe('permission-required');
    expect(byUrl.get(capturing.originalUrl)).toBe('permission-required');
    // Finished archives and never-asked links are untouched; other origins
    // keep their grants and queue positions.
    expect(byUrl.get(captured.originalUrl)).toBe('captured');
    expect(byUrl.get(detected.originalUrl)).toBe('detected');
    expect(byUrl.get('https://other.example/untouched')).toBe('queued');

    const events = await listAuditEvents(await repo(), { limit: 20 });
    const event = events.find((e) => e.action === 'permissions/revoke');
    expect(event?.detail).toContain('origin=https://example.com');
    expect(event?.detail).toContain('demoted=2');
  });

  it('revoking an origin that was never granted is a harmless no-op', async () => {
    const note = await seedNote('No-op note');
    await seedLink(note.id, 'https://fresh.example/a', 'detected');
    const result = (await ok('permissions/revoke', { origin: 'https://fresh.example' })) as {
      demotedLinks: number;
    };
    expect(result.demotedLinks).toBe(0);
    const links = await linksOfNote(note.id);
    expect(links[0]!.captureState).toBe('detected');
  });

  it('rejects malformed origins', async () => {
    const response = await fail('permissions/revoke', { origin: 'https://example.com/path' });
    if (!response.ok) expect(response.error.code).toBe('invalid-request');
    const garbage = await fail('permissions/revoke', { origin: 'not an origin' });
    if (!garbage.ok) expect(garbage.error.code).toBe('invalid-request');
  });
});

describe('queue-time origin access checks (FR-CAP-02)', () => {
  it('pasted eligible URLs park in permission-required when the origin is not authorized', async () => {
    const note = await seedNote('Park note');
    const { results } = (await ok('links/detect-and-queue', {
      noteId: note.id,
      urls: ['https://example.com/locked'],
      source: 'paste',
    })) as { results: Array<{ link?: Link; outcome: string }> };
    expect(results[0]!.link?.captureState).toBe('permission-required');
    expect(results[0]!.link?.originalUrl).toBe('https://example.com/locked');
  });

  it('a re-paste after a grant promotes the parked link to queued', async () => {
    const note = await seedNote('Promote note');
    await ok('links/detect-and-queue', {
      noteId: note.id,
      urls: ['https://example.com/late'],
      source: 'paste',
    });
    installed.permissions.grantedPatterns.add('https://example.com/*');
    const { results } = (await ok('links/detect-and-queue', {
      noteId: note.id,
      urls: ['https://example.com/late'],
      source: 'paste',
    })) as { results: Array<{ link?: Link }> };
    expect(results[0]!.link?.captureState).toBe('queued');
  });

  it('queue-capture reports permissionRequired instead of queueing unauthorized origins', async () => {
    const note = await seedNote('Explicit park note');
    await ok('settings/patch', { patch: { autoCaptureOnPaste: false } });
    const link = await seedLink(note.id, 'https://example.com/want', 'detected');

    const result = (await ok('links/queue-capture', { linkId: link.id })) as {
      link: Link;
      permissionRequired: boolean;
    };
    expect(result.permissionRequired).toBe(true);
    expect(result.link.captureState).toBe('permission-required');

    // Granting access afterwards resumes exactly this flow.
    installed.permissions.gestureActive = true;
    const granted = (await ok('links/request-capture-permission', { linkId: link.id })) as {
      granted: boolean;
      link: Link;
    };
    expect(granted.granted).toBe(true);
    expect(granted.link.captureState).toBe('queued');
  });

  it('queue-capture still queues immediately when the origin is authorized', async () => {
    const note = await seedNote('Fast note');
    const link = await seedLink(note.id, 'https://example.com/granted', 'detected');
    installed.permissions.grantedPatterns.add('https://example.com/*');

    const result = (await ok('links/queue-capture', { linkId: link.id })) as {
      link: Link;
      permissionRequired: boolean;
    };
    expect(result.permissionRequired).toBe(false);
    expect(result.link.captureState).toBe('queued');
  });

  it('manual typed URLs stay detected regardless of grants (never auto-visited)', async () => {
    const note = await seedNote('Manual note');
    installed.permissions.grantedPatterns.add('https://example.com/*');
    const { results } = (await ok('links/detect-and-queue', {
      noteId: note.id,
      urls: ['https://example.com/typed'],
      source: 'manual',
    })) as { results: Array<{ link?: Link }> };
    expect(results[0]!.link?.captureState).toBe('detected');
  });

  it('audit summaries count parked links as permission-required', async () => {
    const note = await seedNote('Audit park note');
    await ok('links/detect-and-queue', {
      noteId: note.id,
      urls: ['https://example.com/parked'],
      source: 'paste',
    });
    const events = await listAuditEvents(await repo(), { limit: 20 });
    const event = events.find((e) => e.action === 'links/detect-and-queue');
    expect(event?.detail).toContain('permission-required=1');
  });
});
