# T103 设计方案：默认新局首条采矿闭环仍需拆研究站绕行

## 1. 问题定义

默认新局（`config-dev.yaml`）中，玩家初始资源为 `minerals = 200`、`energy = 100`。

完成第一门科研 `electromagnetism` 后，要同时保留首台研究站并补出首台可通电矿机，需要建造以下四座建筑：

| 建筑 | minerals | energy | 来源 |
|------|----------|--------|------|
| `wind_turbine` | 30 | 0 | `building_defs.go` override |
| `matrix_lab` | 120 | 60 | category default (research) |
| `tesla_tower` | 20 | 10 | `building_defs.go` override |
| `mining_machine` | 50 | 20 | `building_defs.go` explicit |
| **合计** | **220** | **90** | |

minerals 缺口 = 220 - 200 = **20**。energy 无缺口。

因此玩家在不拆首台研究站的前提下，无法同时拥有电塔 + 矿机，starter 闭环断裂。

## 2. 设计目标

1. 玩家走完 `electromagnetism` 后，能同时保留首台研究站
2. 无需拆建筑、无需作弊，就能补出首台可通电运行的 `mining_machine`
3. 修改后的 starter economy 仍然保持"资源紧张但够用"的开局体验，不能变成资源过剩
4. 改动范围最小化，不引入新机制

## 3. 方案评估

### 方案 A：提高默认新局初始 minerals（推荐）

将 `config-dev.yaml` 中 `bootstrap.minerals` 从 `200` 提高到 `250`。

- 优点：
  - 只改配置文件，不动游戏核心逻辑
  - 250 - 220 = 30 minerals 余量，刚好够一台额外的 `conveyor_belt_mk1`（4 minerals）或一台 `foundation`（10 minerals），但不足以多造一台研究站或矿机，保持了开局紧张感
  - 不影响任何已有测试、建筑成本表、科技树
  - 不影响 midgame 配置
- 缺点：
  - 如果未来新增更多 starter 建筑需求，可能需要再次调整
- 影响范围：
  - `server/config-dev.yaml`：两个玩家的 `bootstrap.minerals` 从 200 改为 250
  - 玩家文档需同步更新初始资源描述

### 方案 B：降低 `matrix_lab` 建造成本

将 `matrix_lab` 的 BuildCost 从 category default 的 `{Minerals: 120, Energy: 60}` 降低到 `{Minerals: 80, Energy: 40}`。

- 优点：
  - 直接解决成本过高问题
  - 总成本变为 180，在 200 以内，还有 20 余量
- 缺点：
  - 修改核心建筑成本表，影响全局平衡（midgame、后期多研究站布局等）
  - 需要在 `building_defs.go` 中为 `matrix_lab` 添加显式 BuildCost
  - 可能需要更新相关测试
  - 研究站作为中后期大量铺设的建筑，降低成本会显著影响经济平衡

### 方案 C：降低 `mining_machine` 建造成本

将 `mining_machine` 的 BuildCost 从 `{Minerals: 50, Energy: 20}` 降低到 `{Minerals: 30, Energy: 10}`。

- 优点：
  - 总成本变为 200，刚好等于初始资源
- 缺点：
  - 零余量，玩家没有任何容错空间
  - 修改核心建筑成本表
  - 矿机是全局大量使用的建筑，降低成本影响中后期经济平衡

### 方案 D：同时微调多个建筑成本

例如 `matrix_lab` 降到 100、`mining_machine` 降到 40。

- 优点：分散调整，单个建筑变化不大
- 缺点：改动点多，影响面广，需要更多测试验证

### 方案 E：给默认新局 bootstrap 额外赠送一台 `tesla_tower` 的等价资源

在 `config-dev.yaml` 的 `bootstrap.inventory` 中直接赠送一台 `tesla_tower` 的建造材料。

- 缺点：当前 bootstrap 系统只支持 minerals/energy/inventory items，不支持直接赠送建筑

## 4. 推荐方案：方案 A — 提高初始 minerals 到 250

### 4.1 理由

1. **最小改动原则**：只改一个配置值，不动任何游戏逻辑代码
2. **不影响全局平衡**：建筑成本表保持不变，midgame 和后期经济不受影响
3. **适度余量**：250 - 220 = 30 minerals 余量，足够容错但不过剩
4. **向前兼容**：如果未来调整建筑成本或科技树，初始资源可以独立再调

### 4.2 余量分析

初始 250 minerals 在完成 starter 闭环后剩余 30 minerals：

- 可以额外建造 1 台 `conveyor_belt_mk1`（4 minerals）
- 或 1 台 `foundation`（10 minerals）
- 或 1 台 `tesla_tower`（20 minerals）用于延伸电网
- 但不够再建 1 台 `mining_machine`（50 minerals）或 `matrix_lab`（120 minerals）

这个余量水平保持了"开局紧张、每一步都要规划"的体验。

### 4.3 推荐的正向开局路线（修改后）

1. `build 3 2 wind_turbine` — 消耗 30 minerals → 剩余 220
2. `build 2 3 matrix_lab` — 消耗 120 minerals → 剩余 100
3. `transfer <matrix_lab_id> electromagnetic_matrix 10`
4. `start_research electromagnetism`
5. `build 4 2 tesla_tower` — 消耗 20 minerals → 剩余 80
6. `build 5 1 mining_machine` — 消耗 50 minerals → 剩余 30

最终状态：
- 首台研究站保留
- 首台矿机通电运行
- 剩余 30 minerals 可用于后续电网延伸

## 5. 实现清单

### 5.1 配置修改

- `server/config-dev.yaml`：将两个玩家的 `bootstrap.minerals` 从 `200` 改为 `250`

### 5.2 文档同步

以下文档中涉及"默认新局初始资源 minerals = 200"的描述需要更新为 `minerals = 250`：

- `docs/player/玩法指南.md`
  - 第 55 行：`minerals = 200` → `minerals = 250`
- `docs/player/上手与验证.md`
  - 如有提及初始资源数值的地方需同步
- `docs/player/已知问题与回归.md`
  - 历史记录中的数值保留原样（作为历史快照），但如果有"当前口径"类描述需更新

### 5.3 测试验证

- 运行现有 T092 回归测试，确认不因初始资源变化而失败：
  ```bash
  cd /home/firesuiry/develop/siliconWorld/server
  env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/gamecore -run T092
  ```
- 如果 T092 测试中硬编码了 `minerals = 200` 的断言，需要同步更新
- 真实默认新局回放验证：
  1. 启动默认新局
  2. 按正向路线建造 wind_turbine → matrix_lab → 装矩阵 → 研究 electromagnetism → tesla_tower → mining_machine
  3. 确认首台研究站保留、首台矿机进入 `running`
  4. 确认剩余 minerals = 30

### 5.4 T092 测试影响评估

`server/internal/startup/t092_config_dev_test.go` 第 43 行检查了 bootstrap resources：
```go
t.Fatalf("unexpected bootstrap resources for %s: %+v", playerID, player.Resources)
```

需要确认该测试是否硬编码了 `minerals = 200`。如果是，需要同步更新为 `250`。

`server/internal/gamecore/t092_default_newgame_test.go` 第 162 行检查了矩阵消耗：
```go
t.Fatalf("expected bootstrap matrices to be fully consumed, got %d", player.Inventory[model.ItemElectromagneticMatrix])
```

这个测试检查的是矩阵消耗而非 minerals，应该不受影响。

## 6. 验收标准

1. 在全新默认新局中，玩家按正向步骤推进到 `electromagnetism` 完成后：
   - 不拆除任何 starter 建筑
   - 能补出首台通电并进入 `running` 的 `mining_machine`
2. `summary` / `inspect` 至少满足：
   - 首台研究站仍然存在
   - 首台矿机 `runtime.state = running`
   - 矿机库存或产出统计开始增长
3. 玩家文档中的初始资源描述与实际一致
4. 所有现有测试通过
