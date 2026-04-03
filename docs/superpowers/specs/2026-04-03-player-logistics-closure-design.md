# 玩家可达物流闭环设计

日期：2026-04-03

## 1. 背景

当前 `server` 已具备以下物流底层能力：

- 行星物流站与星际物流站状态模型
- 行星无人机与星际货船状态模型
- 行星物流调度与星际物流调度
- runtime 查询层的物流站 / 无人机 / 货船视图

但玩家侧仍缺两个关键入口：

1. 无法通过公共命令配置物流站供需槽位
2. 正常游玩路径下不会产生可运行的无人机 / 货船

这导致“物流系统底层已存在，但玩家主线玩法不可达”。

## 2. 目标

本次要把物流补成一个真实可玩的闭环，覆盖行星内与星际两部分：

- 玩家可以建造物流站
- 建站完成后系统自动补齐对应物流单位
- 玩家可以配置物流站供给 / 需求槽位
- 调度系统可以基于配置自动完成配送
- CLI、服务端 API 文档、玩家指南与差距分析文档同步更新

玩家体验目标为：

`造站 -> 配槽位 -> 自动配送`

## 3. 非目标

本次不做以下内容：

- 不做独立物流 REST 资源接口，继续沿用 `/commands`
- 不做玩家手动部署 / 回收单个无人机或货船
- 不做物流单位精细编制管理 UI
- 不做多星球 active planet 切换
- 不重写现有物流调度策略
- 不为了兼容旧物流入口增加适配层，因为当前公开物流入口本就不存在

## 4. 方案选择

采用“方案 1 的收敛版”：

- 物流单位自动生成，不要求玩家显式部署
- 但新增物流站配置命令，让玩家可设置物流参数与物品槽位

原因：

- 能最短路径补齐玩家闭环
- 与现有命令驱动服务端保持一致
- 改动面明显小于单独开一套物流资源接口
- 同时修复 `docs/server_dsp_gap_analysis.md` 当前指出的两类核心缺口

## 5. 服务端设计

### 5.1 新增命令

新增两个命令类型：

- `configure_logistics_station`
- `configure_logistics_slot`

两个命令都通过现有 `POST /commands` 投递。

### 5.2 `configure_logistics_station`

用途：配置物流站全局参数。

目标：

- `target.entity_id` 必填，值为物流站建筑 ID

允许的 `payload` 字段：

- `input_priority?: number`
- `output_priority?: number`
- `drone_capacity?: number`
- `interstellar?:`
  - `enabled?: boolean`
  - `warp_enabled?: boolean`
  - `ship_slots?: number`
  - `ship_capacity?: number`
  - `ship_speed?: number`
  - `warp_speed?: number`
  - `warp_distance?: number`
  - `energy_per_distance?: number`
  - `warp_energy_multiplier?: number`
  - `warp_item_id?: string`
  - `warp_item_cost?: number`

规则：

- 目标必须是已建成物流站
- 目标必须属于当前玩家
- `planetary_logistics_station` 只允许修改：
  - `input_priority`
  - `output_priority`
  - `drone_capacity`
- `planetary_logistics_station` 不允许携带 `interstellar`
- `interstellar_logistics_station` 允许修改全部字段
- 所有数值型字段都做非负校验与归一化

补编制规则：

- 若 `drone_capacity` 上调，自动补齐无人机到当前容量上限
- 若 `ship_slots` 上调，自动补齐货船到当前槽位上限
- 容量下调时，不主动删除已存在物流单位，只限制未来补编制与容量校验

### 5.3 `configure_logistics_slot`

用途：配置某个物品槽位的供需规则。

目标：

- `target.entity_id` 必填，值为物流站建筑 ID

`payload` 字段：

- `scope: "planetary" | "interstellar"`
- `item_id: string`
- `mode: "none" | "supply" | "demand" | "both"`
- `local_storage: number`

规则：

- `scope=planetary` 写入 `LogisticsStationState.Settings`
- `scope=interstellar` 写入 `LogisticsStationState.InterstellarSettings`
- 对 `planetary_logistics_station` 使用 `scope=interstellar` 时直接报错
- 写入后立即刷新站点容量缓存
- 首版不单独提供删除命令
- 约定 `mode=none` 且 `local_storage=0` 表示该槽位失效

### 5.4 自动生成物流单位

物流单位不再要求玩家显式部署。

在以下场景自动补齐物流单位：

1. 物流站施工完成
2. `configure_logistics_station` 上调容量

规则：

- `planetary_logistics_station`
  - 自动补齐无人机到 `drone_capacity`
- `interstellar_logistics_station`
  - 自动补齐无人机到 `drone_capacity`
  - 自动补齐货船到 `ship_slots`

自动生成原则：

- 物流单位 ID 由世界状态分配
- 无人机出生点为所属站点坐标
- 货船出生点为所属站点坐标
- 物流单位初始状态为 `idle`
- 货船参数取站点当前星际配置快照

### 5.5 站点拆除与清理

物流站拆除时，先清理绑定物流单位，再移除站点注册表。

清理范围：

- 站点所属无人机
- 站点所属货船

理由：

- 避免世界状态残留悬挂物流单位
- 避免 runtime 查询层继续暴露无效物流单位
- 避免后续调度或结算访问已不存在的站点

### 5.6 调度与结算边界

以下现有逻辑继续复用，不做策略重写：

- `settleLogisticsDispatch`
- `settleInterstellarLogisticsDispatch`
- `settleLogisticsDrones`
- `settleLogisticsShips`

本次只负责把：

- 站点配置输入
- 物流单位可用性

这两个调度前提补齐。

## 6. 客户端与共享层设计

### 6.1 shared-client

更新 `shared-client`：

- 扩展 `CommandType`
- 增加两个 helper：
  - `cmdConfigureLogisticsStation`
  - `cmdConfigureLogisticsSlot`
- 增加对应参数类型定义

### 6.2 client-cli

新增 CLI 命令：

- `configure_logistics_station`
- `configure_logistics_slot`

建议交互形态：

```bash
configure_logistics_station <building_id> [--input-priority <n>] [--output-priority <n>] [--drone-capacity <n>]
configure_logistics_station <building_id> --ship-slots <n> --ship-capacity <n> --ship-speed <n>
configure_logistics_slot <building_id> <planetary|interstellar> <item_id> <none|supply|demand|both> <local_storage>
```

CLI 只做参数解析与命令转发，不做业务侧缓存。

## 7. 文档更新范围

需要同步更新以下文档：

- `docs/服务端API.md`
- `docs/cli.md`
- `docs/server_dsp_gap_analysis.md`
- `docs/玩家玩法指南.md`

更新目标：

- API 文档新增两个物流命令说明
- CLI 文档新增物流命令示例
- 差距分析文档把“物流玩家入口未开放”改成“已开放，并说明当前自动补编制机制”
- 玩家指南把阶段 G 中“物流入口未开放”的描述改成可实际操作流程

## 8. 测试策略

### 8.1 服务端测试

至少补齐以下测试：

- 建成行星物流站后自动生成无人机
- 建成星际物流站后自动生成无人机和货船
- 配置两个行星站供需后，无人机可自动派单并送达
- 配置两个星际站供需后，货船可自动派单并送达
- 上调 `drone_capacity` 会自动补齐无人机
- 上调 `ship_slots` 会自动补齐货船
- 拆除物流站后，绑定无人机 / 货船被清理
- 新命令结构校验通过，非法 payload 会返回错误

### 8.2 CLI 测试

补参数解析与命令映射测试：

- `configure_logistics_station`
- `configure_logistics_slot`

### 8.3 验证命令

服务端：

```bash
cd server
/home/firesuiry/sdk/go1.25.0/bin/go test ./...
```

CLI：

```bash
cd client-cli
npm test
```

## 9. 风险与约束

### 9.1 容量下调不删现有单位

这是首版有意保留的约束。

原因：

- 直接删除飞行中单位会引入状态回滚与半路货物处理复杂度
- 当前目标是先打通闭环，不先做复杂编制回收

### 9.2 自动补满编制不是 DSP 原样机制

这是本项目当前阶段的有意简化。

原因：

- 重点先解决“能不能玩”
- 后续如需要更贴近 DSP，再把“自动补齐”替换成“手动部署或消耗物品补编制”

### 9.3 只补 active planet 下的完整运行态

本次不改变当前 `active planet` 运行模式。

因此本次完成后：

- 单星球内物流闭环成立
- 当前 active planet 上的星际站/货船也可运行
- 但多星球长期并行经营问题仍独立存在

## 10. 实施结果判定

完成后应满足以下结果：

1. 玩家能通过公共命令配置物流站供需
2. 新建物流站后可自动拥有可运行物流单位
3. 行星物流和星际物流都能在正常游玩路径中触发实际配送
4. CLI 与文档不再声称“物流入口未开放”
5. 差距文档中的物流缺口描述被实质修正
