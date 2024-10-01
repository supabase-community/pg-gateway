import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'general',
      environment: 'node',
      include: ['test/general/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    },
  },
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['test/node/**/*.{test,spec}.ts'],
      includeSource: ['src/**/*.ts'],
    },
  },
  {
    test: {
      name: 'chromium',
      include: ['test/browser/**/*.{test,spec}.ts'],
      browser: {
        enabled: true,
        provider: 'playwright',
        name: 'chromium',
        headless: true,
        screenshotFailures: false,
      },
    },
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
  },
  {
    test: {
      name: 'firefox',
      include: ['test/browser/**/*.{test,spec}.ts'],
      browser: {
        enabled: true,
        provider: 'playwright',
        name: 'firefox',
        headless: true,
        screenshotFailures: false,
      },
    },
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
  },
  {
    test: {
      name: 'webkit',
      include: ['test/browser/**/*.{test,spec}.ts'],
      browser: {
        enabled: true,
        provider: 'playwright',
        name: 'webkit',
        headless: true,
        screenshotFailures: false,
      },
    },
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
  },
]);
