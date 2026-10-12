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
  // A dedicated port, started fresh for every run, with a strict bind.
  //
  // This suite used to target port 3000 with `reuseExistingServer: !process.env.CI`. That is the
  // usual convenience setting and it was actively harmful here: anything already listening on 3000 —
  // in the reporting environment, a launchd daemon running `vite preview` with KeepAlive — was
  // silently reused, so the suite tested a `dist/` bundle built before the code under test. Results
  // looked like app failures and were in fact stale artefacts, and `--strictPort` avoids the milder
  // version of the same trap, where Vite quietly moves to another port and the URL check passes
  // against a server that is not the one being tested.
  webServer: {
    command: 'npm run dev -- --port 3100 --strictPort',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
