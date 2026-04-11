# 2026-04-11 Web 与智能体回归问题最终实现方案

本文档基于以下两份设计稿综合收敛：

- `docs/process/design_codex.md` 的当前工作区版本
- `docs/process/design_claude.md` 的最近正式版本（当前工作区该文件已删除，因此以 `HEAD` 版本为准）

最终方案以已归档任务 `docs/process/archive/20260411_142700/T106_2026-04-11_Web试玩与智能体回归问题.md` 为唯一任务边界，以当前仓库真实代码和真实试玩证据为准，不再沿用旧的“两项独立任务”口径。

---

## 1. 综合结论

两份设计稿里，`Codex` 方案对本轮真实问题边界判断更准确，应作为主方案；`Claude` 方案中仍有价值的内容，主要体现在以下两个方向：

1. 研究工作流的数据分组与新手引导思路可以保留，但应落到现有 `research-workflow.ts` 派生层中，而不是继续把逻辑堆进 `PlanetCommandPanel.tsx`。
2. provider repair 需要返回“字段级错误 + 最小正确示例”，这一点应吸收进 `agent-gateway` 的最终方案中。

同时，`Claude` 方案里关于下面这些点，当前代码已经基本具备，不再作为本轮核心设计目标：

- `parseProviderResult()` 的纯文本回落
- `normalizeProviderTurn()` 忽略真正空壳 action
- prompt 允许 `assistantMessage + actions: [] + done: true`

因此，本轮最终方案不再围绕“让 provider 能回纯文本”展开，而是围绕 `T106` 暴露出的 6 个问题，收敛成 3 个实现主题：

1. `client-web` 行星页建造工作流闭环
2. `client-web` 研究页窄栏交互稳定化
3. `agent-gateway` 智能体完成态与错误暴露收口

---

## 2. 设计原则

- 以 authoritative 结果为准，前端只做预检、解释和工作流收口，不伪造成功。
- 默认暴露“玩家此刻最该做的事”，调试能力必须显式切到高级模式。
- 能收敛到公共 runtime 契约的，一律不做 provider 专属补丁。
- turn 成功的定义必须是“用户结果已经交付”，不是“中间动作已经触发”。
- 已有接口如果阻碍优雅实现，直接改公开契约和调用点，不叠适配层。
- 组件只负责渲染；派生、翻译、账本归因、turn 完成判断都拆到独立模块。

---

## 3. 当前代码现状与最终取舍

### 3.1 已经完成、无需再作为主设计项的部分

经核对当前代码，以下能力已存在：

- `agent-gateway/src/providers/index.ts`
  - 非 JSON 文本会回落为 `assistantMessage + [] + done:true`
  - 有 `assistantMessage` 且 `actions` 缺失时，会默认空数组
- `agent-gateway/src/runtime/action-schema.ts`
  - 已会忽略真正空壳 action
- `agent-gateway/src/runtime/loop.ts`
  - `done=true` 时若没有 `final_answer`，可直接使用 `assistantMessage`
- `agent-gateway/src/runtime/provider-turn-runner.ts`
  - prompt 已允许 `assistantMessage + [] + true`
- `client-web/src/features/planet-map/research-workflow.ts`
  - 已存在研究分组和新手引导的派生层
- `client-web/src/features/planet-commands/store.ts`
  - 已有按 `buildingType` 生成部分 `transfer_item` 成功提示的基础

这意味着本轮不应再把“回复链路完全不可用”当成主问题，而应继续收口剩余的 correctness 与 usability 缺口。

### 3.2 本轮真正待解决的缺口

| 问题组 | 最终判断 |
| --- | --- |
| 建造列表默认暴露过宽、距离/供电提示不闭环 | 需要新增建造派生层和事件账本归因 |
| 研究页真实点击被拦截 | 不是 z-index 小修小补，而是窄栏布局模型错误 |
| observe/agent.create/research 委派“动作发生了但结果没交付” | 需要新增 turn 完成态检查和 closeout repair |
| 智能体参数构造脆弱、UI 吞错误 | 需要 schema 别名归一化、字段级 repair、前端展示真实错误 |

---

## 4. 最终方案 A：Web 行星页建造工作流闭环

这一部分以 `design_codex.md` 为主，结论不变。

### 4.1 新增纯派生层 `build-workflow.ts`

新增：

- `client-web/src/features/planet-map/build-workflow.ts`

职责：

- 从 `catalog.buildings`、`summary.players[playerId]`、`planet.units`、`planet.buildings`、`networks.power_coverage`、当前选中坐标、最近相关账本条目中，统一派生建造工作流视图。
- 不持久化，不直接发 API，不把逻辑散落在组件内。

建议输出结构：

```ts
export interface BuildCatalogGroup {
  recommended: BuildingCatalogEntry[];
  unlocked: BuildingCatalogEntry[];
  locked: BuildingCatalogEntry[];
  debugOnly: BuildingCatalogEntry[];
}

export interface BuildReachability {
  executorUnitId?: string;
  executorPosition?: Position;
  operateRange?: number;
  distance?: number;
  inRange: boolean;
}

export interface BuildActionHint {
  tone: "info" | "warning" | "error";
  title: string;
  detail: string;
  suggestedAction?: "move_executor" | "build_power" | "inspect_power";
}

export interface BuildWorkflowView {
  catalog: BuildCatalogGroup;
  reachability: BuildReachability;
  preflightHints: BuildActionHint[];
  postBuildHints: BuildActionHint[];
}
```

### 4.2 建造列表默认收口规则

最终采用 `Codex` 的“默认玩家模式 + 显式高级模式”，并吸收 `Claude` 在研究分组中的“状态化可见性”思想。

默认模式只显示：

- `buildable === true`
- 且当前玩家已通过 `unlock_tech` 解锁的建筑

默认列表分成两层：

- `recommended`
  - 当前阶段高频、应优先暴露给玩家的建筑
- `unlocked`
  - 已解锁但不是主推荐路径的建筑

高级模式才显示：

- 全量已解锁建筑
- 未解锁但需要调试查看的建筑，显式标记 `未解锁`
- `unlock_tech` 缺失且 `buildable=true` 的目录异常项，显式标记 `目录异常`

默认工作流不再允许把 60 个建筑直接塞进一个大下拉里。

### 4.3 距离预检必须与服务端同源

Web 预检采用与 `server/internal/gamecore/executor.go` 相同的 `ManhattanDist` 规则。

前端需要直接展示：

- 当前执行体 ID
- 执行体坐标
- 当前目标坐标
- `distance / operateRange`

当超范围时：

- 不隐藏提交按钮
- 显示阻塞提示
- 提供“切到移动工作流并带入目标坐标”的次级动作

不在第一版引入自动寻路或自动找最近可达格。

### 4.4 建造后提示要继续跟随 authoritative 事件

扩展 `client-web/src/features/planet-commands/store.ts`，把建造后的 `entity_created` 与 `building_state_changed` 继续收口到同一条 journal entry 上。

推荐规则：

1. `build` 提交后，先记录目标坐标
2. 收到同坐标 `entity_created` 时，把新建 `building_id` 回写到 entry
3. 收到对应 `building_state_changed` 后，基于 `state_reason` 生成下一步提示

关键 reason 对应：

- `power_out_of_range`
  - 补供电塔
- `power_no_provider`
  - 补发电源
- `under_power`
  - 电网已接入但发电不足
- `power_capacity_full`
  - 电网节点满载，需要扩容

### 4.5 错误翻译层单独抽出

新增：

- `client-web/src/features/planet-commands/error-hints.ts`

用途：

- 把 authoritative 错误翻译成可操作提示
- 保留原始原因，不吞掉服务端信息

文案结构统一为：

- 主文案：下一步该做什么
- 次文案：`authoritative: ...`

例如：

- `executor out of range: 7 > 6`
  - 主文案：当前执行体距离目标 7 格，但可操作范围只有 6 格；先移动执行体再建造。
- `power_out_of_range`
  - 主文案：建筑未接入供电覆盖范围；先补供电塔。

### 4.6 组件层改动

主要改动文件：

- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-commands/store.ts`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/styles/index.css`

具体要求：

- `PlanetCommandPanel`
  - 建造区顶部新增“建造前检查”
  - 默认展示推荐/已解锁建筑
  - 高级模式开关展开全量内容
  - 最近结果区优先展示当前建造相关阻塞信息
- `PlanetPanels`
  - 建筑详情中的 `state_reason` 不再直接裸露原始字符串
  - 增加“建议下一步”
- 样式
  - 阻塞提示优先级高于普通命令结果
  - 高级模式视觉层级明确次于主流程

---

## 5. 最终方案 B：研究页窄栏交互稳定化

这一部分采用“`Codex` 的布局判断 + `Claude` 的研究分组与新手引导细节”。

### 5.1 总体取舍

最终不采用：

- 只修 z-index / pointer-events
- 重新做全屏科技树页
- 把研究状态派生重新塞回 `PlanetCommandPanel.tsx`

最终采用：

- 保留 `research-workflow.ts` 作为研究数据派生层
- 保留研究分组、当前研究卡片、新手推荐路径、上下文提示
- 但在 `268px` 的 `planet-detail-shell` 里，研究区必须改成单列窄栏工作流

### 5.2 研究派生层的最终职责

沿用并扩展：

- `client-web/src/features/planet-map/research-workflow.ts`

它继续负责：

- `current / available / completed / locked` 分组
- 当前研究进度和阻塞原因
- 新手推荐路径
- 科技卡片显示文案

不再把这些 `useMemo` 重新散落到 `PlanetCommandPanel.tsx` 内部。

### 5.3 研究区最终布局

研究工作流在右侧操作区内改成单列堆叠：

1. 当前研究 / 研究执行区
2. 当前可研究
3. 已完成
4. 尚未满足前置

其中：

- `当前可研究` 是唯一高频真实点击主列表
- `已完成` 与 `尚未满足前置` 使用折叠区或次级卡片
- 新手推荐路径只在开局早期显示

这部分吸收了 `Claude` 的分组与引导思路，但用 `Codex` 的“窄栏单列”来解决真实点击问题。

### 5.4 交互与文案要求

保留并收口以下体验：

- 当前研究卡片
  - 显示科技名、进度、阻塞原因
- 开局推荐路径
  - 仅在尚未完成 `electromagnetism` 时显示
- 装料成功提示
  - `matrix_lab`：装入研究站后提示可继续启动研究
  - `em_rail_ejector`：提示可继续发射太阳帆
  - `vertical_launching_silo`：提示可继续发射火箭
  - `ray_receiver`：提示可切换发电/光子模式

这里不新建第二套提示逻辑，直接基于现有 `store.ts` 扩展。

### 5.5 CSS 与 DOM 约束

关键样式要求：

- `.research-groups`
  - 固定为单列布局
- `.research-group`
  - `min-width: 0`
- `.research-tech-list`
  - `min-width: 0`
- `.research-tech-card`
  - `width: 100%`
  - `min-width: 0`
  - 长文本允许换行
- 长标签文本
  - `overflow-wrap: anywhere`

如果后续真的需要宽屏多列，也必须基于容器宽度判断，而不是固定 `repeat(3, 1fr)`。

### 5.6 真实点击回归要求

`Playwright` 必须覆盖真实点击，不允许：

- `force: true`
- 直接绕过科技卡片，只测“开始研究”按钮

最小回归路径：

1. 打开行星页
2. 切到“研究与装料”
3. 真实点击 `电磁学`
4. 断言没有 pointer interception
5. 点击“开始研究”
6. 验证命令成功发出

---

## 6. 最终方案 C：智能体完成态与错误暴露收口

这一部分采用 `Codex` 的主判断，并吸收 `Claude` 在 repair 细节上的可执行建议。

### 6.1 最终判断

当前 `agent-gateway` 已经具备：

- 纯文本回落
- 空壳 action 忽略
- `assistantMessage` 直出完成态

但真正未解决的是：

- `observe` 执行了动作，却没交付最终一句话总结
- `agent.create` 仍可能停在规划句
- `transfer_item + start_research` 参数构造脆弱
- `/agents` 页面仍会吞掉真实错误

所以本轮的中心不是 parser 容错，而是“结果交付完成态 + 字段级 repair + 错误可见性”。

### 6.2 新增 `turn-completion.ts`

新增：

- `agent-gateway/src/runtime/turn-completion.ts`

建议结构：

```ts
export interface TurnCompletionCheck {
  complete: boolean;
  needsCloseoutRepair: boolean;
  reason?: "missing_final_delivery" | "still_planning";
}
```

职责：

- 在“动作是否发生”之外，再判断“用户结果是否已交付”

判定规则：

- `observe`
  - 必须执行过 observe 类 `game.command`
  - 最终回复不能停在“已提交/待结果返回/稍后总结”
- `game_mutation`
  - 如果用户要求“完成后回复结果”，最终回复必须给出结果
- `agent_management`
  - `agent.create` 成功后，最终回复必须明确说明已创建结果，而不是“我现在创建”

### 6.3 `runAgentLoop` 改成两段式 repair

保留现有动作修复，但增加收尾修复：

1. 执行修复
  - 缺少 intent 所需动作时触发
2. 收尾修复
  - 动作已执行，但最终回复仍未闭环时触发

收尾修复 prompt 吸收 `Claude` 的“更具体 repair”思路，建议类似：

> 你已经拿到工具执行结果。现在请只输出最终结论，不要再回复“已提交/待结果返回”。如果信息已经足够，请直接给用户一句话总结或明确结果。

这样 observe 不会再停在“扫描成功，但结果待总结”。

### 6.4 `game-command-schema` 增加字段别名归一化

修改：

- `agent-gateway/src/runtime/game-command-schema.ts`

兼容常见 snake_case 别名：

- `buildingId` / `building_id`
- `itemId` / `item_id`
- `techId` / `tech_id`
- `planetId` / `planet_id`
- `systemId` / `system_id`
- `buildingType` / `building_type`

这不是兼容旧业务接口，而是对 LLM 输出进行归一化。

### 6.5 `openai-compatible` repair 必须返回字段级错误

修改：

- `agent-gateway/src/providers/openai-compatible.ts`

不再只说“请返回合法 JSON”，而要把具体 schema 错误带回模型，并给最小正确示例。

例如：

```text
上一轮结构错误：transfer_item requires buildingId。
如果你要给 b-9 装料，必须返回：
{"type":"game.command","command":"transfer_item","args":{"buildingId":"b-9","itemId":"electromagnetic_matrix","quantity":10}}
请返回修正后的完整 JSON。
```

这部分直接吸收 `Claude` 的 repair 细化建议，但放到公共 `openai-compatible` runtime 中，而不是 MiniMax 特供。

### 6.6 `provider-turn-runner` 增加 few-shot

修改：

- `agent-gateway/src/runtime/provider-turn-runner.ts`

补三类关键示例：

- observe
- `agent.create`
- `transfer_item + start_research`

目标不是写很长 prompt，而是明确：

- 第一轮做动作可 `done:false`
- 结果到齐后必须收尾
- 不允许“待结果返回”同时 `done:true`

### 6.7 gateway 工具结果要更适合收尾复述

修改：

- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/server.ts`

`createAgent`、`updateAgent`、`ensureDirectConversation` 等工具结果应尽量返回结构化、可复述的信息，而不是只给含糊字符串。

例如 `createAgent` 结果至少应包含：

- `id`
- `name`
- `providerId`
- `policy`

这样 closeout reply 才能稳定产出“胡景已创建，权限已限制为 ...”。

### 6.8 turn 失败时保留并展示真实错误

修改：

- `agent-gateway/src/types.ts`
- `shared-client/src/types.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- `client-web/src/pages/AgentsPage.tsx`

建议扩展 turn 字段：

```ts
errorCode?: string;
errorMessage?: string;
rawErrorMessage?: string;
errorHint?: string;
```

展示顺序：

1. 失败原因
2. 真实错误
3. 建议处理

例如：

- `errorCode = provider_schema_invalid`
- `rawErrorMessage = transfer_item requires buildingId`
- `errorHint = 缺少目标建筑 ID，请明确研究站或装料建筑，例如 b-9。`

### 6.9 `/agents` 页面成功态也要更严格

前端不再仅按 `turn.status === succeeded` 就显示“成功完成”，还要结合返回内容是否已经进入最终交付态。

至少在 UI 上做到：

- observe 类任务只有拿到最终总结后，才展示为有效结果
- `provider_incomplete_execution` 不再只显示固定一句“这轮只有规划”，而应区分：
  - 缺动作
  - 动作执行了但未收尾

---

## 7. 文件边界

### 7.1 `client-web`

- 新增：`client-web/src/features/planet-map/build-workflow.ts`
- 新增：`client-web/src/features/planet-commands/error-hints.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/features/planet-map/PlanetPanels.tsx`
- 修改：`client-web/src/features/planet-map/research-workflow.ts`
- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/styles/index.css`
- 修改：`client-web/src/features/agents/ChannelWorkspaceView.tsx`
- 修改：`client-web/src/pages/AgentsPage.tsx`

### 7.2 `agent-gateway`

- 新增：`agent-gateway/src/runtime/turn-completion.ts`
- 修改：`agent-gateway/src/runtime/turn-validator.ts`
- 修改：`agent-gateway/src/runtime/loop.ts`
- 修改：`agent-gateway/src/runtime/game-command-schema.ts`
- 修改：`agent-gateway/src/runtime/provider-turn-runner.ts`
- 修改：`agent-gateway/src/providers/openai-compatible.ts`
- 修改：`agent-gateway/src/server.ts`
- 修改：`agent-gateway/src/types.ts`

### 7.3 `shared-client`

- 可能修改：`shared-client/src/types.ts`

仅在需要把 turn 错误字段同步到前端时修改。

---

## 8. 实施顺序

### 第 1 阶段：`agent-gateway` 完成态与错误暴露

优先原因：

- 这是 correctness blocker
- 直接影响 `/agents` 是否真的可用

本阶段完成后，至少应保证：

- observe 能交付最终总结
- `agent.create` 不再停在规划句
- research 委派失败时能看到真实参数错误

### 第 2 阶段：行星页建造工作流闭环

本阶段完成后，至少应保证：

- 默认新局不再暴露大量未解锁建筑
- 超距离建造会给出明确预检提示
- 新建后缺电会有下一步建议

### 第 3 阶段：研究页窄栏重排与真实点击回归

本阶段完成后，至少应保证：

- 研究卡片真实点击稳定
- 研究区在窄栏中可读
- 研究/装料提示与当前上下文一致

---

## 9. 测试与验收

### 9.1 单元 / 集成测试

建议新增或修改：

- `client-web/src/features/planet-map/build-workflow.test.ts`
  - unlock 过滤
  - Manhattan 距离计算
  - 供电提示派生
- `client-web/src/features/planet-commands/store.test.ts`
  - `entity_created -> building_state_changed` 账本收口
  - `executor out of range` 翻译
  - `under_power / power_out_of_range` 翻译
  - `transfer_item` 的上下文提示
- `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
  - 默认模式不显示未解锁建筑
  - 高级模式展开后才显示全量入口
  - 研究区单列结构与可选科技点击
- `agent-gateway/src/runtime/loop.test.ts`
  - observe 已扫描但只回复计划句时，触发 closeout repair
  - observe 最终无总结时判失败
  - `agent.create` 成功后必须有最终结果回复
  - snake_case 参数别名归一化
- `agent-gateway/src/server.test.ts`
  - turn 失败时持久化 `rawErrorMessage`
  - turn 成功时 `finalMessage` 必须是用户结果，不是计划句

### 9.2 浏览器回归

建议新增或修改：

- `client-web/tests/research-workflow.spec.ts`
  - 真实点击 `电磁学`
  - 不出现 pointer interception
  - 可继续“开始研究”
- `client-web/tests/agent-platform.spec.ts`
  - observe 私聊返回一句话总结
  - 创建胡景成功，并能在成员列表中看到
  - research 委派失败时展示具体参数错误
- 可能新增：`client-web/tests/planet-build-workflow.spec.ts`
  - 默认新局建造列表默认收口
  - midgame 超范围建造给出距离提示
  - midgame 新建建筑缺电时看到后续建议

### 9.3 与 T106 对齐的验收矩阵

| T106 验收项 | 最终设计落点 |
| --- | --- |
| 默认新局不再默认暴露大量未解锁建筑 | §4.2 |
| 研究卡片真实点击稳定 | §5.3 ~ §5.6 |
| midgame 超距离建造与缺电有下一步引导 | §4.3 ~ §4.5 |
| observe 只有交付最终总结后才算成功 | §6.2 ~ §6.3 |
| 创建下级成员链路可真实创建成功 | §6.2、§6.6、§6.7 |
| 科研委派失败时能暴露真实错误，成功时可稳定执行 | §6.4 ~ §6.9 |
| 已确认可用的戴森主链与 midgame 建筑不回退 | 全部改动均只收口工作流与 runtime 契约，不改玩法规则 |

---

## 10. 非目标

本轮明确不做：

- 新增专用 `build-advisor` 服务端接口
- 把研究页改成独立全屏科技树
- 为单个 provider 写特供分支
- 新增游戏规则、建筑或科技
- 通过吞掉 authoritative 错误来伪装成功
- 把已经完成的“纯文本 turn 容错”重新作为主实现目标

---

## 11. 最终结论

最终方案的核心不是再补一层“兼容”，而是把当前已经存在的 authoritative 能力和基础容错，继续收敛成对玩家和智能体都真正可用的闭环：

- Web 端默认只暴露当前该做的事，并把失败原因翻译成下一步动作。
- 研究页要尊重右侧窄栏宿主，不再把三列卡片硬塞进 `268px` 容器。
- 智能体 turn 只有在真正交付用户结果后才允许成功，失败时必须把真实错误暴露出来。

按本方案实施后，`T106` 的 6 项问题可以统一收口到同一套前端派生层、runtime 完成态检查和浏览器回归之下，不需要引入新的玩法系统，也不需要为某个 provider 单独打补丁。
