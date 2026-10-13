/**
 * Shared observability helpers (FR-LOG-01/02): fire-and-forget audit and
 * error-log emission for RPC mutations. Audit/log failures NEVER fail the
 * user's operation — by the time these run, the mutation has already
 * committed — but failures to record are surfaced on the console for local
 * inspection. Log appends run after the bounded prune inside `appendLog`, so
 * observability never blocks note writes (FR-LOG-04).
 */

import { repo } from './db';
import { appendAuditEvent } from '../core/repo/audit';
import { appendLog } from '../core/repo/logs';
import type { AuditOutcome, EntityId, LogLevel } from '../core/types';

export interface AuditActionInput {
  readonly action: string;
  readonly targetKind: string;
  readonly targetId?: EntityId | null;
  readonly outcome: AuditOutcome;
  readonly changedFields?: readonly string[];
  readonly detail: string;
  readonly correlationId: string;
}

/**
 * Record a user-actor audit event (FR-LOG-02: actor/action/target/outcome
 * with changed-field NAMES — never values, never content bodies).
 */
export async function auditUserAction(input: AuditActionInput): Promise<void> {
  try {
    await appendAuditEvent(await repo(), {
      actor: 'user',
      action: input.action,
      targetId: input.targetId ?? null,
      targetKind: input.targetKind,
      outcome: input.outcome,
      correlationId: input.correlationId,
      changedFields: input.changedFields ?? [],
      detail: input.detail,
    });
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}

export interface OperationLogInput {
  readonly level: LogLevel;
  readonly component: string;
  readonly operationId: string;
  readonly correlationId?: string;
  readonly durationMs?: number | null;
  readonly resultCode: string;
  readonly message: string;
}

/**
 * Append a structured diagnostic log entry (FR-LOG-01: timestamp, severity,
 * component, operation/correlation ids, duration, result code, sanitized
 * message). Sanitization happens inside `appendLog` (FR-LOG-03).
 */
export async function logOperation(input: OperationLogInput): Promise<void> {
  try {
    await appendLog(await repo(), {
      level: input.level,
      component: input.component,
      operationId: input.operationId,
      correlationId: input.correlationId,
      durationMs: input.durationMs ?? null,
      resultCode: input.resultCode,
      message: input.message,
    });
  } catch (error) {
    console.error('[log] failed to record', input.operationId, error);
  }
}
