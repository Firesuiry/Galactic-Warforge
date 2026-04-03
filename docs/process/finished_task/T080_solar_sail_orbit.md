# T080 太阳帆生产与轨道管理

## 需求细节
- 太阳帆物品定义与生产配方。
- 太阳帆发射：从电磁发射器/垂直发射井发射太阳帆到轨道。
- 轨道管理：太阳帆在轨道上的位置、轨道半径、轨道倾角。
- 寿命衰减：太阳帆有生命周期，到期后消失。
- 蜂群轨道：多个太阳帆形成蜂群轨道，覆盖恒星。
- 轨道上的太阳帆产生能量输出（被射线接收站接收）。
- 与射线接收站集成：轨道能量被射线接收站收集。

## 前提任务
- 无

## 实现状态：已完成

### 实现内容

#### 1. 太阳帆物品定义
- 文件：`server/internal/model/item.go`
- 添加了 `ItemSolarSail = "solar_sail"` 常量
- 添加了太阳帆物品目录定义（堆叠限制100，体积1）

#### 2. 太阳帆生产配方
- 文件：`server/internal/model/recipe.go`
- 添加了 `solar_sail` 配方：
  - 输入：石墨烯×2，碳纳米管×1
  - 输出：太阳帆×1
  - 耗时：30 tick
  - 建筑：组装机 Mk.I/II/III
  - 科技解锁：`solar_sail`

#### 3. 太阳帆发射命令
- 文件：`server/internal/model/command.go`
- 添加了 `CmdLaunchSolarSail` 命令类型
- 文件：`server/internal/gamecore/rules.go`
- 实现了 `execLaunchSolarSail` 函数
  - 验证建筑为 EM Rail Ejector 或 Vertical Launching Silo
  - 检查玩家库存中有太阳帆
  - 消耗太阳帆物品
  - 调用 LaunchSolarSail 将太阳帆送入轨道

#### 4. 轨道状态管理
- 文件：`server/internal/model/solar_sail_orbit.go`
- 定义了 `SolarSailOrbitState`：玩家轨道状态
- 定义了 `SolarSail`：单个太阳帆结构
  - ID、轨道半径、倾角、发射tick、寿命、每tick能量
- 定义了 `SolarSailOrbitParams`：轨道参数
  - 默认半径 1.0 AU
  - 默认寿命 36000 tick（约1小时）
  - 每太阳帆基础能量 10 kW

#### 5. 太阳帆结算
- 文件：`server/internal/gamecore/solar_sail_settlement.go`
- `LaunchSolarSail`：发射太阳帆到轨道
- `settleSolarSails`：处理太阳帆寿命衰减，到期发送销毁事件
- `GetSolarSailEnergyForPlayer`：获取玩家太阳帆总能量

#### 6. 蜂群轨道能量加成
- 文件：`server/internal/model/solar_sail_orbit.go`
- `CalcSwarmBonus`：计算蜂群加成
  - 每增加一个太阳帆，增加1%效率
  - 最高2倍加成上限
- `SolarSailEnergyOutput`：计算总能量输出

#### 7. 射线接收站集成
- 文件：`server/internal/gamecore/ray_receiver_settlement.go`
- 修改了 `settleRayReceivers` 函数
- 将太阳帆能量添加到射线接收站的有效输入

#### 8. Tick 循环集成
- 文件：`server/internal/gamecore/core.go`
- 在 tick 循环中添加了太阳帆结算步骤（步骤6.5）
- 添加了 `CmdLaunchSolarSail` 命令处理

### 命令格式
```json
{
  "type": "launch_solar_sail",
  "target": {},
  "payload": {
    "building_id": "em_rail_ejector_1",
    "count": 1,
    "orbit_radius": 1.0,
    "inclination": 0.0
  }
}
```

### 科技树
- 需要先研究 `solar_sail` 科技才能使用太阳帆配方
