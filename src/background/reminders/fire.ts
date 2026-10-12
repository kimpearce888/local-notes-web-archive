/**
 * Reminder alarm firing (FR-REM-04/05): chrome.alarms.onAlarm is a wake-up
 * HINT — everything true happens to the canonical record: lastFiredAt is
 * stamped, the next occurrence is recomputed by the engine, alarms are
 * reconciled from records, and the dashboard is told to refresh.
 *
 * Semantics:
 * - One-time reminders keep their (now past) due instant after firing: they
 *   stay overdue in the dashboard until the user completes or dismisses them
 *   (FR-REM-05: overdue is visible even if notifications were denied/missed).
 * - Yearly reminders advance to the engine-computed next occurrence; when
 *   the recurrence ends (final year passed), nextDueAt becomes null and the
 *   reminder keeps its history (FR-REM-02).
 * - Missed occurrences after a Chrome restart are coalesced into ONE
 *   notification by the startup pass (see reconcileMissedReminders).
 */

import { repo } from '../db';
import { getNote } from '../../core/repo/notes';
import { getReminder, listDueReminders, markFired } from '../../core/repo/reminders';
import { computeNextDueAt } from './engine';
import {
  coalesceMissedReminders,
  notificationTitleForNote,
  reminderNotificationId,
  showReminderNotification,
  sortMissedReminders,
  type MissedReminder,
  type NotificationOutcome,
} from './notify';
import { reconcileReminderAlarms, reminderAlarmName, REMINDER_ALARM_PREFIX } from '../alarms';
import { nowUtc } from '../../core/util/time';
import type { Reminder } from '../../core/types';

const DASHBOARD_PAGE = 'dashboard.html';

/** Dashboard broadcast payload for a fired reminder. */
export interface ReminderFiredEvent {
  readonly kind: 'reminder-fired';
  readonly reminderId: string;
  readonly noteId: string;
  readonly title: string;
}

async function broadcastReminderFired(event: ReminderFiredEvent): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  try {
    const url = chrome.runtime.getURL(DASHBOARD_PAGE);
    const tabs = await chrome.tabs.query({ url });
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.id !== null) {
        try {
          await chrome.tabs.sendMessage(tab.id, event);
        } catch {
          // Dashboard tab without a listener (still loading) — the overdue
          // state is also visible through card chips and the Overdue list.
        }
      }
    }
  } catch {
    // Chrome tabs API unavailable — the dashboard refreshes on its own views.
  }
}

/** Next occurrence after a firing, per reminder kind. */
function nextAfterFiring(
  reminder: Reminder,
  firedAt: ReturnType<typeof nowUtc>,
): Reminder['nextDueAt'] {
  if (reminder.recurrence !== null && reminder.recurrence.kind === 'yearly') {
    return computeNextDueAt(reminder, firedAt);
  }
  // One-time: keep the (past) due instant so the reminder stays overdue in
  // the dashboard until completed/dismissed (FR-REM-05).
  return reminder.dueAt;
}

export interface ReminderFiredResult {
  readonly outcome: 'fired' | 'unknown-reminder' | 'foreign-alarm' | 'not-active' | 'db-failed';
  /** The notification outcome, when a notification was attempted. */
  readonly notification: NotificationOutcome | null;
  readonly reminder: Reminder | null;
}

/**
 * Handle one chrome.alarms.onAlarm event for a reminder alarm. Never
 * throws: every failure is a truthful outcome (the alarm is a hint).
 */
export async function handleReminderAlarm(alarm: { name: string }): Promise<ReminderFiredResult> {
  if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
    return { outcome: 'foreign-alarm', notification: null, reminder: null };
  }
  const reminderId = alarm.name.slice(REMINDER_ALARM_PREFIX.length);

  let reminder: Reminder;
  try {
    const found = await getReminder(await repo(), reminderId as Reminder['id']);
    if (found === null) {
      // The record was deleted between scheduling and firing — reconcile
      // removes the orphaned alarm.
      await reconcileReminderAlarms().catch(() => undefined);
      return { outcome: 'unknown-reminder', notification: null, reminder: null };
    }
    reminder = found;
  } catch {
    return { outcome: 'db-failed', notification: null, reminder: null };
  }
  if (reminder.state !== 'active') {
    // Completed/dismissed/stopped after scheduling — nothing to fire.
    await reconcileReminderAlarms().catch(() => undefined);
    return { outcome: 'not-active', notification: null, reminder };
  }

  const firedAt = nowUtc();
  const nextDueAt = nextAfterFiring(reminder, firedAt);
  let updated: Reminder;
  try {
    updated = await markFired(await repo(), reminder.id, firedAt, nextDueAt);
    await reconcileReminderAlarms();
  } catch {
    return { outcome: 'db-failed', notification: null, reminder };
  }

  const note = await getNote(await repo(), reminder.noteId).catch(() => null);
  const title = notificationTitleForNote(note?.title ?? '');
  const when = firedAt.slice(0, 16).replace('T', ' ');
  const body =
    reminder.recurrence !== null
      ? updated.nextDueAt !== null
        ? `${title} — next occurrence is scheduled.`
        : `${title} — this recurrence has ended.`
      : `${title} is due (checked at ${when} UTC).`;

  const notification = await showReminderNotification({
    id: reminderNotificationId(reminder.id),
    title: `Reminder: ${title}`,
    message: body,
  });

  await broadcastReminderFired({
    kind: 'reminder-fired',
    reminderId: reminder.id,
    noteId: reminder.noteId,
    title,
  });

  return { outcome: 'fired', notification, reminder: updated };
}

export interface MissedReconcileResult {
  /** Overdue (missed) reminders found at startup, oldest first. */
  readonly missed: readonly MissedReminder[];
  readonly notification: NotificationOutcome;
}

/**
 * Startup pass (FR-REM-05): find every active reminder whose occurrence
 * passed while Chrome was closed, coalesce them into ONE concise
 * notification and leave them overdue in the dashboard. Records are NOT
 * mutated — the user acknowledges each reminder themselves.
 */
export async function reconcileMissedReminders(): Promise<MissedReconcileResult> {
  let due: readonly Reminder[];
  try {
    due = await listDueReminders(await repo(), nowUtc());
  } catch {
    return { missed: [], notification: 'unavailable' };
  }
  const missed: MissedReminder[] = [];
  for (const reminder of due) {
    const note = await getNote(await repo(), reminder.noteId).catch(() => null);
    // Deleted notes: the reminder is still listed for cleanup through the
    // note editor; the missed list only shows reminders with living notes.
    if (note !== null) {
      missed.push({ reminder, noteTitle: note.title });
    }
  }
  const sorted = sortMissedReminders(missed);
  const notification = await coalesceMissedReminders(sorted);
  return { missed: sorted, notification };
}

/** Wiring helper: the alarm-name prefix this handler claims. */
export { reminderAlarmName };
