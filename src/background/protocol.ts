/**
 * Typed RPC protocol between extension contexts (dashboard tab, future UIs)
 * and the service worker (PRD §8.1 "message routing").
 *
 * Every request carries a correlation id; responses echo it so callers can
 * match replies under concurrency. Payloads are structurally validated by the
 * receiving handler — never trusted — and failures surface as typed error
 * codes the UI can act on (PRD §12 error-state matrix).
 */

/* ------------------------------------------------------------------ */
/* Error model                                                         */
/* ------------------------------------------------------------------ */

/**
 * Machine-readable failure codes. The dashboard maps these to the PRD §12
 * error states instead of parsing message strings.
 */
export type RpcErrorCode =
  /** Malformed envelope or payload. */
  | 'invalid-request'
  /** Target entity does not exist. */
  | 'not-found'
  /** Optimistic-concurrency conflict (FR-NOTE-07). */
  | 'conflict'
  /** Unique-key collision (e.g. normalized tag key). */
  | 'duplicate'
  /** URL failed the capture/link gate (FR-CAP-04). */
  | 'invalid-url'
  /** No handler registered for the message type. */
  | 'not-handled'
  /** IndexedDB could not be opened. */
  | 'database-unavailable'
  /** Schema migration failed; writes stopped (FR-DATA-06). */
  | 'migration-failed'
  /** Operation denied by permission policy. */
  | 'denied'
  /** Feature unavailable in this environment. */
  | 'unsupported'
  /** Unexpected internal failure. */
  | 'internal-error';

export interface RpcError {
  readonly code: RpcErrorCode;
  readonly message: string;
}

/** Base class for protocol-level errors raised deliberately by handlers. */
export class RpcErrorBase extends Error {
  constructor(message: string, readonly code: RpcErrorCode) {
    super(message);
    this.name = 'RpcErrorBase';
  }
}

/** Thrown when a payload fails structural validation. */
export class PayloadValidationError extends RpcErrorBase {
  constructor(message: string) {
    super(message, 'invalid-request');
    this.name = 'PayloadValidationError';
  }
}

/** Thrown when a handler needs an environment capability that is absent. */
export class UnsupportedError extends RpcErrorBase {
  constructor(message: string) {
    super(message, 'unsupported');
    this.name = 'UnsupportedError';
  }
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export const RPC_KIND = 'lnwa-rpc' as const;

export interface RpcRequest {
  readonly kind: typeof RPC_KIND;
  /** Correlation id (UUID); echoed on the response. */
  readonly id: string;
  /** Namespaced message type, e.g. "notes/save". */
  readonly type: string;
  /** Structurally validated by the handler. */
  readonly payload: unknown;
}

export type RpcResponse =
  | { readonly kind: typeof RPC_KIND; readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly kind: typeof RPC_KIND; readonly id: string; readonly ok: false; readonly error: RpcError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural envelope check; handlers validate the payload itself. */
export function isRpcRequest(value: unknown): value is RpcRequest {
  if (!isPlainObject(value)) return false;
  if (value['kind'] !== RPC_KIND) return false;
  if (typeof value['id'] !== 'string' || value['id'].length === 0) return false;
  if (typeof value['type'] !== 'string' || value['type'].length === 0) return false;
  if (value['type'].length > 200) return false;
  return 'payload' in value;
}

/** Fresh correlation id for a new request (caller side). */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function rpcSuccess(id: string, result: unknown): RpcResponse {
  return { kind: RPC_KIND, id, ok: true, result: result === undefined ? null : result };
}

export function rpcFailure(id: string, code: RpcErrorCode, message: string): RpcResponse {
  return { kind: RPC_KIND, id, ok: false, error: { code, message } };
}
