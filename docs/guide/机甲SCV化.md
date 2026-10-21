# 机甲 SCV 化（第 22 轮契约）

本轮把「开局每颗行星各送一台机甲」改成「从一颗星起步、逐步扩张」，并把
「一个发令者只能绑一台机甲」放开成「一个发令者可绑多台，命令点名执行」。

配套文档：[多机甲协作](多机甲协作.md)（第 21 轮的绑定/档案口径，本轮在其上扩展）。

## 1. 开局只有出生星球有机甲

`seedPlayerOutposts` 只在**出生星球**（`starterPlanetID`，即
`battlefield.initial_active_planet_id` 指向的行星）给每个玩家建基站、造开局机甲、
发 bootstrap 物资。

其它已加载行星：**不建基站、不造机甲、不发物资**。`scenario_bootstrap.planets`
里显式配置的建筑照旧注入（官方 war / midgame 场景靠它预置产线）。

后果（都是预期行为）：
- 新行星一开始 `playerHasFootholdOnWorld` 为 false，`switch_active_planet` 会被拒
  （「目标星球需先建立据点」），必须先把机甲投送过去。
- 投送过去的机甲本身就是据点（`playerHasFootholdOnWorld` 认 `executor` 单位）。

## 2. `dispatch_mecha`（新命令）

把发令者的一台机甲**瞬移**到另一颗已加载的行星（本轮不做飞行时间）。

| 项 | 口径 |
| --- | --- |
| 命令类型 | `dispatch_mecha` |
| 路由 | `routePlanet`：`target.planet_id` = **目标**星球 |
| 执行者 | `handleIssuer(routePlanet, …)`；执行器自己解析机甲（**不能**用 `handleMecha`，它是在目标行星里找机甲，而投送时机甲还在源行星） |
| 载荷 | 无（`payload` 可省略或 `{}`） |

选哪台机甲：`target.mecha_id` 非空就用它（必须是本方机甲、必须属于该 issuer）；
为空时 issuer 只有 1 台就用它，≥2 台报 `VALIDATION_FAILED`「你有 N 台机甲，
dispatch_mecha 需要 target.mecha_id 点名」，一台都没有报 `EXECUTOR_UNAVAILABLE`。
「源行星」= 该机甲的 `record.PlanetID`（不是玩家焦点行星）。

前置校验（按顺序，失败即返回，不产生副作用）：

1. 目标星球运行时未加载 → `INVALID_TARGET`「星球运行时 %s 未加载」。
2. 目标星球未被发现（`discovery.IsPlanetDiscovered`）→ `VALIDATION_FAILED`
   「目标星球未被发现」。
3. 目标星球 == 机甲当前星球 → `VALIDATION_FAILED`「机甲 %s 已在 %s」。
4. 机甲有未完成作业（`unit.Mecha.Job != nil`）→ `VALIDATION_FAILED`
   「机甲 %s 正在作业，先 cancel_mecha_job」。

落点（目标星球内，按顺序取第一个可用的空单位格）：

1. 本方在该行星的基站旁（`findUnitSpawnTile(ws, hq.Position, false, unitSpawnRadius)`，
   多个基站按 building ID 升序试）。
2. 没有基站时用行星中心附近（`findNearestOpenTile(ws, center)`）。
3. 都找不到 → `VALIDATION_FAILED`「%s 上没有机甲落点」。

执行：

- 从源世界 `Units` 删除、从 `TileUnits` 摘除；`record.PlanetID` 改成目标行星。
- 在目标世界用**同一个 unit ID** 重建单位（`UnitStats(UnitTypeExecutor)` 派生，
  保留 `OwnerID`/`ID`，位置 = 落点，满血、满能量、空作业）。
- 玩家 `FocusPlanetID` 不改（焦点由 `switch_active_planet` 单独控制）。
- 背包跟着档案走（`MechaRecord.Inventory` 本来就与单位分离），不需要搬。

事件：一条 `entity_updated`，`VisibilityScope = playerID`（与其它 `entity_updated` 一致，
字段写在 payload 里而不是事件顶层）：

```json
{"entity_type": "mecha", "mecha_id": "u-3", "planet_id": "planet-1-2", "from_planet_id": "planet-1-1"}
```

回执：`机甲 %s 已投送到 %s`。

## 3. 一个发令者可绑多台机甲

`assign_mecha` 不再有「抢占」语义：绑定只写这一台档案的 `Operator`，
**不会**把同 operator 的其它机甲自动解绑。

- `model.PlayerState.MechaByOperator(operator) *MechaRecord` 删除，改为
  `MechasByOperator(operator) []*MechaRecord`（按 unit ID 升序）。
- 同一台机甲重复绑同一 operator = 幂等成功。
- 解绑仍是 `payload.operator = ""`，只影响这一台。
- 回执不再带 `released_mecha_id`。

## 4. 命令点名执行机甲：`target.mecha_id`

`model.CommandTarget` 增加字段：

```go
MechaID string `json:"mecha_id,omitempty"`
```

`handleMecha` 解析顺序：

1. **显式点名**：`target.mecha_id` 非空时用它。校验（各自独立错误码）：
   - 该 ID 不是本方机甲 → `ENTITY_NOT_FOUND`「未找到机甲 %s」。
   - `record.Operator != issuerID` → `NOT_OPERATOR`「机甲 %s 绑定给 %s，不是你」。
   - `record.PlanetID != 当前世界星球` → `EXECUTOR_UNAVAILABLE`「你的机甲 %s 在 %s，不在本星球」。
   - 单位不存在/阵亡 → 沿用现有阵亡消息。
2. **缺省**：取该 issuer 绑定的、`PlanetID == 当前世界星球` 的机甲里 unit ID
   最小的那台。
3. 一台都没有：
   - issuer 名下完全没有机甲 → `EXECUTOR_UNAVAILABLE`「%s 还没有绑定机甲：先用
     assign_mecha 接管一台（mecha list 查看）」。
   - 有绑定但都不在本星球 → `EXECUTOR_UNAVAILABLE`「你的机甲都在别的星球：
     %s（用 dispatch_mecha 投送，或 switch_active_planet 切焦点）」，
     列表按 unit ID 升序、逗号分隔。

**路由**：`resolveCommandWorld` 里在「显式 `target.planet_id`」之后、实体引用之前
加一条——`target.mecha_id` 指定的机甲在某行星时，路由到那台机甲的行星。这样
「点名在 B 星的机甲 + 不写 planet_id」的 `build` 会落到 B 星。

**例外**：`dispatch_mecha` 的 `target.planet_id` 是**目标**行星，不能被这条规则
改路由到源行星。实现上加 `if cmd.Type != model.CmdDispatchMecha` 或给
`commandRoute` 加标志位。

## 5. 显示（「宣传自己在操作」）

- 3D 行星场景：机甲单位上方画 operator 名牌（`operator == ""` 不画）。文案规则
  与 GUI 一致：等于自己玩家 ID → 「我」，否则原样显示 operator（agent 名）。
- 服务端：`GET /world/planets/{planet_id}/scene` 增加 `mecha_operators`（机甲 unit ID →
  operator，只含请求玩家自己档案里的非空绑定；别人的绑定不对外）。
- GUI：`MechaControls` 的「操作者」保持，并去掉「接管后 <旧ID> 变为空闲」提示（§3 已取消
  抢占）；机甲列表（`MechaFleetCard`）每台显示 operator 与所在行星。跨星球面板加
  「机甲投送」表单（目标行星 + 可选点名机甲）。
- CLI：`mecha list` 已有 operator 列，保持不变；`mecha assign` 帮助文案去掉
  「会解绑旧机甲」的说法；新增 `mecha dispatch <planet_id> [mecha_id]` 与顶层
  `dispatch_mecha`。

## 6. 实体 ID 跨行星唯一

`WorldState.NextEntityID` 目前用**每行星独立**的 `EntityCounter`，多行星局会出现
两颗行星都有 `u-24` / `b-1`；而 `PlayerState.Mechas` 是玩家级、按 unit ID 索引，
于是后加载的行星会覆盖前一颗的机甲档案（审计 P0）。

本轮要求：**同一局内所有已加载行星的实体 ID 互不重复**，格式仍是 `prefix-N`。

实现（已落地）：`WorldState.EntityIDs *EntityIDAllocator` 是一个 `atomic.Int64` 计数器，
同一局的所有已加载行星共用同一个实例（`ShareEntityIDs`，开局与读档时挂接）。快照仍按行星
各存一份 `entity_counter`，读档时取**最大值**设回共享计数器；回滚用 `RaiseEntityCounter`
（只前进不回退，避免与没一起回滚的其它行星已分配的 ID 撞号）。约束：

- 存档往返后仍唯一（快照要能恢复出正确的计数器状态）。
- 现有「建筑 ID 只在行星内唯一」的代码注释与 `alert_history` 等按
  `planet_id + building_id` 去重的逻辑不受影响（它们本来就带行星）。

## 7. 不动的部分

- `MechaRecord` 字段与语义（背包、复活）不变。
- 每台机甲 `concurrent_tasks = 2`、`operate_range = 18` 不变。
- `move` / `attack` / `unit_order` 对「别人绑定的机甲」逐个 `NOT_OPERATOR` 不变。
- 机甲阵亡复活点仍是「档案所在星球的本方基站」。
