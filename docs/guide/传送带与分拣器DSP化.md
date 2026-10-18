# 传送带与分拣器 DSP 化（第 18 轮契约）

来源：用户 2026-10-18 反馈——「目前的传送带和夹爪（分拣器）的工作方式或者显示方式，和戴森球计划里边的
不一样，重做这些部分，提升质感，更符合戴森球计划的逻辑」。参考 `tmp/playtest-1017/` 的截图与被否决的现状。

**现状问题**（1017 截图 + 主代理实测）：

1. 分拣器 3D 模型是一根**细长斜伸的拉杆**（两段式机械臂被 `pose()` 拉长到 2 倍格宽），近景里读成
   「自拍杆/天线」，既看不出底座、也看不出夹爪；没有 DSP 里「立柱 + 横臂 + 摆动」的辨识度。
2. 分拣器搬运时，`sorter-payload` 是一个固定铜色方块，不显示真实物品颜色。
3. 传送带剖面是「深色扁带 + 两条细黄边」，没有 DSP 的**侧护栏（raised rails）+ 滚动横向带条**质感；
   带面 chevron 太弱，几乎看不出流向，但两条黄边很抢眼。
4. 带上物品 0.3 cell、每格只画 2 个、等距大间隔、**不随流向旋转**、贴在带面上偏低；
   堵塞时物品停在格中而不是堆在队首（DSP 是向后堆到输出端）。
5. 建造 ghost：分拣器只有两支「取/放」箭头 + 大徽章，**没有分拣器本体预览**；
   DSP 的放置预览是半透明机体 + 贴地细箭头。
6. 2D 战术图里分拣器直接套用「belt」原型（一块带黄纹的深色方块），没有分拣器剪影。

本文是三条并行工作的接口契约：**分拣器 3D／传送带 3D／2D+ghost**。
改动只在 `client-web`，服务端分拣器规则（朝向、range、cycle_ticks、last_transfer）**不动**。

## 0. 坐标系与单位

- 模型局部单位 = 1 cell（细分网格）；`+Y` 上、`+X` 东、`+Z` 南（与 `place()` 的 `makeBasis(east, normal, south)` 一致）。
- 分拣器：`rotation=0` 时**正面（放货端）朝北 = 局部 −Z**，背面（取货端）朝南 = 局部 +Z；
  `rotation` 决定正面朝向（与服务端 `SorterFacing` 同一张锚点表：0 北 / 90 东 / 180 南 / 270 西）。
- 分拣器机械臂在模型里**沿 +X 生长**，动画只写 `sorter-arm.rotation.y`（+X→末端方向）与
  `sorter-claw.position.y`（夹爪升降）——沿用现有 `pose()` 的约定，不要改成 Z 轴生长。
- 传送带：`conveyor-geometry` 的 ribbon 是「输入端口 → 输出端口」的四边形条带，
  端口距格心 0.5（相邻建筑端口 0.64）。剖面参数都在同一函数里，宽度以 cell 计。

## 1. 分拣器（3D 机械臂，DSP 口径）

### 1.1 模型（`three/industrial-models.ts` 的 `sorter()`）

外形目标：**低矮圆底座 + 中央立柱 + 水平横臂 + 末端夹爪**，总高 ≤ 0.55 cell（不能比熔炉抢眼）。
参考剖面（cell，局部原点在格心地面）：

| 部件 | 形状 / finish | 尺寸 | 位置 |
| --- | --- | --- | --- |
| 底座盘 | `cylinder` graphite | 直径 .62 高 .05 | y .025 |
| 底盘中层 | `cylinder` alloy | 直径 .5 高 .025 | y .062 |
| 铜环 | `ring` copper | 半径 .27 | y .075，绕 X 转 90° |
| 四角小脚 | `box` ceramic | .09×.05×.09 | ±.24, y .05 |
| 立柱 | `cylinder` graphite | 直径 .12 高 .3 | y .07→.37 |
| 柱顶铜箍 | `cylinder` copper | 直径 .15 高 .04 | y .37 |
| 转台 | `cylinder` ceramic | 直径 .2 高 .05 | 挂在 `sorter-arm` 下，y .40 |
| 横臂 | `box` graphite | 长 L × .075 高 × .06 宽 | 从转台沿 +X，y .42 |
| 横臂铜顶条 | `box` copper | L×.02×.03 | y .465 |
| 臂端关节 | `box` ceramic | .12×.12×.12 | 沿 +X 距转台 L |
| 夹爪壳 | `box` ceramic | .14×.1×.16 | 关节下方（挂在 `sorter-claw`）|
| 两片指 | `box` alloy | .03×.1×.03 | ±.05 Z，向下 .1 |
| payload | `box` 物品色 | .16³ | 夹爪下 y −.13，默认隐藏 |

- **横臂长度 L**：`L = .55 + (range - 1) * .42`（range=1→.55、2→.97、3→1.39，最长不超过 .95 格；
  Mk.II/III 的臂更长是 DSP 的特征）。`range` 从 `building.sorter.range` 读，模型构建时按
  `BuildingType` 决定不了 range 就按 1（模型按 1 建，动画里 `sorter-arm.scale.x = L/.55` 拉伸横臂子组）。
  **实现约定**：建模时横臂子组 `sorter-boom` 按 L=.55 建，动画里 `boom.scale.x = L/.55`
  并同步移动关节/夹爪的 x（关节组 `sorter-claw` 作为 boom 的子节点挂在 x=.55 处，缩放会一起带上）。
- 分层颜色：`sorter_mk1` 铜色系（现有 copper），`sorter_mk2` 用 `blue` 发光点缀，`sorter_mk3` 用 `orange`；
  铜环/顶条之类的主金属色不变，只换点缀灯/环。
- 必须保留（或按新语义重建）节点名：`sorter-arm`（yaw 组）、`sorter-boom`（横臂缩放组）、
  `sorter-claw`（升降组）、`sorter-payload`（物品占位）。所有会被动画写入变换的节点都要
  `registerRotation(node, 'y', 0)`（= 让 `batchStatic` 跳过整棵子树，动态批次逐帧复制姿态）。
- payload 材质必须 `clone()` 并标 `userData.independentMaterial = true`（要按物品色逐实例改色）。

### 1.2 动画（`three/sorter-animation.ts` 重写，保留 `syncSorterAnimation` 签名）

数据来源不变：`building.sorter.last_transfer`（同 `tick`/`sequence` 去重规则沿用现有实现：
历史记录不重放、只播一次、慢帧也能播）。

一次搬运（cycle）四段，`yaw` 在取货角与放货角之间摆动：

| 阶段 | 占比 | 动作 |
| --- | --- | --- |
| 取货 | 0–.10 | claw 下沉 .04、闭合感（payload 从 .10 起可见）|
| 携带摆动 | .10–.55 | `sorter-arm.rotation.y` 从取货角→放货角（smoothstep，180°）|
| 放货 | .55–.65 | claw 下沉 .04，payload 在 .62 消失 |
| 空载回摆 | .65–1.0 | yaw 放货角→取货角，claw 抬起 |

- 取货角/放货角：由 `last_transfer.source_position` / `target_position` 与格心连线算出
  （`atan2(-dz, dx)`，与现有 `pose()` 的 `arm.rotation.y = -atan2(end.z, end.x)` 同口径）。
  服务端保证两端共线（取货端=背面、放货端=正面），所以摆角恒为约 π。
- **cycle 时长**：`clamp(cycle_ticks / tickRate, .35, 1.6)` 秒；`tickRate` 用快照 tick 差估算
  （连续两次 `syncSorterAnimation` 的 dt 与 Δtick 平滑），拿不到就用 4 tick/s。
- 空闲姿态：停在**取货角**、claw 抬高；`enabled=false`（停机/无电/停工）时整机冻结、payload 隐藏。
- 不要做「垂直 2 段臂」；不要出现整机上下浮动。

### 1.3 分拣器验收（逻辑测试）

- `three/sorter-animation.test.ts` 重写：
  - 新的 `sequence` → 周期内 `sorter-payload.visible` 由 false→true→false；
  - `sorter-arm.rotation.y` 在周期中扫过约 π 且最终回到取货角；
  - 停机（`runtime.state != running`）时连续 `animate()` 后姿态不变、payload 不可见；
  - 初次同步历史 `last_transfer` 不播（沿用现有用例）；
  - 不同 `range` 时 `sorter-boom.scale.x` ≈ `L/.55`。

## 2. 传送带（3D）

### 2.1 剖面（`three/conveyor-geometry.ts` 的 `ribbon` 调用重写）

目标：像 DSP 一样「**低矮、两侧有浅色护栏、中间深色带面上有滚动的横向带条**」。
参数（cell，带体中心线为 0）：

| 部件 | 半宽 | 高度区间 | 颜色 |
| --- | --- | --- | --- |
| 底部机身（双面可见） | ±.30 | −.02 → .045 | graphite（`#26363e` 系）|
| 侧护栏 | ±.255 → ±.30 | .02 → .15 | 外侧 ceramic 浅色、内壁 graphite |
| 护栏顶盖 | ±.245 → ±.31 | .15 → .17 | alloy（金属亮边）|
| 带面（deck） | ±.235 | 顶面 .105 | 深色 + 滚动贴图 |
| 拦边斜角 | ±.235 → ±.255 | .10 → .12 | alloy |

- 带面用**一张滚动贴图**：深色底 + 每格 2 条横向浅色 slat（宽 .04、间距均分）+ 极弱的中心 chevron
  （低对比，只作流向辅助）。贴图滚动 = 流向动画，`update(deltaSeconds, speedTilesPerSecond)` 现有入口保留，
  `map.offset` 的单位仍是「格」。
- 相邻带体在端口处**必须严丝合缝**：所有端口距离统一 .5（相邻建筑端口 .64 只在建筑 IO 处出现）；
  连接方向上**不画端盖**（端盖只在真正的端点画），转弯 `steps` 提到 16，弯道外侧护栏不得出现缺口。
- 带体总宽 .60 略窄于格宽 .86（建筑模型按 .86 缩放），保持格间留缝。
- 不要丢掉 `tileIndex` 拾取属性（点击选中带子要用）；合并 draw 的上限不变（3–4 个材质）。

### 2.2 带上物品（`three/industrial-activity.ts` + 常量）

- 物品边长 `.24` cell（`BELT_CARGO_CELL`），每格最多画 `.24` 间距下不叠的个数：**4 个**
  （`BELT_CARGO_MAX_PER_STACK = 4`）。
- 位置：沿 `path.point(u)`；`u` 由全局时钟推进，同一网络共享相位（现状的 `this.time*.55` 保留，
  速度改用 `beltItemSpeedTilesPerSec(throughput)` 口径，和 2D/贴图滚动同一份）；
  **朝向随流向**：用 `path.point(u±ε)` 的切向构造四元数（局部 +X 或 +Z 对齐切向即可，取带子较长轴）。
- **高度**：物品中心 = 带面顶（.105）+ 半边长，不能陷进带面（现状 `normal * size * .1` 偏低）。
- **堵塞（`source.active` 为 false 或带子 dead-end）**：物品不前进，并**向输出端堆叠**
  （`u = 1 - (k+.5)/spread`），不再平均铺在格中。
- 颜色：沿用 `itemColor()` 的 sRGB 解释口径，不改。
- 物品在弯道上的切向与 `path.side()` 一致，不能出现「弯道上物品仍然正南正北」的方盒。

### 2.3 传送带验收（逻辑测试）

- `three/conveyor-geometry.test.ts`：剖面高度/半宽常量、端口对齐（相邻两格端点重合）、
  转弯无端盖、`tileIndex` 拾取仍可用、`refresh` 签名不变时不重建。
- `three/industrial-activity.test.ts`：堵塞时物品堆在队首（u 单调）、流动时 u 随时钟推进、
  物品中心高度 = deckTop + 半边长、弯道物品朝向跟随切向。

## 3. 建造 ghost（3D）与 2D 战术图

### 3.1 3D ghost（`planet-three-scene.ts` 的 `updateBuildGhost` 一带）

- 分拣器：**显示半透明的分拣器本体**（`IndustrialModels.building(type, .86, .86, true)` 的克隆，
  材质改 `transparent: true, opacity: .42, color: 绿色 #7df7b0`，`depthWrite:false`），
  位置/朝向与放置后一致（含 rotation），抬到地面之上 .02 格。
- 地面方向指示：一条**从取货端到放货端的细箭头**（贯穿前后各半格，宽 ≤ .12 格，箭头三角头），
  绿色（#7df7b0），不做「虚线 vs 实心」两支大箭头，也不挂「取/放」文字徽章
  （文字说明在看板底部已有：`PlanetBuildBar` 的提示行不动）。
- 传送带 ghost 保留现有贴地箭头（`ghostArrow`），缩小到 .5 倍、去掉粗 chevron 纹理
  （细箭头 + 箭头头即可），拖拽铺带时仍逐格画。
- ghost 每次 hover 重建（现状每帧重建），不要缓存过期网格。

### 3.2 2D 战术图（`planet-building-sprites.ts` + `planet-scene.ts`）

- 新增 `sorter` 原型（`resolveBuildingArchetype` 里把 `sorter_*` / `pile_sorter` 映射到 `'sorter'`，
  不再用 `'belt'`）：深色圆盘底座 + 从中心指向**放货方向**的铜色横臂 + 末端夹爪，
  烘焙 4 向变体（缓存键追加方向，现有 belt 的方向机制复用）；mk2/mk3 用不同点缀色。
- 传送带 `drawBelt`：改为「深色带面 + 两侧浅色护栏 + 弱方向纹」，把现有的粗黄 chevron 压到很弱
  （平铺流动箭头 `createLogisticsFlowSprite` 仍是主流向提示，保留）。
- 2D 分拣器「取→放」有向线保留（`syncSorterRoute`）：线宽再细一点、箭头改成小爪形可选；
  取/放标签字号维持 1017 K4b 口径（`sorterGhostLabelPlacement` 的测试不许放宽）。
- 2D 带上物品圆点（`syncBeltItemFlow`）：间距随 buffer 数量收紧，堵塞时堆在输出端。

## 4. 不做的事

- 不改服务端分拣器/传送带逻辑（朝向、range、cycle_ticks、过滤器、堵塞告警）。
- 不加新的建筑类型、不改存档格式。
- 不重做建筑其它模型（熔炉/制造台等）。

## 5. 验证方式（每个代理都要跑）

1. 起环境：`GO_BIN_DIR=/home/firesuiry/sdk/go1.25.0/bin bash scripts/playtest-up.sh <N> --tick-rate 4`
   （N 每个代理独占：分拣器 218 / 传送带 219 / 2D+ghost 220）。
2. 造演示产线：`python3 /tmp/setup-belt-line.py --port <N*100>`（矿机→带→分拣器→熔炉→分拣器→带；
   幂等，可重复跑）。脚本会推进 tick 到产线真正流动。
3. **驱动里必须先 `await page.emulateMedia({ reducedMotion: 'no-preference' })`**，否则
   `prefers-reduced-motion: reduce` 会让 3D 冻结，截图上完全看不出动画。
4. 截图用 `L.focus(page, tile)` + `3D 放大` 按钮，近景一张、中景一张、带 move 的两帧动图对比；
   2D 用「平面战术」按钮。截图放 `tmp/playtest-1018-<主题>/shots/`。
5. `cd client-web && npx vitest run <相关测试文件>`；改了 ghost/2D 的跑
   `npx vitest run src/features/planet-map`；`npx tsc --noEmit` 或 `npm run build`。

## 6. 分工（互不重叠的写域）

| 代理 | 写域 |
| --- | --- |
| A 分拣器 | `three/industrial-models.ts`（只 `sorter()` 与 palette 若需要）、`three/sorter-animation.ts`(+test) |
| B 传送带 | `three/conveyor-geometry.ts`(+test)、`three/logistics-marks.ts`（带面贴图）、`three/industrial-activity.ts`(+test) |
| C 2D+ghost | `planet-three-scene.ts`（只 `updateBuildGhost`/`ghostArrow` 一带 + ghost 相关新文件）、`three/ghost-arrow*.ts`、`planet-building-sprites.ts`(+test)、`planet-scene.ts`（2D belt/sorter 视觉 + 2D ghost） |

冲突纪律：A/B 不要碰 `planet-three-scene.ts`；C 不要碰 A/B 的文件；谁需要对方的导出常量，
先在任务里发消息约定（如带面高度 `BELT_DECK_TOP` 由 B 导出）。
