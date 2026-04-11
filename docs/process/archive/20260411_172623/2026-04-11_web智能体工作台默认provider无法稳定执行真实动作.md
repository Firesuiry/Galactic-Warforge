# 2026-04-11 Web 智能体工作台默认 Provider 无法稳定执行真实动作

## 背景

- 试玩日期：2026-04-11
- 试玩方式：`client-web` `/agents` 为主，`agent-gateway` HTTP 接口辅助核对落库结果
- 环境：
  - Web：`http://127.0.0.1:4174/agents`
  - agent-gateway：`http://127.0.0.1:18181`
  - 使用内置默认 Provider：`builtin-minimax-api`
- 本轮使用全新空数据目录启动 `agent-gateway`，排除了旧历史数据污染

## 已确认可用的前半段

Web 工作台当前可以完成这些基础动作：

- 打开 `/agents`
- 新建成员
- 绑定 `builtin-minimax-api`
- 保存成员权限
- 发起与成员的私聊
- 通过 Web 发送消息

也就是说，问题不在“成员管理页本身打不开”，而在 turn 真正进入模型和动作执行后的行为。

## 实测问题

### 1. 观察任务会被错误标记为成功，但实际上没有执行任何动作

Web 中发送：

- `先只做观察，不要执行命令。请用两句话汇报 planet-1-2 当前局势。`

结果：

- 会话页显示 `已完成`
- 但 turn 落库中：
  - `actionSummaries = []`
- 最终回复内容只有：
  - “收到，我会先观察...准备使用 scan_planet...”

也就是说：

- 它回复的是“计划去观察”
- 不是“已经观察后的结果”
- UI 却把这轮标成成功完成

这会直接误导玩家，以为 agent 已经执行了观察。

### 2. 一旦要求真实动作，马上出现 `provider_schema_invalid`

本轮对同一成员继续发送了三类真实任务：

1. 建造：
   - `请在 planet-1-2 的 (5,5) 建造一台 wind_turbine，完成后回复实际 building id。`
2. 创建下级智能体：
   - `请创建一个名为胡景的下级智能体，只授予 observe,build 权限，星球限制 planet-1-2，并在回复里说明是否成功。`
3. 科研：
   - 在新局环境中新建另一个成员 `韩非`
   - 发送：
     - `请把 10 个 electromagnetic_matrix 装入 b-10，然后开始研究 automatic_metallurgy，最后汇报是否成功。`

三条任务的共同结果：

- `turn.status = failed`
- `errorCode = provider_schema_invalid`
- `errorMessage = 模型返回结构无效，请稍后重试。`
- `actionSummaries = []`

附带现象：

- 创建下级后，`/agents` 中没有新增 `胡景`
- 科研失败后，会话只会写入 system message：
  - `韩非 回复失败：模型返回结构无效，请稍后重试。`

## 影响

- Web 工作台当前不能被视为“可指挥 agent 完成任务”
- 观察任务存在“假成功”风险
- 真实动作任务在以下类别上都不可靠：
  - 建造
  - 创建新智能体
  - 权限分配
  - 科技研发
- 从玩家视角看，工作台像是“会说要去做，但做不了”

## 改动需求

1. 修复 `builtin-minimax-api` 的结构化输出兼容，确保：
   - 纯回复
   - 纯观察
   - 带动作的建造/科研/agent.create
   都能稳定产出合法结构
2. 修复“计划性文案直接被当 final answer 落库”的成功判定逻辑。
   - 若没有动作执行，也没有真正回答用户问题，不应直接标记 `succeeded`
3. 为默认 Provider 增加回归用例：
   - Web DM 观察请求，必须产出真实观察结果
   - 建造请求，必须有非空 `actionSummaries`
   - `agent.create` 请求，必须真的新增 agent
   - 科研请求，必须能走 `transfer + start_research` 或给出 authoritative 失败原因
4. 在 Web 页面对 turn 结果做更严格展示：
   - 规划摘要
   - 动作摘要
   - 最终回复
   这三者不能再被“计划文案”混为同一个成功答案

## 验收标准

- 观察任务返回的是观察结果，不是“准备去观察”的计划句
- 建造请求能真实生成 `actionSummaries`，并在游戏世界中看到 authoritative 结果
- 创建下级请求后，`/agents` 中真实出现新成员，且权限范围符合请求
- 科研请求能真实推进 `transfer/start_research`，或返回明确的 authoritative 失败原因
- `/agents` 页面中，玩家能清楚区分“只是规划”与“已经执行完成”
