// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * T-086 (register UX-07): HEIC/HEIF detection and the local conversion
 * choke point. The decode itself runs inside a Web Worker — jsdom has no
 * Worker implementation, so the unit layer pins detection, orchestration
 * (through a mocked dynamic import), honest failure mapping and the
 * build-time worker extraction contract; the REAL decode is proven by the
 * E2E battery against the built extension (t084-register-fixes.spec.ts),
 * which runs in actual Chromium with a real Worker.
 */

vi.mock('heic-to/csp', () => ({
  heicTo: vi.fn(),
  isHeic: vi.fn(),
}));

import { heicTo } from 'heic-to/csp';
import {
  IMAGE_ACCEPT_LIST,
  convertHeicToJpeg,
  looksLikeHeic,
} from '../../../src/dashboard/editor/heic-image';

const mockedDecoder = vi.mocked(heicTo);

beforeEach(() => {
  mockedDecoder.mockReset();
});

describe('detection (looksLikeHeic)', () => {
  it('matches by MIME type', () => {
    expect(looksLikeHeic({ type: 'image/heic', name: 'photo' })).toBe(true);
    expect(looksLikeHeic({ type: 'image/heif', name: 'photo' })).toBe(true);
  });

  it('matches by extension when the picker handed out no MIME', () => {
    expect(looksLikeHeic({ type: '', name: 'IMG_4032.heic' })).toBe(true);
    expect(looksLikeHeic({ type: '', name: 'IMG_4032.HEIC' })).toBe(true);
    expect(looksLikeHeic({ type: '', name: 'photo.heif' })).toBe(true);
  });

  it('never matches other images or files', () => {
    expect(looksLikeHeic({ type: 'image/png', name: 'dot.png' })).toBe(false);
    expect(looksLikeHeic({ type: 'image/jpeg', name: 'dot.jpg' })).toBe(false);
    expect(looksLikeHeic({ type: '', name: 'notes.txt' })).toBe(false);
    expect(looksLikeHeic({ type: '', name: 'heic.txt' })).toBe(false);
  });
});

describe('accept list (UX-07: OS pickers must not grey out photos)', () => {
  it('admits HEIC/HEIF both as MIME types and as file extensions', () => {
    expect(IMAGE_ACCEPT_LIST).toContain('image/heic');
    expect(IMAGE_ACCEPT_LIST).toContain('image/heif');
    expect(IMAGE_ACCEPT_LIST).toContain('.heic');
    expect(IMAGE_ACCEPT_LIST).toContain('.heif');
    // The natively rendered families all stay.
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']) {
      expect(IMAGE_ACCEPT_LIST).toContain(mime);
    }
  });
});

describe('conversion orchestration', () => {
  it('returns a renamed JPEG File on success', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], {
      type: 'image/jpeg',
    });
    mockedDecoder.mockResolvedValue(jpeg);
    const original = new File([new Uint8Array([1, 2, 3])], 'IMG_4032.heic', {
      type: 'image/heic',
    });
    const outcome = await convertHeicToJpeg(original);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.file.name).toBe('IMG_4032.jpg');
    expect(outcome.file.type).toBe('image/jpeg');
    expect(mockedDecoder).toHaveBeenCalledWith({
      blob: original,
      type: 'image/jpeg',
      quality: 0.9,
    });
  });

  it('rejects a zero-sized decoder result honestly', async () => {
    mockedDecoder.mockResolvedValue(new Blob([], { type: 'image/jpeg' }));
    const outcome = await convertHeicToJpeg(
      new File([new Uint8Array([1])], 'empty.heic', { type: 'image/heic' }),
    );
    expect(outcome.ok).toBe(false);
  });

  it('maps decoder failures to an honest, actionable message', async () => {
    mockedDecoder.mockRejectedValue(new Error('libheif could not parse the input'));
    const outcome = await convertHeicToJpeg(
      new File([new Uint8Array([1, 2, 3])], 'broken.heic', { type: 'image/heic' }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('broken.heic');
    expect(outcome.message).toContain('libheif could not parse the input');
  });

  it('rejects empty decoder output honestly', async () => {
    mockedDecoder.mockResolvedValue(new Blob([], { type: 'image/jpeg' }));
    const outcome = await convertHeicToJpeg(
      new File([new Uint8Array([1])], 'empty.heic', { type: 'image/heic' }),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('build-time decoder extraction contract', () => {
  it('the pinned heic-to CSP bundle embeds its worker where the build can extract it', () => {
    // vite.config.ts extracts exactly this string into the extension file
    // dist/heic-decoder-worker.js and redirects the Worker bootstrap. If
    // heic-to is ever upgraded and the embedding changes, this test fails
    // FIRST with a precise reason instead of a mysterious "blob worker
    // CSP" failure in the browser.
    const source = readFileSync(
      resolve('node_modules/heic-to/dist/csp/heic-to.js'),
      'utf8',
    );
    const embedded = /let t='((?:[^'\\]|\\.)*)',e=new Blob\(\[t\]/.exec(source);
    expect(
      embedded,
      'the pinned CSP build must embed its worker as the t string literal',
    ).not.toBeNull();
    expect((embedded?.[1] ?? '').length).toBeGreaterThan(1_000_000);
    expect(
      /new Worker\(URL\.createObjectURL\(e\)\)/.test(source),
      'the blob Worker bootstrap the build redirects must still exist',
    ).toBe(true);
    // heicTo must stay exported (the conversion entry point).
    expect(source).toContain('heicTo');
  });

  it('the pinned CSP build uses no dynamic evaluation (extension CSP safety)', () => {
    // The whole point of the ./csp subpath: no eval / new Function anywhere,
    // so the decoder runs under the manifest's strict script-src 'self'.
    const source = readFileSync(
      resolve('node_modules/heic-to/dist/csp/heic-to.js'),
      'utf8',
    );
    expect(source).not.toContain('new Function');
    expect(source).not.toMatch(/[^a-zA-Z.]eval\(/);
  });

  it('the committed HEIC fixture is a real HEIC container', () => {
    // Provenance: demo/1.heic from the MIT-licensed heic2any repository.
    const bytes = readFileSync(resolve('tests/fixtures/heic-sample.heic'));
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(['heic', 'mif1', 'heix']).toContain(bytes.subarray(8, 12).toString('latin1'));
  });
});
