# T102 Default Newgame Doc Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让默认新局玩家文档、服务端 API 文档与仍对外可见的历史摘要全部回到当前真实实现口径，并清理 `docs/process/task` 中已完成的 T102 任务文件。

**Architecture:** 以 `server/internal/model/tech.go`、`config/defs/buildings/combat/battlefield_analysis_base.yaml`、`server/config-dev.yaml` 与 T092 回归测试为唯一权威来源，只做文档收口，不改服务端、CLI、Web 行为。实现按“先取真、再改文档、最后做检索+回归+真实重放验证”的顺序执行。

**Tech Stack:** Markdown, ripgrep, Go test, client-cli, server

---

### Task 1: 固化权威事实并锁定失败基线

**Files:**
- Modify: `docs/superpowers/plans/2026-04-05-t102-default-newgame-doc-sync.md`
- Verify: `server/internal/model/tech.go`
- Verify: `config/defs/buildings/combat/battlefield_analysis_base.yaml`
- Verify: `server/config-dev.yaml`
- Verify: `server/internal/model/t092_default_newgame_test.go`
- Verify: `server/internal/gamecore/t092_default_newgame_test.go`

- [ ] **Step 1: 读取权威实现来源**

```bash
cd /home/firesuiry/develop/siliconWorld
sed -n '220,245p' server/internal/model/tech.go
sed -n '1740,1770p' server/internal/model/tech.go
sed -n '1,80p' config/defs/buildings/combat/battlefield_analysis_base.yaml
sed -n '1,80p' server/config-dev.yaml
sed -n '1,120p' server/internal/model/t092_default_newgame_test.go
sed -n '1,200p' server/internal/gamecore/t092_default_newgame_test.go
```

Expected: 能直接看到 `dyson_sphere_program -> matrix_lab + wind_turbine`、`electromagnetism -> power_pylon(alias tesla_tower) + mining_machine`、基地 `generation_mw = 0`、以及 T092 闭环测试。

- [ ] **Step 2: 跑文本检索，确认当前文档仍然失败**

```bash
cd /home/firesuiry/develop/siliconWorld
rg -n "基地自带发电|electromagnetism.*wind_turbine|wind_turbine.*electromagnetism|先把第一台空 .*matrix_lab|先在基地旁边建一台空 .*matrix_lab|解锁 .*wind_turbine" \
  docs/player docs/dev docs/process/finished_task
```

Expected: 命中 `docs/player/玩法指南.md`、`docs/player/已知问题与回归.md`、`docs/process/finished_task/T095_*.md`、`docs/process/finished_task/T099_*.md`、`docs/process/finished_task/T100_*.md` 的旧口径。

### Task 2: 按设计修正文档与完成任务文件

**Files:**
- Modify: `docs/player/玩法指南.md`
- Modify: `docs/player/上手与验证.md`
- Modify: `docs/player/已知问题与回归.md`
- Modify: `docs/dev/服务端API.md`
- Modify: `docs/process/finished_task/T095_戴森接收站power模式失效与缺电状态误判.md`
- Modify: `docs/process/finished_task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
- Modify: `docs/process/finished_task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
- Create: `docs/process/finished_task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md`
- Delete: `docs/process/task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md`

- [ ] **Step 1: 修正主文档中的默认新局入口**

```text
docs/player/玩法指南.md
- dyson_sphere_program 改成直接提供 matrix_lab + wind_turbine
- 删除“基地自带发电 5”
- 将入口顺序改成“先风机、再研究站、再装矩阵、再开 electromagnetism”

docs/player/上手与验证.md
- 最小可玩路径加入 build wind_turbine
- 标注示例坐标为“当前默认图可复现实例”
- 用 <matrix_lab_id> 占位，不写死临时建筑 ID

docs/dev/服务端API.md
- 普通新局默认入口写清 dyson_sphere_program 同时解锁 matrix_lab + wind_turbine
- 明确基地本身不发电，第一步应先补风机
- /catalog.techs 示例改成 dyson_sphere_program -> matrix_lab + wind_turbine；electromagnetism -> tesla_tower + mining_machine
```

- [ ] **Step 2: 修正历史摘要中的误导语句**

```text
docs/player/已知问题与回归.md
- 保留时间线
- 把“electromagnetism 解锁 wind_turbine”全部改成当前口径，并注明 wind_turbine 由 dyson_sphere_program 预先提供
- 把“matrix_lab 可直接作为第一阶段研究站”改成“先风机后研究站”的当前口径

docs/process/finished_task/T095_*.md
docs/process/finished_task/T099_*.md
docs/process/finished_task/T100_*.md
- 只改默认新局入口相关句子
- 不重写任务本身的历史问题和结论
```

- [ ] **Step 3: 收口完成任务文件**

```text
docs/process/finished_task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md
- 记录背景、实现取真来源、文档修正范围、验证命令与完成结论

docs/process/task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md
- 从 task 目录移除
```

### Task 3: 验证文档与实现一致，并重放默认新局

**Files:**
- Verify: `docs/player/玩法指南.md`
- Verify: `docs/player/上手与验证.md`
- Verify: `docs/player/已知问题与回归.md`
- Verify: `docs/dev/服务端API.md`
- Verify: `docs/process/finished_task/T095_戴森接收站power模式失效与缺电状态误判.md`
- Verify: `docs/process/finished_task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
- Verify: `docs/process/finished_task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
- Verify: `docs/process/finished_task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md`

- [ ] **Step 1: 重新跑文本检索，确认旧口径被清理**

```bash
cd /home/firesuiry/develop/siliconWorld
rg -n "基地自带发电|electromagnetism.*wind_turbine|wind_turbine.*electromagnetism|先把第一台空 .*matrix_lab|先在基地旁边建一台空 .*matrix_lab|解锁 .*wind_turbine" \
  docs/player docs/dev docs/process/finished_task
```

Expected: 不再命中主文档中的过时口径；历史摘要若仍含旧说法，必须带“旧结论/已更新”语境。

- [ ] **Step 2: 跑 T092 回归测试**

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/gamecore -run T092
```

Expected: `ok  	siliconworld/internal/model` 与 `ok  	siliconworld/internal/gamecore`。

- [ ] **Step 3: 真实重放 brand-new 默认新局最小链路**

```bash
cd /home/firesuiry/develop/siliconWorld/server
TMPDIR=$(mktemp -d /tmp/sw-t102-XXXXXX)
SERVER_LOG="$TMPDIR/server.log"
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-dev.yaml -map-config map.yaml \
  >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
sleep 3
AUTH='Authorization: Bearer key_player_1'
curl -sf -H "$AUTH" http://127.0.0.1:18080/state/summary
curl -sf -H "$AUTH" -X POST http://127.0.0.1:18080/commands -d '{"type":"build","target":{"position":{"x":3,"y":2}},"payload":{"building_type":"wind_turbine"}}'
curl -sf -H "$AUTH" -X POST http://127.0.0.1:18080/commands -d '{"type":"build","target":{"position":{"x":2,"y":3}},"payload":{"building_type":"matrix_lab"}}'
curl -sf -H "$AUTH" -X POST http://127.0.0.1:18080/commands -d '{"type":"start_research","payload":{"tech_id":"electromagnetism"}}'
curl -sf -H "$AUTH" http://127.0.0.1:18080/state/summary
kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
```

Expected: 能拿到 summary；未装矩阵时 `start_research electromagnetism` 被拒绝；后续实际执行中再补装 `10` 个 `electromagnetic_matrix` 能完成研究并解锁 `tesla_tower`、`mining_machine`。
