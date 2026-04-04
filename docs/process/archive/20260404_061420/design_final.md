# T092 最终设计方案：默认新局科研起点闭环修复

## 1. 文档目标

本文综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，输出 T092 的单一定稿方案。目标不是保留两份草案的并列意见，而是给出一份可直接进入实现阶段的最终实现方案。

本轮只解决一个问题：让 brand-new 的 `config-dev.yaml + map.yaml` 默认新局，能够通过公开玩法合法进入第一段科研闭环，并继续推进到“第一条可自给的电磁矩阵产线”。

最终方案遵循仓库的“激进式演进”原则：

- 不在 `research.go` 或 `build` 里增加“首门科技特判”。
- 不用兼容层掩盖科技树设计错误，直接改正科技树与默认配置。
- 不保留“文档声称 fresh save 可玩，但实际必须借 midgame 场景验证”的双重口径。

## 2. 基于当前代码的事实判断

### 2.1 当前真实断点不是“没风机”，而是“没有第一台研究站权限”

当前代码里：

- `build` 会通过 `CanBuildTech(..., TechUnlockBuilding, building_type)` 做建筑门禁。
- `matrix_lab` 当前由 `electromagnetic_matrix` 解锁。
- `electromagnetic_matrix` 的前置又是 `electromagnetism`。
- `start_research` 又强制要求至少一台 `running` 的研究站。

这构成了硬循环：

1. 要研究 `electromagnetism`，先要有 `running` 研究站。
2. 要有研究站，先要能建 `matrix_lab`。
3. 要建 `matrix_lab`，又得先完成 `electromagnetic_matrix`。
4. `electromagnetic_matrix` 的前置却是 `electromagnetism`。

### 2.2 第一门研究并不需要把风机、电塔、矿机全部前移到 0 级

当前 runtime 已确认：

- `battlefield_analysis_base` 自带 `EnergyGenerate = 5`
- `matrix_lab` 只消耗 `EnergyConsume = 4`

这意味着只要第一台研究站贴着基地摆放，基地本身供电就足以让它进入 `running`。因此，要打通第一门研究，最小必要变更是给出 `matrix_lab` 的建造权限，而不是把 `wind_turbine`、`tesla_tower`、`mining_machine` 整批前移到 0 级。

### 2.3 启动包不能只送 10 或 20 个矩阵

当前默认玩法还存在一个更深的真空段：

- bootstrap 只支持 `minerals / energy / inventory / completed_techs`
- 不支持预置建筑
- 公开转移命令只有“玩家库存 -> 建筑库存”
- 没有通用“建筑库存 -> 玩家库存”的公开路径

这意味着玩家在拿到完整前期工业组件之前，无法靠手工搬运拼出稳定的电磁矩阵产线。真正需要跨过的不是一门科技，而是一整段前期研究真空期：

1. `electromagnetism`：10
2. `basic_logistics_system`：10
3. `automatic_metallurgy`：10
4. `basic_assembling_processes`：10
5. `electromagnetic_matrix`：10

合计正好 `50` 个 `electromagnetic_matrix`。

因此，`20` 只能解决“第一门能不能点开”，不能解决“默认新局能不能自然走到第一条自给矩阵产线”。T092 的验收要求是后者。

### 2.4 `electromagnetism` 现有早期开局职责应保留

当前 `electromagnetism` 解锁：

- `wind_turbine`
- `power_pylon`
- `mining_machine`

其中 `power_pylon` 已通过 tech alias 归一化到 `tesla_tower`，不是无效引用。因此不需要为了 T092 再去重做这组早期解锁映射。

结论：`electromagnetism` 继续承担“前期供电 + 拉电 + 采矿入口”的职责更合理，不应为了修复默认新局入口，把它的价值整体挪空。

## 3. 方案对比与最终取舍

### 3.1 不采用的路线

**路线 A：把风机、电塔、矿机、研究站都前移到 `dyson_sphere_program`，再补少量矩阵**

- 优点是表面直观。
- 但会明显削弱 `electromagnetism` 的定位。
- 其中风机、电塔、矿机前移并不是修复第一门研究所必需的改动。

结论：不采用。

**路线 B：只补 `matrix_lab` 入口，再送 `10` 或 `20` 个矩阵**

- 可以让第一门研究启动。
- 但研究完 `electromagnetism` 后，仍然会在后续早期科技链上重新断档。
- 这不满足“默认新局可一路推进到第一条自给矩阵产线”的目标。

结论：不采用。

**路线 C：在运行时规则里写首门科技例外**

例如：

- 首门研究不需要研究站
- `matrix_lab` 首造免科技
- 首门研究不消耗矩阵

这类方案都会把默认新局问题污染进通用运行时逻辑，增加耦合，也违背仓库的设计哲学。

结论：不采用。

### 3.2 最终采用的路线

采用“最小科技树修复 + 覆盖前期真空段的官方启动包”：

1. 只把 `matrix_lab` 建筑解锁前移到 `dyson_sphere_program`
2. 保留 `electromagnetism` 继续解锁风机 / 电塔 / 矿机
3. 将默认新局启动包扩到 `electromagnetic_matrix x50`
4. 把 `electromagnetic_matrix` 科技的职责收敛为“矩阵产线语义解锁”，不再重复承担研究站建造权限

这是两份草案中最小、最稳、也最符合任务验收边界的交集。

## 4. 最终方案

### 4.1 科技树调整

#### 4.1.1 `dyson_sphere_program`

调整为解锁：

- `building: matrix_lab`

不再把“第一台研究站权限”挂在 `electromagnetic_matrix` 之后。

对于当前的 `special: electromagnetic_matrix`：

- 最终方案直接将它从 `dyson_sphere_program` 移走
- 并将这类“矩阵能力语义”收敛到 `electromagnetic_matrix` 科技自身

原因：

- 研究站入口与矩阵产线语义是两件不同的事
- 当前问题的最小必要修复是前移 `matrix_lab`
- 把 `special: electromagnetic_matrix` 留在 `dyson_sphere_program` 会继续制造“0 级科技已经给了矩阵能力语义，但真正矩阵科技还在后面”的口径混乱

#### 4.1.2 `electromagnetism`

保持继续解锁：

- `wind_turbine`
- `power_pylon`（alias 到 `tesla_tower`）
- `mining_machine`

不在 T092 中削空这门科技的职责。

#### 4.1.3 `electromagnetic_matrix`

调整为：

- 不再解锁 `building: matrix_lab`
- 承接 `special: electromagnetic_matrix`

这样职责更清晰：

- `dyson_sphere_program` 负责“科研入口”
- `electromagnetism` 负责“前期工业化入口”
- `electromagnetic_matrix` 负责“电磁矩阵产线语义入口”

### 4.2 默认新局启动包

在 `server/config-dev.yaml` 中，为 `p1` / `p2` 都补齐 bootstrap：

- `minerals: 200`
- `energy: 100`
- `inventory`
  - `electromagnetic_matrix: 50`

这里必须显式写回 `200 / 100`，因为当前 `applyPlayerBootstrap` 的行为是：只要 bootstrap 生效，就直接覆盖玩家初始资源值。

### 4.3 修复后的真实开局闭环

默认新局修复后，推荐的最小真实路线应为：

1. 新开 `config-dev.yaml + map.yaml` brand-new 存档。
2. 玩家初始状态：
   - 已完成 `dyson_sphere_program`
   - 背包中已有 `electromagnetic_matrix x50`
   - 拥有基地与执行体
3. 在基地附近建第一台空 `matrix_lab`。
4. 依靠基地自带供电，让它进入 `running`。
5. 转入 `10` 个 `electromagnetic_matrix`。
6. 启动 `electromagnetism`。
7. 解锁并建出：
   - `wind_turbine`
   - `tesla_tower`
   - `mining_machine`
8. 用剩余启动矩阵继续完成：
   - `basic_logistics_system`
   - `automatic_metallurgy`
   - `basic_assembling_processes`
   - `electromagnetic_matrix`
9. 建出第一条基础矩阵产线所需设施：
   - 矿机
   - 电网
   - 物流
   - 熔炉
   - 组装机
   - 第二台 `matrix_lab`（设置 `electromagnetic_matrix` 配方）
10. 第一台空 lab 保持科研用途，第二台 lab 进入矩阵生产，之后转入真实自给。

### 4.4 为什么这是最小而完整的收口

这个方案同时满足四个条件：

1. 不修改研究系统基本规则，仍然要求 `running` 研究站和真实矩阵消耗。
2. 不把大量早期建筑无差别前移到 0 级。
3. 不在通用运行时里加入默认新局特判。
4. 不只是“修到第一门能点开”，而是一直修到“默认新局可以自然走到第一条自给矩阵产线”。

## 5. 需要改动的文件

### 5.1 服务端实现

- `server/internal/model/tech.go`
  - `dyson_sphere_program` 前移 `matrix_lab`
  - `electromagnetic_matrix` 移除 `matrix_lab` 解锁
  - 将 `special: electromagnetic_matrix` 的归属收敛到 `electromagnetic_matrix` 科技
- `server/config-dev.yaml`
  - 给默认玩家加入 `bootstrap` 启动包

### 5.2 测试

至少补或调整以下测试：

- `server/internal/model/tech_alignment_test.go`
  - 断言 `dyson_sphere_program` 解锁 `matrix_lab`
  - 断言 `electromagnetism` 仍解锁 `wind_turbine` / `power_pylon` / `mining_machine`
  - 断言 `electromagnetic_matrix` 不再解锁 `matrix_lab`
- `server/internal/startup/game_test.go`
  - 断言默认玩家 bootstrap 生效后资源仍为 `200 / 100`
  - 断言默认玩家库存含 `electromagnetic_matrix x50`
- `server/internal/gamecore/` 的闭环测试
  - 断言默认新局可建第一台研究站并进入 `running`
  - 断言 `electromagnetism` 可在真实规则下完成
  - 断言继续完成上述 5 门前期关键科技后，可以合法建出第一条矩阵产线所需建筑

## 6. 验证方案

### 6.1 自动化验证

至少覆盖：

1. 科技树门禁调整正确。
2. 默认 bootstrap 库存和资源正确。
3. brand-new 默认新局中，`electromagnetism` 可以合法完成。
4. 默认新局从第一门研究推进到第一条自给矩阵产线的科技链不再断档。
5. 现有 midgame 回归链路继续通过。

### 6.2 手工验证

按以下顺序验收：

1. 清空或更换 `server.data_dir`
2. 用默认 `config-dev.yaml + map.yaml` 启动
3. 登录 `p1`
4. `summary`
   - 确认只完成 `dyson_sphere_program`
   - 确认背包里有 `electromagnetic_matrix x50`
5. 在基地附近建空 `matrix_lab`
6. 转入 `10` 个 `electromagnetic_matrix`
7. `start_research electromagnetism`
8. 等待研究完成
9. 继续完成：
   - `basic_logistics_system`
   - `automatic_metallurgy`
   - `basic_assembling_processes`
   - `electromagnetic_matrix`
10. 建出熔炉、组装机、生产型矩阵站，确认默认新局不再需要借 midgame 场景的已解锁研究站

### 6.3 midgame 回归项

至少回归：

- `switch_active_planet`
- `orbital_collector`
- `launch_solar_sail`
- `launch_rocket`
- `set_ray_receiver_mode`

## 7. 文档同步要求

本轮实现完成后，至少同步：

- `docs/player/玩法指南.md`
  - 明确默认新局带官方启动矩阵包
  - 更新从 fresh save 到第一条矩阵产线的真实流程
- `docs/player/上手与验证.md`
  - 把默认新局验证路线改成真实 fresh-save 路线
- `docs/player/已知问题与回归.md`
  - 标记 T092 已修复并记录回归范围

如果文档中涉及默认配置、科技树示例或 CLI 验证流程，还需要同步：

- `docs/dev/服务端API.md`
- `docs/dev/客户端CLI.md`

## 8. 兼容性与风险

### 8.1 只保证新开局修复

当前保存的游戏会优先吃存档里的 gameplay config，因此：

- 改 `config-dev.yaml` 只影响 brand-new 新局
- 旧 `data_dir` 不会自动拿到 `x50` 启动矩阵包

这与 T092 的验收标准一致，因为任务本身要求的就是全新隔离存档验证。

### 8.2 前期节奏会变快，但这是正式规则的一部分

默认新局加入 `x50` 启动矩阵，不是临时补丁，而是为了跨过“矩阵产线尚未建立前的必经真空段”。

只要边界控制为：

- 只覆盖前 5 门关键科技
- 后续仍必须依赖真实产线继续推进

它就是一条明确、可文档化、可测试的正式开局规则。

## 9. 最终结论

T092 的最终实现方案应当采用：

- 只把 `matrix_lab` 建造权限前移到 `dyson_sphere_program`
- 保留 `electromagnetism` 作为风机 / 电塔 / 矿机的第一门关键科技
- 将默认新局启动包扩展为 `electromagnetic_matrix x50`
- 让默认新局直接跨过前期研究真空段，最终自然落到第一条可自给矩阵产线

这是当前代码基础上改动最小、职责最清晰、并且唯一能同时满足任务验收标准与项目架构原则的方案。
