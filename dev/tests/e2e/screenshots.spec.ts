import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-050 professional screenshot suite — the REAL app, really working. A
 * persistent Chromium context loads the built unpacked extension (dist/) at
 * retina scale (deviceScaleFactor 2, 1440x1000 CSS px -> 2880x2000 px images)
 * and drives it through the real UI exactly like a user: first-run
 * onboarding, six realistic notes authored with the rich-text editor and the
 * Markdown import dialog, tags and categories assigned through the bulk bar,
 * one note pinned, a real search, a live theme switch in Settings and the
 * diagnostics page. No mocks, no injected state — everything on screen was
 * created through the product's own flows.
 *
 * The social banner (1280x640) is composed from the real extension icon and
 * the brand palette from src/dashboard/styles.css, rendered by the same
 * Chromium — it is marketing artwork, not a product screenshot, and is the
 * only composed image in docs/screenshots/.
 *
 * Output: docs/screenshots/{dashboard-light,editor,search,dashboard-dark,
 * diagnostics}.png + social-banner.png, referenced from README.md.
 */

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const distDir = join(rootDir, 'dist');
const shotsDir = join(rootDir, 'docs', 'screenshots');

test.setTimeout(180_000);
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

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
  mkdirSync(shotsDir, { recursive: true });
  context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2, // retina-quality captures
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars', // OS scrollbar is not app UI — keep frames clean
    ],
  });
  const workerUrl = await serviceWorkerURL(context);
  const extensionId = new URL(workerUrl).host;
  page = await context.newPage();
  page.on('pageerror', (error) => {
    console.error(`[dashboard pageerror] ${error.message}`);
  });
  await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
});

test.afterAll(async () => {
  await context.close();
});

/* ---------------------------------------------------------------- */
/* Realistic demo library, authored through the real UI              */
/* ---------------------------------------------------------------- */

interface SeedNote {
  readonly title: string;
  readonly subtitle: string;
  readonly markdown: string;
  readonly newTags: string;
  readonly existingTags: readonly string[];
  readonly newCategory: string | null;
  readonly existingCategory: string | null;
  readonly pinned: boolean;
}

const SEED_NOTES: readonly SeedNote[] = [
  {
    title: 'Chromium storage internals — research digest',
    subtitle: 'Where a local-first extension keeps its data, and why',
    markdown: `## What lives where

Chrome keeps extension data in a per-profile origin: IndexedDB for structured
records, blobs for archives, and a settings record that travels with backups.

## Key findings

- **IndexedDB is the source of truth.** Notes, tags, categories, revisions and
  reminders are ordinary records — the search index rebuilds from them after
  every browser restart.
- **MHTML archives live in the blob store** and are exported to the filesystem
  when opened, never rendered inside the extension page.
- **\`chrome.storage.local\` is volatile across restarts** for unpacked installs,
  so anything that must survive belongs in IndexedDB.

## Storage budget snapshot

| Store | Records | Size |
| --- | --- | --- |
| Notes | 6 | 48 KB |
| Snapshots | 2 | 3.1 MB |
| Revisions | 24 | 210 KB |

> Rule of thumb: if losing it would hurt, it belongs in IndexedDB with a
> backup export.`,
    newTags: 'research, archive',
    existingTags: [],
    newCategory: 'Research',
    existingCategory: null,
    pinned: true,
  },
  {
    title: 'Reading list — October',
    subtitle: 'Queue, finished and parked',
    markdown: `## Queue

- [ ] Designing Data-Intensive Applications — the indexing chapter
- [ ] Chromium source docs: \`content/browser/indexed_db\`
- [x] *The Pragmatic Programmer* — chapters 2 to 4

## Finished this month

1. Refactoring UI
2. A Philosophy of Software Design

Parked until December: the distributed-systems paper stack.`,
    newTags: 'reading, to-read',
    existingTags: [],
    newCategory: 'Reading',
    existingCategory: null,
    pinned: false,
  },
  {
    title: 'Weeknight shoyu ramen',
    subtitle: 'Serves two, about 25 minutes',
    markdown: `## Ingredients

1. 2 portions fresh ramen noodles
2. 750 ml chicken stock
3. 2 tbsp shoyu tare
4. Soft-boiled eggs, scallions, nori

## Method

1. Warm the stock; whisk in the tare off the heat.
2. Boil the noodles for 90 seconds — they keep cooking in the bowl.
3. Assemble, top and serve immediately.`,
    newTags: 'recipes',
    existingTags: [],
    newCategory: 'Kitchen',
    existingCategory: null,
    pinned: false,
  },
  {
    title: 'Offsite notes — Q4 planning',
    subtitle: 'Decisions, owners, next sync',
    markdown: `## Decisions

- Ship the archive pipeline before the reminders overhaul.
- Freeze scope on **November 18**.

## Owners

| Track | Owner |
| --- | --- |
| Capture | Dana |
| Search | Priya |
| Backup | Miguel |

Next sync: Thursday 10:00.`,
    newTags: 'work',
    existingTags: [],
    newCategory: 'Work',
    existingCategory: null,
    pinned: false,
  },
  {
    title: 'How MHTML page archiving works',
    subtitle: 'One link in, one self-contained file out',
    markdown: `## The short version

A capture opens a temporary tab, saves the page as a **single self-contained
MHTML file** through Chrome's \`pageCapture\` API, extracts the plain text for
search, and stores everything locally. No server ever sees the URL.

## Pipeline

1. Queue the link.
2. Attach the tab driver.
3. Save MHTML, extract text, take a best-effort full-page PNG.
4. Index the extracted text.`,
    newTags: '',
    existingTags: ['research', 'archive'],
    newCategory: null,
    existingCategory: 'Research',
    pinned: false,
  },
  {
    title: 'Keyboard shortcuts cheat-sheet',
    subtitle: 'Everything one keystroke away',
    markdown: `| Action | Shortcut |
| --- | --- |
| Open dashboard | Alt+Shift+N |
| New note | Alt+Shift+C |
| Bold | Ctrl+B |
| Find in note | Ctrl+F |

Everything else is one toolbar away.`,
    newTags: 'reference',
    existingTags: [],
    newCategory: null,
    existingCategory: 'Work',
    pinned: false,
  },
];

async function assignTags(note: SeedNote): Promise<void> {
  const card = page.locator('.card', { hasText: note.title }).first();
  await card.getByLabel(`Select ${note.title}`).check();
  const bar = page.locator('.bulk-bar-mount');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Assign tags…' }).click();
  const dialog = page.locator('dialog.dialog', { hasText: 'Assign tags' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  for (const tagName of note.existingTags) {
    await dialog.locator('label.dialog__option', { hasText: tagName }).locator('input').check();
  }
  if (note.newTags.length > 0) {
    await dialog.locator('[aria-label="New tags, comma-separated"]').fill(note.newTags);
  }
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await card.getByLabel(`Select ${note.title}`).uncheck();
}

async function assignCategory(note: SeedNote): Promise<void> {
  const card = page.locator('.card', { hasText: note.title }).first();
  await card.getByLabel(`Select ${note.title}`).check();
  const bar = page.locator('.bulk-bar-mount');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Assign category…' }).click();
  const dialog = page.locator('dialog.dialog', { hasText: 'Assign category' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  if (note.newCategory) {
    await dialog.locator('[aria-label="New category name"]').fill(note.newCategory);
  } else if (note.existingCategory) {
    await dialog.locator('label.dialog__option', { hasText: note.existingCategory }).locator('input').check();
  }
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await card.getByLabel(`Select ${note.title}`).uncheck();
}

test('seed a realistic library through the real UI', async () => {
  // First run: read the onboarding, dismiss it like a real user.
  const onboarding = page.locator('dialog.dialog--onboarding');
  await expect(onboarding).toBeVisible({ timeout: 15_000 });
  await onboarding.getByRole('button', { name: 'Skip for now' }).click();
  await expect(onboarding).not.toBeVisible({ timeout: 10_000 });

  for (const note of SEED_NOTES) {
    await page.getByRole('button', { name: 'New Note' }).click();
    // T-101: creation navigates straight into the editor — the seed loop
    // authors each note immediately, no card round-trip needed.
    const title = page.locator('.editor-panel__title');
    await expect(title).toBeVisible({ timeout: 15_000 });
    await title.fill(note.title);
    await page.locator('.editor-panel__subtitle').fill(note.subtitle);

    // Author the body through the product's Markdown import dialog.
    await page.getByRole('button', { name: 'Import Markdown into this note' }).click();
    const dialog = page.locator('dialog.dialog', { hasText: 'Import Markdown' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator('textarea.editor-source').fill(note.markdown);
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dialog).not.toBeVisible();

    // The durable autosave state must be reached before leaving the note.
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Back to notes' }).click();
    await expect(
      page.getByRole('button', { name: `Open ${note.title} for editing` }),
    ).toBeVisible({ timeout: 15_000 });
  }

  // Tags, categories and one pin — all through the bulk bar, like a user.
  for (const note of SEED_NOTES) {
    await assignTags(note);
    await assignCategory(note);
  }
  const pinned = SEED_NOTES.find((note) => note.pinned)!;
  const card = page.locator('.card', { hasText: pinned.title }).first();
  await card.getByLabel(`Select ${pinned.title}`).check();
  await page.locator('.bulk-bar-mount').getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(card.locator('.card__badge').first()).toHaveText('Pinned', { timeout: 10_000 });

  // Everything is on screen: six cards, chips with tags and categories,
  // the pinned note first.
  await expect(page.locator('.card')).toHaveCount(SEED_NOTES.length, { timeout: 10_000 });
});

test('screenshot: dashboard in the light theme', async () => {
  await expect(page.locator('#results-region')).not.toContainText('Loading');
  await page.waitForTimeout(300); // settle chips and layout after the last render
  await page.screenshot({
    path: join(shotsDir, 'dashboard-light.png'),
    animations: 'disabled',
  });
  await expect(existsSync(join(shotsDir, 'dashboard-light.png'))).toBe(true);
});

test('screenshot: rich-text editor with a real document', async () => {
  await page.getByRole('button', { name: 'Open Chromium storage internals — research digest for editing' }).click();
  await expect(page.locator('.editor-panel__title')).toHaveValue(
    'Chromium storage internals — research digest',
    { timeout: 15_000 },
  );
  await expect(page.locator('.ProseMirror').first()).toContainText('What lives where', { timeout: 15_000 });
  await expect(page.locator('.ProseMirror').first()).toContainText('Storage budget snapshot');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'editor.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.getByRole('button', { name: 'New Note' })).toBeVisible({ timeout: 15_000 });
});

test('screenshot: search with results', async () => {
  // A prefix query filling one full grid row — 'chrom' hits the research
  // digest (Chromium), the reading list (Chromium source docs) and the
  // archiving note (Chrome's pageCapture), three cards of three columns.
  await page.locator('#search-input').fill('chrom');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Open Chromium storage internals — research digest for editing' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.card')).toHaveCount(3, { timeout: 10_000 });
  await page.waitForTimeout(300);
  // Clip to the region that carries the story (search box, results header,
  // one full row of cards) — a sparse grid below would read as a layout
  // defect in a marketing image.
  await page.screenshot({
    path: join(shotsDir, 'search.png'),
    animations: 'disabled',
    clip: { x: 0, y: 0, width: 1440, height: 730 },
  });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(SEED_NOTES.length, { timeout: 15_000 });
});

test('screenshot: dashboard in the dark theme', async () => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('radio', { name: 'Dark' }).check();
  await dialog.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.locator('#live-region')).toContainText('Settings saved.', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'dashboard-dark.png'),
    animations: 'disabled',
  });
});

test('screenshot: diagnostics page', async () => {
  await page.getByRole('button', { name: 'Open the diagnostics page' }).click();
  const dialog = page.locator('dialog[aria-labelledby="diagnostics-title"]');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // Real RPC data has loaded (not the placeholder state).
  await expect(dialog).toContainText('Storage quota', { timeout: 15_000 });
  // Scroll the local-AI section into the frame so the capture shows the
  // full breadth of the page (storage, permissions, LM Studio) instead of
  // only the environment header block above the fold.
  await dialog
    .locator('h3, h4, .diagnostics__section-title', { hasText: 'LM Studio (local AI)' })
    .last()
    .scrollIntoViewIfNeeded();
  await expect(dialog).toContainText('LM Studio (local AI)');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'diagnostics.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});


test('screenshot: reminders panel and add-reminder dialog', async () => {
  await page.getByRole('button', { name: 'Open Chromium storage internals — research digest for editing' }).click();
  await expect(page.locator('.editor-panel__title')).toHaveValue(
    'Chromium storage internals — research digest',
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  const panel = page.locator('.reminders-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Add reminder…' }).click();
  const dialog = page.locator('dialog.dialog--form');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // Real form controls at natural height (T-054 regression guard).
  await expect(dialog.getByRole('heading', { name: 'Add reminder' })).toBeVisible();
  // Fill a valid due date so the capture shows the dialog ready to act.
  await dialog.locator('input[type="datetime-local"]').fill('2027-03-01T09:30');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'reminders.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.getByRole('button', { name: 'New Note' })).toBeVisible({ timeout: 15_000 });
});

test('screenshot: local AI workspace panel', async () => {
  await page.getByRole('button', { name: 'Open Chromium storage internals — research digest for editing' }).click();
  await expect(page.locator('.editor-panel__title')).toHaveValue(
    'Chromium storage internals — research digest',
    { timeout: 15_000 },
  );
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  const panel = page.locator('.ai-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  // The honest offline disclosure is part of the story.
  await expect(panel).toContainText('LM Studio');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'ai-panel.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(panel).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(page.getByRole('button', { name: 'New Note' })).toBeVisible({ timeout: 15_000 });
});

test('screenshot: settings dialog', async () => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.locator('dialog.dialog--settings');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('.settings__panel')).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText('Appearance');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'settings.png'),
    animations: 'disabled',
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('screenshot: archives view with a real archived note', async () => {
  // Archive one note through the real flow, like a user.
  const card = page.locator('.card', { hasText: 'Offsite notes — Q4 planning' }).first();
  await card.getByLabel('Select Offsite notes — Q4 planning').check();
  await page.locator('.bulk-bar-mount').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(card).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Archived' }).click();
  const archived = page.locator('.card', { hasText: 'Offsite notes — Q4 planning' }).first();
  await expect(archived).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'archives.png'),
    animations: 'disabled',
  });

  // Leave the library the way it was found.
  await archived.getByLabel('Select Offsite notes — Q4 planning').check();
  await page.locator('.bulk-bar-mount').getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(page.locator('.card')).toHaveCount(SEED_NOTES.length, { timeout: 15_000 });
});

test('screenshot: command palette', async () => {
  await page.keyboard.press('Control+k');
  const palette = page.locator('dialog.dialog--command-palette');
  await expect(palette).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(shotsDir, 'command-palette.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
});

test('screenshot: responsive layouts keep the app usable', async () => {
  // Medium width: the sidebar collapses to a compact icon rail.
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(300);
  const newNote = page.getByRole('button', { name: 'New Note' });
  await expect(newNote).toBeVisible();
  await page.screenshot({
    path: join(shotsDir, 'responsive-rail.png'),
    animations: 'disabled',
  });

  // Narrow width: the sidebar folds into a top strip; search still works.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.waitForTimeout(300);
  await expect(newNote).toBeVisible();
  await page.locator('#search-input').fill('chrom');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open Chromium storage internals — research digest for editing' }),
  ).toBeVisible({ timeout: 15_000 },
  );
  await page.screenshot({
    path: join(shotsDir, 'responsive-narrow.png'),
    animations: 'disabled',
  });
  await page.locator('#search-input').fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator('.card')).toHaveCount(SEED_NOTES.length, { timeout: 15_000 });

  // Restore the desktop viewport for the remaining captures.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(300);
});

test('compose the 1280x640 social banner from the real brand assets', async () => {
  const iconBase64 = readFileSync(join(distDir, 'icons', 'icon-128.png')).toString('base64');
  const bannerContext = await chromium.launch({ headless: true });
  try {
    const bannerPage = await bannerContext.newPage({
      viewport: { width: 1280, height: 640 },
      deviceScaleFactor: 1,
    });
    await bannerPage.setContent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1280px; height: 640px; overflow: hidden; }
  body {
    font-family: 'Carlito', 'Noto Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif;
    background: linear-gradient(135deg, #14161f 0%, #1d2130 55%, #273052 100%);
    color: #e8ebf4;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px;
    position: relative;
  }
  body::before {
    content: ''; position: absolute; right: -180px; top: -180px;
    width: 560px; height: 560px; border-radius: 50%;
    background: radial-gradient(circle, rgba(157, 180, 240, 0.16) 0%, rgba(157, 180, 240, 0) 70%);
  }
  .mark { display: flex; align-items: center; gap: 24px; }
  .mark img { width: 88px; height: 88px; border-radius: 20px; }
  .mark .chrome {
    font-size: 22px; font-weight: 700; letter-spacing: 2px;
    color: #9db4f0; text-transform: uppercase;
  }
  h1 { font-size: 68px; font-weight: 700; line-height: 1.1; margin-top: 40px; }
  h1 .accent { color: #9db4f0; }
  .tagline {
    font-size: 30px; line-height: 1.45; color: #a7b0c8;
    margin-top: 24px; max-width: 940px;
  }
  .chips { display: flex; gap: 16px; margin-top: 44px; }
  .chip {
    font-size: 22px; font-weight: 700; color: #e8ebf4;
    border: 2px solid #3a415a; border-radius: 999px;
    padding: 10px 26px; background: rgba(29, 33, 48, 0.85);
  }
  .foot {
    position: absolute; left: 96px; right: 96px; bottom: 44px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 21px; color: #a7b0c8;
  }
  .foot .dot { color: #3a415a; padding: 0 10px; }
</style></head>
<body>
  <div class="mark">
    <img src="data:image/png;base64,${iconBase64}" alt="Local Notes &amp; Web Archive extension icon">
    <span class="chrome">Chrome extension</span>
  </div>
  <h1>Local notes &amp; web archive,<br><span class="accent">all on your device.</span></h1>
  <p class="tagline">Rich-text notes, MHTML page archiving, reminders and optional local AI — no cloud, no accounts, no telemetry.</p>
  <div class="chips">
    <span class="chip">Rich-text notes</span>
    <span class="chip">MHTML web archive</span>
    <span class="chip">Reminders</span>
    <span class="chip">Local AI</span>
  </div>
  <div class="foot">
    <span>Chrome 120+<span class="dot">·</span>Manifest V3<span class="dot">·</span>MIT license</span>
    <span>github.com/kimpearce888/local-notes-web-archive</span>
  </div>
</body></html>`);
    await bannerPage.waitForTimeout(250); // fonts and layout settle
    await bannerPage.screenshot({
      path: join(shotsDir, 'social-banner.png'),
      animations: 'disabled',
    });
  } finally {
    await bannerContext.close();
  }
  const banner = readFileSync(join(shotsDir, 'social-banner.png'));
  // Exact Open-Graph-friendly dimensions and a real PNG.
  expect(banner.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(banner.readUInt32BE(16)).toBe(1280); // IHDR width
  expect(banner.readUInt32BE(20)).toBe(640); // IHDR height
});

test('the screenshot session runs clean (no errors, no external requests)', async () => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  const cleanPage = await context.newPage();
  cleanPage.on('pageerror', (error) => pageErrors.push(error.message));
  cleanPage.on('request', (request) => {
    const url = request.url();
    if (/^https?:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
      externalRequests.push(url);
    }
  });
  await cleanPage.goto(page.url());
  await cleanPage.close();
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(externalRequests, `external network requests: ${externalRequests.join(' | ')}`).toEqual([]);
});
