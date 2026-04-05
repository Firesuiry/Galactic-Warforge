# T103 Default Newgame Mining Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/process/design_final.md` 收口默认新局第一条“保留首台研究站 + 首台矿机 running”的采矿闭环。

**Architecture:** 行为改动只落在 `server/config-dev.yaml` 的默认启动包矿物数值；服务端通过 `startup` 层断言真实默认配置，并在 `gamecore` 层新增独立 T103 回归，把“风机 -> 研究站 -> 电磁学 -> 电塔 -> 矿机 -> 统计产出启动”锁成稳定闭环。文档只同步默认新局数值与公开路线，不改规则语义。

**Tech Stack:** Go server, YAML config, Markdown docs, Go test

---

### Task 1: 锁住默认新局启动包数值

**Files:**
- Modify: `server/internal/startup/t092_config_dev_test.go`
- Modify: `server/config-dev.yaml`

- [ ] **Step 1: 先写失败测试**

```go
if player.Resources.Minerals != 240 || player.Resources.Energy != 100 {
    t.Fatalf("unexpected bootstrap resources for %s: %+v", playerID, player.Resources)
}
```

- [ ] **Step 2: 运行单测确认当前 `minerals = 200` 失败**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/startup -run TestT092ConfigDevBootstrapProvidesFreshResearchMatrices -count=1`
Expected: FAIL，提示默认启动包矿物仍是 `200`

- [ ] **Step 3: 修改真实默认配置**

```yaml
bootstrap:
  minerals: 240
  energy: 100
```

- [ ] **Step 4: 重新运行启动包测试**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/startup -run TestT092ConfigDevBootstrapProvidesFreshResearchMatrices -count=1`
Expected: PASS

### Task 2: 新增独立 T103 默认新局采矿闭环回归

**Files:**
- Create: `server/internal/gamecore/t103_default_newgame_mining_loop_test.go`
- Test: `server/internal/gamecore/t103_default_newgame_mining_loop_test.go`

- [ ] **Step 1: 先写失败测试**

```go
func TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome(t *testing.T) {
    core := newConfigDevTestCore(t)
    ws := core.World()

    // build wind_turbine -> matrix_lab -> transfer -> start_research electromagnetism
    // then find a reachable ore tile plus tesla_tower relay position
    // build tesla_tower -> mining_machine
    // process ticks and assert:
    // 1. first matrix_lab still exists
    // 2. lab remains research-oriented
    // 3. mining_machine exists and runtime.state == running
    // 4. runtime.state_reason != power_out_of_range
    // 5. player stats / miner storage shows ore output started
}
```

- [ ] **Step 2: 运行单测确认在旧启动包下失败**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome -count=1`
Expected: FAIL，表现为矿物不足或矿机无法进入 `running`

- [ ] **Step 3: 用最小 helper 实现稳定回归**

```go
func findReachableStarterMiningRoute(ws *model.WorldState, source model.Position) (tower model.Position, mine model.Position, ok bool) {
    // 遍历真实资源点，筛出可建 mining_machine 的矿点；
    // 再找一个未占用、非资源格的 buildable tile，使其同时位于
    // wind_turbine / mining_machine 的供电连通范围内。
}
```

- [ ] **Step 4: 运行 T092/T103 相关 gamecore 测试直到通过**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/gamecore -run 'TestT092FreshNewGameCanReachEarlyResearchClosure|TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome' -count=1`
Expected: PASS

### Task 3: 同步默认新局文档口径

**Files:**
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/上手与验证.md`
- Modify: `docs/player/已知问题与回归.md`
- Modify: `docs/dev/服务端API.md`

- [ ] **Step 1: 更新默认新局启动包数值与公开路线**

```md
- `minerals = 240`
- `build 3 2 wind_turbine`
- `build 2 3 matrix_lab`
- `transfer <matrix_lab_id> electromagnetic_matrix 10`
- `start_research electromagnetism`
- `build 4 2 tesla_tower`
- `build 5 1 mining_machine`
```

- [ ] **Step 2: 在回归记录里保留历史问题并标注已由 T103 修复**

```md
- 历史问题发生时默认新局 `minerals = 200`
- 现已通过 T103 上调到 `240` 修复
- 修法是 starter minerals 上调，不是拆研究站 workaround
```

- [ ] **Step 3: 自查文档不再残留旧数值**

Run: `cd /home/firesuiry/develop/siliconWorld && rg -n 'minerals = 200|minerals: 200' docs/player docs/dev server/config-dev.yaml`
Expected: 仅剩历史问题描述中的已修复时间线，默认新局现状全部改为 `240`

### Task 4: 验证、真实回放与清理

**Files:**
- Delete: `docs/process/task/T103_默认新局首条采矿闭环仍需拆研究站绕行.md`

- [ ] **Step 1: 跑服务端自动化回归**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/startup ./internal/gamecore`
Expected: PASS

- [ ] **Step 2: 做一次默认新局真实回放**

Run: `cd /home/firesuiry/develop/siliconWorld/server && env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/startup ./internal/gamecore -run 'TestT092ConfigDevBootstrapProvidesFreshResearchMatrices|TestT103DefaultNewGameCanKeepFirstLabAndStartFirstMiningIncome' -count=1`
Expected: PASS，且 T103 断言显示首台研究站保留、矿机 `running`、产出开始增长

- [ ] **Step 3: 删除已完成任务文件并复查最终 diff**

Run: `cd /home/firesuiry/develop/siliconWorld && git diff -- server/config-dev.yaml server/internal/startup/t092_config_dev_test.go server/internal/gamecore/t103_default_newgame_mining_loop_test.go docs/player/玩法指南.md docs/player/上手与验证.md docs/player/已知问题与回归.md docs/dev/服务端API.md docs/process/task`
Expected: diff 只包含 T103 范围改动与任务文件删除
