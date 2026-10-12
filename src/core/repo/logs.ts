import type { DiagnosticLog, LogLevel } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { truncate } from '../util/strings';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Structured technical logs (FR-LOG-01, FR-LOG-04): timestamp, severity,
 * component, operation/correlation IDs, duration, result code and sanitized
 * messages. Rolling size bound with oldest-first rotation. Log rotation
 * never blocks note writes: appends happen after the bounded prune.
 */

export interface LogInput {
  readonly level: LogLevel;
  readonly component: string;
  readonly operationId: string;
  readonly correlationId?: string;
  readonly durationMs?: number | null;
  readonly resultCode: string;
  readonly message: string;
}

/** Default rolling ceiling: 5 MB (FR-LOG-04). */
export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024;

const MAX_MESSAGE_LENGTH = 1000;
const MAX_LOG_ENTRIES = 20_000;

/** Secret patterns scrubbed from every message before storage (FR-LOG-03).
 * Bare-token patterns replace with a fixed label — the matched text must
 * never survive into the replacement. */
const SECRET_PATTERNS: readonly { pattern: RegExp; label: string | null }[] = [
  // Scheme tokens first, so the kv rule below cannot half-consume them.
  { pattern: /bearer\s+[A-Za-z0-9._-]+/gi, label: 'bearer' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, label: 'github-token' },
  { pattern: /sk-[A-Za-z0-9]{16,}/g, label: 'api-key' },
  { pattern: /(token|secret|password|apikey|api[_-]key|authorization)\s*[=:]\s*\S+/gi, label: null },
];

export function sanitizeLogMessage(message: string): string {
  let cleaned = message;
  for (const { pattern, label } of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      if (label !== null) return `${label}=<redacted>`;
      const key = match.split(/[=:]/)[0]?.trim() ?? 'secret';
      return `${key}=<redacted>`;
    });
  }
  return truncate(cleaned, MAX_MESSAGE_LENGTH);
}

export async function appendLog(
  ctx: RepoContext,
  input: LogInput,
  maxBytes: number = DEFAULT_LOG_MAX_BYTES,
): Promise<DiagnosticLog> {
  const entry: DiagnosticLog = {
    id: newId(),
    at: nowUtc(),
    level: input.level,
    component: input.component,
    operationId: input.operationId,
    correlationId: input.correlationId ?? input.operationId,
    durationMs: input.durationMs ?? null,
    resultCode: input.resultCode,
    message: sanitizeLogMessage(input.message),
  };
  await ctx.transaction([Store.DiagnosticLogs], 'readwrite', (stores) => {
    stores[Store.DiagnosticLogs]?.put(entry);
  });
  // Rotation after the append: bounded work, failures never propagate to the
  // caller's note-write path.
  try {
    await rotateLogs(ctx, maxBytes);
  } catch {
    /* rotation is best-effort by design (FR-LOG-04) */
  }
  return entry;
}

export async function listLogs(
  ctx: RepoContext,
  limit = 200,
  offset = 0,
): Promise<DiagnosticLog[]> {
  const logs = await ctx.getAll<DiagnosticLog>(Store.DiagnosticLogs);
  logs.sort((a, b) => (a.at < b.at ? 1 : -1));
  return logs.slice(offset, offset + limit);
}

export async function countLogs(ctx: RepoContext): Promise<number> {
  return ctx.count(Store.DiagnosticLogs);
}

/** Approximate stored bytes for a log entry (fields + message). */
function logBytes(entry: DiagnosticLog): number {
  return (
    entry.at.length +
    entry.level.length +
    entry.component.length +
    entry.operationId.length +
    entry.correlationId.length +
    entry.resultCode.length +
    entry.message.length +
    64
  );
}

/**
 * Rotate: drop oldest entries until both the byte budget and the entry cap
 * are satisfied. Returns the number of removed entries.
 */
export async function rotateLogs(
  ctx: RepoContext,
  maxBytes: number,
): Promise<number> {
  const logs = await ctx.getAll<DiagnosticLog>(Store.DiagnosticLogs);
  if (logs.length === 0) return 0;
  logs.sort((a, b) => (a.at < b.at ? -1 : 1)); // oldest first
  let total = logs.reduce((sum, entry) => sum + logBytes(entry), 0);
  const overBytes = () => total > maxBytes;
  const overCount = () => logs.length > MAX_LOG_ENTRIES;
  if (!overBytes() && !overCount()) return 0;
  const doomed: DiagnosticLog[] = [];
  while (logs.length > 0 && (overBytes() || overCount())) {
    const oldest = logs.shift();
    if (!oldest) break;
    total -= logBytes(oldest);
    doomed.push(oldest);
  }
  if (doomed.length > 0) {
    await ctx.transaction([Store.DiagnosticLogs], 'readwrite', (stores) => {
      for (const entry of doomed) stores[Store.DiagnosticLogs]?.delete(entry.id);
    });
  }
  return doomed.length;
}

/** Total approximate stored log bytes (storage reporting). */
export async function logBytesStored(ctx: RepoContext): Promise<number> {
  const logs = await ctx.getAll<DiagnosticLog>(Store.DiagnosticLogs);
  return logs.reduce((sum, entry) => sum + logBytes(entry), 0);
}
