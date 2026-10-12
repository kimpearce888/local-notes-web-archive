/**
 * Reminders panel (T-027, FR-REM-01..03): the editor-session surface for a
 * note's reminders — creation (one-time and yearly with the Feb-29 policy
 * visible), details incl. the deterministic next occurrence, and the
 * complete/dismiss/stop/snooze/delete lifecycle.
 *
 * The panel imports the PURE engine for the client-side preview of the
 * next occurrence; the background recomputes it authoritatively on save
 * (FR-REM-04: alarms are hints, records are canonical).
 */

import type {
  EntityId,
  LeapDayPolicy,
  RecurrenceRule,
  Reminder,
  TimeZoneName,
  UtcTimestamp,
} from '../../core/types';
import { daysInMonth, isValidTimeZone } from '../../core/util/time';
import {
  computeNextDueAt,
  describeRecurrenceRule,
  isReminderOverdue,
  nextYearlyOccurrence,
  resolveWallClock,
  type WallClockResolution,
} from '../../background/reminders/engine';

export interface RemindersPanelCallbacks {
  listForNote(noteId: EntityId): Promise<readonly Reminder[]>;
  create(input: {
    noteId: EntityId;
    dueAt: UtcTimestamp | null;
    recurrence: RecurrenceRule | null;
    timeZone: TimeZoneName;
  }): Promise<Reminder>;
  updateRule(
    reminderId: EntityId,
    patch: {
      dueAt?: UtcTimestamp | null;
      recurrence?: RecurrenceRule | null;
      timeZone?: TimeZoneName;
    },
  ): Promise<Reminder>;
  complete(reminderId: EntityId): Promise<boolean>;
  dismiss(reminderId: EntityId): Promise<boolean>;
  stop(reminderId: EntityId): Promise<boolean>;
  snooze(reminderId: EntityId, until: UtcTimestamp): Promise<boolean>;
  remove(reminderId: EntityId): Promise<boolean>;
  announce(message: string): void;
}

export interface RemindersPanel {
  readonly element: HTMLElement;
  refresh(): Promise<void>;
  dispose(): void;
}

/** System zone shown as the default for new reminders. */
function systemTimeZone(): TimeZoneName {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (isValidTimeZone(zone) ? zone : 'UTC') as TimeZoneName;
  } catch {
    return 'UTC' as TimeZoneName;
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Local presentation of a UTC instant inside the reminder's zone. */
function formatInZone(instant: UtcTimestamp, timeZone: TimeZoneName): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${formatter.format(new Date(instant))} (${timeZone})`;
}

/** Parse "YYYY-MM-DDTHH:mm" (datetime-local / time inputs) or null. */
function parseLocalDateTime(value: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number.parseInt(match[1]!, 10),
    month: Number.parseInt(match[2]!, 10),
    day: Number.parseInt(match[3]!, 10),
    hour: Number.parseInt(match[4]!, 10),
    minute: Number.parseInt(match[5]!, 10),
  };
}

function parseTimeOnly(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return { hour: Number.parseInt(match[1]!, 10), minute: Number.parseInt(match[2]!, 10) };
}

const SNOOZE_PRESETS: readonly { label: string; minutes: number }[] = [
  { label: '5 minutes', minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '24 hours', minutes: 24 * 60 },
];

export function createRemindersPanel(
  noteId: EntityId,
  callbacks: RemindersPanelCallbacks,
): RemindersPanel {
  const element = document.createElement('section');
  element.className = 'reminders-panel';
  element.setAttribute('aria-label', 'Note reminders');

  const heading = document.createElement('h2');
  heading.className = 'reminders-panel__heading';
  heading.textContent = 'Reminders';

  const count = document.createElement('span');
  count.className = 'reminders-panel__count';
  count.setAttribute('aria-live', 'polite');

  const listbox = document.createElement('ul');
  listbox.className = 'reminders-panel__list';
  listbox.setAttribute('role', 'list');

  const empty = document.createElement('p');
  empty.className = 'reminders-panel__empty';
  empty.textContent =
    'No reminders. Add a one-time reminder or a yearly reminder that repeats until stopped or through a final year.';

  const status = document.createElement('p');
  status.className = 'reminders-panel__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn';
  addButton.textContent = 'Add reminder…';

  function setStatus(message: string, isError: boolean): void {
    status.textContent = message;
    status.hidden = message.length === 0;
    status.classList.toggle('reminders-panel__status--error', isError);
  }

  /* ------------------------- Dialog registry ------------------------ */

  const openDialogs = new Set<HTMLDialogElement>();
  const presentDialog = (dialog: HTMLDialogElement): void => {
    openDialogs.add(dialog);
    dialog.addEventListener('close', () => {
      openDialogs.delete(dialog);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  };
  const closeOpenDialogs = (): void => {
    for (const dialog of Array.from(openDialogs)) dialog.close();
  };

  /* --------------------------- Rows --------------------------------- */

  const STATE_LABELS: Readonly<Record<Reminder['state'], string>> = {
    active: 'Active',
    completed: 'Completed',
    dismissed: 'Dismissed',
    stopped: 'Stopped',
  };

  function reminderStateChip(reminder: Reminder, now: UtcTimestamp): HTMLElement {
    const chip = document.createElement('span');
    if (reminder.state === 'active' && isReminderOverdue(reminder, now)) {
      chip.className = 'reminder-state reminder-state--overdue';
      chip.textContent = 'Overdue';
    } else {
      chip.className = 'reminder-state';
      chip.textContent = STATE_LABELS[reminder.state];
    }
    return chip;
  }

  function reminderSummary(reminder: Reminder): string {
    if (reminder.recurrence !== null) return describeRecurrenceRule(reminder.recurrence);
    if (reminder.dueAt !== null) {
      return `One time: due ${formatInZone(reminder.dueAt, reminder.timeZone)}`;
    }
    return 'One time';
  }

  function rowFor(reminder: Reminder, now: UtcTimestamp): HTMLElement {
    const row = document.createElement('li');
    row.className = 'reminders-panel__row';
    row.dataset['reminderId'] = reminder.id;

    row.append(reminderStateChip(reminder, now));

    const summary = document.createElement('span');
    summary.className = 'reminders-panel__summary';
    summary.textContent = reminderSummary(reminder);
    row.append(summary);

    const meta = document.createElement('span');
    meta.className = 'reminders-panel__meta';
    const metaParts: string[] = [];
    if (reminder.state === 'active' && reminder.nextDueAt !== null) {
      metaParts.push(`Next: ${formatInZone(reminder.nextDueAt, reminder.timeZone)}`);
    }
    if (reminder.snoozedUntil !== null && reminder.state === 'active') {
      metaParts.push(`Snoozed until ${formatInZone(reminder.snoozedUntil, reminder.timeZone)}`);
    }
    if (reminder.lastFiredAt !== null) {
      metaParts.push(`Last fired ${reminder.lastFiredAt.slice(0, 10)}`);
    }
    meta.textContent = metaParts.join(' · ');
    row.append(meta);

    const actions = document.createElement('div');
    actions.className = 'reminders-panel__actions';

    const act = (
      label: string,
      run: () => Promise<boolean>,
      options: { danger?: boolean; disabled?: boolean } = {},
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = options.danger === true ? 'btn btn--ghost btn--danger' : 'btn btn--ghost';
      button.textContent = label;
      if (options.disabled === true) {
        button.disabled = true;
        return button;
      }
      button.addEventListener('click', () => {
        void (async () => {
          button.disabled = true;
          const ok = await run().catch(() => false);
          button.disabled = false;
          if (!ok) {
            setStatus(`${label.toLowerCase()} failed — the reminder was not changed.`, true);
            return;
          }
          await refresh();
        })();
      });
      return button;
    };

    if (reminder.state === 'active') {
      actions.append(
        act('Complete', () => callbacks.complete(reminder.id)),
        act('Dismiss', () => callbacks.dismiss(reminder.id)),
      );
      if (reminder.recurrence !== null) {
        actions.append(act('Stop recurrence', () => callbacks.stop(reminder.id)));
      }
      const snooze = document.createElement('button');
      snooze.type = 'button';
      snooze.className = 'btn btn--ghost';
      snooze.textContent = 'Snooze…';
      snooze.addEventListener('click', () => promptSnooze(reminder, now));
      actions.append(snooze);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn--ghost';
    edit.textContent = 'Edit…';
    edit.addEventListener('click', () => openReminderDialog(reminder));
    actions.append(edit);

    actions.append(
      act('Delete…', () => confirmDelete(reminder), { danger: true }),
    );
    row.append(actions);
    return row;
  }

  function confirmDelete(reminder: Reminder): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog dialog--confirm';
      const heading = document.createElement('h2');
      heading.textContent = 'Delete reminder?';
      const body = document.createElement('p');
      body.textContent = `${reminderSummary(reminder)} will be removed. This does not delete the note.`;
      const actions = document.createElement('div');
      actions.className = 'dialog__actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        dialog.close();
        resolve(false);
      });
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'btn btn--danger';
      confirmButton.textContent = 'Delete reminder';
      confirmButton.addEventListener('click', () => {
        dialog.close();
        resolve(true);
      });
      actions.append(cancel, confirmButton);
      dialog.append(heading, body, actions);
      presentDialog(dialog);
      confirmButton.focus();
    }).then(async (confirmed) => {
      if (!confirmed) return false;
      const ok = await callbacks.remove(reminder.id).catch(() => false);
      if (ok) {
        callbacks.announce('Deleted the reminder.');
        await refresh();
      }
      return ok;
    });
  }

  function promptSnooze(reminder: Reminder, now: UtcTimestamp): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const heading = document.createElement('h2');
    heading.textContent = 'Snooze reminder';
    const body = document.createElement('p');
    body.textContent = 'Push this reminder back. It stays active and appears again when the snooze ends.';
    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    for (const preset of SNOOZE_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        const until = new Date(new Date(now).getTime() + preset.minutes * 60_000).toISOString() as UtcTimestamp;
        dialog.close();
        void (async () => {
          const ok = await callbacks.snooze(reminder.id, until).catch(() => false);
          if (ok) {
            callbacks.announce(`Snoozed for ${preset.label.toLowerCase()}.`);
            await refresh();
          } else {
            setStatus('Snoozing the reminder failed.', true);
          }
        })();
      });
      actions.append(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--primary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(cancel);
    dialog.append(heading, body, actions);
    presentDialog(dialog);
  }

  /* ------------------------ Create / edit --------------------------- */

  /**
   * The reminder dialog (create + edit): kind, civil date/time, final year,
   * leap-day policy (visible per FR-REM-03), zone, and a LIVE preview of
   * the engine-computed next occurrence incl. DST resolution notes.
   */
  function openReminderDialog(existing: Reminder | null): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog dialog--form';
    const heading = document.createElement('h2');
    heading.textContent = existing === null ? 'Add reminder' : 'Edit reminder';
    dialog.append(heading);

    // Kind.
    const kindField = document.createElement('label');
    kindField.className = 'dialog__field';
    kindField.textContent = 'Kind';
    const kindSelect = document.createElement('select');
    kindSelect.className = 'search-input';
    for (const [value, label] of [
      ['one-time', 'One time'],
      ['yearly', 'Yearly'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      kindSelect.append(option);
    }
    kindSelect.value = existing?.recurrence?.kind ?? (existing?.dueAt != null ? 'one-time' : 'one-time');
    kindSelect.disabled = existing !== null; // rule kind is fixed once created (recreate to change)
    kindField.append(kindSelect);
    dialog.append(kindField);

    // One-time: datetime-local.
    const whenField = document.createElement('label');
    whenField.className = 'dialog__field';
    whenField.textContent = 'Date and time (local)';
    const whenInput = document.createElement('input');
    whenInput.type = 'datetime-local';
    whenInput.className = 'search-input';
    if (existing?.dueAt != null) {
      // Pre-fill with the reminder's civil time in its own zone.
      whenInput.value = civilStringInZone(existing.dueAt, existing.timeZone);
    }
    whenField.append(whenInput);
    dialog.append(whenField);

    // Yearly: month / day / time.
    const yearlyBlock = document.createElement('div');
    yearlyBlock.className = 'reminders-panel__yearly';

    const monthField = document.createElement('label');
    monthField.className = 'dialog__field';
    monthField.textContent = 'Month';
    const monthSelect = document.createElement('select');
    monthSelect.className = 'search-input';
    MONTH_NAMES.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = name;
      monthSelect.append(option);
    });
    monthSelect.value = String(existing?.recurrence?.on?.month ?? 1);
    monthField.append(monthSelect);

    const dayField = document.createElement('label');
    dayField.className = 'dialog__field';
    dayField.textContent = 'Day';
    const dayInput = document.createElement('input');
    dayInput.type = 'number';
    dayInput.min = '1';
    dayInput.max = '31';
    dayInput.className = 'search-input';
    dayInput.value = String(existing?.recurrence?.on?.day ?? 1);
    dayField.append(dayInput);

    const timeField = document.createElement('label');
    timeField.className = 'dialog__field';
    timeField.textContent = 'Time (local)';
    const timeInput = document.createElement('input');
    timeInput.type = 'time';
    timeInput.className = 'search-input';
    const at = existing?.recurrence?.at;
    timeInput.value = `${String(at?.hour ?? 9).padStart(2, '0')}:${String(at?.minute ?? 0).padStart(2, '0')}`;
    timeField.append(timeInput);

    yearlyBlock.append(monthField, dayField, timeField);
    dialog.append(yearlyBlock);

    // Final year + leap-day policy.
    const finalYearField = document.createElement('label');
    finalYearField.className = 'dialog__field';
    finalYearField.textContent = 'Final year (inclusive, optional — empty repeats until stopped)';
    const finalYearInput = document.createElement('input');
    finalYearInput.type = 'number';
    finalYearInput.min = '1000';
    finalYearInput.max = '9999';
    finalYearInput.className = 'search-input';
    if (existing?.recurrence?.finalYear != null) {
      finalYearInput.value = String(existing.recurrence.finalYear);
    }
    finalYearField.append(finalYearInput);
    dialog.append(finalYearField);

    const leapField = document.createElement('label');
    leapField.className = 'dialog__field';
    leapField.textContent = 'Feb 29 behavior in non-leap years';
    const leapSelect = document.createElement('select');
    leapSelect.className = 'search-input';
    for (const [value, label] of [
      ['feb-28', 'February 28 (default)'],
      ['mar-1', 'March 1'],
      ['skip', 'Skip that year'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      leapSelect.append(option);
    }
    leapSelect.value = existing?.recurrence?.leapDayPolicy ?? 'feb-28';
    leapField.append(leapSelect);
    dialog.append(leapField);

    // Zone.
    const zoneField = document.createElement('label');
    zoneField.className = 'dialog__field';
    zoneField.textContent = 'Time zone (IANA)';
    const zoneInput = document.createElement('input');
    zoneInput.type = 'text';
    zoneInput.className = 'search-input';
    zoneInput.value = existing?.timeZone ?? systemTimeZone();
    zoneField.append(zoneInput);
    dialog.append(zoneField);

    // Live preview (engine, client-side; the background recomputes on save).
    const preview = document.createElement('p');
    preview.className = 'reminders-panel__preview';
    preview.setAttribute('aria-live', 'polite');

    const error = document.createElement('p');
    error.className = 'reminders-panel__status reminders-panel__status--error';
    error.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'dialog__actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => dialog.close());
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary';
    saveButton.textContent = existing === null ? 'Add reminder' : 'Save changes';
    actions.append(cancelButton, saveButton);

    dialog.append(preview, error, actions);
    presentDialog(dialog);

    interface Draft {
      dueAt: UtcTimestamp | null;
      recurrence: RecurrenceRule | null;
      timeZone: TimeZoneName;
      problem: string | null;
      /** DST resolution of the chosen wall clock, when one was resolved. */
      resolution: WallClockResolution | null;
    }

    function readDraft(): Draft {
      const zone = zoneInput.value.trim();
      if (!isValidTimeZone(zone)) {
        return {
          dueAt: null,
          recurrence: null,
          timeZone: zone as TimeZoneName,
          problem: `"${zone}" is not a valid IANA time zone.`,
          resolution: null,
        };
      }
      const timeZone = zone as TimeZoneName;
      if (kindSelect.value === 'one-time') {
        const parsed = parseLocalDateTime(whenInput.value);
        if (parsed === null) {
          return { dueAt: null, recurrence: null, timeZone, problem: 'Pick a date and time.', resolution: null };
        }
        if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > daysInMonth(parsed.year, parsed.month)) {
          return { dueAt: null, recurrence: null, timeZone, problem: 'That date does not exist.', resolution: null };
        }
        const resolution = resolveWallClock(
          { year: parsed.year, month: parsed.month, day: parsed.day },
          { hour: parsed.hour, minute: parsed.minute },
          timeZone,
        );
        return { dueAt: resolution.at, recurrence: null, timeZone, problem: null, resolution };
      }
      const month = Number.parseInt(monthSelect.value, 10);
      const day = Number.parseInt(dayInput.value, 10);
      if (!Number.isInteger(day) || day < 1 || day > daysInMonth(2024, month)) {
        return {
          dueAt: null,
          recurrence: null,
          timeZone,
          problem: `Day ${day || '(empty)'} does not exist in ${MONTH_NAMES[month - 1]}.`,
          resolution: null,
        };
      }
      const time = parseTimeOnly(timeInput.value);
      if (time === null) {
        return { dueAt: null, recurrence: null, timeZone, problem: 'Pick a time.', resolution: null };
      }
      const finalYearText = finalYearInput.value.trim();
      let finalYear: number | null = null;
      if (finalYearText.length > 0) {
        finalYear = Number.parseInt(finalYearText, 10);
        if (!Number.isInteger(finalYear) || finalYear < 1000 || finalYear > 9999) {
          return {
            dueAt: null,
            recurrence: null,
            timeZone,
            problem: 'Final year must be a year between 1000 and 9999.',
            resolution: null,
          };
        }
      }
      const leapDayPolicy = leapSelect.value as LeapDayPolicy;
      const recurrence: RecurrenceRule = {
        kind: 'yearly',
        on: { month, day },
        at: { hour: time.hour, minute: time.minute },
        finalYear,
        leapDayPolicy,
      };
      return { dueAt: null, recurrence, timeZone, problem: null, resolution: null };
    }

    function updatePreview(): void {
      const draft = readDraft();
      if (draft.problem !== null) {
        preview.textContent = '';
        error.textContent = draft.problem;
        error.hidden = false;
        saveButton.disabled = true;
        return;
      }
      error.hidden = true;
      error.textContent = '';
      saveButton.disabled = false;
      const next = computeNextDueAt(draft, nowIso());
      if (next === null) {
        preview.textContent =
          'This recurrence has already ended (final year passed) — saving keeps the history with no future occurrences.';
        return;
      }
      // DST resolution notes for BOTH kinds (FR-REM-07 visibility): the
      // one-time path resolves the wall clock directly; the yearly path
      // re-derives the occurrence resolution from the engine.
      let resolution: WallClockResolution | null = draft.resolution;
      if (draft.recurrence !== null) {
        const occurrence = nextYearlyOccurrence(draft.recurrence, draft.timeZone, nowIso());
        resolution = occurrence?.resolution ?? null;
      }
      let note = '';
      if (resolution?.kind === 'gap-shifted') {
        note = ` Note: that local time falls in a daylight-saving change; it fires ${resolution.shiftedMinutes} minutes later that day.`;
      } else if (resolution?.kind === 'ambiguous-earlier') {
        note = ' Note: that local time occurs twice on that day (daylight-saving); it fires at the earlier one.';
      }
      preview.textContent = `Next occurrence: ${formatInZone(next, draft.timeZone)}.${note}`;
    }

    function nowIso(): UtcTimestamp {
      return new Date().toISOString() as UtcTimestamp;
    }

    const syncKindVisibility = (): void => {
      const yearly = kindSelect.value === 'yearly';
      whenField.hidden = yearly;
      yearlyBlock.hidden = !yearly;
      finalYearField.hidden = !yearly;
      leapField.hidden = !yearly;
    };
    kindSelect.addEventListener('change', syncKindVisibility);
    for (const input of [whenInput, dayInput, timeInput, finalYearInput, zoneInput]) {
      input.addEventListener('input', updatePreview);
    }
    for (const select of [kindSelect, monthSelect, leapSelect]) {
      select.addEventListener('change', updatePreview);
    }
    syncKindVisibility();
    updatePreview();

    saveButton.addEventListener('click', () => {
      const draft = readDraft();
      if (draft.problem !== null) return; // saveButton is disabled in that state
      void (async () => {
        try {
          if (existing === null) {
            const reminder = await callbacks.create({
              noteId,
              dueAt: draft.dueAt,
              recurrence: draft.recurrence,
              timeZone: draft.timeZone,
            });
            callbacks.announce('Added the reminder.');
            dialog.close();
            await refresh();
            if (reminder.nextDueAt === null && reminder.recurrence !== null) {
              setStatus('The recurrence already ended — the reminder is kept for history only.', false);
            }
          } else {
            await callbacks.updateRule(existing.id, {
              dueAt: draft.dueAt,
              recurrence: draft.recurrence,
              timeZone: draft.timeZone,
            });
            callbacks.announce('Updated the reminder.');
            dialog.close();
            await refresh();
          }
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : 'unknown error';
          error.textContent = `Saving the reminder failed: ${message}`;
          error.hidden = false;
        }
      })();
    });
  }

  addButton.addEventListener('click', () => openReminderDialog(null));

  /* --------------------------- Refresh ------------------------------ */

  async function refresh(): Promise<void> {
    let reminders: readonly Reminder[];
    try {
      reminders = await callbacks.listForNote(noteId);
    } catch (failure) {
      setStatus(
        `Listing reminders failed: ${failure instanceof Error ? failure.message : 'unknown error'}`,
        true,
      );
      return;
    }
    const now = new Date().toISOString() as UtcTimestamp;
    listbox.replaceChildren(...reminders.map((reminder) => rowFor(reminder, now)));
    empty.hidden = reminders.length > 0;
    count.textContent =
      reminders.length === 0
        ? ''
        : `${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`;
  }

  element.append(heading, count, addButton, status, listbox, empty);
  void refresh();

  return {
    element,
    refresh,
    dispose(): void {
      closeOpenDialogs();
      element.remove();
    },
  };
}

/** "YYYY-MM-DDTHH:mm" for an instant as read on the zone's wall clock. */
function civilStringInZone(instant: UtcTimestamp, timeZone: TimeZoneName): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}
