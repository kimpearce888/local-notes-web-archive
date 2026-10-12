import { defineConfig } from '@playwright/test';

const timeoutMs = Number.parseInt(process.env['TEST_TIMEOUT_MS'] ?? '30000', 10);
const channel = process.env['CHROME_CHANNEL'] ?? 'chromium';

/**
 * E2E suite loads the built unpacked extension (dist/) into a persistent
 * Chromium context. Extension service workers require a persistent context;
 * tests therefore run fully serially with one worker.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: timeoutMs,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: channel === 'chromium' ? undefined : channel,
    headless: false,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});
