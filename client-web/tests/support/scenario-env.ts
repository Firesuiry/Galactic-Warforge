/**
 * 场景定义（纯函数，**不依赖 @playwright/test**）。
 *
 * 同时被三处使用：
 * - `playwright.config.ts`（主进程）为每个 project 算场景参数与端口；
 * - `tests/support/setup.setup.ts`（setup project 的 worker）把当前场景参数写进 `process.env`；
 * - `tests/support/scenario.ts`（spec 所在 worker）读当前 worker 的场景。
 *
 * 为什么不在 spec 里用 `test.info().project.metadata`：spec 在收集阶段（module scope）
 * 就调用 `requireScenario()`，那时 `test.info()` 还不可用（只能在测试运行中调用）。
 * worker 里能稳定拿到的只有 `process.env`，所以场景参数通过 setup project 的 env 透传。
 */
export type ScenarioKind = 'skirmish' | 'war';

export interface ScenarioPreset {
  /** 服务端配置（相对仓库根）。 */
  config: string;
  /** 地图配置（相对仓库根）。 */
  mapConfig: string;
  /** 进程级 tick 速率覆盖（试玩口径 4）。 */
  tickRate: string;
}

/** 与 `scripts/playtest-up.sh` 的默认值一致：遭遇战预设 + 同图 + tick_rate_override=4。 */
export const SKIRMISH: ScenarioPreset = {
  config: 'server/config-skirmish.yaml',
  mapConfig: 'server/map-skirmish.yaml',
  tickRate: '4',
};

/** 官方战争场景：预置战场分析基站/重组制造台/双方补给站与固定出生点。 */
export const WAR: ScenarioPreset = {
  config: 'server/config-war.yaml',
  mapConfig: 'server/map-war.yaml',
  tickRate: '4',
};

/** 场景预设（显式 SW_SERVER_CONFIG / SW_SERVER_MAP_CONFIG / SW_TICK_RATE 优先）。 */
export function scenarioPresetOf(kind: ScenarioKind, env: NodeJS.ProcessEnv = process.env): ScenarioPreset {
  const base = kind === 'war' ? WAR : SKIRMISH;
  return {
    config: env.SW_SERVER_CONFIG ?? base.config,
    mapConfig: env.SW_SERVER_MAP_CONFIG ?? base.mapConfig,
    tickRate: env.SW_TICK_RATE ?? base.tickRate,
  };
}

/**
 * 当前进程的场景名。spec 在 worker 里由 setup project 注入 `SW_SCENARIO`；
 * 显式单场景模式（SW_SCENARIO / SW_SERVER_CONFIG）直接读环境变量，都没有则按遭遇战算。
 */
export function scenarioKindOf(env: NodeJS.ProcessEnv = process.env): ScenarioKind {
  if (env.SW_SCENARIO === 'war' || env.SW_SCENARIO === 'skirmish') {
    return env.SW_SCENARIO;
  }
  return /(^|[-_/])war([-_.]|$)/.test(env.SW_SERVER_CONFIG ?? '') ? 'war' : 'skirmish';
}
