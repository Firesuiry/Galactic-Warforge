# T101 最终实现方案：终局舰队线边界收口与太阳帆 authoritative runtime 修复

## 0. 输入与目标

本文综合以下输入形成唯一推荐方案：

1. `docs/process/design_claude.md`
2. `docs/process/design_codex.md`
3. `docs/process/task/T101_戴森深度试玩复测后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md`
4. 当前仓库代码与现有玩家/开发文档口径

目标不是继续并列保留两套意见，而是输出一份可直接进入实现阶段的最终方案，并对两项问题给出唯一裁决：

1. 终局高阶舰队线到底是本轮真正开放，还是继续隐藏但把口径与代码收口。
2. 太阳帆批量发射的重复 `entity_id` 到底做最小补丁，还是直接修正到底层 authoritative runtime。

---

## 1. 最终裁决

### 1.1 终局高阶舰队线

本轮选择：**继续隐藏，并把代码、CLI、API、文档全部收口到同一真实边界。**

即本轮不开放以下终局高阶舰队线：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

原因不是“以后再说”，而是当前缺的不是一个 `hidden=false` 开关，而是一整条玩家可用闭环：

- 公开科技树展示
- 公开生产入口
- 部署 / 编队 / 查询入口
- 可观察的太空单位状态
- 太空战斗结算
- 事件、回放、存档一致性

在这些链路都不存在或不 authoritative 的前提下，直接采用 `design_claude.md` 的“本轮真实开放”方案，范围会从 T101 的边界收口膨胀成一整套太空战系统落地，不适合作为当前任务的实现路径。

### 1.2 太阳帆实体 ID

本轮选择：**不做字符串级补丁，直接改成 snapshot-backed、system-scoped 的空间 authoritative runtime。**

即不采用以下最小修补思路作为最终方案：

- 仅把 ID 从 `sail-<player>-<tick>` 改成另一种拼接字符串
- 仅把 `LaunchSolarSail()` 接到 `WorldState.NextEntityID(...)`
- 继续保留包级全局 `solarSailOrbits`
- 只修 `entity_created`，不修 `entity_destroyed` / save / replay / rollback

最终方案采纳 `design_codex.md` 的主方向：把太阳帆迁入独立空间 runtime，一次性解决：

- 同 tick 批量发射唯一性
- orbit 内成员 ID 一致性
- `entity_created` / `entity_destroyed` 一致性
- save / restore / replay / rollback 一致性
- 按 `player + system` 分桶，而不是继续按 `player` 混算

### 1.3 本轮不纳入范围

本轮明确不做：

- 真正开放终局高阶舰队线
- 把 `produce` 扩成 `produce corvette`
- 在当前任务内完整重做太空舰队部署 / 编队 / 战斗系统
- 顺手重做整套戴森球能量 system-scope 体系

---

## 2. 两份设计稿的综合取舍

### 2.1 采纳 `design_claude.md` 的部分

`design_claude.md` 的价值不在于“本轮就应该开放”，而在于它把“若要真实开放高阶舰队线，至少需要哪些能力”列得足够完整。以下判断应保留：

- 高阶舰队线不是“取消隐藏 + 放开 produce”就算完成。
- 真正开放至少需要补齐：
  - 单位模型与属性
  - 科技门禁
  - 太空单位宿主
  - 舰队查询与操作 API
  - CLI 命令面
  - 战斗结算
  - 玩家可观察结果

因此，`design_claude.md` 适合作为**未来开放高阶舰队线的蓝图来源**，但不适合作为 T101 本轮的实施范围。

另外，Claude 稿里“太阳帆 ID 应统一走 authoritative 分配器”的判断是对的，但它把分配器挂在 `WorldState` 上仍然偏局部，未触及包级全局状态、存档恢复和 system scope 的根问题。

### 2.2 不采纳 `design_claude.md` 作为本轮主方案的原因

不采用其“本轮真实开放终局舰队线”的直接原因如下：

1. 当前公开命令面、查询面、事件面、回放链路都没有太空舰队闭环。
2. 当前 `produce` 的语义仍是“地表建筑相邻格生成单位”，并不适合直接承载 `corvette / destroyer` 这类太空实体。
3. 当前仓库中的玩家文档与开发文档已经基本承认“高阶舰队线未开放”；本轮任务的验收也明确允许二选一，而不是强制开放。
4. 若按 Claude 稿直接推进，会把 T101 从“边界收口 + runtime 修复”扩成“终局舰队系统落地”，风险和影响面都明显过大。

### 2.3 采纳 `design_codex.md` 的部分

`design_codex.md` 应作为本轮最终方案主体，核心采纳点如下：

1. 高阶舰队线继续隐藏，但必须建立 authoritative 的公开单位边界。
2. `/catalog` 应新增 `units[]`，作为玩家可见单位能力的唯一真相来源。
3. CLI、本地帮助文本、shared-client、服务端校验不能再各自维护一套单位 allowlist。
4. 高阶隐藏科技在原始定义层就应直接表达“未开放”，而不是靠 normalize 阶段偷偷裁掉。
5. 太阳帆应迁入 top-level 的 `SpaceRuntimeState`，不能继续挂在包级全局变量上。
6. 太阳帆轨道至少按 `player + system` 分桶。
7. 空间实体 ID 要由空间 runtime 分配，并进入 save / replay / rollback。

### 2.4 对 `design_codex.md` 的补充

Codex 稿已经足够接近最终路径，本次综合只做两点补充：

1. 未来若要真正开放高阶舰队线，应明确沿用 Claude 稿列出的能力闭环，单独立项推进，而不是在本轮文档里只留下“以后再做”。
2. 本轮对 `ray_receiver` 的修正只强制收敛太阳帆这一半到 system scope；戴森球能量是否一并统一，可作为后续技术债单列，不在 T101 内继续扩张。

---

## 3. 当前仓库事实与任务边界

### 3.1 高阶舰队线当前仍未开放

从当前代码与任务文档看，事实非常明确：

- `/catalog.techs` 中 `prototype / precision_drone / corvette / destroyer` 仍为 `hidden=true`
- CLI `help produce` 仍只暴露 `worker / soldier`
- `produce u-2 corvette` 当前会直接失败
- 没有公开的高阶单位生产、部署、编队、查询、战斗闭环

因此，本轮正确目标不是“把它包装成已实现”，而是把“未开放”的边界彻底收口成单一真相来源。

### 3.2 太阳帆问题不是单点 ID bug

当前问题也不只是字符串冲突：

- 太阳帆轨道状态仍由包级全局变量承载
- 轨道当前按 `playerID` 聚合，没有 `systemID`
- 接收站读取太阳帆能量时仍按玩家聚合
- snapshot / save / replay / rollback 没有完整覆盖太阳帆空间态

因此，如果只修 ID 生成表达式，系统仍然是不 authoritative 的，后续仍会在回放、回滚和多星系归属上继续出错。

---

## 4. 最终方案 A：终局高阶舰队线继续隐藏，但收口成单一真相来源

### 4.1 新增 authoritative 公开单位目录

本轮新增服务端 authoritative 的公开单位目录，作为以下能力的唯一来源：

- `/catalog.units`
- `produce` 的单位合法性判断
- CLI `help produce`
- CLI 的本地预校验
- shared-client 的公开单位语义

建议新增 `server/internal/model/unit_catalog.go`，定义类似：

```go
type UnitDomain string

const (
    UnitDomainGround UnitDomain = "ground"
    UnitDomainAir    UnitDomain = "air"
    UnitDomainSpace  UnitDomain = "space"
)

type UnitRuntimeClass string

const (
    UnitRuntimeClassWorld  UnitRuntimeClass = "world_unit"
    UnitRuntimeClassCombat UnitRuntimeClass = "combat_unit"
    UnitRuntimeClassFleet  UnitRuntimeClass = "fleet_unit"
)

type UnitCatalogEntry struct {
    ID           string           `json:"id"`
    Name         string           `json:"name"`
    Domain       UnitDomain       `json:"domain"`
    RuntimeClass UnitRuntimeClass `json:"runtime_class"`
    Public       bool             `json:"public"`
    Producible   bool             `json:"producible"`
    Commands     []string         `json:"commands,omitempty"`
    HiddenReason string           `json:"hidden_reason,omitempty"`
}
```

本轮公开目录只需要 authoritative 地表达当前真实可用单位：

- `worker`
- `soldier`

明确不进入公开目录：

- `executor`
- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`
- `corvette_attack_drone`

### 4.2 `/catalog` 新增 `units[]`

在 `server/internal/query/catalog.go` 的 `CatalogView` 中新增 `Units []UnitCatalogEntry`。

本轮输出目标：

- `/catalog.units` 只包含 `worker`、`soldier`
- 不返回内部执行体
- 不返回隐藏高阶舰队单位

这样客户端和 CLI 不再需要从 `tech.unlocks`、本地 union 类型、help 文案里各自猜测“哪些单位现在能生产”。

### 4.3 直接重构 `produce` 的公开能力边界

`produce` 的 authoritative 规则改为：

- 只接受公开单位目录里 `Public=true`、`Producible=true`、且 `RuntimeClass=world_unit` 的单位
- 不再由多个硬编码位置共同决定当前支持哪些单位

对应改动：

- `server/internal/gamecore/rules.go`
  - `execProduce()` 改为查 authoritative 单位目录，而不是写死 `worker / soldier`
- `shared-client/src/api.ts`
  - `UnitTypeName` 不再承担“公开能力边界”的职责，可改为 `string` 或更窄的运行期派生类型
- `client-cli/src/commands/action.ts`
  - 删除本地 `UNIT_TYPES` 手写 allowlist
- `client-cli/src/commands/util.ts`
  - `help produce` 改为优先基于 `/catalog.units` 渲染
  - 若离线或拿不到 catalog，则退化为 generic 文案，而不是继续写死 `worker/soldier`

这样做的目标是统一错误来源：

- `produce ... corvette` 不再出现“CLI 本地拦一套、服务端再拦另一套”的分裂行为
- 玩家能不能生产某单位，以服务端 authoritative 目录为准

### 4.4 高阶隐藏科技在原始定义层直接表达“未开放”

本轮直接修改 `server/internal/model/tech.go`：

- 保留 `prototype / precision_drone / corvette / destroyer` 的科技本体、前置与成本
- 保留 `hidden=true`
- 从原始 `Unlocks` 中移除这些科技对应的 `TechUnlockUnit`

这样做的收益：

- 原始定义、catalog 输出、CLI 边界、文档口径都在说同一件事
- `normalizeTechUnlocks()` 不再承担“掩盖伪公开解锁”的职责
- 测试可直接断言原始定义本身就表达“未开放”

### 4.5 文档同步原则

本轮文档只跟随真实接口变化同步，不做脱离代码的表述包装。

需要同步的重点：

- `docs/dev/服务端API.md`
  - 新增 `/catalog.units` 字段说明
  - 明确高阶舰队线继续隐藏
- `docs/dev/客户端CLI.md`
  - 说明 `produce` 以服务端公开单位目录为准
  - 不再保留“本地写死 worker/soldier”的表述
- `docs/player/玩法指南.md`
  - 保留“高阶舰队线未开放”的说明
- `docs/player/已知问题与回归.md`
  - 跟随最终接口语义微调

### 4.6 这一部分必须补的测试

至少补三层测试：

1. 服务端 catalog / tech 对齐
   - `/catalog.units` 只含 `worker / soldier`
   - `prototype / precision_drone / corvette / destroyer` 继续 `hidden=true`
   - 这 4 项科技的原始定义不再暴露 `TechUnlockUnit`
2. `produce` 命令边界
   - `worker / soldier` 仍可正常生产
   - `corvette` 等非公开单位统一返回 authoritative 错误
3. CLI 边界
   - `cmdProduce(['b-1', 'corvette'])` 不再被本地 allowlist 直接拦成旧文案
   - `help produce` 不再硬编码 `worker/soldier`

---

## 5. 最终方案 B：太阳帆改为 system-scoped 的空间 authoritative runtime

### 5.1 新增 top-level `SpaceRuntimeState`

太阳帆不应继续挂在包级全局变量上。本轮新增 top-level 的空间 runtime 容器：

```go
type SpaceRuntimeState struct {
    EntityCounter int64                          `json:"entity_counter"`
    Players       map[string]*PlayerSpaceRuntime `json:"players,omitempty"`
}

type PlayerSpaceRuntime struct {
    PlayerID string                           `json:"player_id"`
    Systems  map[string]*PlayerSystemRuntime  `json:"systems,omitempty"`
}

type PlayerSystemRuntime struct {
    SystemID       string                    `json:"system_id"`
    SolarSailOrbit *SolarSailOrbitState     `json:"solar_sail_orbit,omitempty"`
    Fleets         map[string]*SpaceFleet   `json:"fleets,omitempty"`
}
```

这里预留 `Fleets` 不是为了本轮开放舰队线，而是为了避免未来再造一份新的空间 runtime 宿主。

### 5.2 空间 runtime 挂在 snapshot 顶层

太阳帆是恒星系级状态，不属于某个 planet world，因此不能塞进单个 `WorldSnapshot`。

建议直接修改 `server/internal/snapshot/snapshot.go`：

```go
type Snapshot struct {
    Version        int                          `json:"version"`
    Tick           int64                        `json:"tick"`
    Timestamp      time.Time                    `json:"timestamp"`
    ActivePlanetID string                       `json:"active_planet_id,omitempty"`
    Players        map[string]*model.PlayerState `json:"players,omitempty"`
    PlanetWorlds   map[string]*WorldSnapshot    `json:"planet_worlds,omitempty"`
    World          *WorldSnapshot               `json:"world,omitempty"`
    Discovery      *mapstate.DiscoverySnapshot  `json:"discovery,omitempty"`
    Space          *model.SpaceRuntimeState     `json:"space,omitempty"`
}
```

并同步接入：

- `snapshot.CaptureRuntime(...)`
- `Snapshot.RestoreRuntime()`
- `GameCore.ExportSaveFile()`
- `GameCore.NewFromSave()`
- 自动快照保存
- replay / rollback 恢复链路

### 5.3 空间实体 ID 改由 runtime 分配

`SpaceRuntimeState` 提供统一的 ID 分配器：

```go
func (rt *SpaceRuntimeState) NextEntityID(prefix string) string
```

太阳帆发射规则改为：

- 每发射一张帆都调用一次 `spaceRuntime.NextEntityID("sail")`
- 典型 ID 形态为 `sail-1`、`sail-2`、`sail-3`

不再把 `playerID`、`tick` 拼进 ID 本体。唯一性应该由 authoritative runtime 计数器保证，而不是由业务字段碰运气组合。

### 5.4 太阳帆轨道按 `player + system` 分桶

本轮统一改成：

- `spaceRuntime.Players[playerID].Systems[systemID].SolarSailOrbit`

对应 API 同步重构：

- 删除 `GetSolarSailOrbit(playerID string)`
- 改成 `GetSolarSailOrbit(playerID, systemID string)`
- 删除 `GetSolarSailEnergyForPlayer(playerID string)`
- 改成 `GetSolarSailEnergy(playerID, systemID string)`

这一步不是额外扩 scope，而是太阳帆 authoritative 化不可分割的一部分。只修唯一 ID 不修 system scope，后面仍会在多星系归属和接收站读数上继续错。

### 5.5 `GameCore`、save、replay、rollback 一起切到空间 runtime

`GameCore` 新增：

```go
type GameCore struct {
    ...
    spaceRuntime *model.SpaceRuntimeState
}
```

初始化与恢复要求：

- `New()` 时初始化空 `SpaceRuntimeState`
- `NewFromSave()` 时恢复 `SpaceRuntimeState`
- `ExportSaveFile()` 和自动快照都保存 `SpaceRuntimeState`
- `Replay()`、`Rollback()` 不能只恢复 `WorldState`，也必须恢复 `SpaceRuntimeState`
- live rollback 必须直接替换 `gc.spaceRuntime`

否则会出现“行星世界回滚了，太阳帆 orbit 还停留在旧 tick”的新一轮不一致。

### 5.6 发射、结算、接收站的数据流

修复后的 authoritative 数据流应为：

1. `execLaunchSolarSail`
   - 校验建筑、库存、轨道参数
   - 解析当前 `systemID`
   - 每张帆都调用 `spaceRuntime.NextEntityID("sail")`
   - 追加到 `player + system` 对应 orbit
   - 每张帆各发一条 `entity_created`
2. `settleSolarSails`
   - 遍历 `player -> system -> orbit`
   - 计算寿命，移除到期帆
   - 对每个到期帆发一条带同一 `entity_id` 的 `entity_destroyed`
   - 重算该 orbit 的 `TotalEnergy`
3. `ray_receiver`
   - 通过当前 `ws.PlanetID` 解析 `systemID`
   - 改为读取 `GetSolarSailEnergy(playerID, systemID)`
   - 戴森球能量部分本轮可先保留现有语义，但聚合 helper 要收敛，避免未来继续分散

### 5.7 replay digest 也要覆盖空间态

若太阳帆迁入 top-level `SpaceRuntimeState`，而 replay digest 仍只统计 `WorldState`，那么 replay 即使丢了太阳帆也可能误判为“无漂移”。

因此建议至少补入以下 digest 字段：

- `space_entity_counter`
- `solar_sail_count`
- `solar_sail_systems`
- `solar_sail_total_energy`

并同步 shared-client 类型定义。

### 5.8 这一部分必须补的测试

服务端至少补 5 类测试：

1. 同 tick 批量唯一性
   - 同一玩家、同一 tick、`launch_solar_sail --count 4`
   - orbit 内 4 张帆的 ID 全唯一
   - `entity_created` 中 4 个 `entity_id` 全唯一
2. 生命周期一致性
   - 到期销毁时 `entity_destroyed.entity_id` 与创建时逐一对应
3. save / restore 一致性
   - 发射后保存并恢复
   - orbit 中帆数量、ID、剩余寿命、space entity counter 保持一致
4. replay / rollback 一致性
   - replay digest 覆盖空间态
   - rollback 后 live runtime 中 orbit 与目标 tick 一致
5. system scope
   - 不同 system 的太阳帆不串 orbit
   - 接收站只读取当前所在 system 的太阳帆能量

CLI 至少补 2 类测试：

1. `cmdProduce(['b-1', 'corvette'])` 不再本地 hard reject 为旧文案
2. `help produce` 不再写死 `worker/soldier`

---

## 6. 推荐实施顺序

为避免再次做成“局部正确、整体割裂”，推荐按以下顺序实现：

### 第一步：先收口高阶舰队线的公开边界

1. 建立 authoritative 单位目录
2. `/catalog.units`
3. 清理高阶科技原始 unlock 残留
4. shared-client / CLI 去掉本地分裂口径
5. 补高阶舰队线继续隐藏的测试

### 第二步：引入 `SpaceRuntimeState`

1. 新增 `SpaceRuntimeState`
2. 接入 `GameCore`
3. 打通 snapshot / save / restore / replay / rollback

### 第三步：迁移太阳帆链路

1. 删除 `solarSailOrbits` 包级全局变量
2. 改成 `player + system` 结构
3. 改用 `spaceRuntime.NextEntityID("sail")`
4. 改 `ray_receiver` 的读取语义

### 第四步：补测试和文档

1. 锁定边界
2. 锁定空间态一致性
3. 锁定 replay / rollback
4. 同步 API / CLI / 玩家文档
5. 回归 T101 已确认可用链路，避免回退

---

## 7. 未来若要真正开放终局高阶舰队线

这不是 T101 本轮必做内容，但需要明确沿用 Claude 稿整理出的能力闭环，避免以后再次把半成品包装成“已开放玩法”。

未来真正开放前，至少要补齐：

1. authoritative 的太空单位 / 舰队 runtime
2. 公开部署、编队、移动、攻击、状态查询命令
3. 公开 system / orbit 查询面
4. 可观察事件链路
5. 可回放的太空战斗结果
6. 最后才取消 `prototype / precision_drone / corvette / destroyer` 的 `hidden`

在这些条件满足之前，当前版本都只能明确表述为：

> 终局高阶舰队线仍处于隐藏状态，玩家侧没有公开的生产、部署、编队、查询和战斗入口；当前版本的 DSP 科技树覆盖不包含这条线。

---

## 8. 验收映射

本方案与 T101 验收标准的对应关系如下：

1. 终局高阶舰队线二选一
   - 本方案明确选“当前仍未实现，继续隐藏，并统一口径”。
2. `produce`、CLI 帮助、API 类型定义、服务端能力模型不再矛盾
   - 通过 authoritative 单位目录 + `/catalog.units` 统一真相来源。
3. 同一玩家、同一 tick 批量发射太阳帆时 ID 全唯一
   - 通过 `SpaceRuntimeState.NextEntityID("sail")` 保证唯一。
   - 通过 snapshot-backed runtime 保证创建、销毁、保存、恢复、回放一致。
4. 已验证可用链路不回退
   - `launch_solar_sail`、`build_dyson_*`、`launch_rocket`、`set_ray_receiver_mode` 等公开链路保持不变，只直接重构底层 authoritative 数据宿主。

---

## 9. 最终结论

`T101` 的正确收口方式不是把两个缺口分别做成小补丁，而是一次性统一两件事的真相来源：

1. 终局高阶舰队线本轮继续隐藏，但必须从代码、CLI、API 到文档都明确表达“未开放”，不再保留伪公开痕迹。
2. 太阳帆必须脱离包级全局变量，迁入 snapshot-backed、system-scoped 的空间 authoritative runtime，保证唯一 ID、生命周期事件、save/restore、回放引用全部一致。

这样综合后，既吸收了 Claude 稿对“未来真实开放所需闭环”的完整梳理，也采纳了 Codex 稿对“本轮必须直接修 authoritative 数据源、不能做表面补丁”的实现路径。
