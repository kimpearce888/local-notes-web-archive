import { defineConfig } from '@playwright/test';

/**
 * T-062 audit configuration — runs the human-behavior QA audit specs
 * against the SAME built dist/ the repository's own suite uses, with the
 * same serial persistent-context constraints (extension service workers
 * require a persistent context). The audit specs live OUTSIDE the tracked
 * tree (local .git/info/exclude) so the repository working tree stays
 * clean — this is audit tooling, not product test code.
 */
const root = '../';

export default defineConfig({
  testDir: 'specs',
  timeout: Number.parseInt(process.env['TEST_TIMEOUT_MS'] ?? '90000', 10),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});
