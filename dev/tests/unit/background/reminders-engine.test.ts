import { describe, expect, it } from 'vitest';
import {
  computeNextDueAt,
  describeRecurrenceRule,
  isReminderOverdue,
  nextYearlyOccurrence,
  occurrenceInYear,
  resolveWallClock,
  validateRecurrenceRule,
  InvalidRecurrenceError,
} from '../../../../src/background/reminders/engine';
import type { RecurrenceRule, TimeZoneName, UtcTimestamp } from '../../../../src/core/types';

const zone = (value: string): TimeZoneName => value as TimeZoneName;

/**
 * T-027 reminder engine (FR-REM-01..03, FR-REM-07): exhaustive recurrence
 * math — leap years, Feb-29 policies, inclusive final years, year
 * boundaries across zones, DST gaps and repeated times in 60-minute AND
 * 30-minute transition zones, strictly-after firing semantics.
 */

function yearly(
  on: { month: number; day: number },
  at: { hour: number; minute: number },
  options: { finalYear?: number | null; leapDayPolicy?: RecurrenceRule['leapDayPolicy'] } = {},
): RecurrenceRule {
  return {
    kind: 'yearly',
    on,
    at,
    finalYear: options.finalYear ?? null,
    leapDayPolicy: options.leapDayPolicy ?? 'feb-28',
  };
}

const ts = (value: string): UtcTimestamp => value as UtcTimestamp;

describe('resolveWallClock (FR-REM-07 determinism)', () => {
  it('resolves ordinary wall clocks exactly', () => {
    expect(resolveWallClock({ year: 2026, month: 7, day: 4 }, { hour: 9, minute: 0 }, zone('UTC'))).toEqual(
      { kind: 'exact', at: ts('2026-07-04T09:00:00.000Z') },
    );
    expect(
      resolveWallClock({ year: 2026, month: 1, day: 15 }, { hour: 9, minute: 0 }, zone('America/New_York')),
    ).toEqual({ kind: 'exact', at: ts('2026-01-15T14:00:00.000Z') }); // EST -5
    expect(
      resolveWallClock({ year: 2026, month: 7, day: 4 }, { hour: 9, minute: 0 }, zone('America/New_York')),
    ).toEqual({ kind: 'exact', at: ts('2026-07-04T13:00:00.000Z') }); // EDT -4
    // No-DST zone and a +14 zone.
    expect(
      resolveWallClock({ year: 2026, month: 3, day: 1 }, { hour: 0, minute: 0 }, zone('Asia/Tokyo')),
    ).toEqual({ kind: 'exact', at: ts('2026-02-28T15:00:00.000Z') });
    expect(
      resolveWallClock({ year: 2026, month: 1, day: 1 }, { hour: 0, minute: 0 }, zone('Pacific/Kiritimati')),
    ).toEqual({ kind: 'exact', at: ts('2025-12-31T10:00:00.000Z') });
  });

  it('shifts spring-forward gap times forward by the gap length', () => {
    // New York 2025-03-09: 02:00 EST -> 03:00 EDT; 02:30 does not exist.
    const ny = resolveWallClock(
      { year: 2025, month: 3, day: 9 },
      { hour: 2, minute: 30 },
      zone('America/New_York'),
    );
    expect(ny.kind).toBe('gap-shifted');
    expect(ny.at).toBe(ts('2025-03-09T07:30:00.000Z')); // 03:30 EDT
    expect(ny.kind === 'gap-shifted' && ny.shiftedMinutes).toBe(60);

    // Berlin 2025-03-30: 02:00 CET -> 03:00 CEST; 02:30 does not exist.
    const berlin = resolveWallClock(
      { year: 2025, month: 3, day: 30 },
      { hour: 2, minute: 30 },
      zone('Europe/Berlin'),
    );
    expect(berlin.kind).toBe('gap-shifted');
    expect(berlin.at).toBe(ts('2025-03-30T01:30:00.000Z')); // 03:30 CEST
  });

  it('resolves 30-minute DST gaps (Australia/Lord_Howe)', () => {
    // Lord Howe 2025-10-05: 02:00 (+10:30) -> 02:30 (+11:00); 02:15 does not exist.
    const gap = resolveWallClock(
      { year: 2025, month: 10, day: 5 },
      { hour: 2, minute: 15 },
      zone('Australia/Lord_Howe'),
    );
    expect(gap.kind).toBe('gap-shifted');
    expect(gap.at).toBe(ts('2025-10-04T15:45:00.000Z')); // 02:45 +11:00
    expect(gap.kind === 'gap-shifted' && gap.shiftedMinutes).toBe(30);
  });

  it('resolves repeated fall-back times to the EARLIER occurrence', () => {
    // New York 2025-11-02: 02:00 EDT -> 01:00 EST; 01:30 happens twice.
    const ny = resolveWallClock(
      { year: 2025, month: 11, day: 2 },
      { hour: 1, minute: 30 },
      zone('America/New_York'),
    );
    expect(ny.kind).toBe('ambiguous-earlier');
    expect(ny.at).toBe(ts('2025-11-02T05:30:00.000Z')); // the first 01:30, EDT

    // Berlin 2025-10-26: 03:00 CEST -> 02:00 CET; 02:30 happens twice.
    const berlin = resolveWallClock(
      { year: 2025, month: 10, day: 26 },
      { hour: 2, minute: 30 },
      zone('Europe/Berlin'),
    );
    expect(berlin.kind).toBe('ambiguous-earlier');
    expect(berlin.at).toBe(ts('2025-10-26T00:30:00.000Z')); // the first 02:30, CEST
  });

  it('resolves 30-minute fall-back repeats to the earlier occurrence', () => {
    // Lord Howe 2025-04-06: 02:00 (+11:00) -> 01:30 (+10:30); 01:45 twice.
    const repeat = resolveWallClock(
      { year: 2025, month: 4, day: 6 },
      { hour: 1, minute: 45 },
      zone('Australia/Lord_Howe'),
    );
    expect(repeat.kind).toBe('ambiguous-earlier');
    expect(repeat.at).toBe(ts('2025-04-05T14:45:00.000Z')); // first 01:45, +11:00
  });

  it('stays exact for wall clocks that exist exactly once on transition days', () => {
    // 03:00 EDT on the New York gap day exists exactly once (the gap jumped
    // over 02:00-03:00; 03:00 is the first post-transition wall clock).
    const afterGap = resolveWallClock(
      { year: 2025, month: 3, day: 9 },
      { hour: 3, minute: 0 },
      zone('America/New_York'),
    );
    expect(afterGap).toEqual({ kind: 'exact', at: ts('2025-03-09T07:00:00.000Z') });
    // 00:30 on the fall-back day is before the repeated hour: exactly once.
    const beforeRepeat = resolveWallClock(
      { year: 2025, month: 11, day: 2 },
      { hour: 0, minute: 30 },
      zone('America/New_York'),
    );
    expect(beforeRepeat).toEqual({ kind: 'exact', at: ts('2025-11-02T04:30:00.000Z') }); // EDT
    // 02:30 after the fall-back transition: exactly once (EST).
    const afterRepeat = resolveWallClock(
      { year: 2025, month: 11, day: 2 },
      { hour: 2, minute: 30 },
      zone('America/New_York'),
    );
    expect(afterRepeat).toEqual({ kind: 'exact', at: ts('2025-11-02T07:30:00.000Z') });
  });
});

describe('yearly occurrences (FR-REM-02)', () => {
  const july4 = yearly({ month: 7, day: 4 }, { hour: 9, minute: 0 });

  it('finds the current-year occurrence when it is still ahead', () => {
    const next = nextYearlyOccurrence(july4, zone('America/New_York'), ts('2026-01-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2026-07-04T13:00:00.000Z')); // EDT
    expect(next?.year).toBe(2026);
    expect(next?.resolution.kind).toBe('exact');
  });

  it('rolls to next year when this year already passed', () => {
    const next = nextYearlyOccurrence(july4, zone('America/New_York'), ts('2026-08-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2027-07-04T13:00:00.000Z'));
    expect(next?.year).toBe(2027);
  });

  it('treats the firing instant itself as passed (strictly-after)', () => {
    const next = nextYearlyOccurrence(july4, zone('America/New_York'), ts('2026-07-04T13:00:00.000Z'));
    expect(next?.year).toBe(2027);
  });

  it('honors an inclusive final year', () => {
    const limited = yearly({ month: 7, day: 4 }, { hour: 9, minute: 0 }, { finalYear: 2027 });
    // Before the final year: the 2027 occurrence still fires.
    expect(
      nextYearlyOccurrence(limited, zone('America/New_York'), ts('2026-08-01T00:00:00.000Z'))?.at,
    ).toBe(ts('2027-07-04T13:00:00.000Z'));
    // After the final-year occurrence: recurrence ended.
    expect(
      nextYearlyOccurrence(limited, zone('America/New_York'), ts('2027-08-01T00:00:00.000Z')),
    ).toBeNull();
    // Final year already below the next occurrence year: ends immediately.
    const past = yearly({ month: 7, day: 4 }, { hour: 9, minute: 0 }, { finalYear: 2025 });
    expect(nextYearlyOccurrence(past, zone('America/New_York'), ts('2026-01-01T00:00:00.000Z'))).toBeNull();
  });

  it('scans by LOCAL year, not UTC year (FR-REM-07 zone change determinism)', () => {
    // Los Angeles is still in local 2026 while UTC is already 2027; the
    // Dec-31 23:59 occurrence must still be found.
    const nye = yearly({ month: 12, day: 31 }, { hour: 23, minute: 59 });
    const next = nextYearlyOccurrence(nye, zone('America/Los_Angeles'), ts('2027-01-01T02:00:00.000Z'));
    expect(next?.at).toBe(ts('2027-01-01T07:59:00.000Z')); // 2026-12-31 23:59 PST
    expect(next?.year).toBe(2026);

    // Auckland is already in local 2027 while UTC is 2026: the inclusive
    // final-year check uses the LOCAL year of the occurrence.
    const limited = yearly({ month: 1, day: 15 }, { hour: 9, minute: 0 }, { finalYear: 2027 });
    expect(
      nextYearlyOccurrence(limited, zone('Pacific/Auckland'), ts('2026-12-31T23:59:00.000Z'))?.at,
    ).toBe(ts('2027-01-14T20:00:00.000Z')); // 2027-01-15 09:00 NZDT (+13)
  });

  it('evaluates the same rule differently after a timezone change', () => {
    // Same rule, different stored zone -> different instants (deterministic
    // reinterpretation only through an explicit rule update).
    const rule = yearly({ month: 3, day: 1 }, { hour: 9, minute: 0 });
    const after = ts('2026-01-01T00:00:00.000Z');
    expect(nextYearlyOccurrence(rule, zone('Asia/Tokyo'), after)?.at).toBe(ts('2026-03-01T00:00:00.000Z'));
    expect(nextYearlyOccurrence(rule, zone('America/New_York'), after)?.at).toBe(
      ts('2026-03-01T14:00:00.000Z'),
    ); // EST on Mar 1
  });
});

describe('February 29 policies (FR-REM-03)', () => {
  const feb29 = (policy: RecurrenceRule['leapDayPolicy'], finalYear: number | null = null) =>
    yearly({ month: 2, day: 29 }, { hour: 10, minute: 0 }, { leapDayPolicy: policy, finalYear });

  it('fires on Feb 29 in leap years', () => {
    const leap = nextYearlyOccurrence(feb29('feb-28'), zone('UTC'), ts('2028-01-01T00:00:00.000Z'));
    expect(leap?.at).toBe(ts('2028-02-29T10:00:00.000Z'));
    expect(leap?.date).toEqual({ month: 2, day: 29 });
    expect(leap?.year).toBe(2028);
    // 2024 was a leap year too: from 2023 the Feb-29 occurrence is 2024.
    expect(nextYearlyOccurrence(feb29('feb-28'), zone('UTC'), ts('2023-06-01T00:00:00.000Z'))?.at).toBe(
      ts('2024-02-29T10:00:00.000Z'),
    );
  });

  it('default policy resolves to Feb 28 in non-leap years', () => {
    const next = nextYearlyOccurrence(feb29('feb-28'), zone('UTC'), ts('2025-01-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2025-02-28T10:00:00.000Z'));
    expect(next?.date).toEqual({ month: 2, day: 28 });
  });

  it('mar-1 policy resolves to March 1 in non-leap years', () => {
    const next = nextYearlyOccurrence(feb29('mar-1'), zone('UTC'), ts('2025-01-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2025-03-01T10:00:00.000Z'));
    expect(next?.date).toEqual({ month: 3, day: 1 });
  });

  it('skip policy skips non-leap years entirely', () => {
    const next = nextYearlyOccurrence(feb29('skip'), zone('UTC'), ts('2025-01-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2028-02-29T10:00:00.000Z'));
    expect(next?.year).toBe(2028);
    // 2025/2026/2027 have no occurrence at all.
    expect(occurrenceInYear(feb29('skip'), 2025, zone('UTC'))).toBeNull();
    expect(occurrenceInYear(feb29('skip'), 2026, zone('UTC'))).toBeNull();
    expect(occurrenceInYear(feb29('skip'), 2027, zone('UTC'))).toBeNull();
    expect(occurrenceInYear(feb29('skip'), 2028, zone('UTC'))?.date).toEqual({ month: 2, day: 29 });
  });

  it('skip policy with a final year before the next leap year ends the recurrence', () => {
    const next = nextYearlyOccurrence(feb29('skip', 2027), zone('UTC'), ts('2025-01-01T00:00:00.000Z'));
    expect(next).toBeNull();
    // Inclusive: final year 2028 still catches the leap-day occurrence.
    const inclusive = nextYearlyOccurrence(feb29('skip', 2028), zone('UTC'), ts('2025-01-01T00:00:00.000Z'));
    expect(inclusive?.at).toBe(ts('2028-02-29T10:00:00.000Z'));
  });

  it('a Feb-28 rule never lands on Feb 29', () => {
    const rule = yearly({ month: 2, day: 28 }, { hour: 10, minute: 0 });
    const next = nextYearlyOccurrence(rule, zone('UTC'), ts('2028-01-01T00:00:00.000Z'));
    expect(next?.at).toBe(ts('2028-02-28T10:00:00.000Z'));
  });
});

describe('computeNextDueAt', () => {
  it('returns the fixed instant for one-time reminders (past stays overdue)', () => {
    const past = ts('2020-01-01T00:00:00.000Z');
    const result = computeNextDueAt({ dueAt: past, recurrence: null, timeZone: zone('UTC') }, ts('2026-01-01T00:00:00.000Z'));
    expect(result).toBe(past);
    const future = ts('2030-01-01T00:00:00.000Z');
    expect(
      computeNextDueAt({ dueAt: future, recurrence: null, timeZone: zone('UTC') }, ts('2026-01-01T00:00:00.000Z')),
    ).toBe(future);
  });

  it('computes yearly occurrences after the reference instant', () => {
    const reminder = {
      dueAt: null,
      recurrence: yearly({ month: 12, day: 25 }, { hour: 8, minute: 0 }),
      timeZone: zone('Europe/Berlin'),
    } as const;
    // 2025-12-25 08:00 Berlin = 07:00Z (CET +1).
    expect(computeNextDueAt(reminder, ts('2025-06-01T00:00:00.000Z'))).toBe(
      ts('2025-12-25T07:00:00.000Z'),
    );
    // After it fired, the next one is 2026.
    expect(computeNextDueAt(reminder, ts('2025-12-25T07:00:00.000Z'))).toBe(
      ts('2026-12-25T07:00:00.000Z'),
    );
  });

  it('returns null when a yearly recurrence has ended', () => {
    const reminder = {
      dueAt: null,
      recurrence: yearly({ month: 1, day: 1 }, { hour: 0, minute: 0 }, { finalYear: 2026 }),
      timeZone: zone('UTC'),
    } as const;
    expect(computeNextDueAt(reminder, ts('2026-01-01T00:00:00.000Z'))).toBeNull();
  });
});

describe('isReminderOverdue', () => {
  const now = ts('2026-06-01T12:00:00.000Z');

  it('marks active reminders due at or before now', () => {
    expect(isReminderOverdue({ state: 'active', nextDueAt: now, snoozedUntil: null }, now)).toBe(
      true,
    );
    expect(
      isReminderOverdue({ state: 'active', nextDueAt: ts('2026-06-01T11:59:59.000Z'), snoozedUntil: null }, now),
    ).toBe(true);
    expect(
      isReminderOverdue({ state: 'active', nextDueAt: ts('2026-06-01T12:00:01.000Z'), snoozedUntil: null }, now),
    ).toBe(false);
    expect(isReminderOverdue({ state: 'active', nextDueAt: null, snoozedUntil: null }, now)).toBe(
      false,
    );
  });

  it('honors snooze as the effective due time', () => {
    expect(
      isReminderOverdue(
        { state: 'active', nextDueAt: now, snoozedUntil: ts('2026-06-01T15:00:00.000Z') },
        now,
      ),
    ).toBe(false);
    expect(
      isReminderOverdue(
        { state: 'active', nextDueAt: now, snoozedUntil: ts('2026-06-01T11:00:00.000Z') },
        now,
      ),
    ).toBe(true);
  });

  it('never marks terminal states overdue', () => {
    for (const state of ['completed', 'dismissed', 'stopped'] as const) {
      expect(isReminderOverdue({ state, nextDueAt: now, snoozedUntil: null }, now)).toBe(false);
    }
  });
});

describe('validateRecurrenceRule', () => {
  it('accepts valid rules including Feb 29', () => {
    expect(() => validateRecurrenceRule(yearly({ month: 2, day: 29 }, { hour: 1, minute: 2 }))).not.toThrow();
    expect(() => validateRecurrenceRule(yearly({ month: 12, day: 31 }, { hour: 23, minute: 59 }))).not.toThrow();
    expect(() => validateRecurrenceRule({ kind: 'one-time', on: null, at: null, finalYear: null, leapDayPolicy: 'feb-28' })).not.toThrow();
  });

  it('rejects impossible civil dates', () => {
    expect(() => validateRecurrenceRule(yearly({ month: 2, day: 30 }, { hour: 0, minute: 0 }))).toThrow(
      InvalidRecurrenceError,
    );
    expect(() => validateRecurrenceRule(yearly({ month: 4, day: 31 }, { hour: 0, minute: 0 }))).toThrow(
      InvalidRecurrenceError,
    );
    expect(() => validateRecurrenceRule(yearly({ month: 13, day: 1 }, { hour: 0, minute: 0 }))).toThrow(
      InvalidRecurrenceError,
    );
    expect(() => validateRecurrenceRule(yearly({ month: 0, day: 10 }, { hour: 0, minute: 0 }))).toThrow(
      InvalidRecurrenceError,
    );
  });

  it('rejects yearly rules without on/at and short final years', () => {
    expect(() =>
      validateRecurrenceRule({ kind: 'yearly', on: null, at: null, finalYear: null, leapDayPolicy: 'feb-28' }),
    ).toThrow(InvalidRecurrenceError);
    expect(() =>
      validateRecurrenceRule(yearly({ month: 1, day: 1 }, { hour: 0, minute: 0 }, { finalYear: 999 })),
    ).toThrow(InvalidRecurrenceError);
  });
});

describe('describeRecurrenceRule (FR-REM-03 detail display)', () => {
  it('describes one-time and ordinary yearly rules', () => {
    expect(describeRecurrenceRule({ kind: 'one-time', on: null, at: null, finalYear: null, leapDayPolicy: 'feb-28' })).toBe('One time');
    expect(
      describeRecurrenceRule(yearly({ month: 7, day: 4 }, { hour: 9, minute: 5 })),
    ).toBe('Yearly on July 4 at 09:05 local time, until stopped');
    expect(
      describeRecurrenceRule(yearly({ month: 1, day: 31 }, { hour: 0, minute: 0 }, { finalYear: 2030 })),
    ).toBe('Yearly on January 31 at 00:00 local time, through 2030 inclusive');
  });

  it('makes the leap-day policy visible in details', () => {
    expect(
      describeRecurrenceRule(yearly({ month: 2, day: 29 }, { hour: 10, minute: 0 }, { leapDayPolicy: 'feb-28' })),
    ).toContain('Feb 28 in non-leap years');
    expect(
      describeRecurrenceRule(yearly({ month: 2, day: 29 }, { hour: 10, minute: 0 }, { leapDayPolicy: 'mar-1' })),
    ).toContain('Mar 1 in non-leap years');
    expect(
      describeRecurrenceRule(yearly({ month: 2, day: 29 }, { hour: 10, minute: 0 }, { leapDayPolicy: 'skip' })),
    ).toContain('skipped in non-leap years');
  });
});
