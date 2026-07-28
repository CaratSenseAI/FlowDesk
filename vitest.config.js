import { defineConfig } from 'vitest/config';

/**
 * Frontend tests only.
 *
 * Without an explicit include, vitest globs the whole repo and picks up
 * backend/tests — including the integration suite, which needs a database and
 * fails noisily here. The backend has its own configs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    exclude: ['**/node_modules/**', 'backend/**'],
  },
});
