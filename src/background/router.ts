/**
 * Message router: maps typed RPC message types onto handlers and converts
 * every thrown domain error into a coded RpcError (PRD §12). One router
 * instance lives in the service worker; handlers are registered once at
 * worker startup. The router itself is stateless — durable state only ever
 * comes from IndexedDB (PRD §8.1).
 */

import {
  RPC_KIND,
  rpcFailure,
  rpcSuccess,
  type RpcError,
  type RpcErrorCode,
  type RpcRequest,
  type RpcResponse,
  RpcErrorBase,
} from './protocol';
import { NoteConflictError, NoteNotFoundError } from '../core/repo/notes';
import { TagNotFoundError, DuplicateTagError } from '../core/repo/tags';
import { CategoryNotFoundError } from '../core/repo/categories';
import { ReminderNotFoundError } from '../core/repo/reminders';
import { InvalidUrlError, LinkNotFoundError } from '../core/repo/links';
import { SnapshotNotFoundError } from '../core/repo/snapshots';
import { InvalidRecurrenceError } from './reminders/engine';
import { AiClientError } from './ai/client';
import { BackupValidationError } from './backup/restore';
import {
  AttachmentNotFoundError,
  AttachmentTooLargeError,
} from '../core/repo/attachments';
import { DatabaseUnavailableError, MigrationFailedError } from '../core/db/open';

export interface RpcDispatchContext {
  /** Correlation id of the in-flight request (logs/audit linkage). */
  readonly correlationId: string;
}

export type RpcHandler = (payload: unknown, ctx: RpcDispatchContext) => Promise<unknown>;

/** Map a thrown value onto the protocol error model. */
export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcErrorBase) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof NoteConflictError) {
    return {
      code: 'conflict',
      message: 'This note changed in another tab. Reload, compare or save as a duplicate (FR-NOTE-07).',
    };
  }
  if (
    error instanceof NoteNotFoundError ||
    error instanceof TagNotFoundError ||
    error instanceof CategoryNotFoundError ||
    error instanceof ReminderNotFoundError ||
    error instanceof LinkNotFoundError
  ) {
    return { code: 'not-found', message: error.message };
  }
  if (error instanceof DuplicateTagError) {
    return { code: 'duplicate', message: error.message };
  }
  if (error instanceof InvalidUrlError) {
    return {
      code: 'invalid-url',
      message: 'The URL is not an allowed absolute http(s) address (FR-CAP-04).',
    };
  }
  if (error instanceof InvalidRecurrenceError) {
    return {
      code: 'invalid-request',
      message: error.message,
    };
  }
  if (error instanceof BackupValidationError) {
    return { code: 'invalid-request', message: error.message };
  }
  if (error instanceof AiClientError) {
    if (error.code === 'invalid-base-url') {
      return { code: 'invalid-request', message: error.message };
    }
    // FR-AI-10: LM Studio unavailable/timeout/format — truthful, contained.
    return { code: 'unsupported', message: error.message };
  }
  if (error instanceof AttachmentNotFoundError) {
    return { code: 'not-found', message: error.message };
  }
  if (error instanceof SnapshotNotFoundError) {
    return { code: 'not-found', message: error.message };
  }
  if (error instanceof AttachmentTooLargeError) {
    // The message carries the actual size and limit so the UI can be truthful.
    return { code: 'attachment-too-large', message: error.message };
  }
  if (error instanceof DatabaseUnavailableError) {
    return { code: 'database-unavailable', message: error.message };
  }
  if (error instanceof MigrationFailedError) {
    return {
      code: 'migration-failed',
      message: 'The local database could not be upgraded; writes are stopped to protect your data (FR-DATA-06).',
    };
  }
  const code: RpcErrorCode = 'internal-error';
  const message = error instanceof Error ? error.message : String(error);
  // Never leak stacks or paths; the console keeps the full detail locally.
  return { code, message: message.slice(0, 300) };
}

export class MessageRouter {
  private readonly handlers = new Map<string, RpcHandler>();

  register(type: string, handler: RpcHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`duplicate handler registration for message type "${type}"`);
    }
    this.handlers.set(type, handler);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /** Sorted message types (diagnostics/reporting). */
  listTypes(): readonly string[] {
    return [...this.handlers.keys()].sort();
  }

  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const handler = this.handlers.get(request.type);
    if (!handler) {
      return rpcFailure(request.id, 'not-handled', `no handler registered for "${request.type}"`);
    }
    try {
      const result = await handler(request.payload, { correlationId: request.id });
      return rpcSuccess(request.id, result);
    } catch (error) {
      const rpcError = toRpcError(error);
      if (rpcError.code === 'internal-error') {
        // Full detail goes to the console only; the wire carries a coded error.
        console.error(`[rpc ${request.type} ${request.id}]`, error);
      }
      return rpcFailure(request.id, rpcError.code, rpcError.message);
    }
  }
}

/** Convenience re-export used by the entry listener. */
export { RPC_KIND };
