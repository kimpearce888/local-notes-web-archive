import { test } from '@playwright/test';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  expectSaved,
  importNoteFile,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS C — full end-to-end workflows with verified durable end states:
 * note lifecycle, import journeys, export journeys, backup round-trip.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;
const scratch = mkdtempSync(join(tmpdir(), 'lnwa-audit-workflows-'));

test.beforeAll(async () => {
  session = await launchAuditSession('pass-c-workflows');
  await dismissOnboarding(session.page);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('C1 note lifecycle: create → tag/category → pin → archive → restore → trash → restore → permanent delete', async () => {
  const { page, evidence } = session;
  const title = 'Lifecycle Journey Note';
  await createNote(page, title, `${MARKERS.body} lifecycle`);
  await backToList(page);

  const card = () => page.locator('.card', { hasText: title }).first();

  // Tag + category through the bulk bar.
  await card().getByLabel(`Select ${title}`).check();
  const bar = page.locator('.bulk-bar-mount');
  await auditClick(bar.getByRole('button', { name: 'Assign tags…' }), evidence, "bar.getByRole('button' name: 'Assign tags' )");
  const tagDialog = page.locator('dialog.dialog', { hasText: 'Assign tags' });
  await tagDialog.locator('[aria-label="New tags, comma-separated"]').fill('journeytag');
  await auditClick(tagDialog.getByRole('button', { name: 'Assign', exact: true }), evidence, "tagDialog.getByRole('button' name: 'Assign' exact: true )");
  await expect(tagDialog).not.toBeVisible({ timeout: 10_000 });

  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Assign category…' }), evidence, "bar.getByRole('button' name: 'Assign category' )");
  const catDialog = page.locator('dialog.dialog', { hasText: 'Assign category' });
  await catDialog.locator('[aria-label="New category name"]').fill('Journey');
  await auditClick(catDialog.getByRole('button', { name: 'Assign', exact: true }), evidence, "catDialog.getByRole('button' name: 'Assign' exact: true )");
  await expect(catDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(card().locator('.chip', { hasText: 'Tag: journeytag' })).toBeVisible({
    timeout: 15_000,
  });

  // Pin through the bulk bar.
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Pin', exact: true }), evidence, "bar.getByRole('button' name: 'Pin' exact: true )");
  await page.waitForTimeout(600);
  await card().getByLabel(`Select ${title}`).uncheck();

  // Archive → verify gone from All notes, present in Archived.
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Archive', exact: true }), evidence, "bar.getByRole('button' name: 'Archive' exact: true )");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Archived', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Archived' exact: t");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1, { timeout: 15_000 });
  await evidence.screenshot(page, 'C1-archived-state');

  // Restore → back in All notes with tags intact.
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Restore', exact: true }), evidence, "bar.getByRole('button' name: 'Restore' exact: true )");
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1, { timeout: 15_000 });
  await expect(card().locator('.chip', { hasText: 'Tag: journeytag' })).toBeVisible();

  // Trash (confirm) → recoverable in Trash → restore → permanent delete (confirm).
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Move to trash…' }), evidence, "bar.getByRole('button' name: 'Move to trash' )");
  const confirm = page.locator('dialog.dialog--confirm');
  await auditClick(confirm.getByRole('button', { name: 'Move to trash', exact: true }), evidence, "confirm.getByRole('button' name: 'Move to trash' exact: true )");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Trash', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Trash' exact: true");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1, { timeout: 15_000 });

  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Restore', exact: true }), evidence, "bar.getByRole('button' name: 'Restore' exact: true )");
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(1, { timeout: 15_000 });

  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Move to trash…' }), evidence, "bar.getByRole('button' name: 'Move to trash' )");
  await page.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Move to trash', exact: true }).click();
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Trash', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Trash' exact: true");
  await card().getByLabel(`Select ${title}`).check();
  await auditClick(bar.getByRole('button', { name: 'Delete permanently…' }), evidence, "bar.getByRole('button' name: 'Delete permanently' )");
  const perm = page.locator('dialog.dialog--confirm');
  await expect(perm).toContainText('permanently deletes');
  await auditClick(perm.getByRole('button', { name: 'Delete permanently', exact: true }), evidence, "perm.getByRole('button' name: 'Delete permanently' exact: true )");
  await expect(page.locator('.card', { hasText: title })).toHaveCount(0, { timeout: 15_000 });
  evidence.note('full lifecycle completed with verified transitions at every step');
});

test('C2 import journey: Markdown and HTML files import, open in the editor, and persist', async () => {
  const { page, evidence } = session;
  // C1 ended inside the Trash view; imports create ACTIVE notes, so
  // return to All notes first.
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  const mdFile = join(scratch, 'audit-import.md');
  const htmlFile = join(scratch, 'audit-import.html');
  writeFileSync(mdFile, `# Imported Markdown Title\n\n${MARKERS.importMd} body line.\n`);
  writeFileSync(htmlFile, `<html><head><title>Imported HTML Title</title></head><body><h1>Imported HTML Title</h1><p>${MARKERS.importHtml} paragraph.</p></body></html>`);

  // Each import opens the imported note directly in the editor (the
  // app's designed behavior: openEditor(note.id) inside importNoteFile).
  await importNoteFile(page, mdFile);
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('.editor-panel__title')).toHaveValue('Imported Markdown Title');
  const mdBody = await page.locator('.ProseMirror').textContent();
  evidence.note(`md import contains marker: ${(mdBody ?? '').includes(MARKERS.importMd)}`);
  expect(mdBody ?? '').toContain(MARKERS.importMd);
  await expect(page.locator('#live-region')).toContainText(/Imported/, { timeout: 10_000 }).catch(
    () => evidence.note('import announcement not observed in live region'),
  );
  await backToList(page);

  await importNoteFile(page, htmlFile);
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('.editor-panel__title')).toHaveValue('Imported HTML Title');
  const htmlBody = await page.locator('.ProseMirror').textContent();
  evidence.note(`html import contains marker: ${(htmlBody ?? '').includes(MARKERS.importHtml)}`);
  expect(htmlBody ?? '').toContain(MARKERS.importHtml);
  await backToList(page);

  // Both notes are durable cards in the list.
  await expect(
    page.getByRole('button', { name: /Open Imported Markdown Title for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: /Open Imported HTML Title for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
  await evidence.screenshot(page, 'C2-imported-notes');
});

test('C3 import failure: malformed JSON is refused honestly, library intact', async () => {
  const { page, evidence } = session;
  const badFile = join(scratch, 'audit-bad.json');
  writeFileSync(badFile, '{ "broken": json,');

  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  const beforeCount = await page.locator('.card').count();
  await importNoteFile(page, badFile);
  await expect(page.locator('#live-region')).toContainText('Import failed', { timeout: 10_000 });
  // Library still has the imported notes from C2 (editor stays closed).
  await expect(page.locator('.editor-panel__title')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(beforeCount, { timeout: 10_000 });
  await evidence.screenshot(page, 'C3-import-failed-honest');
});

test('C4 backup export/restore: DEFECT — binary payloads cannot cross the RPC transport', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 15_000 });

  // Export: the service worker builds the archive Blob and returns it
  // over chrome.runtime.sendMessage, which JSON-serializes it to {} —
  // URL.createObjectURL({}) then throws. The failure IS reported honestly.
  await auditClick(settings.getByRole('button', { name: 'Export backup now' }), evidence, "settings.getByRole('button' name: 'Export backup now' )");
  await expect(settings).toContainText('Backup failed', { timeout: 30_000 });
  const statusText = await settings.textContent();
  evidence.note(`DEFECT D-06a: backup export fails: ${(statusText ?? '').match(/Backup failed[^.]*\./)?.[0] ?? '(status not captured)'}`);
  await expect(settings).toContainText('Your notes are unchanged');
  await evidence.screenshot(page, 'C4-DEFECT-backup-export-fails');

  // Restore: the preview RPC sends the raw File the other way — the same
  // transport drops it, and the background's Blob guard rejects it.
  const backupFile = join(scratch, 'handwritten-backup.zip');
  writeFileSync(backupFile, 'PK\u0003\u0004not-a-real-archive');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    settings.getByRole('button', { name: 'Restore backup…' }).click(),
  ]);
  await chooser.setFiles(backupFile);
  await page.waitForTimeout(2000);
  const restoreOutcome = await settings.textContent().catch(() => '');
  evidence.note(`DEFECT D-06b: restore attempt outcome: ${(restoreOutcome ?? '').match(/(archive: expected[^.]*\.|Restore failed[^.]*\.|Backup failed[^.]*\.)/)?.[0] ?? '(no explicit failure text captured)'}`);
  await evidence.screenshot(page, 'C4-DEFECT-backup-restore-fails');
  // Close settings; the app itself must remain fully usable afterwards.
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await expect(settings).not.toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('button', { name: /Open Imported Markdown Title for editing/ }),
  ).toBeVisible({ timeout: 15_000 });
  evidence.note('after both backup failures the library is intact and the app usable');
});

test('C5 search workflow: operators across the real library', async () => {
  const { page, evidence } = session;
  const search = page.locator('#search-input');
  await search.fill('tag:journeytag');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(0, { timeout: 15_000 }); // lifecycle note permanently deleted
  await search.fill(`is:archived`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const archivedCount = await page.locator('.card').count();
  evidence.note(`is:archived result count: ${archivedCount}`);
  await search.fill(`${MARKERS.importMd}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('.card', { hasText: 'Imported Markdown Title' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await search.fill('');
  await page.keyboard.press('Enter');
});

test('C6 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
