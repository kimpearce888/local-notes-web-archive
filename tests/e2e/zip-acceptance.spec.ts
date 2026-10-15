import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

/**
 * T-046 ZIP package acceptance: the release ZIP IS the product. This spec
 * treats it exactly like the user workflow does — Download ZIP → Extract →
 * Open Chrome → Load Unpacked → Use Extension — with no build steps and no
 * access to dist/: the extension is loaded from the EXTRACTED folder.
 *
 * Verified surfaces: extraction inventory matches RELEASE_MANIFEST.txt byte
 * for byte; installation succeeds (service worker starts, stable extension
 * id from the manifest key); the background RPC channel works end to end
 * (dashboard shell, note create → autosave → search, settings dialog with a
 * live theme switch — storage/settings persistence through IndexedDB); no
 * console/page errors and zero non-loopback network requests. Since v1.0.10
 * the suite also carries the T-103 alignment ground truth: the sidebar
 * actions and the settings dialog's direct panel actions read as one
 * left-aligned column in the EXTRACTED build too.
 *
 * Honest surface mapping (no popup, no declared content scripts by design,
 * PRD §8): the manifest's action opens the dashboard through the service
 * worker (the toolbar-click path is unit-tested in dashboard-tab.test.ts)
 * and capture injects through the `scripting`/`pageCapture`/`debugger`
 * permissions rather than persistent content scripts — the manifest itself
 * is asserted here to keep that contract visible.
 */

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const releaseDir = join(rootDir, 'release');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

const version = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version as string;
const zipPath = join(releaseDir, `local-notes-web-archive-${version}.zip`);

/** The extracted package — created once, loaded as the unpacked extension. */
const extractDir = mkdtempSync(join(tmpdir(), 'lnwa-zip-acceptance-'));

let context: BrowserContext;
let page: Page;

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const externalRequests: string[] = [];

function isLocalUrl(url: string): boolean {
  if (
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('devtools://') ||
    url.startsWith('about:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return true;
  }
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  if (!existsSync(zipPath)) {
    throw new Error(`release zip missing — run "npm run release" first (${zipPath})`);
  }
  // The user's Extract step, done programmatically (fflate is a dev-side
  // tool; the extension itself never needs it).
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  for (const [name, bytes] of Object.entries(entries)) {
    const target = join(extractDir, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, bytes);
  }
});

test.afterAll(async () => {
  if (context) await context.close();
});

test('the extracted package matches RELEASE_MANIFEST.txt byte for byte', () => {
  const manifestText = readFileSync(join(releaseDir, 'RELEASE_MANIFEST.txt'), 'utf8');
  const inventory = new Map<string, number>();
  for (const line of manifestText.split('\n')) {
    const match = /^ {2}(.+) \((\d+) bytes\)$/.exec(line);
    if (match) inventory.set(match[1] ?? '', Number.parseInt(match[2] ?? '0', 10));
  }
  expect(inventory.size).toBeGreaterThanOrEqual(10);

  const extracted: string[] = [];
  (function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else extracted.push(full.slice(extractDir.length + 1).replaceAll('\\', '/'));
    }
  })(extractDir);

  // Every inventoried file exists in the extraction with the exact size.
  for (const [name, size] of inventory) {
    const full = join(extractDir, name);
    expect(existsSync(full), `inventory file missing from extraction: ${name}`).toBe(true);
    expect(statSync(full).size, `size mismatch for ${name}`).toBe(size);
  }
  // And nothing extra shipped in the zip.
  expect(new Set(extracted)).toEqual(new Set(inventory.keys()));
});

test('the extracted manifest declares the production surface honestly', () => {
  const manifest = JSON.parse(readFileSync(join(extractDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  expect(manifest['manifest_version']).toBe(3);
  expect(manifest['name']).toBe('Local Notes & Web Archive');
  expect(manifest['version']).toBe(version);
  expect(manifest['minimum_chrome_version']).toBe('120');
  // No popup by design: the action opens the dashboard through the worker.
  const action = manifest['action'] as Record<string, unknown> | undefined;
  expect(action?.['default_popup']).toBeUndefined();
  // No declared content scripts: capture injects via scripting/pageCapture.
  expect(manifest['content_scripts']).toBeUndefined();
  // Stable id: the public key is present so the extension id survives
  // reinstall (docs/EXTENSION_IDENTITY.md).
  expect(typeof manifest['key']).toBe('string');
  // Icons are real PNGs in the extraction.
  const icons = (manifest['icons'] ?? {}) as Record<string, string>;
  for (const iconPath of Object.values(icons)) {
    const bytes = readFileSync(join(extractDir, iconPath));
    expect(bytes.subarray(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  }
});

test('the extracted folder installs and the full stack works with zero build steps', async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extractDir}`,
      `--load-extension=${extractDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
  });
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  context.on('request', (request) => {
    if (!isLocalUrl(request.url())) externalRequests.push(request.url());
  });

  // Installation: the service worker of the EXTRACTED extension is alive.
  const deadline = Date.now() + 30_000;
  let extensionId: string | undefined;
  for (;;) {
    const [worker] = context.serviceWorkers();
    if (worker) {
      extensionId = new URL(worker.url()).host;
      break;
    }
    if (Date.now() > deadline) throw new Error('extracted extension service worker never started');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  // Background scripts work: the dashboard binds to the worker over the real
  // RPC channel (this is exactly the surface the toolbar action opens).
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });

  // First-run onboarding over the extracted build, then dismiss it.
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Skip for now' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });

  // Advertised feature: notes — create, edit, durable autosave.
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101 (shipped in this artifact since v1.0.9): creation navigates
  // straight into the fresh note's editor.
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.locator('.editor-panel__title').fill('Extracted Package Note');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('written from the extracted release zip');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

  // Advertised feature: search finds it through the rebuilt index.
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.locator('#search-input').fill('Extracted Package');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open Extracted Package Note for editing' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');

  // Advertised feature: settings/storage — a live theme switch persists
  // through IndexedDB in the extracted build.
  //
  // T-103 (shipped in this artifact since v1.0.10): the alignment ground
  // truth belongs in the acceptance suite — the extracted package must read
  // as ONE left-aligned column, exactly like the unpacked dist/ build the
  // dedicated regression suite measures pixel by pixel.
  const sidebarActions = await page.evaluate(() => {
    const out: Array<{ text: string; justify: string }> = [];
    for (const button of document.querySelectorAll('.app-sidebar button')) {
      const isAction =
        button.classList.contains('sidebar__new-note') ||
        button.classList.contains('sidebar__save-page') ||
        button.classList.contains('sidebar__footer-button');
      if (isAction) {
        out.push({ text: (button.textContent ?? '').trim(), justify: getComputedStyle(button).justifyContent });
      }
    }
    return out;
  });
  expect(sidebarActions.length, 'the five sidebar action buttons').toBe(5);
  for (const action of sidebarActions) {
    expect(
      action.justify,
      `${action.text} must be left-aligned in the extracted build`,
    ).toBe('flex-start');
  }

  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('.settings__panel').waitFor({ state: 'visible', timeout: 15_000 });
  const settingsActions = await dialog.evaluate((root: HTMLElement) => {
    const panel = root.querySelector('.settings__panel');
    if (!panel) throw new Error('settings panel never mounted');
    const panelLeft = panel.getBoundingClientRect().left;
    return Array.from(panel.children)
      .filter((child): child is HTMLElement => child.tagName === 'BUTTON')
      .map((button) => ({
        text: (button.textContent ?? '').trim(),
        leftGap: Math.round(button.getBoundingClientRect().left - panelLeft),
        width: Math.round(button.getBoundingClientRect().width),
        panelWidth: Math.round(panel.getBoundingClientRect().width),
        justify: getComputedStyle(button).justifyContent,
      }));
  });
  // "Test connection" and "Show the introduction again" — the two direct
  // panel actions (all other buttons live inside rows).
  expect(settingsActions.map((action) => action.text)).toEqual([
    'Test connection',
    'Show the introduction again',
  ]);
  for (const action of settingsActions) {
    expect(action.justify, `${action.text} must be left-aligned`).toBe('flex-start');
    expect(action.leftGap, `${action.text} must sit flush with the panel's left edge`).toBe(0);
    expect(
      action.width,
      `${action.text} must shrink to its content (was stretched full-width centered)`,
    ).toBeLessThan(action.panelWidth * 0.6);
  }
  await dialog.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.locator('#live-region')).toContainText('Settings saved.', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 15_000 });
  // Returning user of the extracted build: onboarding stays dismissed.
  await expect(page.locator('dialog.dialog--onboarding')).not.toBeVisible();
});

test('the extracted build runs clean: no errors, no external requests', () => {
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(externalRequests, `external network requests: ${externalRequests.join(' | ')}`).toEqual([]);
});
