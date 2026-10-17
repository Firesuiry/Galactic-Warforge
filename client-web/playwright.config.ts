import { defineConfig } from '@playwright/test';

import { BACKEND_ENTRY, PORTS, SERVER_ENV, WEB_ENTRY } from './tests/support/scenario';

const skipWebServer = process.env.SW_SKIP_WEBSERVER === '1';
const scenarioServerScript = './tests/support/start-scenario-server.mjs';

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

/**
 * 默认场景与 `scripts/playtest-up.sh` 同口径：遭遇战预设（config-skirmish + map-skirmish，
 * tick_rate_override=4，全新临时 data_dir），端口每次动态申请（见 tests/support/scenario.ts）。
 * 只想连已起好的环境：SW_SKIP_WEBSERVER=1 + SW_WEB_ENTRY / SW_BACKEND_ENTRY。
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: WEB_ENTRY,
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
          // 场景参数显式透传（不依赖环境继承）：webServer 子进程拿到的就是这里写死的这一组。
          command: [
            ...Object.entries(SERVER_ENV).map(([key, value]) => `${key}=${value}`),
            'node',
            scenarioServerScript,
            PORTS.backendPort,
          ].join(' '),
          url: `${BACKEND_ENTRY}/health`,
          reuseExistingServer: false,
          timeout: 180_000,
        },
        {
          command: `VITE_SW_PROXY_TARGET=${BACKEND_ENTRY} npm run dev -- --host 127.0.0.1 --port ${PORTS.webPort} --strictPort`,
          url: WEB_ENTRY,
          // 复用已有 dev server 会让新端口指向旧服务端；端口是动态的，撞车概率低，一律不复用。
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
