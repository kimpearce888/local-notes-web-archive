import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Performance project (T-043, PRD §11): heavy seeded benchmarks that are too
 * slow for the default unit run. Execute with `npm run test:perf`; the
 * measured numbers are recorded in docs/RELEASE_VERIFICATION.md.
 * (T-109 layout: suites under dev/tests/, paths anchored to the repo root.)
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: [`${repoRoot}/dev/tests/perf/**/*.test.ts`],
    setupFiles: [`${repoRoot}/dev/tests/unit/setup.ts`],
    restoreMocks: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
