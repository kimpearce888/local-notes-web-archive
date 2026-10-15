import { describe, expect, it } from 'vitest';
import type { TimeZoneName, UtcTimestamp } from '../../../../src/core/types';
import { newId, isValidId } from '../../../../src/core/util/ids';
import {
  compareUtc,
  daysInMonth,
  isLeapYear,
  isUtcTimestamp,
  isValidTimeZone,
  localYearInZone,
  nowUtc,
} from '../../../../src/core/util/time';
import { sha256Hex, toHex } from '../../../../src/core/util/hash';
import { assertBound, clamp, normalizeKey, safePreview, truncate } from '../../../../src/core/util/strings';
import {
  checkCaptureEligibility,
  dedupKey,
  detectHttpUrlsInText,
  hostClass,
  isApprovedLinkProtocol,
  originOf,
  redactUrlForLog,
} from '../../../../src/core/util/urls';
import { deepFreeze } from '../../../../src/core/util/freeze';

const ts = (s: string): UtcTimestamp => s as UtcTimestamp;
const tz = (s: string): TimeZoneName => s as TimeZoneName;

describe('ids', () => {
  it('generates valid UUID v4 values', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = newId();
      expect(isValidId(id)).toBe(true);
      expect(isValidId(`not-a-uuid-${i}`)).toBe(false);
    }
  });
  it('generates distinct values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(newId());
    expect(seen.size).toBe(200);
  });
});

describe('time', () => {
  it('produces valid UTC timestamps', () => {
    const now = nowUtc();
    expect(isUtcTimestamp(now)).toBe(true);
    expect(isUtcTimestamp('2026-13-45T99:99:99Z')).toBe(false);
    expect(isUtcTimestamp('2026-10-12 08:00:00')).toBe(false);
    expect(isUtcTimestamp(12345)).toBe(false);
  });
  it('compares instants', () => {
    expect(compareUtc(ts('2026-01-01T00:00:00.000Z'), ts('2026-01-02T00:00:00.000Z'))).toBeLessThan(0);
    expect(compareUtc(ts('2026-01-02T00:00:00.000Z'), ts('2026-01-01T00:00:00.000Z'))).toBeGreaterThan(0);
  });
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Nowhere/Nothing')).toBe(false);
    expect(isValidTimeZone('relative')).toBe(false);
  });
  it('computes local year in zone across new year', () => {
    const instant = new Date('2026-01-01T00:30:00.000Z');
    expect(localYearInZone(instant, tz('Asia/Tokyo'))).toBe(2026);
    expect(localYearInZone(instant, tz('America/New_York'))).toBe(2025);
  });
  it('knows leap years and month lengths', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('hash', () => {
  it('computes a stable SHA-256 hex digest', async () => {
    const digest = await sha256Hex('local-notes');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('local-notes')).toBe(digest);
    expect(await sha256Hex('local-notes!')).not.toBe(digest);
  });
  it('matches the known SHA-256 test vector', async () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('hex-encodes bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 255]))).toBe('00010fff');
  });
});

describe('strings', () => {
  it('truncates with marker', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('short', 8)).toBe('short');
    expect(truncate('exactly8', 8)).toBe('exactly8');
  });
  it('asserts bounds with descriptive errors', () => {
    expect(() => assertBound('x'.repeat(11), 10, 'title')).toThrow(/title exceeds maximum length 10/);
    expect(() => assertBound('ok', 10, 'title')).not.toThrow();
  });
  it('normalizes keys casefold + whitespace', () => {
    expect(normalizeKey('  Web   Archive ')).toBe('web archive');
    expect(normalizeKey('Ärger')).toBe(normalizeKey('ärger'));
  });
  it('previews collapse and truncate safely', () => {
    expect(safePreview('a\n\nb   c', 100)).toBe('a b c');
    expect(safePreview('x'.repeat(300), 10)).toBe('xxxxxxxxx…');
  });
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('urls', () => {
  it('normalizes dedup keys (case, default port, fragment)', () => {
    expect(dedupKey('HTTPS://Example.COM:443/a?x=1#frag')).toBe(dedupKey('https://example.com/a?x=1'));
    expect(dedupKey('http://example.com:80/a')).toBe(dedupKey('http://example.com/a'));
    expect(dedupKey('https://example.com/a?x=1&y=2')).not.toBe(dedupKey('https://example.com/a?y=2&x=1'));
    expect(dedupKey('https://example.com/a/')).not.toBe(dedupKey('https://example.com/a'));
  });
  it('extracts origins', () => {
    expect(originOf('https://Example.com:8443/path')).toBe('https://example.com:8443');
    expect(originOf('not a url')).toBeNull();
  });
  it('classifies hosts', () => {
    expect(hostClass('localhost')).toBe('loopback');
    expect(hostClass('app.localhost')).toBe('loopback');
    expect(hostClass('127.0.0.1')).toBe('loopback');
    expect(hostClass('10.1.2.3')).toBe('private');
    expect(hostClass('192.168.0.5')).toBe('private');
    expect(hostClass('172.16.9.9')).toBe('private');
    expect(hostClass('169.254.1.1')).toBe('link-local');
    expect(hostClass('8.8.8.8')).toBe('public');
    expect(hostClass('example.com')).toBe('domain');
    expect(hostClass('240.0.0.1')).toBe('reserved');
    expect(hostClass('[::1]')).toBe('loopback');
    expect(hostClass('[fe80::1]')).toBe('link-local');
    expect(hostClass('[fc00::1]')).toBe('private');
  });
  it('accepts public http/https for capture', () => {
    const ok = checkCaptureEligibility('https://example.com/post/123?x=1');
    expect(ok.ok).toBe(true);
  });
  it('rejects the full FR-CAP-04 matrix', () => {
    const cases: Array<[string, string]> = [
      ['chrome://extensions', 'unsupported-scheme'],
      ['about:blank', 'unsupported-scheme'],
      ['file:///etc/passwd', 'unsupported-scheme'],
      ['javascript:alert(1)', 'unsupported-scheme'],
      ['data:text/html,hi', 'unsupported-scheme'],
      ['ftp://example.com/', 'unsupported-scheme'],
      ['https://user:pass@example.com/', 'credentials-in-url'],
      ['https://localhost/', 'loopback-host'],
      ['http://127.0.0.1:8080/', 'loopback-host'],
      ['http://10.0.0.1/', 'private-network'],
      ['http://192.168.1.1/', 'private-network'],
      ['http://169.254.169.254/', 'link-local'],
      ['http://224.0.0.1/', 'reserved-range'],
      ['http://[::1]/', 'loopback-host'],
      ['not a url', 'invalid-url'],
    ];
    for (const [url, reason] of cases) {
      const result = checkCaptureEligibility(url);
      expect(result.ok, url).toBe(false);
      if (!result.ok) {
        expect(result.reason, url).toBe(reason);
        expect(result.detail.length, url).toBeGreaterThan(0);
      }
    }
  });
  it('redacts query values for logs but keeps keys', () => {
    expect(redactUrlForLog('https://example.com/p?token=abc&next=/x')).toBe(
      'https://example.com/p?token=<redacted>&next=<redacted>',
    );
    expect(redactUrlForLog('https://example.com/p')).toBe('https://example.com/p');
    expect(redactUrlForLog('garbage')).toBe('<invalid-url>');
  });
  it('approves only http/https/mailto link protocols', () => {
    expect(isApprovedLinkProtocol('https://example.com')).toBe(true);
    expect(isApprovedLinkProtocol('mailto:someone@example.com')).toBe(true);
    expect(isApprovedLinkProtocol('javascript:alert(1)')).toBe(false);
    expect(isApprovedLinkProtocol('data:text/html,x')).toBe(false);
    expect(isApprovedLinkProtocol('chrome://settings')).toBe(false);
  });
});


describe('detectHttpUrlsInText (FR-CAP-01)', () => {
  it('extracts http(s) URLs from messy prose in first-seen order', () => {
    const text =
      'See https://example.com/a and http://other.org/b?q=1, plus HTTP://EXAMPLE.COM/a again.';
    expect(detectHttpUrlsInText(text)).toEqual([
      'https://example.com/a',
      'http://other.org/b?q=1',
      'HTTP://EXAMPLE.COM/a',
    ]);
  });
  it('trims trailing punctuation and unbalanced parentheses', () => {
    expect(detectHttpUrlsInText('(visit https://example.com/x) now.')).toEqual([
      'https://example.com/x',
    ]);
    expect(detectHttpUrlsInText('link: https://example.com/y;')).toEqual(['https://example.com/y']);
    expect(detectHttpUrlsInText('(wiki (https://example.com/z))')).toEqual([
      'https://example.com/z',
    ]);
  });
  it('ignores non-http schemes, bare domains and bare fragments', () => {
    expect(detectHttpUrlsInText('javascript:alert(1) ftp://x/ example.com/path')).toEqual([]);
    expect(detectHttpUrlsInText('no urls here at all')).toEqual([]);
  });
  it('deduplicates repeated URLs', () => {
    expect(detectHttpUrlsInText('https://a.com/1 https://a.com/1 https://a.com/1')).toEqual([
      'https://a.com/1',
    ]);
  });
});

describe('deepFreeze', () => {
  it('freezes nested structures', () => {
    const fixture = deepFreeze({ a: { b: [1, 2] } });
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.a)).toBe(true);
    expect(() => {
      (fixture as { a: { b: number[] } }).a.b[0] = 9;
    }).toThrow();
  });
});
