/**
 * Structural payload validation primitives for RPC handlers. Everything is
 * allowlist-based: unknown fields are ignored, wrong shapes raise
 * PayloadValidationError, which the router maps to `invalid-request`.
 */

import { PayloadValidationError } from '../protocol';
import { isValidId } from '../../core/util/ids';
import { isUtcTimestamp, isValidTimeZone } from '../../core/util/time';
import type { EntityId, TimeZoneName, UtcTimestamp } from '../../core/types';

export function asObject(payload: unknown, what: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new PayloadValidationError(`${what}: expected an object payload`);
  }
  return payload as Record<string, unknown>;
}

export function asString(
  value: unknown,
  field: string,
  opts: { maxLength?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new PayloadValidationError(`${field}: expected a string`);
  }
  if (!opts.allowEmpty && value.length === 0) {
    throw new PayloadValidationError(`${field}: must not be empty`);
  }
  const max = opts.maxLength ?? 100_000;
  if (value.length > max) {
    throw new PayloadValidationError(`${field}: exceeds ${max} characters`);
  }
  return value;
}

export function asOptionalString(
  value: unknown,
  field: string,
  opts: { maxLength?: number; allowEmpty?: boolean } = {},
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field, opts);
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PayloadValidationError(`${field}: expected a boolean`);
  }
  return value;
}

export function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return asBoolean(value, field);
}

/**
 * Card color (T-107): undefined = keep, null = clear, otherwise a strict
 * lowercase `#rrggbb` hex string. The regex is the ONLY accepted form, so
 * CSS injection payloads (`red; }`, `url(...)`, `expression(...)`) are
 * rejected with a PayloadValidationError before any store write.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function asOptionalHexColor(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    throw new PayloadValidationError(
      `${field}: expected null or a #rrggbb hex color (lowercase digits a-f)`,
    );
  }
  return value;
}

export function asNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PayloadValidationError(`${field}: expected a finite number`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new PayloadValidationError(`${field}: expected an integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new PayloadValidationError(`${field}: must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new PayloadValidationError(`${field}: must be <= ${opts.max}`);
  }
  return value;
}

export function asOptionalNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asNumber(value, field, opts);
}

export function asId(value: unknown, field: string): EntityId {
  if (!isValidId(value)) {
    throw new PayloadValidationError(`${field}: expected an entity id (UUID v4)`);
  }
  return value;
}

export function asOptionalId(value: unknown, field: string): EntityId | undefined {
  if (value === undefined || value === null) return undefined;
  return asId(value, field);
}

export function asIdArray(value: unknown, field: string, opts: { max?: number } = {}): readonly EntityId[] {
  if (!Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected an array of ids`);
  }
  const max = opts.max ?? 500;
  if (value.length > max) {
    throw new PayloadValidationError(`${field}: exceeds ${max} entries`);
  }
  return value.map((entry, index) => asId(entry, `${field}[${index}]`));
}

export function asEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new PayloadValidationError(`${field}: expected one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function asOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return asEnum(value, field, allowed);
}

export function asUtcTimestamp(value: unknown, field: string): UtcTimestamp {
  if (!isUtcTimestamp(value)) {
    throw new PayloadValidationError(`${field}: expected an ISO-8601 UTC timestamp`);
  }
  return value;
}

export function asOptionalUtcTimestamp(value: unknown, field: string): UtcTimestamp | undefined {
  if (value === undefined || value === null) return undefined;
  return asUtcTimestamp(value, field);
}

export function asTimeZoneName(value: unknown, field: string): TimeZoneName {
  if (!isValidTimeZone(value)) {
    throw new PayloadValidationError(`${field}: expected an IANA time zone name`);
  }
  return value;
}

/** JSON object (e.g. editor document); arrays are rejected. */
export function asJsonObject(value: unknown, field: string): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected a JSON object`);
  }
  return value;
}

export function asOptionalJsonObject(value: unknown, field: string): object | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return asJsonObject(value, field);
}

export function asStringArray(
  value: unknown,
  field: string,
  opts: { maxLength?: number } = {},
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected an array of strings`);
  }
  const max = opts.maxLength ?? 100_000;
  if (value.length > max) {
    throw new PayloadValidationError(`${field}: exceeds ${max} entries`);
  }
  return value.map((entry, index) => asString(entry, `${field}[${index}]`, { maxLength: 2000 }));
}

export function asOptionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PayloadValidationError(`${field}: expected an object`);
  }
  return value as Record<string, unknown>;
}
