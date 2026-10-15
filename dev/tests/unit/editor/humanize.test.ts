import { describe, expect, it } from 'vitest';
import { describeMimeType } from '../../../../src/dashboard/editor/humanize';

/**
 * T-088 (register UX-11): MIME types are developer vocabulary. The mapper
 * covers every type the product itself creates or verifies (attachment
 * sniffing, HEIC conversion, exports) and falls back to the raw value for
 * anything else — honest rather than guessed.
 */
describe('describeMimeType', () => {
  it('maps the common image types to user language', () => {
    expect(describeMimeType('image/png')).toBe('PNG image');
    expect(describeMimeType('image/jpeg')).toBe('JPEG photo');
    expect(describeMimeType('image/gif')).toBe('GIF image');
    expect(describeMimeType('image/webp')).toBe('WebP image');
    expect(describeMimeType('image/bmp')).toBe('BMP image');
    expect(describeMimeType('image/svg+xml')).toBe('SVG drawing');
  });

  it('maps the HEIC/HEIF photos the picker now admits (T-086)', () => {
    expect(describeMimeType('image/heic')).toBe('HEIC photo');
    expect(describeMimeType('image/heif')).toBe('HEIF photo');
  });

  it('maps documents, text and archives', () => {
    expect(describeMimeType('application/pdf')).toBe('PDF document');
    expect(describeMimeType('text/plain')).toBe('plain-text file');
    expect(describeMimeType('text/markdown')).toBe('Markdown file');
    expect(describeMimeType('text/html')).toBe('HTML page');
    expect(describeMimeType('application/zip')).toBe('ZIP archive');
    expect(describeMimeType('application/gzip')).toBe('GZIP archive');
    expect(describeMimeType('application/octet-stream')).toBe('binary file');
  });

  it('derives family labels for unmapped subtypes instead of lying', () => {
    expect(describeMimeType('image/x-nikon-raw')).toBe('X-NIKON-RAW image');
    expect(describeMimeType('video/mp4')).toBe('MP4 video');
    expect(describeMimeType('audio/ogg')).toBe('OGG audio');
  });

  it('falls back to the raw value when nothing is known', () => {
    expect(describeMimeType('application/x-unknown')).toBe('application/x-unknown');
  });
});
