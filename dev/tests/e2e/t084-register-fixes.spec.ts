import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const distDir = join(repoRoot, 'dist');
const heicFixture = join(repoRoot, 'dev', 'tests', 'fixtures', 'heic-sample.heic');

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

test('first run: onboarding teaches the product (UX-14) and the empty state creates inline (UX-16)', async () => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  // T-089 (UX-14): concrete first actions lead; the primary IS the first step.
  await expect(onboarding).toContainText('Write your first note');
  await expect(onboarding).toContainText('Save any web page for offline reading');
  await expect(onboarding).toContainText('Organize with tags, find anything');
  await expect(onboarding).toContainText('Everything stays on this device');
  await expect(onboarding).toContainText('Back up before big changes');
  await expect(
    onboarding.getByRole('button', { name: 'Create my first note' }),
  ).toBeVisible();
  await onboarding.getByRole('button', { name: 'Skip for now' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });

  // T-089 (UX-16): the empty library offers the obvious action inline.
  const emptyState = page.locator('.state--empty');
  await expect(emptyState).toBeVisible({ timeout: 15_000 });
  await expect(emptyState).toContainText('No notes yet');
  await emptyState.getByRole('button', { name: 'Create your first note' }).click();
  // T-101: creating a note navigates straight into it — the empty-state
  // button shares the New Note semantics (guarded, editor-opening).
  const titleField = page.locator('.editor-panel__title');
  await expect(titleField).toBeVisible({ timeout: 15_000 });
  await titleField.fill('First inline note');
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.locator('.card', { hasText: 'First inline note' })).toBeVisible({
    timeout: 15_000,
  });
});

async function openFreshNote(title: string): Promise<void> {
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: New Note navigates straight into the fresh note's editor —
  // nothing is created in the background and no card round-trip is needed.
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

  // QA-D04 flow: the pick STAGES the file (honest status + enabled Insert
  // button); the insert only happens on the explicit click.
  await expect(dialog).toContainText('Ready to insert IMG_4032.heic');
  await dialog.getByRole('button', { name: 'Insert image', exact: true }).click();

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
  // QA-D04: the failure surfaces on the explicit Insert click, and the
  // dialog stays open for a retry.
  await dialog.getByRole('button', { name: 'Insert image', exact: true }).click();
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


/* ---------------- T-089: capture entry point (UX-13) ---------------- */

test('T-089 UX-13: "Save a web page…" creates a note for the link and queues the capture', async () => {
  // The entry point is visible in the sidebar, next to New Note.
  const savePageButton = page.getByRole('button', { name: 'Save a web page…' });
  await expect(savePageButton).toBeVisible();
  await savePageButton.click();

  const dialog = page.locator('dialog.dialog--save-page');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('a complete offline copy is captured');
  // Honest client-side validation first.
  const urlField = dialog.locator('#save-page-input');
  await urlField.fill('not-a-link');
  await dialog.getByRole('button', { name: 'Save page' }).click();
  await expect(dialog).toContainText('Only http(s) links can be saved');

  // The real save: note created + link queued through capture/save-url.
  // QA-D05: the queued capture now actually RUNS. On a fresh profile no
  // host permission is granted yet, so the queue parks the link in
  // permission-required — the two announcements (dialog 'Saved...' vs
  // queue 'permission required') race for the live region, so the park
  // is asserted through its settled user-visible state: the snapshots
  // panel's waiting row (and QA-D06's Grant access affordance below
  // completes the journey).
  await urlField.fill('https://example.com/e2e-entry-point');
  await dialog.getByRole('button', { name: 'Save page' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // The note appears in the list immediately, titled after the site.
  const card = page.locator('.card', { hasText: 'example.com' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Its body links the page (the same note shape the context menu builds).
  await card.getByRole('button', { name: /^Open .* for editing/ }).click();
  const titleField = page.locator('.editor-panel__title');
  await expect(titleField).toBeVisible({ timeout: 15_000 });
  await expect(titleField).toHaveValue(/example\.com/);
  await expect(page.locator('.editor-panel__host a[href="https://example.com/e2e-entry-point"]')).toHaveCount(1);

  // QA-D06: the snapshots panel offers the Grant access affordance for the
  // parked link, and granting completes the capture end-to-end.
  await page.getByRole('button', { name: 'Snapshots' }).click();
  const snapshotsPanel = page.locator('[aria-label="Captured snapshots"]');
  await expect(snapshotsPanel).toBeVisible({ timeout: 10_000 });
  await expect(snapshotsPanel).toContainText(
    'Capture waiting for access to https://example.com.',
  );
  // The Grant access affordance RENDERS (QA-D06). Clicking it pops the
  // Chrome NATIVE permission prompt, which lives in browser chrome and
  // cannot be automated (documented environmental limitation, see
  // artifacts/human-qa/defects.md QA-D06) — the end-to-end completion with
  // access granted is covered by the seeded-profile test right below.
  await expect(
    snapshotsPanel.getByRole('button', { name: 'Grant access…' }),
  ).toBeVisible();
  await snapshotsPanel.getByRole('button', { name: 'Close snapshots' }).click();
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

test('T-089 UX-13 (access granted): the capture completes end-to-end', async () => {
  // The documented automation-equivalent of clicking Allow on the native
  // prompt (QA-D06 verification method): a second persistent context
  // whose profile pre-seeds the granted optional-host permission, so the
  // queued capture runs through the REAL pipeline (tab, load, PNG, text)
  // to its terminal phase — the exact QA-D05 honest-queue flow.
  const seededDir = mkdtempSync(join(tmpdir(), 'lnwa-t089-seeded-'));
  const defaultDir = join(seededDir, 'Default');
  mkdirSync(defaultDir, { recursive: true });
  const extensionIdStable = 'pieeojhacbmcmkfakahpapgpmejgnaij'; // from the manifest key
  const origin = 'https://example.com/*';
  const prefs = {
    extensions: {
      settings: {
        [extensionIdStable]: {
          granted_permissions: { api: [], explicit_host: [origin], scriptable_host: [] },
          active_permissions: { api: [], explicit_host: [origin], scriptable_host: [] },
        },
      },
    },
  };
  writeFileSync(join(defaultDir, 'Preferences'), JSON.stringify(prefs));

  const seededContext = await chromium.launchPersistentContext(seededDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
  });
  try {
    const seededPage = await seededContext.newPage();
    await seededPage.goto(`chrome-extension://${extensionIdStable}/dashboard.html`);
    await seededPage.waitForSelector('#results', { timeout: 20_000 });
    // Fresh profile: dismiss the onboarding (Skip keeps the dismissal).
    const onboardingDialog = seededPage.locator('dialog[open]');
    if ((await onboardingDialog.count()) > 0) {
      await onboardingDialog.getByRole('button', { name: 'Skip for now' }).click();
      await seededPage.waitForTimeout(500);
    }
    await seededPage.getByRole('button', { name: 'Save a web page…' }).click();
    const saveDialog = seededPage.locator('dialog.dialog--save-page');
    await saveDialog.waitFor({ timeout: 10_000 });
    await saveDialog.locator('#save-page-input').fill('https://example.com/t089-e2e');
    await saveDialog.getByRole('button', { name: 'Save page' }).click();
    await saveDialog.waitFor({ state: 'hidden', timeout: 15_000 });
    // The capture runs through the real pipeline and its terminal phase
    // is announced (FR-CAP-03/07). In this sandbox MHTML capture is
    // unavailable (documented L05), so the honest terminal status is a
    // partial capture with PNG + text artifacts — both 'complete' and
    // 'partial' are truthful successes.
    await expect(seededPage.locator('#live-region')).toContainText(
      /Capture (succeeded|failed)/,
      { timeout: 30_000 },
    );
    const finalAnnouncement =
      (await seededPage.locator('#live-region').textContent()) ?? '';
    expect(finalAnnouncement).toContain('Capture succeeded');
    // The note card reflects the archived page.
    const seededCard = seededPage.locator('.card', { hasText: 'example.com' });
    await expect(seededCard).toBeVisible({ timeout: 15_000 });
  } finally {
    await seededContext.close();
  }
});
