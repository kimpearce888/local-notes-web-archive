/**
 * Reminder recurrence engine (FR-REM-01..03, FR-REM-07): pure date math,
 * no Chrome APIs. Given a canonical reminder record this module computes
 * the next occurrence deterministically.
 *
 * Semantics:
 *
 * - One-time reminders carry an absolute UTC instant; no computation.
 * - Yearly reminders repeat on a local month/day at a local wall-clock
 *   time inside the reminder's IANA zone. `finalYear` is INCLUSIVE: an
 *   occurrence whose local year is <= finalYear still fires (FR-REM-02).
 * - February 29 in non-leap years resolves through the configured policy:
 *   `feb-28` (default), `mar-1` or `skip` — the whole year has no
 *   occurrence (FR-REM-03).
 * - DST gaps (spring-forward: the wall-clock time does not exist) shift
 *   forward by the gap length; ambiguous times (fall-back: the wall clock
 *   occurs twice) resolve to the EARLIER instant. Both are deterministic
 *   and reported as such (FR-REM-07) — matching the "compatible"
 *   disambiguation of industry temporal libraries.
 * - Timezone changes: recurrence is evaluated in the stored zone; a zone
 *   change is a rule update, not silent reinterpretation (FR-REM-07).
 *
 * The module is imported by the background API (authoritative computation
 * of `nextDueAt`) and by the dashboard (preview of the computed next
 * occurrence before saving). Alarms remain hints only (FR-REM-04).
 */

import type {
  LocalDate,
  LocalTime,
  RecurrenceRule,
  Reminder,
  TimeZoneName,
  UtcTimestamp,
} from '../../core/types';
import { daysInMonth, isLeapYear } from '../../core/util/time';

/** Longest gap between Gregorian leap years (1896 -> 1904): 8 years. */
const MAX_YEAR_SEARCH = 8;

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/** ISO instant from epoch milliseconds. */
function iso(ms: number): UtcTimestamp {
  return new Date(ms).toISOString() as UtcTimestamp;
}

/**
 * Signed offset (milliseconds) of `timeZone` at `instant`. Wall-clock
 * values of the instant, reinterpreted as UTC, minus the instant itself.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - instant;
}

export interface CivilDate extends LocalDate {
  readonly year: number;
}

function wallClockEquals(
  instant: number,
  date: CivilDate,
  time: LocalTime,
  timeZone: TimeZoneName,
): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return (
    get('year') === date.year &&
    get('month') === date.month &&
    get('day') === date.day &&
    get('hour') % 24 === time.hour &&
    get('minute') === time.minute
  );
}

export type WallClockResolution =
  | { readonly kind: 'exact'; readonly at: UtcTimestamp }
  | {
      readonly kind: 'gap-shifted';
      readonly at: UtcTimestamp;
      /** Minutes the local time moved forward past the DST gap. */
      readonly shiftedMinutes: number;
    }
  | { readonly kind: 'ambiguous-earlier'; readonly at: UtcTimestamp };

/**
 * Resolve a civil date + wall-clock time in a zone to a UTC instant,
 * deterministically (FR-REM-07).
 *
 * Probing strategy: compare the zone offset one day before and one day
 * after the naive instant. When they differ, a transition is near: probe
 * both candidate instants against the desired wall clock.
 *
 * - both candidates match -> ambiguous (fall-back) -> the EARLIER instant
 * - exactly one matches  -> that instant
 * - neither matches      -> gap (spring-forward) -> the instant shifted
 *   forward past the gap end, with the shift reported
 */
export function resolveWallClock(
  date: CivilDate,
  time: LocalTime,
  timeZone: TimeZoneName,
): WallClockResolution {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const beforeOffset = zoneOffsetMs(naive - DAY_MS, timeZone);
  const afterOffset = zoneOffsetMs(naive + DAY_MS, timeZone);

  if (beforeOffset === afterOffset) {
    return { kind: 'exact', at: iso(naive - beforeOffset) };
  }

  const candidateBefore = naive - beforeOffset;
  const candidateAfter = naive - afterOffset;
  const beforeMatches = wallClockEquals(candidateBefore, date, time, timeZone);
  const afterMatches = wallClockEquals(candidateAfter, date, time, timeZone);

  if (beforeMatches && afterMatches) {
    // Fall-back: the wall clock exists twice; take the first occurrence.
    return { kind: 'ambiguous-earlier', at: iso(Math.min(candidateBefore, candidateAfter)) };
  }
  if (beforeMatches) return { kind: 'exact', at: iso(candidateBefore) };
  if (afterMatches) return { kind: 'exact', at: iso(candidateAfter) };

  // Gap: the wall clock does not exist. Shift forward by the gap length
  // (offset increased by the transition). The forward-shifted instant is
  // the one computed with the PRE-transition offset.
  const gapMinutes = Math.round((afterOffset - beforeOffset) / MIN_MS);
  const forwardInstant = gapMinutes > 0 ? candidateBefore : candidateAfter;
  return {
    kind: 'gap-shifted',
    at: iso(forwardInstant),
    shiftedMinutes: Math.abs(gapMinutes),
  };
}

export class InvalidRecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecurrenceError';
  }
}

/**
 * Semantic validation beyond payload shape (used by the API layer):
 * the recurrence month/day must be a real civil date. February 29 is
 * valid and governed by the leap-day policy.
 */
export function validateRecurrenceRule(rule: RecurrenceRule): void {
  if (rule.kind === 'one-time') return;
  if (rule.on === null || rule.at === null) {
    throw new InvalidRecurrenceError(
      'yearly recurrence requires on { month, day } and at { hour, minute }',
    );
  }
  const { month, day } = rule.on;
  if (month < 1 || month > 12) {
    throw new InvalidRecurrenceError(`month ${month} is out of range 1..12`);
  }
  // Checked against a leap year so February 29 validates (FR-REM-03).
  if (day < 1 || day > daysInMonth(2024, month)) {
    throw new InvalidRecurrenceError(`day ${day} does not exist in month ${month}`);
  }
  if (rule.finalYear !== null && rule.finalYear < 1000) {
    throw new InvalidRecurrenceError('finalYear must be a full year (>= 1000)');
  }
}

export interface YearlyOccurrence {
  /** UTC instant of the occurrence. */
  readonly at: UtcTimestamp;
  /** How the wall clock resolved (DST details, FR-REM-07). */
  readonly resolution: WallClockResolution;
  /** Civil date the occurrence lands on (after leap-day policy). */
  readonly date: LocalDate;
  /** Local year of the occurrence. */
  readonly year: number;
}

/**
 * The yearly occurrence inside `year`, or null when the leap-day policy
 * skips the whole year (FR-REM-03 `skip` in a non-leap year).
 */
export function occurrenceInYear(
  rule: RecurrenceRule,
  year: number,
  timeZone: TimeZoneName,
): YearlyOccurrence | null {
  if (rule.on === null || rule.at === null) return null;
  let { month, day } = rule.on;
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    if (rule.leapDayPolicy === 'feb-28') {
      day = 28;
    } else if (rule.leapDayPolicy === 'mar-1') {
      month = 3;
      day = 1;
    } else {
      return null; // skip: no occurrence this year
    }
  }
  if (day > daysInMonth(year, month)) return null;
  const resolution = resolveWallClock({ year, month, day }, rule.at, timeZone);
  return { at: resolution.at, resolution, date: { month, day }, year };
}

/**
 * Next yearly occurrence strictly AFTER `after` (exclusive), or null when
 * the recurrence has ended: `finalYear` passed (inclusive bound checked
 * against the occurrence's LOCAL year) or the `skip` policy exhausted
 * every remaining year (FR-REM-02/03).
 */
export function nextYearlyOccurrence(
  rule: RecurrenceRule,
  timeZone: TimeZoneName,
  after: UtcTimestamp,
): YearlyOccurrence | null {
  if (rule.on === null || rule.at === null) return null;
  const afterMs = new Date(after).getTime();
  const startYear = localYearOf(afterMs, timeZone);
  for (let year = startYear; year <= startYear + MAX_YEAR_SEARCH; year += 1) {
    if (rule.finalYear !== null && year > rule.finalYear) return null;
    const occurrence = occurrenceInYear(rule, year, timeZone);
    if (occurrence === null) continue;
    if (new Date(occurrence.at).getTime() > afterMs) return occurrence;
  }
  return null;
}

function localYearOf(instantMs: number, timeZone: TimeZoneName): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).formatToParts(
    new Date(instantMs),
  );
  return Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10);
}

/**
 * Authoritative next-occurrence computation for a reminder shape
 * (background computes this on create/update; alarms are hints, FR-REM-04).
 *
 * - yearly: the next occurrence strictly after `after`
 * - one-time: the fixed due instant (a past instant stays overdue —
 *   `listDueReminders` reports it, the dashboard surfaces it, FR-REM-05)
 */
export function computeNextDueAt(
  reminder: Pick<Reminder, 'dueAt' | 'recurrence' | 'timeZone'>,
  after: UtcTimestamp,
): UtcTimestamp | null {
  if (reminder.recurrence !== null && reminder.recurrence.kind === 'yearly') {
    const occurrence = nextYearlyOccurrence(reminder.recurrence, reminder.timeZone, after);
    return occurrence === null ? null : occurrence.at;
  }
  return reminder.dueAt;
}

/** Is the reminder currently overdue (active and due at or before `now`)? */
export function isReminderOverdue(
  reminder: Pick<Reminder, 'state' | 'nextDueAt' | 'snoozedUntil'>,
  now: UtcTimestamp,
): boolean {
  if (reminder.state !== 'active') return false;
  const target = reminder.snoozedUntil ?? reminder.nextDueAt;
  return target !== null && target <= now;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Human-readable rule summary shown in reminder details (FR-REM-03
 * requires the leap-day behavior to be visible).
 */
export function describeRecurrenceRule(rule: RecurrenceRule): string {
  if (rule.kind === 'one-time') return 'One time';
  const on = rule.on!;
  const at = rule.at!;
  const base = `Yearly on ${MONTH_NAMES[on.month - 1]} ${on.day} at ${twoDigits(at.hour)}:${twoDigits(at.minute)} local time`;
  const leap =
    on.month === 2 && on.day === 29
      ? ` (Feb 29 -> ${
          rule.leapDayPolicy === 'feb-28'
            ? 'Feb 28 in non-leap years'
            : rule.leapDayPolicy === 'mar-1'
              ? 'Mar 1 in non-leap years'
              : 'skipped in non-leap years'
        })`
      : '';
  const end =
    rule.finalYear !== null ? `, through ${rule.finalYear} inclusive` : ', until stopped';
  return `${base}${leap}${end}`;
}
