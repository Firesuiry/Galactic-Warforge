/**
 * setup project：把当前场景的入口/端口/服务端参数写进 `process.env`。
 *
 * Playwright 的 worker 只能稳定继承 `process.env`（`test.info()` 在 spec 收集阶段不可用），
 * 所以每个场景配一个 setup project（metadata.scenario = 场景名），它产出的 env 由
 * dispatcher 透传给依赖它的 project 的 worker（见 playwright 的 producedEnv 机制）。
 * 同一份文件被两个 setup project 各跑一次。webServer 在顶层（Playwright 1.58 不支持
 * project 级 webServer），主进程启动时已经等到健康检查通过；这里再确认一次入口可用，
 * 失败信息会带场景名，比 spec 里一堆 ECONNREFUSED 清楚。
 */
import { expect, test } from '@playwright/test';

import { scenarioPresetOf, type ScenarioKind } from './scenario-env';
import { scenarioPorts } from './scenario-ports';

test('准备场景环境（入口 / 端口 / 服务端参数）', async ({ request }, testInfo) => {
  const kind = testInfo.project.metadata.scenario as ScenarioKind;
  // 显式单场景模式（SW_SCENARIO/SW_SERVER_CONFIG）下预设读环境变量；双场景模式下 setup
  // 的 env 与主进程一致（`SW_SERVER_CONFIG` 由调用方显式覆盖时也照传）。
  const preset = scenarioPresetOf(kind);
  const ports = scenarioPorts(kind);
  const { webPort, backendPort, webEntry, backendEntry } = ports;
  // webServer 已经由 Playwright 拉起并等到 url 可用；这里只做一次确认（失败信息带场景名）。
  expect((await request.get(`${backendEntry}/health`)).ok(), `${kind} 服务端健康检查`).toBe(true);
  expect((await request.get(webEntry)).ok(), `${kind} Web 入口可用`).toBe(true);
  Object.assign(process.env, {
    SW_SCENARIO: kind,
    SW_WEB_PORT: String(webPort),
    SW_BACKEND_PORT: String(backendPort),
    SW_WEB_ENTRY: webEntry,
    SW_BACKEND_ENTRY: backendEntry,
    SW_SERVER_CONFIG: preset.config,
    SW_SERVER_MAP_CONFIG: preset.mapConfig,
    SW_TICK_RATE: preset.tickRate,
  });
});
