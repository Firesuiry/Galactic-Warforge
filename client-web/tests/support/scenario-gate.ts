/**
 * 场景门禁：Playwright 默认起**两个** project，各自一组 webServer/端口：
 * - `skirmish`（默认场景，与 `scripts/playtest-up.sh` 同口径）；
 * - `war`（官方战争场景：预置战场分析基站/重组制造台/补给站、固定出生点）；
 * - `poles`（极区地图夹具，只在显式 `--project=poles` 时起）。
 *
 * 依赖官方战争预置的 spec 在文件顶部调用 `requireScenario('war', ...)`：不在 war project
 * 里时整文件 skip。默认 `npx playwright test` 两个 project 都跑，覆盖不会悄悄丢。
 *
 * 注意必须用 **beforeEach 里的运行时 skip**，不能用 module scope 的
 * `test.skip(条件, ...)`：spec 的 module scope 在**主进程收集阶段**就会被执行一次，
 * 那时 setup project 还没跑、场景环境变量（SW_SCENARIO）还不存在，条件会误判成 skip，
 * 而 skip 注解一旦在收集阶段落下，worker 就不会再重新判断。
 *
 * 只跑某一个场景：`npx playwright test --project=war` / `--project=skirmish` / `--project=poles`。
 */
import { test } from '@playwright/test';

export type ScenarioKind = 'skirmish' | 'war' | 'poles';

export function requireScenario(kind: ScenarioKind, reason: string): void {
  test.beforeEach(({}, testInfo) => {
    if (testInfo.project.name !== kind) {
      test.skip(true, reason);
    }
  });
}
