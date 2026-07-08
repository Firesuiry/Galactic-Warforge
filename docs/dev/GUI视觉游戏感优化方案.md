# SiliconWorld GUI 视觉与游戏感优化方案（2026-07）

> 目标：把当前"后台仪表盘"式的界面，改成有主题、有层级、有反馈的**科幻全息指挥台**游戏界面。
> 参考标杆：**戴森球计划 DSP**（同题材，半透明蓝橙全息面板 + 微光 + 俯视清晰）、Endless Space 2（细线极简全息）、Stellaris（顶栏 at-a-glance 资源脉搏）。
> 执行方式：子代理按 V0→V4 逐阶段实现，每阶段验收（tsc + vitest + build + Playwright 重录 + 真实浏览器截图）。
> 约束：**保留 `data-entity-*`**（不破坏 agent 可调试性）、动画只用 transform/opacity、尊重 `prefers-reduced-motion`、不重新引入拖拽卡顿。

## 一、设计原则（来自调研）

1. **信息层级**：核心信息（资源/告警/地图）永远可见，次要信息一键展开。这是 4X 界面第一通病。
2. **主题一致性（diegetic）**：界面像"在操作一艘舰桥的全息控制台"，而非 SaaS 后台。
3. **渐进披露**：复杂度随玩家成长显现，不一次性堆满。
4. **即时反馈（juice）**：每个操作（点击/建造/选中/tick）都有视觉/动效确认。
5. **地图当主角**：核心场景（行星棋盘/战场）是视觉焦点，文字面板让位。

> 出处：Kyle Kukshtel《Some Game UI Principles》、Game Developer《UI Strategy Game Dos & Don'ts》、Brad Woods《Juice》、HUDS+GUIS Endless Space 2 案例、Paradox Stellaris Dev Diary #154。

## 二、设计 Token（V0 落地，全局复用）

在 `client-web/src/styles/index.css:1` 的 `:root` 定义：

```css
:root {
  /* 字体 */
  --font-display: "Orbitron", "PingFang SC", sans-serif;   /* 标题/数值 */
  --font-body: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  /* 色板（DSP 全息） */
  --bg-0: #060912; --bg-1: #0a1428;
  --panel-bg: rgba(12, 22, 44, 0.72);
  --panel-bg-solid: #0c162c;
  --border: rgba(120, 180, 255, 0.14);
  --border-glow: rgba(57, 230, 208, 0.35);
  --accent: #39e6d0;     /* teal 主色（己方/激活） */
  --accent-2: #5fb0ff;   /* blue 次色 */
  --amber: #ffb454;      /* 能量/警告 */
  --danger: #ff5757;     /* 敌方/错误 */
  --good: #6ee7b7;       /* 正向反馈 */
  --text: #e8f1ff; --text-muted: #8fa3c8; --text-dim: #5e7191;
  /* 发光 */
  --glow-accent: 0 0 16px rgba(57, 230, 208, 0.35);
  --glow-amber: 0 0 14px rgba(255, 180, 84, 0.32);
  /* 尺寸 */
  --radius-sm: 6px; --radius: 12px; --radius-lg: 18px;
  /* 动效 */
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-fast: 120ms; --dur: 220ms; --dur-slow: 360ms;
}
```

字体加载：`client-web/index.html` 加 `<link rel="preconnect" href="https://fonts.googleapis.com">` + Orbitron（400/600/700）。离线时回退系统字体，不影响功能。

## 三、分阶段任务

### V0 设计地基（tokens + 字体 + 图标体系）
- `src/styles/index.css`：落 `:root` token（上）；基础元素改用 token（body 背景、a、button）。
- `index.html`：引入 Orbitron。
- 新增 `src/common/Icon.tsx`：`<Icon iconKey={...} color={...} size={...} />`。映射 `catalog.icon_key` → emoji 字形（miner⛏️/assembler🛠️/tesla⚡/lab🧪/mining_machine⛏️/铁🪨/铜🟠/煤⚫/石⬜/油🛢️/硅🔵/worker👷/soldier🪖/...），渲染为"彩色圆角方块底 + 字形"（底色 = catalog color 低透明，边框微光），无映射时回退首字母。同一组件供 DOM 实体节点、资源 chip、命令按钮共用。
- 验收：token 覆盖、字体加载、`<Icon>` 在 storybook/页面可渲染；tsc+vitest+build 绿。

### V1 皮肤（最大视觉收益）
- `.panel`：半透明分层底（`--panel-bg` + backdrop-blur）+ 渐变描边（`::before` mask 或 border-image）+ 角标（`::before/::after` L 形）+ 标题用 `--font-display` 大写 + 字距 + accent 下划线。
- `.top-nav`：品牌字用 display font；资源 chip 重做为 **`<Icon>` + 数值 + 涨跌率(/tick，绿/红)**；告警红点呼吸（`@keyframes pulse`）。
- 行星页 hero（`.page-hero`）：标题 display font，chip 图标化。
- 验收：行星页截图"一眼像游戏"；Playwright 重录；tsc+vitest+build 绿；data-* 保留。

### V2 布局与层级
- 地图当主角：`.planet-map-shell` 放大、加**发光外框**（多层 box-shadow + 角标）；`.page-grid--planet` 重排让地图占主导。
- 右侧文字工作台收进**图标 Tab**（工作台/选中/活动），默认收起次要面板。
- 新增 **minimap**（角落小 overview canvas，复用 overview 数据），点击跳转。
- 验收：首屏焦点在地图；次要信息一键展开；Playwright 重录；测试绿。

### V3 游戏感 / juice
- `@keyframes`：`tick-pulse`（时钟）、`alert-flash`（告警闪烁+glow）、`build-complete`（建造完成缩放+光）、`selection-ring`（选中呼吸环）、`panel-slide-in`、`page-enter`。
- 触发点：tick 更新→时钟脉冲；新告警→闪烁；建造完成事件→节点动效；选中→地图选中环；面板挂载→滑入；路由切换→转场。
- 全部用 transform/opacity；`@media (prefers-reduced-motion: reduce)` 关闭。
- 验收：每个动作有即时反馈；截图/录屏核对；测试绿。

### V4 地图精修（场景感）
- 地形：canvas 每格加明暗/微噪点着色（非贴图，纯算法），水体/熔岩加流光。
- 建筑 DOM 节点：色块 → **`<Icon>` 字形**（V0 组件），选中环动画，hover 高亮。
- 迷雾：硬边 → 软渐变（径向 alpha）。
- 无人机/船：CSS 动画轨迹（沿 target_pos 方向的拖尾）。
- 缩放：补间过渡（CSS transition on `--tile` 或 rAF 插值）。
- 验收：地图有"真实战场/工厂"代入感；data-* 保留；拖拽仍流畅；Playwright 重录；测试绿。

## 四、全局约束（每阶段都必须满足）

1. **保留 `data-entity-*` 与 `data-camera-*`**：视觉是叠加的 CSS/图标，不得删除实体节点的语义属性（agent 可调试性是硬指标）。
2. **性能**：动画只用 `transform`/`opacity`；不得在拖拽热路径加同步重绘；`prefers-reduced-motion` 兜底。
3. **i18n/无障碍**：图标优先但保留 `aria-label`（文案多语言）；颜色不作为唯一信息载体。
4. **测试**：每阶段结束 `cd client-web && npx tsc --noEmit && npm run test && npm run build` 全绿；Playwright 截图基线 `npx playwright test -g "<对应用例>" --update-snapshots` 重录后全绿。
5. **激进式演进**：直接改旧样式定义，不留废弃适配层。

## 五、验收清单（每阶段）
- [ ] tsc / vitest / build 全绿
- [ ] Playwright 全绿（视觉用例已重录）
- [ ] 真实浏览器截图：`node` 驱动 chromium 打开离线样例 + 行星页，截图核对方向（DSP 全息、地图为主角、有反馈）
- [ ] `document.querySelectorAll('[data-entity-kind]')` 仍可取到实体（agent 契约不破）
- [ ] 拖拽地图流畅（无整屏重绘回归）

## 六、执行
逐阶段派子代理实现 → 主线验收（上述清单）→ 通过则提交一批次 → 进入下一阶段。全 V0-V4 完成后汇报。
