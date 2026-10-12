import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo } from '../../../src/background/db';
import { reconcileReminderAlarms, reminderAlarmName, REMINDER_ALARM_PREFIX } from '../../../src/background/alarms';
import { createNote } from '../../../src/core/repo/notes';
import { createReminder, snoozeReminder, completeReminder } from '../../../src/core/repo/reminders';
import { DB_NAME } from '../../../src/core/version';
import type { TimeZoneName, UtcTimestamp } from '../../../src/core/types';

function isoIn(ms: number): UtcTimestamp {
  return new Date(Date.now() + ms).toISOString() as UtcTimestamp;
}

describe('reminder alarm reconciliation (FR-REM-04)', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
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

  async function seedReminder(nextDueAt: UtcTimestamp | null): Promise<string> {
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'Reminder host' });
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: nextDueAt,
      recurrence: null,
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt,
    });
    return reminder.id;
  }

  it('schedules an alarm for a future one-time reminder', async () => {
    const when = isoIn(3600_000);
    const reminderId = await seedReminder(when);
    const result = await reconcileReminderAlarms();
    expect(result.scheduled).toBe(1);
    expect(result.considered).toBe(1);
    const alarm = installed.alarms.get(reminderAlarmName(reminderId as never));
    expect(alarm).toBeDefined();
    expect(alarm?.scheduledTime).toBe(new Date(when).getTime());
  });

  it('prefers the snooze target over the original due time', async () => {
    const when = isoIn(3600_000);
    const snoozedTo = isoIn(7200_000);
    const reminderId = await seedReminder(when);
    const ctx = await repo();
    await snoozeReminder(ctx, reminderId as never, snoozedTo);
    await reconcileReminderAlarms();
    const alarm = installed.alarms.get(reminderAlarmName(reminderId as never));
    expect(alarm?.scheduledTime).toBe(new Date(snoozedTo).getTime());
  });

  it('never re-arms past occurrences (overdue pass owns those, T-028)', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString() as UtcTimestamp;
    await seedReminder(past);
    const result = await reconcileReminderAlarms();
    expect(result.scheduled).toBe(0);
    expect(installed.alarms.size).toBe(0);
  });

  it('removes orphaned alarms for completed reminders', async () => {
    const when = isoIn(3600_000);
    const reminderId = await seedReminder(when);
    await reconcileReminderAlarms();
    expect(installed.alarms.size).toBe(1);

    await completeReminder(await repo(), reminderId as never);
    const result = await reconcileReminderAlarms();
    expect(result.removed).toBe(1);
    expect(installed.alarms.size).toBe(0);
  });

  it('removes foreign-prefix orphans without touching other alarms', async () => {
    installed.alarms.set('capture:tick', { name: 'capture:tick', scheduledTime: Date.now() });
    installed.alarms.set(`${REMINDER_ALARM_PREFIX}ghost`, {
      name: `${REMINDER_ALARM_PREFIX}ghost`,
      scheduledTime: Date.now() + 1000,
    });
    const when = isoIn(3600_000);
    await seedReminder(when);
    const result = await reconcileReminderAlarms();
    expect(result.removed).toBe(1);
    expect(installed.alarms.has('capture:tick')).toBe(true);
    expect(installed.alarms.has(`${REMINDER_ALARM_PREFIX}ghost`)).toBe(false);
  });

  it('is idempotent: reconciling twice yields one alarm per reminder', async () => {
    const when = isoIn(3600_000);
    const reminderId = await seedReminder(when);
    await reconcileReminderAlarms();
    await reconcileReminderAlarms();
    const names = [...installed.alarms.keys()];
    expect(names).toEqual([reminderAlarmName(reminderId as never)]);
  });

  it('skips active reminders without a next occurrence', async () => {
    // Yearly recurrence whose next-occurrence hint has not been computed yet
    // (the engine fills nextDueAt; until then there is nothing to arm).
    const ctx = await repo();
    const note = await createNote(ctx, { title: 'yearly host' });
    await createReminder(ctx, {
      noteId: note.id,
      dueAt: null,
      recurrence: {
        kind: 'yearly',
        on: { month: 3, day: 15 },
        at: { hour: 9, minute: 0 },
        finalYear: null,
        leapDayPolicy: 'feb-28',
      },
      timeZone: 'UTC' as TimeZoneName,
      nextDueAt: null,
    });
    const result = await reconcileReminderAlarms();
    expect(result.scheduled).toBe(0);
    expect(installed.alarms.size).toBe(0);
  });
});
