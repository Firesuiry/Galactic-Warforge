# T092 设计方案：默认新局科研起点锁死修复

## 1. 问题根因分析

### 1.1 死锁链条

当前默认新局（`config-dev.yaml + map.yaml`）存在一条硬循环：

```
要研究 electromagnetism → 需要 running 的 matrix_lab
要建造 matrix_lab → 需要 electromagnetic_matrix 科技解锁它
electromagnetic_matrix 的前置是 electromagnetism → 回到起点
```

### 1.2 代码层面的原因

1. **`CanBuildTech` 是全量门禁**：`rules.go:84` 中 `execBuild` 对每个建筑类型都调用 `CanBuildTech(player, TechUnlockBuilding, btype)`，要求该建筑必须被某个已完成科技的 `Unlocks` 列表中以 `TechUnlockBuilding` 类型引用。

2. **`dyson_sphere_program` 不解锁任何建筑**：初始科技 `dyson_sphere_program`（`tech.go:219-227`）只解锁 `{Type: TechUnlockSpecial, ID: "electromagnetic_matrix"}`，不包含任何 `TechUnlockBuilding`。

3. **`electromagnetism` 才解锁第一批建筑**：`wind_turbine`、`power_pylon`（即 `tesla_tower`）、`mining_machine` 都在 `electromagnetism` 的解锁列表中（`tech.go:239-243`）。

4. **`start_research` 要求 running 研究站**：`research.go:301-305` 在执行 `start_research` 时检查 `runningResearchLabs(gc.worlds, playerID)`，如果没有 running 的研究站则直接拒绝。

5. **`matrix_lab` 被 `electromagnetic_matrix` 科技解锁**：而 `electromagnetic_matrix` 的前置是 `electromagnetism`（`tech.go:277-289`）。

6. **默认新局 `config-dev.yaml` 没有 bootstrap**：不像 `config-midgame.yaml` 那样预置 `completed_techs` 和物资。

结论：默认新局中，玩家无法建造任何建筑，也无法启动任何研究。

### 1.3 影响范围

- 供电：无法建造 `wind_turbine`、`solar_panel` 等
- 采矿：无法建造 `mining_machine`
- 科研：无法建造 `matrix_lab`，也无法启动 `start_research`
- 工业化主线：全部无法进入第一步

---

## 2. 设计目标

1. 默认新局玩家能只通过公开命令，合法完成第一门科技 `electromagnetism`
2. 不回退研究系统为"抽象研究点自动完成"——保留 running 研究站 + 真实矩阵消耗
3. 不依赖外部预制存档、手工改配置、隐藏命令
4. midgame 场景的已有链路不受影响
5. 改动最小化，优先利用现有 bootstrap 机制

---

## 3. 方案选型

### 方案 A：在 `dyson_sphere_program` 科技中增加初始建筑解锁（推荐）

**思路**：修改 `dyson_sphere_program` 的 `Unlocks` 列表，让它解锁一组"开局必需"的基础建筑。

**解锁内容**：
- `wind_turbine` — 基础供电
- `tesla_tower` — 电网延伸
- `mining_machine` — 基础采矿
- `matrix_lab` — 研究站

**优点**：
- 改动集中在一处（`tech.go` 中 `dyson_sphere_program` 的定义）
- 语义清晰：`dyson_sphere_program` 作为"文明起点"科技，解锁基础生存能力是合理的
- 不需要修改任何游戏逻辑代码
- 不需要修改配置文件格式
- `electromagnetism` 的解锁列表可以保留（重复解锁不影响功能）

**缺点**：
- `electromagnetism` 原本解锁的 `wind_turbine`、`mining_machine` 变成了"已经有了"，降低了该科技的解锁感
- 需要同步调整 `electromagnetism` 的解锁列表，避免玩家困惑

### 方案 B：在 `config-dev.yaml` 中为玩家添加 bootstrap 预置科技

**思路**：利用已有的 `PlayerBootstrapConfig.CompletedTechs` 机制，在默认配置中预置 `electromagnetism`。

**优点**：
- 零代码改动，纯配置变更
- 不影响科技树定义

**缺点**：
- 跳过了 `electromagnetism` 的研究体验，玩家直接从 Level 2 科技开始
- 与"从零开始推进科技树"的设计意图不符
- 需要额外预置矩阵物资（否则仍然无法研究下一门科技）

### 方案 C：在 `config-dev.yaml` 中 bootstrap 预置建筑和物资

**思路**：通过 bootstrap 给玩家预置一个 `matrix_lab` 建筑和少量 `electromagnetic_matrix` 物资。

**优点**：
- 保留完整科技树体验
- 不修改科技定义

**缺点**：
- 当前 bootstrap 机制不支持预置建筑（只支持 minerals/energy/inventory/completed_techs）
- 需要新增 bootstrap 建筑功能，改动较大
- 即使预置了 `matrix_lab`，玩家仍然无法建造 `wind_turbine` 和 `mining_machine`，供电和采矿仍然锁死

### 方案 D：混合方案 — 修改科技树 + bootstrap 预置物资（最终推荐）

**思路**：
1. 修改 `dyson_sphere_program` 解锁基础建筑（方案 A 的核心）
2. 在 `config-dev.yaml` 中 bootstrap 预置少量 `electromagnetic_matrix`（让玩家能立即启动第一门研究）

**优点**：
- 玩家开局就能建造基础建筑（风机、电塔、矿机、研究站）
- 玩家开局就能启动 `electromagnetism` 研究
- 保留了完整的科技树推进体验
- 改动最小：一处科技定义 + 一处配置文件

**缺点**：
- 需要同时改代码和配置

---

## 4. 最终方案：方案 D 详细设计

### 4.1 修改 `dyson_sphere_program` 科技定义

**文件**：`server/internal/model/tech.go`，约第 219-227 行

**变更**：在 `dyson_sphere_program` 的 `Unlocks` 中增加基础建筑解锁：

```go
{
    ID:       "dyson_sphere_program",
    Name:     "戴森球计划",
    NameEN:   "Dyson Sphere Program",
    Category: TechCategoryMain,
    Type:     TechTypeMain,
    Level:    0,
    Unlocks: []TechUnlock{
        {Type: TechUnlockSpecial, ID: "electromagnetic_matrix"},
        {Type: TechUnlockBuilding, ID: "wind_turbine"},
        {Type: TechUnlockBuilding, ID: "tesla_tower"},
        {Type: TechUnlockBuilding, ID: "mining_machine"},
        {Type: TechUnlockBuilding, ID: "matrix_lab"},
    },
},
```

**解锁的建筑及理由**：

| 建筑 | 理由 |
|------|------|
| `wind_turbine` | 基础供电，无电则一切建筑无法运行 |
| `tesla_tower` | 电网延伸，否则矿区无法通电 |
| `mining_machine` | 基础采矿，资源获取的唯一入口 |
| `matrix_lab` | 研究站，科研闭环的必要组件 |

**不在此处解锁的建筑**：
- `conveyor_belt_mk1` / `sorter_mk1` / `depot_mk1` — 保留给 `basic_logistics_system` 解锁
- `arc_smelter` — 保留给 `automatic_metallurgy` 解锁
- `assembling_machine_mk1` — 保留给 `basic_assembling_processes` 解锁
- `battlefield_analysis_base` — 初始化时直接放置，不走建造流程

### 4.2 调整 `electromagnetism` 科技解锁列表

**文件**：`server/internal/model/tech.go`，约第 230-244 行

**变更**：从 `electromagnetism` 的 `Unlocks` 中移除已被 `dyson_sphere_program` 解锁的建筑，改为解锁更有意义的内容：

```go
{
    ID:            "electromagnetism",
    Name:          "电磁学",
    NameEN:        "Electromagnetism",
    Category:      TechCategoryMain,
    Type:          TechTypeMain,
    Level:         1,
    Prerequisites: []string{"dyson_sphere_program"},
    Cost:          []ItemAmount{{ItemID: "electromagnetic_matrix", Quantity: 10}},
    Unlocks: []TechUnlock{
        {Type: TechUnlockBuilding, ID: "power_pylon"},
        {Type: TechUnlockBuilding, ID: "water_pump"},
        {Type: TechUnlockBuilding, ID: "advanced_mining_machine"},
    },
},
```

**说明**：
- `wind_turbine`、`mining_machine` 已提前到 `dyson_sphere_program`，不再重复
- `power_pylon`（即 `tesla_tower`）：注意当前代码中 `electromagnetism` 解锁的是 `power_pylon`，但实际建筑 ID 是 `tesla_tower`。需要确认这两者的对应关系。如果 `power_pylon` 是 `tesla_tower` 的别名，则 `tesla_tower` 也已提前解锁，此处改为解锁 `water_pump` 和 `advanced_mining_machine` 作为电磁学的进阶内容
- 如果 `power_pylon` 和 `tesla_tower` 是不同建筑，则保留 `power_pylon` 在此处

> **实现时需确认**：`power_pylon` 是否等同于 `tesla_tower`。从 `building_defs.go` 看，建筑类型列表中没有 `power_pylon`，只有 `tesla_tower`。因此 `electromagnetism` 原本解锁的 `power_pylon` 实际上是一个无效引用。应将其修正为 `tesla_tower`，并将 `tesla_tower` 提前到 `dyson_sphere_program` 解锁。

### 4.3 修改 `config-dev.yaml` 添加 bootstrap 物资

**文件**：`server/config-dev.yaml`

**变更**：为每个玩家添加 bootstrap 配置，预置少量 `electromagnetic_matrix`：

```yaml
players:
  - player_id: "p1"
    key: "key_player_1"
    team_id: "team-1"
    role: "commander"
    permissions: ["*"]
    executor:
      build_efficiency: 1.0
      operate_range: 6
      concurrent_tasks: 2
      research_boost: 0.0
    bootstrap:
      minerals: 200
      energy: 100
      inventory:
        - item_id: electromagnetic_matrix
          quantity: 20
  - player_id: "p2"
    key: "key_player_2"
    team_id: "team-2"
    role: "commander"
    permissions: ["*"]
    executor:
      build_efficiency: 1.0
      operate_range: 6
      concurrent_tasks: 2
      research_boost: 0.0
    bootstrap:
      minerals: 200
      energy: 100
      inventory:
        - item_id: electromagnetic_matrix
          quantity: 20
```

**数量说明**：
- `electromagnetism` 研究需要 `electromagnetic_matrix x10`
- 预置 20 个，足够完成 `electromagnetism` 并留有余量启动下一门 Level 2 科技
- `minerals: 200` 和 `energy: 100` 与当前 `buildSharedPlayers` 中的默认值一致（`runtime_registry.go:23`），显式写入 bootstrap 后会覆盖默认值

### 4.4 开局可玩流程验证

修改后，默认新局的合法开局流程：

```
1. summary                              → 确认初始状态
2. build 3 2 matrix_lab                 → 建造研究站（dyson_sphere_program 已解锁）
3. build 3 3 wind_turbine               → 建造风机供电（dyson_sphere_program 已解锁）
4. build 3 4 tesla_tower                → 延伸电网（dyson_sphere_program 已解锁）
   [等待 matrix_lab 进入 running 状态]
5. transfer <matrix_lab_id> electromagnetic_matrix 10
                                        → 把预置矩阵装入研究站
6. start_research electromagnetism      → 启动第一门科技
   [等待研究完成]
7. build 4 2 mining_machine             → 在资源点建矿机（此时已有，但开局也可建）
8. 继续推进 basic_logistics_system、automatic_metallurgy 等
```

### 4.5 需要同步更新的文档

#### 4.5.1 `docs/player/玩法指南.md`

- **第 2 节"开局你拥有什么"**：增加初始物资说明（`electromagnetic_matrix x20`）
- **第 2 节"初始已完成科技"**：说明 `dyson_sphere_program` 现在解锁基础建筑
- **第 4 节"阶段 B"**：修正开局流程，先建研究站和风机，再研究 `electromagnetism`
- **第 7 节"新手流程"**：更新步骤顺序

#### 4.5.2 `docs/player/上手与验证.md`

- 更新默认新局的验证步骤，反映新的开局流程

#### 4.5.3 `docs/player/已知问题与回归.md`

- 标记 T092 已修复

#### 4.5.4 `docs/dev/服务端API.md`（如有变化）

- 如果 `GET /catalog` 返回的科技解锁信息有变化，需要更新示例

---

## 5. 影响分析

### 5.1 对现有测试的影响

- `dyson_commands_test.go`、`e2e_test.go` 等测试可能依赖当前科技树定义
- `tech_alignment_test.go` 验证科技树与建筑目录的对齐关系，需要更新
- 需要运行 `go test ./...` 确认所有测试通过

### 5.2 对 midgame 场景的影响

- midgame 配置已经 bootstrap 了 `electromagnetism` 等科技，`dyson_sphere_program` 的额外解锁不会产生冲突
- 已确认可用的 midgame 链路不受影响

### 5.3 对存档兼容性的影响

- 科技定义变更是代码层面的，不影响已有存档的 `CompletedTechs` 数据
- 已有存档中如果 `dyson_sphere_program` 已完成，重新加载后会自动获得新增的建筑解锁
- 不需要存档迁移

### 5.4 对 `/catalog` API 的影响

- `GET /catalog` 返回的科技树信息会反映新的解锁列表
- 客户端（CLI/Web）会自动展示更新后的科技树

---

## 6. 实现步骤

1. **修改科技定义**：编辑 `server/internal/model/tech.go`
   - 在 `dyson_sphere_program` 的 `Unlocks` 中增加 4 个 `TechUnlockBuilding`
   - 调整 `electromagnetism` 的 `Unlocks`，移除已提前解锁的建筑，补充进阶建筑

2. **修改默认配置**：编辑 `server/config-dev.yaml`
   - 为 p1、p2 添加 `bootstrap` 段，预置 `electromagnetic_matrix x20`

3. **运行测试**：`cd server && go test ./...`
   - 修复因科技树变更导致的测试失败

4. **端到端验证**：
   - 启动默认新局
   - 按 4.4 节流程验证开局闭环
   - 确认 `electromagnetism` 能通过真实玩法完成

5. **更新文档**：
   - `docs/player/玩法指南.md`
   - `docs/player/上手与验证.md`
   - `docs/player/已知问题与回归.md`

---

## 7. 验收标准（对应任务要求）

| # | 标准 | 如何验证 |
|---|------|----------|
| 1 | 使用默认 `config-dev.yaml + map.yaml` 启动全新隔离存档 | 删除 data 目录后重新启动 |
| 2 | 玩家 p1 只通过公开命令能合法进入第一段科研闭环 | 按 4.4 节流程操作 |
| 3 | `electromagnetism` 能在默认新局中通过真实玩法完成 | 研究完成后 `summary` 显示 `electromagnetism` 在 `completed_techs` 中 |
| 4 | 前期供电/采矿/科研/工业化步骤能按修正后的玩家指南真实复现 | 按更新后的玩法指南逐步验证 |
| 5 | midgame 链路不回退 | 启动 midgame 场景，验证 `switch_active_planet`、`orbital_collector`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 均正常 |
