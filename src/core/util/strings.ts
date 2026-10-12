/**
 * Bounded-string helpers. Every AI tool input and every log/audit message
 * passes through these limits (PRD §9: bounded string/list/record sizes).
 */

/** Truncate to at most `max` characters with an honest ellipsis marker. */
export function truncate(input: string, max: number): string {
  if (max < 0) throw new RangeError('max must be >= 0');
  if (input.length <= max) return input;
  const marker = '…';
  const keep = Math.max(0, max - marker.length);
  return `${input.slice(0, keep)}${marker}`;
}

/** Assert a string length bound; throws a descriptive error otherwise. */
export function assertBound(value: string, max: number, what: string): void {
  if (value.length > max) {
    throw new RangeError(`${what} exceeds maximum length ${max} (got ${value.length})`);
  }
}

/** Collapse whitespace and trim (tag normalization, previews). */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Casefold + whitespace-collapse normalization for unique tag keys. */
export function normalizeKey(input: string): string {
  return collapseWhitespace(input).toLocaleLowerCase('en-US');
}

/** Plain-text projection helpers for safe card previews (PRD §4.2). */
export function safePreview(plainText: string, max = 200): string {
  return truncate(collapseWhitespace(plainText), max);
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
