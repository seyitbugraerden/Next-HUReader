import { defineConfig } from '@playwright/test';

const port = Number(process.env.WORKFLOW_TEST_PORT ?? 3100);
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
const browserName =
  process.env.PLAYWRIGHT_BROWSER === 'webkit' ? 'webkit' : 'chromium';
export default defineConfig({
  outputDir: `test-results/${browserName}`,
  testDir: './test/browser',
  testMatch: '**/*.pw.ts',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName,
    channel:
      browserName === 'chromium' && channel !== 'chromium' ? channel : undefined,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run start:prod',
    env: { PORT: String(port) },
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
