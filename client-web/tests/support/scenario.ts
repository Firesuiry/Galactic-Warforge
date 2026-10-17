/**
 * spec 侧的运行时入口（worker 里读 `process.env`）。
 *
 * 场景参数由 `playwright.config.ts` 按 project 注入：每个场景的 setup project 把入口/端口/
 * 服务端参数写进 worker env（`tests/support/setup.setup.ts`），Playwright 再透传给依赖它的
 * spec worker。
 *
 * **只能在测试运行时（test body / hook）调用**：spec 的 module scope 在收集阶段执行，
 * 那时 setup project 还没跑，环境变量还不存在（见 `scenario-gate.ts` 的说明）。
 */
export function webEntry(): string {
  const entry = process.env.SW_WEB_ENTRY;
  if (!entry) {
    throw new Error('缺少 SW_WEB_ENTRY：Playwright 的 setup project 没有注入场景环境（见 tests/support/setup.setup.ts）。');
  }
  return entry;
}

export function backendEntry(): string {
  const entry = process.env.SW_BACKEND_ENTRY;
  if (!entry) {
    throw new Error('缺少 SW_BACKEND_ENTRY：Playwright 的 setup project 没有注入场景环境（见 tests/support/setup.setup.ts）。');
  }
  return entry;
}
