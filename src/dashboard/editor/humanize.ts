/**
 * User-language helpers (T-088, T-084 register UX-11): MIME types are
 * developer vocabulary — a notes user expects "PNG image", not
 * "image/png". One shared mapper so every surface (attachment rows, delete
 * confirmations, future call sites) speaks the same language; the raw
 * type always stays available in title attributes and technical views
 * like diagnostics (UX-17 keeps its technical vocabulary by design).
 */

const MIME_DESCRIPTIONS: Record<string, string> = {
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG photo',
  'image/gif': 'GIF image',
  'image/webp': 'WebP image',
  'image/bmp': 'BMP image',
  'image/svg+xml': 'SVG drawing',
  'image/heic': 'HEIC photo',
  'image/heif': 'HEIF photo',
  'application/pdf': 'PDF document',
  'text/plain': 'plain-text file',
  'text/markdown': 'Markdown file',
  'text/html': 'HTML page',
  'text/css': 'CSS stylesheet',
  'text/csv': 'CSV data file',
  'application/json': 'JSON data file',
  'application/zip': 'ZIP archive',
  'application/gzip': 'GZIP archive',
  'application/octet-stream': 'binary file',
};

/**
 * Human description of a MIME type, e.g. `image/png` → "PNG image".
 * Unknown types fall back to the raw value — honest rather than guessed.
 */
export function describeMimeType(mimeType: string): string {
  const mapped = MIME_DESCRIPTIONS[mimeType];
  if (mapped !== undefined) return mapped;
  if (mimeType.startsWith('image/')) {
    return `${labelFor(mimeType.slice('image/'.length))} image`;
  }
  if (mimeType.startsWith('text/')) {
    return `${labelFor(mimeType.slice('text/'.length))} file`;
  }
  if (mimeType.startsWith('audio/')) {
    return `${labelFor(mimeType.slice('audio/'.length))} audio`;
  }
  if (mimeType.startsWith('video/')) {
    return `${labelFor(mimeType.slice('video/'.length))} video`;
  }
  return mimeType;
}

/** Subtype → friendly label ("svg+xml" → "SVG+XML"). */
function labelFor(subtype: string): string {
  if (subtype.length === 0) return 'unknown';
  return subtype.toUpperCase();
}
