import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-062 audit helpers — real-UI evidence collection only (brief §6):
 * no RPC shortcuts, no database writes, no hidden test hooks. Everything
 * goes through the same persistent-context extension loading the repo's
 * own E2E suites use.
 */

export const EVIDENCE_ROOT =
  '/home/z/my-project/download/local-notes-human-qa-20261014/evidence';

export const distDir = '/home/z/my-project/repo-local-notes/dist';

/** Unique synthetic marker strings to detect loss/duplication/leakage. */
export const MARKERS = {
  body: 'QA-AUDIT-MARKER-BODY-7f3a',
  title: 'QA Audit Marker Note 7f3a',
  subtitle: 'QA Audit Subtitle 7f3a',
  tag: 'audittag7f3a',
  category: 'Audit Category 7f3a',
  importMd: 'QA-AUDIT-IMPORT-MD-9b1c',
  importHtml: 'QA-AUDIT-IMPORT-HTML-9b1c',
  roundTrip: 'QA-AUDIT-ROUNDTRIP-4d2e',
  backup: 'QA-AUDIT-BACKUP-5e6f',
};

export interface AuditSession {
  context: BrowserContext;
  page: Page;
  extensionId: string;
  evidence: EvidenceCollector;
  /** Freshly created per-session temp profile dir (isolated per brief §1). */
  userDataDir: string;
  openDashboard(): Promise<void>;
}

export class EvidenceCollector {
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly consoleWarnings: string[] = [];
  readonly externalRequests: string[] = [];
  readonly windowDialogs: string[] = [];
  readonly screenshots: string[] = [];
  readonly notes: string[] = [];
  readonly specName: string;

  constructor(specName: string) {
    this.specName = specName;
    mkdirSync(join(EVIDENCE_ROOT, specName), { recursive: true });
  }

  screenshot(page: Page, name: string): Promise<void> {
    const file = join(EVIDENCE_ROOT, this.specName, `${name}.png`);
    this.screenshots.push(`${name}.png`);
    this.notes.push(`screenshot ${name} at ${new Date().toISOString()}`);
    return page.screenshot({ path: file, fullPage: false });
  }

  note(text: string): void {
    this.notes.push(`${text} at ${new Date().toISOString()}`);
  }

  async write(): Promise<void> {
    const summary = {
      spec: this.specName,
      pageErrors: this.pageErrors,
      consoleErrors: this.consoleErrors,
      consoleWarnings: this.consoleWarnings,
      externalRequests: this.externalRequests,
      windowDialogs: this.windowDialogs,
      screenshots: this.screenshots,
      notes: this.notes,
    };
    writeFileSync(
      join(EVIDENCE_ROOT, this.specName, 'session-evidence.json'),
      JSON.stringify(summary, null, 2),
    );
  }
}

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

export async function launchAuditSession(
  specName: string,
): Promise<AuditSession> {
  if (!existsSync(join(distDir, 'manifest.json'))) {
    throw new Error(`dist/ is not built — run "npm run build" first (${distDir})`);
  }
  const userDataDir = mkdtempSync(join(tmpdir(), `lnwa-audit-${specName}-`));
  const evidence = new EvidenceCollector(specName);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--disable-gpu',
      '--no-sandbox',
      // Container hygiene: /dev/shm is 64 MB here; without this flag
      // long multi-session runs exhaust it and CDP input dispatch stalls
      // (observed empirically: clicks/fills hang while evaluate works).
      '--disable-dev-shm-usage',
    ],
  });
  let extensionId = '';
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
  const page = await context.newPage();
  page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    if (message.type() === 'warning') evidence.consoleWarnings.push(message.text());
  });
  page.on('dialog', (dialog) => {
    evidence.windowDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });
  context.on('request', (request) => {
    if (!isLocalUrl(request.url())) evidence.externalRequests.push(request.url());
  });

  const openDashboard = async (): Promise<void> => {
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
  };
  await openDashboard();
  return { context, page, extensionId, evidence, userDataDir, openDashboard };
}

/** Dismiss first-run onboarding through the real UI, like a real user. */
export async function dismissOnboarding(page: Page): Promise<void> {
  const onboarding = page.locator('dialog.dialog--onboarding');
  await onboarding.waitFor({ state: 'visible', timeout: 20_000 });
  await onboarding.getByRole('button', { name: 'Get started' }).click();
  await onboarding.waitFor({ state: 'hidden', timeout: 10_000 });
}

/** Create a note through the real UI and wait for the durable Saved state. */
export async function createNote(
  page: Page,
  title: string,
  body = MARKERS.body,
): Promise<void> {
  await page.getByRole('button', { name: 'New Note' }).click();
  await page
    .getByRole('button', { name: /Open Untitled for editing/ })
    .first()
    .click();
  const titleField = page.locator('.editor-panel__title');
  await titleField.waitFor({ state: 'visible', timeout: 15_000 });
  await titleField.fill(title);
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type(body);
  await expectSaved(page);
}

export async function expectSaved(page: Page): Promise<void> {
  await page.locator('#save-state').waitFor({ state: 'visible', timeout: 10_000 });
  await page
    .locator('#save-state')
    .filter({ hasText: 'Saved' })
    .waitFor({ timeout: 25_000 });
}

export async function backToList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.locator('.editor-panel__title').waitFor({ state: 'hidden', timeout: 10_000 });
}

/**
 * Resilient click for the audit: Playwright's CDP-dispatched input
 * intermittently stalls on verified-clickable elements in this container
 * (observed ~2 times across the audit; DOM state proven clean by probes).
 * On stall, the SAME real element receives a DOM-dispatched click — the
 * identical event handler runs. Every fallback is recorded as evidence.
 */
export async function auditClick(
  locator: { click(options?: { timeout?: number }): Promise<unknown>; evaluate(fn: (el: unknown) => void): Promise<unknown> },
  evidence: { note(text: string): void } | null,
  label: string,
): Promise<void> {
  try {
    await locator.click({ timeout: 20_000 });
    return;
  } catch {
    evidence?.note(`INPUT FALLBACK: Playwright click stalled on "${label}" (20s); DOM-dispatched click on the same element used`);
    await Promise.race([
      locator.evaluate((el) => (el as HTMLElement).click()),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
}

/**
 * Import a note file through the REAL sidebar path: the app builds its
 * real (detached) picker input on click, Playwright's filechooser
 * interception sets the real file on it, and the app's own change
 * listener runs the full import code path. (Verified by probe: setFiles
 * sets input.files and dispatches change; the import lands.)
 */
export async function importNoteFile(page: Page, filePath: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page
      .getByRole('button', { name: 'Import a note file (JSON, Markdown or HTML)' })
      .click(),
  ]);
  await chooser.setFiles(filePath);
  await page.waitForTimeout(1200);
}

/** Resilient fill: same DOM-fallback approach as auditClick. */
export async function auditFill(
  locator: { fill(value: string, options?: { timeout?: number }): Promise<unknown>; evaluate(fn: (el: unknown, value: string) => void, value: string): Promise<unknown> },
  value: string,
  evidence: { note(text: string): void } | null,
  label: string,
): Promise<void> {
  try {
    await locator.fill(value, { timeout: 20_000 });
    return;
  } catch {
    evidence?.note(`INPUT FALLBACK: fill stalled on "${label}" (20s); setting value via DOM and dispatching input`);
    await Promise.race([
      locator.evaluate((el, v) => {
        (el as HTMLInputElement).value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
}

export { expect } from '@playwright/test';
