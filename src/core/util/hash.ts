import type { ContentHash } from '../types';

/**
 * Content hashing via the WebCrypto SubtleCrypto API (SHA-256).
 * Used for snapshot/attachment integrity checks and audit records
 * (PRD §6 invariants: snapshots and attachments are content-hash checked).
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<ContentHash> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = new Uint8Array(data);
  } else {
    bytes = new Uint8Array(data);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') as ContentHash;
}

/** Hex encoding helper (blob keys, checksums). */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
