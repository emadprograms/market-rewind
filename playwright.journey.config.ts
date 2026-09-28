import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated Playwright config for the offline "replay journey" suite.
 * ---------------------------------------------------------------------------
 * Every network call is mocked (see tests/regression/mocks), so this suite
 * needs NO DuckDB streaming backend — only the Vite dev server to serve the
 * SPA. Run it standalone with:
 *
 *   npx playwright test -c playwright.journey.config.ts
 *
 * It is intentionally separate from playwright.config.ts (the live-backend
 * regression suite) so the two never fight over the dev server, and so the
 * journey suite can run in CI without market data.
 */
export default defineConfig({
  testDir: './tests/regression/journey',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Real playback (play → wait → trade) needs a little more headroom.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  // Boots the Vite dev server automatically; the API layer is fully mocked.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
