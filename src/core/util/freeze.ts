/**
 * Test and fixture helper: recursively freeze an object so tests that assert
 * on immutable snapshots fail fast when production code mutates them.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && (typeof child === 'object' || typeof child === 'function')) {
        deepFreeze(child);
      }
    }
    Object.freeze(value);
  }
  return value;
}
