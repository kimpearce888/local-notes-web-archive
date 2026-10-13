import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-063 audit-defect regression suite (T-062 findings D-04 and D-06): the
 * binary RPC transport. chrome.runtime.sendMessage JSON-serializes message
 * values, which silently turned every File/Blob into {} — breaking
 * attachments end-to-end, backup export AND restore in the shipped v1.0.4
 * build while every unit test stayed green (injected transports preserved
 * object identity). These specs drive the REAL channel: real file-picker
 * attach through the panel, real backup download, real restore preview.
 *
 * Serial by design (one persistent context; backup/restore mutates the
 * whole database, so this file never shares state with the other suites).
 */

const distDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist');

test.setTimeout(90_000);
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let extensionId: string;
let workDir: string;
/** The real archive filename from the D-06a download (reused by restore). */
let backupFilename = '';

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
  workDir = mkdtempSync(join(tmpdir(), 'lnwa-t063-'));
  context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
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
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[dashboard console] ${message.text()}`);
    }
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);

  // First run: dismiss the onboarding overlay so the suite can interact.
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Get started' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });

  // One note to attach to and to carry through the backup round-trip.
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByRole('button', { name: 'Open Untitled for editing' }).click();
  const title = page.locator('.editor-panel__title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('T-063 Transport Note');
  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.keyboard.type('binary transport regression content');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
});

test.afterAll(async () => {
  await context.close();
});

test('D-04: a real file attaches through the panel over the RPC channel', async () => {
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  const panel = page.locator('[aria-label="Note attachments"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).toContainText('No attachments yet');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    panel.getByRole('button', { name: 'Attach files…' }).click(),
  ]);
  await fileChooser.setFiles({
    name: 't063-attachment.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('attachment bytes that must survive the RPC channel', 'utf8'),
  });

  // The row appears with the filename — the RPC round-trip worked. The
  // pre-fix build showed "attachments/add: data must be a Blob" here and
  // the empty state stayed forever.
  await expect(panel.getByText('t063-attachment.txt')).toBeVisible({ timeout: 15_000 });
  await expect(panel).not.toContainText('data must be a Blob');
  await expect(panel.locator('.attachments-panel__empty')).toBeHidden();
  await expect(panel.locator('.attachments-panel__count')).toHaveText('1 file');

  // Download action reaches the stored content through the same channel
  // (attachments/get-blob returns the Blob result as an envelope).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    panel.getByRole('button', { name: 'Download t063-attachment.txt' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('t063-attachment.txt');
  const saved = await download.path();
  expect(saved && readFileSync(saved, 'utf8')).toContain('attachment bytes');

  // Honest cleanup: confirmed delete returns the honest empty state.
  await panel.getByRole('button', { name: 'Delete t063-attachment.txt' }).click();
  const confirm = page.locator('dialog.dialog--confirm');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete attachment' }).click();
  await expect(
    panel.locator('.attachments-panel__row', { hasText: 't063-attachment.txt' }),
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(panel.locator('.attachments-panel__empty')).toBeVisible();
  await expect(panel).toContainText('Deleted t063-attachment.txt');
});

test('D-06a: backup export downloads a real archive (createObjectURL path)', async () => {
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 10_000 });

  // The pre-fix build failed here with "Failed to execute 'createObjectURL'
  // on 'URL': Overload resolution failed" because the archive Blob arrived
  // from the worker as {}.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    settings.getByRole('button', { name: 'Export backup now' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^local-notes-backup-.*\.zip$/);
  backupFilename = download.suggestedFilename();
  const zipPath = join(workDir, backupFilename);
  await download.saveAs(zipPath);
  await expect
    .poll(async () => (existsSync(zipPath) ? readFileSync(zipPath).length : 0))
    .toBeGreaterThan(100);
  // PK zip signature: the download carries real archive bytes, not an
  // empty object URL.
  expect(readFileSync(zipPath).subarray(0, 2)).toEqual(Buffer.from([0x50, 0x4b]));
  await expect(settings).toContainText('Backup downloaded', { timeout: 10_000 });
  await expect(settings).not.toContainText('Backup failed');
});

test('D-06b: restore preview reads the exported archive (preview RPC path)', async () => {
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 10_000 });
  const zipPath = join(workDir, backupFilename);

  // The pre-fix build failed before any dialog: "archive: expected the
  // backup file (a Blob)" — the File could not cross the channel.
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    settings.getByRole('button', { name: 'Restore backup…' }).click(),
  ]);
  await fileChooser.setFiles(zipPath);

  const review = page.locator('dialog.dialog--review');
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review).toContainText('Restore backup');
  // Manifest summary from the REAL exported archive above.
  await expect(review).toContainText('1 notes');
  await expect(review).toContainText('0 attachments');
  await expect(review).not.toContainText('expected the backup file');

  // Cancel keeps the library untouched (destructive-flow safety).
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(review).not.toBeVisible();
});

test('the exported archive restores for real (full round-trip)', async () => {
  // Merge-restore the exported archive and confirm the note count is
  // honestly reported — the whole backup pipeline works end to end.
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 10_000 });
  const zipPath = join(workDir, backupFilename);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    settings.getByRole('button', { name: 'Restore backup…' }).click(),
  ]);
  await fileChooser.setFiles(zipPath);
  const review = page.locator('dialog.dialog--review');
  await expect(review).toBeVisible({ timeout: 20_000 });
  await review.getByRole('radio', { name: 'Merge' }).check();
  await review.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(review).not.toBeVisible({ timeout: 30_000 });

  // Merge mode imported the archive's note alongside itself.
  await expect(settings).toContainText('Restore finished (merge): 1 notes', { timeout: 10_000 });
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: /Open .*T-063 Transport Note.* for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
});

test('D-01: favorites are reachable from the bulk bar and the editor', async () => {
  // The audit proved no UI control could set the favorite flag: the
  // Favorites smart list was a permanent honest empty state.
  const card = page.locator('.card', { hasText: 'T-063 Transport Note' }).first();
  await card.getByLabel('Select T-063 Transport Note').check();
  await page.locator('.bulk-bar').getByRole('button', { name: 'Favorite', exact: true }).click();

  // The card badge appears (same badge family as Pinned).
  await expect(card.locator('.card__badge--favorite')).toHaveText('Favorite', { timeout: 10_000 });

  // The Favorites smart list — permanently empty before the fix — now
  // shows the note.
  await page.locator('.smart-nav').getByRole('button', { name: 'Favorites' }).click();
  const favoriteCard = page.locator('.card', { hasText: 'T-063 Transport Note' }).first();
  await expect(favoriteCard).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#results-count')).toContainText('1');

  // And the editor header offers the inverse action with a live label.
  await favoriteCard.getByRole('button', { name: 'Open T-063 Transport Note for editing' }).click();
  const editorHeader = page.locator('.editor-session__header');
  await expect(editorHeader).toBeVisible({ timeout: 15_000 });
  await editorHeader.getByRole('button', { name: 'Unfavorite' }).click();
  await expect(editorHeader.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // Back to the list: the smart list honestly emptied.
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(
    page.locator('.card', { hasText: 'T-063 Transport Note' }),
  ).toHaveCount(0, { timeout: 10_000 });
});

test('D-02: the Filters disclosure holds real controls, chips and saved views', async () => {
  // The audit measured ZERO children in #filters-region (with and without
  // data) and chips that never populate. Now: controls, removable chips and
  // durable named views (FR-SEARCH-03).
  // The previous test left the view on the (now empty) Favorites list.
  await page.locator('.smart-nav').getByRole('button', { name: 'All notes' }).click();
  await expect(page.locator('#results-count')).toContainText('1 note', { timeout: 10_000 });
  const filtersButton = page.getByRole('button', { name: 'Filters', exact: true });
  await filtersButton.click();
  const region = page.locator('#filters-region');
  await expect(region).toBeVisible();
  // The audit measured ZERO children here; now the control families exist.
  const controlCount = await region.locator('input, select, button').count();
  expect(controlCount).toBeGreaterThan(10);
  await expect(region).toContainText('Apply filters');
  await expect(region).toContainText('Save as view…');

  // Apply a filter: the previously permanently-empty chip region renders
  // one removable chip and the results honestly narrow to zero.
  await region.locator('#filter-favorite').check();
  await region.getByRole('button', { name: 'Apply filters' }).click();
  const chips = page.locator('#active-filters');
  await expect(chips).toContainText('Favorites only', { timeout: 10_000 });
  await expect(page.locator('#results-count')).toContainText('0 notes', { timeout: 10_000 });

  // Removing the chip restores the unfiltered list.
  await chips.locator('.chip__remove').first().click();
  await expect(page.locator('#results-count')).toContainText('1 note', { timeout: 10_000 });
  await expect(chips.locator('.chip')).toHaveCount(0, { timeout: 10_000 });

  // Saved views: the current query + filters persist under a name, survive
  // a full reload, and re-apply with their query.
  await page.locator('#search-input').fill('Transport');
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-count')).toContainText('1 note', { timeout: 10_000 });

  // The disclosure may still be open from the apply flow above — only
  // click when it is actually closed.
  if ((await filtersButton.getAttribute('aria-expanded')) !== 'true') {
    await filtersButton.click();
  }
  await expect(region).toBeVisible();
  await region.getByRole('button', { name: 'Save as view…' }).click();
  const saveDialog = page.locator('dialog.dialog', { hasText: 'Save current view' });
  await expect(saveDialog).toBeVisible();
  await saveDialog.locator('input[type="text"]').fill('Transport view');
  await saveDialog.getByRole('button', { name: 'Save view' }).click();
  await expect(saveDialog).not.toBeVisible();
  const savedViews = page.locator('#saved-views');
  await expect(savedViews).toContainText('Transport view', { timeout: 10_000 });

  // Reset the search, reload the dashboard, then apply the saved view.
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  await page.reload();
  await expect(page.locator('#results-count')).toContainText('1 note', { timeout: 15_000 });
  await expect(savedViews).toContainText('Transport view', { timeout: 15_000 });
  await savedViews.getByRole('button', { name: 'Transport view', exact: true }).click();
  await expect(page.locator('#search-input')).toHaveValue('Transport', { timeout: 10_000 });
  await expect(page.locator('#results-count')).toContainText('1 note', { timeout: 10_000 });
});
