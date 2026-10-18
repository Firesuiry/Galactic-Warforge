# 传送带与分拣器 DSP 对齐（第 19 轮契约）

来源：用户 2026-10-18 第 18 轮之后的两条反馈——

1. 「现在的 3D 视图 传送带 夹爪是否符合 DSP 的样子，包括功能逻辑？如不符合请重构，画面这部分你自己来，审美好一点」
2. 「大方块没问题，主要是逻辑要一致；还有**多层传送带**之类的设计要一致；分拣器要和 DSP 样式一致，**那种门控样式的**；
   还有传送带**会合样式现在是断开的**」

第 18 轮（[传送带与分拣器DSP化](传送带与分拣器DSP化.md)）只改了外观，而且方向错了：分拣器做成 Factorio 式
「圆底座 + 水平转 180° 的机械臂」，臂端既够不到带子也够不到机器；带子做成「高白护栏 + 白色横条」，
DSP 标志性的分档彩色流向箭头反而被压掉了。本轮按 DSP 的**逻辑**和**样式**一起对齐。

## 0. 差异清单（DSP ↔ 现状 → 本轮处理）

| # | 项 | DSP | 现状 | 本轮 |
| --- | --- | --- | --- | --- |
| L1 | 分拣器长度 | 所有档位都能跨 1–3 格 | mk1 1 / mk2 2 / mk3 3 | **所有档位 range = 3**（§1） |
| L2 | 分拣器速度与长度 | 速度 ∝ 1/长度，「带—空格—机器」算长度 1 | 周期 = cycle × (取端步数 + 放端步数)，最短布局算 2 | 周期 = cycle × **(取端步数 + 放端步数 − 1)**（§1） |
| L3 | 分拣器耗电 | 耗电（Mk.I 18kW 起） | 不耗电，永远 running | **加耗电**，没电停机（§1） |
| L4 | 传送带分档速度 | 6 / 12 / 30 件/秒 = **1 : 2 : 5** | throughput 2/4/6、stack_limit 2/2/3（实测比例待测） | 实测稳态吞吐，调到 1 : 2 : 5（§2） |
| L5 | 多层传送带 | 带子可抬高、坡道升降、立体交叉互不相干 | 只有地面一层 | **新增高架层 elevation 0–4**（§3） |
| L6 | 传送带耗电 | 不耗电 | 不耗电 | 不变 |
| V1 | 分拣器样式 | **门控（道闸）式**：中间立一个闸座，摆臂在**竖直面内**从取货端翻过头顶落到放货端 | 圆底座 + 水平横臂（Factorio 式） | 重做（§4.1） |
| V2 | 分拣器跨度 | 机体从取货端一直伸到放货端，越长臂越长 | 臂长只按 range 拉，够不到端点 | 按**真实端点**画（§4.1） |
| V3 | 传送带样式 | 低矮金属带体，带面滚动**分档彩色箭头**（Mk.I 黄 / Mk.II 绿 / Mk.III 蓝），越高档滚得越快 | 高白护栏 + 白横条，箭头被压到不可见 | 重做（§4.2） |
| V4 | 侧面汇入 | 支带直接接进主带侧面，主带侧栏开口 | 主带侧栏是一整面墙，支带怼在墙上，看起来**断开** | 修（§4.2） |
| V5 | 高架带 | 抬高的带子有支撑柱，坡道平滑 | 无 | 新增（§4.3） |

不做：分流器/集装机/流速监测器的高架与叠放（DSP 允许叠放分流器，本轮不做）、拖拽式分拣器放置（本游戏
用「朝向 + 自动找端点」，ghost 会把实际接上的端点画出来，§4.4）、带上物品换成真实物品模型（用户：大方块没问题）。

## 1. 分拣器逻辑（服务端 S1）

- `data/buildings.yaml`：`sorter_mk1/mk2/mk3/pile_sorter` 的 `range` **全部改成 3**；`cycle_ticks` 保持 6 / 3 / 2 / 2。
- `sorter_settlement.go`：往返周期 = `cycle_ticks × max(1, in.steps + out.steps − 1)`。
  `in.steps/out.steps` 是从分拣器本格沿轴走到端点格的步数，最短布局「带 | 分拣器 | 机器」两端各 1 步 → 长度 1。
  选路（`sorterBestRoute`）仍取跨度最小的组合，停工告警共用同一函数，不变。
- 耗电：四种分拣器加 `params.energy_consume` + `functions.energy.consume_per_tick` + power connection point，
  数值 mk1 1 / mk2 1 / mk3 2 / pile 2（DSP 比例 18:36:72:… 折成整数）。没电时 `runtime.state != running`，
  `settleSorters` 已经会跳过。
- 客户端 `sorterEndpointStatuses`（`sorter-filter.ts`）读服务端 `sorter.range`，不用改；但它的文案/测试里
  写死的「mk1 只能 1 格」类描述要跟着改。
- 验收（Go 测试）：mk1 跨 3 格能取放；mk1 最短布局周期 = 6 tick、跨 2+1 步周期 = 12 tick；
  断电分拣器不搬；`TestSkirmishFullMatchRegression`/`TestSkirmishBotTechChainStarts` 由主代理合并前统一跑。

## 2. 传送带分档速度（服务端 S1）

- 先写一个测试实测稳态吞吐：30 格直带，源头一直塞满、尾端无限吸收，跑 600 tick 取后 300 tick 的
  件/tick，mk1/mk2/mk3 各一条（混合物品带子也要测一条，确认不降速）。把**改前**的原始数字写进报告。
- 目标：mk1 保持改前数值不变，mk2 ≈ 2×、mk3 ≈ 5×（±10%）。优先只改 `buildings.yaml` 的
  `throughput / stack_limit`；如果「每 tick 最多走 1 格 + 容量按 tick 初值算」的模型让 5× 达不到，
  允许最小改动 `settleConveyors`，但不能破坏现有分流器/集装机/混带测试。
- 测试固定成回归用例（比例断言），之后谁改带子都会被它拦住。

## 3. 多层传送带（服务端 S2 + 网页 C + 2D D + 3D 主代理）

### 3.1 数据模型

- `ConveyorState.Elevation int json:"elevation,omitempty"`，取值 `0..MaxBeltElevation(=4)`，0 = 地面。
  **只有 `conveyor_belt_mk1/mk2/mk3` 可以 >0**；分流器/集装机/流速监测器/建筑 IO 只在地面层。
- 占格：地面层（0）照旧写 `TileBuilding`。高架层（≥1）**不写** `TileBuilding`，另建索引
  `WorldState.BeltLayers map[string]string`（键 `x:y@e`，`json:"-"`，读档/建档/拆除时和 `TileBuilding`
  在同一处重建维护）。好处：地面单位从高架下面走过、寻路不受影响；分拣器扫端点/建筑直连 IO 只看
  `TileBuilding`，天然只接地面带（DSP 口径：分拣器只接地面层）。
- 「低矮物流」`LowLogistics` = `conveyor_belt_*`、`splitter`、`automatic_piler`、`traffic_monitor`、`sorter_*`、`pile_sorter`。

### 3.2 放置规则（`build` 命令 payload 新增 `elevation`）

- `elevation` 缺省 0；非传送带给 >0 → 拒绝 `INVALID_ELEVATION`「只有传送带可以架高」；越界同码「高度只能 0–4 层」。
- 高架带 `(x,y,e≥1)`：该层该格不能已有带子/施工任务；**地面占用**只能是空地或 `LowLogistics`（含施工中），
  否则 `POSITION_OCCUPIED`「高架传送带不能架在建筑上方」。地形/建造半径规则与地面带相同。
- 反过来：在有高架带的格子上造**非** `LowLogistics` 建筑（任一占地格）→ `POSITION_OCCUPIED`「上方有高架传送带」。
- 拆除/摧毁按 building id，照常退料；高架带被摧毁不影响地面层。

### 3.3 连接规则（服务端、3D、2D 三处必须同一算法）

带 A（高度 `a`，输出方向 `d`）的下游：沿 `SurfaceStep(A.pos, d)` 到邻格 `N`（跨面后方向为 `d'`）：

1. **同层**：`N` 上高度 `a` 的运输建筑（`a = 0` 时就是现有逻辑：带/分流器/集装机/监测器/建筑 IO）
   若接受来自 `opposite(d')` 侧的输入 → 连。
2. **坡道**（只在同层没连上时）：依次看 `N` 上高度 `a−1`、`a+1`（≥0）的**纯传送带** B，
   要求 `B.output == d'`（**直行延续**，坡道上不许转弯、不许侧汇）且 B 接受来自 `opposite(d')` 的输入 → 连。
3. 都没有 → 无下游（死头）。

- 上游/汇入（`conveyorIncomingDirs`、auto 输出）全部由上面的「下游链接」反推，不再单独按 `TileBuilding` 扫。
  高架带不允许 `auto` 输出（建造时必须给 `direction`，缺省按 rotation 推）。
- 典型用法「立体交叉」：竖线在交叉格前一格抬到 1 层、交叉格 1 层、后一格落回 0 层；地面横线穿过交叉格，
  两条线的货互不串（同层优先 + 坡道只认直行延续）。

### 3.4 对外接口

- 查询：建筑 JSON 的 `conveyor.elevation`（omitempty）。所有「按格给建筑」的查询/场景字段不能让高架带
  覆盖地面占用（S2 审一遍 `query` 包里用 `TileBuilding` 的地方）。
- CLI：`build <type> <x> <y> ... --elevation N`；更新 `docs/dev/服务端API.md` / `客户端CLI.md`，
  跑 `python3 scripts/gen_command_docs.py` 与 `command_coverage.py --check`。
- shared-client（本契约提交里已加好）：`BuildingConveyorState.elevation?: number`、`BuildOptions.elevation?: number`。

### 3.5 网页建造交互（C）

- 建造传送带时有「目标高度」`interactionMode.elevation`（0–4，默认 0）：`PageUp` 升一层、`PageDown` 降一层
  （先确认快捷键没被占用；被占就换并在文档写明），建造栏传送带格旁显示「高度 N」+ ▲▼ 按钮。切换建筑类型时归零。
- 拖拽铺带逐格下单（现状），每格的 `elevation` 这样定（**与服务端坡道规则一致**）：
  - 第一格：若相邻有一条现成的带子正对着它输出，取那条带子的高度，否则取目标高度；
  - 之后每格：若与上一格**同方向**（直行），高度向目标高度走 1 步（每格最多 ±1）；转弯格保持上一格高度。
  - 拖拽中途按 `PageUp/PageDown` 改目标高度，后面的格子自动起坡/落坡（DSP 拖带时调高度的手感）。
- 预览：`scene.setBeltDragPath(path: { tile, direction, elevation }[])`（3D 主代理消费）；单格悬停时 ghost 用
  `interactionMode.elevation`。本地预检 `assessBuildTiles` 按 §3.2 判可放（高架格允许压在地面带/分拣器上）。
- 选中：3D 场景 `onPick(tile, { offscreen, buildingId? })`——命中高架带时带 `buildingId`，消费端
  （`use-planet-interactions`）有 `buildingId` 就直接选它，没有再按格找地面建筑。详情面板对传送带显示「高度 N 层」。

### 3.6 视觉常量（3D/2D 共用，见 `client-web/src/features/planet-map/logistics-tier.ts`）

- 层高 `BELT_LEVEL_HEIGHT = .5` 格（3D）；坡道在两格之间按高度均值连成一条直坡。
- 档位色：带 Mk.I `#f5b942` 琥珀黄 / Mk.II `#46d483` 绿 / Mk.III `#3ea6ff` 蓝；
  分拣器 Mk.I/II/III 同色，集装分拣器 `#b48cff` 紫。

## 4. 画面（3D 由主代理亲自做；2D 由 D 按同一造型做）

### 4.1 分拣器：门控（道闸）式

- 局部系：原点 = 分拣器格心地面，`+X` = 放货端（正面），`−X` = 取货端（背面），`+Y` 法线。
- **底板**：一条低矮细长的石墨底板，沿 X 铺满「取端格与放端格之间」的所有格（最短布局就是本格），两侧有档位色细灯条。
- **闸座**：本格中心立两片陶瓷白侧板（叉形支架），中间一根横向轴（沿 Z），轴毂合金色、档位色光环。
- **摆臂**：双平行臂杆从轴毂伸出，前段可伸缩（臂长 = 轴心到端点的距离），臂端挂夹爪，夹爪**始终朝下**（随摆臂反向自转，
  像摩天轮吊舱），物品方块挂在夹爪下。
- **动作**：摆角 φ 从取货端（φ≈π，夹爪落在带子中心线/机器外壁）→ 竖直翻过头顶 → 放货端（φ≈0）；
  四段节拍沿用第 18 轮（取货下探 → 携货翻转 → 放货下探 → 空载翻回），周期 = 服务端往返周期。
  空闲时停在取货端、夹爪悬在带面上方；停机冻结。
- **端点**：取/放点由 `sorterEndpointStatuses` 求出的真实端点格决定——带子 = 带子中心线，建筑 = 建筑外壁内侧一点；
  没接上的一端按 1 格画并显示为暗色。
- 2D（D）：俯视剪影 = 细长底板（取端→放端）+ 中心闸座方块 + 指向取货端的摆臂短杆 + 放货端小三角，档位色灯条。

### 4.2 传送带

- 剖面压矮：带体高 ≈ .11 格、侧栏只比带面高 .03–.04，侧栏中灰金属（不再是白陶瓷），远景读成一条低矮的金属带。
- 带面：深色底 + **分档色 chevron 箭头**（每格 2 个），沿流向滚动，Mk.I/II/III 滚速比 1 : 2 : 5。带子不耗电，
  所以箭头一直在滚（DSP 口径：堵住时货停、带面照转）。
- 侧面汇入：主带在汇入侧的侧栏开口（宽 = 支带宽），支带的带面直伸到主带带面边缘、侧栏接到开口两端，
  看起来是一体的 T 形接头；直行带、转弯带、带端口接建筑都不能出现「墙」或缝。

### 4.3 高架带

- 带体抬到 `elevation × BELT_LEVEL_HEIGHT`；坡道平滑；地面没有被占的格子每格（或每 2 格）一根细支撑柱 + 小底座，
  被地面带/分拣器占着的格子不立柱。高架带下方投影可见（真阴影即可）。
- 带上物品沿坡道走（`path.point(u)` 已含高度）。

### 4.4 建造 ghost

- 分拣器：半透明门控机体，**伸到这一格放下去会实际接上的端点**（按当前 rotation 扫 range 格），两端都接上 = 绿，
  缺一端 = 那一端红色 + 机体黄色。旧的「绿色细箭头」保留为底板上的流向纹。
- 传送带：ghost 带体画在目标高度，拖拽路径按每格 `elevation` 画坡道与支柱。

## 5. 测试与存档点

- 逻辑测试：S2 在 `docs/guide/checkpoints/` 新增一层 `cp-belt-dsp`（父 `cp-base`）：只用玩家命令 + 快进，
  造一个立体交叉（地面横线穿过，竖线 0→1→1→0 跨过去）、一个侧面汇入、一台跨 2+1 步的 mk1 分拣器；契约：
  两条线终点各自只收到自己的物品（`building_item_gte`）、分拣器 running 且搬过货。3D/2D 操作测试从这层读档。
- S1 的改动让 `cp-mining` 及下游的存档点失效：主代理合并 S1/S2 后统一 `checkpointbuild -from cp-mining` 重建。
- 子代理只跑定向测试 + `go test ./internal/gamecore/ -short`（服务端）/ 相关 vitest + `tsc --noEmit`（网页）；
  长回归由主代理合并前跑一次。

## 6. 分工、写域与端口

| 代理 | 分支/worktree | 写域 | 端口 N |
| --- | --- | --- | --- |
| S1 分拣器/带速逻辑 | `r19-sorter-logic` | `server/data/buildings.yaml`（只分拣器与传送带条目）、`sorter_settlement.go`、`conveyor_settlement.go`（只为 §2）、相关测试、客户端 `sorter-filter.ts` 文案 | 231 |
| S2 多层带服务端 | `r19-elevation-server` | `server/internal/model`、`gamecore` 的建造/占格/带连接、`query`、`persistence`、`client-cli`、`docs/dev`、`docs/guide/checkpoints/cp-belt-dsp.json` | 232 |
| C 网页建造交互 | `r19-elevation-web` | `PlanetBuildBar`、`store.ts`、`PlanetMapThree.tsx`、`belt-stroke.ts`、`build-workflow.ts`/预检、`use-planet-interactions.ts`、详情面板 | 233 |
| D 2D 战术图 | `r19-2d` | `planet-scene.ts`、`planet-building-sprites.ts`、`PlanetMapPixi.tsx` 的拾取 | 234 |
| 主代理 3D | `r19-visual` | `planet-three-scene.ts`、`three/*`（分拣器/传送带/ghost/物品） | 230 |

冲突纪律：`conveyor_settlement.go` S1 只动吞吐相关、S2 动连接相关，各自小步提交，合并由主代理处理；
`sorter_settlement.go` 只归 S1。共享常量只从 `logistics-tier.ts` 读，谁要加新常量先在报告里写明。
