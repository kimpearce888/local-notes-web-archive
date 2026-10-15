import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../../src/background/protocol';
import { reminderAlarmName } from '../../../../src/background/alarms';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId } from '../../../../src/core/types';

/**
 * T-012 end-to-end: the full handler surface over fake-indexeddb, exercised
 * exactly the way the dashboard will drive it (typed RPC with correlation
 * ids, coded failures).
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

async function fail(type: string, payload: unknown): Promise<RpcResponse> {
  const response = await call(type, payload);
  if (response.ok) throw new Error(`${type} unexpectedly succeeded`);
  return response;
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

describe('notes API', () => {
  it('creates a note, deriving the plain-text projection server-side', async () => {
    const result = await ok('notes/create', {
      title: 'Groceries',
      editorDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'milk and eggs' }] }] },
    });
    const note = result['note'] as { title: string; plainText: string; state: string };
    expect(note.title).toBe('Groceries');
    expect(note.plainText).toBe('milk and eggs');
    expect(note.state).toBe('active');
  });

  it('saves with revision tracking and detects multi-tab conflicts (FR-NOTE-07)', async () => {
    const created = (await ok('notes/create', { title: 'A', plainText: 'one' }))['note'] as {
      id: string;
      revisionId: string | null;
    };
    const saved = (await ok('notes/save', {
      noteId: created.id,
      title: 'A',
      subtitle: '',
      editorDoc: null,
      plainText: 'two',
      expectedRevisionId: created.revisionId,
      changeSummary: 'edit',
    }))['note'] as { revisionId: string | null; plainText: string };

    expect(saved.plainText).toBe('two');
    expect(saved.revisionId).not.toBe(created.revisionId);

    // A stale tab now saves against the pre-edit revision → conflict, no
    // silent overwrite.
    const conflict = await fail('notes/save', {
      noteId: created.id,
      title: 'A',
      subtitle: '',
      editorDoc: null,
      plainText: 'stale',
      expectedRevisionId: created.revisionId,
      changeSummary: 'stale edit',
    });
    if (!conflict.ok) expect(conflict.error.code).toBe('conflict');
  });

  it('rejects malformed payloads as invalid-request', async () => {
    const response = await fail('notes/create', { title: 42 });
    if (!response.ok) expect(response.error.code).toBe('invalid-request');
    const missing = await fail('notes/get', {});
    if (!missing.ok) expect(missing.error.code).toBe('invalid-request');
  });

  it('404s missing notes', async () => {
    const response = await fail('notes/get', {
      noteId: '00000000-0000-4000-8000-000000000000',
    });
    if (!response.ok) expect(response.error.code).toBe('not-found');
  });

  it('notes/set-appearance sets, keeps and clears card colors (T-107)', async () => {
    const created = (await ok('notes/create', { title: 'Color', plainText: 'x' }))['note'] as { id: string };
    const tinted = (await ok('notes/set-appearance', {
      noteId: created.id,
      cardBackgroundColor: '#1c6b3c',
    }))['note'] as { cardBackgroundColor: string | null; cardForegroundColor: string | null };
    expect(tinted.cardBackgroundColor).toBe('#1c6b3c');
    expect(tinted.cardForegroundColor).toBeNull();

    const both = (await ok('notes/set-appearance', {
      noteId: created.id,
      cardForegroundColor: '#f2f3f7',
    }))['note'] as { cardBackgroundColor: string | null; cardForegroundColor: string | null };
    expect(both.cardBackgroundColor).toBe('#1c6b3c');
    expect(both.cardForegroundColor).toBe('#f2f3f7');

    const cleared = (await ok('notes/set-appearance', {
      noteId: created.id,
      cardBackgroundColor: null,
      cardForegroundColor: null,
    }))['note'] as { cardBackgroundColor: string | null; cardForegroundColor: string | null };
    expect(cleared.cardBackgroundColor).toBeNull();
    expect(cleared.cardForegroundColor).toBeNull();
  });

  it('notes/set-appearance rejects non-hex colors as invalid-request (T-107)', async () => {
    const created = (await ok('notes/create', { title: 'Guard', plainText: 'x' }))['note'] as { id: string };
    for (const bad of ['#F2C94C', 'red', 'red; } body { display: none', 'rgb(1,2,3)', '#12345', '']) {
      const response = await fail('notes/set-appearance', { noteId: created.id, cardBackgroundColor: bad });
      if (!response.ok) expect(response.error.code).toBe('invalid-request');
    }
    // Uppercase hex is rejected too — the strict lowercase form only.
    const upper = await fail('notes/set-appearance', { noteId: created.id, cardForegroundColor: '#AABBCC' });
    if (!upper.ok) expect(upper.error.code).toBe('invalid-request');
  });

  it('walks the full lifecycle: flags → duplicate → trash → restore → permanent delete', async () => {
    const created = (await ok('notes/create', { title: 'L', plainText: 'x' }))['note'] as {
      id: string;
      state: string;
    };
    const pinned = (await ok('notes/set-flags', { noteId: created.id, pinned: true }))['note'] as { pinned: boolean };
    expect(pinned.pinned).toBe(true);

    const copy = (await ok('notes/duplicate', { noteId: created.id }))['note'] as { id: string; title: string };
    expect(copy.id).not.toBe(created.id);

    const trashed = (await ok('notes/trash', { noteId: created.id }))['note'] as { state: string };
    expect(trashed.state).toBe('trashed');

    const counts = (await ok('notes/counts', {}))['counts'] as { active: number; trashed: number };
    expect(counts.trashed).toBe(1);
    expect(counts.active).toBe(1);

    const restored = (await ok('notes/restore', { noteId: created.id }))['note'] as { state: string };
    expect(restored.state).toBe('active');

    const noConfirm = await fail('notes/delete-permanently', { noteId: created.id });
    if (!noConfirm.ok) expect(noConfirm.error.code).toBe('invalid-request');

    const confirmed = await ok('notes/delete-permanently', { noteId: created.id, confirm: true });
    expect(confirmed['deleted']).toBe(true);
    const gone = await fail('notes/get', { noteId: created.id });
    if (!gone.ok) expect(gone.error.code).toBe('not-found');
  });

  it('lists notes filtered by state', async () => {
    await ok('notes/create', { title: 'keep', plainText: 'a' });
    const trashed = (await ok('notes/create', { title: 'gone', plainText: 'b' }))['note'] as { id: string };
    await ok('notes/trash', { noteId: trashed.id });
    const active = (await ok('notes/list', { state: 'active' }))['notes'] as Array<{ title: string }>;
    expect(active.map((n) => n.title)).toEqual(['keep']);
    const inTrash = (await ok('notes/list', { state: 'trashed' }))['notes'] as Array<{ title: string }>;
    expect(inTrash.map((n) => n.title)).toEqual(['gone']);
  });

  it('serves related entities in one round trip', async () => {
    const created = (await ok('notes/create', { title: 'R', plainText: 'r' }))['note'] as { id: string };
    const tag = (await ok('tags/create', { name: 'research' }))['tag'] as { id: string };
    const category = (await ok('categories/create', { name: 'Projects' }))['category'] as { id: string };
    await ok('tags/set-note-tags', { noteId: created.id, tagIds: [tag.id] });
    await ok('categories/set-note-categories', { noteId: created.id, categoryIds: [category.id] });
    await ok('links/create', { noteId: created.id, url: 'https://example.org/' });

    const related = await ok('notes/related', { noteId: created.id });
    expect((related['tags'] as Array<{ name: string }>).map((t) => t.name)).toEqual(['research']);
    expect((related['categories'] as Array<{ name: string }>).map((c) => c.name)).toEqual(['Projects']);
    expect(related['links']).toHaveLength(1);
    expect(related['reminders']).toHaveLength(0);
  });
});

describe('search API', () => {
  it('finds notes by body text and keeps the index fresh across saves', async () => {
    const created = (await ok('notes/create', { title: 'Trip', plainText: 'passport and tickets' }))['note'] as {
      id: string;
      revisionId: string | null;
    };
    let search = (await ok('search/query', { query: 'passport' })) as { total: number };
    expect(search.total).toBe(1);

    await ok('notes/save', {
      noteId: created.id,
      title: 'Trip',
      subtitle: '',
      editorDoc: null,
      plainText: 'visa and documents',
      expectedRevisionId: created.revisionId,
      changeSummary: 'edit',
    });
    search = (await ok('search/query', { query: 'passport' })) as { total: number };
    expect(search.total).toBe(0);
    search = (await ok('search/query', { query: 'visa' })) as { total: number };
    expect(search.total).toBe(1);
  });

  it('supports tag filters and sort orders', async () => {
    const a = (await ok('notes/create', { title: 'Alpha', plainText: 'content a' }))['note'] as { id: string };
    await ok('notes/create', { title: 'Beta', plainText: 'content b' });
    const tag = (await ok('tags/create', { name: 'solo' }))['tag'] as { id: string };
    await ok('tags/set-note-tags', { noteId: a.id, tagIds: [tag.id] });

    const filtered = (await ok('search/query', {
      query: '',
      filters: { tagIds: [tag.id] },
      sort: { field: 'title', direction: 'asc' },
    })) as { total: number; hits: Array<{ noteId: string }> };
    expect(filtered.total).toBe(1);
    expect(filtered.hits[0]?.noteId).toBe(a.id);
  });

  it('reports inline query errors for malformed syntax (FR-SEARCH-04)', async () => {
    const result = (await ok('search/query', { query: 'tag:' })) as { queryErrors: string[] };
    expect(result.queryErrors.length).toBeGreaterThan(0);
  });

  it('rebuilds the index on demand', async () => {
    await ok('notes/create', { title: 'rebuild me', plainText: 'zzz' });
    const result = (await ok('search/rebuild', {})) as { indexed: number };
    expect(result.indexed).toBe(1);
    const status = (await ok('search/status', {})) as { documentCount: number };
    expect(status.documentCount).toBe(1);
  });
});

describe('organization API', () => {
  it('manages tags with duplicate rejection and bulk assignment (FR-NOTE-08)', async () => {
    const tag = (await ok('tags/create', { name: 'Work' }))['tag'] as { id: string };
    const duplicate = await fail('tags/create', { name: 'work' });
    if (!duplicate.ok) expect(duplicate.error.code).toBe('duplicate');

    const n1 = (await ok('notes/create', { title: 'n1', plainText: 'x' }))['note'] as { id: string };
    const n2 = (await ok('notes/create', { title: 'n2', plainText: 'y' }))['note'] as { id: string };
    await ok('tags/assign-to-notes', { noteIds: [n1.id, n2.id], tagIds: [tag.id] });
    const related = (await ok('notes/related', { noteId: n1.id }))['tags'] as Array<{ name: string }>;
    expect(related).toHaveLength(1);

    const renamed = (await ok('tags/rename', { tagId: tag.id, name: 'Job' }))['tag'] as { name: string };
    expect(renamed.name).toBe('Job');
    await ok('tags/delete', { tagId: tag.id });
    const after = (await ok('notes/related', { noteId: n1.id }))['tags'] as unknown[];
    expect(after).toHaveLength(0);
  });

  it('manages categories with tree, move and delete-reassignment', async () => {
    const parent = (await ok('categories/create', { name: 'Parent' }))['category'] as { id: string };
    const child = (await ok('categories/create', { name: 'Child', parentId: parent.id }))['category'] as {
      id: string;
    };
    const other = (await ok('categories/create', { name: 'Other' }))['category'] as { id: string };

    type Node = { category: { id: string; name: string }; children: Node[] };
    const tree = (await ok('categories/tree', {}))['tree'] as Node[];
    expect(tree).toHaveLength(2);
    const parentNode = tree.find((n) => n.category.name === 'Parent');
    expect(parentNode?.children).toHaveLength(1);

    // Move child under Other.
    await ok('categories/move', { categoryId: child.id, parentId: other.id });
    const moved = (await ok('categories/tree', {}))['tree'] as Node[];
    const otherNode = moved.find((n) => n.category.name === 'Other');
    expect(otherNode?.children).toHaveLength(1);

    // Delete with join reassignment to `other`.
    const note = (await ok('notes/create', { title: 'c', plainText: 'c' }))['note'] as { id: string };
    await ok('categories/set-note-categories', { noteId: note.id, categoryIds: [child.id] });
    await ok('categories/delete', { categoryId: child.id, reassignTo: other.id });
    const related = (await ok('notes/related', { noteId: note.id }))['categories'] as Array<{ id: string }>;
    expect(related.map((c) => c.id)).toEqual([other.id]);
  });
});

describe('settings API', () => {
  it('returns defaults, applies valid patches and rejects invalid ones', async () => {
    const initial = (await ok('settings/get', {}))['settings'] as { theme: string; revisionRetention: number };
    expect(initial.theme).toBe('system');

    const patched = (await ok('settings/patch', { patch: { theme: 'dark' } }))['settings'] as { theme: string };
    expect(patched.theme).toBe('dark');

    // Loopback-only AI URLs (FR-AI-01): a remote endpoint is invalid.
    const remote = await fail('settings/patch', {
      patch: { ai: { baseUrl: 'http://203.0.113.7:1234/v1' } },
    });
    if (!remote.ok) expect(remote.error.code).toBe('invalid-request');

    // Retention floor (FR-NOTE-06).
    const lowRetention = await fail('settings/patch', { patch: { revisionRetention: 5 } });
    if (!lowRetention.ok) expect(lowRetention.error.code).toBe('invalid-request');

    // The invalid patches never persisted.
    const still = (await ok('settings/get', {}))['settings'] as { revisionRetention: number };
    expect(still.revisionRetention).toBe(20);
  });

  it('manages the onboarding flag and reports command shortcuts', async () => {
    const before = (await ok('settings/get-onboarding-complete', {})) as { complete: boolean };
    expect(before.complete).toBe(false);
    await ok('settings/set-onboarding-complete', { complete: true });
    const after = (await ok('settings/get-onboarding-complete', {})) as { complete: boolean };
    expect(after.complete).toBe(true);

    const commands = (await ok('commands/status', {})) as {
      openDashboard: string | null;
      createNote: string | null;
      suggested: string;
      suggestedMissing: boolean;
    };
    expect(commands.openDashboard).toBe('Alt+Shift+N');
    expect(commands.suggested).toBe('Alt+Shift+N');
    expect(commands.suggestedMissing).toBe(false);
  });

  it('pings with build identity', async () => {
    const pong = (await ok('app/ping', { probe: 'hi' })) as { pong: boolean; version: string };
    expect(pong.pong).toBe(true);
    expect(pong.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('reminders API', () => {
  it('creates reminders and reconciles alarms after mutations (FR-REM-04)', async () => {
    const note = (await ok('notes/create', { title: 'rem', plainText: 'r' }))['note'] as { id: string };
    const dueAt = new Date(Date.now() + 3600_000).toISOString();
    const reminder = (await ok('reminders/create', {
      noteId: note.id,
      dueAt,
      recurrence: null,
      timeZone: 'UTC',
      nextDueAt: dueAt,
    }))['reminder'] as { id: string; state: string; nextDueAt: string };

    expect(reminder.state).toBe('active');
    expect(installed.alarms.has(reminderAlarmName(reminder.id as EntityId))).toBe(true);

    await ok('reminders/complete', { reminderId: reminder.id });
    expect(installed.alarms.has(reminderAlarmName(reminder.id as EntityId))).toBe(false);

    const snoozed = (await ok('reminders/snooze', {
      reminderId: reminder.id,
      until: new Date(Date.now() + 7200_000).toISOString(),
    }))['reminder'] as { snoozedUntil: string };
    expect(typeof snoozed.snoozedUntil).toBe('string');
  });

  it('validates recurrence shapes', async () => {
    const note = (await ok('notes/create', { title: 'rec', plainText: 'r' }))['note'] as { id: string };
    const badKind = await fail('reminders/create', {
      noteId: note.id,
      dueAt: null,
      recurrence: { kind: 'weekly' },
      timeZone: 'UTC',
      nextDueAt: null,
    });
    if (!badKind.ok) expect(badKind.error.code).toBe('invalid-request');

    const missingOn = await fail('reminders/create', {
      noteId: note.id,
      dueAt: null,
      recurrence: { kind: 'yearly', leapDayPolicy: 'feb-28' },
      timeZone: 'UTC',
      nextDueAt: null,
    });
    if (!missingOn.ok) expect(missingOn.error.code).toBe('invalid-request');

    const badZone = await fail('reminders/create', {
      noteId: note.id,
      dueAt: new Date().toISOString(),
      recurrence: null,
      timeZone: 'Not/AZone',
      nextDueAt: null,
    });
    if (!badZone.ok) expect(badZone.error.code).toBe('invalid-request');
  });
});

describe('links API', () => {
  it('creates, dedups per note and lists links', async () => {
    const note = (await ok('notes/create', { title: 'links', plainText: 'l' }))['note'] as { id: string };
    const first = (await ok('links/create', { noteId: note.id, url: 'https://example.org/a' })) as {
      link: { id: string };
      created: boolean;
    };
    expect(first.created).toBe(true);
    const second = (await ok('links/create', { noteId: note.id, url: 'https://EXAMPLE.org/a' })) as {
      created: boolean;
    };
    expect(second.created).toBe(false);

    const links = (await ok('links/list-for-note', { noteId: note.id }))['links'] as Array<{ originalUrl: string }>;
    expect(links).toHaveLength(1);

    await ok('links/update-anchor', { linkId: first.link.id, anchorText: 'Example' });
    await ok('links/delete', { linkId: first.link.id });
    const after = (await ok('links/list-for-note', { noteId: note.id }))['links'] as unknown[];
    expect(after).toHaveLength(0);
  });

  it('rejects non-http(s) URLs with the coded error', async () => {
    const note = (await ok('notes/create', { title: 'gate', plainText: 'g' }))['note'] as { id: string };
    const response = await fail('links/create', { noteId: note.id, url: 'javascript:alert(1)' });
    if (!response.ok) expect(response.error.code).toBe('invalid-url');
  });
});
