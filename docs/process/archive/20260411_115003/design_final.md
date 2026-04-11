# 2026-04-11 Web 未实现功能最终实现方案

本文档综合以下两份设计稿，形成唯一的最终实现方案：

- `docs/process/design_claude.md`
- `docs/process/design_codex.md`

覆盖范围仍限定为 `docs/process/task/` 下当前未实现的两项任务：

1. Web 智能体工作台默认 Provider 回复链路修复
2. Web 科研与科技树交互优化

本最终方案的取舍原则如下：

- 优先修正公共契约，不做只对单一 Provider 生效的兼容补丁。
- 优先降低组件耦合，不把新增派生逻辑继续堆进超大文件。
- 容错只覆盖“明确可判定的空壳输出”，不吞掉有语义但不完整的错误动作。
- 测试与浏览器回归必须和设计同时落地，不能只改实现不补验证。

---

## 1. 最终结论概览

### 1.1 任务 A 结论

采用 `design_codex.md` 的主方向，吸收 `design_claude.md` 中对纯文本回复与 MiniMax prompt 的直接修正建议，形成以下最终决策：

- 修公共 turn 契约，不做 `builtin-minimax-api` 专属适配层。
- 支持“无工具动作、直接回复完成态”：
  - `assistantMessage + actions: [] + done: true`
  - 纯文本回复自动包装为上述完成态
- `normalizeProviderTurn()` 只忽略真正的空动作壳，不吞掉残缺但有语义的非法动作。
- `runAgentLoop()` 接受 `assistantMessage` 作为 done 态的正式回复兜底，但 `final_answer` 仍保持最高优先级。
- 同步修改 `server.ts`、`provider-turn-runner.ts`、`bootstrap/minimax.ts` 的提示词，消除当前“runtime 允许一种语义、prompt 强制另一种语义”的冲突。
- 补齐结构错误分类和回归测试。

不采用 `design_claude.md` 中“在 `runAgentLoop()` 外围对 normalize 全量 try-catch 并统一降级为成功回复”的做法。原因是这会把真实 schema 错误一并吞掉，违背项目的激进式演进准则。

### 1.2 任务 B 结论

采用 `design_codex.md` 的主方向，吸收 `design_claude.md` 中对推荐路径、分组展示和文案示例的具体细节，形成以下最终决策：

- 科研入口从扁平下拉改成阶段化研究工作台。
- 新增独立的研究派生模块，避免继续膨胀 `PlanetCommandPanel.tsx`。
- 研究状态以 `shared-client` 中的 `completed_techs?: string[]` 为主路径；如运行时仍遇到旧形态兼容，只在派生模块内部归一化，不向组件层扩散。
- 命令日志 `focus` 扩展为携带 `buildingType` 与 `receiverMode`，让“下一步提示”基于上下文而不是只靠 `techId` 猜测。
- 新增单元、组件和浏览器回归，覆盖默认新局与 midgame。

不采用“继续保留下拉框只补说明文案”与“直接做完整科技树图谱”两类方案。前者无法解决阶段引导问题，后者超出当前任务范围且会提高移动端与测试成本。

---

## 2. 任务 A：Web 智能体工作台默认 Provider 回复链路修复

### 2.1 当前真实问题链路

当前失败不是单点问题，而是四层契约共同过严：

1. `agent-gateway/src/providers/index.ts`
   - 纯文本回复无法被包装为合法 turn。
   - 对“仅含 assistantMessage 的轻量 JSON 回复”缺少最小兼容。
2. `agent-gateway/src/runtime/action-schema.ts`
   - `actions.map(normalizeAction)` 遇到空对象会直接抛出 `action.type is required`。
3. `agent-gateway/src/runtime/loop.ts`
   - 即使 `assistantMessage` 非空，`done === true` 时仍强制要求 `final_answer`。
4. `agent-gateway/src/server.ts`
   - prompt 文案明确要求“正式回复必须通过 final_answer 提交”，与任务要求冲突。

最终结果是：

- provider 返回 `actions: [{}]` 会整轮失败；
- provider 返回 `actions: []` 仍可能因为缺少 `final_answer` 失败；
- 前端只能看到 `system failure`，玩家无法把 `/agents` 工作台跑通。

### 2.2 设计目标

- 允许最简单的完成态：`{ assistantMessage, actions: [], done: true }`
- 允许 provider 返回纯文本，并自动包装为完成态
- 只忽略真正的空动作占位，不吞掉真实非法动作
- 保留 `final_answer` 的显式动作语义，但不再要求它是唯一完成出口
- 将结构错误统一归类为 `provider_schema_invalid`

### 2.3 最终方案

#### A-1 Provider 解析层：支持纯文本与最小完成态

目标文件：

- `agent-gateway/src/providers/index.ts`
- `agent-gateway/src/providers/providers.test.ts`

最终规则：

1. `parseProviderResult(raw)` 先继续走现有的结构化文本提取流程。
2. 如果 `JSON.parse` 失败：
   - 将 `raw.trim()` 包装为：
     - `assistantMessage: raw.trim()`
     - `actions: []`
     - `done: true`
3. 如果 `JSON.parse` 成功且是对象：
   - 若 `assistantMessage` 是字符串，但 `actions` 缺失，则默认 `actions = []`
   - 若 `assistantMessage` 非空、`actions` 为空数组且 `done` 缺失，则默认 `done = true`
   - 其它结构仍保持严格校验，不做大范围“自动修复”

这样兼顾两点：

- 纯回复型 provider 不再被无谓打死
- 工具调用型 provider 一旦返回残缺结构，仍会暴露真实错误

#### A-2 Action 归一化层：只忽略真正的空动作壳

目标文件：

- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/action-schema.test.ts`

最终规则：

- 在 `normalizeProviderTurn()` 中增加一层显式预筛选，而不是在 `loop.ts` 末端兜底。
- 仅以下两类 action 可被静默跳过：
  - 空对象 `{}`
  - 仅包含空 `args`，合并后仍无任何业务字段的对象
- 以下动作仍必须报错：
  - `{"type":"game.cli"}` 这类缺关键字段的动作
  - `{"commandLine":"scan_planet planet-1-1"}` 这类无 `type` 但已携带业务字段的动作
  - `{"type":"foo.bar"}` 这类未支持动作

补充要求：

- 跳过空动作时记录 `warn` 级别日志，便于后续定位 provider 输出质量问题。

#### A-3 Loop 完成语义：允许 assistantMessage 直接完成 turn

目标文件：

- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/loop.test.ts`
- `agent-gateway/src/server.test.ts`

最终规则：

1. 若本轮出现 `final_answer`，正式回复以 `final_answer.message` 为准。
2. 若 `turn.done === true` 且本轮没有 `final_answer`：
   - 当 `assistantMessage.trim() !== ""` 时，直接把它作为 `finalMessage`
   - 当 `assistantMessage` 也为空时，才视为 schema invalid
3. 若 `turn.done === false`：
   - `assistantMessage` 仍只表示当前阶段说明，不结束 turn

明确不做的事：

- 不在 `runAgentLoop()` 外围对 `normalizeProviderTurn()` 做大而化之的 try-catch 成功兜底。
- 结构错误依然要失败，并通过 `provider_schema_invalid` 暴露。

#### A-4 Prompt 契约统一

目标文件：

- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/server.ts`
- `agent-gateway/src/bootstrap/minimax.ts`

最终要求：

- 公共 prompt 明确说明：
  - 必须返回 `assistantMessage/actions/done`
  - 若本轮无需动作且已完成，可直接使用 `assistantMessage + [] + true`
  - 若希望显式提交正式回复，也可使用 `final_answer`
- 删除 `server.ts` 当前“assistantMessage 只能作为预览、正式回复必须通过 final_answer”的硬约束文案
- MiniMax 默认系统提示增加最小合法示例，例如：
  - `{"assistantMessage":"收到，我先观察当前状态。","actions":[],"done":true}`

目标不是让某个 provider 特殊化，而是让所有 provider 看到同一份真实契约。

#### A-5 错误分类收口

目标文件：

- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/server.test.ts`

需统一归类到 `provider_schema_invalid` 的错误至少包括：

- `actions must be an array`
- `done must be a boolean`
- `action must be an object`
- `action.type is required`
- `provider turn must be an object`
- `final_answer is required when done is true`
- 结构化 JSON 解析失败

保留现有分类边界：

- `not supported` -> `unsupported_action`
- 网络、超时、502 -> `provider_unavailable`
- 执行器启动失败 -> `provider_start_failed`

### 2.4 文件边界

本任务最终改动边界如下：

- 修改：`agent-gateway/src/providers/index.ts`
- 修改：`agent-gateway/src/runtime/action-schema.ts`
- 修改：`agent-gateway/src/runtime/loop.ts`
- 修改：`agent-gateway/src/runtime/provider-error.ts`
- 修改：`agent-gateway/src/runtime/provider-turn-runner.ts`
- 修改：`agent-gateway/src/server.ts`
- 修改：`agent-gateway/src/bootstrap/minimax.ts`
- 修改：`agent-gateway/src/providers/providers.test.ts`
- 修改：`agent-gateway/src/runtime/action-schema.test.ts`
- 修改：`agent-gateway/src/runtime/loop.test.ts`
- 修改：`agent-gateway/src/server.test.ts`
- 修改：`client-web/tests/agent-platform.spec.ts`

### 2.5 回归要求

#### 自动化回归

`agent-gateway` 至少补齐以下断言：

1. `parseProviderResult()` 接受纯文本并回落成无动作完成态
2. `parseProviderResult()` 接受仅含 `assistantMessage` 的轻量 JSON，并补全为完成态
3. `normalizeProviderTurn()` 会忽略 `actions: [{}]`
4. `normalizeProviderTurn()` 不会忽略带业务字段但缺 `type` 的残缺动作
5. `runAgentLoop()` 在 `done=true + actions=[] + assistantMessage=非空` 时返回成功
6. DM 集成测试中，provider 返回 `{"assistantMessage":"已收到你的私聊","actions":[{}],"done":true}` 时：
   - turn 状态为 `succeeded`
   - 会话中出现正式 agent 回复
   - 不出现 system failure

`client-web` 至少补一条 `/agents` 浏览器回归：

- 发送私聊后，页面展示正式 agent 回复
- 不出现“回复失败：执行失败，请稍后重试”
- turn 详情面板显示成功态

#### 手工复测

修复完成后必须重新走真实浏览器链路：

1. 打开 `/agents`
2. 新建成员并绑定 `builtin-minimax-api`
3. 保存权限范围
4. 发送纯观察任务并确认收到正式回复
5. 继续验证：
   - 创建下级成员
   - 分配权限
   - 下级完成至少一次建造或科研
   - authoritative 成功

### 2.6 非目标

- 不重做整个 agent action DSL
- 不把所有 provider 输出错误都“修好”成成功回复
- 不继续强制 `final_answer` 成为唯一完成通道

---

## 3. 任务 B：Web 科研与科技树交互优化

### 3.1 当前真实问题

当前 Web 科研闭环已经能跑通，但仍保留明显的调试面板感：

1. `PlanetCommandPanel.tsx` 把所有科技按 level 排序后塞进单个扁平 `<select>`
2. 页面不表达：
   - 当前可研究
   - 已完成
   - 被什么前置锁住
   - 需要什么矩阵
   - 研究后解锁什么
3. `store.ts` 的 `resolveNextHint()` 目前主要依赖 `techId`
   - 研究站装料还勉强可用
   - 到 `em_rail_ejector`、`vertical_launching_silo`、`ray_receiver` 就会出现上下文错误提示
4. `PlanetCommandPanel.tsx` 已很大，继续堆状态判断会进一步恶化维护性

### 3.2 设计目标

- 把科研入口改成阶段化工作流，而不是继续使用扁平下拉
- 优先复用现有 `catalog.techs` 与 `summary.players[playerId].tech`
- 默认新局首屏明确提示推荐科研路径
- 装料与模式切换后的提示必须符合当前建筑上下文
- 派生逻辑从组件中抽离，降低耦合

### 3.3 最终方案

#### B-1 新增研究派生层

目标文件：

- 新增：`client-web/src/features/planet-map/research-workflow.ts`
- 新增：`client-web/src/features/planet-map/research-workflow.test.ts`

该模块负责集中处理研究区的派生逻辑，至少提供：

- `normalizeCompletedTechIds(techState)`
  - 主路径按 `shared-client/src/types.ts` 中的 `completed_techs?: string[]` 处理
  - 若运行时遇到旧形态兼容，只在这里统一归一化
- `deriveResearchGroups(catalog, techState)`
  - 产出 `current`、`available`、`completed`、`locked` 视图模型
- `formatTechUnlockLabel(catalog, unlock)`
  - 把建筑、配方、special unlock 转成可展示文案
- `buildStarterGuide(techState)`
  - 决定是否显示默认新局推荐路径

核心要求：

- `PlanetCommandPanel.tsx` 不再直接散落大量 `Set`、`filter`、`every` 与展示拼接逻辑
- 研究状态判断只保留一个来源，便于测试和复用

#### B-2 研究 UI 改成阶段化工作台

目标文件：

- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/styles/index.css`

研究区最终结构分为四块：

1. `当前研究`
   - 展示 `current_research.tech_id`
   - 展示 `progress / total_cost`
   - 若有 `blocked_reason`，翻译为玩家可读提示

2. `开局推荐路径`
   - 当 `electromagnetism` 尚未完成时显示：
     - `风机 -> 空研究站 -> 装 10 电磁矩阵 -> 研究 electromagnetism`
   - 只在早期阶段展示，不污染 midgame

3. `科技阶段列表`
   - 至少包含：
     - `当前可研究`
     - `已完成`
     - `尚未满足前置`
   - 推荐把 `当前研究` 独立成卡片，而不是混入列表
   - 每个节点展示：
     - 科技名
     - 等级
     - 前置科技
     - 所需矩阵
     - 解锁建筑 / 配方 / special

4. `研究执行区`
   - 保留“开始研究”按钮
   - 选择目标改为点击 `当前可研究` 列表项，而不是 `<select>`
   - `completed` / `locked` 项不可触发研究

交互规则：

- 默认选中第一个 `available` 科技
- 若当前有 `current_research`，优先突出显示其进度
- `locked` 节点要明确显示缺失前置
- 移动端保持纵向堆叠，不引入 graph/canvas

#### B-3 unlock 展示能力补齐

目标文件：

- 修改：`client-web/src/features/planet-map/model.ts`

新增轻量 helper：

- `getRecipeDisplayName(catalog, recipeId)`

用途：

- 科技节点展示配方解锁
- 避免在 `PlanetCommandPanel.tsx` 内自行遍历 catalog 做名称转换

#### B-4 命令日志上下文扩展

目标文件：

- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/features/planet-commands/store.test.ts`

`CommandJournalFocus` 至少扩展以下字段：

- `buildingType?: string`
- `receiverMode?: "power" | "photon" | "hybrid"`

命令提交时的填充规则：

- `transfer_item`
  - 从当前选中的目标建筑写入 `buildingType`
  - 若目标为研究站，可继续附带 `techId`
- `set_ray_receiver_mode`
  - 写入 `buildingType = "ray_receiver"`
  - 写入 `receiverMode`

这样 `resolveNextHint()` 才能基于上下文而不是靠猜。

#### B-5 下一步提示按上下文分派

目标文件：

- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-commands/store.test.ts`

`resolveNextHint()` 最终规则：

- `transfer_item + matrix_lab`
  - `物料已装入研究站，下一步可启动 <techId>`
- `transfer_item + em_rail_ejector`
  - `太阳帆已装入电磁弹射器，下一步可发射太阳帆扩展戴森云`
- `transfer_item + vertical_launching_silo`
  - `火箭已装入发射井，下一步可发射火箭构建戴森球结构`
- `set_ray_receiver_mode + power`
  - `射线接收站已切到 power，下一步观察电网回灌是否生效`
- `set_ray_receiver_mode + photon`
  - `射线接收站已切到 photon，下一步观察光子产出与后续反物质链`
- `set_ray_receiver_mode + hybrid`
  - `射线接收站已切到 hybrid，下一步同时关注电网回灌与接收输出`
- 其它上下文保留通用兜底提示

这样可以同时修正：

- 开局研究站装料提示
- midgame 太阳帆/火箭装料提示
- 射线接收站模式切换后的下一步提示

#### B-6 样式方向

目标文件：

- 修改：`client-web/src/styles/index.css`

样式重点不是做新页面，而是建立清晰的信息层次：

- `当前研究` 卡片单独突出
- `当前可研究` 对比度最高
- `已完成` 降低对比度
- `锁定` 明确显示锁定态与前置缺失
- `推荐路径` 用浅提示块承载

### 3.4 文件边界

本任务最终改动边界如下：

- 新增：`client-web/src/features/planet-map/research-workflow.ts`
- 新增：`client-web/src/features/planet-map/research-workflow.test.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-map/model.ts`
- 修改：`client-web/src/styles/index.css`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- 修改：`client-web/src/features/planet-commands/store.test.ts`
- 新增：`client-web/tests/research-workflow.spec.ts`

### 3.5 回归要求

#### 单元与组件回归

至少覆盖以下断言：

1. 默认新局时显示：
   - 推荐路径
   - `当前可研究`
   - `已完成`
   - `尚未满足前置`
2. `electromagnetism` 可被选中并触发 `start_research`
3. 终局科技不再和开局科技混在同一扁平输入控件里
4. `research-workflow.ts` 能正确派生 `available/completed/locked`
5. `store.ts` 能根据 `buildingType` 生成不同提示
6. `store.ts` 能根据 `receiverMode` 生成不同提示

#### 浏览器回归

至少两条：

1. 默认新局
   - 打开 `/planet/planet-1-1`
   - 进入 `研究与装料`
   - 看到推荐路径与分组研究列表
   - 完成 `electromagnetism` 后，节点从“当前可研究”转入“已完成”

2. midgame
   - 给 `em_rail_ejector` 装 `solar_sail`
   - 给 `vertical_launching_silo` 装 `small_carrier_rocket`
   - 切换 `ray_receiver` 模式
   - 分别看到正确的下一步提示

建议：

- Playwright 路由 stub 用于稳定断言
- 再补一次真实浏览器手工走查，确认页面实际可玩

### 3.6 非目标

- 不新增服务端科技树专用接口
- 不把研究页重做成独立整页
- 不做完整可缩放科技树图谱

---

## 4. 实施顺序

最终实施顺序固定如下：

1. 先完成任务 A，恢复 `/agents` 的最小可玩链路
2. 再完成任务 B 的研究派生层与研究 UI 分组
3. 最后收口任务 B 的上下文提示与浏览器回归

原因：

- 任务 A 当前是功能 blocker
- 任务 B 属于体验与引导增强，但不阻塞基础研究能力

---

## 5. 风险与收口原则

### 5.1 任务 A

风险：

- 如果把所有无 `type` 的动作都静默跳过，会掩盖真实 schema 错误
- 如果不统一 prompt 契约，provider 仍会被错误引导

收口原则：

- 只忽略真正空动作
- 有语义但不完整的动作继续失败
- 失败要进入 `provider_schema_invalid`，而不是继续落到 `unknown`

### 5.2 任务 B

风险：

- 如果研究状态派生继续直接堆在 `PlanetCommandPanel.tsx`，组件会进一步失控
- 如果提示文案仍只依赖 `techId`，midgame 上下文错误会持续复发

收口原则：

- 研究派生逻辑收口到独立模块
- 提示文案至少基于 `commandType + buildingType (+ receiverMode)` 决策

---

## 6. 最终设计结论

本轮两项任务都不需要新增后端业务接口，核心都是把现有真实能力正确暴露出来：

- 任务 A 的本质是修正 agent runtime 对“直接回复完成态”的公共契约
- 任务 B 的本质是把已有科技与研究数据，从调试式输入控件重构为阶段化玩家工作流

最终实现必须同时满足三件事：

- 能玩：默认新局与 `/agents` 主链路可跑通
- 能测：单元、集成、浏览器回归都有收口
- 能维护：公共契约清晰，新增派生逻辑不再继续放大耦合
