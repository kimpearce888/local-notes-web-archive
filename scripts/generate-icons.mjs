/**
 * Deterministic icon generator (plan T-013): renders the extension mark as
 * PNG at 16/32/48/128 px with pure integer geometry and 4x supersampling —
 * no randomness, no external assets, no network. Running the script twice
 * produces byte-identical files, which tests enforce against the committed
 * copies.
 *
 * Design: an indigo rounded-square badge, a white note card with three text
 * lines, and an amber reminder dot pinned to the card's top-right corner.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ---------------------------- PNG encoder ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ Geometry ------------------------------ */

const INDIGO = [46, 79, 163];
const WHITE = [255, 255, 255];
const AMBER = [245, 166, 35];

/** Inside test for an axis-aligned rounded rectangle (normalized coords). */
function inRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + radius - x, x - (x1 - radius), 0);
  const dy = Math.max(y0 + radius - y, y - (y1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inCircle(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Render the mark into an RGBA buffer of the given integer resolution.
 * Geometry is expressed in normalized 0..1 coordinates so the design scales
 * with size; nothing depends on time, locale or randomness.
 */
export function renderMarkRGBA(size) {
  const out = new Uint8Array(size * size * 4);
  // Note card (centered, 60% wide, 52% tall).
  const card = { x0: 0.2, y0: 0.24, x1: 0.8, y1: 0.76, r: 0.09 };
  // Three text lines on the card: long, medium, short.
  const lines = [
    { x0: 0.27, x1: 0.73, y: 0.365 },
    { x0: 0.27, x1: 0.58, y: 0.475 },
    { x0: 0.27, x1: 0.44, y: 0.585 },
  ];
  const lineHalf = 0.032;
  // Reminder dot pinned over the card's top-right corner.
  const dot = { cx: 0.775, cy: 0.245, r: 0.115 };
  const dotRing = { cx: 0.775, cy: 0.245, r: 0.155 };
  const badge = { x0: 0, y0: 0, x1: 1, y1: 1, r: 0.225 };

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;
      const onBadge = inRoundedRect(x, y, badge.x0, badge.y0, badge.x1, badge.y1, badge.r);
      const onCard = onBadge && inRoundedRect(x, y, card.x0, card.y0, card.x1, card.y1, card.r);
      const onLine =
        onCard &&
        lines.some(
          (line) =>
            x >= line.x0 && x <= line.x1 && y >= line.y - lineHalf && y <= line.y + lineHalf,
        );
      const onDotRing = onBadge && inCircle(x, y, dotRing.cx, dotRing.cy, dotRing.r);
      const onDot = onBadge && inCircle(x, y, dot.cx, dot.cy, dot.r);
      let color;
      if (!onBadge) color = [0, 0, 0];
      else if (onDot) color = AMBER;
      else if (onDotRing) color = WHITE;
      else if (onLine) color = INDIGO;
      else if (onCard) color = WHITE;
      else color = INDIGO;
      const i = (py * size + px) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Full deterministic pipeline: supersample, downsample, encode PNG. */
export function renderIconPng(size) {
  const factor = 4;
  const ss = renderMarkRGBA(size * factor);
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy += 1) {
          for (let dx = 0; dx < factor; dx += 1) {
            const i = ((y * factor + dy) * size * factor + x * factor + dx) * 4 + c;
            sum += ss[i];
          }
        }
        rgba[(y * size + x) * 4 + c] = Math.round(sum / (factor * factor));
      }
    }
  }
  return encodePng(size, size, rgba);
}

export const ICON_SIZES = [16, 32, 48, 128];

/* ------------------------------- CLI ---------------------------------- */

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  const outDir = join(process.cwd(), 'public', 'icons');
  mkdirSync(outDir, { recursive: true });
  for (const size of ICON_SIZES) {
    const png = renderIconPng(size);
    const file = join(outDir, `icon-${size}.png`);
    writeFileSync(file, png);
    console.log(`[icons] wrote ${file} (${png.length} bytes)`);
  }
}
