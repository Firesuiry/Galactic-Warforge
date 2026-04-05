# T100 最终实现方案：终局舰队线口径收口与太阳帆 authoritative runtime 落地

## 0. 输入说明

当前仓库根目录下只有 `docs/process/design_codex.md`，不存在用户点名的顶层 `docs/process/design_claude.md`。

因此，本文不伪造“两份同题草案都在当前目录”的前提，而是基于以下输入做单一定稿：

1. `docs/process/design_codex.md`
2. `docs/process/archive/20260405_075100/design_claude.md` 的最新可用版本
3. `docs/process/task/T100_戴森深度试玩后终局舰队线仍未开放且太阳帆批量发射实体ID冲突.md`
4. 当前仓库代码与文档现状

本文目标不是继续并列保留 Claude/Codex 两套意见，而是给出一份可以直接进入实现阶段的唯一推荐方案。

另外需要明确：

- `T100` 当前任务只处理“终局高阶舰队线仍未开放”和“太阳帆批量发射实体 ID 冲突”。
- 任务文档已经确认 `artificial_star` 空燃料运行态问题本轮未复发，当前表现为 `runtime.state = no_power`、`runtime.state_reason = no_fuel`。
- 因此，Claude 稿里与 `artificial_star` 相关的修复内容不进入本文最终范围。

---

## 1. 最终裁决

### 1.1 终局高阶舰队线

本轮选择：**继续隐藏，并把代码、CLI、API、文档全部收口到同一真实边界。**

本轮不开放以下终局高阶舰队线：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

原因不是“暂时不想做”，而是当前缺的不是一个开关，而是一整条公开玩法链路：

- 公开科技树展示
- 玩家可用生产入口
- 部署 / 编队 / 查询入口
- 可观察的轨道 / 太空实体状态
- 战斗结算
- 事件与回放一致性

在这些链路都没有完成之前，把这条线从 `hidden` 改成公开，只会制造新的伪闭环。

### 1.2 终局舰队线的收口方式

这里**不采纳 Claude 稿的“主要做文档统一、代码尽量不动”**，而采纳 Codex 稿的主方向：

- 继续隐藏高阶舰队线
- 同时清理代码里的“伪公开”痕迹
- 建立服务端 authoritative 的公开单位口径
- 让 CLI / shared-client / 服务端校验全部依赖同一真相来源

原因很直接：`T100` 的验收明确要求 `produce`、CLI 帮助、API 类型定义、服务端能力模型不能再彼此矛盾。只改文档，不够。

### 1.3 太阳帆实体 ID

本轮选择：**不做字符串级补丁，直接改成 snapshot-backed、system-scoped 的空间 authoritative runtime。**

也就是说，不采用：

- `sail-<player>-<tick>-<i>` 这种局部修补
- 包级全局 `solarSailOrbits` 继续存在
- 只修创建事件，不修销毁 / 回放 / save/restore

本轮必须一次性解决：

- 同 tick 批量发射唯一性
- orbit 内实体 ID 一致性
- `entity_created` / `entity_destroyed` 一致性
- save / restore / replay 一致性
- 按 `player + system` 分桶，而不是继续按 `player` 混算

### 1.4 不纳入本轮范围

本轮不做：

- `artificial_star` 相关修复
- 真正开放终局舰队线
- 把 `produce` 扩成 `produce corvette`
- 重做戴森球能量系统的全部 system-scope 改造

---

## 2. 两份草案的综合取舍

### 2.1 采纳 Claude 稿的部分

Claude 稿有一个核心判断是正确的，而且必须保留：

- 终局高阶舰队线不是“差一个取消隐藏的开关”
- 当前仓库没有公开生产 / 部署 / 编队 / 查询 / 战斗闭环
- 因此本轮应按“继续隐藏”处理，而不是伪装成已开放

这部分判断与当前 `T100` 任务文档、当前代码现状完全一致。

### 2.2 不采纳 Claude 稿的部分

Claude 稿的以下处理不进入最终方案：

1. 把 `artificial_star` 作为本轮主问题之一
   `T100` 已明确它本轮未复发，不属于当前收口范围。

2. 以“主要改文档、尽量不动代码”处理高阶舰队线
   这不足以满足 `T100` 对代码、CLI、API 统一口径的验收要求。

3. 保持 `produce` / `tech.go` / shared-client 现状不动
   当前矛盾正是这些层面产生的，不能靠文档掩盖。

### 2.3 采纳 Codex 稿的部分

Codex 稿中应保留为最终方案主体的部分如下：

1. 高阶舰队线继续隐藏，但要建立 authoritative 公开单位目录
2. 从高阶隐藏科技的原始定义中移除 `TechUnlockUnit`
3. 让 CLI / shared-client 不再维护各自独立的单位 allowlist
4. 引入空间 runtime 宿主，废弃 `solarSailOrbits` 包级全局变量
5. 太阳帆改按 `player + system` 存储
6. 太阳帆实体 ID 改为 runtime 分配，并持久化到 save/replay
7. 把“未来真正开放舰队线”的蓝图和本轮必做范围分开

### 2.4 对 Codex 稿的必要修正

Codex 稿的主方向正确，但落地层面要做两处修正：

1. `SpaceRuntimeState` 不应挂在某个 `WorldSnapshot` 内
   当前保存的是多行星 `snapshot.Snapshot.PlanetWorlds`。太阳帆属于恒星系级空间态，正确挂载点应该是 runtime 总快照，而不是任意一个 planet world。

2. 空间实体计数器不能复用 `WorldState.EntityCounter`
   当前 `WorldState.EntityCounter` 是单个 planet world 级别；同一玩家可从不同 planet world 向同一 system 发射太阳帆。空间态需要独立、可存档的实体计数器。

---

## 3. 当前仓库的关键事实

本文最终定稿必须以当前代码事实为准，而不是只转述草案。

### 3.1 高阶舰队线当前仍然是“隐藏但残留伪公开痕迹”

当前代码现状：

- `server/internal/model/tech.go`
  - `prototype`、`precision_drone`、`corvette`、`destroyer` 仍为 `hidden=true`
  - 但原始定义里仍残留 `TechUnlockUnit`
- `server/internal/model/tech.go` 的 `runtimeSupportedUnitUnlocks()`
  - 当前只保留 runtime backed 的物流无人机 / 货船
- `server/internal/model/tech_alignment_test.go`
  - 已要求上述 4 项科技不再暴露 `TechUnlockUnit`
- `shared-client/src/api.ts`
  - `UnitTypeName` 仍硬编码为 `'worker' | 'soldier'`
- `client-cli/src/commands/action.ts`
  - 仍有本地 `UNIT_TYPES = {'worker','soldier'}`
- `server/internal/model/entity.go`
  - 公开地表单位仍只有 `worker / soldier / executor`

结论：

- 当前玩家侧真实可用单位边界仍然是 `worker / soldier`
- 但这个边界目前分散在 tech normalize、TS union、CLI allowlist、服务端校验等多个位置
- 这正是 `T100` 需要收口的地方

### 3.2 现有文档口径已经大体正确

当前文档里：

- `docs/player/玩法指南.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/客户端CLI.md`
- `docs/dev/服务端API.md`
- `docs/archive/reference/戴森球计划-服务端逻辑功能清单.md`

已经基本明确：

- 高阶舰队线仍隐藏
- `produce` 当前只支持 `worker / soldier`
- 当前版本的 DSP 科技树覆盖不包含这条线

因此，本轮文档工作不是“大面积重写”，而是：

- 跟随实现补齐新增 API / CLI 行为说明
- 确认不再残留新的夸大表述

### 3.3 太阳帆当前不是单点 bug，而是 runtime 宿主错误

当前实现里：

- `server/internal/gamecore/solar_sail_settlement.go`
  - 使用包级全局 `solarSailOrbits`
  - key 只有 `playerID`
  - `LaunchSolarSail()` 直接生成 `sail-<player>-<tick>`
- `server/internal/gamecore/rules.go`
  - `launch_solar_sail --count N` 会在同一个 tick 内循环发射
- `server/internal/gamecore/ray_receiver_settlement.go`
  - 仍使用 `GetSolarSailEnergyForPlayer(playerID)`
- `server/internal/snapshot/snapshot.go`
  - 当前 runtime save payload 只有多 planet `WorldSnapshot`
  - 太阳帆轨道状态不在快照中

结论：

- 当前冲突不仅是 ID 拼接冲突
- 当前太阳帆状态游离于 authoritative save/replay 体系之外
- 如果只改 ID 字符串，save/restore、system scope、回放一致性仍然是错的

---

## 4. 最终方案 A：终局高阶舰队线继续隐藏，但清理成单一真相来源

### 4.1 建立 authoritative 公开单位目录

本轮新增服务端 authoritative 的公开单位目录，作为以下能力的唯一来源：

- `/catalog` 的单位公开视图
- `produce` 的可生产单位判断
- CLI `help produce`
- CLI 可选的本地预校验
- shared-client 的命令参数语义

建议新增模型：

```go
type PublicUnitDomain string

const (
	PublicUnitDomainGround PublicUnitDomain = "ground"
	PublicUnitDomainAir    PublicUnitDomain = "air"
	PublicUnitDomainSpace  PublicUnitDomain = "space"
)

type UnitCatalogEntry struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Domain       PublicUnitDomain `json:"domain"`
	Public       bool             `json:"public"`
	Producible   bool             `json:"producible"`
	Deployable   bool             `json:"deployable"`
	QueryScopes  []string         `json:"query_scopes,omitempty"`
	HiddenReason string           `json:"hidden_reason,omitempty"`
}
```

设计要求：

- `/catalog` 新增 `units[]`
- `units[]` 由服务端 authoritative 生成
- `executor` 作为内部执行体，不进入 `units[]`
- `prototype / precision_drone / corvette / destroyer` 本轮不进入 `units[]`
- 当前可直接驱动 `produce` 的公开单位仍只有 `worker / soldier`

### 4.2 `produce` 不再由多处硬编码共同决定

当前 `produce` 的公开边界不应再同时由以下位置分别维护：

- `shared-client/src/api.ts` 的 TS union
- `client-cli/src/commands/action.ts` 的本地 `UNIT_TYPES`
- `server/internal/gamecore/rules.go` 的服务端校验

最终语义应为：

1. 服务端 authoritative 判断“此单位是否属于当前公开且可生产的地面单位”
2. CLI 帮助文本从 `/catalog.units` 渲染
3. CLI 若做本地校验，也必须基于运行期 `catalog.units`
4. 若 CLI 当前拿不到 catalog，则允许直接透传到服务端，不再保留手写 allowlist
5. shared-client 的 `cmdProduce()` 不再把公开边界硬编码进 TS union

这意味着：

- `UnitTypeName` 不再承担“当前公开单位范围”职责
- 玩家能不能生产某单位，以服务端 authoritative catalog 为准

### 4.3 高阶隐藏科技要直接表达“未开放”，而不是靠 normalize 偷偷裁掉

本轮必须把以下科技从“原始定义假装解锁单位、最终视图再裁掉”改成“原始定义就直接不解锁单位”：

- `prototype`
- `precision_drone`
- `corvette`
- `destroyer`

具体要求：

- 保留科技定义和前置关系
- 保留 `hidden=true`
- 从原始 `Unlocks` 中移除 `TechUnlockUnit`
- `engine` 继续作为前置科技，但不对外宣称解锁高阶作战单位

这样做的收益是：

- 原始定义、catalog 结果、CLI、文档说的是同一件事
- 不再依赖“normalize 之后才看起来正确”的隐式规则

### 4.4 文档改动只跟随真实接口变化

由于当前玩家文档和开发文档已经基本收口，本轮文档改动聚焦两件事：

1. 若 `/catalog` 新增 `units[]`，则在 `docs/dev/服务端API.md` 明确字段语义
2. 若 CLI `help produce` 改为运行期目录驱动，则在 `docs/dev/客户端CLI.md` 说明来源改为 authoritative catalog

同时做一次仓库全文检索，确认没有新的夸大表述重新出现：

- `已全部实现`
- `全部实现`
- `完整覆盖`
- `终局玩法已全部覆盖`

### 4.5 这一部分必须补的测试

至少补四类测试：

1. `catalog.units` 只暴露当前公开单位
   - `worker / soldier` 在内
   - `executor` 不在内
   - `prototype / precision_drone / corvette / destroyer` 不在内

2. 高阶隐藏科技不再暴露单位 unlock
   - `prototype / precision_drone / corvette / destroyer` 原始定义均不含 `TechUnlockUnit`
   - `/catalog.techs` 里仍为 `hidden=true`

3. `produce` 口径一致
   - CLI `help produce` 展示内容来自 `catalog.units`
   - `produce ... corvette` 不再出现“本地一套、服务端一套”的矛盾错误

4. 文档/API 一致性
   - 若新增 `catalog.units`，文档描述必须同步
   - 不再出现“高阶舰队线已公开可玩”的说明

---

## 5. 最终方案 B：太阳帆改为 system-scoped 的空间 authoritative runtime

### 5.1 新增独立的 `SpaceRuntimeState`

本轮新增专门承载空间实体的 runtime 容器：

```go
type SpaceRuntimeState struct {
	EntityCounter int64                         `json:"entity_counter"`
	Players       map[string]*PlayerSpaceRuntime `json:"players,omitempty"`
}

type PlayerSpaceRuntime struct {
	PlayerID string                           `json:"player_id"`
	Systems  map[string]*PlayerSystemRuntime  `json:"systems,omitempty"`
}

type PlayerSystemRuntime struct {
	SystemID       string               `json:"system_id"`
	SolarSailOrbit *SolarSailOrbitState `json:"solar_sail_orbit,omitempty"`
}
```

这里刻意不把它挂进某个 `WorldSnapshot`，而是挂进 runtime 总快照。原因：

- 当前运行时是多 planet world
- 太阳帆按恒星系归属，不按 planet world 归属
- 同一 system 的空间实体不应依附于“最后一次从哪个行星发射”

### 5.2 `SpaceRuntimeState` 必须进 save/restore/replay

本轮要同步改动：

- `GameCore`
  - 持有 `spaceRuntime`
- `snapshot.Snapshot`
  - 新增 `space_runtime`
- `snapshot.CaptureRuntime()`
  - 一并捕获 `spaceRuntime`
- `Snapshot.RestoreRuntime()`
  - 一并恢复 `spaceRuntime`
- `save_state.go`
  - 新建存档、读档时恢复空间态

这样做之后，太阳帆生命周期才真正进入 authoritative 存档体系。

### 5.3 空间实体计数器与 planet `WorldState.EntityCounter` 分离

当前 `WorldState.EntityCounter` 是 planet world 级别，不适合作为空间态 ID 生成器。

原因：

- 当前运行时存在多个 `PlanetWorlds`
- 同一玩家可以在不同 planet world 上操作
- 太阳帆与未来舰队实体应在空间态里拥有自己的连续 ID 命名空间

因此本轮新增：

```go
func (rt *SpaceRuntimeState) NextEntityID(prefix string) string
```

示例生成结果：

- `sail-1`
- `sail-2`
- `sail-3`

这比 `sail-<player>-<tick>` 更正确，因为唯一性来自 authoritative runtime，而不是来自业务字段拼接。

### 5.4 `solarSailOrbits` 包级全局变量必须被删除

本轮要彻底移除：

- `var solarSailOrbits = make(map[string]*model.SolarSailOrbitState)`

改成：

- `gc.spaceRuntime` 持有全部空间态
- `GetSolarSailOrbit(playerID, systemID)` 从 `spaceRuntime` 读取
- `settleSolarSails()` 遍历 `player -> system -> orbit`

这是本轮最关键的结构变化之一。只要这个包级全局还在，太阳帆就不可能真正进入 save/replay。

### 5.5 太阳帆必须按 `player + system` 聚合

当前 orbit 只按 `playerID` 聚合，这是错误的。

本轮统一改成：

- `playerID + systemID` 双维度归属

配套改动：

1. `execLaunchSolarSail`
   - 从 `ws.PlanetID` 解析当前 `systemID`
   - 追加到 `spaceRuntime.players[playerID].systems[systemID].solar_sail_orbit`

2. `settleSolarSails`
   - 按 `player -> system -> orbit` 衰减寿命并重算能量

3. `ray_receiver`
   - 不再调用 `GetSolarSailEnergyForPlayer(playerID)`
   - 改为读取当前 world 所在 `systemID` 的太阳帆能量

### 5.6 射线接收站的读取语义

本轮只强制修正太阳帆这部分 system scope。

推荐做法：

- 新增 `GetSolarSailEnergy(playerID, systemID string) int`
- `settleRayReceivers()` 通过 `ws.PlanetID -> maps.Planet(...) -> systemID`
  获取当前 world 所在恒星系
- 只读取该 `systemID` 下的太阳帆能量

对于戴森球能量：

- 本轮不强制把全部 Dyson runtime 一次性改成 system scope
- 但接收站内部应把“可用外部能量”的聚合逻辑收敛到单一 helper，避免以后再次分散改动

### 5.7 创建、结算、销毁、回放必须引用同一个实体 ID

修复后的 authoritative 数据流必须是：

1. `execLaunchSolarSail`
   - 校验建筑、库存、轨道参数
   - 解析 `systemID`
   - 每发射一张帆都调用 `spaceRuntime.NextEntityID("sail")`
   - 追加到 orbit
   - 发出 `entity_created`

2. `settleSolarSails`
   - 依据 `LaunchTick` 和 `LifetimeTicks` 结算寿命
   - 到期时从 orbit 删除
   - 发出带同一 `entity_id` 的 `entity_destroyed`
   - 重算 `TotalEnergy`

3. `save / restore / replay`
   - 完整保存 orbit 成员、剩余寿命、`EntityCounter`
   - 恢复后继续沿用同一套实体 ID

### 5.8 这一部分必须补的测试

至少补以下测试：

1. 同一玩家、同一 tick、`launch_solar_sail --count >= 2`
   - orbit 中每张太阳帆 `ID` 唯一
   - `entity_created` 中每条 `entity_id` 唯一

2. 生命周期一致性
   - 到期销毁时 `entity_destroyed.payload.entity_id`
     必须能对应到创建时同一实体

3. save / restore 一致性
   - 发射后保存并恢复
   - orbit 成员数量、ID、寿命、`EntityCounter` 不丢失

4. system scope
   - 不同 system 的太阳帆不串 orbit
   - 接收站只读取自己所在 system 的太阳帆能量

5. 已有链路不回退
   - `launch_solar_sail`
   - `build_dyson_*`
   - `set_ray_receiver_mode power`
   - midgame 已确认可用路径保持成立

---

## 6. 文件影响面建议

本轮推荐涉及以下文件：

### 6.1 服务端模型与快照

- `server/internal/model/tech.go`
- `server/internal/model/unit_catalog.go`（新增）
- `server/internal/model/space_runtime.go`（新增）
- `server/internal/model/solar_sail_orbit.go`
- `server/internal/snapshot/snapshot.go`

### 6.2 服务端 runtime

- `server/internal/gamecore/core.go`
- `server/internal/gamecore/save_state.go`
- `server/internal/gamecore/rules.go`
- `server/internal/gamecore/solar_sail_settlement.go`
- `server/internal/gamecore/ray_receiver_settlement.go`

### 6.3 shared-client / CLI

- `shared-client/src/api.ts`
- `shared-client/src/types.ts`
- `client-cli/src/commands/action.ts`
- `client-cli/src/commands/util.ts`

### 6.4 测试

- `server/internal/model/tech_alignment_test.go`
- `server/internal/gamecore/dyson_commands_test.go`
- 新增太阳帆 save/restore 与 system scope 测试
- 新增 catalog / produce 口径一致性测试

### 6.5 文档

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`
- 如实现过程中出现新口径变更，再同步：
  - `docs/player/玩法指南.md`
  - `docs/player/已知问题与回归.md`

---

## 7. 实施顺序

推荐按以下顺序实现，避免再次做成“局部正确”：

### 第一步：先把终局舰队线的代码真相收口

1. 从高阶隐藏科技原始定义中移除 `TechUnlockUnit`
2. 建立 authoritative `catalog.units`
3. 改 `produce` 的服务端判断逻辑
4. 让 CLI / shared-client 取消手写单位边界
5. 补高阶舰队线继续隐藏的测试

### 第二步：引入空间 runtime 宿主

1. 新增 `SpaceRuntimeState`
2. 挂入 `GameCore`
3. 接入 `snapshot.Snapshot` 的 capture / restore / save

### 第三步：迁移太阳帆链路

1. 删除 `solarSailOrbits` 包级全局变量
2. 改成 `player + system` 结构
3. 改用 `spaceRuntime.NextEntityID("sail")`
4. 改 `ray_receiver` 的读取语义

### 第四步：补测试和文档

1. 补同 tick 批量唯一性
2. 补 save/restore 一致性
3. 补 system scope
4. 同步 API / CLI 文档
5. 复跑 T100 要求的既有链路回归

---

## 8. 明确不做的事情

本轮明确不做：

1. 不在 `T100` 内真正开放 `prototype / precision_drone / corvette / destroyer`
2. 不把 `produce` 改成高阶舰队入口
3. 不新增兼容 wrapper 或 adapter 去同时维护旧口径和新口径
4. 不保留 `solarSailOrbits` 这种脱离存档体系的包级全局状态
5. 不只修 `entity_created`，而放任 `entity_destroyed` / save / replay 继续不一致
6. 不把 `artificial_star` 相关逻辑混进本轮方案

---

## 9. 未来真正开放终局舰队线时的边界

这不是本轮实现范围，但必须提前写清楚，避免以后再次走到“半开放”状态。

未来若要真正开放高阶舰队线，至少要满足：

1. 新的公开命令面
   - 部署
   - 编队
   - 移动
   - 攻击
   - 状态查询

2. 新的公开查询面
   - system / orbit 位置
   - 舰队成员构成
   - 编队状态
   - 可观察战斗结果

3. authoritative runtime
   - 轨道 / 太空战斗实体进入 snapshot-backed runtime
   - 事件、伤害、销毁、回放一致

4. 最后才开放科技树
   - 只有当前三项稳定后，才能把 `prototype / precision_drone / corvette / destroyer` 从 `hidden` 改成公开

在此之前，当前版本都只能宣称：

> 终局高阶舰队线仍处于隐藏状态，玩家侧没有公开的生产、部署、编队、查询和战斗入口；当前版本的 DSP 科技树覆盖不包含这条线。

---

## 10. 最终结论

`T100` 的正确收口方式不是把两个缺口分别做成小补丁，而是一次性统一两件事的真相来源：

1. 终局高阶舰队线本轮继续隐藏，但必须从代码、CLI、API 到文档都明确表达“未开放”，不再保留伪公开痕迹。
2. 太阳帆必须脱离包级全局变量，迁入 snapshot-backed、system-scoped 的空间 authoritative runtime，保证唯一 ID、生命周期事件、save/restore、回放引用全部一致。

这份方案综合后，既保留了 Claude 稿对“不要伪装高阶舰队线已开放”的正确边界判断，也采纳了 Codex 稿对“必须直接修 authoritative 数据源，不做表面补丁”的实现路径。
