import { defineConfig } from '@playwright/test';

const webPort = process.env.SW_WEB_PORT ?? '4173';
const backendPort = process.env.SW_BACKEND_PORT ?? '19481';
const webEntry = process.env.SW_WEB_ENTRY ?? `http://127.0.0.1:${webPort}`;
const backendEntry = process.env.SW_BACKEND_ENTRY ?? `http://127.0.0.1:${backendPort}`;
const skipWebServer = process.env.SW_SKIP_WEBSERVER === '1';

/**
 * headless chromium 默认走 SwiftShader 软渲染（占满多核、3D 只有 1–2 fps）。
 * `--use-angle=vulkan` 让 ANGLE 直连本机 Vulkan 驱动（原生 Linux 上是 NVIDIA GPU）；
 * 无可用 Vulkan 驱动时 chromium 会自动回退 SwiftShader，因此这里可以无条件带上。
 */
const gpuLaunchArgs = [
  '--use-angle=vulkan',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: webEntry,
    trace: 'on-first-retry',
    launchOptions: {
      args: gpuLaunchArgs,
    },
    viewport: {
      width: 1440,
      height: 1080,
    },
  },
  webServer: skipWebServer
    ? undefined
    : [
        {
          command: `bash ../server/scripts/start_official_war_test_server.sh ${backendPort}`,
          url: `${backendEntry}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `VITE_SW_PROXY_TARGET=${backendEntry} npm run dev -- --host 127.0.0.1 --port ${webPort}`,
          url: webEntry,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
