import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit-test project (T-109 layout): the suites live under dev/tests/ —
 * one level away from the historical tests/ root — so the include and
 * setup paths are anchored to the repository root explicitly
 * (deterministic regardless of where vitest is invoked from).
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: [`${repoRoot}/dev/tests/unit/**/*.test.ts`],
    setupFiles: [`${repoRoot}/dev/tests/unit/setup.ts`],
    restoreMocks: true,
  },
});
