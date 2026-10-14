/**
 * HEIC/HEIF inline-photo support (T-086, T-084 register UX-07 + UX-15).
 *
 * Chrome does not render HEIC/HEIF inside <img> in any version (Safari is
 * the only browser that does), and the insert-image file picker previously
 * omitted the formats entirely — so iPhone photos (the default camera
 * format) were greyed out in the OS picker and "inserting a picture from
 * the PC" did nothing for exactly the users who take the most photos.
 *
 * This module is the single conversion choke point for EVERY local-image
 * path (dialog picker, drag-and-drop, clipboard paste): HEIC/HEIF files
 * are decoded locally through the pinned heic-to decoder (LGPL-3.0;
 * libheif + libde265 compiled to plain asm.js with NO dynamic evaluation —
 * no eval, no new Function, no WebAssembly — chosen precisely so the
 * extension's strict manifest CSP needs no change) and inserted as JPEG,
 * which every Chromium build renders. The original file can still be
 * attached verbatim through the attachments panel.
 *
 * Packaging note: heic-to runs its decoder inside a Web Worker created
 * from a blob: URL, which MV3 extension pages cannot do. The build
 * (vite.config.ts) extracts the embedded worker verbatim into the
 * extension file dist/heic-decoder-worker.js and redirects the bootstrap
 * to the extension's own origin (allowed under script-src 'self'); the
 * decode therefore never blocks the dashboard's main thread.
 */

/**
 * The accept list for every image file picker: the formats Chromium renders
 * natively plus HEIC/HEIF (MIME types AND extensions — Windows/Android
 * pickers key off extensions, macOS off MIME).
 */
export const IMAGE_ACCEPT_LIST =
  'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/heic,image/heif,.heic,.heif';

/** MIME + extension detection (pickers on some OSes hand out empty MIME). */
export function looksLikeHeic(file: Pick<File, 'type' | 'name'>): boolean {
  if (file.type === 'image/heic' || file.type === 'image/heif') return true;
  return /\.(heic|heif)$/i.test(file.name);
}

export type HeicConversion =
  | { ok: true; file: File }
  | { ok: false; message: string };

/**
 * Convert one HEIC/HEIF file to JPEG locally. Pure transformation: no
 * storage writes, no editor mutations — callers own the pipeline.
 */
export async function convertHeicToJpeg(file: File): Promise<HeicConversion> {
  try {
    const heicTo = await loadDecoder();
    const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
    if (!(blob instanceof Blob) || blob.size === 0) {
      return {
        ok: false,
        message: `${file.name} could not be decoded as a HEIC/HEIF image.`,
      };
    }
    const name = `${file.name.replace(/\.(heic|heif)$/i, '')}.jpg`;
    return {
      ok: true,
      file: new File([blob], name, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      }),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return {
      ok: false,
      message: `Reading ${file.name} as a HEIC/HEIF photo failed: ${detail}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Decoder loading                                                     */
/* ------------------------------------------------------------------ */

type HeicTo = (args: {
  blob: Blob;
  type: 'image/jpeg';
  quality?: number;
}) => Promise<Blob>;

let decoderPromise: Promise<HeicTo> | null = null;

/**
 * Lazy dynamic import: the heic-to wrapper chunk (~10 kB after the build
 * strips its embedded worker) loads only when the first HEIC photo is
 * inserted; the ~3.1 MB decoder itself is the separate extension file
 * dist/heic-decoder-worker.js, instantiated as a dedicated Worker by the
 * build-time transform (blob: worker scripts are CSP-blocked on MV3
 * extension pages) so the decode never blocks the main thread.
 */
function loadDecoder(): Promise<HeicTo> {
  decoderPromise ??= (async () => {
    const { heicTo } = await import('heic-to/csp');
    return heicTo as HeicTo;
  })();
  return decoderPromise;
}
