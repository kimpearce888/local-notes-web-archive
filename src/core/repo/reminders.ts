import type { EntityId, Reminder, ReminderState } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Reminders repository (FR-REM-01..04): canonical recurrence records live in
 * IndexedDB; Chrome alarms are only wake-up hints and are rebuilt from these
 * records. The recurrence engine (next-occurrence computation) lives in
 * src/background/reminders/engine.ts; this module persists records and state.
 */

export class ReminderNotFoundError extends Error {
  constructor(readonly reminderId: EntityId) {
    super(`reminder ${reminderId} not found`);
    this.name = 'ReminderNotFoundError';
  }
}

export interface CreateReminderInput {
  readonly noteId: EntityId;
  /** One-time reminders: absolute due instant. */
  readonly dueAt: Reminder['dueAt'];
  /** Yearly reminders: canonical rule. */
  readonly recurrence: Reminder['recurrence'];
  readonly timeZone: Reminder['timeZone'];
  /** Engine-computed next occurrence, persisted for alarm scheduling. */
  readonly nextDueAt: Reminder['nextDueAt'];
}

export async function createReminder(
  ctx: RepoContext,
  input: CreateReminderInput,
): Promise<Reminder> {
  if (input.dueAt === null && input.recurrence === null) {
    throw new Error('a reminder needs either dueAt or a recurrence rule');
  }
  const now = nowUtc();
  const reminder: Reminder = {
    id: newId(),
    noteId: input.noteId,
    dueAt: input.dueAt,
    recurrence: input.recurrence,
    timeZone: input.timeZone,
    state: 'active',
    lastFiredAt: null,
    nextDueAt: input.nextDueAt,
    createdAt: now,
    updatedAt: now,
    snoozedUntil: null,
  };
  await ctx.transaction([Store.Reminders], 'readwrite', (stores) => {
    stores[Store.Reminders]?.put(reminder);
  });
  return reminder;
}

export async function getReminder(ctx: RepoContext, id: EntityId): Promise<Reminder | null> {
  return ctx.get<Reminder>(Store.Reminders, id);
}

export async function listNoteReminders(
  ctx: RepoContext,
  noteId: EntityId,
): Promise<Reminder[]> {
  const reminders = await ctx.getByIndex<Reminder>(Store.Reminders, 'noteId', noteId);
  return reminders.sort((a, b) => ((a.nextDueAt ?? '9999') < (b.nextDueAt ?? '9999') ? -1 : 1));
}

/** All reminders in a given state (alarm reconciliation input, FR-REM-04). */
export async function listRemindersByState(
  ctx: RepoContext,
  state: ReminderState,
): Promise<Reminder[]> {
  return ctx.getByIndex<Reminder>(Store.Reminders, 'state', state);
}

export async function listAllReminders(ctx: RepoContext): Promise<Reminder[]> {
  return ctx.getAll<Reminder>(Store.Reminders);
}

/** Active reminders with a next occurrence at or before `instant` (overdue). */
export async function listDueReminders(
  ctx: RepoContext,
  instant: ReturnType<typeof nowUtc>,
): Promise<Reminder[]> {
  const active = await listRemindersByState(ctx, 'active');
  return active.filter((r) => r.nextDueAt !== null && r.nextDueAt <= instant);
}

async function patchReminder(
  ctx: RepoContext,
  id: EntityId,
  patch: Partial<Reminder>,
): Promise<Reminder> {
  let updated: Reminder | null = null;
  await ctx.transaction([Store.Reminders], 'readwrite', (stores) => {
    const store = stores[Store.Reminders];
    if (!store) throw new Error('reminders store unavailable');
    return new Promise<void>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const reminder = req.result as Reminder | undefined;
        if (!reminder) {
          reject(new ReminderNotFoundError(id));
          return;
        }
        updated = { ...reminder, ...patch, updatedAt: nowUtc() };
        store.put(updated);
        resolve();
      };
      req.onerror = () => reject(req.error ?? new Error('reminder read failed'));
    });
  });
  if (!updated) throw new ReminderNotFoundError(id);
  return updated;
}

/** Record a fired occurrence and the engine-computed next one. */
export async function markFired(
  ctx: RepoContext,
  id: EntityId,
  firedAt: ReturnType<typeof nowUtc>,
  nextDueAt: Reminder['nextDueAt'],
): Promise<Reminder> {
  return patchReminder(ctx, id, { lastFiredAt: firedAt, nextDueAt });
}

/** Complete a reminder (one-time done, or an occurrence acknowledged). */
export async function completeReminder(ctx: RepoContext, id: EntityId): Promise<Reminder> {
  return patchReminder(ctx, id, { state: 'completed' });
}

export async function dismissReminder(ctx: RepoContext, id: EntityId): Promise<Reminder> {
  return patchReminder(ctx, id, { state: 'dismissed' });
}

/** Stop recurrence while preserving history (FR-REM-02). */
export async function stopRecurrence(ctx: RepoContext, id: EntityId): Promise<Reminder> {
  return patchReminder(ctx, id, { state: 'stopped' });
}

export async function snoozeReminder(
  ctx: RepoContext,
  id: EntityId,
  until: ReturnType<typeof nowUtc>,
): Promise<Reminder> {
  return patchReminder(ctx, id, { snoozedUntil: until, nextDueAt: until });
}

/** Update the rule and recomputed next occurrence (FR-REM-04). */
export async function updateReminderRule(
  ctx: RepoContext,
  id: EntityId,
  patch: { dueAt?: Reminder['dueAt']; recurrence?: Reminder['recurrence']; nextDueAt?: Reminder['nextDueAt']; timeZone?: Reminder['timeZone'] },
): Promise<Reminder> {
  return patchReminder(ctx, id, patch);
}

export async function deleteReminder(ctx: RepoContext, id: EntityId): Promise<void> {
  await ctx.transaction([Store.Reminders], 'readwrite', (stores) => {
    stores[Store.Reminders]?.delete(id);
  });
}
