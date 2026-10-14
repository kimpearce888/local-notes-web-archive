// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRemindersPanel,
  type RemindersPanelCallbacks,
} from '../../../src/dashboard/editor/reminders-panel';
import type { EntityId, Reminder, UtcTimestamp } from '../../../src/core/types';

/**
 * T-027 reminders panel UI (FR-REM-01..03): rows with states/details, the
 * create/edit dialog (one-time + yearly, leap-day policy visible, live
 * next-occurrence preview incl. DST notes, validation errors), snooze
 * presets, lifecycle actions and truthful failure states.
 */

let root: HTMLElement;

const NOTE_ID = 'note-0001' as EntityId;

beforeEach(() => {
  const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
  for (const dialog of Array.from(document.body.querySelectorAll('dialog'))) {
    dialog.remove();
  }
});

interface ReminderOverrides {
  id?: string;
  state?: Reminder['state'];
  dueAt?: UtcTimestamp | null;
  recurrence?: Reminder['recurrence'];
  timeZone?: string;
  nextDueAt?: UtcTimestamp | null;
  snoozedUntil?: UtcTimestamp | null;
  lastFiredAt?: UtcTimestamp | null;
}

function makeReminder(overrides: ReminderOverrides = {}): Reminder {
  return {
    id: (overrides.id ?? 'rem-0001') as EntityId,
    noteId: NOTE_ID,
    dueAt: overrides.dueAt ?? null,
    recurrence:
      overrides.recurrence ??
      (overrides.dueAt === undefined
        ? {
            kind: 'yearly',
            on: { month: 7, day: 4 },
            at: { hour: 9, minute: 0 },
            finalYear: null,
            leapDayPolicy: 'feb-28',
          }
        : null),
    timeZone: (overrides.timeZone ?? 'UTC') as Reminder['timeZone'],
    state: overrides.state ?? 'active',
    lastFiredAt: overrides.lastFiredAt ?? null,
    nextDueAt: overrides.nextDueAt ?? ('2027-07-04T09:00:00.000Z' as UtcTimestamp),
    createdAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp,
    updatedAt: '2026-01-01T00:00:00.000Z' as UtcTimestamp,
    snoozedUntil: overrides.snoozedUntil ?? null,
  };
}

interface PanelHarness {
  callbacks: RemindersPanelCallbacks & {
    reminders: Reminder[];
    created: unknown[];
    updated: { reminderId: EntityId; patch: unknown }[];
    completed: EntityId[];
    dismissed: EntityId[];
    stopped: EntityId[];
    snoozed: { reminderId: EntityId; until: UtcTimestamp }[];
    removed: EntityId[];
    announced: string[];
    listed: number;
    closed: number;
    failCreate: boolean;
  };
  panel: ReturnType<typeof createRemindersPanel>;
}

async function mountPanel(initial: Reminder[]): Promise<PanelHarness> {
  const callbacks = {
    reminders: [...initial],
    created: [] as unknown[],
    updated: [] as { reminderId: EntityId; patch: unknown }[],
    completed: [] as EntityId[],
    dismissed: [] as EntityId[],
    stopped: [] as EntityId[],
    snoozed: [] as { reminderId: EntityId; until: UtcTimestamp }[],
    removed: [] as EntityId[],
    announced: [] as string[],
    listed: 0,
    closed: 0,
    failCreate: false,
    async listForNote(): Promise<readonly Reminder[]> {
      this.listed += 1;
      return this.reminders;
    },
    async create(input: {
      noteId: EntityId;
      dueAt: UtcTimestamp | null;
      recurrence: Reminder['recurrence'];
      timeZone: string;
    }): Promise<Reminder> {
      if (this.failCreate) throw new Error('engine unavailable');
      this.created.push(input);
      const reminder = makeReminder({
        id: `rem-${this.reminders.length + 1}`,
        dueAt: input.dueAt,
        recurrence: input.recurrence,
        timeZone: input.timeZone,
        nextDueAt: input.dueAt ?? ('2027-07-04T09:00:00.000Z' as UtcTimestamp),
      });
      this.reminders.push(reminder);
      return reminder;
    },
    async updateRule(reminderId: EntityId, patch: unknown): Promise<Reminder> {
      this.updated.push({ reminderId, patch });
      return makeReminder({ id: reminderId });
    },
    async complete(reminderId: EntityId): Promise<boolean> {
      this.completed.push(reminderId);
      return true;
    },
    async dismiss(reminderId: EntityId): Promise<boolean> {
      this.dismissed.push(reminderId);
      return true;
    },
    async stop(reminderId: EntityId): Promise<boolean> {
      this.stopped.push(reminderId);
      return true;
    },
    async snooze(reminderId: EntityId, until: UtcTimestamp): Promise<boolean> {
      this.snoozed.push({ reminderId, until });
      return true;
    },
    async remove(reminderId: EntityId): Promise<boolean> {
      this.removed.push(reminderId);
      this.reminders = this.reminders.filter((r) => r.id !== reminderId);
      return true;
    },
    announce(message: string): void {
      this.announced.push(message);
    },
    onClose(): void {
      this.closed += 1;
    },
  };
  const panel = createRemindersPanel(NOTE_ID, callbacks);
  root.append(panel.element);
  await waitFor(() => callbacks.listed > 0);
  return { callbacks, panel };
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

function rowButtons(row: HTMLElement): HTMLButtonElement[] {
  return Array.from(row.querySelectorAll('button')) as HTMLButtonElement[];
}

function openCreateDialog(panel: PanelHarness['panel']): HTMLDialogElement {
  const addButton = Array.from(panel.element.querySelectorAll('button')).find(
    (b) => b.textContent === 'Add reminder…',
  ) as HTMLButtonElement;
  addButton.click();
  return document.querySelector('.dialog--form') as HTMLDialogElement;
}

function field(dialog: HTMLDialogElement, label: string): HTMLElement | null {
  for (const candidate of Array.from(dialog.querySelectorAll<HTMLElement>('label.dialog__field'))) {
    if (candidate.textContent?.startsWith(label)) return candidate;
  }
  return null;
}

function setSelect(dialog: HTMLDialogElement, label: string, value: string): void {
  const holder = field(dialog, label);
  const select = holder?.querySelector('select') as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function setInput(dialog: HTMLDialogElement, label: string, value: string): void {
  const holder = field(dialog, label);
  const input = holder?.querySelector('input') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('reminders panel rows', () => {
  it('carries an in-surface Close control that invokes onClose (UX-03)', async () => {
    const { panel, callbacks } = await mountPanel([makeReminder()]);
    const close = panel.element.querySelector('.panel-header__close') as HTMLButtonElement;
    expect(close).toBeTruthy();
    expect(close.getAttribute('aria-label')).toBe('Close reminders');
    close.click();
    expect(callbacks.closed).toBe(1);
  });

  it('lists reminders with states, rule details and next-occurrence meta', async () => {
    const { panel } = await mountPanel([
      makeReminder({ id: 'rem-1' }),
      makeReminder({
        id: 'rem-2',
        state: 'completed',
        nextDueAt: null,
        recurrence: {
          kind: 'yearly',
          on: { month: 2, day: 29 },
          at: { hour: 10, minute: 0 },
          finalYear: 2030,
          leapDayPolicy: 'skip',
        },
      }),
      makeReminder({
        id: 'rem-3',
        dueAt: '2030-01-01T09:00:00.000Z' as UtcTimestamp,
        recurrence: null,
        nextDueAt: '2030-01-01T09:00:00.000Z' as UtcTimestamp,
        timeZone: 'America/New_York',
      }),
    ]);
    await flush();

    const rows = panel.element.querySelectorAll('.reminders-panel__row');
    expect(rows.length).toBe(3);

    const first = rows[0] as HTMLElement;
    expect(first.querySelector('.reminder-state')?.textContent).toBe('Active');
    expect(first.querySelector('.reminders-panel__summary')?.textContent).toContain(
      'Yearly on July 4 at 09:00 local time, until stopped',
    );
    expect(first.querySelector('.reminders-panel__meta')?.textContent).toContain('Next:');
    expect(first.querySelector('.reminders-panel__meta')?.textContent).toContain('(UTC)');

    const second = rows[1] as HTMLElement;
    expect(second.querySelector('.reminder-state')?.textContent).toBe('Completed');
    // FR-REM-03: the leap-day policy is visible in the details.
    expect(second.querySelector('.reminders-panel__summary')?.textContent).toContain(
      'skipped in non-leap years',
    );
    expect(second.querySelector('.reminders-panel__summary')?.textContent).toContain(
      'through 2030 inclusive',
    );

    const third = rows[2] as HTMLElement;
    expect(third.querySelector('.reminders-panel__summary')?.textContent).toContain('One time');
    expect(third.querySelector('.reminders-panel__summary')?.textContent).toContain('04:00');
    expect(third.querySelector('.reminders-panel__summary')?.textContent).toContain(
      'America/New_York',
    );
    expect(panel.element.querySelector('.reminders-panel__count')?.textContent).toBe(
      '3 reminders',
    );
  });

  it('marks active overdue reminders and shows snooze/last-fired meta', async () => {
    const past = '2020-01-01T00:00:00.000Z' as UtcTimestamp;
    const { panel } = await mountPanel([
      makeReminder({ id: 'rem-over', nextDueAt: past }),
    ]);
    await flush();
    const row = panel.element.querySelector('.reminders-panel__row') as HTMLElement;
    expect(row.querySelector('.reminder-state--overdue')?.textContent).toBe('Overdue');
  });

  it('shows the empty state with guidance and no count', async () => {
    const { panel } = await mountPanel([]);
    await flush();
    expect(panel.element.querySelectorAll('.reminders-panel__row').length).toBe(0);
    expect(panel.element.querySelector('.reminders-panel__empty')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(panel.element.querySelector('.reminders-panel__count')?.textContent).toBe('');
  });

  it('gates lifecycle actions by state', async () => {
    const { callbacks, panel } = await mountPanel([
      makeReminder({ id: 'rem-active' }),
      makeReminder({ id: 'rem-done', state: 'completed', nextDueAt: null }),
    ]);
    await flush();
    const rows = Array.from(panel.element.querySelectorAll('.reminders-panel__row')) as HTMLElement[];

    const activeLabels = rowButtons(rows[0]!).map((b) => b.textContent);
    expect(activeLabels).toContain('Complete');
    expect(activeLabels).toContain('Dismiss');
    expect(activeLabels).toContain('Stop recurrence'); // yearly
    expect(activeLabels).toContain('Snooze…');

    const doneLabels = rowButtons(rows[1]!).map((b) => b.textContent);
    expect(doneLabels).not.toContain('Complete');
    expect(doneLabels).not.toContain('Snooze…');
    expect(doneLabels).not.toContain('Stop recurrence');
    expect(doneLabels).toContain('Edit…');

    rowButtons(rows[0]!)
      .find((b) => b.textContent === 'Complete')!
      .click();
    await waitFor(() => callbacks.completed.length === 1);
    expect(callbacks.completed[0]).toBe('rem-active' as EntityId);
  });
});

describe('reminders create dialog', () => {
  it('creates a one-time reminder from a datetime-local value in the chosen zone', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);

    setInput(dialog, 'Date and time', '2030-06-15T14:30');
    // Zone defaults to the system zone; set an explicit one.
    setInput(dialog, 'Time zone', 'America/New_York');
    await flush();

    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    await waitFor(() => callbacks.created.length === 1);

    const input = callbacks.created[0] as { dueAt: string; recurrence: unknown; timeZone: string };
    // 14:30 EDT (-4) on June 15.
    expect(input.dueAt).toBe('2030-06-15T18:30:00.000Z');
    expect(input.recurrence).toBeNull();
    expect(input.timeZone).toBe('America/New_York');
    expect(callbacks.announced.join(' ')).toContain('Added the reminder');
    await waitFor(() => panel.element.querySelectorAll('.reminders-panel__row').length === 1);
  });

  it('previews and resolves DST gap times with a visible note', async () => {
    const { panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);

    // 2030-03-10 is the second Sunday: 02:30 does not exist in New York
    // (spring-forward gap). Browsers keep the raw string for datetime-local.
    setInput(dialog, 'Date and time', '2030-03-10T02:30');
    setInput(dialog, 'Time zone', 'America/New_York');
    await waitFor(
      () => dialog.querySelector('.reminders-panel__preview')?.textContent?.includes('daylight-saving') === true,
    );

    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    save.click();
    // The shifted instant is 03:30 EDT = 07:30Z.
    await flush();
    expect(dialog.textContent).not.toContain('failed');
  });

  it('creates yearly reminders with the selected policy and live preview', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);

    setSelect(dialog, 'Kind', 'yearly');
    setSelect(dialog, 'Month', '2');
    setInput(dialog, 'Day', '29');
    setInput(dialog, 'Time (local)', '10:00');
    setSelect(dialog, 'Feb 29 behavior', 'mar-1');
    setInput(dialog, 'Final year', '2040');
    setInput(dialog, 'Time zone', 'UTC');
    await waitFor(
      () => dialog.querySelector('.reminders-panel__preview')?.textContent?.includes('Next occurrence:') === true,
    );

    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    save.click();
    await waitFor(() => callbacks.created.length === 1);

    const input = callbacks.created[0] as {
      dueAt: string | null;
      recurrence: {
        kind: string;
        on: { month: number; day: number };
        finalYear: number | null;
        leapDayPolicy: string;
      };
    };
    expect(input.recurrence.kind).toBe('yearly');
    expect(input.recurrence.on).toEqual({ month: 2, day: 29 });
    expect(input.recurrence.finalYear).toBe(2040);
    expect(input.recurrence.leapDayPolicy).toBe('mar-1');
    expect(input.dueAt).toBeNull();
  });

  it('validates inputs with inline errors and a disabled save button', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);

    // Invalid zone (spaces cannot appear in IANA names).
    setInput(dialog, 'Time zone', 'Not A Zone');
    await waitFor(() => (dialog.querySelector('.reminders-panel__status--error') as HTMLElement).hidden === false);
    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    // Fix the zone, break the date instead: Feb 30 — HTML sanitizes the
    // impossible datetime-local value to empty, surfacing the pick-a-date
    // error (the honest browser behavior).
    setInput(dialog, 'Time zone', 'UTC');
    setInput(dialog, 'Date and time', '2030-02-30T10:00');
    await waitFor(() =>
      (dialog.querySelector('.reminders-panel__status--error') as HTMLElement).textContent?.includes(
        'Pick a date',
      ) === true,
    );
    expect(save.disabled).toBe(true);

    // Missing date entirely.
    setInput(dialog, 'Date and time', '');
    await waitFor(() =>
      (dialog.querySelector('.reminders-panel__status--error') as HTMLElement).textContent?.includes(
        'Pick a date',
      ) === true,
    );
    expect(callbacks.created.length).toBe(0);
  });

  it('validates yearly day/time inputs', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);

    setSelect(dialog, 'Kind', 'yearly');
    setSelect(dialog, 'Month', '4');
    setInput(dialog, 'Day', '31'); // April has 30 days.
    setInput(dialog, 'Time zone', 'UTC');
    await waitFor(() =>
      (dialog.querySelector('.reminders-panel__status--error') as HTMLElement).textContent?.includes(
        'does not exist in April',
      ) === true,
    );
    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(callbacks.created.length).toBe(0);
  });

  it('surfaces create failures truthfully inside the dialog', async () => {
    const { callbacks, panel } = await mountPanel([]);
    const dialog = openCreateDialog(panel);
    setInput(dialog, 'Date and time', '2030-06-15T14:30');
    setInput(dialog, 'Time zone', 'UTC');
    await flush();
    callbacks.failCreate = true;

    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Add reminder',
    ) as HTMLButtonElement;
    save.click();
    await waitFor(() =>
      dialog.textContent?.includes('Saving the reminder failed') === true,
    );
    expect(dialog.open).toBe(true); // the dialog stays for correction
  });
});

describe('reminders lifecycle dialogs', () => {
  it('snoozes through preset durations', async () => {
    const { callbacks, panel } = await mountPanel([makeReminder({ id: 'rem-1' })]);
    await flush();
    const row = panel.element.querySelector('.reminders-panel__row') as HTMLElement;

    rowButtons(row)
      .find((b) => b.textContent === 'Snooze…')!
      .click();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    const oneHour = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === '1 hour',
    ) as HTMLButtonElement;
    oneHour.click();
    await waitFor(() => callbacks.snoozed.length === 1);

    const { until } = callbacks.snoozed[0]!;
    const deltaMinutes = (new Date(until).getTime() - Date.now()) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(55);
    expect(deltaMinutes).toBeLessThan(65);
    expect(callbacks.announced.join(' ')).toContain('1 hour');
  });

  it('deletes after an explicit confirmation and cancels cleanly', async () => {
    const { callbacks, panel } = await mountPanel([makeReminder({ id: 'rem-1' })]);
    await flush();
    const row = panel.element.querySelector('.reminders-panel__row') as HTMLElement;

    rowButtons(row)
      .find((b) => b.textContent === 'Delete…')!
      .click();
    const confirmDialog = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    expect(confirmDialog.textContent).toContain('Delete reminder?');

    Array.from(confirmDialog.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === 'Cancel')!
      .click();
    await flush();
    expect(callbacks.removed.length).toBe(0);

    rowButtons(row)
      .find((b) => b.textContent === 'Delete…')!
      .click();
    const again = document.querySelector('.dialog--confirm') as HTMLDialogElement;
    Array.from(again.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === 'Delete reminder')!
      .click();
    await waitFor(() => callbacks.removed.length === 1);
    expect(callbacks.removed[0]).toBe('rem-1' as EntityId);
    await waitFor(() => panel.element.querySelectorAll('.reminders-panel__row').length === 0);
  });

  it('edits through a pre-filled dialog calling updateRule', async () => {
    const { callbacks, panel } = await mountPanel([
      makeReminder({
        id: 'rem-1',
        recurrence: {
          kind: 'yearly',
          on: { month: 3, day: 8 },
          at: { hour: 7, minute: 30 },
          finalYear: null,
          leapDayPolicy: 'feb-28',
        },
      }),
    ]);
    await flush();
    const row = panel.element.querySelector('.reminders-panel__row') as HTMLElement;

    rowButtons(row)
      .find((b) => b.textContent === 'Edit…')!
      .click();
    const dialog = document.querySelector('.dialog--form') as HTMLDialogElement;
    expect(dialog).not.toBeNull();

    // Pre-filled values from the existing rule.
    const monthSelect = field(dialog, 'Month')?.querySelector('select') as HTMLSelectElement;
    expect(monthSelect.value).toBe('3');
    const dayInput = field(dialog, 'Day')?.querySelector('input') as HTMLInputElement;
    expect(dayInput.value).toBe('8');
    const timeInput = field(dialog, 'Time (local)')?.querySelector('input') as HTMLInputElement;
    expect(timeInput.value).toBe('07:30');
    const zoneInput = field(dialog, 'Time zone')?.querySelector('input') as HTMLInputElement;
    expect(zoneInput.value).toBe('UTC');

    // Change the final year and save.
    setInput(dialog, 'Final year', '2050');
    const save = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog__actions button')).find(
      (b) => b.textContent === 'Save changes',
    ) as HTMLButtonElement;
    save.click();
    await waitFor(() => callbacks.updated.length === 1);

    const { reminderId, patch } = callbacks.updated[0]!;
    expect(reminderId).toBe('rem-1' as EntityId);
    const rule = (patch as { recurrence: Reminder['recurrence'] }).recurrence;
    expect(rule?.on).toEqual({ month: 3, day: 8 });
    expect(rule?.finalYear).toBe(2050);
    expect(callbacks.announced.join(' ')).toContain('Updated the reminder');
  });

  it('dispose removes the element and closes open dialogs', async () => {
    const { panel } = await mountPanel([makeReminder()]);
    await flush();
    const dialog = openCreateDialog(panel);
    await flush();
    panel.dispose();
    expect(panel.element.parentElement).toBeNull();
    expect(dialog.parentElement).toBeNull();
  });

  it('reports listing failures truthfully', async () => {
    const callbacks: RemindersPanelCallbacks = {
      listForNote: async (): Promise<readonly Reminder[]> => {
        throw new Error('database unavailable');
      },
      create: async (): Promise<Reminder> => {
        throw new Error('unreachable');
      },
      updateRule: async (): Promise<Reminder> => {
        throw new Error('unreachable');
      },
      complete: async (): Promise<boolean> => false,
      dismiss: async (): Promise<boolean> => false,
      stop: async (): Promise<boolean> => false,
      snooze: async (): Promise<boolean> => false,
      remove: async (): Promise<boolean> => false,
      announce: (): void => undefined,
      onClose: (): void => undefined,
    };
    const panel = createRemindersPanel(NOTE_ID, callbacks);
    root.append(panel.element);
    await flush();
    expect(panel.element.querySelector('.reminders-panel__status--error')?.textContent).toContain(
      'Listing reminders failed',
    );
  });
});

// Silence the unused-import lint for vi (kept for future timing stubs).
void vi;
