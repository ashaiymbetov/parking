import { defineConfig, devices } from '@playwright/test'

/**
 * Runs against a started stack: `docker compose up --build` (default URL)
 * or a dev setup via E2E_BASE_URL. Demo users must exist (SEED_DEMO=true).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
