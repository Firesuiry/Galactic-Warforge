# 2026-04-11 `docs/process/task` 最终实现方案

本文档综合以下两份方案，收敛为唯一的最终实现口径：

- `docs/process/design_codex.md`
- `docs/process/design_claude.md`

说明：

- 当前工作树中的 `docs/process/design_claude.md` 已被删除，因此本文以该文件的最近一次已提交版本为参考。
- 最终覆盖范围以当前 `docs/process/task/` 下真实待办为准，而不是以历史方案中的旧任务名为准。

当前真实待办共 3 项：

1. 官方 midgame 戴森验证场景与玩家文档严重不一致
2. Web 智能体工作台默认 Provider 无法稳定执行真实动作
3. Web 行星页命令工作台桌面端可发现性与操作流不够优雅

---

## 1. 总体取舍

### 1.1 最终原则

- 以 authoritative 运行态为准，不允许继续存在“文档一套、启动结果一套、页面展示再一套”的口径分叉。
- 直接收敛公共契约，不做只对单一 provider、生效路径或页面分支有效的补丁。
- Play-first 优先于 debug-first。Web 页面对玩家暴露的第一层必须是“下一步能做什么”，不是“内部状态很多但主操作藏得很深”。
- 容错只接住“明确可判定的空壳输出”与“无动作纯回复”这类低风险情况，不吞掉有业务语义但结构错误的结果。
- `design_claude.md` 中仍然有效的研究工作台、引导文案、上下文提示等细节，不再作为独立任务存在，而是并入当前任务 C 的工作台重排方案。

### 1.2 最终优先级

1. 先做 midgame 官方验证场景收口
2. 再做 `/agents` 默认 Provider 动作稳定化
3. 最后做桌面端行星工作台重排

原因：

- 任务 A 先提供稳定的中后期 authoritative 验证局。
- 任务 B 的浏览器与 agent 真实回归需要依赖稳定场景。
- 任务 C 主要解决纯 Web 游玩的效率与可发现性，不改变底层规则正确性。

---

## 2. 任务 A：官方 midgame 戴森验证场景与文档收口

### 2.1 最终结论

本任务完全采用 `design_codex.md` 的主方向，不采用“只回撤文档”或“直接提交黑箱快照”的方案。

最终目标不是把 midgame 做成一份不可读的存档，而是把它做成：

- 启动后就能直接观察戴森链路的官方验证场景
- 同时仍保留“已解锁、可继续手工补建”的中后期沙箱特征

### 2.2 最终方案

#### A-1 引入显式 `scenario_bootstrap`

在 `server/config-midgame.yaml` 中新增顶层 `scenario_bootstrap`，并将场景级预置与玩家级 bootstrap 分开：

- `players[].bootstrap` 继续负责资源、背包、科技、active planet
- `scenario_bootstrap.planets[]` 负责预置建筑与少量运行态初始化
- `scenario_bootstrap.systems[]` 负责戴森层、节点、壳面与太阳帆轨道

不采用 save/snapshot 方案。原因是：

- diff 不透明
- review 成本高
- 规则或 catalog 变更后更容易静默过时

#### A-2 启动顺序固定为 authoritative 初始化链

新增 `applyScenarioBootstrap()`，并放在：

1. `buildSharedPlayers()`
2. `newPlanetWorld()`
3. `seedPlayerOutposts()`
4. `applyScenarioBootstrap()`
5. 初始 `Save("startup")`

硬要求：

- 预置建筑必须走与正常建造同源的初始化逻辑
- 戴森层、节点、壳面也必须走真实 state helper
- 不允许在 query 层 patch 出“看起来像已预置”的结果

#### A-3 只预置最小验证锚点，不做全量中后期铺场

midgame 启动后至少满足：

- `planet-1-2` 仍是 `active planet`
- 该局可直接看到 `em_rail_ejector`、`vertical_launching_silo`、`ray_receiver`
- 存在最小供电闭环，让关键建筑进入可运行态
- `sys-1` 存在至少 1 个可见戴森层
- 至少有 node、shell 或等价脚手架
- 至少有最小太阳帆轨道或等价产能，使 `runtime.available = true`

不预置但保持已解锁、允许继续手工验证的内容：

- `jammer_tower`
- `sr_plasma_turret`
- `planetary_shield_generator`
- `self_evolution_lab`
- `advanced_mining_machine`
- `pile_sorter`
- `recomposing_assembler`

#### A-4 文档口径改成“两层描述”

所有相关文档统一改成两栏：

1. 启动即存在的验证锚点
2. 已解锁但需要玩家继续补建的能力

这样可以同时满足：

- “这是官方 midgame 验证局”
- “这不是一张把所有中后期内容都提前摆满的展示图”

### 2.3 不采用的方案

- 不采用“只改文档、不改场景”
- 不采用“导入官方快照冒充 midgame”
- 不采用“把所有中后期建筑全部预铺”

前两者无法收敛 authoritative 口径，后一种会让场景失去继续验证和扩展的空间。

### 2.4 文件边界

- 修改：`server/config-midgame.yaml`
- 修改：`server/internal/config/config.go`
- 修改：`server/internal/gamecore/runtime_registry.go`
- 新增：`server/internal/gamecore/scenario_bootstrap.go`
- 修改：`server/internal/startup/game.go`
- 修改或新增：midgame 启动与查询相关测试
- 修改：`docs/player/玩法指南.md`
- 修改：`docs/player/上手与验证.md`
- 修改：`docs/dev/client-web.md`
- 修改：`docs/dev/服务端API.md`

### 2.5 回归要求

- 启动测试必须断言 `planet-1-2` 存在预置戴森链路建筑
- 查询测试必须断言 `active_planet_context` 与 `system runtime` 非空
- 浏览器 smoke 必须确认 `/system/sys-1` 首屏可直接看到非空戴森态势

---

## 3. 任务 B：Web 智能体工作台默认 Provider 稳定执行真实动作

### 3.1 最终结论

本任务采用 `design_codex.md` 的主干方案：

- 直接把模型侧动作契约从 `game.cli` 收口到 typed `game.command`
- 增加 intent classifier 与 semantic validator
- 用 outcome 维度收口前端展示

同时吸收 `design_claude.md` 中两个有效细节：

- provider 返回纯文本或最小完成态时，需要有明确且可控的解析兜底
- `assistantMessage + actions: [] + done: true` 必须成为合法的 reply-only 完成态

但不采用 `design_claude.md` 中“在 `runAgentLoop()` 外围对 normalize 全量 try-catch，异常时统一降级成功”的方案。那会吞掉真实 schema 错误，不符合项目当前要求。

### 3.2 最终方案

#### B-1 Provider 基础完成态收口

统一允许以下最小完成态：

```json
{
  "assistantMessage": "我已完成回复。",
  "actions": [],
  "done": true
}
```

同时允许 provider 返回纯文本。解析规则为：

- `JSON.parse` 失败时，将 `raw.trim()` 包装成：
  - `assistantMessage = raw.trim()`
  - `actions = []`
  - `done = true`
- `assistantMessage` 为字符串、`actions` 缺失时，默认 `actions = []`
- `assistantMessage` 非空且 `done` 缺失时，可默认 `done = true`

但这个“完成”只说明结构完成，不自动说明任务语义完成。真正是否允许 0 动作成功，由 intent validator 决定。

#### B-2 模型动作契约改成 typed `game.command`

新的 canonical action 统一为：

```json
{
  "type": "game.command",
  "command": "scan_planet",
  "args": {
    "planetId": "planet-1-2"
  }
}
```

第一阶段只覆盖当前真实需要的命令：

- `scan_galaxy`
- `scan_system`
- `scan_planet`
- `build`
- `start_research`
- `transfer_item`
- `switch_active_planet`
- `set_ray_receiver_mode`

新增内部模块负责：

- 参数 schema 校验
- 将 typed args 序列化为当前执行后端可接受的命令
- 统一生成动作摘要

这里不是给旧模型契约再包一层 adapter，而是直接废弃旧的 model-facing `game.cli`。

#### B-3 `normalizeProviderTurn()` 只忽略真正的空壳动作

吸收 `design_claude.md` 的容错思路，但范围收紧为：

- 可静默跳过：空对象 `{}`、仅包含空 `args` 且没有任何业务字段的动作壳
- 必须报错：有业务语义但结构残缺的动作

例如以下仍然要失败：

- `{"type":"game.command","command":"build"}`
- `{"command":"scan_planet","args":{"planetId":"planet-1-2"}}`
- `{"type":"foo.bar"}`

补充要求：

- 跳过空动作时写 `warn` 日志
- 错误分类统一落到 `provider_schema_invalid`

#### B-4 `agent.create` / `agent.update` 的 policy 改为 partial

这一点完全采用 `design_codex.md`：

- `action-schema.ts` 不再要求 policy 完整展开
- 缺失字段由 `server.ts` 既有的 `normalizePolicy()` 补安全默认值

这样模型只需提交真正有意义的字段，例如：

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

#### B-5 引入 turn intent classifier 与 semantic validator

新增 deterministic 分类：

- `reply_only`
- `observe`
- `game_mutation`
- `agent_management`

语义校验规则：

- `reply_only`
  - 允许 `done = true` 且 `0 action`
- `observe`
  - 至少要有 1 条 observe 类 `game.command`
- `game_mutation`
  - 至少要有 1 条非 observe 的 `game.command`
- `agent_management`
  - 至少要有 1 条 agent/conversation 相关动作

如果结构合法但只返回了“计划去做”：

- 先进入 1 次 repair 回合
- repair prompt 明确指出“上一轮没有执行所需动作”
- repair 后仍无动作证据，则失败并给出：
  - `provider_incomplete_execution`

这样就能区分：

- “结构坏了”
- “结构没坏，但根本没做”

#### B-6 Loop 完成语义与最终回复规则

完成语义最终收口为：

1. 若本轮出现 `final_answer`，优先使用它作为正式回复
2. 若 `done = true` 且没有 `final_answer`，允许使用 `assistantMessage` 作为正式回复
3. 若 `assistantMessage` 为空且没有 `final_answer`，判为 `provider_schema_invalid`
4. 若语义校验要求有动作但本轮没有动作，则不能因为 `assistantMessage` 非空而直接标记成功

这部分吸收了 `design_claude.md` 对无动作纯回复的支持，但把权限收口到 intent-aware 语义层，而不是简单“有回复就算成功”。

#### B-7 会话结果模型与前端展示收口

扩展 `ConversationTurn`：

- `outcomeKind: "reply_only" | "observed" | "acted" | "delegated" | "blocked"`
- `executedActionCount: number`
- `repairCount?: number`

`/agents` 页面据此展示：

- `纯回复`
- `已观察`
- `已执行动作`
- `已委派`
- `被阻塞`

并对 `provider_incomplete_execution` 单独显示：

- `这轮只有规划，没有执行所需动作`

这样可以直接消除当前“准备去观察”被误读成“已经观察完”的假成功。

#### B-8 Prompt 与示例统一更新

以下位置统一改成同一份真实契约：

- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/server.ts`
- `agent-gateway/src/bootstrap/minimax.ts`

Prompt 必须同时包含：

- `assistantMessage/actions/done` 的最小合法结构
- `reply_only` 示例
- `game.command` 示例
- partial policy 的 `agent.create` 示例
- 观察类请求不能只回计划句、变更类请求不能只回承诺句的明确说明

### 3.3 不采用的方案

- 不继续依赖 `game.cli` 自由拼字符串
- 不做 `builtin-minimax-api` 专属补丁链
- 不在 `runAgentLoop()` 外层增加全量异常成功兜底

### 3.4 文件边界

- 修改：`agent-gateway/src/providers/index.ts`
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

### 3.5 回归要求

- 单测覆盖最小完成态、纯文本兜底、空动作壳过滤、partial policy、typed command 参数校验
- 集成测试覆盖 observe / build / research / agent.create 四类真实请求
- Playwright 覆盖 `/agents` 中规划摘要、动作摘要、最终回复、outcome badge 的区分展示

---

## 4. 任务 C：Web 行星页桌面端命令工作台重排

### 4.1 最终结论

本任务采用 `design_codex.md` 的桌面 workbench shell 主方向，并把 `design_claude.md` 中仍然有效的研究工作台细化、推荐路径与上下文提示吸收到该方案内部。

最终目标不是简单换个顺序，而是把桌面端右栏从“调试控制台”重排成“真正的游玩工作台”：

- 主操作首屏可见
- 选中对象不再和工作台抢同一滚动区
- 活动流降级
- 建造、装料、研究等核心推进动作在点击前就能看到足够的前摄信息

### 4.2 最终方案

#### C-1 桌面端右栏改成 `工作台 / 选中对象` 双视图

桌面端不再把：

- 工作台
- 选中对象
- 活动流

三块内容硬堆在同一层级。

改为：

- 右栏只保留 `工作台` 与 `选中对象`
- 默认始终进入 `工作台`
- 点击地图选中对象时，不自动抢焦点，只给 `选中对象` 视图提示
- `活动流` 留在独立区域，默认收口

#### C-2 `PlanetOperationHeader` 瘦身

header 只保留首屏必要信息：

- 当前路由行星
- 当前 active planet
- pending 数

长文本“最新反馈”从 header 挪到账本区，仅保留短 chip 或入口，不再把主表单继续往下顶。

#### C-3 `PlanetCommandPanel` 拆成“主卡 + 次卡 + 账本”

按 `design_codex.md` 拆分：

- `WorkflowTabs`
- `WorkflowHero`
- `PrimaryActionCard`
- `SecondaryActions`
- `CommandLedger`
- `workflows/basic/*`
- `workflows/research/*`
- `workflows/dyson/*`

统一顺序固定为：

1. workflow tab
2. 当前 workflow 的一句话目标
3. 首个主操作卡
4. 次级操作卡
5. 最近结果账本

这样切换 workflow 后，用户看到的第一块始终是“现在就能做的事”。

#### C-4 研究 workflow 吸收 `design_claude.md` 的有效细节

`design_claude.md` 中的“科研与科技树交互优化”不再单列为独立任务，而是内聚到 `workflows/research/*`：

- 科技列表改成分组视图，而不是扁平下拉
- 至少展示：
  - 当前可研究
  - 已完成
  - 尚未满足前置
- 若有 `current_research`，主卡优先展示当前研究状态与进度
- 若尚处前期开局阶段，可展示简短推荐路径
- 研究卡中直接显示前置科技、成本与关键解锁结果

不采用完整图谱型科技树。当前任务目标是提高可发现性与操作流，不是引入一套新的大型可视化系统。

#### C-5 为每个 workflow 指定首个主操作

新增派生模块负责计算主卡：

- `basic`
  - 默认主卡为建造
- `research`
  - 有 `current_research` 时主卡为当前研究状态
  - 否则主卡为开始研究
  - 若满足条件，可并排暴露研究站装料
- `logistics`
  - 主卡为物流配置
- `cross_planet`
  - 主卡为切换 active planet
- `dyson`
  - 优先展示最贴近现状的射线接收、发射或戴森建造卡

切换 workflow 时，主卡自动滚入可视区，不要求用户在右栏里二次深滚动。

#### C-6 建造与装料前摄信息首屏化

采用 `design_codex.md` 的通用 affordance 思路，并吸收 `design_claude.md` 的上下文提示细节：

建造卡首屏直接显示：

- 当前关键资源
- 选中建筑造价
- 差额
- 是否可支付
- 是否已解锁

装料卡首屏直接显示：

- 背包现有数量
- 本次装料数量
- 是否足够

这些都使用现有读模型派生，不提前模拟复杂 authoritative 规则，只把客户端已知的硬前提前摄出来。

#### C-7 账本提示改成上下文相关

吸收 `design_claude.md` 中对 `resolveNextHint()` 的细化，但不再只服务研究：

- `PlanetCommandJournalEntry.focus` 扩展记录 `buildingType`
- 视情况补充 `receiverMode`、`techId` 等上下文字段
- `transfer_item` 成功后按目标建筑类型生成下一步提示

例如：

- `matrix_lab`：提示可启动研究
- `em_rail_ejector`：提示可发射太阳帆
- `vertical_launching_silo`：提示可发射火箭
- `ray_receiver`：提示可切换为发电或光子生成

这样“下一步建议”不再依赖单一 `techId` 猜测。

#### C-8 活动流默认降级

`PlanetActivityPanel` 保留，但桌面端默认只展示摘要：

- 最近关键反馈计数
- 最近 1-3 条关键事件
- 最近 1-3 条高优先级告警

详细时间线通过“展开活动流”进入，不再首屏与工作台同权竞争。

### 4.3 不采用的方案

- 不仅仅做右栏顺序微调
- 不把所有命令表单改成弹窗或抽屉
- 不单独再开一个“科研专项任务”
- 不引入完整图谱式科技树

### 4.4 文件边界

- 修改：`client-web/src/pages/PlanetPage.tsx`
- 修改：`client-web/src/features/planet-commands/PlanetOperationHeader.tsx`
- 拆分：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 新增：`client-web/src/features/planet-map/workbench-derivations.ts`
- 新增：`client-web/src/features/planet-map/build-affordance.ts`
- 新增：`client-web/src/features/planet-map/workflows/*`
- 修改：`client-web/src/features/planet-map/PlanetPanels.tsx`
- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/styles/index.css`
- 修改：相关 `PlanetPage` / `PlanetCommandPanel` 测试与 Playwright
- 修改：`docs/dev/client-web.md`

### 4.5 回归要求

- 组件测试覆盖桌面端默认工作台、主卡在账本之前、选中对象不抢焦点
- 派生测试覆盖 build/transfer affordability 与 research 主卡判定
- Playwright 桌面端确认首屏可直接看到主操作表单，资源不足时点击前即可看到差额提示

---

## 5. 非目标

- 不把 midgame 扩展成完整剧情脚本系统
- 不为某个 provider 单独保留长期兼容分支
- 不重写地图渲染器
- 不在当前轮次引入完整图谱科技树

## 6. 最终收口

最终实现方案总结如下：

1. 用配置驱动的 `scenario_bootstrap` 把官方 midgame 真的做成“最小预铺戴森验证场景”，并同步把文档收口到“预置锚点 + 已解锁可补建”的真实口径。
2. 直接把模型侧动作契约从 `game.cli` 改成 typed `game.command`，同时保留最小 reply-only 完成态、补齐 semantic validator、repair 回合与 outcome badge。
3. 把桌面端行星页改成真正的工作台视图：主卡前置、对象信息分视图、活动流降级、研究 workflow 分组展示、建造与装料成本前摄、账本提示上下文化。

这 3 项收口后，项目在“官方验证局”“AI 工作台”“纯 Web 游玩”三个入口上的语义与体验才会一致。
