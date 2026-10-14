import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-084 register fixes, verified against the BUILT extension in real
 * Chromium (the exact artifact that ships on the releases page):
 *
 * T-085 (UX-01..05, UX-09): every popped-out bar carries its own Close
 * control, Escape dismisses panels, and the Filters bar closes on Apply.
 *
 * T-086 (UX-06, UX-07, UX-15): the insert-image dialog no longer asks for
 * data:image URLs, the file picker admits HEIC/HEIF photos, and a REAL
 * iPhone-format photo decodes locally (libheif worker from the extension's
 * own files — blob workers are CSP-blocked on extension pages) and inserts
 * as a visible JPEG image node.
 */

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const distDir = join(repoRoot, 'dist');
const heicFixture = join(repoRoot, 'tests', 'fixtures', 'heic-sample.heic');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

const userDataDir = mkdtempSync(join(tmpdir(), 'lnwa-t084-fixes-'));

let context: BrowserContext;
let page: Page;
let extensionId: string;

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
  if (!existsSync(heicFixture)) {
    throw new Error(`HEIC fixture missing: ${heicFixture}`);
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
    if (process.env['DEBUG_E2E'] === '1') {
      console.log(`[page:${message.type()}]`, message.text().slice(0, 500));
    }
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  context.on('request', (request) => {
    if (!isLocalUrl(request.url())) externalRequests.push(request.url());
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
});

test.afterAll(async () => {
  if (context) await context.close();
  expect(pageErrors, 'no page errors').toEqual([]);
  expect(consoleErrors, 'no console errors').toEqual([]);
  expect(externalRequests, 'zero external requests').toEqual([]);
});

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

async function openFreshNote(title: string): Promise<void> {
  await page.getByRole('button', { name: 'New Note' }).click();
  // New Note creates the note and stays on the list (most-recently-modified
  // first); entering the editor is the card's own action, exactly like a
  // real user.
  await page.getByRole('button', { name: /^Open Untitled for editing/ }).first().click();
  const titleField = page.locator('.editor-panel__title');
  await expect(titleField).toBeVisible({ timeout: 15_000 });
  await titleField.fill(title);
}

/* ------------------------- T-085: dismissal ------------------------- */

test('T-085 UX-01: the attachments bar closes from its own Close control', async () => {
  await openFreshNote('Dismissal note');
  await page.getByRole('button', { name: /^Attachments( \(\d+\))?$/ }).click();
  const panel = page.locator('[aria-label="Note attachments"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  // The bar itself carries the control — no hunting for the small toggle.
  await panel.getByRole('button', { name: 'Close attachments' }).click();
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /^Attachments( \(\d+\))?$/ }),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('T-085 UX-03: Escape dismisses the reminders bar', async () => {
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  const panel = page.locator('[aria-label="Note reminders"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden({ timeout: 10_000 });
});

test('T-085 UX-02/04: snapshots and AI bars both carry Close controls', async () => {
  await page.getByRole('button', { name: 'Snapshots', exact: true }).click();
  const snapshots = page.locator('[aria-label="Captured snapshots"]');
  await expect(snapshots).toBeVisible({ timeout: 10_000 });
  await snapshots.getByRole('button', { name: 'Close snapshots' }).click();
  await expect(snapshots).toBeHidden({ timeout: 10_000 });

  await page.getByRole('button', { name: 'AI', exact: true }).click();
  const ai = page.locator('[aria-label="AI assistant"]');
  await expect(ai).toBeVisible({ timeout: 10_000 });
  await ai.getByRole('button', { name: 'Close the AI assistant' }).click();
  await expect(ai).toBeHidden({ timeout: 10_000 });
});

test('T-085 UX-05: the Filters bar closes on Apply and on its own Close control', async () => {
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.getByRole('button', { name: 'Filters' }).click();
  const region = page.locator('#filters-region');
  await expect(region).toBeVisible();
  await expect(region.getByRole('heading', { name: 'Filters' })).toBeVisible();
  await region.getByRole('button', { name: 'Apply filters' }).click();
  // Apply does the work AND dismisses the bar (the register's complaint:
  // the bar "keeps occupying the screen with no dismiss affordance").
  await expect(region).toBeHidden({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(region).toBeVisible();
  await region.getByRole('button', { name: 'Close filters' }).click();
  await expect(region).toBeHidden({ timeout: 10_000 });

  // Escape works too while it is open.
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(region).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(region).toBeHidden({ timeout: 10_000 });
});

/* ------------------- T-086: the image dialog + HEIC ------------------- */

test('T-086 UX-06: the dialog no longer asks for data:image blobs', async () => {
  await openFreshNote('Image dialog note');
  await page.getByRole('button', { name: 'Insert image with alt text' }).click();
  const dialog = page.locator('dialog.dialog[open]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).not.toContainText('data:image');
  await expect(dialog).not.toContainText('base64');
  // UX-15: the easier alternatives are taught instead.
  await expect(dialog).toContainText('drag a picture straight into the note');
  await expect(dialog).toContainText('paste it with Ctrl+V');
  await expect(dialog).toContainText('HEIC');
  // UX-07: the picker admits HEIC/HEIF photos (MIME + extensions).
  const accept = await dialog.locator('input[type="file"]').getAttribute('accept');
  expect(accept).toContain('image/heic');
  expect(accept).toContain('.heic');
  expect(accept).toContain('.heif');
  // The primary action is an explicit Choose button.
  await expect(dialog.getByRole('button', { name: 'Choose picture…' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('T-086 UX-07: a REAL iPhone-format photo (HEIC) inserts as a visible image', async () => {
  await page.getByRole('button', { name: 'Insert image with alt text' }).click();
  const dialog = page.locator('dialog.dialog[open]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const heicBytes = readFileSync(heicFixture);
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'IMG_4032.heic',
    mimeType: 'image/heic',
    buffer: heicBytes,
  });

  // The real decode runs in the extension's own libheif worker; the image
  // node must render with real decoded content (non-zero natural size) —
  // this is the exact flow the maintainer reported as "not taking pictures
  // from the pc".
  const image = page.locator('figure.editor-image img');
  await expect(image.first()).toBeVisible({ timeout: 30_000 });
  const natural = await image.first().evaluate((img) => ({
    w: (img as HTMLImageElement).naturalWidth,
    h: (img as HTMLImageElement).naturalHeight,
  }));
  expect(natural.w).toBeGreaterThan(0);
  expect(natural.h).toBeGreaterThan(0);

  // The stored attachment is the converted JPEG, listed under its .jpg name.
  await page.getByRole('button', { name: /^Attachments( \(\d+\))?$/ }).click();
  const panel = page.locator('[aria-label="Note attachments"]');
  await expect(panel.getByText('IMG_4032.jpg')).toBeVisible({ timeout: 15_000 });
  // T-088 (UX-11): the row speaks user language; the raw type stays in
  // the title attribute.
  await expect(panel).toContainText('JPEG photo');
  const metaTitle = await panel
    .locator('.attachments-panel__row', { hasText: 'IMG_4032.jpg' })
    .locator('.attachments-panel__meta')
    .getAttribute('title');
  expect(metaTitle).toContain('image/jpeg');
  await panel.getByRole('button', { name: 'Close attachments' }).click();

  // No CSP violations or worker failures surfaced as console errors.
  expect(consoleErrors).toEqual([]);
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

test('T-086 honesty: an unreadable .heic file degrades to a truthful message', async () => {
  await openFreshNote('Broken HEIC note');
  await page.getByRole('button', { name: 'Insert image with alt text' }).click();
  const dialog = page.locator('dialog.dialog[open]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'corrupt.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('these are not real HEIC bytes at all, just text'),
  });
  // Honest failure: a message explains what happened; no broken image node.
  await expect(page.locator('#live-region')).toContainText(
    /corrupt\.heic/,
    { timeout: 30_000 },
  );
  const broken = page.locator('figure.editor-image img');
  await expect(broken).toHaveCount(0);
  // The dialog stays open for a retry — close it before moving on.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  // The original file is preserved as an attachment.
  await page.getByRole('button', { name: /^Attachments( \(\d+\))?$/ }).click();
  const panel = page.locator('[aria-label="Note attachments"]');
  await expect(panel.getByText('corrupt.heic')).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Close attachments' }).click();
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

/* ---------------- T-087: tags from the editor (UX-08) ---------------- */

test('T-087 UX-08: a tag can be created and applied from the editor itself', async () => {
  await openFreshNote('Tagged from editor');
  // The metadata bar is right under the subtitle — no bulk-bar detour.
  const tagInput = page.getByLabel('Add a tag');
  await expect(tagInput).toBeVisible({ timeout: 15_000 });
  await tagInput.fill('e2e-tag');
  await tagInput.press('Enter');
  // The chip appears immediately (applied via RPC, not autosave).
  const chip = page.locator('.note-meta-bar__chip', { hasText: 'e2e-tag' });
  await expect(chip).toBeVisible({ timeout: 15_000 });

  // A category too — the second row of the same bar.
  const categoryInput = page.getByLabel('Add a category');
  await categoryInput.fill('E2E Projects');
  await categoryInput.press('Enter');
  await expect(
    page.locator('.note-meta-bar__chip', { hasText: 'E2E Projects' }),
  ).toBeVisible({ timeout: 15_000 });

  // Removable in place.
  await page.getByRole('button', { name: 'Remove tag e2e-tag' }).click();
  await expect(chip).toHaveCount(0);

  // The category survives on the card when returning to the list (the
  // roster-refresh wiring hydrates related data for the visible page).
  await page.getByRole('button', { name: 'Back to notes' }).click();
  const card = page.locator('.card', { hasText: 'Tagged from editor' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(
    card.locator('.card__chips--categories', { hasText: 'E2E Projects' }),
  ).toBeVisible({ timeout: 15_000 });
});

