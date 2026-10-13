import { defineConfig } from 'vitest/config';

/**
 * Performance project (T-043, PRD §11): heavy seeded benchmarks that are too
 * slow for the default unit run. Execute with `npm run test:perf`; the
 * measured numbers are recorded in docs/RELEASE_VERIFICATION.md.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
