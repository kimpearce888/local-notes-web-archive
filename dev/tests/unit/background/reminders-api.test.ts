import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources } from '../../../../src/background/db';
import { MessageRouter } from '../../../../src/background/router';
import { registerAllApi } from '../../../../src/background/api';
import { reminderAlarmName } from '../../../../src/background/alarms';
import {
  newCorrelationId,
  RPC_KIND,
  type RpcRequest,
  type RpcResponse,
} from '../../../../src/background/protocol';
import { DB_NAME } from '../../../../src/core/version';
import type { EntityId, Reminder } from '../../../../src/core/types';

/**
 * T-027 reminders API over the real router and IndexedDB: the ENGINE
 * computes nextDueAt authoritatively on create/update — clients never
 * supply it — and semantic rule validation surfaces coded failures
 * (FR-REM-01..04).
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

async function fail(type: string, payload: unknown): Promise<{ code: string; message: string }> {
  const response = await call(type, payload);
  if (response.ok) throw new Error(`${type} unexpectedly succeeded`);
  return response.error;
}

async function seedNote(title: string): Promise<EntityId> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return (result['note'] as Reminder & { id: EntityId }).id;
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

describe('reminders/create: engine-computed nextDueAt', () => {
  it('uses the due instant for one-time reminders (client-supplied values ignored)', async () => {
    const noteId = await seedNote('one-time');
    const dueAt = '2030-05-20T14:30:00.000Z';
    const reminder = (await ok('reminders/create', {
      noteId,
      dueAt,
      recurrence: null,
      timeZone: 'UTC',
      // A lying client value must be ignored (engine is authoritative).
      nextDueAt: '1999-01-01T00:00:00.000Z',
    }))['reminder'] as Reminder;

    expect(reminder.nextDueAt).toBe(dueAt);
    expect(reminder.state).toBe('active');
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(true);
  });

  it('computes yearly next occurrences in the reminder zone (DST-aware)', async () => {
    const noteId = await seedNote('yearly');
    const reminder = (await ok('reminders/create', {
      noteId,
      dueAt: null,
      recurrence: {
        kind: 'yearly',
        on: { month: 7, day: 4 },
        at: { hour: 9, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
      timeZone: 'America/New_York',
    }))['reminder'] as Reminder;

    // The next July 4 09:00 America/New_York occurrence from "now", EDT -4.
    // The engine is deterministic; compute the expectation for whichever
    // year is next from the current date.
    const now = new Date();
    const year = now.getUTCFullYear() + (now.getTime() > Date.UTC(now.getUTCFullYear(), 6, 4, 13) ? 1 : 0);
    expect(reminder.nextDueAt).toBe(`${year}-07-04T13:00:00.000Z`);
  });

  it('resolves Feb-29 rules through the leap-day policy', async () => {
    const noteId = await seedNote('leap');
    const reminder = (await ok('reminders/create', {
      noteId,
      dueAt: null,
      recurrence: {
        kind: 'yearly',
        on: { month: 2, day: 29 },
        at: { hour: 10, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
      timeZone: 'UTC',
    }))['reminder'] as Reminder;

    // Next occurrence: this year Feb 28 (non-leap) or Feb 29 (leap).
    const now = new Date();
    const year = now.getUTCFullYear();
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const pastThisYear =
      now.getTime() >= Date.UTC(year, 1, leap ? 29 : 28, 10) ? year + 1 : year;
    const nextLeap =
      pastThisYear !== year && !leap ? pastThisYear : pastThisYear;
    expect(reminder.nextDueAt).toBe(
      `${nextLeap}-02-${(nextLeap % 4 === 0 && nextLeap % 100 !== 0) || nextLeap % 400 === 0 ? '29' : '28'}T10:00:00.000Z`,
    );
  });

  it('rejects impossible civil dates with a coded failure', async () => {
    const noteId = await seedNote('bad');
    const error = await fail('reminders/create', {
      noteId,
      dueAt: null,
      recurrence: {
        kind: 'yearly',
        on: { month: 2, day: 30 },
        at: { hour: 9, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
      timeZone: 'UTC',
    });
    expect(error.code).toBe('invalid-request');
    expect(error.message).toContain('does not exist');
  });

  it('rejects reminders with neither dueAt nor recurrence', async () => {
    const noteId = await seedNote('empty');
    const error = await fail('reminders/create', {
      noteId,
      dueAt: null,
      recurrence: null,
      timeZone: 'UTC',
    });
    expect(error.code).toBe('invalid-request');
  });
});

describe('reminders/update-rule: recompute from the effective shape', () => {
  async function createYearly(noteId: EntityId): Promise<Reminder> {
    return (await ok('reminders/create', {
      noteId,
      dueAt: null,
      recurrence: {
        kind: 'yearly',
        on: { month: 1, day: 15 },
        at: { hour: 8, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
      timeZone: 'UTC',
    }))['reminder'] as Reminder;
  }

  it('recomputes nextDueAt when the rule changes', async () => {
    const noteId = await seedNote('update');
    const created = await createYearly(noteId);

    const updated = (await ok('reminders/update-rule', {
      reminderId: created.id,
      recurrence: {
        kind: 'yearly',
        on: { month: 12, day: 25 },
        at: { hour: 12, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
    }))['reminder'] as Reminder;

    const now = new Date();
    const year = now.getUTCFullYear() + (now.getTime() > Date.UTC(now.getUTCFullYear(), 11, 25, 12) ? 1 : 0);
    expect(updated.nextDueAt).toBe(`${year}-12-25T12:00:00.000Z`);
    expect(updated.recurrence?.on).toEqual({ month: 12, day: 25 });
  });

  it('keeps unmodified fields when patching (merged-shape computation)', async () => {
    const noteId = await seedNote('patch');
    const created = await createYearly(noteId);

    // Only the final year is patched; the rule itself stays.
    const updated = (await ok('reminders/update-rule', {
      reminderId: created.id,
      recurrence: {
        kind: 'yearly',
        on: { month: 1, day: 15 },
        at: { hour: 8, minute: 0 },
        finalYear: 2049,
        leapDayPolicy: 'feb-28',
      },
    }))['reminder'] as Reminder;

    expect(updated.recurrence?.finalYear).toBe(2049);
    expect(updated.timeZone).toBe(created.timeZone); // untouched
    expect(updated.nextDueAt).not.toBeNull();
  });

  it('returns a truthful null nextDueAt when the final year has passed', async () => {
    const noteId = await seedNote('ended');
    const created = await createYearly(noteId);
    const updated = (await ok('reminders/update-rule', {
      reminderId: created.id,
      recurrence: {
        kind: 'yearly',
        on: { month: 1, day: 15 },
        at: { hour: 8, minute: 0 },
        finalYear: 2001,
        leapDayPolicy: 'feb-28',
      },
    }))['reminder'] as Reminder;
    expect(updated.nextDueAt).toBeNull();
    // No alarm is scheduled for a ended recurrence.
    expect(installed.alarms.has(reminderAlarmName(created.id))).toBe(false);
  });

  it('rejects updates that would strip both dueAt and recurrence', async () => {
    const noteId = await seedNote('strip');
    const created = await createYearly(noteId);
    const error = await fail('reminders/update-rule', {
      reminderId: created.id,
      dueAt: null,
      recurrence: null,
    });
    expect(error.code).toBe('invalid-request');
  });

  it('rejects invalid merged rules with a coded failure', async () => {
    const noteId = await seedNote('invalid-merged');
    const created = await createYearly(noteId);
    const error = await fail('reminders/update-rule', {
      reminderId: created.id,
      recurrence: {
        kind: 'yearly',
        on: { month: 4, day: 31 },
        at: { hour: 8, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
    });
    expect(error.code).toBe('invalid-request');
    expect(error.message).toContain('does not exist');
  });

  it('reports unknown reminders as not-found', async () => {
    const error = await fail('reminders/update-rule', {
      reminderId: '11111111-2222-4333-8444-555555555555',
      dueAt: '2030-01-01T00:00:00.000Z',
    });
    expect(error.code).toBe('not-found');
  });
});
