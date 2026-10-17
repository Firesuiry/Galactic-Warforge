/**
 * 浏览器测试钩子（`window.__planetThree` / `window.__systemThree`）的开关。
 *
 * 钩子只在两种构建里存在：
 * - 开发服务器（`npm run dev`，`import.meta.env.DEV`）：Playwright 的 webServer 用的就是它；
 * - 显式带构建开关 `VITE_E2E=1` 的生产构建（试玩环境的 `vite build`）。
 *
 * 生产构建默认**不包含**这段代码：`import.meta.env.VITE_E2E` 在构建时被静态替换为
 * `undefined`，`undefined === '1'` 恒假，整个分支（连同 `?e2e=1` 查询串判断）被压缩器删掉，
 * dist 里 grep 不到 `e2e`。以前是「DEV || URL 带 ?e2e」——线上任何人加个查询串就能拿到
 * 场景调试句柄，测试钩子不该在正式产物里可触发。
 */
export function exposeTestHook(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
}
