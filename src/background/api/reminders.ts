/**
 * Reminders API (FR-REM-01..04): CRUD over canonical reminder records.
 * The ENGINE computes `nextDueAt` authoritatively on create/update — the
 * client never supplies it (alarms are hints derived from durable state,
 * never authoritative, FR-REM-04). Every mutation triggers alarm
 * reconciliation.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { auditUserAction } from '../observability';
import {
  completeReminder,
  createReminder,
  deleteReminder,
  dismissReminder,
  getReminder,
  listAllReminders,
  listNoteReminders,
  snoozeReminder,
  stopRecurrence,
  updateReminderRule,
} from '../../core/repo/reminders';
import { reconcileReminderAlarms } from '../alarms';
import { ReminderNotFoundError } from '../../core/repo/reminders';
import { computeNextDueAt, validateRecurrenceRule } from '../reminders/engine';
import { nowUtc } from '../../core/util/time';
import type { LocalDate, LocalTime, RecurrenceRule, TimeZoneName, UtcTimestamp } from '../../core/types';
import { PayloadValidationError } from '../protocol';
import {
  asEnum,
  asId,
  asNumber,
  asObject,
  asOptionalUtcTimestamp,
  asTimeZoneName,
  asUtcTimestamp,
} from './validate';

const RECURRENCE_KINDS = ['one-time', 'yearly'] as const;
const LEAP_DAY_POLICIES = ['feb-28', 'mar-1', 'skip'] as const;

function parseLocalDate(value: unknown, field: string): LocalDate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected { month, day }`);
  }
  const p = value as Record<string, unknown>;
  return {
    month: asNumber(p['month'], `${field}.month`, { min: 1, max: 12, integer: true }),
    day: asNumber(p['day'], `${field}.day`, { min: 1, max: 31, integer: true }),
  };
}

function parseLocalTime(value: unknown, field: string): LocalTime {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected { hour, minute }`);
  }
  const p = value as Record<string, unknown>;
  return {
    hour: asNumber(p['hour'], `${field}.hour`, { min: 0, max: 23, integer: true }),
    minute: asNumber(p['minute'], `${field}.minute`, { min: 0, max: 59, integer: true }),
  };
}

function parseRecurrence(value: unknown, field: string): RecurrenceRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected a recurrence object`);
  }
  const p = value as Record<string, unknown>;
  const kind = asEnum(p['kind'], `${field}.kind`, RECURRENCE_KINDS);
  const on = p['on'] === undefined || p['on'] === null ? null : parseLocalDate(p['on'], `${field}.on`);
  const at = p['at'] === undefined || p['at'] === null ? null : parseLocalTime(p['at'], `${field}.at`);
  if (kind === 'yearly' && (on === null || at === null)) {
    throw new PayloadValidationError(`${field}: yearly recurrence requires on { month, day } and at { hour, minute }`);
  }
  const finalYear = p['finalYear'] === undefined || p['finalYear'] === null
    ? null
    : asNumber(p['finalYear'], `${field}.finalYear`, { min: 1000, max: 9999, integer: true });
  const rule: RecurrenceRule = {
    kind,
    on,
    at,
    finalYear: finalYear ?? null,
    leapDayPolicy: asEnum(p['leapDayPolicy'], `${field}.leapDayPolicy`, LEAP_DAY_POLICIES),
  };
  // Semantic validation: the civil date must exist (Feb 29 governed by the
  // leap-day policy, FR-REM-03).
  validateRecurrenceRule(rule);
  return rule;
}

function parseTimeZone(value: unknown, field: string): TimeZoneName {
  return asTimeZoneName(value, field);
}

export function registerReminderApi(router: MessageRouter): void {
  router.register('reminders/create', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/create');
    const dueAt = asOptionalUtcTimestamp(p['dueAt'], 'dueAt');
    const recurrence = p['recurrence'] === undefined || p['recurrence'] === null
      ? null
      : parseRecurrence(p['recurrence'], 'recurrence');
    const normalizedDueAt = dueAt ?? null;
    if (normalizedDueAt === null && recurrence === null) {
      throw new PayloadValidationError('a reminder needs either dueAt or a recurrence rule');
    }
    const timeZone = parseTimeZone(p['timeZone'], 'timeZone');
    // Authoritative next occurrence: computed by the engine, never the client.
    const nextDueAt = computeNextDueAt({ dueAt: normalizedDueAt, recurrence, timeZone }, nowUtc());
    const reminder = await createReminder(await repo(), {
      noteId: asId(p['noteId'], 'noteId'),
      dueAt: normalizedDueAt,
      recurrence,
      timeZone,
      nextDueAt,
    });
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/create',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: recurrence ? ['dueAt', 'recurrence'] : ['dueAt'],
      detail: recurrence
        ? `created recurring reminder (${recurrence.kind}) for note ${reminder.noteId}`
        : `created one-time reminder for note ${reminder.noteId}`,
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/list-for-note', async (payload) => {
    const p = asObject(payload, 'reminders/list-for-note');
    const reminders = await listNoteReminders(await repo(), asId(p['noteId'], 'noteId'));
    return { reminders };
  });

  router.register('reminders/list-all', async () => {
    const reminders = await listAllReminders(await repo());
    return { reminders };
  });

  router.register('reminders/update-rule', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/update-rule');
    const reminderId = asId(p['reminderId'], 'reminderId');
    const current = await getReminder(await repo(), reminderId);
    if (!current) throw new ReminderNotFoundError(reminderId);
    const patch: {
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      nextDueAt?: UtcTimestamp | null;
      timeZone?: TimeZoneName;
    } = {};
    if (p['dueAt'] !== undefined) {
      patch.dueAt = asOptionalUtcTimestamp(p['dueAt'], 'dueAt');
    }
    if (p['recurrence'] !== undefined) {
      patch.recurrence = p['recurrence'] === null ? null : parseRecurrence(p['recurrence'], 'recurrence');
    }
    if (p['timeZone'] !== undefined) {
      patch.timeZone = parseTimeZone(p['timeZone'], 'timeZone');
    }
    // Recompute the next occurrence from the EFFECTIVE rule (FR-REM-04):
    // the engine sees the merged shape, so partial updates stay truthful.
    const effective = {
      dueAt: patch.dueAt !== undefined ? patch.dueAt : current.dueAt,
      recurrence: patch.recurrence !== undefined ? patch.recurrence : current.recurrence,
      timeZone: patch.timeZone !== undefined ? patch.timeZone : current.timeZone,
    };
    if (effective.dueAt === null && effective.recurrence === null) {
      throw new PayloadValidationError('a reminder needs either dueAt or a recurrence rule');
    }
    patch.nextDueAt = computeNextDueAt(effective, nowUtc());
    const reminder = await updateReminderRule(await repo(), reminderId, patch);
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/update-rule',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: Object.keys(patch),
      detail: 'updated reminder rule; next occurrence recomputed by the engine',
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/complete', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/complete');
    const reminder = await completeReminder(await repo(), asId(p['reminderId'], 'reminderId'));
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/complete',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: ['state'],
      detail: 'reminder completed',
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/dismiss', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/dismiss');
    const reminder = await dismissReminder(await repo(), asId(p['reminderId'], 'reminderId'));
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/dismiss',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: ['state'],
      detail: 'reminder dismissed',
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/stop', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/stop');
    const reminder = await stopRecurrence(await repo(), asId(p['reminderId'], 'reminderId'));
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/stop',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: ['recurrence'],
      detail: 'recurrence stopped',
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/snooze', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/snooze');
    const reminder = await snoozeReminder(
      await repo(),
      asId(p['reminderId'], 'reminderId'),
      asUtcTimestamp(p['until'], 'until'),
    );
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/snooze',
      targetKind: 'reminder',
      targetId: reminder.id,
      outcome: 'succeeded',
      changedFields: ['snoozedUntil'],
      detail: 'reminder snoozed',
      correlationId: ctx.correlationId,
    });
    return { reminder };
  });

  router.register('reminders/delete', async (payload, ctx) => {
    const p = asObject(payload, 'reminders/delete');
    const reminderId = asId(p['reminderId'], 'reminderId');
    await deleteReminder(await repo(), reminderId);
    await reconcileReminderAlarms();
    await auditUserAction({
      action: 'reminders/delete',
      targetKind: 'reminder',
      targetId: reminderId,
      outcome: 'succeeded',
      detail: 'reminder deleted',
      correlationId: ctx.correlationId,
    });
    return { deleted: true };
  });

  /** Manual reconciliation trigger (diagnostics and post-import, FR-REM-04). */
  router.register('reminders/reconcile-alarms', async () => reconcileReminderAlarms());

  router.register('reminders/get', async (payload) => {
    const p = asObject(payload, 'reminders/get');
    const reminderId = asId(p['reminderId'], 'reminderId');
    const reminder = await getReminder(await repo(), reminderId);
    if (!reminder) throw new ReminderNotFoundError(reminderId);
    return { reminder };
  });
}
