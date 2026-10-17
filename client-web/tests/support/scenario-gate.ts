/**
 * 场景门禁：Playwright 默认只起**一个**服务端（与 `scripts/playtest-up.sh` 同口径的遭遇战预设），
 * 依赖官方战争场景（预置战场分析基站/重组制造台/双方补给站/固定出生点）的用例在这种服务端上
 * 必然失败。这些文件在顶部调用 `requireScenario('war')`：默认场景下整文件 skip，
 * 需要时用战争预设重跑：
 *
 *   SW_SERVER_CONFIG=server/config-war.yaml SW_SERVER_MAP_CONFIG=server/map-war.yaml \
 *     npx playwright test tests/war-workbench-authoritative.spec.ts
 */
import { test } from '@playwright/test';

import { SCENARIO } from './scenario';

export type ScenarioKind = 'skirmish' | 'war';

/** 由服务端配置文件名推断场景（config-war.yaml → war，其余按遭遇战算）。 */
export const SCENARIO_KIND: ScenarioKind = /(^|[-_/])war([-_.]|$)/.test(SCENARIO.config) ? 'war' : 'skirmish';

export function requireScenario(kind: ScenarioKind, reason: string): void {
  test.skip(SCENARIO_KIND !== kind, reason);
}
