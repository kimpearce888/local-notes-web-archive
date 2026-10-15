import { test } from '@playwright/test';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS B (shell) — systematic screen and control sweep of the dashboard
 * shell: smart lists with data, search operators, the Filters disclosure,
 * sort, view modes, pagination, selection and the command palette.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-b-shell');
  await dismissOnboarding(session.page);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

const NOTE_TITLES = [
  'Audit Alpha zebra',
  'Audit Beta yahoo',
  'Audit Gamma xray',
];

test('B1 seed: three notes exist and are listed', async () => {
  const { page, evidence } = session;
  for (const title of NOTE_TITLES) {
    await createNote(page, title, `${MARKERS.body} ${title}`);
    await backToList(page);
  }
  for (const title of NOTE_TITLES) {
    await expect(
      page.getByRole('button', { name: `Open ${title} for editing` }),
    ).toBeVisible({ timeout: 15_000 });
  }
});

test('B2 smart lists with data: Pinned and Archived filter correctly', async () => {
  const { page, evidence } = session;
  // Pin one note through the bulk bar (the pinned path that exists).
  const alpha = page.locator('.card', { hasText: 'Audit Alpha zebra' }).first();
  await expect(alpha).toBeVisible({ timeout: 15_000 });
  await evidence.screenshot(page, 'B2-before-select');
  const alphaCheck = alpha.getByLabel('Select Audit Alpha zebra');
  await expect(alphaCheck).toBeVisible({ timeout: 15_000 });
  await alphaCheck.check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Pin', exact: true }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Pin' exact: tr");
  await expect(page.locator('#live-region')).toContainText(/pin/i, { timeout: 15_000 });
  await alpha.getByLabel('Select Audit Alpha zebra').uncheck();

  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Pinned', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Pinned' exact: tru");
  await expect(page.locator('.card', { hasText: 'Audit Alpha zebra' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator('.card')).toHaveCount(1);
  await evidence.screenshot(page, 'B2-pinned-list');

  // Archive a different note, then check the Archived list.
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  const beta = page.locator('.card', { hasText: 'Audit Beta yahoo' }).first();
  await beta.getByLabel('Select Audit Beta yahoo').check();
  await auditClick(page.locator('.bulk-bar-mount').getByRole('button', { name: 'Archive', exact: true }), evidence, "page.locator('.bulkbarmount').getByRole('button' name: 'Archive' exact");
  await expect(page.locator('#live-region')).toContainText('Archive', { timeout: 15_000 });
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Archived', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Archived' exact: t");
  await expect(page.locator('.card', { hasText: 'Audit Beta yahoo' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator('.card')).toHaveCount(1);
  evidence.note('Pinned and Archived smart lists filter correctly with data');
});

test('B3 Favorites smart list: can a real user ever populate it?', async () => {
  const { page, evidence } = session;
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'Favorites', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'Favorites' exact: ");
  await expect(page.locator('.card')).toHaveCount(0);

  // A real user looks for a way to favorite a note: on the card, in the
  // bulk bar, and in the editor. Record what exists.
  await auditClick(page.locator('.smart-nav').getByRole('button', { name: 'All notes', exact: true }), evidence, "page.locator('.smartnav').getByRole('button' name: 'All notes' exact: ");
  const card = page.locator('.card', { hasText: 'Audit Gamma xray' }).first();

  // Every control actually present on the card (real DOM ground truth).
  const cardControls = await card.evaluate((el) =>
    [...el.querySelectorAll('button, input, [role="button"]')].map((c) => ({
      tag: c.tagName.toLowerCase(),
      label: c.getAttribute('aria-label') ?? c.textContent?.trim() ?? '',
    })),
  );
  evidence.note(`card controls: ${JSON.stringify(cardControls)}`);

  // Bulk bar with the note selected — enumerate its buttons.
  await card.getByLabel('Select Audit Gamma xray').check();
  const bulkButtons = await page
    .locator('.bulk-bar-mount')
    .evaluate((el) =>
      [...el.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? ''),
    );
  evidence.note(`bulk bar buttons: ${JSON.stringify(bulkButtons)}`);
  await card.getByLabel('Select Audit Gamma xray').uncheck();

  // Editor session header — enumerate its buttons.
  await auditClick(page.getByRole('button', { name: 'Open Audit Gamma xray for editing' }), evidence, "page.getByRole('button' name: 'Open Audit Gamma xray for editing' )");
  await page.locator('.editor-session__header').waitFor({ state: 'visible', timeout: 15_000 });
  const headerButtons = await page
    .locator('.editor-session__header')
    .evaluate((el) =>
      [...el.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '',
      ),
    );
  evidence.note(`editor session header buttons: ${JSON.stringify(headerButtons)}`);
  await backToList(page);
  evidence.note('favorite toggle searched on card, bulk bar and editor header');
});

test('B4 search: terms, operators, no-results and clearing', async () => {
  const { page, evidence } = session;
  const search = page.locator('#search-input');
  await search.fill('zebra');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card', { hasText: 'Audit Alpha zebra' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator('.card')).toHaveCount(1);
  await evidence.screenshot(page, 'B4-search-zebra');

  // No-results state.
  await search.fill('qqqqzzzz-no-such-token');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(0, { timeout: 15_000 });
  await evidence.screenshot(page, 'B4-search-no-results');
  evidence.note('no-results search renders zero cards without error');

  // Operator syntax from FR-SEARCH-04: title: scoped search.
  await search.fill('title:zebra');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card', { hasText: 'Audit Alpha zebra' })).toHaveCount(1, {
    timeout: 15_000,
  });

  // Invalid operator value honesty (is:unknown).
  await search.fill('is:banana');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const announced = await page.locator('#live-region').textContent().catch(() => '');
  evidence.note(`is:banana live-region: ${announced ?? '(empty)'}`);
  await evidence.screenshot(page, 'B4-search-invalid-operator');

  // Clearing search restores the full active list.
  await search.fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(2, { timeout: 15_000 }); // alpha + gamma (beta archived)
});

test('B5 Filters disclosure with data: does the panel offer any filter?', async () => {
  const { page, evidence } = session;
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await auditClick(filters, evidence, "filters");
  await page.waitForTimeout(400);
  const expanded = await filters.getAttribute('aria-expanded');
  const regionChildren = await page.locator('#filters-region').evaluate(
    (el) => el.children.length,
  );
  const regionHtml = await page.locator('#filters-region').evaluate((el) => el.innerHTML);
  evidence.note(
    `Filters with data: aria-expanded=${expanded}, child elements=${regionChildren}, innerHTML length=${regionHtml.length}`,
  );
  await evidence.screenshot(page, 'B5-filters-open-with-data');
  await auditClick(filters, evidence, "filters");

  // Active-filter chips: do search operators populate the toolbar region?
  await page.locator('#search-input').fill('title:zebra');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const chipCount = await page.locator('#active-filters').evaluate((el) => el.children.length);
  evidence.note(`active-filters chip count during title: search = ${chipCount}`);
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
});

test('B6 sort orders: all three options reorder the list honestly', async () => {
  const { page, evidence } = session;
  await evidence.screenshot(page, 'B6-before-sort');
  const toolbarInfo = await page
    .locator('.toolbar')
    .evaluate((el) => ({
      text: el.textContent?.slice(0, 200) ?? '',
      selectCount: el.querySelectorAll('select').length,
      selectLabels: [...el.querySelectorAll('label')].map((l) => l.textContent?.trim()),
    }))
    .catch((e: unknown) => ({ text: `ERR ${String(e)}`, selectCount: -1, selectLabels: [] as string[] }));
  evidence.note(`toolbar info: ${JSON.stringify(toolbarInfo)}`);
  const sort = page.locator('#sort-select');
  await expect(sort).toBeVisible({ timeout: 15_000 });
  for (const option of ['Title', 'Date created', 'Last modified']) {
    await sort.selectOption(option);
    await page.waitForTimeout(400);
    const firstTitle = await page
      .locator('.card .card__title')
      .first()
      .textContent()
      .catch(() => '(none)');
    evidence.note(`sort=${option} -> first card: ${firstTitle?.trim()}`);
  }
  // Title sort: the store's sort direction defaults to 'desc' and NO UI
  // control exists to change it (FR-SEARCH-06 promises ascending/
  // descending "where meaningful") — so reverse-alphabetical order is the
  // only reachable title order. Recorded as evidence for the gap.
  await sort.selectOption('Title');
  await page.waitForTimeout(400);
  const firstAfterTitle = await page.locator('.card .card__title').first().textContent();
  evidence.note(`title sort (fixed desc direction) first card: ${firstAfterTitle?.trim()}`);
  expect(firstAfterTitle?.trim()).toContain('Audit Gamma');
});

test('B7 view toggle: Grid and List modes both render cards', async () => {
  const { page, evidence } = session;
  const toggle = page.locator('.view-toggle');
  await auditClick(toggle.getByRole('radio', { name: 'List', exact: true }), evidence, "toggle.getByRole('radio' name: 'List' exact: true )");
  await page.waitForTimeout(400);
  await expect(page.locator('.card').first()).toBeVisible();
  await evidence.screenshot(page, 'B7-list-view');
  await auditClick(toggle.getByRole('radio', { name: 'Grid', exact: true }), evidence, "toggle.getByRole('radio' name: 'Grid' exact: true )");
  await page.waitForTimeout(400);
  await expect(page.locator('.card').first()).toBeVisible();
  await evidence.screenshot(page, 'B7-grid-view');
});

test('B8 pagination: 51+ real notes exercise page boundaries', async () => {
  test.setTimeout(300_000);
  const { page, evidence } = session;
  // 2 active notes exist (alpha, gamma; beta archived). Create 49 more
  // through the real New Note button (rapid creation is itself a timing
  // probe — the human-simulation suite proved 5 rapid clicks safe).
  for (let i = 0; i < 49; i += 1) {
    await auditClick(page.getByRole('button', { name: 'New Note' }), evidence, "page.getByRole('button' name: 'New Note' )");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  // DEFECT EVIDENCE: after rapid creation the page-1 slice invariant is
  // violated — every created note is prepended to state.notes without a
  // paginated requery, so page 1 holds ALL 51 notes while the pagination
  // chrome claims 'Page 1 of 2' (probe-b8 pinned the exact state).
  const overflowCount = await page.locator('.card').count();
  const paginationText = await page.locator('.pagination').textContent();
  evidence.note(
    `DEFECT: page-1 card count after rapid creation = ${overflowCount} (> pageSize 50); pagination says: ${paginationText?.trim()}`,
  );
  await evidence.screenshot(page, 'B8-page-1-overflow-defect');

  // A reload restores the correct slice.
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(50, { timeout: 30_000 });
  await expect(page.locator('#results-count')).toContainText('51');
  await expect(page.locator('.pagination')).toContainText('Showing 1–50 of 51');
  await evidence.screenshot(page, 'B8-page-1-full');
  await auditClick(page.getByRole('button', { name: 'Next page' }), evidence, "page.getByRole('button' name: 'Next page' )");
  await page.waitForTimeout(800);
  const page2Count = await page.locator('.card').count();
  evidence.note(`page 2 card count = ${page2Count}`);
  await expect(page.locator('.card')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.pagination')).toContainText('Page 2 of 2');
  await evidence.screenshot(page, 'B8-page-2');

  // Previous returns to page 1.
  await auditClick(page.getByRole('button', { name: 'Previous page' }), evidence, "page.getByRole('button' name: 'Previous page' )");
  await expect(page.locator('.card')).toHaveCount(50, { timeout: 15_000 });

  // Select-page selects exactly the visible page.
  await page.getByLabel('Select all notes on this page').check();
  await page.waitForTimeout(700);
  const selected = await page
    .locator('.card input[type="checkbox"]:checked')
    .count();
  evidence.note(`select-page checked count = ${selected}`);
  expect(selected).toBe(50);
  await auditClick(page.getByRole('button', { name: 'Clear selection' }), evidence, "page.getByRole('button' name: 'Clear selection' )");
});

test('B9 command palette: every command is listed and the sweep activates cleanly', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Open command palette (Ctrl+K)' }), evidence, "page.getByRole('button' name: 'Open command palette (CtrlK)' )");
  const palette = page.locator('dialog.dialog--command-palette');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  const commands = await palette
    .locator('[role="option"]')
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));
  evidence.note(`palette commands: ${JSON.stringify(commands)}`);
  await evidence.screenshot(page, 'B9-palette-commands');
  await page.keyboard.press('Escape');

  // Activate a representative sweep through the palette itself.
  const runCommand = async (query: string): Promise<void> => {
    await page.keyboard.press('Control+K');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await palette.locator('input').first().fill(query);
    await page.keyboard.press('Enter');
    await expect(palette).not.toBeVisible({ timeout: 5_000 });
  };
  await runCommand('Trash');
  await page.waitForTimeout(500);
  await expect(page.locator('.smart-nav button[aria-current="true"]')).toContainText('Trash');
  await runCommand('All notes');
  await page.waitForTimeout(500);
  await expect(page.locator('.smart-nav button[aria-current="true"]')).toContainText('All notes');
  await runCommand('Settings');
  await expect(
    page.locator('dialog[aria-labelledby="settings-title"]'),
  ).toBeVisible({ timeout: 5_000 });
  await page
    .locator('dialog[aria-labelledby="settings-title"]')
    .getByRole('button', { name: 'Close' })
    .click();
  await runCommand('Diagnostics');
  await expect(
    page.locator('dialog[aria-labelledby="diagnostics-title"]'),
  ).toBeVisible({ timeout: 5_000 });
  await page
    .locator('dialog[aria-labelledby="diagnostics-title"]')
    .getByRole('button', { name: 'Close' })
    .click();
  evidence.note('palette sweep: Trash, All notes, Settings, Diagnostics all activated');
});

test('B10 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
