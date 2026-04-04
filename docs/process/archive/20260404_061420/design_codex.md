# T092 设计方案：默认新局科研起点闭环修复

## 1. 范围

- 当前 `docs/process/task` 下唯一待处理任务是 `T092_默认新局科研起点锁死.md`。
- 本文只设计这个任务，不扩展到新的玩法系统或新的公共命令。

## 2. 现状与证据

### 2.1 运行时现象

在一份全新的 `config-dev.yaml + map.yaml` 默认新局中，实测可稳定复现下面三条失败链路：

1. `start_research electromagnetism`
   - 审计结果：`VALIDATION_FAILED: at least one running research lab is required`
2. `build ... matrix_lab`
   - 审计结果：`VALIDATION_FAILED: building type matrix_lab requires research to unlock`
3. `build ... wind_turbine`
   - 审计结果：`VALIDATION_FAILED: building type wind_turbine requires research to unlock`

同时：

- `/state/summary` 中默认玩家只有 `dyson_sphere_program`
- `/catalog` 中：
  - `dyson_sphere_program` 当前只解锁 `special: electromagnetic_matrix`
  - `electromagnetism` 解锁 `wind_turbine`、`tesla_tower`、`mining_machine`
  - `electromagnetic_matrix` 解锁 `matrix_lab`

### 2.2 代码层事实

1. `server/internal/gamecore/rules.go`
   - `build` 会先走 `CanBuildTech(..., TechUnlockBuilding, building_type)` 做建筑门禁。
2. `server/internal/gamecore/research.go`
   - `start_research` 强制要求至少一台 `running` 且空 `recipe_id` 的研究站。
3. `server/internal/model/building_runtime.go`
   - `battlefield_analysis_base` 自带 `EnergyGenerate = 5`
   - `matrix_lab` 只消耗 `4` 电
   - 这意味着：只要研究站贴着基地摆，基地供电本身就足够让第一台研究站进入 `running`
4. `server/internal/config/config.go` + `server/internal/gamecore/core.go`
   - 当前 bootstrap 只支持：
     - `minerals`
     - `energy`
     - `inventory`
     - `completed_techs`
   - 不支持预置建筑
   - 并且一旦配置了 `bootstrap.inventory`，就会同时覆盖玩家资源；因此若要给启动物资，必须显式把 `minerals` 和 `energy` 也写回默认值
5. 当前公开物品转移只有 `transfer_item`
   - 方向是“玩家库存 -> 建筑本地存储”
   - 没有“建筑本地存储 -> 玩家库存”的通用公开命令

## 3. 根因分析

这个问题不是单一死锁，而是两层闭环一起断掉。

### 3.1 第一层死锁：第一门科技根本无法启动

当前链条是：

- 要研究 `electromagnetism`，必须先有 `running` 研究站
- 要有研究站，必须先能建 `matrix_lab`
- 要建 `matrix_lab`，当前又要求先完成 `electromagnetic_matrix`
- `electromagnetic_matrix` 的前置却是 `electromagnetism`

这是最直接的硬循环。

### 3.2 第二层死锁：即使第一门科技勉强开了，后续矩阵仍然会断粮

修完第一层后，还必须继续考虑“玩家怎么拿到后续电磁矩阵”。

原因是：

- `basic_logistics_system`
- `automatic_metallurgy`
- `basic_assembling_processes`
- `electromagnetic_matrix`

这几门早期关键科技本身也都继续消耗 `electromagnetic_matrix`。

而玩家想要自己生产新的 `electromagnetic_matrix`，至少需要先具备：

- 物流：把不同建筑的产物串起来
- 冶炼：把矿物转成基础材料
- 组装：做出 `circuit_board`
- 矩阵生产建筑：把 `circuit_board + energetic_graphite` 变成 `electromagnetic_matrix`

在当前实现里：

- 矿机采出的是建筑本地物品
- 生产建筑产出也落在建筑本地存储
- 又没有通用“从建筑取回玩家背包”的公开命令

所以在真正拿到 `basic_logistics_system` 之前，玩家无法只靠手工转移把整条矩阵产线拼出来。

结论：

- 启动包不能只覆盖 `electromagnetism`
- 必须覆盖“从第一门研究到第一条可自给矩阵产线”之间的整段真空期

## 4. 设计目标

1. brand-new `config-dev.yaml + map.yaml` 新局里，玩家只靠公开命令就能合法完成 `electromagnetism`
2. 修复后不能在 `research.go` 里加“首门科技特判”
3. 保持“研究站必须运行 + 真实矩阵真实消耗”的研究模型
4. 默认新局不仅能开第一门研究，还要能继续走到“第一条自给电磁矩阵产线可建”的阶段
5. `electromagnetism` 继续承担早期供电/采矿入口，不把整套前期建筑一股脑前移到 0 级
6. 官方 midgame 场景不回退
7. 文档口径统一，不再同时存在“fresh save 从零开荒”和“实际得去已解锁研究站场景验证”两套说法

## 5. 非目标

- 不新增隐藏命令
- 不新增“建筑预置 bootstrap”系统
- 不新增通用“建筑 -> 玩家库存”取回命令
- 不修改 midgame 配置的玩法定位
- 不做旧存档自动迁移

## 6. 方案比较

### 方案 A：最小而完整的模型层修复（推荐）

做三件事：

1. 把 `matrix_lab` 建筑解锁前移到 `dyson_sphere_program`
2. 把 `electromagnetic_matrix` 这类“矩阵配方语义解锁”留在 `electromagnetic_matrix` 科技本身，不再挂在 `dyson_sphere_program`
3. 在 `config-dev.yaml` 给每个默认玩家补一份覆盖前期真空段的 `electromagnetic_matrix` 启动包

优点：

- 不改运行时规则，只改模型和默认配置
- 不引入任何首门科技特判
- `electromagnetism` 仍然是“供电 + 电网延伸 + 采矿入口”
- `electromagnetic_matrix` 这门科技仍然保有明确语义，不会变成空壳
- 与“尽量简单直接、低耦合”的架构规则一致

缺点：

- 默认新局不再是“完全空手”，而是“带官方启动矩阵包开局”

### 方案 B：把风机/电塔/矿机/研究站都前移到 0 级，再补少量矩阵

优点：

- 第一眼最直观
- 不需要依赖“基地本身已能供电”的事实

缺点：

- 改动面更大
- `electromagnetism` 的价值会被削弱
- 实际上当前基地已经能给第一台研究站供电，这么做是多发建筑解锁，不是必要修复

### 方案 C：在 `research.go` 或 `build` 里给首门科技写例外规则

例如：

- `electromagnetism` 无需研究站
- 或允许 `matrix_lab` 免科技首造一次
- 或第一次研究不消耗矩阵

不推荐原因：

- 把默认新局问题塞进通用运行时逻辑
- 规则变得难解释
- 以后所有配置和场景都要背这层特殊分支
- 明显提高耦合

## 7. 最终方案

采用方案 A。

### 7.1 科技树调整

目标是只打通“默认新局科研入口”，不改研究系统。

#### 7.1.1 `dyson_sphere_program`

调整为：

- 解锁 `building: matrix_lab`
- 不再负责 `special: electromagnetic_matrix`

原因：

- 默认新局真正缺的是“第一台研究站的公开建造权限”
- 基地本身已有 5 点发电，足够支撑一台贴基地的研究站
- 0 级科技给出研究站是最小必要变更

#### 7.1.2 `electromagnetism`

保持它继续解锁：

- `wind_turbine`
- `tesla_tower`
- `mining_machine`

说明：

- 当前 `power_pylon` 已在 tech alias 归一化后映射成 `tesla_tower`
- 这部分不需要再前移
- 修复后，`electromagnetism` 依然是“正式进入前期工业化”的第一门关键科技

#### 7.1.3 `electromagnetic_matrix`

调整为：

- 不再解锁 `matrix_lab`
- 保留 `special: electromagnetic_matrix`

原因：

- 研究站入口已经前移，不应重复承担同一建筑解锁
- 这门科技应该回到“官方语义上的电磁矩阵可用”这一职责
- 即便当前实现对 recipe/special 的实际门禁还有历史遗留不完全对齐，这个调整也能先把科技树语义摆正，为后续收口留出清晰边界

### 7.2 默认新局启动包

`server/config-dev.yaml` 中给 `p1` / `p2` 都补上：

- `bootstrap.minerals: 200`
- `bootstrap.energy: 100`
- `bootstrap.inventory`
  - `electromagnetic_matrix: 50`

这里必须显式写回 `200 / 100`，因为当前 `applyPlayerBootstrap` 的行为是“只要 bootstrap 生效，就整组覆盖资源值”。

#### 7.2.1 为什么是 50，而不是 10 或 20

默认新局要从“能研究第一门”真正走到“能自给后续矩阵”，至少要覆盖这几门科技：

1. `electromagnetism`：10
2. `basic_logistics_system`：10
3. `automatic_metallurgy`：10
4. `basic_assembling_processes`：10
5. `electromagnetic_matrix`：10

合计正好 `50`。

这样启动包只承担一个职责：

- 帮玩家跨过“前期还没有物流/冶炼/组装/矩阵产线”的真空段

等这 5 门科技完成后，玩家就应该转入真实产线自给。

这比“只送 10/20 个矩阵，再把断点挪到第二层科技”更完整，也更符合任务要求里的“科研 / 工业化步骤能真实复现”。

### 7.3 修复后的早期闭环

推荐的真实开局路线应收敛为：

1. 新开默认新局，玩家初始拥有：
   - `dyson_sphere_program`
   - `electromagnetic_matrix x50`
   - 基地 + 执行体
2. 在基地附近建一台空 `recipe_id` 的 `matrix_lab`
3. 依靠基地自带发电，让它进入 `running`
4. 往该研究站转入 `10` 个 `electromagnetic_matrix`
5. 开始研究 `electromagnetism`
6. 研究完成后，解锁：
   - `wind_turbine`
   - `tesla_tower`
   - `mining_machine`
7. 开始铺第一段真实基础设施：
   - 供电
   - 拉电
   - 上矿机
8. 用剩余启动矩阵继续完成：
   - `basic_logistics_system`
   - `automatic_metallurgy`
   - `basic_assembling_processes`
   - `electromagnetic_matrix`
9. 建第一批前期建筑：
   - `conveyor_belt_mk1`
   - `sorter_mk1`
   - `arc_smelter`
   - `assembling_machine_mk1`
   - 第二台 `matrix_lab --recipe electromagnetic_matrix`
10. 保留第一台空 lab 做研究，第二台 lab 做矩阵生产，之后转入真实自给

### 7.4 为什么不需要把风机提前到 0 级

因为当前默认基地已经满足：

- 自身可发电
- 自身有电力连接点
- 研究站只需 4 电

所以第一台研究站贴基地摆放即可。

也就是说：

- 第一门研究真正缺的是“研究站建造权限 + 启动矩阵”
- 不是“完全没有电力入口”

### 7.5 为什么不做预置建筑

当前 bootstrap 不支持预置建筑。

如果为了 T092 去新增“启动建筑模板/坐标放置”这套能力，会把问题从“默认科技入口”放大成“新一套开局生成机制”，性价比太低，耦合也更高。

## 8. 需要改动的文件

### 8.1 服务端

- `server/internal/model/tech.go`
  - 调整 `dyson_sphere_program`
  - 调整 `electromagnetic_matrix`
- `server/config-dev.yaml`
  - 给默认玩家加入 `bootstrap` 启动包

### 8.2 测试

建议新增或调整：

- `server/internal/model/tech_alignment_test.go`
  - 断言 `dyson_sphere_program` 解锁 `matrix_lab`
  - 断言 `electromagnetism` 仍解锁 `wind_turbine` / `tesla_tower` / `mining_machine`
  - 断言 `electromagnetic_matrix` 不再解锁 `matrix_lab`
- `server/internal/startup/game_test.go`
  - 断言 bootstrap inventory 正确落到默认玩家
  - 断言 bootstrap 资源值仍是 `200 / 100`
- `server/internal/gamecore/` 下新增 T092 端到端测试
  - 构造默认新局等价开局
  - 建第一台研究站并确认进入 `running`
  - 顺序完成上述 5 门科技
  - 至少验证以下建筑解锁后可合法下建造命令：
    - `wind_turbine`
    - `conveyor_belt_mk1`
    - `arc_smelter`
    - `assembling_machine_mk1`
    - `matrix_lab --recipe electromagnetic_matrix`

## 9. 验证方案

### 9.1 自动化验证

服务端测试至少应覆盖：

1. 科技树门禁变更正确
2. 默认 bootstrap 资源和库存正确
3. brand-new 开局下，`electromagnetism` 能合法完成
4. 修复后 early tech 串联到“可建前期矩阵产线”不再断档
5. 原有 midgame 相关测试继续通过

### 9.2 手工验证

手工验收建议按这个顺序走：

1. 清空或更换 `server.data_dir`
2. 用默认 `config-dev.yaml + map.yaml` 启动
3. 登录 `p1`
4. `summary` 确认：
   - `completed_techs` 只有 `dyson_sphere_program`
   - 背包里已有启动矩阵
5. 在基地附近建空 `matrix_lab`
6. `transfer` 10 个 `electromagnetic_matrix` 进研究站
7. `start_research electromagnetism`
8. 等待研究完成
9. 继续完成：
   - `basic_logistics_system`
   - `automatic_metallurgy`
   - `basic_assembling_processes`
   - `electromagnetic_matrix`
10. 建出熔炉、组装机、生产型矩阵站，确认默认新局已不再需要“去 midgame 场景借研究站”

### 9.3 回归项

至少回归：

- 官方 `config-midgame.yaml + map-midgame.yaml`
- `switch_active_planet`
- `orbital_collector`
- `launch_solar_sail`
- `launch_rocket`
- `set_ray_receiver_mode`

## 10. 文档同步要求

### 10.1 必改

- `docs/player/玩法指南.md`
  - 明确默认新局带官方启动矩阵包
  - 更新最实用新手流程
  - 删除“必须在已解锁研究站场景里开第一门研究”的表述
- `docs/player/上手与验证.md`
  - 把默认新局最小可玩路径改成真实 fresh-save 路线

### 10.2 视实际改动同步

- `docs/dev/服务端API.md`
  - 如果文档里写到了默认配置的初始资源/科技/示例流程，需要同步改成新口径
- `docs/dev/客户端CLI.md`
  - 命令语义本身不变，但示例验证流程若仍引用“去已解锁研究站场景”，也应一并改掉

## 11. 兼容性与风险

### 11.1 旧存档不会自动修好

当前存档恢复会优先吃保存下来的 gameplay config。

因此：

- 改 `config-dev.yaml` 只会影响新开的局
- 已经生成的旧 `data_dir` 不会自动拿到启动矩阵包

这与任务验收标准一致，因为任务要求本来就是 brand-new save。

### 11.2 启动矩阵会加快前期节奏

这是刻意设计，不是副作用。

因为默认新局目前缺的不是“玩家不够熟练”，而是“前期矩阵经济尚未能自然起步”。

只要：

- 启动包数量刚好覆盖到第一条自给矩阵产线
- 后续仍要靠真实生产继续滚科技

它就是一段正式规则，不是临时补丁。

### 11.3 当前配方门禁仍有历史遗留

当前配方系统的 `recipe.TechUnlock` 与实际公开 tech 门禁并未完全一一对应。

T092 不应顺手扩展成“重写全部 recipe 门禁系统”的大任务。

但本方案会先把科技树语义摆正：

- `matrix_lab` 属于 0 级起步入口
- `electromagnetic_matrix` 属于其同名科技

这能让后续若要继续收口配方门禁时，边界更清晰。

## 12. 最终结论

T092 的最优解不是在 `research.go` 里给第一门科技开后门，而是：

1. 把第一台研究站的建造权限前移到 `dyson_sphere_program`
2. 用默认配置显式发放一段有限的官方启动矩阵包
3. 保持 `electromagnetism` 继续承担早期供电与采矿解锁
4. 让默认新局在公开玩法下自然走到第一条自给矩阵产线

这样修完以后，普通新局与玩家指南才能重新说同一套话。
