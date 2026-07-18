# 顶栏不显示 minerals 余额，"暂无矿石库存"常驻误导玩家

- 状态：已修复
- 首次记录：2026-07-18
- 来源：2026-07-18 Web 试玩
- 类别：Web / HUD / 资源显示
- 修复提交：b2742f3

## 修复内容（2026-07-18）

1. 顶栏矿产 chip 主值改为一级资源 `resources.minerals`（建设资金），背包矿石库存降级为 chip 的 title 提示（`TopNav.tsx`）；行星页 hero chip（`PlanetPage.tsx`）与总览页战役卡/玩家状态栏（`OverviewPage.tsx`）同步改造，矿石物品库存作为"背包"二级信息保留。
2. 建造卡片新增余额校验：余额不足时卡片置灰禁用（`planet-build-card--unaffordable`），title 提示"矿不足：需要 X / 现有 Y"（`PlanetBuildBar.tsx` + `styles/index.css`）。
3. 测试：`TopNav.test.tsx` / `OverviewPage.test.tsx` / `PlanetPage.test.tsx` 断言顶栏显示 minerals 数字而非"暂无矿石库存"；`PlanetBuildBar.test.tsx` 新增余额不足置灰与余额充足可用用例；Playwright `tests/planet-hud-resources.spec.ts` 在真实服务器上验证顶栏与建造栏显示。

## 问题描述

顶栏"矿产"位显示的是 `formatMineralInventory()`（`client-web/src/features/mineral-summary.ts`），即玩家背包里的矿石类物品（铁矿/硅矿等）。当前矿机产出进建筑本地存储、不进玩家背包，所以该位置从开局到中期永远显示"暂无矿石库存"。而建造真正消耗的 `minerals`（开局 240、造建筑逐项扣）在 HUD 上完全没有显示。

## 实际现象

- 新开局 minerals=240 时顶栏就显示"暂无矿石库存"
- 玩家看不到自己还剩多少建设资金，点建造卡片（矿 30 / 矿 120）时无法判断买不买得起
- 与 gameplay-02 叠加后，玩家在"资金链已断"的状态下继续操作却毫无察觉

## 影响

- 玩家对经济状态完全失明，是发展体验的硬伤

## 推荐改进

1. 顶栏把 `minerals` 和 `energy` 作为一级资源直接显示（energy 已有，minerals 没有）
2. 矿石物品库存改成二级信息（如 hover 展开或在行星页资源卡片里按建筑存储聚合展示）
3. 建造卡片在余额不足时直接置灰并提示"矿不足：需要 120 / 现有 20"

## 证据

- 截图：`docs/player/assets/2026-07-18-web-playtest/10-planet-fresh.png`（minerals=240 时顶栏即显示"暂无矿石库存"）
- 代码：`client-web/src/features/mineral-summary.ts:30`
