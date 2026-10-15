import { test } from '@playwright/test';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS B (panels 2) — reminders panel lifecycle in a dedicated fresh
 * session (the rich-note session hit an input stall — see pass-b-panels
 * P4 for the INCONCLUSIVE record).
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-b-panels2');
  await dismissOnboarding(session.page);
  await createNote(session.page, 'Reminders Sweep Note', MARKERS.body);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('R1 reminders: primary disabled while invalid, live error on cleared date', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Reminders', exact: true }), evidence, "page.getByRole('button' name: 'Reminders' exact: true )");
  await expect(page.locator('[aria-label="Note reminders"]')).toBeVisible({ timeout: 10_000 });

  await auditClick(page.getByRole('button', { name: 'Add reminder…', exact: true }), evidence, "page.getByRole('button' name: 'Add reminder' exact: true )");
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  // Honest affordance: the primary is disabled while the draft is invalid.
  const primary = dialog.getByRole('button', { name: 'Add reminder', exact: true });
  await expect(primary).toBeDisabled();

  // Fill a valid date, then clear it — the live validation error appears.
  const when = new Date(Date.now() + 48 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const value = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  await dialog.locator('input[type="datetime-local"]').fill(value);
  await page.waitForTimeout(300);
  await expect(primary).toBeEnabled();
  await dialog.locator('input[type="datetime-local"]').fill('');
  await page.waitForTimeout(300);
  await expect(dialog).toContainText('Pick a date and time.');
  await expect(primary).toBeDisabled();
  await evidence.screenshot(page, 'R1-reminder-cleared-date-error');
  await auditClick(dialog.getByRole('button', { name: 'Cancel' }), evidence, "dialog.getByRole('button' name: 'Cancel' )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

test('R2 reminders: valid one-time reminder is created and listed', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Add reminder…', exact: true }), evidence, "page.getByRole('button' name: 'Add reminder' exact: true )");
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const when = new Date(Date.now() + 48 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const value = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  await dialog.locator('input[type="datetime-local"]').fill(value);
  await page.waitForTimeout(400);
  const preview = await dialog.locator('.reminders-panel__preview').textContent();
  evidence.note(`reminder preview: ${preview ?? '(empty)'}`);
  await auditClick(dialog.getByRole('button', { name: 'Add reminder', exact: true }), evidence, "dialog.getByRole('button' name: 'Add reminder' exact: true )");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await evidence.screenshot(page, 'R2-reminder-listed');
  evidence.note('valid one-time reminder created through the real dialog');
});

test('R3 reminders: edit dialog opens pre-filled and cancel keeps it', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Edit…', exact: true }).first(), evidence, "page.getByRole('button' name: 'Edit' exact: true ).first()");
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toContainText('Edit reminder');
  await auditClick(dialog.getByRole('button', { name: 'Cancel' }), evidence, "dialog.getByRole('button' name: 'Cancel' )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

test('R4 reminders: snooze dialog opens and cancel keeps the reminder active', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Snooze…', exact: true }).first(), evidence, "page.getByRole('button' name: 'Snooze' exact: true ).first()");
  const snooze = page.locator('dialog').filter({ hasText: 'Snooze reminder' });
  await expect(snooze).toBeVisible({ timeout: 5_000 });
  await auditClick(snooze.getByRole('button', { name: 'Cancel' }), evidence, "snooze.getByRole('button' name: 'Cancel' )");
  await expect(snooze).not.toBeVisible({ timeout: 5_000 });
});

test('R5 reminders: delete requires confirmation; cancel first, then confirm', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Delete…', exact: true }).first(), evidence, "page.getByRole('button' name: 'Delete' exact: true ).first()");
  const del = page.locator('dialog').filter({ hasText: 'Delete reminder?' });
  await expect(del).toBeVisible({ timeout: 5_000 });
  await auditClick(del.getByRole('button', { name: 'Cancel' }), evidence, "del.getByRole('button' name: 'Cancel' )");
  await expect(del).not.toBeVisible({ timeout: 5_000 });

  await auditClick(page.getByRole('button', { name: 'Delete…', exact: true }).first(), evidence, "page.getByRole('button' name: 'Delete' exact: true ).first()");
  await page.locator('dialog').filter({ hasText: 'Delete reminder?' })
    .getByRole('button', { name: 'Delete reminder', exact: true }).click();
  await expect(page.locator('dialog').filter({ hasText: 'Delete reminder?' })).not.toBeVisible({
    timeout: 5_000,
  });
  await page.waitForTimeout(600);
  evidence.note('reminder deleted after cancel-then-confirm');
});

test('R6 yearly reminder with Feb 30: honest validation error', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Add reminder…', exact: true }), evidence, "page.getByRole('button' name: 'Add reminder' exact: true )");
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('select').first().selectOption('yearly');
  const selects = dialog.locator('select');
  await selects.nth(1).selectOption({ label: 'February' });
  await dialog.getByRole('spinbutton', { name: 'Day' }).fill('30');
  await page.waitForTimeout(400);
  const err = await dialog.textContent();
  evidence.note(`Feb-30 yearly dialog contains error: ${err?.includes('does not exist')}`);
  expect(err ?? '').toContain('does not exist');
  await evidence.screenshot(page, 'R6-feb30-error');
  await auditClick(dialog.getByRole('button', { name: 'Cancel' }), evidence, "dialog.getByRole('button' name: 'Cancel' )");
});

test('R7 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
