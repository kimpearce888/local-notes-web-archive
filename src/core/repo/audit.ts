import type { AuditActor, AuditEvent, AuditOutcome, ContentHash, EntityId } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { truncate } from '../util/strings';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Audit trail (FR-LOG-02): who did what to which record, when, with which
 * approval and outcome. Records changed-field names and content hashes —
 * never full note bodies.
 */

export interface AuditInput {
  readonly actor: AuditActor;
  readonly action: string;
  readonly targetId?: EntityId | null;
  readonly targetKind?: string | null;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly changedFields?: readonly string[];
  readonly contentHash?: ContentHash | null;
  /** Sanitized detail (redacted upstream; truncated here as a hard bound). */
  readonly detail?: string;
}

const MAX_DETAIL_LENGTH = 500;
const MAX_CHANGED_FIELDS = 32;

export async function appendAuditEvent(
  ctx: RepoContext,
  input: AuditInput,
): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: newId(),
    at: nowUtc(),
    actor: input.actor,
    action: input.action,
    targetId: input.targetId ?? null,
    targetKind: input.targetKind ?? null,
    outcome: input.outcome,
    correlationId: input.correlationId,
    changedFields: (input.changedFields ?? []).slice(0, MAX_CHANGED_FIELDS),
    contentHash: input.contentHash ?? null,
    detail: truncate(input.detail ?? '', MAX_DETAIL_LENGTH),
  };
  await ctx.transaction([Store.AuditEvents], 'readwrite', (stores) => {
    stores[Store.AuditEvents]?.put(event);
  });
  return event;
}

export interface AuditQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly actor?: AuditActor;
  readonly correlationId?: string;
}

/** Newest-first paginated audit listing (diagnostics/AI get_diagnostics). */
export async function listAuditEvents(
  ctx: RepoContext,
  query: AuditQuery = {},
): Promise<AuditEvent[]> {
  let events: AuditEvent[];
  if (query.correlationId) {
    events = await ctx.getByIndex<AuditEvent>(
      Store.AuditEvents,
      'correlationId',
      query.correlationId,
    );
  } else {
    events = await ctx.getAll<AuditEvent>(Store.AuditEvents);
  }
  if (query.actor) events = events.filter((e) => e.actor === query.actor);
  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  return events.slice(offset, offset + limit);
}

export async function countAuditEvents(ctx: RepoContext): Promise<number> {
  return ctx.count(Store.AuditEvents);
}

/**
 * Retention prune (FR-LOG-04): remove audit events older than `days`.
 * Returns the number of removed events.
 */
export async function pruneAuditEvents(
  ctx: RepoContext,
  days: number,
): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const events = await ctx.getAll<AuditEvent>(Store.AuditEvents);
  const stale = events.filter((e) => e.at < cutoff);
  if (stale.length === 0) return 0;
  await ctx.transaction([Store.AuditEvents], 'readwrite', (stores) => {
    for (const event of stale) stores[Store.AuditEvents]?.delete(event.id);
  });
  return stale.length;
}
