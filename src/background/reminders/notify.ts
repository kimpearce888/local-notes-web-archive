/**
 * Reminder notifications (FR-REM-05/06): system notifications through
 * chrome.notifications, honoring BOTH the in-app setting
 * (`settings.reminders.notificationsEnabled`) and the OS/browser permission
 * level. Outcomes are truthful — 'denied' and 'failed' are reported and
 * logged, never pretended to be shown.
 *
 * Coalescing (FR-REM-05): missed occurrences after a Chrome restart produce
 * ONE concise notification ("3 reminders need attention: …"), never a burst
 * per missed year/date. The dashboard keeps showing every overdue reminder
 * through card chips and the Overdue smart list even when notifications are
 * denied (the notification is a courtesy, the dashboard is the source of
 * truth).
 */

import { repo } from '../db';
import { getSettings } from '../../core/repo/settings';
import { appendLog } from '../../core/repo/logs';
import type { Reminder } from '../../core/types';

export type NotificationOutcome = 'shown' | 'disabled' | 'denied' | 'failed' | 'unavailable';

export interface ReminderNotification {
  /** Unique notification id (re-showing replaces, never stacks). */
  readonly id: string;
  readonly title: string;
  readonly message: string;
}

async function logNotification(operationId: string, resultCode: string, message: string): Promise<void> {
  try {
    await appendLog(await repo(), {
      level: resultCode === 'ok' ? 'info' : 'warn',
      component: 'reminders',
      operationId,
      resultCode,
      message,
    });
  } catch {
    // Logging must never block notification work.
  }
}

/**
 * Show one reminder notification. Every failure mode is an honest outcome:
 * - 'disabled' — the user turned reminder notifications off in settings
 * - 'denied'   — OS/browser notification permission denied
 * - 'failed'   — chrome.notifications.create threw or reported an error
 * - 'unavailable' — no notifications API in this context
 */
export async function showReminderNotification(
  notification: ReminderNotification,
): Promise<NotificationOutcome> {
  const settings = await getSettings(await repo()).catch(() => null);
  if (settings !== null && !settings.reminders.notificationsEnabled) {
    await logNotification('notify', 'disabled', 'reminder notifications are disabled in settings');
    return 'disabled';
  }
  if (typeof chrome === 'undefined' || !chrome.notifications?.create) {
    await logNotification('notify', 'unavailable', 'chrome.notifications is unavailable');
    return 'unavailable';
  }
  try {
    const level = await chrome.notifications.getPermissionLevel();
    if (level !== 'granted') {
      await logNotification('notify', 'denied', 'notification permission is not granted');
      return 'denied';
    }
    await chrome.notifications.create(notification.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: notification.title,
      message: notification.message,
      priority: 1,
    });
    await logNotification('notify', 'ok', `shown: ${notification.title}`);
    return 'shown';
  } catch (error) {
    await logNotification(
      'notify',
      'failed',
      error instanceof Error ? error.message : String(error),
    );
    return 'failed';
  }
}

/** Title of the note for a reminder (missed lists stay concise). */
export function notificationTitleForNote(noteTitle: string): string {
  const trimmed = noteTitle.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled note';
}

const MAX_MISSED_TITLES = 5;

/**
 * ONE concise notification for missed occurrences (FR-REM-05): "3 reminders
 * need attention — Title A, Title B and 1 more". Reminders stay overdue in
 * the dashboard regardless of the notification outcome.
 */
export async function coalesceMissedReminders(
  dueWithTitles: readonly { reminder: Reminder; noteTitle: string }[],
): Promise<NotificationOutcome> {
  if (dueWithTitles.length === 0) return 'disabled';
  const titles = dueWithTitles.map((entry) => notificationTitleForNote(entry.noteTitle));
  const listed = titles.slice(0, MAX_MISSED_TITLES);
  const remaining = titles.length - listed.length;
  const message =
    remaining > 0
      ? `${listed.join(', ')} and ${remaining} more need attention`
      : listed.length === 1
        ? `${listed[0]} needs attention`
        : `${listed.slice(0, -1).join(', ')} and ${listed[listed.length - 1]} need attention`;
  return showReminderNotification({
    id: 'reminders-missed',
    title:
      dueWithTitles.length === 1
        ? 'You missed a reminder'
        : `You missed ${dueWithTitles.length} reminders`,
    message,
  });
}

/**
 * Honest limits (FR-REM-06) shown wherever reminders are managed: Chrome
 * must be running, the computer awake; alarms may be delayed; nothing wakes
 * a sleeping computer. Missed reminders reappear at next startup.
 */
export const REMINDER_LIMITS_NOTE =
  'Notifications appear only while Chrome is running and the computer is awake — no notification can wake a sleeping computer, and alarms may be delayed. If Chrome was closed, missed reminders are collected into one notification and stay visible in the Overdue list.';

/** Stable notification id for a single fired reminder. */
export function reminderNotificationId(reminderId: string): string {
  return `reminder-${reminderId}`;
}

/** Due-with-title pairs for the coalesced startup pass (oldest first). */
export interface MissedReminder {
  readonly reminder: Reminder;
  readonly noteTitle: string;
}

export function sortMissedReminders(missed: readonly MissedReminder[]): MissedReminder[] {
  return [...missed].sort((a, b) => {
    const aDue = a.reminder.snoozedUntil ?? a.reminder.nextDueAt ?? '9999';
    const bDue = b.reminder.snoozedUntil ?? b.reminder.nextDueAt ?? '9999';
    return aDue < bDue ? -1 : aDue > bDue ? 1 : 0;
  });
}
