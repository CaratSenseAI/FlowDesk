import { defineConfig } from 'vitest/config';

/**
 * Integration tests — these RESET a real database.
 *
 * tests/globalSetup.ts refuses to run unless DATABASE_URL names a test
 * database. Do not remove that guard: `prisma db push --force-reset` against
 * the production URL would drop every table.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    // Shared database — tests must not race each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
