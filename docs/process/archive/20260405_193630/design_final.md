# T103 最终实现方案：戴森科技树不可达建筑与空科技节点

> 基于 `docs/process/design_claude.md` 与 `docs/process/design_codex.md` 的综合定稿。
>
> 本文不并列复述两份方案，而是结合 2026-04-05 当前代码实现做最终裁决，形成一份可直接落地的实现方案。

## 1. 最终结论

本次采用“**建筑分拆处理 + 科技图收口 + `/catalog` authoritative 化**”的综合方案。

最终裁决如下：

1. `satellite_substation` 直接接回真实科技树，归属 `satellite_power`。
2. `automatic_piler` 当前版本**不接回科技树**，而是从公开可建能力中下架；等 runtime 行为补齐后，再单独 reopen。
3. `/catalog.buildings[].unlock_tech` 改成 authoritative 反向派生字段，不能继续长期为空。
4. 空科技节点**不做“一刀切隐藏”**，而是基于前置图做“死胡同裁剪”。
5. `/catalog.techs[]` 增加 `leads_to`，保留有后继价值的桥接科技，只移除真正死胡同科技。

这意味着：

- 采纳 `design_claude.md` 对 `satellite_substation`、`unlock_tech` 反查的处理方向。
- 采纳 `design_codex.md` 对 `automatic_piler` 和“桥接科技 vs 死胡同科技”的区分。
- 不采纳“把 `automatic_piler` 直接挂到 `integrated_logistics`”。
- 不采纳“所有空科技统一隐藏”。

## 2. 裁决依据

### 2.1 `satellite_substation` 已经是 runtime-backed 建筑，只缺科技入口

当前代码事实：

- `server/internal/model/building_runtime.go` 已有 `BuildingTypeSatelliteSubstation` 独立 runtime 定义；
- `server/internal/model/power_grid.go` 已把它纳入无线供电范围计算；
- `server/internal/model/building_defs.go` 中它本来就是 `Buildable: true`。

所以它的问题是“科技树断线”，不是“建筑玩法没做完”。这部分应采用方案 A：接回科技树。

### 2.2 `automatic_piler` 现在不是“只差科技入口”，而是玩法未闭合

当前代码事实：

- `server/internal/model/building_defs.go` 里 `automatic_piler` 仅有建筑定义，且当前 `Buildable: true`；
- `server/internal/model/building_runtime.go` 里没有 `automatic_piler` 的专门 runtime 模块；
- `server/internal/model/sorter.go` 的 `IsSorterBuilding(...)` 不包含 `automatic_piler`；
- `server/internal/gamecore/*` 中没有 `automatic_piler` 的专属结算或行为引用。

所以如果只是把它挂到 `integrated_logistics`，得到的不是“真实可玩入口”，而是“研究后能摆、但没有闭合玩法的空心建筑”。这不符合项目“直接收口真相”的准则。

最终选择：当前版本先下架，不继续公开。

### 2.3 当前 19 个空科技不是同一种问题

`normalizeTechUnlocks(...)` 会在初始化时过滤不存在的 recipe / building / unit unlock，因此这些科技在归一化后出现了空 `Unlocks`。

但按当前科技图，它们分成两类：

#### 需要保留可见的桥接科技

- `engine`
- `steel_smelting`
- `combustible_unit`
- `crystal_smelting`
- `polymer_chemical`
- `high_strength_glass`
- `particle_control`
- `thruster`

这些科技虽然当前没有直接 `unlock/effect`，但仍然是公开后继科技的前置，研究它们会把玩家引向真实可玩的下一段科技线。

#### 需要隐藏的死胡同科技

- `casimir_crystal`
- `crystal_explosive`
- `crystal_shell`
- `proliferator_mk2`
- `proliferator_mk3`
- `reformed_refinement`
- `super_magnetic`
- `supersonic_missile`
- `titanium_ammo`
- `wave_interference`
- `xray_cracking`

这 11 个节点在当前公开树里既没有直接收益，也不会导向公开的真实收益，继续暴露只会制造“研究后什么都没发生”的假入口。

因此不能采用“只要 `unlocks/effects` 为空就隐藏”的简单规则。

### 2.4 `/catalog` 现在还没有 authoritative 反向信息

当前代码事实：

- `server/internal/query/catalog.go` 已经暴露 `buildings[].unlock_tech`；
- `server/internal/model/building_catalog.go` 里没有任何从科技树反向回填该字段的逻辑；
- 结果是 `unlock_tech` 基本长期为空，只能靠 `techs[].unlocks` 人工反查。

这与 `/catalog` 作为玩家公开元数据总表的定位不匹配。本次需要直接收口。

## 3. 最终语义定义

### 3.1 玩家公开建筑的标准

一个建筑要对玩家公开为“当前可建”，至少要满足：

1. `Buildable = true`
2. 有真实 runtime 支撑，而不是只有名字和基础定义
3. 有真实可达的科技入口，或属于默认初始已完成科技

按这个标准：

- `satellite_substation` 满足 1 和 2，只差 3，所以补科技入口；
- `automatic_piler` 目前不满足 2，因此不能继续公开。

### 3.2 玩家公开科技的标准

一个科技节点对玩家可见，至少要满足以下之一：

1. 有真实 `unlock`
2. 有真实 `effect`
3. 是可重复升级科技
4. 虽然没有直接收益，但有公开的 `leads_to`，且最终能通向公开收益

否则它就是公开死胡同，应当隐藏。

### 3.3 `/catalog` 的职责

`/catalog` 是玩家公开元数据接口，不是内部调试快照。它应直接表达玩家真实可见、真实可达的能力边界。

因此本次确定：

- `buildings[].unlock_tech` 必须 authoritative；
- `techs[]` 必须能表达桥接科技的后继方向；
- 真正 `hidden` 的死胡同科技不应再作为玩家公开目录的一部分暴露。

## 4. 模型与查询层设计

### 4.1 `server/internal/model/tech.go`

本文件需要做四类改动。

#### 1. 补齐 `satellite_substation` 的真实科技入口

在 `satellite_power.Unlocks` 中追加：

```go
{Type: TechUnlockBuilding, ID: string(BuildingTypeSatelliteSubstation)}
```

#### 2. 增加科技图派生阶段

现有 `normalizeTechDefinitions(...)` 只做 unlock 归一化。本次改成两阶段派生：

1. 归一化 `Unlocks`
2. 基于 `Prerequisites` 构建反向图
3. 迭代裁剪死胡同科技
4. 回填每个公开科技的 `LeadsTo`

推荐直接给 `TechDefinition` 增加派生字段：

```go
LeadsTo []string `json:"leads_to,omitempty" yaml:"leads_to,omitempty"`
```

这样 `model`、`query`、测试、未来 CLI/前端都消费同一份派生结果，不再各自临时建图。

#### 3. 死胡同裁剪规则

迭代标记 `Hidden=true` 的条件为：

- 当前不是显式隐藏 tech 以外的额外例外；
- `MaxLevel == 0`
- `len(Unlocks) == 0`
- `len(Effects) == 0`
- 所有公开后继都已被隐藏，或根本没有公开后继

这里必须做**迭代裁剪**，不能只看一层子节点。

典型例子：

- `reformed_refinement` 先被判定为死胡同；
- `xray_cracking` 的唯一公开后继就是 `reformed_refinement`；
- 所以 `xray_cracking` 也应在下一轮被隐藏。

#### 4. `LeadsTo` 只保留公开后继

桥接科技的 `LeadsTo` 应只包含最终仍公开的后继科技，不包含已经被裁掉的死胡同节点。

例如：

- `particle_control.leads_to` 最终应保留 `information_matrix`，不保留 `casimir_crystal`
- `high_strength_glass.leads_to` 最终应保留 `high_energy_laser`，不保留 `crystal_explosive`

### 4.2 `server/internal/model/building_defs.go`

把 `automatic_piler.Buildable` 调整为 `false`。

这是本次对外能力边界的直接收口，不再继续制造“可以 build，但实际上没有闭合玩法”的假入口。

### 4.3 `server/internal/model/building_catalog.go` 与 `server/internal/model/catalog_derivation.go`

实际实现中把 catalog 派生逻辑集中放到了 `catalog_derivation.go`，并由 `building_catalog.go` 的对外 getter 触发。

`UnlockTech` 的 authoritative 回填逻辑是：

1. 遍历所有**公开 tech**（`Hidden=false`）
2. 找出其中的 `TechUnlockBuilding`
3. 把 tech ID 反向写回对应 `BuildingDefinition.UnlockTech`

这一步不能依赖脆弱的 `init()` 文件顺序。当前实现采用：

- 增加一个统一的派生 `sync.Once`
- 在对外 getter 首次读取 catalog 前完成：
  - tech 图派生
  - building `unlock_tech` 回填

这样避免了包内初始化顺序带来的隐式耦合，也让 `TechDefinitionByID` / `AllTechDefinitions` / `BuildingDefinitionByID` / `AllBuildingDefinitions` 看到的是同一份派生结果。

### 4.4 `server/internal/query/catalog.go`

需要同步做两项改动：

1. `TechCatalogEntry` 新增 `LeadsTo []string`
2. `/catalog.techs[]` 只输出公开科技，不再把 `Hidden=true` 的内部死胡同继续返回给玩家

最终 `GET /catalog` 的 tech 语义应是：

- 玩家拿到的就是“当前公开科技目录”
- 桥接科技通过 `leads_to` 表达后继价值
- 死胡同科技不再污染玩家视图

## 5. 文档层同步

本次实现已经同步以下文档：

- `docs/player/玩法指南.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- `docs/player/已知问题与回归.md`

同步要求如下。

### 5.1 `docs/player/玩法指南.md`

- 移除 `automatic_piler` 的“当前可建”表述
- `satellite_substation` 明确标成 `satellite_power` 解锁
- 科技树说明补充：存在“桥接科技”，其价值通过 `leads_to` 体现

### 5.2 `docs/dev/客户端CLI.md`

- `build` 示例和建筑列表移除 `automatic_piler`
- 明确 `satellite_substation` 需要 `satellite_power`
- 不再暗示所有 catalog 建筑都已形成完整玩法闭环

### 5.3 `docs/dev/服务端API.md`

- `/catalog.buildings[].unlock_tech` 改为 authoritative 反查入口
- `/catalog.techs[]` 新增 `leads_to`
- 明确 `/catalog.techs[]` 只返回公开科技，不再输出隐藏死胡同节点
- 说明 `automatic_piler` 当前未公开

### 5.4 `docs/player/已知问题与回归.md`

- 把 T103 从“当前缺口”更新为“已收口”
- 明确保留后续 reopen 项：`automatic_piler` runtime 行为补齐

## 6. 测试设计与实际落点

### 6.1 建筑可达性回归

新增或扩展测试，覆盖：

1. `satellite_substation`
   - 默认新局玩家不能建
   - 完成 `satellite_power` 后可以建
2. `automatic_piler`
   - `/catalog.buildings` 不再显示 `buildable=true`
   - `build automatic_piler` 被 authoritative 拒绝为 `building type not buildable`

### 6.2 catalog 一致性回归

新增断言：

1. 所有 `buildable=true` 的公开建筑，都必须满足：
   - 属于初始完成科技，或
   - `unlock_tech` 非空
2. `satellite_substation.unlock_tech == ["satellite_power"]`
3. `automatic_piler.buildable == false`

### 6.3 科技树回归

新增断言：

1. 桥接科技仍公开，且 `leads_to` 非空
2. 11 个死胡同科技不再出现在 `/catalog.techs[]`
3. `/catalog.techs[]` 中不再存在同时满足下面条件的条目：
   - `max_level == 0`
   - `len(unlocks) == 0`
   - `len(effects) == 0`
   - `len(leads_to) == 0`

### 6.4 实际测试落点

- `server/internal/model/t103_catalog_derivation_test.go`
- `server/internal/gateway/t103_catalog_api_test.go`
- `server/internal/gamecore/t103_build_access_test.go`

## 7. 对任务原始验收口径的修正

任务原文把两个建筑绑定成同一条验收：

- 未解锁前失败
- 解锁后成功

这对 `satellite_substation` 成立，但对当前 `automatic_piler` 不成立，因为它现在还没有闭合 runtime 玩法。

如果继续强行要求两个建筑都走同一口径，只会逼实现做出一种表面正确、实际失真的方案：把 `automatic_piler` 塞回科技树，但继续公开一个空心建筑。

因此本次最终验收应拆成两条：

1. `satellite_substation`
   - 未解锁前不能建
   - 完成 `satellite_power` 后能建
2. `automatic_piler`
   - 当前版本不再公开
   - 等 runtime 补齐后，再开独立 reopen 任务

这才与当前代码现实、项目准则和玩家体验一致。

## 8. 不在本次范围内

以下问题在本次分析中已确认存在，但不属于 T103 直接收口范围：

1. `automatic_piler` 的真实 runtime 设计与结算补齐
2. `miniature_collider` 与 `strange_matter` 的循环前置
3. `universe_matrix` 前置里引用未定义 `dyson_sphere_partial`
4. 大量未实现 recipe 导致的更深层科技树断档

这些问题应在后续单独立项，不与本次“玩家公开能力收口”混做一批。

## 9. 实际落地文件

1. `server/internal/model/tech.go`
   - 给 `TechDefinition` 增加 `LeadsTo`
   - 补 `satellite_power -> satellite_substation`
2. `server/internal/model/catalog_derivation.go`
   - 做 tech 图派生、死胡同裁剪与 `leads_to` 回填
3. `server/internal/model/building_catalog.go`
   - 在对外 getter 前触发派生，并支持 `unlock_tech` authoritative 回填
4. `server/internal/model/building_defs.go`
   - 下架 `automatic_piler`
5. `server/internal/query/catalog.go`
   - 输出 `leads_to`
   - 过滤 hidden tech
6. `server/internal/model/t103_catalog_derivation_test.go`
   - 锁住 bridge tech / dead-end tech / `unlock_tech` / `automatic_piler` 边界
7. `server/internal/gateway/t103_catalog_api_test.go`
   - 锁住 `/catalog` 对外口径
8. `server/internal/gamecore/t103_build_access_test.go`
   - 锁住 authoritative 建造边界
9. `docs/player/玩法指南.md`、`docs/dev/客户端CLI.md`、`docs/dev/服务端API.md`、`docs/player/已知问题与回归.md`
   - 同步玩家与接口文档口径

最终落地结果应是：

- 玩家不会再看到“能摆但永远解锁不到”的建筑
- 玩家不会再看到“研究了什么也不会发生”的公开死胡同科技
- `/catalog`、文档、CLI 和 authoritative 规则重新收口到同一套真相
