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
 * PASS A — Unscripted discovery (brief §4 Pass A).
 * A first-time user on a clean profile follows visible cues only.
 * Every observation is recorded as evidence; nothing is created through
 * internal paths.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-a-discovery');
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('A1 first run: the app presents itself honestly to a new user', async () => {
  const { page, evidence } = session;
  const heading = page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' });
  await expect(heading).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });

  // The onboarding dialog is the first thing a new user must meet.
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await expect(onboarding).toContainText('Welcome to Local Notes & Web Archive');
  // Both advertised exits exist and are enabled.
  await expect(onboarding.getByRole('button', { name: 'Get started' })).toBeEnabled();
  await expect(onboarding.getByRole('button', { name: 'Open Settings first' })).toBeEnabled();
  await evidence.screenshot(page, 'A1-first-run-onboarding');
  evidence.note('onboarding visible with both exits enabled');
});

test('A2 first run: "Open Settings first" leads to Settings as promised', async () => {
  const { page, evidence } = session;
  const onboarding = page.locator('dialog.dialog--onboarding');
  await auditClick(onboarding.getByRole('button', { name: 'Open Settings first' }), evidence, "onboarding.getByRole('button' name: 'Open Settings first' )");
  const settings = page.locator('dialog.dialog--settings, dialog[aria-labelledby="settings-title"]');
  await expect(settings.first()).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot(page, 'A2-settings-from-onboarding');
  // A first-time user closes it and moves on.
  await auditClick(settings.first().getByRole('button', { name: 'Close' }), evidence, "settings.first().getByRole('button' name: 'Close' )");
  await expect(settings.first()).not.toBeVisible({ timeout: 10_000 });
});

test('A3 empty library: the honest empty state, no confusing controls', async () => {
  const { page, evidence } = session;
  // Onboarding still open (A2 closed only settings). Dismiss it now.
  const onboarding = page.locator('dialog.dialog--onboarding');
  if (await onboarding.isVisible()) {
    await auditClick(onboarding.getByRole('button', { name: 'Get started' }), evidence, "onboarding.getByRole('button' name: 'Get started' )");
    await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
  }
  // The empty library communicates itself.
  await expect(page.locator('#results-count')).toBeVisible();
  const countText = await page.locator('#results-count').textContent();
  evidence.note(`empty-library results-count text: ${countText ?? '(none)'}`);
  await evidence.screenshot(page, 'A3-empty-library');

  // A first-time user explores every smart list — all must be honest empty.
  const lists = ['Pinned', 'Favorites', 'Recently edited', 'Overdue reminders', 'Archived', 'Trash'];
  for (const list of lists) {
    await auditClick(page.locator('.smart-nav').getByRole('button', { name: list, exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: list exact: true )");
    await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 10_000 });
    await expect(
      page.locator('.card'),
      `${list} must be empty on a fresh profile`,
    ).toHaveCount(0);
  }
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes' }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' )");
  evidence.note('all seven smart lists visited; six empty lists render honestly');
});

test('A4 first search on an empty library: honest no-results state', async () => {
  const { page, evidence } = session;
  await page.locator('#search-input').fill('anything');
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 10_000 });
  await expect(page.locator('.card')).toHaveCount(0);
  await evidence.screenshot(page, 'A4-empty-search');
  // Clearing search restores the (empty) library view.
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  evidence.note('empty-library search shows zero cards, no error');
});

test('A5 first note: follow the primary cue end to end', async () => {
  const { page, evidence } = session;
  await createNote(page, MARKERS.title, MARKERS.body);
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 25_000 });
  await evidence.screenshot(page, 'A5-first-note-editor');
  await auditClick(page.getByRole('button', { name: 'Back to notes' }), evidence, "page.getByRole('button' name: 'Back to notes' )");
  await expect(
    page.getByRole('button', { name: `Open ${MARKERS.title} for editing` }),
  ).toBeVisible({ timeout: 15_000 });
  await evidence.screenshot(page, 'A5-first-note-card');
  evidence.note('first note created through the UI only and durable');
});

test('A6 dead-end probe: every visible primary control answers', async () => {
  const { page, evidence } = session;
  // Import: accessible name comes from the aria-label; a real user gets
  // a native file chooser which Playwright cancels (no listener attached).
  const importButton = page.getByRole('button', {
    name: 'Import a note file (JSON, Markdown or HTML)',
  });
  await expect(importButton).toBeVisible();
  await auditClick(importButton, evidence, "importButton");
  await page.waitForTimeout(300);

  // Settings opens its dialog; a first-time user closes it.
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot(page, 'A6-settings-dialog');
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await expect(settings).not.toBeVisible({ timeout: 10_000 });

  // Diagnostics opens its page-dialog; close it too.
  await auditClick(page.getByRole('button', { name: 'Open the diagnostics page' }), evidence, "page.getByRole('button' name: 'Open the diagnostics page' )");
  const diagnostics = page.locator('dialog[aria-labelledby="diagnostics-title"]');
  await expect(diagnostics).toBeVisible({ timeout: 10_000 });
  await evidence.screenshot(page, 'A6-diagnostics-dialog');
  await auditClick(diagnostics.getByRole('button', { name: 'Close' }), evidence, "diagnostics.getByRole('button' name: 'Close' )");
  await expect(diagnostics).not.toBeVisible({ timeout: 10_000 });
  // Filters button — the brief asks: does it do anything?
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await expect(filters).toBeVisible();
  await auditClick(filters, evidence, "filters");
  await page.waitForTimeout(300);
  const expanded = await filters.getAttribute('aria-expanded');
  const regionVisible = await page.locator('#filters-region').isVisible();
  const regionChildren = await page.locator('#filters-region').evaluate(
    (el) => el.children.length,
  );
  evidence.note(
    `Filters clicked: aria-expanded=${expanded}, region visible=${regionVisible}, region child elements=${regionChildren}`,
  );
  await evidence.screenshot(page, 'A6-filters-disclosure-open');
  await auditClick(filters, evidence, "filters");
  evidence.note('Filters toggled closed again');
  // Command palette trigger is discoverable in the topbar.
  await auditClick(page.getByRole('button', { name: 'Open command palette (Ctrl+K)' }), evidence, "page.getByRole('button' name: 'Open command palette (CtrlK)' )");
  const palette = page.locator('dialog.dialog--command-palette');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await evidence.screenshot(page, 'A6-command-palette');
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible({ timeout: 5_000 });
});

test('A7 session hygiene: the discovery pass stays clean', async () => {
  const { evidence } = session;
  evidence.note(`pageErrors=${evidence.pageErrors.length}, consoleErrors=${evidence.consoleErrors.length}, externalRequests=${evidence.externalRequests.length}, windowDialogs=${evidence.windowDialogs.length}`);
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
