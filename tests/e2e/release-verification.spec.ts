import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-043 release verification measurements (plan.md, PRD §11/§13.12):
 *
 *   - dashboard shell time, cold (clean profile) and warm (reloads with
 *     data present), measured in a real persistent Chromium context
 *   - accessibility keyboard pass: onboarding dismissal, keyboard-only
 *     note creation with rich-text formatting, dialog focus containment,
 *     Escape close, and a visible focus ring on keyboard focus
 *
 * Timings are printed with a [perf] prefix and recorded in
 * docs/RELEASE_VERIFICATION.md. Guards assert regression headroom; the
 * PRD targets (shell < 1.5 s) are documented against the measured values.
 */

const distDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist');

test.setTimeout(90_000);
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let extensionId: string;

async function serviceWorkerURL(ctx: BrowserContext): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const [worker] = ctx.serviceWorkers();
    if (worker) return worker.url();
    if (Date.now() > deadline) throw new Error('extension service worker never started');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

test.beforeAll(async () => {
  if (!existsSync(join(distDir, 'manifest.json'))) {
    throw new Error(`dist/ is not built — run "npm run build" first (${distDir})`);
  }
  context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
  });
  const workerUrl = await serviceWorkerURL(context);
  extensionId = new URL(workerUrl).host;
  page = await context.newPage();
  page.on('pageerror', (error) => {
    console.error(`[dashboard pageerror] ${error.message}`);
  });
});

test.afterAll(async () => {
  await context.close();
});

/** Navigate to the dashboard and time until the shell predicate holds. */
async function measureShell(): Promise<number> {
  const started = Date.now();
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`, { waitUntil: 'commit' });
  await page.waitForFunction(
    () => {
      const heading = document.querySelector('h1');
      const newNote = Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === 'New Note',
      );
      const search = document.querySelector('#search-input');
      return Boolean(heading && newNote && search);
    },
    null,
    { timeout: 30_000 },
  );
  return Date.now() - started;
}

/** Accessible name of the active element (aria-label wins, else text). */
async function activeName(): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return '';
    return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  });
}

/** Press Tab until the predicate holds; returns the tab count (-1 = never). */
async function tabUntil(predicate: () => Promise<boolean>, maxTabs = 30): Promise<number> {
  for (let i = 0; i <= maxTabs; i += 1) {
    if (await predicate()) return i;
    await page.keyboard.press('Tab');
  }
  return -1;
}

test('cold dashboard shell renders within the regression budget (clean profile)', async () => {
  const cold = await measureShell();
  console.log(`[perf] dashboard shell cold (clean profile): ${cold} ms`);
  // Regression guard with headroom; the PRD §11 target (1.5 s) is judged
  // against the measured value recorded in docs/RELEASE_VERIFICATION.md.
  expect(cold).toBeLessThan(3_000);
});

test('onboarding is keyboard-dismissable and traps focus while open', async () => {
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  // Native showModal(): focus lives inside the dialog.
  expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
  const skipNow = onboarding.getByRole('button', { name: 'Skip for now' });
  await skipNow.focus();
  await page.keyboard.press('Enter');
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('keyboard-only note creation with bold formatting and autosave', async () => {
  // Reach and activate "New Note" purely with Tab + Enter.
  const newNoteTabs = await tabUntil(async () => (await activeName()) === 'New Note');
  expect(newNoteTabs, 'New Note button reachable by Tab').toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');

  // T-101: the activation navigates straight into the fresh note's editor —
  // the title field is the next keyboard stop inside the editor surface.
  const titleTabs = await tabUntil(async () =>
    page.evaluate(() => document.activeElement?.classList.contains('editor-panel__title') === true),
  );
  expect(titleTabs, 'title input reachable by Tab').toBeGreaterThanOrEqual(0);
  await page.keyboard.type('Keyboard Note');

  // The full editor toolbar (9 groups of controls) sits between the title
  // and the editor host in the tab order — a real keyboard user tabs
  // through every control, so the budget must cover the whole chain.
  const editorTabs = await tabUntil(
    async () => page.evaluate(() => document.activeElement?.closest('.ProseMirror') != null),
    150,
  );
  expect(editorTabs, 'editor reachable by Tab').toBeGreaterThanOrEqual(0);
  await page.keyboard.type('written entirely without a mouse ');

  // Rich text through the keyboard shortcut path (starter-kit Mod-b).
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await expect(page.locator('.ProseMirror strong').first()).toBeVisible({ timeout: 10_000 });

  // Autosave reaches the durable Saved state without any pointer input.
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
});

test('warm dashboard shell across reloads stays within the budget', async () => {
  const warm: number[] = [];
  for (let i = 0; i < 3; i += 1) warm.push(await measureShell());
  const sorted = [...warm].sort((a, b) => a - b);
  const median = sorted[1] ?? sorted[0];
  console.log(`[perf] dashboard shell warm reloads: ${warm.join(', ')} ms (median ${median} ms)`);
  expect(median).toBeLessThan(2_000);
});

test('settings dialog contains focus and Escape closes it', async () => {
  const settingsTabs = await tabUntil(async () => (await activeName()) === 'Open settings');
  expect(settingsTabs, 'Open settings reachable by Tab').toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Many tabs never leave the native modal dialog (focus trap).
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => document.activeElement?.closest('dialog.dialog--settings') != null),
    'focus stayed inside the settings dialog',
  ).toBe(true);

  // Escape closes the native <dialog> (no cancel prevention).
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
});

test('keyboard focus shows a visible focus ring', async () => {
  const searchTabs = await tabUntil(
    async () => page.evaluate(() => document.activeElement?.id === 'search-input'),
  );
  expect(searchTabs, 'search input reachable by Tab').toBeGreaterThanOrEqual(0);
  const outline = await page.evaluate(() => {
    const el = document.querySelector('#search-input');
    if (!(el instanceof HTMLElement)) return { style: 'none', width: '0px' };
    const cs = window.getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(outline.style, ':focus-visible outline style').not.toBe('none');
  expect(parseFloat(outline.width), ':focus-visible outline width').toBeGreaterThan(0);
});
