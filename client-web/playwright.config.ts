import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    viewport: {
      width: 1440,
      height: 1080,
    },
  },
  webServer: [
    {
      command: 'bash ../server/scripts/start_official_war_test_server.sh 19481',
      url: 'http://127.0.0.1:19481/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'VITE_SW_PROXY_TARGET=http://127.0.0.1:19481 npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
