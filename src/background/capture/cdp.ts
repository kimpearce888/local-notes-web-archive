/**
 * Full-page PNG capture through the Chrome DevTools Protocol (FR-CAP-10,
 * PRD §9/§15) — the explicit `debugger` permission trade-off.
 *
 * Security posture (this is the whole point of the module):
 *
 * - The temporary CAPTURE TAB ONLY is ever attached — never the user's
 *   tabs, never other extensions, never the service worker itself.
 * - HARD COMMAND ALLOWLIST: `Page.getLayoutMetrics` and
 *   `Page.captureScreenshot`, nothing else. `sendCdpCommand` refuses any
 *   other method BEFORE it reaches chrome.debugger — cookies, network
 *   bodies, storage, runtime evaluation are structurally unreachable.
 * - The tab is never activated for the screenshot (clip +
 *   captureBeyondViewport on the inactive tab).
 * - `detach` runs in a `finally` path and is idempotent, so no capture can
 *   leak an attached debugger.
 *
 * Tiling (PRD §15): very tall pages are captured as vertical bands sized
 * so each screenshot stays within the configured pixel budget, then
 * stitched. Pages too wide for the budget, or requiring an unreasonable
 * number of tiles, are refused with a truthful `screenshot-limits`
 * warning — the MHTML archive and extracted text are unaffected.
 */

import type { AppSettings, CaptureWarning } from '../../core/types';

/** The ONLY CDP commands this module may ever issue. */
export const CDP_ALLOWLIST = ['Page.getLayoutMetrics', 'Page.captureScreenshot'] as const;

export type AllowedCdpCommand = (typeof CDP_ALLOWLIST)[number];

export class CdpCommandNotAllowedError extends Error {
  constructor(readonly method: string) {
    super(`CDP command not allowed: ${method}`);
    this.name = 'CdpCommandNotAllowedError';
  }
}

/** Send one allowlisted CDP command to the capture tab. */
export async function sendCdpCommand(
  tabId: number,
  method: AllowedCdpCommand,
  params?: Record<string, unknown>,
): Promise<object | undefined> {
  if (!CDP_ALLOWLIST.includes(method)) {
    // Belt and braces: the type system already prevents non-allowlisted
    // calls — this guard also covers stringly-typed callers at runtime.
    throw new CdpCommandNotAllowedError(method);
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

/* ------------------------------------------------------------------ */
/* Tiling math (pure — exhaustively unit tested)                       */
/* ------------------------------------------------------------------ */

export interface PageLayout {
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export interface Tile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TilePlan {
  readonly tiles: readonly Tile[];
  readonly full: PageLayout;
}

export interface RefusedPlan {
  readonly refused: true;
  readonly reason: string;
}

/** Upper bound on band captures before the page is declared untileable. */
export const MAX_TILES = 20;

/**
 * Plan the screenshot tiles for a page layout under a pixel budget:
 * - one full-page shot when `width * height` fits the budget;
 * - vertical bands of `floor(budget / width)` pixels otherwise;
 * - refusal (never silent downsampling) when the width alone exceeds the
 *   budget, the page is degenerate, or tiling would need too many bands.
 */
export function planTiles(layout: PageLayout, maxPixels: number): TilePlan | RefusedPlan {
  const { contentWidth: width, contentHeight: height } = layout;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { refused: true, reason: `the page layout is unusable (${width}x${height})` };
  }
  if (maxPixels <= 0) {
    return { refused: true, reason: 'the screenshot pixel budget is zero' };
  }
  const totalPixels = width * height;
  if (totalPixels <= maxPixels) {
    return { tiles: [{ x: 0, y: 0, width, height }], full: layout };
  }
  if (width > maxPixels) {
    return {
      refused: true,
      reason: `the page is ${width} pixels wide, wider than the entire ${maxPixels}-pixel screenshot budget`,
    };
  }
  const bandHeight = Math.floor(maxPixels / width);
  if (bandHeight <= 0) {
    return { refused: true, reason: 'the screenshot pixel budget is too small for one row' };
  }
  const tileCount = Math.ceil(height / bandHeight);
  if (tileCount > MAX_TILES) {
    return {
      refused: true,
      reason: `the page would need ${tileCount} screenshot bands (max ${MAX_TILES})`,
    };
  }
  const tiles: Tile[] = [];
  for (let index = 0; index < tileCount; index += 1) {
    const y = index * bandHeight;
    const tileHeight = Math.min(bandHeight, height - y);
    tiles.push({ x: 0, y, width, height: tileHeight });
  }
  return { tiles, full: layout };
}

/* ------------------------------------------------------------------ */
/* Stitching                                                           */
/* ------------------------------------------------------------------ */

export interface StitchedTile {
  readonly png: Blob;
  readonly tile: Tile;
}

export type TileStitcher = (tiles: readonly StitchedTile[], full: PageLayout) => Promise<Blob>;

/**
 * Production stitcher: single tiles pass through untouched; multi-tile
 * pages are composed on an OffscreenCanvas in the service worker.
 */
export const offscreenCanvasStitcher: TileStitcher = async (tiles, full) => {
  if (tiles.length === 1) return tiles[0]!.png;
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is unavailable in this worker');
  }
  const canvas = new OffscreenCanvas(full.contentWidth, full.contentHeight);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('the 2D canvas context is unavailable');
  for (const { png, tile } of tiles) {
    const bitmap = await createImageBitmap(png);
    try {
      context.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height);
    } finally {
      bitmap.close();
    }
  }
  return canvas.convertToBlob({ type: 'image/png' });
};

/* ------------------------------------------------------------------ */
/* The PNG capture step                                                */
/* ------------------------------------------------------------------ */

export interface PngCaptureResult {
  readonly png: Blob | null;
  readonly warnings: CaptureWarning[];
  readonly detail: string;
}

interface CdpLayoutMetrics {
  contentSize?: { x?: number; y?: number; width?: number; height?: number };
  cssVisualViewport?: { width?: number; height?: number };
  cssLayoutViewport?: { width?: number; height?: number };
}

function layoutFromMetrics(metrics: object | undefined): PageLayout | null {
  const m = (metrics ?? {}) as CdpLayoutMetrics;
  const size = m.contentSize ?? m.cssVisualViewport ?? m.cssLayoutViewport;
  if (size === undefined) return null;
  const { width, height } = size;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return { contentWidth: width, contentHeight: height };
}

/** Decode a CDP base64 screenshot payload into PNG bytes. */
function decodeBase64Png(data: unknown): Blob {
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('captureScreenshot returned no image data');
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * Capture a full-page PNG of the (inactive) capture tab.
 * Attach → metrics → plan → (tiled) screenshots → stitch → detach(finally).
 * Failures return a truthful result with warnings — they never throw.
 */
export async function capturePngArtifact(
  tabId: number,
  settings: AppSettings,
  options: { stitchTiles?: TileStitcher } = {},
): Promise<PngCaptureResult> {
  const stitch: TileStitcher = options.stitchTiles ?? offscreenCanvasStitcher;
  const warnings: CaptureWarning[] = [];
  const target = { tabId };

  const fail = (detail: string, warningDetail: string): PngCaptureResult => {
    warnings.push({ kind: 'screenshot-limits', detail: warningDetail });
    return { png: null, warnings, detail };
  };

  let attached = false;
  try {
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(
        `the screenshot could not be started (${reason})`,
        `attaching the debugger failed: ${reason}`,
      );
    }

    const metrics = await sendCdpCommand(tabId, 'Page.getLayoutMetrics');
    const layout = layoutFromMetrics(metrics);
    if (layout === null) {
      return fail(
        'the page layout could not be measured',
        'Page.getLayoutMetrics returned no usable content size',
      );
    }

    const plan = planTiles(layout, settings.capture.maxScreenshotPixels);
    if ('refused' in plan) {
      return fail(`the page exceeds the screenshot limits (${plan.reason})`, plan.reason);
    }

    const tiles: StitchedTile[] = [];
    for (const tile of plan.tiles) {
      const result = (await sendCdpCommand(tabId, 'Page.captureScreenshot', {
        format: 'png',
        clip: { x: tile.x, y: tile.y, width: tile.width, height: tile.height, scale: 1 },
        captureBeyondViewport: true,
      })) as { data?: unknown } | undefined;
      try {
        tiles.push({ png: decodeBase64Png(result?.data), tile });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fail(
          `a screenshot band failed (${reason})`,
          `captureScreenshot failed: ${reason}`,
        );
      }
    }

    let png: Blob;
    try {
      png = await stitch(tiles, plan.full);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(`stitching the screenshot failed (${reason})`, `stitching failed: ${reason}`);
    }

    const byteBudget = settings.capture.maxArchiveBytes;
    if (png.size > byteBudget) {
      return fail(
        `the PNG (${png.size} bytes) exceeds the capture size budget (${byteBudget} bytes)`,
        `the PNG (${png.size} bytes) exceeds the size budget (${byteBudget} bytes)`,
      );
    }
    if (png.size === 0) {
      return fail('the PNG was empty', 'captureScreenshot produced an empty image');
    }

    return { png, warnings, detail: `full-page PNG captured (${png.size} bytes, ${plan.tiles.length} band${plan.tiles.length === 1 ? '' : 's'})` };
  } catch (error) {
    // Any unexpected failure (sendCommand rejection, detach mid-capture,
    // enterprise policy) — the MHTML archive and text are unaffected.
    const reason = error instanceof Error ? error.message : String(error);
    return fail(`the screenshot failed (${reason})`, `CDP failure: ${reason}`);
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // Already detached (tab closed, DevTools opened) — nothing to do.
      }
    }
  }
}
