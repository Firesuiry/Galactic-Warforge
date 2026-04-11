# 2026-04-11 `docs/process/task` 未实现功能详细设计方案（Codex）

本文档对应的活跃任务已完成并归档。原始任务文件为：

- `docs/process/archive/20260411_142700/T106_2026-04-11_Web试玩与智能体回归问题.md`

对应的 6 个问题可以收敛成 3 个设计主题：

1. `client-web` 行星页建造工作流闭环
2. `client-web` 研究页真实点击稳定性
3. `agent-gateway` 智能体完成态与错误暴露收口

本文档以当前仓库真实实现、真实试玩证据和现有页面结构为准，不以历史口径或理想设定为准。重点参考：

- `docs/process/archive/20260411_142700/T106_2026-04-11_Web试玩与智能体回归问题.md`
- `.run/manual-playtest/evidence/default-web/report.json`
- `.run/manual-playtest/evidence/agents-web/report.json`
- `client-web/src/pages/PlanetPage.tsx`
- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/features/planet-commands/store.ts`
- `client-web/src/features/planet-map/use-planet-realtime.ts`
- `client-web/src/features/planet-map/research-workflow.ts`
- `client-web/src/styles/index.css`
- `client-web/tests/research-workflow.spec.ts`
- `agent-gateway/src/runtime/turn-validator.ts`
- `agent-gateway/src/runtime/loop.ts`
- `agent-gateway/src/runtime/provider-turn-runner.ts`
- `agent-gateway/src/runtime/game-command-schema.ts`
- `agent-gateway/src/runtime/action-schema.ts`
- `agent-gateway/src/providers/openai-compatible.ts`
- `agent-gateway/src/runtime/provider-error.ts`
- `agent-gateway/src/server.ts`
- `agent-gateway/src/types.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`
- `client-web/src/pages/AgentsPage.tsx`
- `server/internal/gamecore/executor.go`
- `server/internal/query/networks.go`
- `shared-client/src/types.ts`

## 1. 设计原则

- 以 authoritative 运行态为准，前端只做预检与解释，不伪造成功。
- 默认玩家工作流优先，调试能力必须显式进入高级模式，不再默认暴露。
- 不做 provider 专属补丁；能收敛到 `agent-gateway` 公共契约的，一律收敛到公共契约。
- 不再用“turn 已成功但回复仍是待处理”这种半完成态冒充完成态。
- 既有接口如果不利于优雅实现，直接改公开契约与调用点，不叠适配层。
- 方案拆分要按职责边界落文件，避免把导出视图、页面布局、错误翻译和 runtime 验证糊在一个文件里。

## 2. 当前真实判断

### 2.1 这轮暴露的问题本质上不是“玩法没实现”

`T106` 暴露出的 6 个问题里，真正缺失的不是服务器玩法规则，而是下面三类收口没有做完：

- Web 端没有把已有规则翻译成可操作工作流。
- 研究页布局放进了不适合它的容器宽度，导致真实点击被遮挡。
- 智能体 runtime 把“发起过动作”误当成“完成了用户请求”。

### 2.2 现有代码已经说明了根因

1. 建造列表过宽泛  
   `client-web/src/features/planet-map/PlanetCommandPanel.tsx` 当前直接：

   - 读取 `catalog.buildings`
   - 只按 `entry.buildable` 过滤
   - 再按名字排序

   这意味着只要服务端说“理论可建”，Web 就默认全部暴露，完全没利用 `unlock_tech` 与玩家当前 `completed_techs`。

2. 建造范围与供电提示没有闭环  
   前端虽然已经拿到：

   - `summary.players[playerId].executor / executors`
   - `planet.units`
   - `networks.power_coverage`
   - `building.runtime.state_reason`

   但 `PlanetCommandPanel` 没有把这些信息收敛成“提交前预检 + 提交后下一步提示”。

3. 研究页布局与容器宽度冲突  
   `PlanetPage` 把操作区放在右侧 `planet-detail-shell`，该列宽固定为 `268px`；  
   但 `client-web/src/styles/index.css` 里 `.research-groups` 仍然是：

   ```css
   grid-template-columns: repeat(3, minmax(0, 1fr));
   ```

   这在 `268px` 列内天然不成立。`default-web/report.json` 里的真实证据已经指向这一点：点击“电磁学”时，被“已完成”栏标题和行星头部元素拦截 pointer。

4. 智能体 turn 判定只校验“动作发生过”，不校验“用户结果已交付”  
   `agent-gateway/src/runtime/turn-validator.ts` 当前只要求：

   - `observe` 至少执行 1 条 observe 类 `game.command`
   - `game_mutation` 至少执行 1 条非 observe `game.command`
   - `agent_management` 至少执行 1 条 agent/conversation 动作

   但它不要求最终回复必须闭环，所以 observe 可以“已经扫描，但仍回复待总结”，turn 仍然算成功。

5. 智能体参数构造对模型波动太脆  
   `agent-gateway/src/runtime/game-command-schema.ts` 只接受 camelCase 参数，如：

   - `buildingId`
   - `itemId`
   - `techId`
   - `planetId`

   而 `openai-compatible` provider 的 schema repair 只有通用“请返回合法 JSON”，没有把具体缺失字段反馈回模型。因此一旦模型输出 `building_id`、省略 `buildingId` 或只给计划句，就很容易直接失败。

### 2.3 推荐执行顺序

推荐按下面顺序实现：

1. 先收口 `agent-gateway` 完成态与错误可见性  
   这是 correctness blocker，会直接影响 `/agents` 的真实可用性。
2. 再收口 Web 行星页建造工作流  
   这是主游玩路径的 usability blocker，影响普通玩家是否能走通建造与中后期验证。
3. 最后修研究页 pointer interception  
   这是单页布局问题，但修完必须补真实点击回归，不要再靠“默认选中”绕过去。

---

## 3. 主题 A：Web 行星页建造工作流闭环

这一组覆盖 `T106` 的问题 1 和 2。

## 3.1 当前缺口

### A1. 建造列表默认暴露了所有 `buildable=true` 建筑

当前逻辑：

- 文件：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 变量：`buildableBuildings`
- 规则：`catalog.buildings.filter((entry) => entry.buildable)`

它没有区分：

- 当前科技已解锁
- 当前科技未解锁
- 普通玩家路径推荐
- 调试模式全量入口

因此默认新局会看到 `advanced_mining_machine`、`ray_receiver`、`orbital_collector` 这类不该出现在前期默认视野里的建筑。

### A2. 建造工作流没有把“距离 / 供电 / 下一步动作”合成一个闭环

当前页面虽然拿到了足够多的数据，但没有形成一个真正的建造顾问层：

- 距离：  
  服务端 authoritative 范围判定使用 `ManhattanDist(executorPos, target)`，来源见 `server/internal/gamecore/executor.go`。  
  Web 当前没有任何同源预检。

- 供电：  
  页面已经能读取 `networks.power_coverage` 和 `building.runtime.state_reason`，但只在详情面板里被动展示，没变成对刚建成建筑的操作建议。

- 命令账本：  
  `client-web/src/features/planet-commands/store.ts` 目前主要跟踪：
  - `command_result`
  - `research_completed`
  - `rocket_launched`

  它没有把 `entity_created` / `building_state_changed` 收口成“这座新建建筑为什么没跑、下一步应该补什么”。

## 3.2 方案比较

### 方案 A1：只补几条错误翻译，保留现有大下拉

优点：

- 改动最小
- 很快能让部分失败原因更可读

缺点：

- 默认新局仍然是 60 个建筑的大下拉
- 距离与供电仍然是提交后才知道
- Web 继续像“调试面板”，不是玩家工作流

结论：

- 不推荐

### 方案 A2：增加一层前端 `Build Workflow Model`，统一派生可见建筑、距离预检和供电提示

优点：

- 完全可以复用现有 authoritative 数据
- 不需要为此新增服务端专用接口
- 可以同时解决“列表过宽”与“提示不闭环”

缺点：

- 需要新建派生模块和对应测试
- 要把部分逻辑从组件内搬出去

结论：

- 推荐采用

### 方案 A3：增加服务端 `/build-advisor` 专用接口

优点：

- 所有建造建议都由服务端统一给出

缺点：

- 当前问题主要不是 authoritative 缺失，而是前端没把已有数据串起来
- 为一个前端工作流额外加新接口，耦合更重
- 后续还要维护 query 层与前端布局的双重复杂度

结论：

- 不采用

## 3.3 推荐方案

采用方案 A2：在 `client-web` 新增一层纯派生的 `Build Workflow Model`，统一解决下面三件事：

1. 默认应该给玩家看哪些建筑
2. 当前选中坐标是否在执行体可操作范围内
3. 新建筑失败或缺电时下一步应该做什么

### A3.1 新增 `build-workflow.ts` 作为纯派生模块

建议新增：

- `client-web/src/features/planet-map/build-workflow.ts`

输入：

- `catalog.buildings`
- `summary.players[playerId].executors[planetId]`，不存在则回退 `summary.players[playerId].executor`
- `planet.units`
- `planet.buildings`
- `networks.power_coverage`
- 当前选中坐标与当前已选建筑类型
- 最近相关命令账本条目

输出建议结构：

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

这层只做派生，不持久化，不直接调用 API。

### A3.2 建造列表收口规则

默认模式下，建造入口只显示：

- `buildable === true`
- 且当前玩家已解锁的建筑

已解锁规则直接使用 authoritative `unlock_tech`：

- `unlock_tech` 为空且该建筑又是 `buildable=true`，视为 catalog 契约异常
- 契约异常建筑不进入默认列表，只进入高级模式
- 同时补测试锁住这种异常，防止再回退

默认列表再分两层：

1. `recommended`
   - 当前阶段最适合玩家点击的建筑
   - 只做轻量级推荐，不做复杂评分系统
   - 例如：
     - 默认新局优先：`wind_turbine`、`tesla_tower`、`mining_machine`、`matrix_lab`
     - 中后期已解锁但仍常用：按建筑类别优先级排序
2. `unlocked`
   - 其余已解锁建筑

高级模式通过显式开关进入：

- 文案建议：`显示高级/调试建筑`
- 高级模式才显示：
  - 所有已解锁建筑
  - 可选显示未解锁建筑，但必须打明显标记：`未解锁`
  - `unlock_tech` 缺失的异常建筑：`目录异常`

重点是默认工作流必须收口，而不是继续把所有建筑直接扔进一个 `<select>`。

### A3.3 距离预检采用与服务端同源的 Manhattan 规则

服务端当前 authoritative 规则见 `server/internal/gamecore/executor.go`：

- 使用 `ManhattanDist(executorPos, target)`
- 若 `distance > operate_range`，返回 `executor out of range: X > Y`

因此 Web 预检必须完全沿用这套规则，不自行发明“欧几里得距离”或“屏幕距离”。

UI 行为建议：

- 在建造表单顶部直接显示：
  - 当前执行体 ID
  - 执行体位置
  - 当前目标坐标
  - `distance / operateRange`
- 当超范围时：
  - 不隐藏建造按钮
  - 但在按钮上方给出阻塞提示
  - 同时提供一个显式次级动作：`切到移动工作流并带入目标坐标`

不建议第一版做“自动寻最近可达格”的复杂搜索。当前先把信息闭环做对即可。

### A3.4 建造后的供电提示由命令账本继续收口

这里需要扩展 `client-web/src/features/planet-commands/store.ts`，让它不只处理 `command_result`，还要把后续建造事件串起来。

推荐规则：

1. `build` 提交后，账本 entry 先记录目标坐标
2. 若收到同坐标 `entity_created`，把新建 `building_id` 回写进该 entry 的 `focus.entityId`
3. 后续若收到该建筑的 `building_state_changed`：
   - `reason = power_out_of_range`
     - 下一步提示：附近缺少可连接供电塔，优先补 `tesla_tower` 或 `satellite_substation`
   - `reason = power_no_provider`
     - 下一步提示：网络内没有可供电的发电来源，优先补发电建筑
   - `reason = under_power`
     - 下一步提示：已经接入电网，但供电不足，优先补发电或储能
   - `reason = power_capacity_full`
     - 下一步提示：供电覆盖满载，优先扩电网节点

也就是说，建造链路的“最终反馈”不应只看 `build accepted` 或 `开始施工`，而应允许后续 authoritative 事件继续修正用户提示。

### A3.5 错误翻译要把原始 authoritative 原因变成下一步动作

建议新增：

- `client-web/src/features/planet-commands/error-hints.ts`

统一处理下面这类文案：

- `executor out of range: 7 > 6`
  - 翻译成：`当前执行体距离目标 7 格，但可操作范围只有 6 格；先移动执行体再建造。`
- `power_out_of_range`
  - 翻译成：`建筑未接入供电覆盖范围；先补供电塔。`
- `under_power`
  - 翻译成：`建筑已接上电网，但当前总供电不足；先补发电。`

注意这里不要吞掉原始 authoritative 信息。推荐文案结构：

- 主文案：可操作提示
- 次文案：保留原始原因，例如 `authoritative: executor out of range: 7 > 6`

### A3.6 组件层改动建议

主要改动文件：

- `client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- `client-web/src/features/planet-commands/store.ts`
- `client-web/src/features/planet-map/PlanetPanels.tsx`
- `client-web/src/styles/index.css`

具体改法：

1. `PlanetCommandPanel`
   - 建造区域不再只是单一大下拉
   - 顶部新增“建造前检查”卡片
   - 默认只渲染推荐/已解锁建筑
   - 高级模式开关展开全部
   - 最近结果区域优先展示与当前建造相关的阻塞提示

2. `PlanetPanels`
   - 选中建筑详情里，`停机原因` 不再直接裸露原始字符串
   - 增加“建议下一步”字段

3. 样式
   - 警告态与错误态提示需要高于“最近结果”列表的阅读优先级
   - 高级模式使用明显但次级的视觉层级，不和主流程混排

## 3.4 测试与验收

建议新增/修改：

- `client-web/src/features/planet-map/build-workflow.test.ts`
  - 锁住 unlock 过滤
  - 锁住距离计算
  - 锁住供电提示派生
- `client-web/src/features/planet-commands/store.test.ts`
  - `entity_created -> building_state_changed` 的账本收口
  - `executor out of range` 翻译
  - `under_power / power_out_of_range` 翻译
- `client-web/src/features/planet-map/PlanetCommandPanel.test.tsx`
  - 默认模式不显示未解锁建筑
  - 高级模式显式展开后才显示全量入口
  - 超范围时显示阻塞提示
- 新增 Playwright：
  - 默认新局建造列表默认收口
  - midgame 超范围建造直接给出距离提示
  - midgame 新建建筑缺电时能看到后续建议

---

## 4. 主题 B：研究页真实点击稳定性

这一组覆盖 `T106` 的问题 3。

## 4.1 当前缺口

真实证据已经非常明确。`default-web/report.json` 中：

- 目标元素：`getByRole('button', { name: /电磁学/ })`
- 被拦截元素：
  - `research-group__title`
  - `planet-operation-header`
  - `page-grid--planet`

这说明问题不是“Playwright 太严格”，而是布局确实发生了真实遮挡。

## 4.2 根因判断

根因不是单一 z-index，而是布局层级本身放错了位置：

- `PlanetPage` 右侧操作区位于固定宽度列：`268px`
- 但研究页内部仍使用 `3` 列网格
- 每列内容又包含多行前置/矩阵/解锁信息

结论：

- 研究工作流在当前页面结构下，本质上是一个窄侧栏工作流
- 既然宿主容器是窄栏，就不能继续套一个 3 列科技卡片棋盘

也就是说，这不是“给现有 3 列网格补点 z-index”就能优雅解决的问题；真正的问题是布局模型错了。

## 4.3 方案比较

### 方案 B1：只调 z-index / pointer-events

优点：

- 改动很小

缺点：

- 只能掩盖表象
- 268px 侧栏里放 3 列研究卡片本身仍然不可读
- 稍微换一点文案长度或窗口宽度，问题还会回来

结论：

- 不推荐

### 方案 B2：把研究工作流重排成单列堆叠式侧栏

优点：

- 与当前右侧窄栏宿主结构一致
- 可读性更好
- pointer interception 会连同横向溢出一起消失

缺点：

- 需要调整一些测试快照和 DOM 结构

结论：

- 推荐采用

### 方案 B3：把研究页弹出到全屏 Modal / 独立页面

优点：

- 可以保留多列科技展示

缺点：

- 对当前页面结构改动过大
- `T106` 并没有要求做新的整页导航形态

结论：

- 当前阶段不采用

## 4.4 推荐方案

采用方案 B2：研究工作流在右侧操作区里改成单列堆叠结构，不再尝试在 `268px` 宽度内渲染三列。

### B4.1 结构重排

建议把当前：

- 当前可研究
- 已完成
- 尚未满足前置

从三列并排改成三段垂直堆叠：

1. 当前可研究
2. 当前研究 / 启动研究
3. 已完成
4. 尚未满足前置

更具体一点：

- `当前研究` 和 `研究执行区` 放在最上方
- `当前可研究` 作为唯一需要真实点击的主列表，单列展示
- `已完成` 和 `尚未满足前置` 改成折叠区或次级卡片

这样用户在窄侧栏里只会点击一个主列表，不会再有“横向跨列点击”。

### B4.2 样式约束

建议调整：

- `.research-groups`
  - 改为单列布局
- `.research-group`
  - `min-width: 0`
- `.research-tech-list`
  - `min-width: 0`
- `.research-tech-card`
  - `width: 100%`
  - `min-width: 0`
  - 长文本允许换行
- 长标签文本：
  - `overflow-wrap: anywhere`

如果仍保留更宽视口下的多列能力，也必须基于容器宽度，而不是写死三列。  
但当前 `PlanetPage` 的右栏宽度本来就是固定窄列，因此建议直接单列，不要保留条件性多列。

### B4.3 回归测试要求

`Playwright` 回归必须是真实点击，不允许：

- `force: true`
- 直接绕过点击只验证“开始研究”按钮

推荐在 `client-web/tests/research-workflow.spec.ts` 增加：

1. 打开行星页
2. 切到“研究与装料”
3. 真实点击 `电磁学`
4. 断言没有 pointer interception
5. 再点击“开始研究”
6. 验证命令成功发出

这样才能锁住“科技卡片可稳定点击”，而不是只锁住最终按钮。

---

## 5. 主题 C：智能体 runtime 完成态与错误暴露收口

这一组覆盖 `T106` 的问题 4、5、6。

## 5.1 当前缺口

### C1. observe 任务只执行了动作，没有完成结果交付

`agents-web/report.json` 显示：

- 玩家要求：`请先观察 planet-1-1 当前局势，只回复一句话总结。`
- turn：`succeeded`
- `outcomeKind = observed`
- `executedActionCount = 2`
- 最终回复却仍是：  
  `已提交对 planet-1-1 的扫描请求，目前正在等待执行完成，待结果返回后我将提供一句话总结。`

这说明当前成功判定标准过低：  
“执行过观察动作”被错误地等价成了“交付了观察结果”。

### C2. `agent.create` 仍然容易停在“规划句”

现有 prompt 虽然已经要求：

- 观察请求不能只回复计划句
- 变更请求不能只回复承诺句

但对于 `agent.create` 这类成员管理动作，公共契约仍然不够强，provider repair 也不够具体，导致真实链路里仍会失败在 `provider_incomplete_execution`。

### C3. research + transfer 组合任务对模型输出过于脆弱

真实证据：

- 用户请求：`请把 10 个 electromagnetic_matrix 装入 b-9，然后启动 basic_logistics_system 研究，完成后回复结果。`
- 页面只看到：`执行失败，请稍后重试。`
- 实际 raw error：`transfer_item requires buildingId`

当前失败点有两个：

1. runtime 对模型输出字段名和缺字段过于脆
2. UI 把真实失败原因吞掉，只剩泛化错误

## 5.2 方案比较

### 方案 C1：继续只改 prompt

优点：

- 改动最小

缺点：

- 无法保证 observe 一定交付最终总结
- 无法解决 snake_case / camelCase 这类结构性脆弱
- 无法把 raw error 暴露给前端

结论：

- 不推荐

### 方案 C2：增加 runtime 级完成契约、字段别名容错和错误透传

优点：

- 直接收口公共语义
- 不依赖某个 provider “刚好听话”
- 可以同时解决问题 4、5、6

缺点：

- 需要改 `agent-gateway` 的 turn lifecycle、类型与前端展示

结论：

- 推荐采用

### 方案 C3：为 observe / create / research 各自做专门后端动作 DSL

优点：

- 可以最强约束每类任务

缺点：

- 新 DSL 和现有 typed action 重叠
- 复杂度明显上升

结论：

- 当前阶段不采用

## 5.3 推荐方案

采用方案 C2，分四层收口：

1. turn 完成契约
2. 参数别名与字段级 repair
3. provider prompt 示例补强
4. raw error 持久化与前端展示

### C3.1 新增“结果交付完成态”判定

建议新增：

- `agent-gateway/src/runtime/turn-completion.ts`

核心职责：

- 在“动作是否执行”之外，再判断“用户需要的结果是否已经交付”

建议引入两个概念：

```ts
export interface TurnCompletionCheck {
  complete: boolean;
  needsCloseoutRepair: boolean;
  reason?: "missing_final_delivery" | "still_planning";
}
```

判定规则：

1. `observe`
   - 必须执行过 observe 动作
   - 且最终回复不能只是“已提交/待结果返回/稍后总结”这类计划句
   - 必须交付用户可消费的观察结论

2. `game_mutation`
   - 允许“已执行完成，结果如下”式收尾
   - 若用户明确要求“完成后回复结果”，则最终回复仍需有结果交付

3. `agent_management`
   - `agent.create` 成功后，最终回复必须包含已创建结果，而不是“正在创建”

这里不建议做复杂 NLP 分类，只需先识别一批明显的未闭环短语，例如：

- `已提交`
- `正在等待`
- `待结果返回`
- `稍后总结`
- `我现在去做`
- `我来创建`

一旦命中这类短语，且当前 `turn.done === true`，就触发 closeout repair，而不是直接把 turn 判成功。

### C3.2 `runAgentLoop` 要区分两种 repair

当前 `runAgentLoop` 只有一种 repair：

- 缺少 intent-required action 时，补一次 repair prompt

推荐改成两段式：

1. **执行修复**
   - 没有执行所需动作时触发
2. **收尾修复**
   - 已执行动作，但最终回复仍未闭环时触发

收尾修复 prompt 建议类似：

> 你已经拿到工具执行结果。现在请只输出最终结论，不要再回复“已提交/待结果返回”。如果信息已经足够，请直接给用户一句话总结或明确结果。

这样 observe 不会再出现“scan 成功但 turn 仍结束在待总结”。

### C3.3 `game-command-schema` 增加字段别名容错

建议直接在 `agent-gateway/src/runtime/game-command-schema.ts` 中接受常见别名：

- `buildingId` 同时兼容 `building_id`
- `itemId` 同时兼容 `item_id`
- `techId` 同时兼容 `tech_id`
- `planetId` 同时兼容 `planet_id`
- `systemId` 同时兼容 `system_id`
- `buildingType` 同时兼容 `building_type`

注意这不是兼容旧前端，而是兼容模型输出的常见结构波动。  
这是对 LLM runtime 的输入归一化，不属于业务接口妥协。

这样可以直接消除 `transfer_item requires buildingId` 里相当一部分“明明表达了意思，但字段名没对上”的失败。

### C3.4 provider repair 不能再只说“请返回合法 JSON”

`agent-gateway/src/providers/openai-compatible.ts` 当前 repair 太弱，只会说：

- 上一次输出未通过校验
- 请返回合法 JSON

这不足以修复字段缺失。

建议改成：

- 把具体 schema 错误带回模型，例如：
  - `transfer_item requires buildingId`
  - `agent.create requires name`
- 同时补一条最小正确示例

例如 research + transfer 场景的 repair 提示：

```text
上一轮结构错误：transfer_item requires buildingId。
如果你要给 b-9 装料，必须返回：
{"type":"game.command","command":"transfer_item","args":{"buildingId":"b-9","itemId":"electromagnetic_matrix","quantity":10}}
请返回修正后的完整 JSON。
```

这样 repair 才有实际约束力。

### C3.5 `provider-turn-runner` 增加意图级 few-shot 示例

当前 prompt 只给了非常少量示例。建议补三个最关键的 few-shot：

1. observe

```json
{
  "assistantMessage": "先扫描 planet-1-1 并整理结果。",
  "actions": [
    { "type": "game.command", "command": "scan_planet", "args": { "planetId": "planet-1-1" } }
  ],
  "done": false
}
```

随后在拿到工具结果后的 closeout turn：

```json
{
  "assistantMessage": "planet-1-1 当前电力稳定、基础产线已成形，但研究推进仍偏慢。",
  "actions": [
    { "type": "final_answer", "message": "planet-1-1 当前电力稳定、基础产线已成形，但研究推进仍偏慢。" }
  ],
  "done": true
}
```

2. `agent.create`

```json
{
  "assistantMessage": "正在创建胡景并设置其权限。",
  "actions": [
    {
      "type": "agent.create",
      "name": "胡景",
      "policy": {
        "planetIds": ["planet-1-1"],
        "commandCategories": ["observe", "build", "research"]
      }
    }
  ],
  "done": false
}
```

3. `transfer_item + start_research`

```json
{
  "assistantMessage": "先给 b-9 装入电磁矩阵，再启动研究。",
  "actions": [
    {
      "type": "game.command",
      "command": "transfer_item",
      "args": { "buildingId": "b-9", "itemId": "electromagnetic_matrix", "quantity": 10 }
    },
    {
      "type": "game.command",
      "command": "start_research",
      "args": { "techId": "basic_logistics_system" }
    }
  ],
  "done": false
}
```

关键点：

- 第一轮可以 `done: false`
- 真正完成后再交付最终回复
- 不再鼓励“一轮里一边说待结果返回，一边又把 done 设成 true”

### C3.6 `createManagedAgent` 与工具结果要返回结构化信息

当前 `createManagedAgent(...)` 的工具结果文本对模型后续总结帮助有限。  
建议让 `gatewayRuntime.createAgent` 返回结构化、可直接复述的结果，例如：

```json
{
  "id": "agent-hujing",
  "name": "胡景",
  "providerId": "builtin-minimax-api",
  "policy": {
    "planetIds": ["planet-1-1"],
    "commandCategories": ["observe", "build", "research"]
  }
}
```

这样后续 closeout reply 才能稳定产出：

- `胡景已创建`
- `权限已限制为 planet-1-1 的 observe/build/research`

而不是继续停在“我现在创建胡景”。

### C3.7 turn 失败时保留 raw error，不再只留泛化消息

当前 `server.ts` 在失败时：

- 日志里有 `rawError`
- turn 持久化时只存了 `errorCode` 和 `publicError.message`

这导致前端只能看到：

- `执行失败，请稍后重试。`

推荐扩展 `ConversationTurn`：

```ts
export interface ConversationTurn {
  ...
  errorCode?: string;
  errorMessage?: string;
  rawErrorMessage?: string;
  errorHint?: string;
}
```

规则建议：

- `errorMessage`
  - 面向普通用户的安全文案
- `rawErrorMessage`
  - 面向工作台操作者的真实错误
  - 不做 provider 私密信息脱敏以外的二次吞没
- `errorHint`
  - 对常见错误给出操作建议

例如：

- `rawErrorMessage = transfer_item requires buildingId`
- `errorHint = 研究委派缺少目标建筑 ID，请明确研究站或装料建筑，例如 b-9。`

### C3.8 `/agents` 页面展示策略

建议改：

- `client-web/src/features/agents/types.ts`
- `client-web/src/features/agents/ChannelWorkspaceView.tsx`

展示顺序：

1. `失败原因`
   - `errorCode`
   - `errorMessage`
2. `真实错误`
   - `rawErrorMessage`
3. `建议处理`
   - `errorHint`

对 `provider_incomplete_execution` 也不要只写固定一句“这轮只有规划，没有执行所需动作”。  
应该尽量同时展示：

- 是否缺动作
- 还是“动作执行了，但结果没收尾”

否则用户仍然无法区分 observe 闭环问题和 create 动作缺失问题。

## 5.4 测试与验收

建议新增/修改：

- `agent-gateway/src/runtime/loop.test.ts`
  - observe：先执行 scan，再返回“待总结”，应触发 closeout repair，直到得到最终总结
  - observe：若扫描后最终只剩计划句，turn 应失败
  - `agent.create`：partial policy 真实执行成功
  - `transfer_item`：snake_case 参数别名可归一化
- `agent-gateway/src/server.test.ts`
  - turn 失败时持久化 `rawErrorMessage`
  - turn 成功时 `finalMessage` 必须是用户结果，不是计划句
- `client-web/src/pages/AgentsPage.test.tsx`
  - 失败 turn 展示 `errorCode + rawErrorMessage + errorHint`
  - observe turn 只有在出现最终总结后才显示成功态
- `client-web/tests/agent-platform.spec.ts`
  - 浏览器中真实验证：
    - observe 私聊返回一句话总结
    - 创建胡景成功，并在成员列表里可见
    - research 委派失败时，能看到具体参数错误

---

## 6. 建议改动文件清单

以下是推荐的文件边界，不要求一次性全部创建，但职责应保持这个方向。

### 6.1 `client-web`

- 新增：`client-web/src/features/planet-map/build-workflow.ts`
- 新增：`client-web/src/features/planet-commands/error-hints.ts`
- 修改：`client-web/src/features/planet-map/PlanetCommandPanel.tsx`
- 修改：`client-web/src/features/planet-commands/store.ts`
- 修改：`client-web/src/features/planet-map/PlanetPanels.tsx`
- 修改：`client-web/src/features/planet-map/research-workflow.ts`
- 修改：`client-web/src/styles/index.css`
- 修改：`client-web/tests/research-workflow.spec.ts`
- 修改：`client-web/tests/agent-platform.spec.ts`
- 可能新增：`client-web/tests/planet-build-workflow.spec.ts`

### 6.2 `agent-gateway`

- 新增：`agent-gateway/src/runtime/turn-completion.ts`
- 修改：`agent-gateway/src/runtime/turn-validator.ts`
- 修改：`agent-gateway/src/runtime/loop.ts`
- 修改：`agent-gateway/src/runtime/game-command-schema.ts`
- 修改：`agent-gateway/src/runtime/provider-turn-runner.ts`
- 修改：`agent-gateway/src/providers/openai-compatible.ts`
- 修改：`agent-gateway/src/server.ts`
- 修改：`agent-gateway/src/types.ts`
- 修改：`agent-gateway/src/runtime/loop.test.ts`
- 修改：`agent-gateway/src/server.test.ts`

### 6.3 `shared-client`

- 可能修改：`shared-client/src/types.ts`

仅在需要把 `rawErrorMessage` / `errorHint` 这类字段同步到前端时修改。

---

## 7. 验收矩阵

| 验收项 | 设计落点 |
| --- | --- |
| 默认新局不再默认暴露大量未解锁中后期建筑 | §3.3.1 §3.3.2 |
| 研究卡片真实点击稳定，不再 pointer interception | §4.4 |
| midgame 超距离建造和缺电状态有直接工作流提示 | §3.3.3 §3.3.4 §3.3.5 |
| observe 任务只有交付最终总结后才算成功 | §5.3.1 §5.3.2 |
| 创建下级成员能真实创建成功并给出结果 | §5.3.2 §5.3.5 §5.3.6 |
| 科研委派能稳定构造参数，失败时暴露真实错误 | §5.3.3 §5.3.4 §5.3.7 §5.3.8 |
| 已确认可用的戴森主链和 midgame 建筑不回退 | 所有新增测试均以现有 authoritative 命令与浏览器回归为前提，不改玩法规则本身 |

---

## 8. 非目标

本设计明确不做以下扩张：

- 不新增专用 `build-advisor` 服务端接口
- 不把研究工作流升级成独立全屏科技树页面
- 不为单个 provider 写特供逻辑分支
- 不新增新的游戏规则或新建筑
- 不通过吞掉 authoritative 错误来伪装“成功”

## 9. 最终结论

`T106` 的 6 个问题不需要引入新的玩法系统，关键是把已有 authoritative 能力收口成更严格的 runtime 契约和更像玩家工作流的 Web 入口。

推荐的一句话方向是：

- Web 端默认只暴露当前该做的事，并把失败原因翻译成下一步动作。
- 智能体端只有在真正交付用户结果后才允许 turn 成功。
- 研究页要尊重宿主容器宽度，不再把三列棋盘硬塞进 268px 侧栏。

按这个方向实现后，`T106` 的 6 项验收条件都可以被同一套真实浏览器回归和 gateway/runtime 测试稳定锁住。
