# 2026-04-11 `docs/process/task` 未实现功能详细设计方案（Codex）

本文档只覆盖当前 `docs/process/task/` 下仍未实现的 3 项主题：

1. `docs/process/task/2026-04-11_官方midgame戴森验证场景与玩家文档严重不一致.md`
2. `docs/process/task/2026-04-11_web智能体工作台默认provider无法稳定执行真实动作.md`
3. `docs/process/task/2026-04-11_web行星页命令工作台桌面端可发现性与操作流不够优雅.md`

本方案以当前仓库真实实现为准，不以历史描述为准。重点参考了以下代码与文档：

- `server/config-midgame.yaml`
- `server/map-midgame.yaml`
- `server/internal/startup/game.go`
- `server/internal/gamecore/core.go`
- `server/internal/gamecore/runtime_registry.go`
- `server/internal/startup/t094_midgame_bootstrap_test.go`
- `agent-gateway/src/providers/index.ts`
- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/server.ts`
- `client-web/src/pages/PlanetPage.tsx`
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- `docs/dev/服务端API.md`
- `docs/dev/client-web.md`
- `docs/dev/agent-gateway.md`
- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`

## 1. 设计原则

- 以 authoritative 运行态为准，不允许继续出现“文档说有、启动后没有”的口径分叉。
- 优先收敛公共契约，不做只对 `builtin-minimax-api` 生效的专用补丁。
- 场景预置走配置驱动与权威初始化逻辑，不提交一份黑箱 save 数据来冒充“官方场景”。
- 桌面端优先暴露当前最该点击的主操作，不再把调试摘要、时间线和告警放在同一优先级。
- 自动化回归分层：
  - 服务端 / gateway 测试锁定 authoritative 语义。
  - 浏览器回归锁定玩家实际看到的入口和反馈。
- 遵守项目当前原则：如果旧接口妨碍优雅实现，就直接改旧接口及其调用点，不额外叠兼容层。

## 2. 总体判断与推荐顺序

这 3 项里，前两项是 correctness blocker，第三项是 usability blocker。

### 2.1 当前真实状态

- midgame 场景当前只预置了玩家资源、科技和 `active_planet_id`，没有预置任何戴森验证锚点建筑，也没有预置系统级戴森运行态。
- `/agents` 工作台当前已经具备“turn 卡片 + 规划摘要 + 动作摘要 + 最终回复”的基础结构，也已经支持纯文本 done 态，但仍然缺少“语义级完成校验”和“更稳的模型动作契约”。
- 行星页当前已经具备 workflow 分组、authoritative 命令账本、研究与装料入口，但桌面端首屏仍然是 debug-first，而不是 play-first。

### 2.2 推荐执行顺序

1. 先做 midgame 官方场景收口。
   - 这样后续 Web / agent 的真实浏览器回归都能依赖同一套稳定的官方中后期验证局。
2. 再做 `/agents` 默认 Provider 真实动作稳定化。
   - 这是功能性 blocker，且其真实回归场景会直接复用第 1 项收口后的 midgame。
3. 最后做桌面端行星工作台重排。
   - 它不改变规则正确性，但会消除当前纯 Web 游玩的主要摩擦。

---

## 3. 任务 A：官方 midgame 戴森验证场景与文档收口

## 3.1 当前真实缺口

当前问题不是“戴森玩法没实现”，而是“官方 midgame 场景没有被真正初始化成文档描述的验证局”。

从代码上看：

- `server/config-midgame.yaml` 只定义了：
  - `initial_active_planet_id`
  - 玩家资源 / 物资
  - `completed_techs`
- `server/internal/gamecore/runtime_registry.go` 的 `seedPlayerOutposts()` 只会给每个 planet world 塞：
  - `battlefield_analysis_base`
  - `executor`
- `server/internal/startup/t094_midgame_bootstrap_test.go` 目前只校验科技完成态，不校验：
  - 预置建筑
  - `/world/systems/{systemId}/runtime.available`
  - `active_planet_context`

因此当前 midgame 的真实语义其实是：

- “高科技已解锁”
- 不是“戴森链路已预铺并可直接观察”

文档却把它写成了后一种。

## 3.2 方案比较

### 方案 A1：回撤文档，把官方 midgame 定义成“仅解锁、不预铺”的科技沙箱

优点：

- 改动最小
- 不需要新增启动期场景装配逻辑

缺点：

- 直接放弃当前文档和测试路径里“官方 midgame = 戴森验证场景”的定位
- `/system/sys-1` 首屏仍然看不到任何戴森态势
- 后续所有 Web / 玩家验证都还得先手工补建筑、补供电、补脚手架

结论：

- 不推荐

### 方案 A2：把官方 midgame 真的做成“最小预铺戴森验证场景”

优点：

- 文档、启动结果、系统页展示可以重新收敛成一套口径
- 后续 Web 与 agent 的中后期回归都有稳定锚点
- 真正符合“官方验证场景”的命名

缺点：

- 需要扩展启动期场景装配能力
- 需要同步补服务端测试和文档

结论：

- 推荐采用

### 方案 A3：直接提交一份官方 save / snapshot，当作 midgame 场景

优点：

- 最快能看到预铺结果

缺点：

- save 内容是黑箱，review 和 diff 成本高
- “新局启动”与“恢复存档”语义会混在一起
- 一旦规则或 catalog 变动，快照更容易悄悄过时

结论：

- 不采用

## 3.3 推荐方案

采用方案 A2，但有一个重要收口原则：

- 官方 midgame 只预置“戴森验证锚点”
- 不再假装“所有中后期建筑都已经摆好”

也就是把文档分成两层：

1. **启动即存在的锚点**
   - 用于证明这确实是一局“可直接观察戴森态势”的官方验证场景
2. **已解锁、可继续手工补建的建筑**
   - 用于说明玩家仍可在这局里继续验证其它中后期建筑，但它们不必全部预铺

这样实现最小、口径也最清楚。

## 3.4 详细设计

### A4.1 新增显式场景预置配置

推荐在 `server/config-midgame.yaml` 中新增顶层 `scenario_bootstrap`，不要继续把“世界级预置”塞进 `players[].bootstrap`。

原因：

- `players[].bootstrap` 适合资源、背包、科技
- 预置建筑、系统级戴森层、太阳帆轨道，本质上是世界场景，不是单个玩家背包字段

建议结构：

```yaml
scenario_bootstrap:
  planets:
    - planet_id: planet-1-2
      owners:
        - player_id: p1
          buildings:
            - type: em_rail_ejector
              position: { x: 10, y: 6 }
            - type: vertical_launching_silo
              position: { x: 12, y: 6 }
            - type: ray_receiver
              position: { x: 14, y: 6 }
              runtime:
                ray_receiver_mode: power
        - player_id: p2
          buildings: ...
  systems:
    - system_id: sys-1
      player_id: p1
      dyson:
        layers:
          - layer_index: 0
            orbit_radius: 1.2
            nodes:
              - latitude: 10
                longitude: 20
            shells:
              - latitude_min: -10
                latitude_max: 10
                coverage: 0.25
      solar_sail_orbits:
        - orbit_radius: 1.2
          inclination: 5
          count: 2
```

这里的坐标只是结构示意，不是最终固定值。最终坐标应由启动测试锁定到真实可建造地块。

### A4.2 预置能力只支持当前 midgame 需要的最小字段

不建议一开始做成通用脚本系统。当前只支持 midgame 所需字段即可：

- 行星级：
  - `planet_id`
  - `player_id`
  - `building.type`
  - `building.position`
  - 可选 `recipe_id`
  - 可选 `storage.inventory`
  - 可选少量 runtime 初始化字段，例如 `ray_receiver_mode`
- 系统级：
  - `system_id`
  - `player_id`
  - 戴森层、节点、壳面
  - 太阳帆轨道

不引入以下内容：

- 任意脚本执行
- 复杂条件逻辑
- 完整 runtime 任意字段覆写

目标是“把官方 midgame 定义清楚”，不是做一个新 DSL。

### A4.3 启动顺序调整

建议新增 `applyScenarioBootstrap()`，并放在以下阶段：

1. `buildSharedPlayers()`
2. `newPlanetWorld()`
3. `seedPlayerOutposts()`
4. `applyScenarioBootstrap()`
5. 初始 `Save("startup")`

要求：

- 必须走当前 authoritative building / dyson 初始化路径
- 不允许只在 query 层 patch 结果

也就是说，预置建筑必须调用与正常建造同源的初始化逻辑，例如：

- `InitBuildingStorage`
- `InitBuildingProduction`
- `RegisterPowerGridBuilding`
- 戴森层 / 节点 / 壳面的真实 state helper

这样 `/scene`、`/runtime`、`/networks`、`/system runtime` 才能自然一致。

### A4.4 只预置“可直接验证戴森链路”的最小锚点

建议 midgame 最小预置如下：

- `planet-1-2` 仍为 `active planet`，仍保持 `gas_giant`
- 每个玩家在该行星至少有：
  - 供电支撑
  - `em_rail_ejector`
  - `vertical_launching_silo`
  - `ray_receiver`
  - 至少一个能让建筑进入 `running` 的基础电网闭环
- `sys-1` 至少有：
  - 1 个可见层
  - 至少 1 个 node
  - 至少 1 个 shell 或等价可见脚手架
  - 最小太阳帆轨道或壳层产能，使 `runtime.available = true`

不建议全部预铺的内容：

- `jammer_tower`
- `sr_plasma_turret`
- `planetary_shield_generator`
- `self_evolution_lab`
- `advanced_mining_machine`
- `pile_sorter`
- `recomposing_assembler`

这些能力继续通过“已解锁，可手工建造验证”的文档口径覆盖。

### A4.5 文档同步方式

相关文档统一改成两栏描述：

1. **启动即存在的验证锚点**
   - `active planet = planet-1-2`
   - 可直接看到 `ray_receiver / em_rail_ejector / vertical_launching_silo`
   - `/system/sys-1` 首屏可直接看到非空戴森运行态
2. **已解锁但需玩家继续补建**
   - 上述 7 个中后期建筑
   - `dirac_inversion` 仍不预置

需要同步的文档：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/dev/client-web.md`
- `docs/dev/服务端API.md`

### A4.6 回归设计

服务端回归至少补齐以下几类：

1. 启动测试
   - `LoadRuntime(config-midgame.yaml, map-midgame.yaml)` 后：
     - `planet-1-2` 存在预置 `em_rail_ejector / vertical_launching_silo / ray_receiver`
     - `sys-1 runtime.available = true`
2. 查询测试
   - `active_planet_context.em_rail_ejector_count > 0`
   - `vertical_launching_silo_count > 0`
   - `ray_receiver_count > 0`
   - `dyson_sphere.layers` 非空
3. 文档 smoke checklist
   - 浏览器打开 `/system/sys-1`，首屏能看到非空戴森态势
   - 不再出现“文档说能看，实际全空”

### A4.7 涉及文件边界

- 修改：`server/config-midgame.yaml`
- 修改：`server/internal/config/config.go`
- 修改：`server/internal/gamecore/runtime_registry.go`
- 新增：`server/internal/gamecore/scenario_bootstrap.go`
- 修改：`server/internal/startup/game.go`
- 新增 / 修改：midgame 启动与查询相关测试
- 修改：`docs/player/玩法指南.md`
- 修改：`docs/player/上手与验证.md`
- 修改：`docs/dev/client-web.md`
- 修改：`docs/dev/服务端API.md`

---

## 4. 任务 B：Web 智能体工作台默认 Provider 稳定执行真实动作

## 4.1 当前真实缺口

这一项不能再按“结构解析已修好，所以问题基本解决”理解。当前仓库里确实已经有了前一轮收口，但 2026-04-11 的真实问题说明仍有 4 个缺口：

1. **模型侧动作契约仍然过于脆弱**
   - 当前 model-facing 动作还是 `game.cli` + 原始字符串命令
   - `provider-turn-runner.ts` 只给出命令名列表，没有稳定的 typed args 模板
2. **`agent.create` 的 policy 仍然在 schema 层要求完整对象**
   - 但 `server.ts` 内部的 `normalizePolicy()` 本来就支持 partial policy
   - 这意味着模型被迫填写一大段安全默认值，徒增 `provider_schema_invalid`
3. **turn 成功语义仍然只有“结构完成”，没有“任务真实完成”**
   - 观察请求如果只返回“我准备去观察”，结构上可能已经是 done
   - 但语义上它并没有真的观察
4. **前端虽然已经分开展示规划 / 动作 / 最终回复，但缺少结果类别**
   - 玩家仍然不容易一眼区分“纯回复”
   - “已观察”
   - “已执行动作”
   - “已委派”
   - “被阻塞”

因此，这一项当前缺的不是单点 bugfix，而是**更稳的模型动作契约 + 语义级完成校验**。

## 4.2 方案比较

### 方案 B1：继续保留 `game.cli` 字符串契约，只加强 prompt 与少量 heuristics

优点：

- 改动面最小

缺点：

- 仍然把模型输出正确性建立在 CLI 语法记忆上
- 观察 / 建造 / 科研 / 委派几类请求都还要靠 prompt“猜”出正确字符串
- 很难从后端稳定判断“这轮是否真的执行过”

结论：

- 不推荐

### 方案 B2：直接把模型动作契约改成 typed `game.command`，并补语义级完成校验

优点：

- 直接降低模型输出自由度
- 后端和 UI 都能基于结构化动作做校验与展示
- 可以顺手把 `agent.create` partial policy 一并收口

缺点：

- 需要重写 action schema、prompt、loop 和部分测试

结论：

- 推荐采用

### 方案 B3：仅对 `builtin-minimax-api` 做后处理或专用 prompt 补丁

优点：

- 短期能止血

缺点：

- 问题根因在公共 runtime 契约，不在 MiniMax 独有逻辑
- 新 HTTP provider 还会重踩同一个坑
- 明显违背当前项目“不在核心链路堆 provider 特判”的方向

结论：

- 不采用

## 4.3 推荐方案

采用方案 B2，并直接改旧动作契约，不保留对模型侧的 `game.cli` 依赖。

对模型而言，新的 canonical action 应该是结构化 `game.command`，不是自由拼字符串。

## 4.4 详细设计

### B4.1 直接把模型动作契约改成 `game.command`

建议把 `CanonicalAgentAction` 中的：

```ts
{ type: "game.cli"; commandLine: string }
```

改成：

```ts
{
  type: "game.command";
  command: PublicCommandId;
  args: Record<string, unknown>;
}
```

这里的 `command` 直接复用 `shared-client/src/command-catalog.ts` 的公开命令 ID，不再让模型输出原始 CLI 字符串。

第一阶段只覆盖当前真实需要的命令：

- `scan_galaxy`
- `scan_system`
- `scan_planet`
- `build`
- `start_research`
- `transfer_item`
- `switch_active_planet`
- `set_ray_receiver_mode`

如果当前任务不需要，不必一次把隐藏命令全做完。

### B4.2 在 gateway 内部新增命令参数 schema 与 serializer

新增一层稳定的内部模块，例如：

- `agent-gateway/src/runtime/game-command-schema.ts`
- `agent-gateway/src/runtime/game-command-executor.ts`

职责：

1. 给每个 `command` 提供 typed args schema
2. 把 `game.command` 序列化成当前 `runCommandLine()` 可执行的命令行
3. 统一生成动作摘要 label

例如：

- `scan_planet`：
  - `{ planetId: "planet-1-2" }`
- `build`：
  - `{ x: 5, y: 5, buildingType: "wind_turbine" }`
- `transfer_item`：
  - `{ buildingId: "b-10", itemId: "electromagnetic_matrix", quantity: 10 }`

这样做的好处是：

- 模型不再记 CLI 细节
- action schema 能直接限制字段
- 前端展示动作摘要时，也不用再把原始字符串二次解析

注意：

- 这不是再叠一层兼容 adapter 给模型
- 这是直接把“旧的 model-facing raw CLI 接口”换成“新的 model-facing typed 接口”
- `runCommandLine()` 只是临时沿用现有执行后端，不再继续暴露给模型

### B4.3 `agent.create.policy` 与 `agent.update.policy` 改成 partial

当前 `action-schema.ts` 已经比 `server.ts` 更严格了，这正是多余耦合。

推荐修改为：

- `agent.create.policy`：可选 partial
- `agent.update.policy`：可选 partial

缺失字段由 `server.ts` 里的既有 `normalizePolicy()` 补安全默认值：

- bool 默认 `false`
- string array 默认 `[]`

这样模型只需要输出真正有业务意义的字段，例如：

```json
{
  "type": "agent.create",
  "name": "胡景",
  "role": "worker",
  "policy": {
    "planetIds": ["planet-1-2"],
    "commandCategories": ["observe", "build"]
  }
}
```

而不是被迫每次都写全 9 个 policy 字段。

### B4.4 增加 turn intent classifier

新增模块，例如：

- `agent-gateway/src/runtime/turn-intent.ts`

把最新请求粗分为：

- `reply_only`
- `observe`
- `game_mutation`
- `agent_management`

只做 deterministic keyword / payload 级分类，不依赖第二个模型：

- 包含 `观察`、`扫描`、`汇报当前局势`、`看一下`、`planet-*` 等，归 `observe`
- 包含 `建造`、`研究`、`装入`、`切换模式`、`发射` 等，归 `game_mutation`
- 包含 `创建下级`、`委派`、`私聊`、`发消息给` 等，归 `agent_management`
- 其它普通聊天类请求，归 `reply_only`

这个分类不负责决定“怎么做”，只负责决定“done=true 时最低要不要有动作证据”。

### B4.5 增加语义级完成校验

新增模块，例如：

- `agent-gateway/src/runtime/turn-validator.ts`

规则：

1. `reply_only`
   - 允许 `done=true + 0 action`
2. `observe`
   - 至少需要 1 条 `game.command`
   - 且该命令属于 observe 类
3. `game_mutation`
   - 至少需要 1 条非 observe 的 `game.command`
4. `agent_management`
   - 至少需要 1 条：
     - `agent.create`
     - `agent.update`
     - `conversation.ensure_dm`
     - `conversation.send_message`

如果 turn 结构合法，但不满足上述最低动作证据，则：

- 不允许直接标记 `succeeded`
- 先进入 1 次 repair 回合

repair prompt 追加明确反馈：

> 上一轮只给了规划或承诺，没有执行这次请求所需的动作。请继续执行，并返回真实观察结果、真实动作结果，或 authoritative 失败原因。

如果 repair 后仍然没有动作证据，则 turn 失败，并公开为新错误码：

- `provider_incomplete_execution`

用户可见文案：

- `模型只返回了规划，未给出已执行结果。`

这比继续挤进 `provider_schema_invalid` 更准确。

### B4.6 ConversationTurn 增加 outcome 维度

建议扩展 `ConversationTurn`：

- `outcomeKind: "reply_only" | "observed" | "acted" | "delegated" | "blocked"`
- `executedActionCount: number`
- `repairCount?: number`

说明：

- `status` 继续表示生命周期是否成功 / 失败
- `outcomeKind` 表示“成功或失败的具体类型”

例如：

- 纯聊天回复成功：`status=succeeded`, `outcomeKind=reply_only`
- 观察成功：`status=succeeded`, `outcomeKind=observed`
- 建造成功：`status=succeeded`, `outcomeKind=acted`
- 创建下级并委派成功：`status=succeeded`, `outcomeKind=delegated`
- 真实尝试后被权限或资源阻塞：`status=failed`, `outcomeKind=blocked`

### B4.7 `/agents` 页面展示收口

`ChannelWorkspaceView.tsx` 基于新字段做更严格展示：

- turn 头部 badge 直接显示：
  - `纯回复`
  - `已观察`
  - `已执行动作`
  - `已委派`
  - `被阻塞`
- 新增“执行统计”一行：
  - `已执行动作 0 / 1 / 2`
- `provider_incomplete_execution` 单独展示成：
  - `这轮只有规划，没有执行所需动作`

这样玩家不会再把：

- “准备去扫描”

误当成：

- “已经扫描完成”

### B4.8 Prompt 与示例同步更新

`provider-turn-runner.ts` 里需要显式注入：

- 当前 agent 的 `policy` 上限
- `managedAgentIds`
- `canDirectMessageAgentIds`
- 可用 `game.command` 示例
- `agent.create` 的 partial policy 示例
- 明确规则：
  - 观察类请求不能只回计划句
  - 建造 / 科研 / 委派类请求不能只回“我会去做”

`bootstrap/minimax.ts` 里的内置 prompt 也同步切换到 `game.command` 示例，不能继续教模型输出旧的 `game.cli`。

### B4.9 回归设计

至少补齐以下自动化回归：

1. `action-schema` / validator 单测
   - partial policy 合法
   - typed `game.command` 参数合法
   - plan-only observe 被判定为 incomplete
2. `server.ts` 集成测试
   - 观察请求没有动作时不会成功
   - 建造请求有非空 `actionSummaries`
   - `agent.create` 用 partial policy 真实创建 agent
   - 研究请求能执行 `transfer + start_research`，或留下 authoritative blocked reason
3. Playwright
   - `/agents` 卡片中能区分规划摘要 / 动作摘要 / 最终回复
   - 失败时显示的是“未执行”或 authoritative blocked，不是模糊 success

### B4.10 涉及文件边界

- 修改：`agent-gateway/src/runtime/action-schema.ts`
- 新增：`agent-gateway/src/runtime/game-command-schema.ts`
- 新增：`agent-gateway/src/runtime/game-command-executor.ts`
- 新增：`agent-gateway/src/runtime/turn-intent.ts`
- 新增：`agent-gateway/src/runtime/turn-validator.ts`
- 修改：`agent-gateway/src/runtime/loop.ts`
- 修改：`agent-gateway/src/runtime/provider-turn-runner.ts`
- 修改：`agent-gateway/src/runtime/provider-error.ts`
- 修改：`agent-gateway/src/server.ts`
- 修改：`agent-gateway/src/bootstrap/minimax.ts`
- 修改：`client-web/src/features/agents/types.ts`
- 修改：`client-web/src/features/agents/ChannelWorkspaceView.tsx`
- 修改：对应 `agent-gateway` 与 `client-web` 测试
- 修改：`docs/dev/agent-gateway.md`
- 修改：`docs/dev/client-web.md`

---

## 5. 任务 C：Web 行星页桌面端命令工作台重排

## 5.1 当前真实缺口

当前桌面端并不是“没有功能”，而是“功能组织方式仍然像调试台”。

从代码上看，主要问题有 4 个：

1. `PlanetPage.tsx`
   - 桌面端把 `PlanetCommandCenter` 和 `PlanetEntityPanel` 叠在同一个右侧滚动容器里
2. `PlanetCommandPanel.tsx`
   - 顶部先渲染 workflow 说明和“最近结果”
   - 主操作表单要继续往下滚才看到
3. `PlanetActivityPanel`
   - 桌面端始终展开成“事件 + 告警”双栏
   - 即使已有 `key_feedback` 过滤，也仍然在视觉上与工作台抢主位
4. 前摄信息缺失
   - `catalog.buildings[].build_cost` 已经存在
   - `summary.players[playerId].resources` 也已存在
   - 但建造表单没有把“当前资源 / 选中建筑造价 / 是否可支付”做成首屏信息

所以这项的重点不是“再补一个命令”，而是**把现有能力重排成 play-first 的桌面工作台**。

## 5.2 方案比较

### 方案 C1：只在现有右栏里简单调换顺序

优点：

- 改动最小

缺点：

- `PlanetEntityPanel` 仍然和工作台叠在一起
- 活动流仍然是同权大块
- `PlanetCommandPanel.tsx` 仍然过大，后续维护继续困难

结论：

- 不推荐单独采用

### 方案 C2：桌面端引入独立 workbench shell，主表单前置，活动流降级

优点：

- 能直接解决“首屏看不到表单”和“多块内容抢焦点”
- 可以顺手把 `PlanetCommandPanel.tsx` 拆小
- 与移动端现有 tab 结构思路一致，只是桌面端展示方式不同

缺点：

- 需要改页面布局与部分状态组织

结论：

- 推荐采用

### 方案 C3：把所有命令表单改成弹窗 / 抽屉

优点：

- 地图首屏会更干净

缺点：

- 频繁命令交互会变成开抽屉、关抽屉
- 破坏“地图观察 + 命令推进”同屏联动

结论：

- 不采用

## 5.3 推荐方案

采用方案 C2：

- 桌面端右栏不再同时堆“工作台 + 选中对象”
- 当前 workflow 的主操作卡必须首屏可见
- 活动流默认降到次一级，不再与主操作区抢同一层注意力

## 5.4 详细设计

### C4.1 桌面端右栏改成 `工作台 / 选中对象` 双视图

当前移动端已经有：

- `工作台`
- `选中对象`
- `活动流`

桌面端建议复用同一套心智，但不照搬三个大 tab：

- 右栏只保留：
  - `工作台`
  - `选中对象`
- `活动流` 留在独立区域，但默认收口

这样右栏高度就能真正留给命令表单。

行为约束：

- 桌面端默认始终进入 `工作台`
- 玩家点地图选中对象时：
  - 不自动切走工作台
  - 只给 `选中对象` 视图显示一个 badge / dot

### C4.2 `PlanetOperationHeader` 瘦身

当前 header 里“最新反馈”是一段可变长文本，会把表单继续往下顶。

建议改成：

- 保留：
  - 当前路由行星
  - 当前 active planet
  - pending 数
- 最新反馈改成短 chip 或“查看最近结果”入口
- 不再在 header 里展示整段长消息

也就是说，详细结果属于 ledger，不属于首屏 header。

### C4.3 `PlanetCommandPanel` 拆成“主卡 + 次卡 + 账本”

建议把当前巨型 `PlanetCommandPanel.tsx` 拆成以下几类子模块：

- `WorkflowTabs`
- `WorkflowHero`
- `PrimaryActionCard`
- `SecondaryActions`
- `CommandLedger`
- `workflows/basic/*`
- `workflows/research/*`
- `workflows/dyson/*`

每个 workflow 的渲染顺序统一成：

1. workflow tab
2. 当前 workflow 的一句话目标
3. **首个主操作卡**
4. 其余次级操作卡（可折叠）
5. 最近结果账本

这样切换 workflow 后，用户第一眼就是能点的主表单，而不是历史结果和说明文字。

### C4.4 为每个 workflow 指定“首个主操作”

新增一个纯派生模块，例如：

- `client-web/src/features/planet-map/workbench-derivations.ts`

它不执行命令，只负责判断当前 workflow 的首个主操作是什么。

建议规则：

- `basic`
  - 主卡默认是“建造”
- `research`
  - 若有 `current_research`，主卡是“当前研究状态”
  - 否则主卡是“开始研究”
  - 若玩家已选中研究站并有对应矩阵库存，可把“装料”并排显示
- `logistics`
  - 主卡是“物流站配置”
- `cross_planet`
  - 主卡是“切换 active planet”
- `dyson`
  - 若已有 `ray_receiver`，主卡优先“切换模式”
  - 否则优先“发射 / 戴森建造”中最贴近现状的一张卡

切换 workflow 时，主卡容器自动 `scrollIntoView()`，不要求用户再在右栏内部二次滚动。

### C4.5 增加建造 / 装料前摄信息

新增派生模块，例如：

- `client-web/src/features/planet-map/build-affordance.ts`

建造卡首屏直接显示：

- 当前矿产
- 当前能量
- 选中建筑造价
- 资源差额
- `可提交 / 资源不足`

数据来源全部是现有读模型：

- 建筑造价：`catalog.buildings[].build_cost`
- 玩家资源：`summary.players[playerId].resources`
- 科技解锁：`catalog.buildings[].unlock_tech` + `summary.players[playerId].tech.completed_techs`

装料卡也做同类前摄：

- 背包现有物品数量
- 本次装料数量
- 是否足够

只要是客户端已经确定的硬前提，都应在点击前展示：

- 资源不足
- 背包数量不足
- 科技未解锁

仍然保持服务端 authoritative，不尝试在前端提前推导地形等复杂失败原因。

### C4.6 桌面端活动流默认降级

`PlanetActivityPanel` 保留，但改成桌面端默认“收口摘要”：

- 首屏只展示：
  - 最近关键反馈计数
  - 最近 1-3 条关键事件
  - 最近 1-3 条高优先级告警
- 详细双栏列表通过“展开活动流”进入

这样事件和告警不会消失，但不会在首屏与主工作台同权竞争。

### C4.7 回归设计

至少补以下回归：

1. 组件 / 页面单测
   - 桌面端默认显示 `工作台`
   - `选中对象` 不再与工作台堆叠在同一滚动区
   - workflow 切换后，主卡在 DOM 中位于账本之前
   - 选中建筑后 `选中对象` 有提醒但不抢焦点
2. 派生单测
   - 建造 affordability 计算正确
   - transfer affordability 计算正确
   - 主卡派生逻辑正确
3. Playwright 桌面端
   - 首屏能直接看到当前 workflow 的主表单
   - 不额外内部滚动即可看到建造或装料提交按钮
   - 资源不足时，点击前就能看到差额提示

### C4.8 涉及文件边界

- 修改：`client-web/src/pages/PlanetPage.tsx`
- 修改：`client-web/src/features/planet-commands/PlanetOperationHeader.tsx`
- 拆分：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 新增：`client-web/src/features/planet-map/workbench-derivations.ts`
- 新增：`client-web/src/features/planet-map/build-affordance.ts`
- 新增：`client-web/src/features/planet-map/workflows/*`
- 修改：`client-web/src/features/planet-map/PlanetPanels.tsx`
- 修改：`client-web/src/styles/index.css`
- 修改：相关 `PlanetPage` / `PlanetCommandPanel` 测试与 Playwright
- 修改：`docs/dev/client-web.md`

---

## 6. 非目标与边界

本设计刻意不包含以下内容：

- 不把 midgame 做成完整剧情化存档或任务脚本系统
- 不在 agent-gateway 中引入第二个“判题模型”
- 不重写 client-web 地图渲染器
- 不改移动端的整体交互主线，只把桌面端首屏重排到更适合游玩

## 7. 结论

这 3 项任务的共同问题，不是“缺少零散功能点”，而是三个关键面向仍然停留在半成品状态：

- 官方 midgame 还没有成为真正 authoritative 的官方验证场景
- `/agents` 还缺少语义级完成校验和更稳的模型动作契约
- 桌面端行星页还在用 debug-first 的布局承载 play-first 的目标

推荐收口方向如下：

1. 用配置驱动的场景预置，把官方 midgame 真的做成“最小预铺戴森验证场景”，同时把文档改成“预置锚点 + 已解锁可补建”的真实口径。
2. 直接把模型侧动作接口从 `game.cli` 改成 typed `game.command`，并补 partial policy、turn intent classifier、semantic validator、outcome badges。
3. 把桌面端右栏改成真正的工作台视图：主表单前置、次卡折叠、账本后置、活动流降级、成本前摄。

这三项收口后，项目在“官方验证局”“AI 工作台”“纯 Web 游玩”三个用户入口上的口径才会一致。
