# T092 默认新局科研起点闭环修复实施计划

## 目标

按 `docs/process/design_final.md` 实现默认新局科研闭环修复，使 brand-new `config-dev.yaml + map.yaml` 新局可以：

- 直接合法建出第一台 `matrix_lab`
- 利用基地供电把研究站跑起来
- 用默认启动包中的 `electromagnetic_matrix x50` 依次完成前期 5 门关键科技
- 继续推进到第一条可自给的电磁矩阵产线入口

同时清理 `docs/process/task/` 中本次已完成的任务文件。

## 变更边界

### 服务端实现

- `/home/firesuiry/develop/siliconWorld/server/internal/model/tech.go`
  - 把 `matrix_lab` 建筑解锁前移到 `dyson_sphere_program`
  - 从 `electromagnetic_matrix` 移除 `matrix_lab` 建筑解锁
  - 把 `special: electromagnetic_matrix` 归属收敛到 `electromagnetic_matrix`
- `/home/firesuiry/develop/siliconWorld/server/config-dev.yaml`
  - 为 `p1`、`p2` 添加 bootstrap，显式写回 `minerals: 200`、`energy: 100`
  - 预置 `electromagnetic_matrix: 50`

### 测试

- `/home/firesuiry/develop/siliconWorld/server/internal/model/tech_alignment_test.go`
  - 校验 `dyson_sphere_program -> matrix_lab`
  - 校验 `electromagnetism` 仍解锁 `wind_turbine` / `power_pylon` / `mining_machine`
  - 校验 `electromagnetic_matrix` 不再解锁 `matrix_lab`，但保留 `special: electromagnetic_matrix`
- `/home/firesuiry/develop/siliconWorld/server/internal/startup/game_test.go`
  - 增加对默认 `config-dev.yaml` bootstrap 的真实加载断言
- `/home/firesuiry/develop/siliconWorld/server/internal/gamecore/`
  - 新增或扩展闭环测试，覆盖：
    - 默认新局玩家可直接获得 `matrix_lab` 建造权限
    - 第一台 `matrix_lab` 依靠基地供电可进入 `running`
    - `electromagnetism` 能在真实矩阵消耗规则下完成
    - 完成前期 5 门关键科技后，第一条矩阵产线必要建筑均已合法可建

### 文档

- `/home/firesuiry/develop/siliconWorld/docs/dev/服务端API.md`
  - 更新普通新局默认 bootstrap 行为
  - 更新 `matrix_lab` 科技入口说明
- `/home/firesuiry/develop/siliconWorld/docs/player/玩法指南.md`
  - 更新默认新局初始物资与科研入口说明

### 任务清理

- 删除 `/home/firesuiry/develop/siliconWorld/docs/process/task/T092_默认新局科研起点锁死.md`

## 执行顺序

1. 先写并运行失败测试，确认当前实现仍不满足 T092。
2. 只修改科技树与 `config-dev.yaml`，不改研究/建造通用规则。
3. 让测试转绿，并补文档同步。
4. 删除已完成任务文件。
5. 运行目标测试与必要回归测试，记录实际输出作为完成依据。
