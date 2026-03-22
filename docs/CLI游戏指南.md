# SiliconWorld CLI 游戏指南

## 1. 游戏概述

SiliconWorld 是一个星际工业建造与战争对抗策略游戏。玩家需要：
- 建造建筑采集资源和发电
- 生产单位进行扩张和防御
- 升级科技提升产能
- 与其他玩家争夺资源和领土

## 2. 启动 CLI

```bash
cd client-cli
npm install
npm run dev
```

设置服务器地址（可选）：
```bash
SW_SERVER=http://localhost:18080 npm run dev
SW_SSE_VERBOSE=1 SW_SERVER=http://localhost:18080 npm run dev
```

启动后选择玩家：
- `[1]` p1 (key_player_1)
- `[2]` p2 (key_player_2)
- `[3]` Custom key（自定义 ID 和 Key）

## 3. 资源系统

游戏中有两种核心资源：

| 资源 | 说明 |
|------|------|
| **Minerals** (矿物) | 用于建造建筑、生产单位、科技升级 |
| **Energy** (能量) | 驱动建筑运转，建筑物需要能量才能工作 |

查看当前资源：
```
summary
```

输出示例：
```
Tick: 3176328  Active Planet: planet-1  Map: 32x32

Player  Alive  Minerals  Energy
------  -----  --------  ------
p1      yes    10000     9992
p2      yes    0         0
```

## 4. 建筑系统

### 4.1 建筑类型

| 建筑类型 | ID | 功能 | 产出 |
|----------|-----|------|------|
| 基地 | base | 总部建筑，提供基础能力 | 视野 |
| 采矿机 | mine / mining_machine | 采集矿物 | +矿物 |
| 太阳能板 | solar_plant | 发电 | +能量 |
| 工厂 | factory | 生产单位 | - |
| 炮塔 | turret / gauss_turret | 攻击敌人 | - |

### 4.2 建造建筑

```
build <x> <y> <building_type> [direction]
```

参数：
- `x`, `y`：建造位置（行星地图坐标，0-31）
- `building_type`：建筑类型
- `direction`：可选，朝向（north/east/south/west/auto）

示例：
```
build 10 10 mining_machine    # 在 (10,10) 建造采矿机
build 15 15 solar_panel       # 在 (15,15) 建造太阳能板
build 20 20 gauss_turret      # 在 (20,20) 建造炮塔
build 12 12 factory east      # 在 (12,12) 建造工厂，朝东
```

建造会被服务器接受并在下一个 tick 执行。

### 4.3 升级建筑

```
upgrade <entity_id>
```

示例（升级建筑 b-3）：
```
upgrade b-3
```

### 4.4 拆除建筑

```
demolish <entity_id>
```

示例：
```
demolish b-5
```

## 5. 单位系统

### 5.1 单位类型

| 单位类型 | 说明 |
|----------|------|
| worker | 工人，可采集资源 |
| soldier | 士兵，用于战斗 |

### 5.2 生产单位

必须先有工厂才能生产单位：

```
produce <factory_entity_id> <unit_type>
```

示例：
```
produce b-5 worker   # 在工厂 b-5 生产工人
produce b-5 soldier  # 在工厂 b-5 生产士兵
```

### 5.3 移动单位

```
move <entity_id> <x> <y>
```

示例：
```
move u-1 15 15       # 将单位 u-1 移动到 (15,15)
```

### 5.4 攻击

```
attack <entity_id> <target_entity_id>
```

示例：
```
attack u-1 b-10      # 单位 u-1 攻击建筑 b-10
```

## 6. 查询命令

### 6.1 服务器状态

```
health              # 服务器健康状态和当前 tick
metrics             # 运行时指标
```

### 6.2 世界查询

```
galaxy              # 查看星系列表
system [id]         # 查看系统详情（默认 sys-1）
planet [id]         # 查看行星详情（需提供 planet_id 如 planet-1）
fog [id]            # 查看战争迷雾 ASCII 图（# = 可见，. = 黑暗）
fogmap [id]         # 查看迷雾原始 JSON
```

### 6.3 行星信息

```
planet planet-1     # 查看 planet-1 的建筑和单位
```

输出示例：
```
Planet: planet-1  Tick: 3176600  Map: 32x32

Buildings:
ID      Type         Owner  Pos       HP     Lvl  State
------  -----------  ------ --------- ------ ---- -------
b-1     base         p1     (3,3)     700/700  1    unknown
b-3     mine         p1     (4,4)     200/250  2    unknown
b-4     solar_plant  p1     (1,5)     130/130  1    unknown
b-5     factory      p1     (5,7)     280/280  1    unknown
b-6     turret      p1     (5,10)    160/160  1    unknown
b-10    turret      p2     (6,8)     160/160  1    unknown

No units.
```

## 7. 战争迷雾

地图默认处于战争迷雾状态，只能看到：
- 自己建筑的视野范围
- 己方单位的视野范围

使用 `fog` 命令查看可见区域：
```
fog planet-1
```

输出示例（ASCII 渲染）：
```
FogMap: planet-1  32x32

  0123456789012345678901234567890123
 0 ........................................
 1 ........................................
 2 ........................................
 3 ........................................
 4 ........................................
 5 ........................................
 6 ........................................
 7 ........................................
 8 ........................................
 9 ........................................
10 ........................................
```

（`#` = 可见区域，`.` = 黑暗）

## 8. 玩家切换

```
switch p2                    # 切换到玩家 p2
switch p1 key_player_1       # 切换到 p1（需要 key）
```

切换玩家后会断开 SSE 事件流并重新连接。

## 9. SSE 事件流

CLI 自动接收服务器推送的事件：
```
events              # 查看最近 10 条事件
events 20           # 查看最近 20 条事件
event_snapshot --types command_result,building_state_changed --since-tick 120
event_snapshot --all --since-tick 120
```

- CLI 默认会显式订阅一组低噪声关键事件，不会自动把全部高频 Tick 事件都拉下来
- 需要排查高频事件时，使用 `SW_SSE_VERBOSE=1` 启动，或通过 `event_snapshot --all` 主动补拉

## 10. 游戏流程建议

### 初期（Tick 0-1000）
1. 查看当前资源状态：`summary`
2. 查看基地周围地形：`fog planet-1`
3. 建造太阳能板保证能源供应
4. 建造采矿机开始积累矿物
5. 建造工厂开始生产单位

### 中期（Tick 1000-5000）
1. 升级采矿机提升产量：`upgrade b-3`
2. 建造炮塔加强防御
3. 生产士兵准备战斗
4. 移动单位探索地图

### 后期
1. 建造更多工厂扩大产能
2. 升级炮塔提升攻击力
3. 对敌方建筑发起攻击

## 11. 常用命令速查

| 类别 | 命令 | 说明 |
|------|------|------|
| **信息** | `summary` | 资源与玩家状态 |
| | `planet <id>` | 行星详情 |
| | `fog <id>` | 战争迷雾 |
| | `status` | 当前玩家 |
| **建筑** | `build <x> <y> <type>` | 建造建筑 |
| | `upgrade <id>` | 升级建筑 |
| | `demolish <id>` | 拆除建筑 |
| **单位** | `produce <factory> <type>` | 生产单位 |
| | `move <unit> <x> <y>` | 移动单位 |
| | `attack <unit> <target>` | 攻击 |
| **工具** | `switch <player>` | 切换玩家 |
| | `events [n]` | 查看事件 |
| | `help [cmd]` | 帮助 |

## 12. 地图尺寸

当前地图为 32x32 的格子，坐标从 (0,0) 到 (31,31)。

## 13. 注意事项

1. **建筑需要能量**：没有足够能量供应的建筑会停止工作
2. **生产需要工厂**：只有工厂才能生产单位
3. **迷雾机制**：未探索区域和敌人视野外的区域不可见
4. **Tick 机制**：所有命令在下一个 tick 执行，不是即时生效
5. **请求 ID**：每次命令都有唯一的 request_id 用于追踪
