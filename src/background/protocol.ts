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
  /** Attachment exceeds the configured byte limit (PRD §10). */
  | 'attachment-too-large'
  /** Storage quota exhausted during a write (PRD §12 storage-full). */
  | 'storage-full'
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

/** Structural response check used by the dashboard-side client. */
export function isRpcResponse(value: unknown): value is RpcResponse {
  if (!isPlainObject(value)) return false;
  if (value['kind'] !== RPC_KIND) return false;
  if (typeof value['id'] !== 'string' || value['id'].length === 0) return false;
  if (value['ok'] === true) return 'result' in value;
  if (value['ok'] === false) {
    const error = value['error'];
    if (!isPlainObject(error)) return false;
    return typeof error['code'] === 'string' && typeof error['message'] === 'string';
  }
  return false;
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

/* ------------------------------------------------------------------ */
/* Binary transfer codec (T-063)                                       */
/* ------------------------------------------------------------------ */

/**
 * chrome.runtime.sendMessage JSON-serializes everything it carries, so a
 * Blob placed in a payload or result arrives at the far end as `{}` — the
 * single transport defect behind the T-062 audit's D-04 (attachments broken
 * end-to-end: "data must be a Blob") and D-06 (backup export AND restore
 * broken), and by the same class every blob-returning RPC
 * (attachments/get-blob, snapshots/get-png, snapshots/export,
 * notes/export-file).
 *
 * The codec adapts the two channel boundaries to that reality:
 * encodeBinaries() swaps every Blob for a plain-JSON envelope (base64
 * payload), decodeBinaries() swaps exact-shaped envelopes back into real
 * Blobs. Call sites and handlers keep working with Blobs — the envelope
 * exists only on the wire. `BINARY_ENVELOPE_KEY` is a protocol-reserved
 * property name: an object of exactly { flag, mimeType, base64 } is treated
 * as an envelope, so user data cannot collide with it in practice.
 */
export const BINARY_ENVELOPE_KEY = '__lnwaBinary';

export interface BinaryEnvelope {
  readonly [BINARY_ENVELOPE_KEY]: true;
  readonly mimeType: string;
  readonly base64: string;
}

/** Walking bound: payloads are small object trees; deeper means refuse. */
const MAX_BINARY_WALK_DEPTH = 16;
/** fromCharCode chunk size that keeps every spread call far below stack limits. */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * TRUE plain objects only (Object.prototype or null prototype) — the shape
 * JSON.parse produces. Class instances (Date, RegExp, Map…) are leaves:
 * they pass through untouched and keep whatever channel semantics they
 * already had, never silently corrupted into {}.
 */
function isJsonPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnvelopeShape(value: unknown): value is BinaryEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record[BINARY_ENVELOPE_KEY] !== true) return false;
  if (typeof record['mimeType'] !== 'string') return false;
  if (typeof record['base64'] !== 'string') return false;
  return Object.keys(record).length === 3;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64); // throws on invalid base64 — mapped by the caller
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function blobToEnvelope(blob: Blob): Promise<BinaryEnvelope> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    [BINARY_ENVELOPE_KEY]: true,
    mimeType: blob.type,
    base64: bytesToBase64(bytes),
  };
}

function envelopeToBlob(envelope: BinaryEnvelope): Blob {
  if (envelope.mimeType.length > 255) {
    throw new PayloadValidationError('binary envelope: mimeType is too long');
  }
  try {
    return new Blob([base64ToBytes(envelope.base64)], {
      type: envelope.mimeType.length > 0 ? envelope.mimeType : 'application/octet-stream',
    });
  } catch {
    throw new PayloadValidationError('binary envelope: base64 payload is malformed');
  }
}

/**
 * Deep-walks a JSON-ifiable value and replaces every Blob (File included)
 * with its base64 envelope. Depth-bounded: a payload nested deeper than
 * MAX_BINARY_WALK_DEPTH is refused honestly instead of recursing blindly.
 */
export async function encodeBinaries(value: unknown, depth = 0): Promise<unknown> {
  if (depth > MAX_BINARY_WALK_DEPTH) {
    throw new Error(`binary codec: payload nesting exceeds ${MAX_BINARY_WALK_DEPTH} levels`);
  }
  if (value instanceof Blob) {
    return blobToEnvelope(value);
  }
  if (Array.isArray(value)) {
    const encoded: unknown[] = [];
    let changed = false;
    for (const item of value) {
      const result = await encodeBinaries(item, depth + 1);
      encoded.push(result);
      if (result !== item) changed = true;
    }
    return changed ? encoded : value;
  }
  if (isJsonPlainObject(value)) {
    const encoded: Record<string, unknown> = {};
    let changed = false;
    for (const [key, item] of Object.entries(value)) {
      const result = await encodeBinaries(item, depth + 1);
      encoded[key] = result;
      if (result !== item) changed = true;
    }
    return changed ? encoded : value;
  }
  return value;
}

/**
 * Synchronous probe: does this value contain a Blob anywhere? Callers use it
 * to skip the async encode entirely for the (common) Blob-free request —
 * keeping request dispatch free of extra microtask hops unless binaries
 * actually need transporting.
 */
export function containsBlob(value: unknown, depth = 0): boolean {
  if (depth > MAX_BINARY_WALK_DEPTH) return false; // encode will refuse it
  if (value instanceof Blob) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsBlob(item, depth + 1));
  }
  if (isJsonPlainObject(value)) {
    return Object.values(value).some((item) => containsBlob(item, depth + 1));
  }
  return false;
}

/**
 * Deep-walks a received message value and rebuilds Blobs from
 * exact-shaped envelopes. Malformed envelope base64 is a hard
 * PayloadValidationError — never a silent empty blob. Copy-on-write:
 * subtrees without envelopes keep their original identity, so ordinary
 * (binary-free) responses pass through untouched.
 */
export function decodeBinaries(value: unknown, depth = 0): unknown {
  if (depth > MAX_BINARY_WALK_DEPTH) {
    throw new PayloadValidationError(
      `binary codec: payload nesting exceeds ${MAX_BINARY_WALK_DEPTH} levels`,
    );
  }
  if (hasExactEnvelopeShape(value)) {
    return envelopeToBlob(value);
  }
  if (Array.isArray(value)) {
    const decoded: unknown[] = [];
    let changed = false;
    for (const item of value) {
      const result = decodeBinaries(item, depth + 1);
      decoded.push(result);
      if (result !== item) changed = true;
    }
    return changed ? decoded : value;
  }
  if (isJsonPlainObject(value)) {
    const decoded: Record<string, unknown> = {};
    let changed = false;
    for (const [key, item] of Object.entries(value)) {
      const result = decodeBinaries(item, depth + 1);
      decoded[key] = result;
      if (result !== item) changed = true;
    }
    return changed ? decoded : value;
  }
  return value;
}
