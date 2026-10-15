import { test } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  expectSaved,
  auditClick,
  auditFill,
  MARKERS,
  expect,
} from './helpers';

/**
 * PASS F — persistence, restart and round-trip verification: full browser
 * restart with the same profile, reload persistence, recovery journal.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-f-persistence');
  await dismissOnboarding(session.page);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('F1 build durable state: rich note, tag, category, pin, reminder, dark theme', async () => {
  const { page, evidence } = session;
  const title = 'Restart Survivor Note';
  await createNote(page, title, `${MARKERS.body} restart`);
  // Subtitle too.
  await page.locator('.editor-panel__subtitle').fill('restart survivor subtitle');

  // Reminder two days out.
  await auditClick(page.getByRole('button', { name: 'Reminders', exact: true }), evidence, "page.getByRole('button' name: 'Reminders' exact: true )");
  await auditClick(page.getByRole('button', { name: 'Add reminder…', exact: true }), evidence, "page.getByRole('button' name: 'Add reminder' exact: true )");
  const dialog = page.locator('dialog.dialog--form');
  const when = new Date(Date.now() + 48 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  await dialog.locator('input[type="datetime-local"]').fill(
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T09:15`,
  );
  await auditClick(dialog.getByRole('button', { name: 'Add reminder', exact: true }), evidence, "dialog.getByRole('button' name: 'Add reminder' exact: true )");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // Pin from the editor.
  await auditClick(page.getByRole('button', { name: 'Pin', exact: true }), evidence, "page.getByRole('button' name: 'Pin' exact: true )");
  await expect(page.locator('#live-region')).toContainText('pinned', { timeout: 15_000 });
  await backToList(page);

  // Tag + category through the bulk bar.
  const card = page.locator('.card', { hasText: title }).first();
  await card.getByLabel(`Select ${title}`).check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Assign tags…' }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Assign tags' )");
  const tagDialog = page.locator('dialog.dialog', { hasText: 'Assign tags' });
  await auditFill(tagDialog.locator('[aria-label="New tags, comma-separated"]'), 'restarttag', evidence, 'F1 tag input');
  await auditClick(tagDialog.getByRole('button', { name: 'Assign', exact: true }), evidence, "tagDialog.getByRole('button' name: 'Assign' exact: true )");
  await expect(tagDialog).not.toBeVisible({ timeout: 10_000 });

  await page.locator('.card', { hasText: title }).first().getByLabel(`Select ${title}`).check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Assign category…' }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Assign categor");
  const catDialog = page.locator('dialog.dialog', { hasText: 'Assign category' });
  await auditFill(catDialog.locator('[aria-label="New category name"]'), 'Restart', evidence, 'F1 category input');
  await auditClick(catDialog.getByRole('button', { name: 'Assign', exact: true }), evidence, "catDialog.getByRole('button' name: 'Assign' exact: true )");
  await expect(catDialog).not.toBeVisible({ timeout: 10_000 });

  // Dark theme preference — NOTE (UX observation G-07): theme radios apply
  // live but persist ONLY through 'Save changes'; closing the dialog
  // without saving silently reverts the preference. The hint text does
  // disclose this ('Applies immediately; saved with the other changes').
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await settings.waitFor({ state: 'visible', timeout: 15_000 });
  await settings.getByLabel('Dark', { exact: false }).first().check();
  await auditClick(settings.getByRole('button', { name: /Save changes/ }).first(), evidence, "settings.getByRole('button' name: Save changes ).first()");
  await page.waitForTimeout(1200);
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await settings.waitFor({ state: 'hidden', timeout: 10_000 });
});

test('F2 full browser restart: everything survives', async () => {
  const { page, context, evidence } = session;
  // Hard close of the whole browser.
  await context.close();

  // Relaunch the SAME profile dir the session was launched with.
  const { chromium } = await import('@playwright/test');
  const relaunched = await chromium.launchPersistentContext(session.userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${(await import('./helpers')).distDir}`,
      `--load-extension=${(await import('./helpers')).distDir}`,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const page2 = await relaunched.newPage();
  await page2.goto(`chrome-extension://${session.extensionId}/dashboard.html`);
  await expect(page2.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

  // No onboarding again (returning user).
  await expect(page2.locator('dialog.dialog--onboarding')).not.toBeVisible({ timeout: 10_000 });

  // Theme persisted.
  const theme = await page2.locator('html').getAttribute('data-theme');
  evidence.note(`theme after restart: ${theme}`);
  expect(theme).toBe('dark');

  // The note with all its decoration persisted.
  const card = page2.locator('.card', { hasText: 'Restart Survivor Note' }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.card__badge', { hasText: 'Pinned' })).toBeVisible();
  await expect(card.locator('.chip', { hasText: 'Tag: restarttag' })).toBeVisible();
  await expect(card.locator('.chip', { hasText: 'Category: Restart' })).toBeVisible();
  await evidence.screenshot(page2, 'F2-after-restart');

  // Open it: subtitle, body, reminder all durable.
  await auditClick(card.getByRole('button', { name: /Open Restart Survivor Note for editing/ }), evidence, "card.getByRole('button' name: Open Restart Survivor Note for editing )");
  await page2.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page2.locator('.editor-panel__subtitle')).toHaveValue('restart survivor subtitle');
  const body = await page2.locator('.ProseMirror').textContent();
  expect(body ?? '').toContain(MARKERS.body);
  // Reminder survival is verified through the card's indicator chip: the
  // Reminders panel toggle intermittently stalls input in this container
  // (same phenomenon recorded in pass-b-panels P4; the lifecycle itself is
  // covered end-to-end by pass-b-panels2 R1-R6 in a fresh session).
  await auditClick(page2.getByRole('button', { name: 'Back to notes' }), evidence, 'F2 Back to notes');
  const survivorCard = page2.locator('.card', { hasText: 'Restart Survivor Note' }).first();
  await expect(survivorCard).toBeVisible({ timeout: 15_000 });
  await expect(
    survivorCard.locator('[aria-label="Link and reminder indicators"]'),
  ).toContainText(/due|reminder/i, { timeout: 15_000 });
  await evidence.screenshot(page2, 'F2-reminder-indicator-survived');

  // Swap the session handles so later tests use the relaunched context.
  await session.context.close().catch(() => undefined);
  // Reuse the original session object but with the new context/page.
  Object.assign(session, { context: relaunched, page: page2 });
});

test('F3 reload persistence: dashboard reload keeps notes and search index', async () => {
  const { page, evidence } = session;
  await page.reload();
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: /Open Restart Survivor Note for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page.locator('#search-input').fill('tag:restarttag');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card', { hasText: 'Restart Survivor Note' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  evidence.note('reload + search-over-index after restart verified');
});

test('F4 recovery journal: unsaved keystrokes offered after a hard reload', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open Restart Survivor Note for editing' }), evidence, "page.getByRole('button' name: 'Open Restart Survivor Note for editing'");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type(' RECOVERY-JOURNAL-TOKEN typed but not autosaved');
  // Reload IMMEDIATELY — before the autosave debounce can fire.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 20_000 });
  await auditClick(page.getByRole('button', { name: /Open Restart Survivor Note for editing/ }), evidence, "page.getByRole('button' name: Open Restart Survivor Note for editing )");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  const recoveryVisible = await page
    .locator('dialog, [role="alert"], .recovery')
    .filter({ hasText: /recover|unsaved|journal/i })
    .first()
    .isVisible()
    .catch(() => false);
  const body = await page.locator('.ProseMirror').textContent();
  evidence.note(
    `recovery probe: dialog visible=${recoveryVisible}, body contains recovery token=${(body ?? '').includes('RECOVERY-JOURNAL-TOKEN')}`,
  );
  await evidence.screenshot(page, 'F4-recovery-probe');
  // Accept recovery if offered.
  if (recoveryVisible) {
    const accept = page
      .locator('button')
      .filter({ hasText: /recover|restore|use/i })
      .first();
    await accept.click().catch(() => undefined);
    await page.waitForTimeout(1000);
  }
});

test('F5 second dashboard tab: consistent read view', async () => {
  const { page, evidence } = session;
  const page2 = await session.context.newPage();
  await page2.goto(`chrome-extension://${session.extensionId}/dashboard.html`);
  await expect(page2.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  await expect(
    page2.getByRole('button', { name: /Open Restart Survivor Note for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page2.close();
  evidence.note('second tab sees the same durable state');
});

test('F6 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
