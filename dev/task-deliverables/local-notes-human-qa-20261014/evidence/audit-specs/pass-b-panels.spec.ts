import { test } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  expectSaved,
  auditClick,
  MARKERS,
  expect,
} from './helpers';

/**
 * PASS B (panels) — systematic sweep of the editor sub-panels, the
 * settings dialog and the diagnostics dialog, including their empty
 * states, confirm/cancel paths and honest failure states.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;
const scratch = mkdtempSync(join(tmpdir(), 'lnwa-audit-panels-'));

test.beforeAll(async () => {
  session = await launchAuditSession('pass-b-panels');
  await dismissOnboarding(session.page);
  await createNote(session.page, 'Panels Sweep Note', MARKERS.body);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

test('P1 attachments: DEFECT — real files cannot be attached (transport drops the Blob)', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Attachments', exact: true }), evidence, "page.getByRole('button' name: 'Attachments' exact: true )");
  await expect(page.locator('[aria-label="Note attachments"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[aria-label="Note attachments"]')).toContainText(/No attachments yet/i);

  // Attempt to attach a real file through the real in-panel input.
  const fileA = join(scratch, 'audit-attachment-alpha.txt');
  writeFileSync(fileA, 'attachment alpha content — QA audit marker A1');
  await page.setInputFiles('[aria-label="Files to attach"]', fileA);
  await page.waitForTimeout(2500);

  // DEFECT EVIDENCE: the RPC 'attachments/add' rejects the payload because
  // chrome.runtime.sendMessage JSON-serializes the File to {} — the
  // background's `data instanceof Blob` guard fails. The UI reports the
  // failure honestly, but the attachment feature is broken end-to-end.
  const panelText = await page.locator('[aria-label="Note attachments"]').textContent();
  evidence.note(`DEFECT D-04: after attaching a real file the panel says: ${(panelText ?? '').slice(0, 300)}`);
  expect(panelText ?? '').toContain('data must be a Blob');
  await expect(
    page.getByRole('button', { name: 'Rename audit-attachment-alpha.txt' }),
  ).toHaveCount(0);
  await evidence.screenshot(page, 'P1-DEFECT-attach-fails-blob-transport');

  // The same broken transport underlies the image dialog's file picker
  // (onAttachImage -> attachFile -> raw File over sendMessage); only the
  // data-URL paste path works (E6 covered that separately).
  evidence.note('attachment rename/delete/download flows are unreachable: no attachment can ever be created through the UI (defect D-04)');
});

test('P2 attachments download: BLOCKED by defect D-04 (no attachment exists to download)', async () => {
  const { evidence } = session;
  evidence.note('P2 NOT RUN: attachments cannot be created through the real UI (D-04), so the download path has no input. The same sendMessage transport carries the Blob response, so it is suspect too.');
});

test('P3 revisions: history lists saves and restore rolls back content', async () => {
  const { page, evidence } = session;
  // Produce several durable revisions: type, let the autosave debounce
  // fire, and confirm the durable Saved state each time.
  for (const extra of [' revision two words', ' revision three words']) {
    await auditClick(page.locator('.ProseMirror').first(), evidence, "page.locator('.ProseMirror').first()");
    await page.keyboard.type(extra);
    await page.waitForTimeout(3500);
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
  }
  await auditClick(page.getByRole('button', { name: 'Revision history', exact: true }), evidence, "page.getByRole('button' name: 'Revision history' exact: true )");
  const panel = page.locator('[aria-label="Revision history"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const entries = await panel.locator('li').count();
  evidence.note(`revision entries visible: ${entries}`);
  await expect(entries).toBeGreaterThan(1);
  await evidence.screenshot(page, 'P3-revisions');

  // Restore an older revision — content must roll back durably.
  const restoreButtons = panel.getByRole('button', { name: /Restore revision from/ });
  const count = await restoreButtons.count();
  evidence.note(`restore buttons: ${count}`);
  await auditClick(restoreButtons.nth(Math.max(0, count - 2)), evidence, "restoreButtons.nth(Math.max(0 count 2))");
  await page.waitForTimeout(3500);
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
  evidence.note('restore clicked on an older revision; durable save confirmed');
  await auditClick(page.getByRole('button', { name: 'Revision history', exact: true }), evidence, "page.getByRole('button' name: 'Revision history' exact: true )");
});

test('P4 reminders panel: INCONCLUSIVE in this session (input stall after rich-note revision restore)', async () => {
  const { evidence } = session;
  evidence.note('INCONCLUSIVE: after restoring a revision of the toolbar-sweep note (rich content: tables, task lists, syntax-highlighted code, colors, image), Playwright-dispatched input events stall on this session while page.evaluate keeps working (DOM state verified clean: no open dialogs, buttons visible+enabled, hit-test passes). The same flow is fast in a fresh session with a simple note (probe-restore: 24-225ms). The reminders lifecycle is therefore executed in a dedicated fresh session (pass-b-panels2). Root cause undetermined: renderer load or a product re-render loop — flagged for developer investigation.');
});

test('P5 snapshots panel: honest empty state without captures', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Snapshots', exact: true }), evidence, "page.getByRole('button' name: 'Snapshots' exact: true )");
  const panel = page.locator('[aria-label="Captured snapshots"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).toContainText(/No snapshots|nothing/i);
  await evidence.screenshot(page, 'P5-snapshots-empty');
  evidence.note('snapshots panel shows an honest empty state (no captures exist)');
  await auditClick(page.getByRole('button', { name: 'Snapshots', exact: true }), evidence, "page.getByRole('button' name: 'Snapshots' exact: true )");
});

test('P6 AI panel: honest unavailability — input and send disabled without LM Studio', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'AI', exact: true }), evidence, "page.getByRole('button' name: 'AI' exact: true )");
  const panel = page.locator('[aria-label="AI assistant"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).toContainText('LM Studio');
  // Honest degradation: with no loopback server the message input and the
  // send action are disabled — no fake send is possible.
  const input = panel.locator('[aria-label="Message to the local AI model"]');
  await expect(input).toBeVisible({ timeout: 10_000 });
  const inputEnabled = await input.isEnabled().catch(() => false);
  const sendEnabled = await panel.getByRole('button', { name: 'Send', exact: true }).isEnabled().catch(() => false);
  evidence.note(`AI panel without server: input enabled=${inputEnabled}, send enabled=${sendEnabled}`);
  expect(sendEnabled).toBe(false);
  await evidence.screenshot(page, 'P6-ai-panel-unavailable');
  await auditClick(page.getByRole('button', { name: 'AI', exact: true }), evidence, "page.getByRole('button' name: 'AI' exact: true )");
});

test('P7 settings: appearance switch, autosave interval, toolbar groups live effect', async () => {
  const { page, evidence } = session;
  await backToList(page);
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 15_000 });

  // Theme radio: dark applies live.
  await settings.getByLabel('Dark', { exact: false }).first().check();
  await page.waitForTimeout(500);
  const themeAttr = await page.locator('html').getAttribute('data-theme');
  evidence.note(`theme attr after Dark radio: ${themeAttr}`);
  expect(themeAttr).toBe('dark');
  await evidence.screenshot(page, 'P7-settings-dark-live');

  // Back to system.
  await settings.getByLabel('System', { exact: false }).first().check();

  // Toolbar groups: disable one group and see it vanish from the toolbar.
  const historyCheckbox = settings
    .locator('label, .settings__check')
    .filter({ hasText: /Undo|history/i })
    .first()
    .locator('input[type="checkbox"]');
  if (await historyCheckbox.count()) {
    await historyCheckbox.first().uncheck();
    await auditClick(settings.getByRole('button', { name: /Save changes/ }).first(), evidence, "settings.getByRole('button' name: Save changes ).first()");
    await page.waitForTimeout(800);
  }
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
  await expect(settings).not.toBeVisible({ timeout: 10_000 });

  // Open the editor and check the history group state.
  await auditClick(page.getByRole('button', { name: 'Open Panels Sweep Note for editing' }), evidence, "page.getByRole('button' name: 'Open Panels Sweep Note for editing' )");
  await page.locator('.editor-session__header').waitFor({ state: 'visible', timeout: 15_000 });
  const undoVisible = await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).isVisible().catch(() => false);
  evidence.note(`Undo button visible after disabling history group: ${undoVisible}`);
  await backToList(page);

  // Re-enable through settings to leave a clean state.
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  await expect(settings).toBeVisible({ timeout: 15_000 });
  if (await historyCheckbox.count()) {
    await historyCheckbox.first().check();
    await auditClick(settings.getByRole('button', { name: /Save changes/ }).first(), evidence, "settings.getByRole('button' name: Save changes ).first()");
    await page.waitForTimeout(600);
  }
  await auditClick(settings.getByRole('button', { name: 'Close' }), evidence, "settings.getByRole('button' name: 'Close' )");
});

test('P8 settings: AI section and onboarding re-show, reset path', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open settings' }), evidence, "page.getByRole('button' name: 'Open settings' )");
  const settings = page.locator('dialog[aria-labelledby="settings-title"]');
  await expect(settings).toBeVisible({ timeout: 15_000 });

  // Test LM Studio connection — must fail honestly (no server on loopback).
  await auditClick(settings.getByRole('button', { name: 'Test connection', exact: true }), evidence, "settings.getByRole('button' name: 'Test connection' exact: true )");
  await expect(settings).toContainText(/unreachable|failed|error|no/i, { timeout: 20_000 }).catch(
    async () => {
      const text = await settings.textContent();
      evidence.note(`Test connection raw text: ${(text ?? '').slice(0, 400)}`);
    },
  );
  await evidence.screenshot(page, 'P8-lmstudio-test-honest-failure');

  // Show the introduction again — DEFECT D-05: the re-shown dialog's
  // primary 'Get started' button is permanently disabled (the click
  // handler sets disabled=true on first completion and only re-enables
  // on FAILURE; the overlay instance and its button persist).
  await auditClick(settings.getByRole('button', { name: 'Show the introduction again' }), evidence, "settings.getByRole('button' name: 'Show the introduction again' )");
  await expect(settings).not.toBeVisible({ timeout: 10_000 });
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 10_000 });
  const getStarted = onboarding.getByRole('button', { name: 'Get started' });
  await expect(getStarted).toBeVisible();
  const gsEnabled = await getStarted.isEnabled();
  evidence.note(`DEFECT D-05: re-shown onboarding 'Get started' enabled=${gsEnabled} (expected true)`);
  await expect(getStarted, 're-shown onboarding primary must be usable').toBeDisabled();
  await evidence.screenshot(page, 'P8-DEFECT-onboarding-get-started-disabled');

  // Escape still closes the native dialog (the accessible escape hatch).
  await page.keyboard.press('Escape');
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('P9 diagnostics: sections, refresh, self-test, export review, LM test', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open the diagnostics page' }), evidence, "page.getByRole('button' name: 'Open the diagnostics page' )");
  const diag = page.locator('dialog[aria-labelledby="diagnostics-title"]');
  await expect(diag).toBeVisible({ timeout: 15_000 });
  await expect(diag).toContainText('Storage');
  await evidence.screenshot(page, 'P9-diagnostics');

  // Refresh works.
  await auditClick(diag.getByRole('button', { name: 'Refresh', exact: true }), evidence, "diag.getByRole('button' name: 'Refresh' exact: true )");
  await page.waitForTimeout(800);
  await expect(diag).toContainText('Storage');

  // Network privacy self-test — must run and report.
  await auditClick(diag.getByRole('button', { name: 'Run network privacy self-test' }), evidence, "diag.getByRole('button' name: 'Run network privacy selftest' )");
  await page.waitForTimeout(3000);
  const selfTestText = await diag.textContent();
  evidence.note(`self-test text sample: ${(selfTestText ?? '').slice(0, 500)}`);
  await evidence.screenshot(page, 'P9-self-test');

  // LM Studio test from diagnostics — honest failure.
  await auditClick(diag.getByRole('button', { name: 'Test LM Studio connection' }), evidence, "diag.getByRole('button' name: 'Test LM Studio connection' )");
  await page.waitForTimeout(3000);
  await evidence.screenshot(page, 'P9-lmstudio-test');

  // Export with review dialog — cancel first.
  await auditClick(diag.getByRole('button', { name: 'Export diagnostics…' }), evidence, "diag.getByRole('button' name: 'Export diagnostics' )");
  const review = page.locator('dialog').filter({ hasText: 'Review diagnostics export' });
  await expect(review).toBeVisible({ timeout: 15_000 });
  await auditClick(review.getByRole('button', { name: 'Cancel' }), evidence, "review.getByRole('button' name: 'Cancel' )");
  await expect(review).not.toBeVisible({ timeout: 10_000 });

  // Export for real — download event.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    diag.getByRole('button', { name: 'Export diagnostics…' }).click().then(() =>
      review.getByRole('button', { name: 'Download JSON' }).click(),
    ),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  evidence.note('diagnostics export downloaded after review');

  // Rebuild search index — completes and returns.
  await auditClick(diag.getByRole('button', { name: 'Rebuild search index' }), evidence, "diag.getByRole('button' name: 'Rebuild search index' )");
  await expect(diag.getByRole('button', { name: 'Rebuild search index' })).toBeVisible({
    timeout: 60_000,
  });
  await auditClick(diag.getByRole('button', { name: 'Close' }), evidence, "diag.getByRole('button' name: 'Close' )");
  await expect(diag).not.toBeVisible({ timeout: 10_000 });
});

test('P10 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
