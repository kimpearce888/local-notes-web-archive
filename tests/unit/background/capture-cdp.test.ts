import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, addTab, type InstalledMock } from './chrome-mock';
import {
  CDP_ALLOWLIST,
  CdpCommandNotAllowedError,
  MAX_TILES,
  capturePngArtifact,
  planTiles,
  sendCdpCommand,
  type StitchedTile,
  type TileStitcher,
} from '../../../src/background/capture/cdp';
import { DEFAULT_SETTINGS } from '../../../src/core/repo/settings';
import { closeWorkerResources } from '../../../src/background/db';
import { DB_NAME } from '../../../src/core/version';

/**
 * T-025 CDP full-page PNG (FR-CAP-10, §15): hard command allowlist, pure
 * tiling math under the pixel budget, guaranteed debugger detach, honest
 * failure states. The pipeline-level integration (snapshot record fields,
 * per-artifact survival) lives in capture-steps.test.ts.
 */

let installed: InstalledMock;

beforeEach(() => {
  installed = installChromeMock();
});

afterEach(async () => {
  await closeWorkerResources();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  installed.uninstall();
});

const pngSettings = () => DEFAULT_SETTINGS;

describe('CDP command allowlist (PRD §9/§15)', () => {
  it('allows exactly the two screenshot commands', () => {
    expect([...CDP_ALLOWLIST]).toEqual(['Page.getLayoutMetrics', 'Page.captureScreenshot']);
  });

  it('refuses non-allowlisted commands before they reach chrome.debugger', async () => {
    const tabId = addTab(installed, 'https://example.com/a');
    for (const forbidden of [
      'Network.getCookies',
      'Network.getRequestPostData',
      'Storage.getCookies',
      'Runtime.evaluate',
      'Page.navigate',
      'DOM.getDocument',
      'Emulation.setUserAgentOverride',
    ]) {
      await expect(sendCdpCommand(tabId, forbidden as never)).rejects.toBeInstanceOf(CdpCommandNotAllowedError);
    }
    // Nothing but allowlisted methods ever reached the debugger.
    expect(installed.debugger.commands).toEqual([]);
    expect(installed.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it('refuses even stringly-typed allowlist bypasses at runtime', async () => {
    const tabId = addTab(installed, 'https://example.com/a');
    await expect(
      sendCdpCommand(tabId, 'Page.captureScreenshot\u0000.evil' as never),
    ).rejects.toBeInstanceOf(CdpCommandNotAllowedError);
  });
});

describe('tiling math (planTiles)', () => {
  it('plans a single full-page shot when the page fits the budget', () => {
    const plan = planTiles({ contentWidth: 1200, contentHeight: 800 }, 100_000_000);
    expect(plan).toEqual({
      tiles: [{ x: 0, y: 0, width: 1200, height: 800 }],
      full: { contentWidth: 1200, contentHeight: 800 },
    });
  });

  it('slices tall pages into vertical bands under the budget', () => {
    // 1200 * 6000 = 7.2M pixels; budget 2.4M → band height 2000 → 3 bands.
    const plan = planTiles({ contentWidth: 1200, contentHeight: 6000 }, 2_400_000);
    expect('tiles' in plan).toBe(true);
    if ('tiles' in plan) {
      expect(plan.tiles).toHaveLength(3);
      expect(plan.tiles[0]).toEqual({ x: 0, y: 0, width: 1200, height: 2000 });
      expect(plan.tiles[1]).toEqual({ x: 0, y: 2000, width: 1200, height: 2000 });
      expect(plan.tiles[2]).toEqual({ x: 0, y: 4000, width: 1200, height: 2000 });
    }
  });

  it('shortens the last band to the remaining page height', () => {
    // Band height 2000, page height 4500 → bands of 2000 + 2000 + 500.
    const plan = planTiles({ contentWidth: 1200, contentHeight: 4500 }, 2_400_000);
    expect('tiles' in plan).toBe(true);
    if ('tiles' in plan) {
      expect(plan.tiles).toHaveLength(3);
      expect(plan.tiles[2]!.height).toBe(500);
    }
  });

  it('refuses pages wider than the entire pixel budget', () => {
    const plan = planTiles({ contentWidth: 1_200_000, contentHeight: 800 }, 1_000_000);
    expect(plan).toMatchObject({ refused: true });
    expect((plan as { reason: string }).reason).toContain('wider than');
  });

  it('tiles pages that are wide but still within the budget', () => {
    // 5000 wide, budget 1M: band height floor(1M/5000) = 200 → 4 bands.
    const plan = planTiles({ contentWidth: 5000, contentHeight: 800 }, 1_000_000);
    expect('tiles' in plan).toBe(true);
    if ('tiles' in plan) {
      expect(plan.tiles).toHaveLength(4);
      expect(plan.tiles.every((t) => t.height === 200)).toBe(true);
    }
  });

  it('refuses pages needing more bands than the cap', () => {
    // Band height 1000, page height (MAX_TILES + 1) * 1000 → too many bands.
    const height = (MAX_TILES + 1) * 1000;
    const plan = planTiles({ contentWidth: 1000, contentHeight: height }, 1_000_000);
    expect(plan).toMatchObject({ refused: true });
    expect((plan as { reason: string }).reason).toContain(`${MAX_TILES + 1} screenshot bands`);
  });

  it('refuses degenerate layouts and non-positive budgets', () => {
    expect(planTiles({ contentWidth: 0, contentHeight: 100 }, 1e6)).toMatchObject({ refused: true });
    expect(planTiles({ contentWidth: -5, contentHeight: 100 }, 1e6)).toMatchObject({ refused: true });
    expect(planTiles({ contentWidth: 100, contentHeight: 100 }, 0)).toMatchObject({ refused: true });
  });
});

describe('capturePngArtifact', () => {
  it('captures a single-shot full-page PNG and detaches', async () => {
    const tabId = addTab(installed, 'https://example.com/shot');
    installed.debugger.setLayout(1200, 800);

    const result = await capturePngArtifact(tabId, pngSettings());

    expect(result.png).not.toBeNull();
    expect(result.warnings).toEqual([]);
    const bytes = new Uint8Array(await result.png!.arrayBuffer());
    // PNG magic bytes round-trip from the base64 CDP payload.
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(result.detail).toContain('1 band');

    expect(installed.debugger.commands.map((c) => c.method)).toEqual([
      'Page.getLayoutMetrics',
      'Page.captureScreenshot',
    ]);
    expect(installed.debugger.attach).toHaveBeenCalledWith({ tabId }, '1.3');
    expect(installed.debugger.detach).toHaveBeenCalledWith({ tabId });
  });

  it('the screenshot clip asks for the full inactive-tab page', async () => {
    const tabId = addTab(installed, 'https://example.com/clip');
    installed.debugger.setLayout(1024, 768);
    await capturePngArtifact(tabId, pngSettings());

    const call = installed.debugger.sendCommand.mock.calls.find(
      (c) => c[1] === 'Page.captureScreenshot',
    );
    const params = (call?.[2] ?? {}) as Record<string, unknown>;
    expect(params['format']).toBe('png');
    expect(params['captureBeyondViewport']).toBe(true);
    expect(params['clip']).toEqual({ x: 0, y: 0, width: 1024, height: 768, scale: 1 });
  });

  it('tiles a tall page and stitches the bands', async () => {
    const tabId = addTab(installed, 'https://example.com/tall');
    installed.debugger.setLayout(1200, 6000);
    const settings = {
      ...pngSettings(),
      capture: { ...pngSettings().capture, maxScreenshotPixels: 2_400_000 },
    };

    const seen: StitchedTile[] = [];
    const stitch: TileStitcher = async (tiles, full) => {
      seen.push(...tiles);
      expect(full).toEqual({ contentWidth: 1200, contentHeight: 6000 });
      return new Blob([new Uint8Array(seen.length)], { type: 'image/png' });
    };
    const result = await capturePngArtifact(tabId, settings, { stitchTiles: stitch });

    expect(seen).toHaveLength(3);
    expect(seen.map((t) => t.tile.y)).toEqual([0, 2000, 4000]);
    expect(seen.every((t) => t.tile.width === 1200 && t.tile.height === 2000)).toBe(true);
    expect(result.png).not.toBeNull();
    expect(result.png!.size).toBe(3);
    expect(result.detail).toContain('3 bands');
    const methods = installed.debugger.commands.map((c) => c.method);
    expect(methods).toEqual([
      'Page.getLayoutMetrics',
      'Page.captureScreenshot',
      'Page.captureScreenshot',
      'Page.captureScreenshot',
    ]);
  });

  it('fails truthfully when attaching is refused (enterprise policy, conflicts)', async () => {
    const tabId = addTab(installed, 'https://example.com/protected');
    installed.debugger.failNextAttach('Cannot attach to this target');

    const result = await capturePngArtifact(tabId, pngSettings());

    expect(result.png).toBeNull();
    expect(result.warnings).toEqual([
      expect.objectContaining({ kind: 'screenshot-limits', detail: expect.stringContaining('Cannot attach') }),
    ]);
    expect(installed.debugger.commands).toEqual([]);
  });

  it('fails truthfully when a screenshot band fails, and still detaches', async () => {
    const tabId = addTab(installed, 'https://example.com/flaky');
    installed.debugger.setLayout(1200, 800);
    installed.debugger.failNextCommand('Page.captureScreenshot', 'Cannot access the page');

    const result = await capturePngArtifact(tabId, pngSettings());

    expect(result.png).toBeNull();
    expect(result.warnings[0]?.kind).toBe('screenshot-limits');
    expect(result.warnings[0]?.detail).toContain('Cannot access the page');
    expect(installed.debugger.detach).toHaveBeenCalledWith({ tabId });
  });

  it('fails truthfully when layout metrics are unusable', async () => {
    const tabId = addTab(installed, 'https://example.com/nometrics');
    // Degenerate layout → getLayoutMetrics responds, but unusable values
    // are simulated by a width of 0 through the mock's layout state.
    installed.debugger.setLayout(0, 0);

    const result = await capturePngArtifact(tabId, pngSettings());

    expect(result.png).toBeNull();
    expect(result.warnings[0]?.kind).toBe('screenshot-limits');
  });

  it('refuses PNGs over the byte budget', async () => {
    const tabId = addTab(installed, 'https://example.com/hugepng');
    installed.debugger.setLayout(1200, 800);
    const settings = {
      ...pngSettings(),
      capture: { ...pngSettings().capture, maxArchiveBytes: 1024 },
    };
    const stitch: TileStitcher = async () => new Blob([new Uint8Array(4096)], { type: 'image/png' });

    const result = await capturePngArtifact(tabId, settings, { stitchTiles: stitch });

    expect(result.png).toBeNull();
    expect(result.warnings[0]?.kind).toBe('screenshot-limits');
    expect(result.warnings[0]?.detail).toContain('exceeds the size budget');
  });

  it('refuses layouts beyond the pixel budget with a truthful reason', async () => {
    const tabId = addTab(installed, 'https://example.com/wide');
    installed.debugger.setLayout(1_200_000, 800);
    const settings = {
      ...pngSettings(),
      capture: { ...pngSettings().capture, maxScreenshotPixels: 1_000_000 },
    };

    const result = await capturePngArtifact(tabId, settings);

    expect(result.png).toBeNull();
    expect(result.warnings[0]?.detail).toContain('wider than');
    // No screenshot was attempted once the plan was refused.
    expect(installed.debugger.commands.map((c) => c.method)).toEqual(['Page.getLayoutMetrics']);
  });

  it('never activates the tab or issues non-screenshot commands', async () => {
    const tabId = addTab(installed, 'https://example.com/quiet');
    installed.debugger.setLayout(1200, 800);
    await capturePngArtifact(tabId, pngSettings());

    const tab = installed.tabs.get(tabId);
    expect(tab?.active).toBe(false); // never activated for the screenshot
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(
      installed.debugger.commands.every((c) =>
        (CDP_ALLOWLIST as readonly string[]).includes(c.method),
      ),
    ).toBe(true);
  });
});
