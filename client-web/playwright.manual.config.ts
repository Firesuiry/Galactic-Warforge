import { defineConfig } from '@playwright/test';

/**
 * 手工截图专用（不进 CI、不进 test:visual）：直接连真实服务端 + 真实显卡，
 * 用 SW_WEB_ENTRY 指向已经起好的 vite dev。
 *
 *   SW_WEB_ENTRY=http://127.0.0.1:2073 SW_FF_SHOT_DIR=/abs/path \
 *     npx playwright test --config playwright.manual.config.ts
 */
export default defineConfig({
  testDir: './tests-manual',
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: process.env.SW_WEB_ENTRY ?? 'http://127.0.0.1:2073',
    launchOptions: {
      args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'],
    },
    viewport: { width: 1440, height: 1080 },
  },
});
