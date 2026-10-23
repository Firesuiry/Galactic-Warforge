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
export type ScenarioKind = 'skirmish' | 'war' | 'poles';

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

/**
 * 极区夹具场景：N=48 的小行星，两名玩家分别钉在北/南极面中心（`spawn_points`
 * 由 map 文件给），只跑 `cube-poles.spec.ts`。用**不带 `scenario_bootstrap`** 的
 * 普通配置：战争场景的预置建筑坐标是 N=144 地图上的 cell 坐标，套到 144×96 的
 * 极区图集会越界（服务端加载期报错并拒绝启动）。
 */
export const POLES: ScenarioPreset = {
  config: 'server/config-dev.yaml',
  mapConfig: 'server/testdata/map-cube-poles.yaml',
  tickRate: '4',
};

const PRESETS: Record<ScenarioKind, ScenarioPreset> = { skirmish: SKIRMISH, war: WAR, poles: POLES };

/** 场景预设（显式 SW_SERVER_CONFIG / SW_SERVER_MAP_CONFIG / SW_TICK_RATE 优先）。 */
export function scenarioPresetOf(kind: ScenarioKind, env: NodeJS.ProcessEnv = process.env): ScenarioPreset {
  const base = PRESETS[kind];
  return {
    config: env.SW_SERVER_CONFIG ?? base.config,
    mapConfig: env.SW_SERVER_MAP_CONFIG ?? base.mapConfig,
    tickRate: env.SW_TICK_RATE ?? base.tickRate,
  };
}

/**
 * 当前进程的场景名。spec 在 worker 里由 setup project 注入 `SW_SCENARIO`；
 * 显式单场景模式（SW_SCENARIO / SW_SERVER_CONFIG / SW_SERVER_MAP_CONFIG）直接读
 * 环境变量，都没有则按遭遇战算。
 */
export function scenarioKindOf(env: NodeJS.ProcessEnv = process.env): ScenarioKind {
  if (env.SW_SCENARIO === 'war' || env.SW_SCENARIO === 'skirmish' || env.SW_SCENARIO === 'poles') {
    return env.SW_SCENARIO;
  }
  if (/cube-poles/.test(env.SW_SERVER_MAP_CONFIG ?? '')) {
    return 'poles';
  }
  return /(^|[-_/])war([-_.]|$)/.test(env.SW_SERVER_CONFIG ?? '') ? 'war' : 'skirmish';
}
