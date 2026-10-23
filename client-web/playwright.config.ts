import { defineConfig, type Project } from '@playwright/test';

import { scenarioKindOf, scenarioPresetOf, type ScenarioKind } from './tests/support/scenario-env';
import { resolveScenarioPorts, type PlaywrightPorts } from './tests/support/scenario-ports';

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
 * 依赖**官方战争场景**预置（战场分析基站/重组制造台/补给站、固定出生点）的 spec：
 * 只在 war project 里跑；skirmish project 整文件忽略，war project 只收这些文件。
 */
const POLES_SPECS = ['**/cube-poles.spec.ts'];

const WAR_ONLY_SPECS = [
  '**/planet-three.spec.ts',
  '**/cube-surface.spec.ts',
  '**/industrial-development.spec.ts',
  '**/planet-build-workflow.spec.ts',
  '**/planet-belt-elevated-drag.spec.ts',
  '**/planet-hud-resources.spec.ts',
  '**/planet-produce-units.spec.ts',
  '**/war-workbench-authoritative.spec.ts',
  '**/war-workbench-pure-gui.spec.ts',
];

/**
 * 每个场景一组 webServer（服务端 + vite dev），端口组互不重叠：
 * - `skirmish`：默认场景，与 `scripts/playtest-up.sh` 同口径（config-skirmish + map-skirmish，
 *   tick_rate_override=4，全新临时 data_dir）；
 * - `war`：官方战争场景（config-war + map-war）。
 *
 * 两组都挂在顶层 `webServer` 数组（Playwright 1.58 不支持 project 级 webServer），
 * 因此默认 `npx playwright test` 两个场景的服务端与 Web 都会起来，各自被对应的 project 使用。
 * 默认两个 project 都跑，覆盖不会悄悄丢；只跑一个场景用 `--project=skirmish` / `--project=war`
 * （另一场景的 webServer 仍会被拉起，但不会有测试连它）。
 *
 * 极区夹具（`poles`，N=48 地图 + `config-dev.yaml`）只在显式指定 `--project=poles`
 * 或 `SW_SCENARIO=poles` 时起：它要用自己的地图，默认带上会多起一组服务端。
 * 只连已起好的环境：`SW_SKIP_WEBSERVER=1` + `SW_WEB_ENTRY` / `SW_BACKEND_ENTRY`（此时只有一个 project）。
 */
function scenarioWebServer(ports: PlaywrightPorts, kind: ScenarioKind) {
  const preset = scenarioPresetOf(kind);
  return [
    {
      // 场景参数显式透传（不依赖环境继承）：webServer 子进程拿到的就是这里写死的这一组。
      command: [
        `SW_SERVER_CONFIG=${preset.config}`,
        `SW_SERVER_MAP_CONFIG=${preset.mapConfig}`,
        `SW_TICK_RATE=${preset.tickRate}`,
        'node',
        scenarioServerScript,
        ports.backendPort,
      ].join(' '),
      url: `${ports.backendEntry}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `VITE_SW_PROXY_TARGET=${ports.backendEntry} npm run dev -- --host 127.0.0.1 --port ${ports.webPort} --strictPort`,
      url: ports.webEntry,
      // 复用已有 dev server 会让新端口指向旧服务端；端口是动态的，撞车概率低，一律不复用。
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ];
}

/**
 * 每个场景两个 project：
 * - `<场景>-setup`：把该场景的入口/端口/服务端参数写进 worker env（webServer 在顶层）；
 * - `<场景>`：依赖 setup，spec 从 env 读场景（`tests/support/scenario.ts`）。
 *
 * worker 里能稳定拿到的只有 `process.env`（`test.info()` 在 spec 收集阶段不可用），
 * 所以场景参数走 setup project 产出的 env（Playwright 的 producedEnv 会透传给依赖方）。
 * 端口组在主进程先申请好并写回 process.env，worker 重新加载本配置时直接复用。
 */
function scenarioProjects(kind: ScenarioKind, ports: PlaywrightPorts): Project[] {
  return [
    {
      name: `${kind}-setup`,
      testMatch: '**/setup.setup.ts',
      metadata: { scenario: kind },
    },
    {
      name: kind,
      dependencies: [`${kind}-setup`],
      // war：只收依赖战争预置的 spec；skirmish：排除它们和极区夹具；poles：只收极区 spec。
      testMatch: kind === 'war' ? WAR_ONLY_SPECS : kind === 'poles' ? POLES_SPECS : undefined,
      testIgnore: kind === 'skirmish' ? [...WAR_ONLY_SPECS, ...POLES_SPECS] : undefined,
      use: { baseURL: ports.webEntry },
    },
  ];
}

// 显式只要极区夹具时（`SW_SCENARIO=poles` 或命令行 `--project=poles`）只起它那一组
// 服务端；默认仍是 skirmish + war 两组，极区夹具不进默认跑。
// worker 进程重新加载本配置时 argv 里没有 `--project`，所以主进程判定后写回
// SW_SCENARIO，worker 靠环境变量看到同一个选择（否则 project 集合对不上）。
if (process.argv.some(arg => /^--project[= ]poles\b/.test(arg))) {
  process.env.SW_SCENARIO = 'poles';
}
const scenarioKinds: ScenarioKind[] = skipWebServer
  ? [scenarioKindOf()]
  : scenarioKindOf() === 'poles'
    ? ['poles']
    : ['skirmish', 'war'];
const portsByKind = await resolveScenarioPorts(scenarioKinds);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    launchOptions: {
      args: gpuLaunchArgs,
    },
    viewport: {
      width: 1440,
      height: 1080,
    },
  },
  projects: skipWebServer
    ? [{
        name: scenarioKindOf(),
        use: { baseURL: process.env.SW_WEB_ENTRY },
      }]
    : scenarioKinds.flatMap(kind => scenarioProjects(kind, portsByKind[kind]!)),
  webServer: skipWebServer
    ? undefined
    : scenarioKinds.flatMap(kind => scenarioWebServer(portsByKind[kind]!, kind)),
});
