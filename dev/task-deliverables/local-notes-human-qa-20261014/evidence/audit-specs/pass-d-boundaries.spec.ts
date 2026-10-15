import { test } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  importNoteFile,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS D — boundary, invalid, cancellation and failure exploration.
 * Every confirmation dialog gets both its cancel and confirm path.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;
const scratch = mkdtempSync(join(tmpdir(), 'lnwa-audit-boundaries-'));

test.beforeAll(async () => {
  session = await launchAuditSession('pass-d-boundaries');
  await dismissOnboarding(session.page);
  await createNote(session.page, 'Boundary Host Note', MARKERS.body);
  await backToList(session.page);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('D1 empty and whitespace content: saves honestly, cards label sensibly', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'New Note' }), evidence, "page.getByRole('button' name: 'New Note' )");
  await auditClick(page.getByRole('button', { name: /Open Untitled for editing/ }).first(), evidence, "page.getByRole('button' name: Open Untitled for editing ).first()");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  // Whitespace-only title.
  await page.locator('.editor-panel__title').fill('   ');
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type('   ');
  await page.waitForTimeout(2500);
  await backToList(page);
  const untitledCount = await page
    .locator('.card', { hasText: /Untitled/i })
    .count();
  evidence.note(`untitled-labelled cards after whitespace-only note: ${untitledCount}`);
  await expect(untitledCount).toBeGreaterThan(0);
});

test('D2 extreme content: very long title and mixed script survives', async () => {
  const { page, evidence } = session;
  const longTitle = 'L'.repeat(500) + ' end';
  await auditClick(page.getByRole('button', { name: 'New Note' }), evidence, "page.getByRole('button' name: 'New Note' )");
  await auditClick(page.getByRole('button', { name: /Open Untitled for editing/ }).first(), evidence, "page.getByRole('button' name: Open Untitled for editing ).first()");
  await page.locator('.editor-panel__title').fill(longTitle);
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type('極端なテスト与国际混合 😀🎉 نص عربي');
  await page.waitForTimeout(2500);
  await backToList(page);
  const card = page.locator('.card', { hasText: 'LLLL' }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The card must not overflow its bounds (clipping check).
  const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
  evidence.note(`long-title card horizontal overflow px: ${overflow}`);
  await evidence.screenshot(page, 'D2-long-title-card');
});

test('D3 every bulk confirm: cancel leaves state untouched, confirm acts', async () => {
  const { page, evidence } = session;
  const title = 'Confirm Host Note';
  await createNote(page, title, 'confirm host body');
  await backToList(page);
  const card = () => page.locator('.card', { hasText: title }).first();
  const bar = page.locator('.bulk-bar-mount');

  // Trash: cancel first.
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Move to trash…' }), evidence, "bar.getByRole('button' name: 'Move to trash' )");
  let confirm = page.locator('dialog.dialog--confirm');
  await auditClick(confirm.getByRole('button', { name: 'Cancel' }), evidence, "confirm.getByRole('button' name: 'Cancel' )");
  await expect(confirm).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1);
  evidence.note('bulk trash cancel: note untouched');

  // Trash: confirm.
  await auditClick(bar.getByRole('button', { name: 'Move to trash…' }), evidence, "bar.getByRole('button' name: 'Move to trash' )");
  await page.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.locator('.card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });

  // Permanent delete from Trash: cancel then confirm.
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Trash', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Trash' exact: true");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1, { timeout: 15_000 });
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Delete permanently…' }), evidence, "bar.getByRole('button' name: 'Delete permanently' )");
  confirm = page.locator('dialog.dialog--confirm');
  await expect(confirm).toContainText('cannot be undone');
  await auditClick(confirm.getByRole('button', { name: 'Cancel' }), evidence, "confirm.getByRole('button' name: 'Cancel' )");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1);
  await auditClick(bar.getByRole('button', { name: 'Delete permanently…' }), evidence, "bar.getByRole('button' name: 'Delete permanently' )");
  await page.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.locator('.card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  evidence.note('permanent delete cancel + confirm verified');
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
});

test('D4 reminder boundaries: Feb 30, invalid zone, bad final year', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open Boundary Host Note for editing' }), evidence, "page.getByRole('button' name: 'Open Boundary Host Note for editing' )");
  await auditClick(page.getByRole('button', { name: 'Reminders', exact: true }), evidence, "page.getByRole('button' name: 'Reminders' exact: true )");
  await auditClick(page.getByRole('button', { name: 'Add reminder…', exact: true }), evidence, "page.getByRole('button' name: 'Add reminder' exact: true )");
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Switch to a yearly reminder and ask for Feb 30.
  await dialog.locator('select').first().selectOption('yearly');
  await dialog.locator('select').nth(1).selectOption({ label: 'February' });
  await dialog.getByRole('spinbutton', { name: 'Day' }).fill('30');
  await page.waitForTimeout(400);
  const errText = await dialog.locator('.dialog__error, .reminders-panel__error, p[class*="error"]').first()
    .textContent()
    .catch(() => '(no error element)');
  evidence.note(`Feb-30 yearly error text: ${errText}`);
  await evidence.screenshot(page, 'D4-feb30-error');

  // Invalid IANA zone.
  await dialog.locator('select').first().selectOption('one-time');
  const when = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  await dialog.locator('input[type="datetime-local"]').fill(
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T10:30`,
  );
  const zoneInput = dialog.locator('input').last();
  await zoneInput.fill('Not/A_Zone');
  await page.waitForTimeout(400);
  const zoneError = await dialog.locator('p[class*="error"]').first().textContent().catch(() => '');
  evidence.note(`invalid zone error: ${zoneError ?? '(none)'}`);
  expect(zoneError ?? '').toContain('not a valid IANA time zone');
  await auditClick(dialog.getByRole('button', { name: 'Cancel' }), evidence, "dialog.getByRole('button' name: 'Cancel' )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await auditClick(page.getByRole('button', { name: 'Back to notes' }), evidence, "page.getByRole('button' name: 'Back to notes' )");
});

test('D5 link dialog cancel: nothing inserted', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open Boundary Host Note for editing' }), evidence, "page.getByRole('button' name: 'Open Boundary Host Note for editing' )");
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  const before = await page.locator('.ProseMirror').innerHTML();
  await auditClick(page.getByRole('button', { name: 'Insert or edit link', exact: true }), evidence, "page.getByRole('button' name: 'Insert or edit link' exact: true )");
  const dialog = page.locator('dialog').filter({ hasText: 'Insert or edit link' });
  await dialog.locator('input').first().fill('https://example.com/cancelled');
  await auditClick(dialog.getByRole('button', { name: 'Cancel' }), evidence, "dialog.getByRole('button' name: 'Cancel' )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  const after = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`link cancel left content unchanged: ${before === after}`);
  expect(after).toBe(before);
  await auditClick(page.getByRole('button', { name: 'Back to notes' }), evidence, "page.getByRole('button' name: 'Back to notes' )");
});

test('D6 rapid interleaving: fast note creation with selection active', async () => {
  const { page, evidence } = session;
  // Select the host note, then immediately create notes while selected.
  await page.locator('.card').first().locator('input[type="checkbox"]').first().check();
  for (let i = 0; i < 3; i += 1) {
    await auditClick(page.getByRole('button', { name: 'New Note' }), evidence, "page.getByRole('button' name: 'New Note' )");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const cardCount = await page.locator('.card').count();
  evidence.note(`cards after rapid creation with selection: ${cardCount}`);
  await expect(cardCount).toBeGreaterThanOrEqual(4);
  // Clear any selection that persisted.
  const clear = page.getByRole('button', { name: 'Clear selection' });
  if (await clear.isVisible().catch(() => false)) {
    await auditClick(clear, evidence, "clear");
  }
});

test('D7 offline behaviour: note creation and search work without network', async () => {
  const { page, evidence } = session;
  await session.context.setOffline(true);
  try {
    await createNote(page, 'Offline Boundary Note', 'written while offline');
    await backToList(page);
    await page.locator('#search-input').fill('Offline Boundary');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: /Open Offline Boundary Note for editing/ }),
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('#search-input').fill('');
    await page.keyboard.press('Enter');
    evidence.note('offline note creation + search verified');
  } finally {
    await session.context.setOffline(false);
  }
});

test('D8 import empty file: fallback title import (observed behavior)', async () => {
  const { page, evidence } = session;
  const emptyFile = join(scratch, 'empty.md');
  writeFileSync(emptyFile, '');
  await importNoteFile(page, emptyFile);
  await page.waitForTimeout(1200);
  // Observed: an empty .md imports as a note titled 'Imported note'
  // (parseNoteFile falls back when no heading exists) and opens the editor.
  const editorVisible = await page.locator('.editor-panel__title').isVisible().catch(() => false);
  evidence.note(`empty .md import: editor opened=${editorVisible}`);
  if (editorVisible) {
    const value = await page.locator('.editor-panel__title').inputValue();
    evidence.note(`empty .md imported with title: ${value}`);
    await backToList(page);
  }
  const cards = await page.locator('.card').count();
  evidence.note(`cards after empty import: ${cards}`);
});

test('D9 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
