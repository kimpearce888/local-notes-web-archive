/**
 * URL utilities: normalization, deduplication keys, log redaction and the
 * capture eligibility gate (FR-CAP-04, PRD §10).
 *
 * The gate rejects:
 *  - non-HTTP(S) schemes (chrome:, edge:, about:, file:, data:, javascript:…)
 *  - URLs carrying credentials (user:pass@host)
 *  - localhost and *.localhost
 *  - link-local, private, loopback and reserved IPv4/IPv6 ranges
 *  - invalid or empty hosts
 */

export interface UrlParts {
  readonly href: string;
  readonly scheme: string;
  readonly host: string; // hostname, lowercased
  readonly port: number | null;
  readonly origin: string;
  readonly path: string;
  readonly query: string | null;
}

export type UrlRejectReason =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'credentials-in-url'
  | 'empty-host'
  | 'loopback-host'
  | 'private-network'
  | 'link-local'
  | 'reserved-range';

export type UrlGateResult =
  | { ok: true; parts: UrlParts }
  | { ok: false; reason: UrlRejectReason; detail: string };

/** Parse and normalize a URL; throws only for non-string input. */
export function parseUrl(raw: string): UrlParts | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const port = url.port === '' ? null : Number.parseInt(url.port, 10);
  return {
    href: url.href,
    scheme: url.protocol.replace(/:$/, '').toLowerCase(),
    host: url.hostname.toLowerCase(),
    port,
    origin: url.origin,
    path: url.pathname,
    query: url.search === '' ? null : url.search,
  };
}

/**
 * Normalized deduplication key: scheme + lowercase host + default-port-stripped
 * origin + canonical path (no fragment). Query is preserved in original order —
 * reordering query params changes what the server may return, so two URLs that
 * differ only in param order are NOT deduplicated (honest default, FR-CAP-03).
 */
export function dedupKey(raw: string): string | null {
  const parts = parseUrl(raw);
  if (!parts) return null;
  const defaultStripped =
    (parts.scheme === 'https' && parts.port === 443) ||
    (parts.scheme === 'http' && parts.port === 80)
      ? ''
      : parts.port === null
        ? ''
        : `:${parts.port}`;
  const path = parts.path === '' ? '/' : parts.path;
  const query = parts.query ?? '';
  return `${parts.scheme}://${parts.host}${defaultStripped}${path}${query}`;
}

/** Origin (scheme://host[:port]) for permission bookkeeping. */
export function originOf(raw: string): string | null {
  const parts = parseUrl(raw);
  return parts ? parts.origin : null;
}

/* ------------------------------------------------------------------ */
/* Private / reserved network detection                                */
/* ------------------------------------------------------------------ */

const IPv4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Octets(host: string): [number, number, number, number] | null {
  const match = IPv4_RE.exec(host);
  if (!match) return null;
  const octets = [match[1] ?? '', match[2] ?? '', match[3] ?? '', match[4] ?? ''].map((o) =>
    Number.parseInt(o, 10),
  );
  if (octets.some((o) => o > 255)) return null;
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/**
 * IPv4 classification. 0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16,
 * 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16,
 * 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, 255.255.255.255.
 */
export function ipv4Class(host: string): 'public' | 'loopback' | 'private' | 'link-local' | 'reserved' | null {
  const o = ipv4Octets(host);
  if (!o) return null;
  const [a, b] = o;
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && (b === 0 || b === 2)) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 || b === 100)) ||
    (a === 203 && b === 0) ||
    a >= 224
  ) {
    return 'reserved';
  }
  return 'public';
}

/**
 * IPv6 classification for the bracket forms we may see. Covers ::, ::1,
 * fc00::/7 (unique local), fe80::/10 (link local), and IPv4-mapped ranges.
 */
export function ipv6Class(host: string): 'public' | 'loopback' | 'private' | 'link-local' | 'reserved' | null {
  if (!host.includes(':')) return null;
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return 'loopback';
  if (h.startsWith('fc') || h.startsWith('fd')) return 'private';
  if (/^fe[89ab]/.test(h)) return 'link-local';
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice(7);
    return ipv4Class(mapped);
  }
  if (h.startsWith('ff')) return 'reserved';
  if (h.startsWith('2001:db8')) return 'reserved';
  return 'public';
}

/** Classify any host string. */
export function hostClass(host: string): 'public' | 'loopback' | 'private' | 'link-local' | 'reserved' | 'domain' {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'loopback';
  }
  const v4 = ipv4Class(host);
  if (v4) return v4;
  const v6 = ipv6Class(host);
  if (v6) return v6;
  return 'domain';
}

/**
 * Capture eligibility gate (FR-CAP-04). Only explicit HTTP/HTTPS public URLs
 * pass. Loopback is allowed exclusively for the LM Studio client (checked
 * separately, not via this gate).
 */
export function checkCaptureEligibility(raw: string): UrlGateResult {
  const parts = parseUrl(raw);
  if (!parts) {
    return { ok: false, reason: 'invalid-url', detail: 'the URL could not be parsed' };
  }
  if (parts.scheme !== 'http' && parts.scheme !== 'https') {
    return {
      ok: false,
      reason: 'unsupported-scheme',
      detail: `scheme "${parts.scheme}:" is not supported; only http and https can be captured`,
    };
  }
  // Credentials embedded in the URL are always rejected.
  const url = new URL(parts.href);
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials-in-url', detail: 'URLs with embedded credentials are rejected' };
  }
  if (parts.host === '') {
    return { ok: false, reason: 'empty-host', detail: 'the URL has no host' };
  }
  const klass = hostClass(parts.host);
  switch (klass) {
    case 'loopback':
      return { ok: false, reason: 'loopback-host', detail: 'localhost/loopback addresses are blocked for capture' };
    case 'private':
      return { ok: false, reason: 'private-network', detail: 'private-network addresses are blocked for capture' };
    case 'link-local':
      return { ok: false, reason: 'link-local', detail: 'link-local addresses are blocked for capture' };
    case 'reserved':
      return { ok: false, reason: 'reserved-range', detail: 'reserved/multicast addresses are blocked for capture' };
    default:
      return { ok: true, parts };
  }
}

/**
 * Log-safe URL: query parameters may carry tokens — redact their values
 * (FR-LOG-03). The unredacted URL lives only in the note/snapshot record.
 */
export function redactUrlForLog(raw: string): string {
  const parts = parseUrl(raw);
  if (!parts) return '<invalid-url>';
  if (!parts.query) return `${parts.origin}${parts.path}`;
  const redacted = parts.query
    .slice(1)
    .split('&')
    .map((pair) => (pair === '' ? '' : `${pair.split('=')[0] ?? ''}=<redacted>`))
    .join('&');
  return `${parts.origin}${parts.path}?${redacted}`;
}

/** Approved link protocols for user content (PRD §10). */
const APPROVED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isApprovedLinkProtocol(raw: string): boolean {
  try {
    return APPROVED_PROTOCOLS.has(new URL(raw.trim()).protocol.toLowerCase());
  } catch {
    return false;
  }
}
