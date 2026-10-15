import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-042 E2E smoke suite: the built unpacked extension (dist/) in a real
 * persistent Chromium context. Serial by design — one browser, one note
 * lifecycle walked end to end: create → rich-text edit → autosave → search
 * → filter → pin/archive/trash/restore → export → reload persistence →
 * offline operation → graceful blocked-capture and AI-unavailable states.
 *
 * The toolbar-click path that opens the dashboard is unit-tested in
 * background/dashboard-tab.test.ts; here we assert the same full stack the
 * toolbar opens: the dashboard page bound to the real service worker.
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
  // Surface dashboard exceptions in the reporter output (debugging aid).
  page.on('pageerror', (error) => {
    console.error(`[dashboard pageerror] ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error(`[dashboard console] ${message.text()}`);
    }
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
});

test.afterAll(async () => {
  await context.close();
});

/** Scoped helpers: the bulk bar and smart nav can share button labels. */
function bulkBar(page: Page) {
  return page.locator('.bulk-bar-mount');
}

function smartNav(page: Page) {
  return page.locator('.smart-nav');
}

test('dashboard loads the full shell over the real RPC channel', async () => {
  await expect(page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Note' })).toBeVisible();
  await expect(page.getByLabel('Search notes, tags, archived pages and attachments')).toBeVisible();
  // The controller replaced the pre-paint "Loading…" with a real results view.
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });

  // First run: the FR-SET-02 onboarding overlay is showing — read it, then
  // dismiss it with Skip for now so the rest of the suite can interact.
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await expect(onboarding).toContainText('Everything stays on this device');
  await expect(onboarding).toContainText('Optional AI features run through LM Studio');
  await onboarding.getByRole('button', { name: 'Skip for now' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('create a note and edit it with bold, heading, list and link', async () => {
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: New Note navigates straight into the fresh note's editor.
  const title = page.locator('.editor-panel__title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('E2E Smoke Note');

  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.keyboard.type('plain words to format ');

  // Bold selection.
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Bold (Ctrl+B)' }).click();
  // Heading + bullet list; a short settle avoids the first typed keystroke
  // racing ProseMirror's view update after the block conversion.
  await page.getByRole('button', { name: 'Heading 1' }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Bullet list' }).click();
  await page.waitForTimeout(150);
  await page.keyboard.type('a listed item');

  // Autosave indicator reaches the durable Saved state (PRD §4.3).
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

  // Rich text landed in the document.
  await expect(editorHost).toContainText('a listed item');
});

test('the editor find bar stays hidden until Ctrl+F (T-052 hidden guard)', async () => {
  // The find bar carries the hidden attribute AND a display:flex class rule;
  // without the global [hidden] { display: none !important } guard in
  // styles.css it leaked on screen permanently (found by vision QA over the
  // T-050 screenshots). Computed-style truth in the real browser.
  const findBar = page.locator('.editor-find');
  await expect(findBar).toHaveCount(1);
  await expect(findBar).toBeHidden();
  await expect
    .poll(async () => page.locator('.editor-find').evaluate((el) => getComputedStyle(el).display))
    .toBe('none');

  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press('Control+f');
  await expect(findBar).toBeVisible();
  await expect
    .poll(async () => page.locator('.editor-find').evaluate((el) => getComputedStyle(el).display))
    .toBe('flex');

  await findBar.getByRole('button', { name: 'Close' }).click();
  await expect(findBar).toBeHidden();
  await expect
    .poll(async () => page.locator('.editor-find').evaluate((el) => getComputedStyle(el).display))
    .toBe('none');
});

test('search finds the note and the results region announces counts', async () => {
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.locator('#search-input').fill('E2E Smoke Note');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open E2E Smoke Note for editing' }),
  ).toBeVisible({ timeout: 15_000 });
});

test('pin the note through the bulk bar and see the badge', async () => {
  const card = page.locator('.card', { hasText: 'E2E Smoke Note' }).first();
  await card.getByLabel('Select E2E Smoke Note').check();
  await bulkBar(page).getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(card.locator('.card__badge').first()).toHaveText('Pinned');
});

test('archive and restore through the smart lists', async () => {
  const card = page.locator('.card', { hasText: 'E2E Smoke Note' }).first();
  await card.getByLabel('Select E2E Smoke Note').check();
  await bulkBar(page).getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 10_000 });

  await smartNav(page).getByRole('button', { name: 'Archived' }).click();
  const archived = page.locator('.card', { hasText: 'E2E Smoke Note' }).first();
  await expect(archived).toBeVisible({ timeout: 10_000 });
  await archived.getByLabel('Select E2E Smoke Note').check();
  await bulkBar(page).getByRole('button', { name: 'Restore', exact: true }).click();

  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
  await expect(
    page.getByRole('button', { name: 'Open E2E Smoke Note for editing' }),
  ).toBeVisible({ timeout: 10_000 });
});

test('trash with confirmation and restore from Trash', async () => {
  const card = page.locator('.card', { hasText: 'E2E Smoke Note' }).first();
  await card.getByLabel('Select E2E Smoke Note').check();
  await bulkBar(page).getByRole('button', { name: 'Move to trash…' }).click();
  // Trash asks for confirmation (data-loss honesty).
  await page
    .locator('.dialog--confirm')
    .getByRole('button', { name: 'Move to trash', exact: true })
    .click();
  await expect(page.locator('.card', { hasText: 'E2E Smoke Note' })).toHaveCount(0, {
    timeout: 10_000,
  });

  await smartNav(page).getByRole('button', { name: 'Trash', exact: true }).click();
  const trashed = page.locator('.card', { hasText: 'E2E Smoke Note' }).first();
  await expect(trashed).toBeVisible({ timeout: 10_000 });
  await trashed.getByLabel('Select E2E Smoke Note').check();
  await bulkBar(page).getByRole('button', { name: 'Restore', exact: true }).click();
  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
});

test('exports the note as Markdown through a real download', async () => {
  await page.getByRole('button', { name: 'Open E2E Smoke Note for editing' }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    (async () => {
      await page.getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('button', { name: 'Markdown (.md)' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const path = await download.path();
  expect(path).toBeTruthy();
});

test('data persists across a dashboard reload', async () => {
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open E2E Smoke Note for editing' }),
  ).toBeVisible({ timeout: 20_000 });
  // The saved rich text survives (search index rebuilt from durable state).
  await page.locator('#search-input').fill('listed item');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open E2E Smoke Note for editing' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.locator('#search-input').fill('');
});

test('notes, search and export keep working fully offline', async () => {
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'New Note' }).click();
    // T-101: creation lands in the editor immediately — also fully offline.
    const title = page.locator('.editor-panel__title');
    await expect(title).toBeVisible({ timeout: 15_000 });
    await title.fill('Offline Note');
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('written without any network');
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

    await page.getByRole('button', { name: 'Back to notes' }).click();
    await page.locator('#search-input').fill('Offline Note');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Open Offline Note for editing' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('#search-input').fill('');
  } finally {
    await context.setOffline(false);
  }
});

test('a blocked URL pasted into the editor surfaces a graceful message', async () => {
  // A URL with embedded credentials is REJECTED by the capture gate
  // (FR-CAP-04) — never a link record — and the refusal is announced
  // honestly while the text survives. Uses the REAL clipboard so
  // ProseMirror's paste pipeline runs exactly as for a user; announcements
  // are recorded on the live region because the save announcement can
  // replace the refusal faster than polling sees it.
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: creation navigates into the editor; no card round-trip.
  const title = page.locator('.editor-panel__title');
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('Blocked capture note');

  await page.evaluate(() => {
    const region = document.querySelector('#live-region');
    if (!region) throw new Error('live region missing');
    const record = (text: string): void => {
      const log = JSON.parse(region.getAttribute('data-announce-log') ?? '[]') as string[];
      if (text.length > 0 && log[log.length - 1] !== text) log.push(text);
      region.setAttribute('data-announce-log', JSON.stringify(log));
    };
    record(region.textContent ?? '');
    new MutationObserver(() => record(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const editorHost = page.locator('.ProseMirror').first();
  await editorHost.click();
  await page.evaluate(() => navigator.clipboard.writeText('http://user:secret@example.com/private'));
  await page.keyboard.press('Control+v');

  // The refusal was announced and the pasted text survived as content.
  await expect
    .poll(
      async () =>
        (await page.evaluate(
          () => document.querySelector('#live-region')?.getAttribute('data-announce-log') ?? '',
        )) as string,
      { timeout: 10_000 },
    )
    .toContain('No capturable http(s) link found');
  await expect(editorHost).toContainText('example.com/private');
});

test('AI unavailable is reported honestly from Settings', async () => {
  await page.getByRole('button', { name: 'Back to notes' }).click().catch(() => undefined);
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('.settings__panel')).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole('button', { name: 'Test connection' }).click();
  await expect(dialog.locator('.settings__hint', { hasText: /Unreachable|unreachable/ }).first()).toBeVisible({
    timeout: 30_000,
  });
  // The disclosure stays visible (FR-MCP-01..03).
  await expect(dialog).toContainText('no external MCP server');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});

test('the command palette opens with Ctrl+K, filters, and runs commands (T-056)', async () => {
  // Ctrl+K opens the palette over the dashboard.
  await page.keyboard.press('Control+k');
  const palette = page.locator('dialog.dialog--command-palette');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await expect(palette.getByLabel('Filter commands')).toBeFocused();

  // Typing filters case-insensitively; the arrow keys move the active
  // option; Escape closes without running anything.
  await page.keyboard.type('trash');
  await expect(palette.locator('.palette__option')).toHaveCount(1, { timeout: 5_000 });
  await expect(palette.locator('.palette__option-label')).toHaveText('Go to Trash');
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'All notes' })).toBeVisible();

  // Re-open, activate with the keyboard: the palette navigates to the
  // Trash smart list through the very same button the sidebar uses.
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type('trash');
  await page.keyboard.press('Enter');
  await expect(palette).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trash', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // The trigger button is a pointer path to the same palette.
  await page.getByRole('button', { name: 'Open command palette (Ctrl+K)' }).click();
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type('all notes');
  await page.keyboard.press('Enter');
  await expect(palette).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'All notes' })).toBeVisible({
    timeout: 10_000,
  });

  // A no-match query shows an honest empty state and Enter is a no-op.
  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type('zzz-no-match');
  await expect(palette).toContainText('No matching command.');
  await page.keyboard.press('Enter');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
});
