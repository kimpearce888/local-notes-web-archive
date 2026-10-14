import { test } from '@playwright/test';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  expectSaved,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS E — cross-feature and timing exploration: selection vs navigation,
 * search + bulk, multi-tab same-note conflicts, editor + background
 * changes, theme mid-work, pinned/archived interplay.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-e-crossfeature');
  await dismissOnboarding(session.page);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('X1 selection survives view navigation? (state boundary probe)', async () => {
  const { page, evidence } = session;
  const a = 'Crossalpha Journey Note';
  const b = 'Crossbeta Journey Note';
  await createNote(page, a, `${MARKERS.body} crossalpha`);
  await backToList(page);
  await createNote(page, b, `${MARKERS.body} crossbeta`);
  await backToList(page);

  // Select note A, then navigate to another smart list.
  await page.locator('.card', { hasText: a }).first().getByLabel(`Select ${a}`).check();
  const barVisibleAfterSelect = await page.locator('.bulk-bar-mount').isVisible();
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Pinned', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Pinned' exact: tru");
  await page.waitForTimeout(600);
  const barVisibleInPinned = await page.locator('.bulk-bar-mount').isVisible();
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  await page.waitForTimeout(600);
  const stillChecked = await page
    .locator('.card', { hasText: a })
    .first()
    .getByLabel(`Select ${a}`)
    .isChecked();
  evidence.note(
    `selection probe: bar after select=${barVisibleAfterSelect}, bar in Pinned=${barVisibleInPinned}, still checked after return=${stillChecked}`,
  );
  // Clean up any lingering selection.
  const clear = page.getByRole('button', { name: 'Clear selection' });
  if (await clear.isVisible().catch(() => false)) {
    await auditClick(clear, evidence, "clear");
  }
});

test('X2 search + bulk action: archive from filtered results only', async () => {
  const { page, evidence } = session;
  await page.locator('#search-input').fill('crossalpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(1, { timeout: 15_000 });
  await page.locator('.card').first().locator('input[type="checkbox"]').first().check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Archive', exact: true }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Archive' exact");
  await expect(page.locator('.card')).toHaveCount(0, { timeout: 15_000 });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const titles = await page.locator('.card .card__title').allTextContents();
  evidence.note(`card titles after clearing search: ${JSON.stringify(titles)}`);
  // B remains; A is in Archived.
  await expect(page.locator('.card', { hasText: bOf() })).toHaveCount(1, { timeout: 15_000 });
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Archived', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Archived' exact: t");
  await expect(page.locator('.card', { hasText: 'Crossalpha Journey Note' })).toHaveCount(1, {
    timeout: 15_000,
  });
  // Restore for later tests.
  await page.locator('.card', { hasText: 'Crossalpha Journey Note' }).first()
    .getByLabel('Select Crossalpha Journey Note').check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Restore', exact: true }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Restore' exact");
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  evidence.note('search+bulk archive scoped correctly; restored afterwards');
});

function bOf(): string {
  return 'Crossbeta Journey Note';
}

test('X3 multi-tab same note: the conflict dialog is honest', async () => {
  const { page, evidence } = session;
  // Tab 1 opens the note.
  await auditClick(page.getByRole('button', { name: 'Open Crossbeta Journey Note for editing' }), evidence, "page.getByRole('button' name: 'Open Crossbeta Journey Note for editing");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });

  // Tab 2 opens the SAME note and saves new content.
  const page2 = await session.context.newPage();
  await page2.goto(`chrome-extension://${session.extensionId}/dashboard.html`);
  await expect(page2.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  await auditClick(page2.getByRole('button', { name: 'Open Crossbeta Journey Note for editing' }), evidence, "page2.getByRole('button' name: 'Open Crossbeta Journey Note for editin");
  await page2.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await auditClick(page2.locator('.ProseMirror').first(), evidence, "page2.locator('.ProseMirror').first()");
  await page2.keyboard.type(' tab-two edit');
  await expectSaved(page2);

  // Tab 1 now edits and saves — a conflict must surface honestly.
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type(' tab-one conflicting edit');
  await expectSaved(page).catch(() => undefined);
  await page.waitForTimeout(1500);
  const conflictVisible = await page
    .locator('dialog')
    .filter({ hasText: 'changed in another tab' })
    .isVisible()
    .catch(() => false);
  const announcement = await page.locator('#live-region').textContent().catch(() => '');
  evidence.note(
    `conflict probe: dialog visible=${conflictVisible}, announcement=${(announcement ?? '').slice(0, 200)}`,
  );
  await page
    .locator('[aria-label="Find and replace in note"]')
    .screenshot({ path: '/dev/null' })
    .catch(() => undefined);
  await evidence.screenshot(page, 'X3-conflict-state');

  // Resolve by reloading the remote version if the dialog is present.
  if (conflictVisible) {
    const conflict = page.locator('dialog').filter({ hasText: 'changed in another tab' });
    const reload = conflict.getByRole('button', { name: /Reload|Load the newest/i }).first();
    if (await reload.isVisible().catch(() => false)) {
      await auditClick(reload, evidence, "reload");
    } else {
      await page.keyboard.press('Escape');
    }
  }
  await page2.close().catch(() => undefined);
});

test('X4 editor open + note trashed in background: honest handling', async () => {
  const { page, evidence } = session;
  // X3 may have left the editor open (conflict resolution) — return to
  // the list first if so.
  if (await page.locator('.editor-panel__title').isVisible().catch(() => false)) {
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Back to notes' }).click().catch(() => undefined);
    await page.locator('.editor-panel__title').waitFor({ state: 'hidden', timeout: 10_000 });
  }
  // Open note B in tab 1...
  await auditClick(page.getByRole('button', { name: 'Open Crossbeta Journey Note for editing' }), evidence, "page.getByRole('button' name: 'Open Crossbeta Journey Note for editing");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });

  // ...and trash it from a second tab through the real UI.
  const page2 = await session.context.newPage();
  await page2.goto(`chrome-extension://${session.extensionId}/dashboard.html`);
  await expect(page2.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  await page2.locator('.card', { hasText: 'Crossalpha Journey Note' }).first()
    .getByLabel('Select Crossalpha Journey Note').check();
  await auditClick(page2.locator('.bulk-bar-mount').getByRole('button', { name: 'Move to trash…' }), evidence, "page2.locator('.bulkbarmount').getByRole('button' name: 'Move to trash");
  await page2.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page2.waitForTimeout(600);
  await page2.close().catch(() => undefined);

  // Back in tab 1: try to save the still-open editor.
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type(' edit after background trash');
  await expectSaved(page).catch(() => undefined);
  await page.waitForTimeout(1500);
  const announcement = await page.locator('#live-region').textContent().catch(() => '');
  evidence.note(`edit-after-background-trash announcement: ${(announcement ?? '').slice(0, 250)}`);
  await evidence.screenshot(page, 'X4-edit-after-trash');
  // Leave the editor.
  await page.getByRole('button', { name: 'Back to notes' }).click().catch(() => undefined);
  // Restore A for later passes.
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Trash', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Trash' exact: true");
  const restore = page.locator('.card', { hasText: 'Crossalpha Journey Note' }).first()
    .getByLabel('Select Crossalpha Journey Note').check();
  await restore;
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Restore', exact: true }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Restore' exact");
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
});

test('X5 theme switch mid-work: data and UI survive', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 15_000 });
  await settings.getByLabel('Dark', { exact: false }).first().check();
  await page.waitForTimeout(400);
  // With the settings dialog still open, create a note behind it? Not
  // possible — the dialog is modal. Close and create instead.
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await createNote(page, 'Dark Theme Note', 'created while the dark theme is active');
  await backToList(page);
  await expect(page.locator('.card', { hasText: 'Dark Theme Note' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await evidence.screenshot(page, 'X5-dark-theme-note-created');
  // Back to system.
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  await expect(settings).toBeVisible({ timeout: 15_000 });
  await settings.getByLabel('System', { exact: false }).first().check();
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
});

test('X6 command palette from the editor: navigation guard for unsaved edits', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open Crossbeta Journey Note for editing' }), evidence, "page.getByRole('button' name: 'Open Crossbeta Journey Note for editing");
  await page.locator('.editor-panel__title').waitFor({ state: 'visible', timeout: 15_000 });
  await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
  await page.keyboard.type(' unsaved palette probe');
  // Immediately open the palette and navigate away.
  await page.keyboard.press('Control+K');
  const palette = page.locator('dialog.dialog--command-palette');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await palette.locator('input').first().fill('All notes');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const editorStillOpen = await page.locator('.editor-panel__title').isVisible().catch(() => false);
  const announcement = await page.locator('#live-region').textContent().catch(() => '');
  evidence.note(
    `palette-from-editor: editor still open=${editorStillOpen}, announcement=${(announcement ?? '').slice(0, 200)}`,
  );
  await evidence.screenshot(page, 'X6-palette-from-editor');
  // Whatever happened, leave the app in the list state.
  if (editorStillOpen) {
    await page.waitForTimeout(2500); // let autosave settle
    await page.getByRole('button', { name: 'Back to notes' }).click().catch(() => undefined);
  }
});

test('X7 rapid theme toggling does not break the shell', async () => {
  const { page, evidence } = session;
  for (let i = 0; i < 6; i += 1) {
    await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
    const settings = page.locator('dialog[aria-labelledby="settings-title"]');
    await settings.waitFor({ state: 'visible', timeout: 15_000 });
    await settings.getByLabel(i % 2 === 0 ? 'Dark' : 'Light', { exact: false }).first().check();
    await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
    await settings.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  // Restore system and verify the shell is healthy.
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await settings.waitFor({ state: 'visible', timeout: 15_000 });
  await settings.getByLabel('System', { exact: false }).first().check();
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 15_000 });
  evidence.note('six rapid theme toggles survived; shell healthy');
});

test('X8 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
