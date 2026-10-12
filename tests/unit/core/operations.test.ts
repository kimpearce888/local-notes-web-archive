import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/core/db/open';
import { RepoContext } from '../../../src/core/repo/context';
import { createNote } from '../../../src/core/repo/notes';
import {
  ReminderNotFoundError,
  completeReminder,
  createReminder,
  deleteReminder,
  dismissReminder,
  getReminder,
  listAllReminders,
  listDueReminders,
  listNoteReminders,
  listRemindersByState,
  markFired,
  snoozeReminder,
  stopRecurrence,
  updateReminderRule,
} from '../../../src/core/repo/reminders';
import {
  appendAuditEvent,
  countAuditEvents,
  listAuditEvents,
  pruneAuditEvents,
} from '../../../src/core/repo/audit';
import {
  DEFAULT_LOG_MAX_BYTES,
  appendLog,
  countLogs,
  listLogs,
  logBytesStored,
  rotateLogs,
  sanitizeLogMessage,
} from '../../../src/core/repo/logs';
import {
  DEFAULT_SETTINGS,
  getSettings,
  mergeSettings,
  patchSettings,
  saveSettings,
} from '../../../src/core/repo/settings';
import { newId } from '../../../src/core/util/ids';
import type { AppSettings, RecurrenceRule, TimeZoneName, UtcTimestamp } from '../../../src/core/types';

let db: IDBDatabase;
let ctx: RepoContext;

beforeEach(async () => {
  db = await openDatabase({ name: `ops-test-${newId()}` });
  ctx = new RepoContext(db);
});

afterEach(() => {
  db.close();
});

const ts = (s: string): UtcTimestamp => s as UtcTimestamp;
const tz = (s: string): TimeZoneName => s as TimeZoneName;

describe('reminders repository', () => {
  const yearlyRule: RecurrenceRule = {
    kind: 'yearly',
    on: { month: 10, day: 12 },
    at: { hour: 9, minute: 0 },
    finalYear: null,
    leapDayPolicy: 'feb-28',
  };

  it('creates one-time and yearly reminders with canonical records', async () => {
    const note = await createNote(ctx, {});
    const oneTime = await createReminder(ctx, {
      noteId: note.id,
      dueAt: ts('2026-11-01T09:00:00.000Z'),
      recurrence: null,
      timeZone: tz('Europe/Berlin'),
      nextDueAt: ts('2026-11-01T09:00:00.000Z'),
    });
    expect(oneTime.state).toBe('active');
    const yearly = await createReminder(ctx, {
      noteId: note.id,
      dueAt: null,
      recurrence: yearlyRule,
      timeZone: tz('Europe/Berlin'),
      nextDueAt: ts('2027-10-12T09:00:00.000Z'),
    });
    expect(yearly.recurrence?.kind).toBe('yearly');
    expect((await listNoteReminders(ctx, note.id)).length).toBe(2);
    await expect(
      createReminder(ctx, {
        noteId: note.id,
        dueAt: null,
        recurrence: null,
        timeZone: tz('UTC'),
        nextDueAt: null,
      }),
    ).rejects.toThrow(/needs either dueAt or a recurrence rule/);
  });

  it('transitions states: complete, dismiss, stop, snooze', async () => {
    const note = await createNote(ctx, {});
    const reminder = await createReminder(ctx, {
      noteId: note.id,
      dueAt: ts('2026-11-01T09:00:00.000Z'),
      recurrence: null,
      timeZone: tz('UTC'),
      nextDueAt: ts('2026-11-01T09:00:00.000Z'),
    });
    const snoozed = await snoozeReminder(ctx, reminder.id, ts('2026-11-02T09:00:00.000Z'));
    expect(snoozed.snoozedUntil).toBe('2026-11-02T09:00:00.000Z');
    expect(snoozed.nextDueAt).toBe('2026-11-02T09:00:00.000Z');
    const stopped = await stopRecurrence(ctx, reminder.id);
    expect(stopped.state).toBe('stopped');
    // Stopped preserves history (lastFiredAt intact).
    const fired = await markFired(ctx, reminder.id, ts('2026-11-01T09:00:00.000Z'), null);
    expect(fired.lastFiredAt).toBeTruthy();
    expect(fired.state).toBe('stopped');
    const completed = await completeReminder(ctx, reminder.id);
    expect(completed.state).toBe('completed');
    const dismissed = await dismissReminder(ctx, reminder.id);
    expect(dismissed.state).toBe('dismissed');
    await expect(getReminder(ctx, newId())).resolves.toBeNull();
    await expect(completeReminder(ctx, newId())).rejects.toBeInstanceOf(ReminderNotFoundError);
  });

  it('lists due and state-filtered reminders for reconciliation', async () => {
    const note = await createNote(ctx, {});
    await createReminder(ctx, {
      noteId: note.id,
      dueAt: ts('2026-10-01T09:00:00.000Z'),
      recurrence: null,
      timeZone: tz('UTC'),
      nextDueAt: ts('2026-10-01T09:00:00.000Z'),
    });
    await createReminder(ctx, {
      noteId: note.id,
      dueAt: ts('2026-12-01T09:00:00.000Z'),
      recurrence: null,
      timeZone: tz('UTC'),
      nextDueAt: ts('2026-12-01T09:00:00.000Z'),
    });
    const due = await listDueReminders(ctx, ts('2026-10-15T00:00:00.000Z'));
    expect(due).toHaveLength(1);
    expect(await listRemindersByState(ctx, 'active')).toHaveLength(2);
    expect(await listAllReminders(ctx)).toHaveLength(2);
    await updateReminderRule(ctx, due[0]!.id, { nextDueAt: ts('2027-01-01T00:00:00.000Z') });
    expect(await listDueReminders(ctx, ts('2026-10-15T00:00:00.000Z'))).toHaveLength(0);
    await deleteReminder(ctx, due[0]!.id);
    expect(await listAllReminders(ctx)).toHaveLength(1);
  });
});

describe('audit trail', () => {
  it('records actor/action/outcome with hashes, not bodies', async () => {
    const note = await createNote(ctx, {});
    const event = await appendAuditEvent(ctx, {
      actor: 'ai',
      action: 'update_note',
      targetId: note.id,
      targetKind: 'note',
      outcome: 'succeeded',
      correlationId: 'corr-42',
      changedFields: ['title', 'plainText'],
      contentHash: 'a'.repeat(64) as never,
      detail: 'AI updated the note after approval',
    });
    expect(event.id).toBeTruthy();
    const events = await listAuditEvents(ctx, { correlationId: 'corr-42' });
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe('ai');
    expect(events[0]?.contentHash).not.toBeNull();
    expect(JSON.stringify(events[0])).not.toContain('note body');
  });

  it('paginates newest-first and prunes by retention days', async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendAuditEvent(ctx, {
        actor: 'user',
        action: `action-${i}`,
        outcome: 'succeeded',
        correlationId: `corr-${i}`,
      });
    }
    const page = await listAuditEvents(ctx, { limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
    expect(page[0]?.action).toBe('action-4');
    expect(await countAuditEvents(ctx)).toBe(5);
    // Prune events older than 365 days → none removed (all fresh).
    expect(await pruneAuditEvents(ctx, 365)).toBe(0);
    // Prune events older than 0 days is a no-op by definition.
    expect(await pruneAuditEvents(ctx, 0)).toBe(0);
    expect(await countAuditEvents(ctx)).toBe(5);
  });

  it('truncates overlong details', async () => {
    const event = await appendAuditEvent(ctx, {
      actor: 'user',
      action: 'big',
      outcome: 'succeeded',
      correlationId: 'c',
      detail: 'x'.repeat(5000),
    });
    expect(event.detail.length).toBeLessThanOrEqual(500);
    expect(event.detail.endsWith('…')).toBe(true);
  });
});

describe('structured logs', () => {
  it('sanitizes secrets from messages (FR-LOG-03)', () => {
    expect(sanitizeLogMessage('token=abc12345 failed')).toBe('token=<redacted> failed');
    expect(sanitizeLogMessage('password: hunter2 denied')).toBe('password=<redacted> denied');
    // The fake token is built dynamically so no literal credential-looking
    // string ever sits in source control.
    const fakePat = ['gh', 'p_ABCDEFGHIJKLMNOPQRSTUVWXYZ01234'].join('');
    const patOutput = sanitizeLogMessage(`${fakePat} leaked`);
    expect(patOutput).not.toContain(fakePat);
    expect(patOutput).toContain('github-token=<redacted>');
    expect(sanitizeLogMessage('Authorization: Bearer eyJhbGciOi...')).not.toContain('eyJ');
    expect(sanitizeLogMessage('plain message stays')).toBe('plain message stays');
  });

  it('appends logs with structure and lists newest-first', async () => {
    await appendLog(ctx, {
      level: 'info',
      component: 'db',
      operationId: 'op-1',
      correlationId: 'corr-1',
      durationMs: 12,
      resultCode: 'OK',
      message: 'note saved',
    });
    await appendLog(ctx, {
      level: 'error',
      component: 'capture',
      operationId: 'op-2',
      resultCode: 'E_TIMEOUT',
      message: 'capture timed out after 90000ms',
    });
    const logs = await listLogs(ctx);
    expect(logs[0]?.component).toBe('capture');
    expect(logs[1]?.durationMs).toBe(12);
    expect(await countLogs(ctx)).toBe(2);
    expect(await logBytesStored(ctx)).toBeGreaterThan(0);
  });

  it('rotates oldest entries under a byte budget (FR-LOG-04)', async () => {
    // Small budget to force rotation with few entries.
    const tinyBudget = 700;
    for (let i = 0; i < 12; i += 1) {
      await appendLog(ctx, {
        level: 'info',
        component: 'test',
        operationId: `op-${i}`,
        resultCode: 'OK',
        message: `log entry number ${i} with some padding text to add bytes`,
      }, tinyBudget);
    }
    const bytes = await logBytesStored(ctx);
    expect(bytes).toBeLessThanOrEqual(tinyBudget + 400); // headroom for one entry
    const logs = await listLogs(ctx, 1000);
    expect(logs.length).toBeLessThan(12);
    // Oldest entries gone, newest kept.
    const ids = logs.map((l) => l.operationId);
    expect(ids).not.toContain('op-0');
    expect(ids).toContain('op-11');
    // Manual rotation is a no-op when under budget.
    expect(await rotateLogs(ctx, DEFAULT_LOG_MAX_BYTES)).toBe(0);
  });
});

describe('settings repository', () => {
  it('returns defaults before first save', async () => {
    expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  });

  it('saves, patches and persists settings', async () => {
    const saved = await patchSettings(ctx, { theme: 'dark', revisionRetention: 30 });
    expect(saved.theme).toBe('dark');
    expect(saved.revisionRetention).toBe(30);
    expect(saved.ai.baseUrl).toBe('http://127.0.0.1:1234/v1'); // untouched default
    const again = await getSettings(ctx);
    expect(again.theme).toBe('dark');
    await saveSettings(ctx, { ...again, viewMode: 'list' });
    expect((await getSettings(ctx)).viewMode).toBe('list');
  });

  it('rejects invalid settings truthfully', async () => {
    await expect(patchSettings(ctx, { revisionRetention: 5 })).rejects.toThrow(/at least 20/);
    await expect(
      patchSettings(ctx, { ai: { ...DEFAULT_SETTINGS.ai, baseUrl: 'https://api.example.com/v1' } }),
    ).rejects.toThrow(/loopback/);
    await expect(
      patchSettings(ctx, { ai: { ...DEFAULT_SETTINGS.ai, permissionMode: 'always' as never } }),
    ).rejects.toThrow(/permissionMode is invalid/);
  });

  it('mergeSettings fills new fields from defaults (forward compat)', () => {
    const legacy = { theme: 'light' } as Partial<AppSettings>;
    const merged = mergeSettings(legacy);
    expect(merged.theme).toBe('light');
    expect(merged.capture.maxArchiveBytes).toBe(DEFAULT_SETTINGS.capture.maxArchiveBytes);
    expect(merged.ai.permissionMode).toBe('ask-per-write');
  });
});
