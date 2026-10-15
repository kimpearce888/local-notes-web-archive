import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-054 regressions for the user-reported defects (2026-10-13):
 *
 * 1. The "Add reminder" dialog rendered every form control ~352px (22rem)
 *    tall — `.search-input`'s horizontal-search flex sizing applied its
 *    flex-basis to HEIGHT inside the column-flex `.dialog__field` — and
 *    the dialog overflowed the viewport so the Time zone field was cut
 *    off. These tests measure REAL computed heights and viewport
 *    containment against the built extension.
 *
 * 2. Pin and trash were impossible from the editor (no such actions in
 *    the editor header): a user inside a note could neither pin it nor
 *    move it to trash. These tests drive both actions end-to-end through
 *    the real UI and verify the persisted outcomes.
 *
 * T-060 regressions for the user-reported defects (2026-10-13, v1.0.3):
 *
 * 3. The active "All notes" smart-list button was invisible: the dark
 *    active-nav override keyed off [data-theme='system'] OUTSIDE any
 *    media query, so the default system theme on a light OS painted the
 *    dark navy #23273f pill behind near-black light-theme text. The test
 *    asserts the REAL computed styles and a WCAG contrast ratio.
 *
 * 4. Note cards read body-first: subtitle and preview were appended
 *    before the title, and tags/categories/indicators shared ONE inline
 *    chips row. The test builds a note with a subtitle, body, tag AND
 *    category through the real UI and asserts the card's DOM reading
 *    order with tags and categories on separate rows.
 *
 * T-103 regressions for the user-reported defects (2026-10-15, two
 * screenshots: "fix settings pop-up and make these options left
 * aligned"):
 *
 * 5. Every full-width sidebar action ("New Note", "Save a web page…",
 *    "Import note…", "Settings", "Diagnostics") centered its icon+label
 *    group — `.btn`'s `justify-content: center` is authored later in
 *    styles.css than `.sidebar__footer-button`'s flex-start with equal
 *    specificity, so it won the cascade while the smart lists read
 *    left-aligned. These tests assert the REAL computed styles and pixel
 *    icon positions at wide, rail (≤52rem) and strip (≤40rem) widths —
 *    including the T-089 omission where the rail rules never listed
 *    `.sidebar__save-page`, so its label stayed visible and clipped.
 *
 * 6. The Settings dialog stretched "Test connection" and "Show the
 *    introduction again" to the full panel width with centered labels
 *    (direct children of the flex-column panel); the Diagnostics dialog
 *    did the same to "Rebuild search index". The tests assert the actions
 *    now shrink to content and sit flush with the panel's left edge.
 *
 * T-105 regressions for the user-reported defect (2026-10-15, screenshot:
 * "settings popup still has double scrollbar"):
 *
 * 7. Chromium's UA stylesheet gives every dialog:modal overflow-y:auto +
 *    max-height calc(100% - 6px - 2rem), and the dialog's scrollHeight is
 *    inflated far past its visible children by the settings panel's
 *    layout extent leaking through the capped content box — so the
 *    Settings dialog rendered its OWN scrollbar next to the inner
 *    .settings__content one (the screenshot's two side-by-side bars), and
 *    scrolling the outer bar swept the pinned heading and
 *    Save/Reset/Close actions away over phantom empty space. These tests
 *    assert the real-browser ground truth at the user's viewport (798x752)
 *    and under a short viewport: the dialog owns NO scrollbar
 *    (offsetWidth - clientWidth == its 2px borders), exactly ONE scroll
 *    body (.settings__content) owns the 17px classic scrollbar and still
 *    scrolls, the heading and actions stay pinned to the dialog's
 *    padding edges, and a closed dialog actually hides (the author
 *    display:flex must not defeat the UA closed-state display:none).
 */

const distDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist');

test.setTimeout(120_000);
test.describe.configure({ mode: 'serial' });

const userDataDir = mkdtempSync(join(tmpdir(), 'lnwa-user-report-'));

let context: BrowserContext;
let page: Page;
let extensionId: string;

/** Hygiene collectors, asserted at the end of the session. */
const pageErrors: string[] = [];
const consoleErrors: string[] = [];
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

test.beforeAll(async () => {
  if (!existsSync(join(distDir, 'manifest.json'))) {
    throw new Error(`dist/ is not built — run "npm run build" first (${distDir})`);
  }
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
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
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  context.on('request', (request) => {
    if (!isLocalUrl(request.url())) externalRequests.push(request.url());
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
});

test.afterAll(async () => {
  if (context) await context.close();
});

function smartNav(p: Page) {
  return p.locator('.smart-nav');
}

test('first run: onboarding dismissed', async () => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Local Notes & Web Archive' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#results-region')).not.toContainText('Loading', { timeout: 15_000 });
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Skip for now' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
});

test('sidebar: the active smart-list button is readable under the default system theme (T-060)', async () => {
  // The default theme preference is 'system' and this Chromium context
  // renders light — exactly the combination that used to paint the dark
  // navy pill (#23273f) behind near-black light-theme text, making the
  // "All notes" button invisible (the user's screenshot).
  expect(await page.locator('html').getAttribute('data-theme')).toBe('system');

  const styles = await smartNav(page).locator('button[aria-current="true"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, color: cs.color };
  });

  // The light-theme token pill (#ececfc), never the dark navy.
  expect(styles.background, 'the active pill must not be the dark navy #23273f').not.toBe(
    'rgb(35, 39, 63)',
  );
  expect(styles.background).toBe('rgb(236, 236, 252)');
  expect(styles.color).toBe('rgb(23, 24, 29)');

  // Ground truth: WCAG 2.x contrast of the rendered pair.
  const parse = (value: string): [number, number, number] => {
    const parts = value.match(/\d+/g);
    if (!parts || parts.length < 3) throw new Error(`unparseable computed color: ${value}`);
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  };
  const luminance = ([r, g, b]: [number, number, number]): number => {
    const channel = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const light = luminance(parse(styles.background));
  const dark = luminance(parse(styles.color));
  const contrast = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  expect(contrast, 'active nav text must meet WCAG AA against its pill').toBeGreaterThanOrEqual(4.5);
});

test('reminder dialog: fields render at natural height and the zone field is visible', async () => {
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: creation navigates straight into the editor.
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  // Open the reminders panel from the editor header.
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await page.getByRole('button', { name: 'Add reminder…' }).click();

  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('heading', { name: 'Add reminder' })).toBeVisible();

  // Ground truth from the REAL browser: the Kind select and the
  // datetime-local input must be form-field sized, not 22rem-tall boxes.
  // (22rem = 352px; anything >= 150px is unmistakably the old bug.)
  const kindHeight = await dialog.locator('select').first().evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(kindHeight, 'Kind select must be a normal form-field height').toBeLessThan(150);
  expect(kindHeight).toBeGreaterThan(16);

  const whenHeight = await dialog.locator('input[type="datetime-local"]').evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(whenHeight, 'datetime-local input must be a normal form-field height').toBeLessThan(150);
  expect(whenHeight).toBeGreaterThan(16);

  // The dialog (and with it the Time zone field) must fit inside the
  // viewport — the old 22rem fields pushed it below the fold.
  const viewportHeight = page.viewportSize()?.height ?? 900;
  const zoneBox = await dialog.locator('input').last().boundingBox();
  expect(zoneBox, 'Time zone input must be laid out').not.toBeNull();
  expect(zoneBox!.y + zoneBox!.height, 'Time zone field must be fully visible').toBeLessThanOrEqual(
    viewportHeight,
  );

  const dialogBox = await dialog.boundingBox();
  expect(dialogBox!.y + dialogBox!.height, 'the dialog must fit the viewport').toBeLessThanOrEqual(
    viewportHeight + 1,
  );

  // Cancel cleanly.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Back to notes' }).click();
});

test('editor: pin toggles the note and the card shows the Pinned badge', async () => {
  const title = page.locator('.editor-panel__title');
  // Create a dedicated note through the real UI.
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: creation navigates straight into the editor.
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.fill('Pin trash target');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('body for the pin and trash test');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });

  // Pin FROM THE EDITOR (the reported missing action).
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('#live-region')).toContainText('Note pinned.', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Back to notes' }).click();
  const card = page.locator('.card', { hasText: 'Pin trash target' }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.card__badge', { hasText: 'Pinned' })).toBeVisible();
});

test('editor: move to trash requires confirmation, trashes and returns to the list', async () => {
  await page.locator('.card', { hasText: 'Pin trash target' }).first()
    .getByRole('button', { name: /Open Pin trash target for editing/ }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });

  // The destructive action is confirmed, matching the bulk-bar pattern.
  await page.getByRole('button', { name: 'Move to trash…' }).click();
  const confirm = page.locator('dialog.dialog--confirm');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await expect(confirm).toContainText('Move this note to trash?');

  // Cancel first: nothing happens, the editor stays.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.editor-panel__title')).toBeVisible();

  // Confirm for real: the note is trashed and the editor closes to the list.
  await page.getByRole('button', { name: 'Move to trash…' }).click();
  await expect(page.locator('dialog.dialog--confirm')).toBeVisible({ timeout: 10_000 });
  await page.locator('dialog.dialog--confirm')
    .getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.locator('#live-region')).toContainText('Note moved to trash.', {
    timeout: 15_000,
  });
  await expect(page.locator('.editor-panel__title')).not.toBeVisible({ timeout: 15_000 });

  // The note is honestly gone from the active list...
  await expect(page.locator('.card', { hasText: 'Pin trash target' })).toHaveCount(0, {
    timeout: 15_000,
  });

  // ...and recoverable in the Trash smart list.
  await smartNav(page).getByRole('button', { name: 'Trash' }).click();
  await expect(page.locator('.card', { hasText: 'Pin trash target' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await smartNav(page).getByRole('button', { name: 'All notes' }).click();
});

test('note card: title first, then subtitle, body, separate tags and categories rows (T-060)', async () => {
  // Build a note carrying every card element through the real UI.
  const title = 'Card order check';
  await page.getByRole('button', { name: 'New Note' }).click();
  // T-101: creation navigates straight into the editor.
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.locator('.editor-panel__title').fill(title);
  await page.locator('.editor-panel__subtitle').fill('Order proof subtitle');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Body text for the card reading-order proof.');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.getByRole('button', { name: `Open ${title} for editing` })).toBeVisible({
    timeout: 15_000,
  });

  // Assign a tag AND a category through the bulk bar, like a real user.
  const bar = page.locator('.bulk-bar-mount');
  const locateCard = () => page.locator('.card', { hasText: title }).first();

  await locateCard().getByLabel(`Select ${title}`).check();
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Assign tags…' }).click();
  const tagDialog = page.locator('dialog.dialog', { hasText: 'Assign tags' });
  await expect(tagDialog).toBeVisible({ timeout: 10_000 });
  await tagDialog.locator('[aria-label="New tags, comma-separated"]').fill('orderproof');
  await tagDialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(tagDialog).not.toBeVisible();
  await locateCard().getByLabel(`Select ${title}`).uncheck();

  await locateCard().getByLabel(`Select ${title}`).check();
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Assign category…' }).click();
  const catDialog = page.locator('dialog.dialog', { hasText: 'Assign category' });
  await expect(catDialog).toBeVisible({ timeout: 10_000 });
  await catDialog.locator('[aria-label="New category name"]').fill('Proofs');
  await catDialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(catDialog).not.toBeVisible();
  await locateCard().getByLabel(`Select ${title}`).uncheck();

  // Ground truth from the real DOM: strict reading order, tags and
  // categories NEVER inline on one row.
  const card = locateCard();
  await expect(card.locator('.chip', { hasText: 'Tag: orderproof' })).toBeVisible({
    timeout: 15_000,
  });

  const order = await card.evaluate((el) => {
    const content = el.querySelector('.card__content');
    return content ? [...content.children].map((child) => child.className) : [];
  });
  expect(order).toEqual([
    expect.stringContaining('card__title'),
    expect.stringContaining('card__subtitle'),
    expect.stringContaining('card__preview'),
    expect.stringContaining('card__chips--tags'),
    expect.stringContaining('card__chips--categories'),
    expect.stringContaining('card__meta-rows'),
  ]);

  const separation = await card.evaluate((el) => {
    const tags = el.querySelector('.card__chips--tags');
    const categories = el.querySelector('.card__chips--categories');
    const metaRows = el.querySelector('.card__meta-rows');
    return {
      sameRow: tags !== null && tags === categories,
      tagChips: tags ? [...tags.querySelectorAll('.chip')].map((chip) => chip.textContent) : null,
      categoryChips: categories
        ? [...categories.querySelectorAll('.chip')].map((chip) => chip.textContent)
        : null,
      metaRowCount: metaRows ? metaRows.children.length : 0,
      metaRowTexts: metaRows ? [...metaRows.children].map((row) => row.textContent) : [],
      metaRowsOwnBlocks: metaRows
        ? [...metaRows.children].every((row) => row.tagName === 'LI')
        : false,
    };
  });
  expect(separation.sameRow, 'tags and categories must live on separate rows').toBe(false);
  expect(separation.tagChips).toEqual(['Tag: orderproof']);
  expect(separation.categoryChips).toEqual(['Category: Proofs']);
  // T-107: Created and Modified are SEPARATE blocks — one list item per
  // fact, never one inline line.
  expect(separation.metaRowCount).toBe(2);
  expect(separation.metaRowTexts[0]).toMatch(/^Created \d{4}-\d{2}-\d{2}$/);
  expect(separation.metaRowTexts[1]).toMatch(/^Modified \d{4}-\d{2}-\d{2}$/);
  expect(separation.metaRowTexts[0]).not.toContain('Modified');
  expect(separation.metaRowTexts[1]).not.toContain('Created');
  expect(separation.metaRowsOwnBlocks).toBe(true);
});

test('sidebar: every action button reads flush-left like the smart lists (T-103)', async () => {
  // Ground truth at the default 1440px viewport: the icon of every
  // full-width sidebar action must start at the same left inset as the
  // smart-list icons (the pre-fix gaps were equal left/right — centered).
  const rows = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const button of document.querySelectorAll('.app-sidebar button')) {
      const isAction =
        button.classList.contains('sidebar__new-note') ||
        button.classList.contains('sidebar__save-page') ||
        button.classList.contains('sidebar__footer-button');
      if (!isAction) continue;
      const box = button.getBoundingClientRect();
      const icon = button.querySelector('.icon-host, svg');
      const iconBox = icon ? (icon as SVGElement).getBoundingClientRect() : null;
      out.push({
        text: (button.textContent ?? '').trim(),
        justify: getComputedStyle(button).justifyContent,
        iconLeftGap: iconBox ? iconBox.left - box.left : null,
      });
    }
    return out;
  });
  expect(rows.length, 'expected the five sidebar action buttons').toBe(5);
  for (const row of rows) {
    expect(row.justify, `${String(row.text)} must be left-aligned`).toBe('flex-start');
    expect(
      row.iconLeftGap as number,
      `${String(row.text)} icon must sit flush left (was centered pre-fix)`,
    ).toBeLessThan(20);
  }
});

test('settings dialog: direct panel actions shrink to content and align left (T-103)', async () => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600); // settings load over the real RPC channel

  const actions = await dialog.evaluate((root: HTMLElement) => {
    const panel = root.querySelector('.settings__panel');
    if (!panel) throw new Error('settings panel never mounted');
    const panelLeft = panel.getBoundingClientRect().left;
    return Array.from(panel.children)
      .filter((child): child is HTMLElement => child.tagName === 'BUTTON')
      .map((button) => ({
        text: (button.textContent ?? '').trim(),
        width: Math.round(button.getBoundingClientRect().width),
        panelWidth: Math.round(panel.getBoundingClientRect().width),
        leftGap: Math.round(button.getBoundingClientRect().left - panelLeft),
        justify: getComputedStyle(button).justifyContent,
      }));
  });

  // "Test connection" and "Show the introduction again" — the two direct
  // panel actions (all other buttons live inside rows).
  expect(actions.map((a) => a.text)).toEqual(['Test connection', 'Show the introduction again']);
  for (const action of actions) {
    expect(
      action.width,
      `${action.text} must shrink to its content (was stretched to the full panel width)`,
    ).toBeLessThan(action.panelWidth * 0.6);
    expect(action.leftGap, `${action.text} must sit flush with the panel's left edge`).toBe(0);
    expect(action.justify).toBe('flex-start');
  }

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
});

test('rail mode (≤52rem): every sidebar label hides, including Save a web page… (T-103)', async () => {
  // The T-089 save-page button was never listed in the rail rules, so its
  // label stayed visible and clipped inside the 59px rail button.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(300); // reflow
  const rail = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const button of document.querySelectorAll('.app-sidebar button')) {
      const label = button.querySelector('span:not(.icon-host)');
      const labelBox = label ? (label as HTMLElement).getBoundingClientRect() : null;
      out.push({
        text: (button.textContent ?? '').trim(),
        labelVisible: !!labelBox && labelBox.width > 2,
        justify: getComputedStyle(button).justifyContent,
      });
    }
    return out;
  });
  for (const row of rail) {
    expect(
      row.labelVisible,
      `${String(row.text)} label must be visually hidden in the rail`,
    ).toBe(false);
    if (
      typeof row.text === 'string' &&
      ['New Note', 'Save a web page…', 'Import note…', 'Settings', 'Diagnostics'].includes(row.text)
    ) {
      expect(row.justify, `${String(row.text)} icon must center in the rail`).toBe('center');
    }
  }
});

test('strip mode (≤40rem): every sidebar label returns, left-aligned (T-103)', async () => {
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(300); // reflow
  const strip = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    for (const button of document.querySelectorAll('.app-sidebar button')) {
      const label = button.querySelector('span:not(.icon-host)');
      const labelBox = label ? (label as HTMLElement).getBoundingClientRect() : null;
      out.push({
        text: (button.textContent ?? '').trim(),
        labelVisible: !!labelBox && labelBox.width > 2,
        justify: getComputedStyle(button).justifyContent,
      });
    }
    return out;
  });
  const actionTexts = ['New Note', 'Save a web page…', 'Import note…', 'Settings', 'Diagnostics'];
  for (const row of strip) {
    if (typeof row.text === 'string' && actionTexts.includes(row.text)) {
      expect(row.labelVisible, `${String(row.text)} label must return in the strip`).toBe(true);
      expect(row.justify, `${String(row.text)} must left-align in the strip`).toBe('flex-start');
    }
  }
  // Restore the suite's default viewport for the remaining tests.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
});

test('settings dialog: exactly one scrollbar — the dialog itself never scrolls (T-105)', async () => {
  // The user's screenshot viewport: the dialog renders its own UA scrollbar
  // next to the content box's whenever the phantom scrollHeight leaks — the
  // double scrollbar. The single-scroller invariant must hold here AND under
  // a short viewport where the UA max-height caps the dialog.
  for (const size of [
    { width: 798, height: 752 }, // the user's screenshot
    { width: 1280, height: 600 }, // short: the UA cap bites
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300); // reflow
    await page.getByRole('button', { name: 'Open settings' }).click();
    const dialog = page.locator('dialog.dialog--settings');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600); // settings load over the real RPC channel

    const geom = await dialog.evaluate((root: HTMLElement) => {
      const content = root.querySelector('.settings__content') as HTMLElement;
      const h2 = root.querySelector('h2') as HTMLElement;
      const actions = root.querySelector('.settings__actions') as HTMLElement;
      const box = root.getBoundingClientRect();
      const border =
        parseFloat(getComputedStyle(root).borderLeftWidth) +
        parseFloat(getComputedStyle(root).borderRightWidth);
      return {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        dialogOverflowY: getComputedStyle(root).overflowY,
        dialogOwnScrollbar: root.offsetWidth - root.clientWidth, // borders only
        dialogBorderWidth: border,
        contentOwnScrollbar: content.offsetWidth - content.clientWidth,
        contentScrolls: content.scrollHeight > content.clientHeight + 1,
        headingPinned: h2.getBoundingClientRect().top - box.top,
        actionsPinnedToBottom: box.bottom - actions.getBoundingClientRect().bottom,
      };
    });

    // The dialog element itself must NEVER own a scrollbar: its classic
    // scrollbar width must equal exactly its border widths (2px) — not 15+
    // as in the user's screenshot.
    expect(
      geom.dialogOwnScrollbar,
      `the dialog must own no scrollbar at ${geom.viewport} (borders only)`,
    ).toBe(geom.dialogBorderWidth);
    expect(geom.dialogOverflowY).toBe('hidden');

    // Exactly ONE scroll body: the content box owns the classic scrollbar
    // and still scrolls the settings panel.
    expect(geom.contentOwnScrollbar, 'the content box must own the scrollbar').toBeGreaterThanOrEqual(
      15,
    );
    expect(geom.contentScrolls, 'the settings panel must remain scrollable').toBe(true);

    // The heading and the action row stay pinned inside the dialog frame
    // (the outer scrollbar used to sweep them away).
    expect(geom.headingPinned).toBeLessThan(30);
    expect(geom.actionsPinnedToBottom).toBeLessThan(30);
    expect(geom.actionsPinnedToBottom).toBeGreaterThan(0);

    // A closed dialog must actually hide: the author display:flex on the
    // flex-sheet dialogs must not defeat the UA closed-state display:none.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  }

  // Restore the suite's default viewport for the remaining tests.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
});

test('diagnostics dialog: exactly one scrollbar, the content box owns it (T-105)', async () => {
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  const diag = page.locator('dialog.dialog--diagnostics');
  await expect(diag).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200); // diagnostics load + self-test rows

  const geom = await diag.evaluate((root: HTMLElement) => {
    const content = root.querySelector('.diagnostics__content') as HTMLElement;
    const border =
      parseFloat(getComputedStyle(root).borderLeftWidth) +
      parseFloat(getComputedStyle(root).borderRightWidth);
    return {
      dialogOverflowY: getComputedStyle(root).overflowY,
      dialogOwnScrollbar: root.offsetWidth - root.clientWidth,
      dialogBorderWidth: border,
      contentOwnScrollbar: content.offsetWidth - content.clientWidth,
      contentScrolls: content.scrollHeight > content.clientHeight + 1,
    };
  });

  expect(geom.dialogOverflowY).toBe('hidden');
  expect(geom.dialogOwnScrollbar, 'the diagnostics dialog must own no scrollbar').toBe(
    geom.dialogBorderWidth,
  );
  expect(geom.contentOwnScrollbar).toBeGreaterThanOrEqual(15);
  expect(geom.contentScrolls, 'the diagnostics panel must remain scrollable').toBe(true);

  await diag.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(diag).not.toBeVisible({ timeout: 10_000 });
});

test('card colors: tint with auto-contrast, default preserved, reset (T-107)', async () => {
  const title = 'Card color proof';
  await page.getByRole('button', { name: 'New Note' }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.locator('.editor-panel__title').fill(title);
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Colored card body.');
  await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Back to notes' }).click();

  // DEFAULT condition (the maintainer's first requirement): no tint, no
  // inline color properties — the present look is preserved exactly.
  const defaultCard = page.locator('.card', { hasText: title }).first();
  await expect(defaultCard).toBeVisible({ timeout: 15_000 });
  const before = await defaultCard.evaluate((el) => ({
    tinted: el.dataset['tinted'] ?? null,
    inlineBg: el.style.getPropertyValue('--card-bg'),
    inlineFg: el.style.getPropertyValue('--card-fg'),
  }));
  expect(before.tinted).toBeNull();
  expect(before.inlineBg).toBe('');
  expect(before.inlineFg).toBe('');

  // Tint through the editor's Card color panel: pick Teal.
  await page.getByRole('button', { name: `Open ${title} for editing` }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Card color' }).click();
  const panel = page.locator('.card-color-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  // The panel tells the user the text color adapts automatically.
  await expect(panel.locator('.card-color-panel__hint')).toContainText('automatically');
  await panel.getByRole('button', { name: 'Background: Teal' }).click();
  await expect(page.locator('#live-region')).toContainText('Card background set to #0e7490.', {
    timeout: 10_000,
  });
  await panel.getByRole('button', { name: 'Close card color' }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to notes' }).click();

  // Tinted ground truth: data-tinted + the chosen background + the AUTO
  // light text + in-page WCAG contrast >= 4.5 (user did not set colors).
  const tintedCard = page.locator('.card', { hasText: title }).first();
  await expect(tintedCard).toBeVisible({ timeout: 15_000 });
  const tinted = await tintedCard.evaluate((el) => {
    const parse = (value: string): number[] | null => {
      const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const channel = (value: number): number => {
      const x = value / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c: number[]): number =>
      0.2126 * channel(c[0] ?? 0) + 0.7152 * channel(c[1] ?? 0) + 0.0722 * channel(c[2] ?? 0);
    const bg = parse(getComputedStyle(el).backgroundColor);
    const fg = parse(getComputedStyle(el).color);
    let contrast = 0;
    if (bg && fg) {
      const l1 = Math.max(luminance(bg), luminance(fg));
      const l2 = Math.min(luminance(bg), luminance(fg));
      contrast = (l1 + 0.05) / (l2 + 0.05);
    }
    const titleEl = el.querySelector('.card__title') as HTMLElement | null;
    const previewEl = el.querySelector('.card__preview') as HTMLElement | null;
    const metaRow = el.querySelector('.card__meta-row') as HTMLElement | null;
    const chip = el.querySelector('.chip--tag') as HTMLElement | null;
    return {
      tinted: el.dataset['tinted'] ?? null,
      bg: getComputedStyle(el).backgroundColor,
      fg: getComputedStyle(el).color,
      titleColor: titleEl ? getComputedStyle(titleEl).color : null,
      previewColor: previewEl ? getComputedStyle(previewEl).color : null,
      metaColor: metaRow ? getComputedStyle(metaRow).color : null,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      contrast,
    };
  });
  expect(tinted.tinted).toBe('true');
  expect(tinted.bg).toBe('rgb(14, 116, 144)');
  // Auto fg for a dark teal background is the light token.
  expect(tinted.fg).toBe('rgb(242, 243, 247)');
  expect(tinted.titleColor).toBe('rgb(242, 243, 247)');
  expect(tinted.previewColor).toBe('rgb(242, 243, 247)');
  // The meta rows and chips re-derive from the fg/surface pair (color-mix
  // resolves in computed style) — never the theme's default faint color.
  expect(tinted.metaColor).not.toBe('rgb(99, 102, 115)');
  expect(tinted.chipBg).not.toBe('rgb(237, 238, 252)');
  expect(
    tinted.contrast,
    'the auto text color must reach WCAG AA on the chosen background',
  ).toBeGreaterThanOrEqual(4.5);

  // Colors are durable note data: they survive a reload.
  await page.reload();
  const reloadedCard = page.locator('.card', { hasText: title }).first();
  await expect(reloadedCard).toBeVisible({ timeout: 20_000 });
  expect(await reloadedCard.evaluate((el) => el.dataset['tinted'] ?? null)).toBe('true');

  // Reset through the panel: the default look is restored honestly.
  await page.getByRole('button', { name: `Open ${title} for editing` }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Card color' }).click();
  const resetPanel = page.locator('.card-color-panel');
  await expect(resetPanel).toBeVisible({ timeout: 10_000 });
  await resetPanel.getByRole('button', { name: 'Default — keep the standard card look' }).click();
  await expect(page.locator('#live-region')).toContainText('Card background reset', {
    timeout: 10_000,
  });
  await resetPanel.getByRole('button', { name: 'Close card color' }).click();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  const resetCard = page.locator('.card', { hasText: title }).first();
  await expect(resetCard).toBeVisible({ timeout: 15_000 });
  expect(await resetCard.evaluate((el) => el.dataset['tinted'] ?? null)).toBeNull();
});

test('card meta: created/modified on their own blocks, the reminder chip on its own row (T-107)', async () => {
  const title = 'Meta blocks proof';
  await page.getByRole('button', { name: 'New Note' }).click();
  await expect(page.locator('.editor-panel__title')).toBeVisible({ timeout: 15_000 });
  await page.locator('.editor-panel__title').fill(title);

  // One future one-time reminder through the reminders panel (reads Due).
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  const remindersPanel = page.locator('[aria-label="Note reminders"]');
  await expect(remindersPanel).toBeVisible({ timeout: 10_000 });
  await remindersPanel.getByRole('button', { name: 'Add reminder…' }).click();
  const reminderDialog = page.locator('dialog.dialog--form', { hasText: 'Add reminder' });
  await expect(reminderDialog).toBeVisible({ timeout: 10_000 });
  await reminderDialog.locator('input[type="datetime-local"]').fill('2027-06-15T09:00');
  await reminderDialog.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await expect(reminderDialog).not.toBeVisible({ timeout: 10_000 });
  await expect(remindersPanel.locator('.reminders-panel__row')).toHaveCount(1, {
    timeout: 10_000,
  });
  await remindersPanel.getByRole('button', { name: 'Close reminders' }).click();
  await expect(remindersPanel).not.toBeVisible();

  await page.getByRole('button', { name: 'Back to notes' }).click();
  const card = page.locator('.card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Related info (reminders) lands asynchronously after the notes render —
  // wait for the reminder chip itself before asserting the structure.
  await expect(card.locator('.chip', { hasText: 'Due 2027-06-15' })).toBeVisible({
    timeout: 15_000,
  });

  const structure = await card.evaluate((el) => {
    const metaRows = el.querySelector('.card__meta-rows');
    const remindersRow = el.querySelector('.card__chips--reminders');
    const indicatorsRow = el.querySelector('.card__chips--indicators');
    return {
      metaRowTexts: metaRows ? [...metaRows.children].map((row) => row.textContent ?? '') : [],
      remindersRowExists: remindersRow !== null,
      reminderChips: remindersRow
        ? [...remindersRow.querySelectorAll('.chip')].map((chip) => chip.textContent ?? '')
        : [],
      reminderChipInIndicators:
        indicatorsRow !== null && indicatorsRow.querySelector('.chip--reminder-ok') !== null,
      // The reminders row is its OWN block directly under the card
      // content (independent of whether a link-indicators row exists).
      remindersRowIsOwnElement:
        remindersRow !== null && remindersRow.parentElement === el.querySelector('.card__content'),
    };
  });
  // Created and Modified are SEPARATE blocks — nothing inline.
  expect(structure.metaRowTexts).toHaveLength(2);
  expect(structure.metaRowTexts[0]).toMatch(/^Created \d{4}-\d{2}-\d{2}$/);
  expect(structure.metaRowTexts[1]).toMatch(/^Modified \d{4}-\d{2}-\d{2}$/);
  // The reminder chip renders on its OWN row, never with the link
  // indicators.
  expect(structure.remindersRowExists).toBe(true);
  expect(structure.reminderChips[0]).toMatch(/^Due 2027-06-15$/);
  expect(structure.reminderChipInIndicators).toBe(false);
  expect(structure.remindersRowIsOwnElement).toBe(true);
});

test('session hygiene: zero page errors, console errors or external requests', async () => {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
