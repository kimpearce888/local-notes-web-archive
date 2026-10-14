/**
 * Origin permission manager (FR-CAP-02, FR-SET-03).
 *
 * Site access is OPTIONAL and per-origin: the manifest requests no broad
 * host permissions — only loopback for LM Studio — and every capture origin
 * must be granted explicitly through `chrome.permissions` with an exact
 * `scheme://host[:port]/*` pattern.
 *
 * Chrome's own gesture rules apply: `permissions.request` succeeds only when
 * called inside a user-gesture window. Verified through the real UI (QA-D06):
 * the gesture does NOT propagate across the RPC hop into the service worker —
 * so the DASHBOARD PAGE performs the request in its own click handler
 * (snapshots panel grant button) and this worker-side helper only re-checks
 * and resumes. Never call this from background-initiated retries — a declined
 * request is retained as a `permission-required` link and is never retried
 * without another user action (FR-CAP-02).
 */

import { parseUrl } from '../core/util/urls';

/** Manifest-required loopback patterns (LM Studio) — never listed as grants. */
const REQUIRED_LOOPBACK_PATTERNS = ['http://127.0.0.1/*', 'http://localhost/*'];

/**
 * Exact-origin match pattern for `chrome.permissions`: `https://example.com`
 * → `https://example.com/*`. Returns null for anything that is not a bare
 * http(s) origin (path, query, credentials or non-web schemes are rejected —
 * the request must cover exactly the origin, nothing broader).
 */
export function originPattern(origin: string): string | null {
  const parts = parseUrl(origin);
  if (!parts) return null;
  if (parts.scheme !== 'http' && parts.scheme !== 'https') return null;
  if (parts.host === '') return null;
  // parseUrl normalises trailing-slash-only paths; a real origin has no path.
  if (parts.path !== '/' && parts.path !== '') return null;
  if (parts.query) return null;
  return `${parts.origin}/*`;
}

/** True when the exact origin is currently granted to the extension. */
export async function hasOriginPermission(origin: string): Promise<boolean> {
  const pattern = originPattern(origin);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

/**
 * Request the exact-origin host permission. MUST run inside a user gesture
 * (dashboard click → RPC). Resolves false when Chrome refuses — which covers
 * both a missing gesture and the user declining the prompt.
 */
export async function requestOriginPermission(origin: string): Promise<boolean> {
  const pattern = originPattern(origin);
  if (!pattern) return false;
  return chrome.permissions.request({ origins: [pattern] });
}

/** Revoke the exact-origin host permission (settings screen, FR-SET-03). */
export async function removeOriginPermission(origin: string): Promise<boolean> {
  const pattern = originPattern(origin);
  if (!pattern) return false;
  return chrome.permissions.remove({ origins: [pattern] });
}

/**
 * Origins currently granted for capture: `chrome.permissions.getAll()` is the
 * source of truth (it reflects grants made from our UI, from Chrome's own
 * site-access controls, and anything the user changed elsewhere). Loopback
 * patterns are manifest-required, not per-origin grants, so they are excluded.
 */
export async function listGrantedCaptureOrigins(): Promise<string[]> {
  const all = await chrome.permissions.getAll();
  const patterns = all.origins ?? [];
  const origins = new Set<string>();
  for (const pattern of patterns) {
    if (REQUIRED_LOOPBACK_PATTERNS.includes(pattern)) continue;
    if (!pattern.startsWith('http://') && !pattern.startsWith('https://')) continue;
    if (!pattern.endsWith('/*')) continue;
    origins.add(pattern.slice(0, -2));
  }
  return [...origins].sort();
}
