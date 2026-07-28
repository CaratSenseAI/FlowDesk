import { defineConfig } from 'vitest/config';

/**
 * Unit tests only — pure functions, no database, no network.
 * Integration tests live behind vitest.integration.config.ts so that a plain
 * `npm test` can never point a schema reset at a real database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
