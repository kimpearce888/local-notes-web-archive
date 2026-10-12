import type { LocalDate, LocalTime, TimeZoneName, UtcTimestamp } from '../types';

/**
 * Time utilities. Event timestamps are always ISO 8601 UTC (PRD §6).
 * Reminder dates keep an explicit local civil representation plus IANA zone.
 */

/** Current instant as ISO 8601 UTC. */
export function nowUtc(): UtcTimestamp {
  return new Date().toISOString() as UtcTimestamp;
}

/** Validates the ISO-8601 UTC shape used across the data model. */
export function isUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Parse to epoch milliseconds; null for invalid input. */
export function utcToEpochMs(value: UtcTimestamp): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

/** Compare two UTC instants (<0 a earlier, >0 a later). */
export function compareUtc(a: UtcTimestamp, b: UtcTimestamp): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/**
 * Local civil date/time for a time zone. Used by the reminder engine to
 * evaluate yearly recurrence in the owner's zone (FR-REM-07).
 */
export function localPartsInZone(
  instant: Date,
  timeZone: TimeZoneName,
): { date: LocalDate; time: LocalTime } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return Number.parseInt(part?.value ?? '0', 10);
  };
  return {
    date: { month: get('month'), day: get('day') },
    time: { hour: get('hour') % 24, minute: get('minute') },
  };
}

/** Extract the local year inside a zone (recurrence final-year checks). */
export function localYearInZone(instant: Date, timeZone: TimeZoneName): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
  }).formatToParts(instant);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0';
  return Number.parseInt(year, 10);
}

const IANA_ZONE_RE = /^[A-Za-z]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/;

/** Validates an IANA time zone name (accepts the well-known special cases). */
export function isValidTimeZone(value: unknown): value is TimeZoneName {
  if (typeof value !== 'string') return false;
  if (value === 'UTC' || value === 'Etc/UTC' || value === 'Etc/GMT') return true;
  if (!IANA_ZONE_RE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Is `year` a Gregorian leap year? */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month (1-based), leap-aware. */
export function daysInMonth(year: number, month: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return table[month - 1] ?? 30;
}
