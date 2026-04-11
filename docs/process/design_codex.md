# 2026-04-11 Web 未实现功能详细设计方案（Codex）

本文档只覆盖当前 `docs/process/task/` 下仍未实现的两项任务：

1. `docs/process/task/2026-04-11_web-agent工作台默认provider回复链路仍然失效.md`
2. `docs/process/task/2026-04-11_web科研与科技树交互仍不够优雅.md`

设计依据来自当前仓库真实实现，而不是历史口径。重点参考了以下代码与文档：

- `agent-gateway/src/providers/index.ts`
- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/server.ts`
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-commands/store.ts`
- `client-web/tests/agent-platform.spec.ts`
- `client-web/tests/visual.spec.ts`
- `docs/dev/服务端API.md`

## 1. 设计原则

- 优先修正公共契约，不做只对 `builtin-minimax-api` 生效的临时适配层。
- 保持实现直接，避免把“容错”扩散成多层包装逻辑。
- 对前端新增交互，优先拆出独立派生层，避免继续膨胀 `PlanetCommandPanel.tsx`。
- 自动化回归分成两层：
  - 确定性单元/集成测试负责收口真实根因。
  - 浏览器回归负责验证玩家看到的交互与文案。

## 2. 总体优先级

- `P0`：修复 Web 智能体工作台默认 Provider 回复链路。当前这是主功能 blocker。
- `P1`：重做 Web 科研与科技树入口，并收口研究/装料/射线接收站提示文案。

---

## 3. 任务 A：Web 智能体工作台默认 Provider 回复链路修复

### 3.1 当前真实问题链路

当前失败并不是单点问题，而是四层契约同时偏严：

1. `agent-gateway/src/providers/index.ts` 能把 MiniMax 返回文本解析成 `{ assistantMessage, actions, done }`，但只要 `actions` 中出现空对象，后续仍会炸。
2. `agent-gateway/src/runtime/action-schema.ts` 的 `normalizeProviderTurn()` 会对 `actions.map(normalizeAction)`，空对象会触发 `action.type is required`。
3. `agent-gateway/src/runtime/loop.ts` 即使拿到合法的 `assistantMessage + actions: [] + done: true`，仍会因为没有 `final_answer` 而抛出 `final_answer is required when done is true`。
4. `agent-gateway/src/server.ts` 还把 `assistantMessage` 明确描述成“仅规划预览，正式回复必须走 final_answer”，这和任务要求的“无工具动作、直接回复”正面冲突。

结果是：

- MiniMax 只要返回 `actions: [{}]`，整轮 turn 直接失败。
- 就算返回 `actions: []`，当前对话型 turn 依然会失败。
- 失败被 `client-web` 展示为 system failure，玩家只能看到“成员能建但不能工作”。

### 3.2 设计目标

- 允许最简单的完成态：`{ assistantMessage: "文本回复", actions: [], done: true }`
- 允许 provider 返回纯文本，系统自动包装成无动作完成态
- 只忽略真正的“空动作占位”，不吞掉有语义但字段不完整的非法动作
- 保留 `final_answer` 作为显式正式回复动作，但不再强制它是唯一完成出口
- 失败时把结构错误归类为 `provider_schema_invalid`，不再落成 `unknown`

### 3.3 方案比较

#### 方案 A1：只给 `builtin-minimax-api` 增加专用适配

做法：

- 只在 MiniMax Provider 结果上把空动作转为空数组
- 只在内置 Provider 上把 `assistantMessage` 注入成 `final_answer`

优点：

- 改动面小

缺点：

- 问题根因在公共 runtime 契约，不在 MiniMax 本身
- 其它 HTTP Provider 未来仍会踩同一个坑
- 明显违反“不要用兼容层遮丑”的项目准则

结论：

- 不采用

#### 方案 A2：放宽公共 turn 契约，保留显式动作语义

做法：

- 公共 parser 支持纯文本回落
- 公共 action normalize 仅忽略空动作壳
- 公共 loop 接受 `assistantMessage` 作为 done 态兜底正式回复

优点：

- 直接修正真实契约
- 不引入 provider 特判
- 和当前任务要求完全一致

缺点：

- 需要同步改测试与 prompt 说明

结论：

- 推荐采用

#### 方案 A3：继续强制 `final_answer`，只靠 prompt 把模型“训乖”

做法：

- 不改 runtime
- 只强化 prompt，让模型始终输出 `final_answer`

优点：

- 代码改动最小

缺点：

- 仍然把系统正确性建立在外部模型是否听话上
- 任务已经说明当前真实 provider 会返回空动作/直接文本，这条路不稳

结论：

- 不采用

### 3.4 推荐方案

采用方案 A2：修公共 turn 契约，不做 provider 专属补丁。

### 3.5 详细设计

#### A5.1 Provider 解析层：支持纯文本完成态

目标文件：

- `agent-gateway/src/providers/index.ts`
- `agent-gateway/src/providers/providers.test.ts`

设计：

- `parseProviderResult(raw)` 外层保留现有 JSON 提取逻辑。
- 如果 `normalizeStructuredJsonText(raw)` 最终仍无法被 `JSON.parse`，则把原始文本包装为：
  - `assistantMessage = raw.trim()`
  - `actions = []`
  - `done = true`
- 对已经成功解析成对象的 payload，继续维持结构化校验，不把所有缺字段 JSON 都默默吞掉。

原因：

- 任务要求明确支持“无工具动作、直接回复”。
- 纯文本回复是合理降级；结构化 JSON 一旦缺关键字段，则更像 provider schema 错误，不能全部自动修复。

#### A5.2 Action 归一化层：只忽略真正的空动作壳

目标文件：

- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/runtime/action-schema.test.ts`

设计：

- 在 `normalizeProviderTurn()` 中先做一轮 action 预筛选。
- 可忽略对象仅限以下两类：
  - 空对象：`{}`
  - 只有空 `args` 包装、展开后仍无任何字段的对象
- 以下对象仍然视为错误，不能静默跳过：
  - 有 `type` 但缺少必要字段，例如 `{"type":"game.cli"}`
  - 没有 `type`，但带有其它业务字段，例如 `{"commandLine":"scan_planet planet-1-1"}`
  - 未支持动作类型，例如 `{"type":"foo.bar"}`

这样做的边界是：

- 忽略模型生成的“占位空项”
- 继续对真实非法动作报错，避免把错误工具调用悄悄吃掉

#### A5.3 Loop 完成语义：允许 assistantMessage 直接成为正式回复

目标文件：

- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/loop.test.ts`
- `agent-gateway/src/server.test.ts`

新规则：

1. 如果动作中出现 `final_answer`，`final_answer.message` 仍然是最高优先级正式回复。
2. 如果 `turn.done === true` 且本轮没有 `final_answer`，则：
   - 当 `assistantMessage.trim() !== ""` 时，直接把 `assistantMessage` 作为 `finalMessage`
   - 当 `assistantMessage` 也为空时，才判为 schema invalid
3. 如果 `turn.done === false`，`assistantMessage` 仍然只代表当前阶段说明，不提前结束 turn。

这样可以同时兼容两种 provider 风格：

- 显式动作风格：`assistantMessage + final_answer`
- 直接回复风格：`assistantMessage + [] + done:true`

#### A5.4 Prompt 契约统一收口，不再让 server 端提示与 runtime 规则冲突

目标文件：

- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/server.ts`
- `agent-gateway/src/bootstrap/minimax.ts`

设计：

- 在公共 prompt 中明确：
  - `assistantMessage` 必须始终是给玩家/会话可读的自然语言
  - 若本轮无需继续执行动作并且 `done=true`，可以直接用 `assistantMessage` 结束
  - 若需要显式提交正式答复，也可以使用 `final_answer`
- 删除 `server.ts` 里“assistantMessage 只能作为预览，正式回复必须通过 final_answer 提交”的硬约束文案。
- `bootstrap/minimax.ts` 的默认系统提示补充一条最小示例：
  - `{"assistantMessage":"收到，我先观察当前状态。","actions":[],"done":true}`

这里的重点不是把逻辑塞到某个 provider 中，而是让所有 provider 看到同一份真实契约。

#### A5.5 错误分类：结构错误不再落成 unknown

目标文件：

- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/server.test.ts`

设计：

- 将以下错误纳入 `provider_schema_invalid`：
  - `action.type is required`
  - `action must be an object`
  - `provider turn must be an object`
  - `final_answer is required when done is true`
- 继续保留：
  - `not supported` -> `unsupported_action`
  - 网络/502/timeout -> `provider_unavailable`

即使未来仍有 provider 结构错误，玩家也应看到“模型返回结构无效”，而不是泛化成 `unknown`。

### 3.6 文件边界

本任务推荐的改动边界如下：

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

### 3.7 回归设计

#### 自动化回归

`agent-gateway` 侧至少补齐以下用例：

1. `parseProviderResult()` 接受纯文本并回落成无动作完成态
2. `normalizeProviderTurn()` 会忽略 `actions: [{}]`，但不会忽略 `{"type":"game.cli"}` 这类残缺动作
3. `runAgentLoop()` 在 `done=true + actions=[] + assistantMessage=非空` 时返回成功
4. DM 会话集成测试中，provider 返回 `{"assistantMessage":"已收到你的私聊","actions":[{}],"done":true}`，最终应：
   - turn 状态为 `succeeded`
   - 会话里出现 agent 正式回复
   - 不出现 system failure

#### 浏览器回归

`client-web` 侧增加一条 `/agents` 浏览器回归，用路由 stub 验证：

- 发送私聊后，工作台能展示正式 agent 回复
- 不出现“回复失败：执行失败，请稍后重试”
- turn 详情面板处于成功态

这个回归只验证前端呈现，不替代上面的 `agent-gateway` 集成测试。

#### 手工复测

修复完成后必须重新做一次真实浏览器复测：

1. 打开 `/agents`
2. 新建成员 `李斯`
3. 绑定 `builtin-minimax-api`
4. 保存权限范围
5. 发起私聊并发送纯观察任务
6. 确认出现正式回复
7. 继续验证：
   - 创建下级成员
   - 分配权限
   - 下级执行至少一次建造或科研并 authoritative 成功

### 3.8 非目标

- 不重做整个 agent action DSL
- 不把所有 provider 输出错误都自动“修复”为成功回复
- 不为了兼容历史逻辑继续强推 `final_answer` 为唯一完成通道

---

## 4. 任务 B：Web 科研与科技树交互优化

### 4.1 当前真实问题

当前科研功能已可用，但交互仍停留在调试面板形态：

1. `client-web/src/features/planet-map/PlanetCommandPanel.tsx` 用 `techOptions` 把全部科技按 `level` 排序后塞进一个扁平 `<select>`。
2. 页面没有表达：
   - 当前可达
   - 已完成
   - 被什么前置锁住
   - 每项需要什么矩阵
   - 研究后解锁什么
3. `client-web/src/features/planet-commands/store.ts` 的 `resolveNextHint()` 只知道 `transfer_item + techId`，不知道装料目标建筑类型，所以 midgame 装太阳帆/火箭后仍提示“下一步启动 dyson_sphere_program”。
4. `PlanetCommandPanel.tsx` 已经非常大，再继续把科研派生逻辑和文案逻辑堆进去，后续维护成本会更差。

### 4.2 设计目标

- 把科研入口从扁平下拉改成阶段化视图
- 不增加新的后端 API，优先复用当前已有的 `catalog.techs` 与 `summary.players[playerId].tech`
- 首屏清晰表达默认新局的推荐科研路径
- 装料/模式切换后的下一步提示必须和上下文一致
- 把新增状态派生逻辑收口在独立模块，降低 `PlanetCommandPanel` 耦合

### 4.3 方案比较

#### 方案 B1：保留下拉框，只在旁边补说明

优点：

- 实现最省

缺点：

- 玩家仍然要在终局科技与开局科技之间人工筛选
- “现在该做什么”依然不直观

结论：

- 不采用

#### 方案 B2：按研究阶段分组展示科技节点，并把研究状态派生成独立层

优点：

- 满足任务要求中的“当前可研究 / 已完成 / 尚未满足前置”
- 现有数据已足够，不需要改 server
- 组件层和状态派生层职责清晰

缺点：

- 前端会新增一层 view-model 派生逻辑

结论：

- 推荐采用

#### 方案 B3：直接做完整科技树图谱

优点：

- 视觉上最完整

缺点：

- 当前任务只要求“更优雅、更可推进”，不是要做大型可视化
- 对移动端和测试成本都不友好

结论：

- 当前阶段不采用

### 4.4 推荐方案

采用方案 B2：抽出科研派生层，前端呈现改成阶段化列表，不做完整图谱。

### 4.5 详细设计

#### B5.1 新增研究派生层，避免把状态判断塞满 `PlanetCommandPanel`

目标文件：

- 新增：`client-web/src/features/planet-map/research-workflow.ts`
- 新增：`client-web/src/features/planet-map/research-workflow.test.ts`

建议在该模块内收口以下逻辑：

- `normalizeCompletedTechIds(techState)`：
  - 输入主路径按 `shared-client/src/types.ts` 的 `string[]` 处理
  - 若运行时仍遇到对象型 `completed_techs`，在这里统一归一化，不把兼容逻辑扩散到组件层
- `deriveResearchGroups(catalog, techState)`：
  - 输出 `current` / `available` / `completed` / `locked` 四类 view-model
- `formatTechUnlockLabel(catalog, unlock)`：
  - `building` 用建筑显示名
  - `recipe` 用配方名
  - `special` 用原始 ID 或专门文案
- `buildStarterGuide(techState)`：
  - 用来决定是否显示默认新局推荐路径

这样 `PlanetCommandPanel` 只消费已经派生好的 research view-model，不直接散落一堆 `Set`、`filter`、`every` 判断。

#### B5.2 研究 UI 从单下拉改成阶段化工作台

目标文件：

- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/styles/index.css`

新的研究区建议拆成四块：

1. `当前研究`
   - 显示 `current_research.tech_id`
   - 显示 `progress / total_cost`
   - 若有 `blocked_reason`，直接翻译为玩家可理解提示

2. `开局推荐路径`
   - 当 `electromagnetism` 尚未完成时显示：
     - `风机 -> 空研究站 -> 装 10 电磁矩阵 -> 研究 electromagnetism`
   - 这块只在默认新局/早期阶段出现，不污染 midgame

3. `科技阶段列表`
   - 至少包含：
     - `当前可研究`
     - `已完成`
     - `尚未满足前置`
   - 推荐额外固定显示 `正在研究`
   - 每个节点展示：
     - 科技名
     - 等级
     - 前置科技
     - 所需矩阵
     - 解锁建筑 / 配方 / special

4. `研究执行区`
   - 仍保留“开始研究”按钮
   - 但选择目标不再依赖 `<select>`，改为点击 `当前可研究` 列表项
   - `locked/completed` 节点不可触发研究

#### B5.3 交互行为

推荐交互规则：

- 默认选中第一个 `available` 科技
- 若当前有 `current_research`，优先展示其卡片和进度
- 已完成科技默认不可选，但可展开查看解锁内容
- 锁定科技要明确显示“缺哪些前置”
- 移动端保持纵向堆叠，不引入复杂 graph/canvas

#### B5.4 上下文提示不能再只靠 `techId`

目标文件：

- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改测试：`client-web/src/features/planet-commands/store.test.ts`

当前问题在于 `CommandJournalFocus` 信息不够。

建议把 `CommandJournalFocus` 扩展为至少包含：

- `buildingType?: string`
- `receiverMode?: "power" | "photon" | "hybrid"`

提交命令时填充方式：

- `transfer_item`
  - 从当前选中建筑带上 `buildingType`
  - 研究站装料仍可额外带 `techId`
- `set_ray_receiver_mode`
  - 带上 `buildingType = "ray_receiver"`
  - 带上 `receiverMode`

然后把 `resolveNextHint()` 改成按上下文分派：

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

这样研究站、中后期发射建筑、射线接收站会走不同提示，不再共享过时口径。

#### B5.5 为 unlock 展示补齐显示名能力

目标文件：

- 修改：`client-web/src/features/planet-map/model.ts`

当前已有：

- `getBuildingDisplayName`
- `getItemDisplayName`
- `getTechDisplayName`

建议补一个轻量 helper：

- `getRecipeDisplayName(catalog, recipeId)`

用途：

- 科技节点展示 recipe unlock
- 避免在 `PlanetCommandPanel` 内自己查 catalog 映射

#### B5.6 样式方向

目标文件：

- 修改：`client-web/src/styles/index.css`

不做“新页面”，只做研究工作流增强。样式方向如下：

- `当前可研究` 节点最高可见
- `已完成` 降低对比度
- `锁定` 节点显示锁定态与缺失前置
- `当前研究` 卡片单独突出
- `推荐路径` 用浅提示块承载

重点是信息层次清楚，不追求花哨图谱。

### 4.6 文件边界

本任务推荐的改动边界如下：

- 新增：`client-web/src/features/planet-map/research-workflow.ts`
- 新增：`client-web/src/features/planet-map/research-workflow.test.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-map/model.ts`
- 修改：`client-web/src/styles/index.css`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
- 修改：`client-web/src/features/planet-commands/store.test.ts`
- 新增：`client-web/tests/research-workflow.spec.ts`

### 4.7 回归设计

#### 单元/组件回归

至少覆盖以下断言：

1. `PlanetCommandPanel` 在默认新局时展示：
   - 开局推荐路径
   - `当前可研究`
   - `已完成`
   - `尚未满足前置`
2. `electromagnetism` 可研究时能被选中并触发 `start_research`
3. 终局科技不再和开局科技混在同一平面输入控件里
4. `store.ts` 能根据 `buildingType` 生成不同提示
5. `set_ray_receiver_mode` 能根据 `receiverMode` 生成不同提示

#### 浏览器回归

浏览器回归至少两条：

1. 默认新局：
   - 打开 `/planet/planet-1-1`
   - 进入 `研究与装料`
   - 看到推荐路径与分组研究列表
   - 成功完成 `electromagnetism` 后，节点状态从“可研究”变为“已完成”

2. midgame：
   - 给 `em_rail_ejector` 装 `solar_sail`
   - 给 `vertical_launching_silo` 装 `small_carrier_rocket`
   - 切换 `ray_receiver` 模式
   - 分别看到正确下一步提示

这里推荐使用 Playwright 路由 stub 保证稳定性，再辅以一次真实浏览器手工走查。

### 4.8 非目标

- 不新增服务端科技树专用接口
- 不把研究页重做成独立整页
- 不做完整可缩放科技树图谱

---

## 5. 实施顺序建议

1. 先完成任务 A，恢复 `/agents` 的最小可玩链路
2. 再做任务 B 的研究派生层与研究 UI 分组
3. 最后收口任务 B 的上下文提示与浏览器回归

原因：

- 任务 A 当前是功能性 blocker
- 任务 B 属于体验和引导增强，但不阻塞基础研究功能

## 6. 风险与收口

### 6.1 任务 A 风险

- 如果把所有无 `type` 的动作都静默跳过，可能会掩盖真实 schema 错误
- 如果不改 `server.ts` 的 prompt 文案，runtime 契约与对模型描述会继续自相矛盾

收口原则：

- 只忽略真正空动作
- 有语义但不完整的动作仍然失败

### 6.2 任务 B 风险

- 如果研究状态派生继续直接写在 `PlanetCommandPanel.tsx`，文件会进一步失控
- 如果提示文案仍只依赖 `techId`，中后期上下文错误会持续复发

收口原则：

- 研究状态判断收口到独立模块
- 提示文案至少基于 `commandType + buildingType (+ receiverMode)` 决策

## 7. 设计结论

两项任务都不需要新增后端业务接口，核心都是把现有真实能力正确暴露出来：

- 任务 A 的本质是修正 agent runtime 对“直接回复完成态”的公共契约。
- 任务 B 的本质是把已有科技与研究数据，从调试式输入控件重构成阶段化玩家工作流。

只要按本文档的边界实施，就可以在不增加额外耦合的前提下，把当前两项未实现功能收口成可玩、可测、可维护的状态。
