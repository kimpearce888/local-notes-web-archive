/**
 * Reminder alarm reconciliation (FR-REM-04): alarms are wake-up hints derived
 * from canonical reminder records in IndexedDB — never authoritative state.
 * Reconciliation runs on install/update, browser startup, worker startup and
 * after every reminder mutation, and is fully idempotent.
 *
 * Overdue reminders are deliberately NOT re-armed: an alarm in the past would
 * never fire; missed occurrences are surfaced by the overdue/notification
 * pass (T-028) that reconciles missed reminders into dashboard state.
 */

import { repo } from './db';
import { listRemindersByState } from '../core/repo/reminders';
import { utcToEpochMs } from '../core/util/time';
import { appendLog } from '../core/repo/logs';
import type { EntityId } from '../core/types';

export const REMINDER_ALARM_PREFIX = 'reminder:';

export function reminderAlarmName(reminderId: EntityId): string {
  return `${REMINDER_ALARM_PREFIX}${reminderId}`;
}

export interface AlarmReconcileResult {
  /** Alarms (re)created for future occurrences. */
  readonly scheduled: number;
  /** Orphaned reminder alarms removed (deleted/completed reminders). */
  readonly removed: number;
  /** Active reminders considered. */
  readonly considered: number;
}

export async function reconcileReminderAlarms(): Promise<AlarmReconcileResult> {
  const ctx = await repo();
  const active = await listRemindersByState(ctx, 'active');
  const nowMs = Date.now();
  const desired = new Map<string, number>();
  for (const reminder of active) {
    const target = reminder.snoozedUntil ?? reminder.nextDueAt;
    if (target === null) continue;
    const when = utcToEpochMs(target);
    if (when <= nowMs) continue;
    desired.set(reminderAlarmName(reminder.id), when);
  }
  for (const [name, when] of desired) {
    // Creating an alarm with an existing name replaces it (idempotent).
    chrome.alarms.create(name, { when });
  }
  const existing = await chrome.alarms.getAll();
  let removed = 0;
  for (const alarm of existing) {
    if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) continue;
    if (!desired.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
      removed += 1;
    }
  }
  const result: AlarmReconcileResult = {
    scheduled: desired.size,
    removed,
    considered: active.length,
  };
  try {
    await appendLog(ctx, {
      level: 'debug',
      component: 'alarms',
      operationId: 'reconcile',
      resultCode: 'ok',
      message: `scheduled=${result.scheduled} removed=${result.removed} considered=${result.considered}`,
    });
  } catch {
    // Logging must never block reconciliation.
  }
  return result;
}
