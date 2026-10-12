import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, addTab, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { MessageRouter } from '../../../src/background/router';
import { registerAllApi } from '../../../src/background/api';
import {
  handleReminderAlarm,
  reconcileMissedReminders,
} from '../../../src/background/reminders/fire';
import { reminderAlarmName } from '../../../src/background/alarms';
import { getReminder } from '../../../src/core/repo/reminders';
import { listAuditEvents } from '../../../src/core/repo/audit';
import { listLogs } from '../../../src/core/repo/logs';
import { newCorrelationId, RPC_KIND, type RpcRequest, type RpcResponse } from '../../../src/background/protocol';
import { DB_NAME } from '../../../src/core/version';
import type { EntityId, Reminder } from '../../../src/core/types';

/**
 * T-028 alarm firing, notifications and missed-occurrence reconciliation
 * (FR-REM-04/05/06): alarms are hints, records are canonical; one-time
 * reminders stay overdue after firing until acknowledged; yearly reminders
 * advance through the engine; denied/disabled/failed notifications never
 * block the truthful record update; Chrome-restart misses coalesce into
 * ONE concise notification; honest outcomes are logged.
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

async function seedNote(title: string): Promise<EntityId> {
  const result = await ok('notes/create', { title, plainText: 'body' });
  return (result['note'] as Reminder).id;
}

async function createOneTime(noteId: EntityId, dueAt: string): Promise<Reminder> {
  return (await ok('reminders/create', {
    noteId,
    dueAt,
    recurrence: null,
    timeZone: 'UTC',
  }))['reminder'] as Reminder;
}

async function createYearly(
  noteId: EntityId,
  options: { finalYear?: number | null } = {},
): Promise<Reminder> {
  return (await ok('reminders/create', {
    noteId,
    dueAt: null,
    recurrence: {
      kind: 'yearly',
      on: { month: 12, day: 25 },
      at: { hour: 8, minute: 0 },
      finalYear: options.finalYear ?? null,
      leapDayPolicy: 'feb-28',
    },
    timeZone: 'UTC',
  }))['reminder'] as Reminder;
}

async function fireAlarm(reminderId: EntityId): Promise<Awaited<ReturnType<typeof handleReminderAlarm>>> {
  return handleReminderAlarm({ name: reminderAlarmName(reminderId) });
}

async function flush(millis = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, millis));
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await flush(10);
  }
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

describe('handleReminderAlarm (FR-REM-04: hints, records are canonical)', () => {
  it('fires a one-time reminder: stamps lastFiredAt, stays overdue, notifies, broadcasts', async () => {
    const noteId = await seedNote('Doctor appointment');
    const dueAt = new Date(Date.now() - 60_000).toISOString(); // just past
    const reminder = await createOneTime(noteId, dueAt);

    const tabId = addTab(installed, 'chrome-extension://test-extension-id/dashboard.html');
    installed.tabsWithListeners.add(tabId);

    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('fired');
    expect(result.notification).toBe('shown');

    const updated = await getReminder(await repo(), reminder.id);
    expect(updated?.state).toBe('active');
    expect(updated?.lastFiredAt).not.toBeNull();
    // FR-REM-05: the one-time reminder KEEPS its past due instant so it
    // stays overdue in the dashboard until completed/dismissed.
    expect(updated?.nextDueAt).toBe(dueAt);

    // One notification created for this reminder.
    expect(installed.notifications.created.get(`reminder-${reminder.id}`)?.title).toBe(
      'Reminder: Doctor appointment',
    );

    // The dashboard tab received the fired broadcast (tab message).
    await waitFor(() => {
      const calls = (chrome.tabs.sendMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      return calls.some(
        (args) =>
          typeof args[1] === 'object' &&
          args[1] !== null &&
          (args[1] as { kind?: unknown }).kind === 'reminder-fired',
      );
    });
  });

  it('fires a yearly reminder: advances to the engine-computed next occurrence and reschedules', async () => {
    const noteId = await seedNote('Christmas planning');
    const reminder = await createYearly(noteId);

    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('fired');

    const updated = await getReminder(await repo(), reminder.id);
    expect(updated?.lastFiredAt).not.toBeNull();
    expect(updated?.state).toBe('active');

    // Next occurrence: the next Dec 25 08:00 UTC strictly after the firing.
    const firedAtMs = new Date(updated!.lastFiredAt!).getTime();
    const year = new Date(firedAtMs).getUTCFullYear() +
      (firedAtMs >= Date.UTC(new Date(firedAtMs).getUTCFullYear(), 11, 25, 8) ? 1 : 0);
    expect(updated?.nextDueAt).toBe(`${year}-12-25T08:00:00.000Z`);

    // The alarm for the next occurrence exists.
    const alarm = installed.alarms.get(reminderAlarmName(reminder.id));
    expect(alarm).toBeDefined();
    expect(alarm?.scheduledTime).toBe(new Date(`${year}-12-25T08:00:00.000Z`).getTime());
  });

  it('ends a yearly recurrence whose final year passed at firing time', async () => {
    const noteId = await seedNote('Old anniversary');
    // finalYear in the past: the next occurrence is already null at create.
    const reminder = await createYearly(noteId, { finalYear: 2001 });
    expect(reminder.nextDueAt).toBeNull();

    // A stray alarm (e.g. scheduled before the rule change) still fires
    // honestly: the record says the recurrence ended.
    installed.alarms.set(reminderAlarmName(reminder.id), {
      name: reminderAlarmName(reminder.id),
      scheduledTime: Date.now() - 1000,
    });
    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('fired');

    const updated = await getReminder(await repo(), reminder.id);
    expect(updated?.nextDueAt).toBeNull();
    expect(updated?.lastFiredAt).not.toBeNull();
    // No alarm remains for an ended recurrence.
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(false);
    // The notification is honest about the end.
    expect(installed.notifications.created.get(`reminder-${reminder.id}`)?.message).toContain(
      'recurrence has ended',
    );
  });

  it('ignores foreign alarm names without touching the database', async () => {
    const before = (await listAuditEvents(await repo(), { limit: 5 })).length;
    const result = await handleReminderAlarm({ name: 'some-other-alarm' });
    expect(result.outcome).toBe('foreign-alarm');
    expect(result.reminder).toBeNull();
    expect(installed.notifications.created.size).toBe(0);
    expect((await listAuditEvents(await repo(), { limit: 5 })).length).toBe(before);
  });

  it('clears orphaned alarms for deleted reminders', async () => {
    const noteId = await seedNote('Temporary');
    const reminder = await createOneTime(
      noteId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    await ok('reminders/delete', { reminderId: reminder.id });
    // The mutation reconciles already; force a stray alarm to simulate loss.
    installed.alarms.set(reminderAlarmName(reminder.id), {
      name: reminderAlarmName(reminder.id),
      scheduledTime: Date.now() + 1000,
    });

    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('unknown-reminder');
    expect(installed.alarms.has(reminderAlarmName(reminder.id))).toBe(false);
    expect(installed.notifications.created.size).toBe(0);
  });

  it('does not fire non-active reminders (completed/dismissed/stopped)', async () => {
    const noteId = await seedNote('Done deal');
    const reminder = await createOneTime(noteId, new Date(Date.now() - 1000).toISOString());
    await ok('reminders/complete', { reminderId: reminder.id });

    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('not-active');
    expect(installed.notifications.created.size).toBe(0);
    const updated = await getReminder(await repo(), reminder.id);
    expect(updated?.lastFiredAt).toBeNull(); // never marked fired
    expect(updated?.state).toBe('completed');
  });
});

describe('notification honesty (FR-REM-05/06)', () => {
  it('denied permission still updates the record and keeps the reminder overdue', async () => {
    const noteId = await seedNote('Denied but due');
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const reminder = await createOneTime(noteId, dueAt);
    installed.notifications.permissionLevel = 'denied';

    const result = await fireAlarm(reminder.id);
    expect(result.outcome).toBe('fired');
    expect(result.notification).toBe('denied');
    expect(installed.notifications.created.size).toBe(0);

    const updated = await getReminder(await repo(), reminder.id);
    expect(updated?.lastFiredAt).not.toBeNull();
    expect(updated?.nextDueAt).toBe(dueAt); // still overdue in the dashboard
  });

  it('disabled-in-settings notifications leave the record truthful', async () => {
    const noteId = await seedNote('Muted');
    const reminder = await createOneTime(noteId, new Date(Date.now() - 1000).toISOString());
    await ok('settings/patch', {
      patch: { reminders: { notificationsEnabled: false, leapDayPolicy: 'feb-28' } },
    });

    const result = await fireAlarm(reminder.id);
    expect(result.notification).toBe('disabled');
    expect(installed.notifications.created.size).toBe(0);
    expect((await getReminder(await repo(), reminder.id))?.lastFiredAt).not.toBeNull();
  });

  it('create failures surface as failed without rolling back the firing', async () => {
    const noteId = await seedNote('Failing channel');
    const reminder = await createOneTime(noteId, new Date(Date.now() - 1000).toISOString());
    installed.notifications.failNextCreate = new Error('OS notification queue full');

    const result = await fireAlarm(reminder.id);
    expect(result.notification).toBe('failed');
    expect((await getReminder(await repo(), reminder.id))?.lastFiredAt).not.toBeNull();

    // The failure is logged (FR-LOG-01), not swallowed.
    const logs = await listLogs(await repo(), 20);
    expect(
      logs.some((entry) => entry.message.includes('OS notification queue full')),
    ).toBe(true);
  });
});

describe('reconcileMissedReminders (FR-REM-05 coalescing)', () => {
  it('coalesces missed occurrences into ONE concise notification without mutating records', async () => {
    const first = await seedNote('Renew passport');
    const second = await seedNote('Submit taxes');
    const third = await seedNote('Call dentist');
    await createOneTime(first, '2026-01-01T09:00:00.000Z');
    await createOneTime(second, '2026-02-01T09:00:00.000Z');
    await createOneTime(third, '2026-03-01T09:00:00.000Z');

    const result = await reconcileMissedReminders();
    expect(result.missed.length).toBe(3);
    // Oldest first.
    expect(result.missed[0]?.noteTitle).toBe('Renew passport');
    expect(result.missed[2]?.noteTitle).toBe('Call dentist');

    // Exactly ONE notification, with the count and the titles.
    expect(installed.notifications.created.size).toBe(1);
    const notification = installed.notifications.created.get('reminders-missed');
    expect(notification?.title).toBe('You missed 3 reminders');
    expect(notification?.message).toContain('Renew passport');
    expect(notification?.message).toContain('Submit taxes');
    expect(notification?.message).toContain('Call dentist');

    // Records untouched: the user acknowledges each reminder themselves.
    for (const missed of result.missed) {
      const reminder = await getReminder(await repo(), missed.reminder.id);
      expect(reminder?.lastFiredAt).toBeNull();
      expect(reminder?.state).toBe('active');
    }
  });

  it('bounds the missed list to five titles with an and-N-more suffix', async () => {
    for (let index = 0; index < 7; index += 1) {
      const noteId = await seedNote(`Task number ${index + 1}`);
      await createOneTime(noteId, `2026-0${Math.min(index + 1, 9)}-01T09:00:00.000Z`);
    }
    const result = await reconcileMissedReminders();
    expect(result.missed.length).toBe(7);
    const notification = installed.notifications.created.get('reminders-missed');
    expect(notification?.title).toBe('You missed 7 reminders');
    expect(notification?.message).toContain('and 2 more');
    expect(notification?.message).not.toContain('Task number 7');
  });

  it('excludes reminders of deleted notes and skips when nothing is missed', async () => {
    const noteId = await seedNote('Ghost note');
    await createOneTime(noteId, '2026-01-01T09:00:00.000Z');
    await ok('notes/trash', { noteId });
    await ok('notes/delete-permanently', { noteId, confirm: true });

    const result = await reconcileMissedReminders();
    expect(result.missed.length).toBe(0);
    expect(installed.notifications.created.size).toBe(0);

    // A living overdue note still produces the coalesced notification.
    const alive = await seedNote('Alive and overdue');
    await createOneTime(alive, '2026-01-01T09:00:00.000Z');
    const second = await reconcileMissedReminders();
    expect(second.missed.length).toBe(1);
    expect(installed.notifications.created.size).toBe(1);
    expect(second.missed[0]?.noteTitle).toBe('Alive and overdue');
  });

  it('respects denied notification permission with the dashboard as fallback', async () => {
    const noteId = await seedNote('Denied missed');
    await createOneTime(noteId, '2026-01-01T09:00:00.000Z');
    installed.notifications.permissionLevel = 'denied';

    const result = await reconcileMissedReminders();
    expect(result.missed.length).toBe(1);
    expect(result.notification).toBe('denied');
    expect(installed.notifications.created.size).toBe(0);
    // The reminder stays overdue — the Overdue smart list shows it.
    expect((await getReminder(await repo(), result.missed[0]!.reminder.id))?.state).toBe('active');
  });
});
