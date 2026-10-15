import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderIconPng, ICON_SIZES } from '../../../scripts/generate-icons.mjs';
import { APP_VERSION, MIN_CHROME_VERSION } from '../../../src/core/version';

/**
 * T-013 validation: the shipped manifest matches the PRD §8.2 permission
 * plan, the CSP is narrowed to local execution + loopback AI, icons exist
 * with correct dimensions, the extension ID is pinned by a public key, and
 * nothing anywhere points at a remote runtime resource.
 */

const root = join(__dirname, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8')) as Record<
  string,
  unknown
>;

function readIcon(size: number): Buffer {
  return readFileSync(join(root, 'public', 'icons', `icon-${size}.png`));
}

/** Minimal PNG structural parse: magic + IHDR dimensions. */
function pngDimensions(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  const ihdrType = buffer.subarray(12, 16).toString('ascii');
  expect(ihdrType).toBe('IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('manifest core fields', () => {
  it('is Manifest V3 with the canonical name and mirrored version', () => {
    expect(manifest['manifest_version']).toBe(3);
    expect(manifest['name']).toBe('Local Notes & Web Archive');
    expect(manifest['version']).toBe(APP_VERSION);
    expect(typeof manifest['description']).toBe('string');
    expect((manifest['description'] as string).length).toBeGreaterThan(20);
  });

  it('pins the minimum Chrome version', () => {
    expect(String(manifest['minimum_chrome_version'])).toBe(String(MIN_CHROME_VERSION));
  });

  it('registers the module service worker at the built path', () => {
    const background = manifest['background'] as { service_worker: string; type: string };
    expect(background.service_worker).toBe('assets/background.js');
    expect(background.type).toBe('module');
  });

  it('declares the action with title and the four icon sizes', () => {
    const action = manifest['action'] as { default_title: string; default_icon: Record<string, string> };
    expect(action.default_title).toBe('Local Notes & Web Archive');
    expect(Object.keys(action.default_icon).sort()).toEqual(['128', '16', '32', '48']);
  });
});

describe('permissions (PRD §8.2 — narrowest effective set)', () => {
  it('requests exactly the planned required permissions', () => {
    const permissions = (manifest['permissions'] as string[]).slice().sort();
    expect(permissions).toEqual(
      [
        'alarms',
        'contextMenus', // PRD §4.1 context-menu actions (no install warning)
        'debugger', // CDP screenshot of the temporary capture tab only
        'notifications',
        'pageCapture',
        'scripting',
        'storage',
        'unlimitedStorage',
      ].sort(),
    );
  });

  it('never requests the forbidden powerful permissions', () => {
    const permissions = manifest['permissions'] as string[];
    for (const banned of ['tabs', 'cookies', 'history', 'webRequest', 'downloads', 'nativeMessaging']) {
      expect(permissions).not.toContain(banned);
    }
    const allHosts = JSON.stringify(manifest);
    expect(allHosts).not.toContain('<all_urls>');
  });

  it('holds only loopback required host permissions (LM Studio client)', () => {
    const hosts = (manifest['host_permissions'] as string[]).slice().sort();
    expect(hosts).toEqual(['http://127.0.0.1/*', 'http://localhost/*']);
  });

  it('declares http/https as optional per-origin host permissions only', () => {
    const optional = (manifest['optional_host_permissions'] as string[]).slice().sort();
    expect(optional).toEqual(['http://*/*', 'https://*/*']);
  });
});

describe('content security policy (PRD §7/§8.2)', () => {
  const csp = (manifest['content_security_policy'] as { extension_pages: string }).extension_pages;

  it('locks scripts and objects to the extension itself', () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('wasm-unsafe-eval');
  });

  it('narrows connections to self plus loopback for the local AI', () => {
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:* http://localhost:*");
    // No remote hosts smuggled into any directive.
    const remote = /https?:\/\/(?!127\.0\.0\.1|localhost)[\w.-]+/;
    expect(remote.test(csp)).toBe(false);
  });
});

describe('commands (PRD §4.1)', () => {
  it('binds the dashboard and create-note shortcuts with descriptions', () => {
    const commands = manifest['commands'] as Record<string, { description: string; suggested_key?: { default: string } }>;
    expect(commands['_execute_action']).toBeDefined();
    expect(commands['_execute_action']?.description).toMatch(/dashboard/i);
    expect(commands['_execute_action']?.suggested_key?.default).toBe('Alt+Shift+N');
    expect(commands['create-note']).toBeDefined();
    expect(commands['create-note']?.description).toMatch(/note/i);
    expect(commands['create-note']?.suggested_key?.default).toBe('Alt+Shift+C');
  });
});

describe('icons', () => {
  it('ships all four sizes with matching IHDR dimensions', () => {
    for (const size of ICON_SIZES) {
      const buffer = readIcon(size);
      const { width, height } = pngDimensions(buffer);
      expect(width).toBe(size);
      expect(height).toBe(size);
    }
  });

  it('commits exactly the deterministic generator output (byte-stable)', () => {
    for (const size of ICON_SIZES) {
      const committed = readIcon(size);
      const regenerated = renderIconPng(size);
      expect(committed.equals(regenerated)).toBe(true);
    }
  });

  it('renders identical bytes across invocations (no randomness)', () => {
    for (const size of ICON_SIZES) {
      expect(renderIconPng(size).equals(renderIconPng(size))).toBe(true);
    }
  });

  it('produces plausible non-trivial images', () => {
    for (const size of ICON_SIZES) {
      expect(readIcon(size).length).toBeGreaterThan(100);
    }
    // Larger canvases carry more detail than smaller ones.
    expect(readIcon(128).length).toBeGreaterThan(readIcon(16).length);
  });
});

describe('extension identity (pinned ID)', () => {
  it('embeds a valid RSA public key that pins the extension ID', () => {
    const keyField = manifest['key'] as string;
    expect(typeof keyField).toBe('string');
    const der = Buffer.from(keyField, 'base64');
    expect(der.length).toBeGreaterThanOrEqual(270); // RSA-2048 SPKI is ~294 bytes
    const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
      .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
      .join('');
    expect(id).toMatch(/^[a-p]{32}$/);
    // The ID documented in docs/EXTENSION_IDENTITY.md.
    expect(id).toBe('pieeojhacbmcmkfakahpapgpmejgnaij');
  });
});

describe('no remote runtime resources (release-gate parity)', () => {
  it('contains no remote URLs anywhere in the manifest', () => {
    const serialized = JSON.stringify(manifest);
    const remote = /https?:\/\/(?!127\.0\.0\.1|localhost)[\w.-]+/;
    expect(remote.test(serialized)).toBe(false);
  });
});
