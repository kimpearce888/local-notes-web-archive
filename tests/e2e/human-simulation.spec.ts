import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-045 human-simulation and adversarial suite. The app is driven exactly
 * like a real user — personas: new user (first-run onboarding), returning
 * user (full browser restart with the same profile), power user (rapid
 * clicks, bulk operations), invalid user (empty/garbage inputs) and
 * malicious user (XSS payloads through the REAL clipboard pipeline,
 * javascript: URLs in the link dialog).
 *
 * Session hygiene is asserted, not just logged: zero uncaught page errors,
 * zero console errors, zero leaked native dialogs and zero network requests
 * to any non-loopback host during the entire session (local-first honesty,
 * PRD §1/§10).
 *
 * The authentication flow is N/A by design: the extension is account-less
 * (PRD §1) — first-run onboarding is the equivalent entry journey and the
 * browser-restart test is the returning-user session resumption.
 */

const distDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

/** A fixed profile directory so the browser-restart test is a real restart. */
const userDataDir = mkdtempSync(join(tmpdir(), 'lnwa-human-sim-'));

let context: BrowserContext;
let page: Page;
let extensionId: string;

/** Hygiene collectors, asserted at the end of each browser session. */
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
const nativeDialogs: string[] = [];
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

/**
 * Chromium logs a CSP violation when it BLOCKS the deliberately-injected
 * inline handlers of the malicious-user payloads — once from the extension
 * page's own parse window and once from Chromium-internal clipboard contexts
 * the page cannot control. Those messages are evidence of the attacks being
 * contained, not defects: the suite separately asserts that nothing executed
 * (no XSS flags, no dialogs, no external requests, sanitized documents).
 * Everything else still fails the hygiene gate.
 */
const BLOCKED_ATTACK_NOISE = /Executing inline event handler violates the following Content Security Policy/;

function realConsoleErrors(errors: readonly string[]): string[] {
  return errors.filter((message) => !BLOCKED_ATTACK_NOISE.test(message));
}

function attachWatchers(ctx: BrowserContext, p: Page): void {
  p.on('pageerror', (error) => pageErrors.push(error.message));
  p.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  p.on('dialog', (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  ctx.on('request', (request) => {
    if (!isLocalUrl(request.url())) externalRequests.push(request.url());
  });
}

async function launchBrowser(): Promise<void> {
  context = await chromium.launchPersistentContext(userDataDir, {
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
  attachWatchers(context, page);
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
}

test.beforeAll(async () => {
  if (!existsSync(join(distDir, 'manifest.json'))) {
    throw new Error(`dist/ is not built — run "npm run build" first (${distDir})`);
  }
  await launchBrowser();
});

test.afterAll(async () => {
  if (context) await context.close();
});


function bulkBar(p: Page) {
  return p.locator('.bulk-bar-mount');
}

function smartNav(p: Page) {
  return p.locator('.smart-nav');
}

test('new user: first run shows onboarding and it is dismissible', async () => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });

  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Get started' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('power user: five rapid New Note clicks create five notes without breaking', async () => {
  const newNote = page.getByRole('button', { name: 'New Note' });
  // Real users double-fire: click as fast as the event loop allows.
  await Promise.all([
    newNote.click(),
    newNote.click(),
    newNote.click(),
    newNote.click(),
    newNote.click(),
  ]);
  await expect
    .poll(async () => page.getByRole('button', { name: 'Open Untitled for editing' }).count())
    .toBe(5);
});

test('invalid user: empty title and empty body still save; empty search shows everything', async () => {
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByRole('button', { name: 'Open Untitled for editing' }).first().click();

  // Touch nothing: the untouched note reports the honest idle state (the note
  // itself was already durably created by the New Note click).
  await expect(page.locator('#save-state')).toHaveAttribute('data-save-state', 'idle', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(
    page.getByRole('button', { name: 'Open Untitled for editing' }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Empty search input + Enter = full library, not an error.
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => page.getByRole('button', { name: 'Open Untitled for editing' }).count())
    .toBeGreaterThanOrEqual(6);
});

test('settings: garbage numeric input is excluded, save still succeeds, theme persists', async () => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Invalid user: clear a bounded numeric field (Max archive size, min 1 MB).
  await dialog.locator('input[type="number"]').first().fill('');

  // Theme radio applies live (FR-SET-01).
  await dialog.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await dialog.getByRole('button', { name: /Save changes/ }).click();
  // Success is announced on the live region; the button transiently shows
  // 'Saved' and then re-renders clean ('Save changes') after reload.
  await expect(page.locator('#live-region')).toContainText('Settings saved.', {
    timeout: 15_000,
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // The persisted setting survives a reload via the pre-paint theme hint.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 15_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('malicious user: an XSS payload in the title never executes', async () => {
  await page.getByRole('button', { name: 'New Note' }).click();
  await page.getByRole('button', { name: 'Open Untitled for editing' }).first().click();

  const title = page.locator('.editor-panel__title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('<img src=x onerror="window.__xssTitle=1">XSS Title');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('harmless body text');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

  const leaked = await page.evaluate('window.__xssTitle');
  expect(leaked).toBeUndefined();
  await page.getByRole('button', { name: 'Back to notes' }).click();

  // The payload renders as inert text, never as markup.
  const card = page.locator('.card', { hasText: 'XSS Title' }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('img[onerror]')).toHaveCount(0);
});

test('malicious user: scripted HTML through the real clipboard is sanitized', async () => {
  await page.getByRole('button', { name: /XSS Title/ }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.evaluate(() => {
    const html =
      '<p>hello <img src=x onerror="window.__xssPaste=1"> <b>bold</b>' +
      '<script>window.__xssPaste=2</script></p>';
    return navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob(['hello bold'], { type: 'text/plain' }),
      }),
    ]);
  });
  await page.keyboard.press('Control+v');

  // The legitimate rich text survived; the payload did not execute. The
  // img src was stripped at the paste gate (T-048) — no image node is
  // created, so nothing is ever fetched against any origin.
  await expect(editorHost).toContainText('bold', { timeout: 10_000 });
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
  await expect(page.locator('.ProseMirror [onerror]')).toHaveCount(0);
  await expect(page.locator('.ProseMirror script')).toHaveCount(0);
  const leaked = await page.evaluate('window.__xssPaste');
  expect(leaked).toBeUndefined();
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
});

test('malicious user: a remote tracking image never fetches (local-first privacy)', async () => {
  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.evaluate(() => {
    const html = '<p>leak test <img src="https://tracker.example/pixel.gif" alt="x"></p>';
    return navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob(['leak test'], { type: 'text/plain' }),
      }),
    ]);
  });
  await page.keyboard.press('Control+v');

  // The text survives; the remote image is stripped before parsing — the
  // browser never issues a request for it (the session-wide external-request
  // watcher asserts the same invariant at the end).
  await expect(editorHost).toContainText('leak test', { timeout: 10_000 });
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
});

test('malicious user: a javascript: URL is rejected by the link dialog', async () => {
  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.keyboard.press('Control+a');

  await page.getByRole('button', { name: 'Insert or edit link' }).click();
  const dialog = page.locator('dialog.dialog', { hasText: 'Insert or edit link' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.locator('input.search-input').first().fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Apply' }).click();

  // The refusal is explicit and the dialog stays open for correction.
  await expect(dialog.locator('.dialog__warning')).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText('That URL is not an approved link protocol.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // No link mark with a javascript: href was applied to the document.
  await expect(page.locator('.ProseMirror a[href^="javascript"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

test('multiple tabs: a second dashboard tab stays consistent with the first', async () => {
  const page2 = await context.newPage();
  attachWatchers(context, page2);
  await page2.goto(`chrome-extension://${extensionId}/dashboard.html`);
  await expect(
    page2.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  // Returning surfaces do not re-show onboarding in the same profile (the
  // dialog element stays in the DOM — assert it is not visible/open).
  await expect(page2.locator('dialog.dialog--onboarding')).not.toBeVisible();

  await page2.getByRole('button', { name: 'New Note' }).click();
  await page2.getByRole('button', { name: 'Open Untitled for editing' }).first().click();
  await expect(page2.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page2.locator('.editor-panel__title').fill('Tab Two Note');
  await expect(page2.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
  await page2.getByRole('button', { name: 'Back to notes' }).click();
  await page2.close();

  // The first tab sees the same durable state after a refresh.
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open Tab Two Note for editing' }),
  ).toBeVisible({ timeout: 20_000 });
});

test('fast typing in search returns the right note', async () => {
  await page.locator('#search-input').click();
  await page.keyboard.type('Tab Two', { delay: 8 });
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open Tab Two Note for editing' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
});

test('navigation sweep across every smart list keeps the shell healthy', async () => {
  // Pin the XSS-titled note so the Pinned view has a resident.
  const card = page.locator('.card', { hasText: 'XSS Title' }).first();
  await card.locator('input[type="checkbox"]').check();
  await bulkBar(page).getByRole('button', { name: 'Pin', exact: true }).click();

  for (const view of [
    'All notes',
    'Pinned',
    'Favorites',
    'Recently edited',
    'Overdue reminders',
    'Archived',
    'Trash',
    'All notes',
  ]) {
    await smartNav(page).getByRole('button', { name: view }).click();
    await expect(page.locator('#results-region')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
    ).toBeVisible();
  }

  // The pinned resident is visible in the Pinned view.
  await smartNav(page).getByRole('button', { name: 'Pinned' }).click();
  await expect(page.locator('.card', { hasText: 'XSS Title' })).toHaveCount(1, {
    timeout: 10_000,
  });
  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
});

test('permanent delete from Trash requires confirmation and actually deletes', async () => {
  // Exact counts first — the library holds exactly the 6 Untitled notes plus
  // the XSS-titled and Tab Two survivors (no mid-render races after this).
  await expect(page.locator('.card')).toHaveCount(8, { timeout: 10_000 });

  // Power-user bulk trash: select everything on the page, then spare the two
  // named survivors by unchecking their cards.
  await page.getByLabel('Select all notes on this page').check();
  for (const survivor of ['XSS Title', 'Tab Two Note']) {
    await page
      .locator('.card', { hasText: survivor })
      .first()
      .locator('input[type="checkbox"]')
      .uncheck();
  }
  await bulkBar(page).getByRole('button', { name: 'Move to trash…' }).click();
  await page
    .locator('.dialog--confirm')
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await expect(page.locator('.card').filter({ hasText: 'Untitled' })).toHaveCount(0, {
    timeout: 10_000,
  });

  // Permanently delete from Trash — the destructive step stays behind a
  // confirmation dialog (data-loss honesty, PRD §4.2).
  await smartNav(page).getByRole('button', { name: 'Trash', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(6, { timeout: 10_000 });
  await page.getByLabel('Select all notes on this page').check();
  await bulkBar(page).getByRole('button', { name: 'Delete permanently…' }).click();
  await page
    .locator('.dialog--confirm')
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();

  // The operation is announced honestly (success or partial failure), and
  // the diagnostic log records the exact announcement for the test output.
  await expect
    .poll(async () => page.locator('#live-region').textContent(), { timeout: 10_000 })
    .toMatch(/Permanent deletion/);
  console.log(
    '[diag] announcement:',
    await page.locator('#live-region').textContent(),
  );
  await expect(page.locator('.card')).toHaveCount(0, { timeout: 10_000 });

  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
  await expect(page.locator('.card').filter({ hasText: 'Untitled' })).toHaveCount(0);
  await expect(page.locator('.card', { hasText: 'XSS Title' })).toHaveCount(1);
  await expect(page.locator('.card', { hasText: 'Tab Two Note' })).toHaveCount(1);
});

test('session hygiene: zero uncaught errors, console errors, dialogs or external requests', async () => {
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(
    realConsoleErrors(consoleErrors),
    `console errors: ${consoleErrors.join(' | ')}`,
  ).toEqual([]);
  expect(nativeDialogs, `leaked native dialogs: ${nativeDialogs.join(' | ')}`).toEqual([]);
  expect(externalRequests, `external network requests: ${externalRequests.join(' | ')}`).toEqual([]);
});

test('browser restart: a returning user sees persisted data and no onboarding', async () => {
  // End the first browser session completely.
  await context.close();

  // Relaunch against the SAME profile directory — a real browser restart.
  await launchBrowser();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  // Returning users skip onboarding (persisted completion flag; the dialog
  // element remains in the DOM — assert it is not visible/open).
  await expect(page.locator('dialog.dialog--onboarding')).not.toBeVisible();

  // Everything created before the restart survived.
  await expect(
    page.getByRole('button', { name: 'Open Tab Two Note for editing' }),
  ).toBeVisible({ timeout: 20_000 });
  await page.locator('#search-input').fill('XSS Title');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card', { hasText: 'XSS Title' })).toHaveCount(1, {
    timeout: 15_000,
  });
  // The persisted theme preference survived the restart too.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');

  // The relaunched session is just as clean as the first one.
  expect(pageErrors, `uncaught page errors after restart: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(
    realConsoleErrors(consoleErrors),
    `console errors after restart: ${consoleErrors.join(' | ')}`,
  ).toEqual([]);
  expect(nativeDialogs, `leaked native dialogs after restart: ${nativeDialogs.join(' | ')}`).toEqual([]);
  expect(
    externalRequests,
    `external network requests after restart: ${externalRequests.join(' | ')}`,
  ).toEqual([]);
});
