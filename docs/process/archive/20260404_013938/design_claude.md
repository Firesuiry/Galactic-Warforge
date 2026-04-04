# T089 设计方案：官方戴森中后期验证场景闭环

## 1. 问题总结

当前 `config-midgame.yaml + map-midgame.yaml` 场景存在两个阻断性问题：

1. **供电缺失**：`orbital_collector`、`vertical_launching_silo` 等建筑建造后因无电网覆盖而处于 `no_power` 状态，文档中的快速验证路线缺少供电步骤。
2. **载荷装填断链**：`launch_solar_sail` 和 `launch_rocket` 要求建筑本地存储中有载荷（`solar_sail` / `small_carrier_rocket`），但当前没有任何玩家可执行的命令能将背包物品装入建筑存储，也没有预置自动供料链。

## 2. 方案选择

采用 **方案 B + 方案 A 混合**：

- **核心改动（方案 B）**：新增 `transfer_item` 命令，允许玩家将背包物品装入建筑本地存储。这是一个通用能力，不仅解决发射场景，也为后续所有需要手动装填的场景提供基础。
- **辅助改动（方案 A）**：补充 midgame 配置中的预置物资（`solar_sail`、`graphene`、`carbon_nanotube`），并在文档中写明供电步骤。

**选择理由**：
- 纯方案 A（预置条件）只能解决 midgame 测试场景，不解决正式游戏中的装填问题
- 纯方案 C（预放供料链）过于复杂，midgame 场景会变得臃肿
- 方案 B 提供了缺失的核心游戏机制，是根本性修复

## 3. 详细设计

### 3.1 新增 `transfer_item` 命令

#### 3.1.1 命令定义

在 `server/internal/model/command.go` 中新增：

```go
CmdTransferItem CommandType = "transfer_item"
```

#### 3.1.2 命令格式

```json
{
  "type": "transfer_item",
  "payload": {
    "building_id": "<目标建筑ID>",
    "item_id": "<物品ID>",
    "quantity": 4
  }
}
```

#### 3.1.3 执行逻辑

在 `server/internal/gamecore/rules.go` 中新增 `execTransferItem`：

```
func (gc *GameCore) execTransferItem(ws, playerID, cmd):
  1. 校验 payload 必填字段：building_id, item_id, quantity
  2. 查找建筑，校验存在性
  3. 校验建筑归属（building.OwnerID == playerID）
  4. 校验建筑有存储模块（building.Storage != nil）
  5. 校验玩家背包中有足够物品（player.Inventory[item_id] >= quantity）
  6. 调用 building.Storage.Receive(item_id, quantity) 尝试装入
  7. 根据实际接收量 accepted 扣减玩家背包
  8. 返回结果（含实际装入数量）
```

**校验规则**：
- `quantity` 必须 > 0
- 建筑必须属于当前玩家
- 建筑必须有 `Storage`（非 nil）
- 玩家背包中必须有足够数量的目标物品
- 如果建筑存储已满或 slot 不足，`Receive` 会返回部分接收量，命令仍然成功（部分装填），只扣减实际装入的数量

**返回**：
- 成功：`CodeOK`，message 包含实际装入数量
- 失败：对应错误码（`ENTITY_NOT_FOUND` / `NOT_OWNER` / `INSUFFICIENT_RESOURCE` / `VALIDATION_FAILED`）

#### 3.1.4 事件

使用现有 `EvtEntityUpdated` 事件类型，payload 包含：

```json
{
  "building_id": "...",
  "item_id": "...",
  "transferred": 4,
  "source": "player_inventory"
}
```

#### 3.1.5 命令分发

在 `server/internal/gamecore/core.go` 的 `executeRequest` switch 中新增 case：

```go
case model.CmdTransferItem:
    res, evts = gc.execTransferItem(gc.world, qr.PlayerID, cmd)
```

### 3.2 CLI 新增 `transfer` 命令

#### 3.2.1 命令格式

```
transfer <building_id> <item_id> <quantity>
```

示例：
```
transfer silo-abc123 small_carrier_rocket 2
transfer ejector-def456 solar_sail 5
```

#### 3.2.2 实现位置

- `client-cli/src/command-catalog.ts`：注册命令定义（category: `management`）
- `client-cli/src/commands/action.ts`：实现 handler，构造 `transfer_item` 命令并调用 API
- `shared-client/src/types.ts`：如需要，补充类型定义

### 3.3 补充 midgame 配置

#### 3.3.1 新增预解锁科技

在 `config-midgame.yaml` 的 `completed_techs` 中追加：

```yaml
- solar_sail_orbit    # 解锁 em_rail_ejector + solar_sail 配方
- ray_receiver        # 解锁 ray_receiver 建筑
```

**理由**：midgame 场景定位为"中后期验证"，应覆盖太阳帆发射和射线接收两条链路。当前只解锁了 `vertical_launching`，缺少 `solar_sail_orbit` 和 `ray_receiver`。

#### 3.3.2 新增预置背包物资

在 `bootstrap.inventory` 中追加：

```yaml
- item_id: solar_sail
  quantity: 16
- item_id: small_carrier_rocket
  quantity: 4
```

**理由**：
- `solar_sail` 的配方需要 `graphene` + `carbon_nanotube`，midgame 场景没有预置这些原料也没有生产链，直接给成品更合理
- `small_carrier_rocket` 的配方需要 200 tick 生产周期，预置少量成品可让玩家立即验证发射流程
- 玩家仍可通过 `vertical_launching_silo` 的自动生产获得更多火箭（背包中已有 `frame_material`、`deuterium_fuel_rod`、`quantum_chip` 原料）

### 3.4 完整的 midgame 验证路线

以下是修复后玩家可执行的最短命令路径：

```bash
# 0. 启动服务器
cd server && go run ./cmd/server -config config-midgame.yaml -map map-midgame.yaml

# 1. 登录
login p1 key_player_1

# 2. 查看状态，确认活跃星球
summary

# 3. 建立供电网络（关键步骤！）
build 2 2 tesla_tower          # 电网枢纽
build 1 2 wind_turbine         # 发电机 1
build 3 2 wind_turbine         # 发电机 2
build 2 1 wind_turbine         # 发电机 3（确保电力充足）

# 4. 建造发射设施
build 4 2 vertical_launching_silo   # 垂直发射井
build 5 2 em_rail_ejector           # 电磁弹射器

# 5. 等待建造完成（约 10-20 秒）
# 可用 inspect <building_id> 查看状态

# 6. 装填载荷
transfer <silo_id> small_carrier_rocket 2    # 装填火箭到发射井
transfer <ejector_id> solar_sail 5           # 装填太阳帆到弹射器

# 7. 建造戴森球脚手架
build_dyson_node sys-1 0 10 20 --orbit-radius 1.2
build_dyson_node sys-1 0 30 40 --orbit-radius 1.2
build_dyson_frame sys-1 0 <node_a_id> <node_b_id>

# 8. 发射！
launch_solar_sail <ejector_id> --count 3
launch_rocket <silo_id> sys-1 --layer 0

# 9. 验证结果
event_snapshot    # 应出现 rocket_launched 事件
```

## 4. 涉及文件变更清单

### 4.1 服务端（Go）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/internal/model/command.go` | 修改 | 新增 `CmdTransferItem` 常量 |
| `server/internal/gamecore/rules.go` | 修改 | 新增 `execTransferItem` 方法 |
| `server/internal/gamecore/core.go` | 修改 | switch 中新增 `CmdTransferItem` 分发 |
| `server/config-midgame.yaml` | 修改 | 追加科技和背包物资 |

### 4.2 客户端 CLI（TypeScript）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `client-cli/src/command-catalog.ts` | 修改 | 注册 `transfer` 命令 |
| `client-cli/src/commands/action.ts` | 修改 | 实现 `transfer` handler |
| `shared-client/src/types.ts` | 修改 | 补充 `transfer_item` 命令类型（如需要） |

### 4.3 文档

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `docs/dev/服务端API.md` | 修改 | 新增 `transfer_item` 命令文档 |
| `docs/dev/客户端CLI.md` | 修改 | 新增 `transfer` CLI 命令文档 |
| `docs/player/上手与验证.md` | 修改 | 修正 midgame 验证路线，补充供电和装填步骤 |
| `docs/player/玩法指南.md` | 修改 | 补充物品装填玩法说明 |

## 5. 测试计划

### 5.1 单元测试

在 `server/internal/gamecore/` 中新增 `transfer_item_test.go`：

- `TestTransferItem_Success`：正常装填，验证玩家背包扣减 + 建筑存储增加
- `TestTransferItem_PartialTransfer`：建筑存储容量不足时部分装填
- `TestTransferItem_NotOwner`：装填他人建筑应失败
- `TestTransferItem_NoStorage`：目标建筑无存储模块应失败
- `TestTransferItem_InsufficientInventory`：背包物品不足应失败
- `TestTransferItem_InvalidParams`：缺少必填字段应失败

### 5.2 集成测试

扩展 `e2e_test.go` 或 `dyson_commands_test.go`：

- `TestMidgameLaunchFlow`：完整走通 "建供电 → 建发射井 → transfer 装填 → launch_rocket" 流程
- `TestMidgameSolarSailFlow`：完整走通 "建供电 → 建弹射器 → transfer 装填 → launch_solar_sail" 流程

### 5.3 手动回归

按第 3.4 节的完整验证路线，使用 `client-cli` 对 `config-midgame.yaml + map-midgame.yaml` 进行端到端验证。

## 6. 验收标准对照

| 验收项 | 如何满足 |
|--------|---------|
| 使用官方 midgame 配置启动新局 | config-midgame.yaml 已补充科技和物资 |
| 只按公开命令推进，不手改存档 | 新增 `transfer` 命令提供公开装填入口 |
| `launch_solar_sail` 返回 OK | 通过 `transfer` 装填 solar_sail 后发射 |
| `launch_rocket` 返回 OK | 通过 `transfer` 装填 small_carrier_rocket 后发射 |
| `event_snapshot` 出现 `rocket_launched` | launch_rocket 成功后自动产生该事件 |
| 文档可被新玩家逐步复现 | 更新所有相关文档，写明供电+装填+发射步骤 |
