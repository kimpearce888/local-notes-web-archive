import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-054 regressions for the user-reported defects (2026-10-13):
 *
 * 1. The "Add reminder" dialog rendered every form control ~352px (22rem)
 *    tall — `.search-input`'s horizontal-search flex sizing applied its
 *    flex-basis to HEIGHT inside the column-flex `.dialog__field` — and
 *    the dialog overflowed the viewport so the Time zone field was cut
 *    off. These tests measure REAL computed heights and viewport
 *    containment against the built extension.
 *
 * 2. Pin and trash were impossible from the editor (no such actions in
 *    the editor header): a user inside a note could neither pin it nor
 *    move it to trash. These tests drive both actions end-to-end through
 *    the real UI and verify the persisted outcomes.
 */

const distDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

const userDataDir = mkdtempSync(join(tmpdir(), 'lnwa-user-report-'));

let context: BrowserContext;
let page: Page;
let extensionId: string;

/** Hygiene collectors, asserted at the end of the session. */
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
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
  if (!existsSync(join(distDir, 'manifest.json'))) {
    throw new Error(`dist/ is not built — run "npm run build" first (${distDir})`);
  }
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
  });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const [worker] = context.serviceWorkers();
    if (worker) {
      extensionId = new URL(worker.url()).host;
      break;
    }
    if (Date.now() > deadline) throw new Error('extension service worker never started');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  context.on('request', (request) => {
    if (!isLocalUrl(request.url())) externalRequests.push(request.url());
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
});

test.afterAll(async () => {
  if (context) await context.close();
});

function smartNav(p: Page) {
  return p.locator('.smart-nav');
}

test('first run: onboarding dismissed', async () => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Get started' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('reminder dialog: fields render at natural height and the zone field is visible', async () => {
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByRole('button', { name: 'Open Untitled for editing' }).first().click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  // Open the reminders panel from the editor header.
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await page.getByRole('button', { name: 'Add reminder…' }).click();

  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('heading', { name: 'Add reminder' })).toBeVisible();

  // Ground truth from the REAL browser: the Kind select and the
  // datetime-local input must be form-field sized, not 22rem-tall boxes.
  // (22rem = 352px; anything >= 150px is unmistakably the old bug.)
  const kindHeight = await dialog.locator('select').first().evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(kindHeight, 'Kind select must be a normal form-field height').toBeLessThan(150);
  expect(kindHeight).toBeGreaterThan(16);

  const whenHeight = await dialog.locator('input[type="datetime-local"]').evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(whenHeight, 'datetime-local input must be a normal form-field height').toBeLessThan(150);
  expect(whenHeight).toBeGreaterThan(16);

  // The dialog (and with it the Time zone field) must fit inside the
  // viewport — the old 22rem fields pushed it below the fold.
  const viewportHeight = page.viewportSize()?.height ?? 900;
  const zoneBox = await dialog.locator('input').last().boundingBox();
  expect(zoneBox, 'Time zone input must be laid out').not.toBeNull();
  expect(zoneBox!.y + zoneBox!.height, 'Time zone field must be fully visible').toBeLessThanOrEqual(
    viewportHeight,
  );

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.y + dialogBox!.height, 'the dialog must fit the viewport').toBeLessThanOrEqual(
    viewportHeight + 1,
  );

  // Cancel cleanly.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

test('editor: pin toggles the note and the card shows the Pinned badge', async () => {
  const title = page.locator('.editor-panel__title');
  // Create a dedicated note through the real UI.
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByRole('button', { name: 'Open Untitled for editing' }).first().click();
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('Pin trash target');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('body for the pin and trash test');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

  // Pin FROM THE EDITOR (the reported missing action).
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('#live-region')).toContainText('Note pinned.', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Back to notes' }).click();
  const card = page.locator('.card', { hasText: 'Pin trash target' }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.card__badge', { hasText: 'Pinned' })).toBeVisible();
});

test('editor: move to trash requires confirmation, trashes and returns to the list', async () => {
  await page.locator('.card', { hasText: 'Pin trash target' }).first()
    .getByRole('button', { name: /Open Pin trash target for editing/ }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  // The destructive action is confirmed, matching the bulk-bar pattern.
  await page.getByRole('button', { name: 'Move to trash…' }).click();
  const confirm = page.locator('dialog.dialog--confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await expect(confirm).toContainText('Move this note to trash?');

  // Cancel first: nothing happens, the editor stays.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.editor-panel__title')).toBeVisible();

  // Confirm for real: the note is trashed and the editor closes to the list.
  await page.getByRole('button', { name: 'Move to trash…' }).click();
  await expect(page.locator('dialog.dialog--confirm')).toBeVisible({ timeout: 10_000 });
  await page.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.locator('#live-region')).toContainText('Note moved to trash.', {
    timeout: 15_000,
  });
  await expect(page.locator('.editor-panel__title')).not.toBeVisible({ timeout: 15_000 });

  // The note is honestly gone from the active list...
  await expect(page.locator('.card', { hasText: 'Pin trash target' })).toHaveCount(0, {
    timeout: 15_000,
  });

  // ...and recoverable in the Trash smart list.
  await smartNav(page).getByRole('button', { name: 'Trash' }).click();
  await expect(page.locator('.card', { hasText: 'Pin trash target' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
});

test('session hygiene: zero page errors, console errors or external requests', async () => {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
