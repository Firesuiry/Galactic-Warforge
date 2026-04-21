# client-web 开发与联调

## 1. 定位

`client-web` 是当前项目的可视化客户端。它既是观察端，也是逐步扩展中的操作端，主要用于：

- 查看总览、银河、恒星系和行星局势
- 可视化检查建筑、资源、单位、迷雾和网络态
- 通过浏览器执行命令并观察回显
- 对回放、事件、告警和 AI 工作台做联调

相关目录：

- `client-web/`：Web 客户端
- `shared-client/`：CLI 与 Web 共用类型和 API 层
- `agent-gateway/`：本地 AI 网关
- `docs/dev/服务端API.md`：接口契约

## 2. 本地启动

### 2.1 启动服务端

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-dev.yaml -map-config map.yaml
```

默认玩家：

- `p1 / key_player_1`
- `p2 / key_player_2`

### 2.2 启动 Web 客户端

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm install
npm run dev
```

默认入口：

- `http://localhost:5173/login`

登录页在线模式现在要求填写的是 **Web 入口地址**，默认会回填当前源站，例如 `http://127.0.0.1:4173`。不要直接填写 `18081 / 18082` 这类游戏服务端端口；浏览器需要通过当前 Web 代理访问后端，否则会触发代理/CORS 失败提示。

如需改代理目标：

```bash
VITE_SW_PROXY_TARGET=http://127.0.0.1:18081 npm run dev
```

### 2.3 启动本地 Agent 网关

AI 面板依赖 `agent-gateway`：

```bash
cd /home/firesuiry/develop/siliconWorld/agent-gateway
npm install
npm run dev
```

默认地址：

- `http://localhost:18180`

如需改 Web 侧代理目标：

```bash
VITE_SW_AGENT_PROXY_TARGET=http://127.0.0.1:18181 npm run dev
```

## 3. 当前页面能力

### 3.1 总览页

- 世界摘要
- 玩家统计
- 最近事件与告警
- 顶栏手动保存

### 3.2 星图导航

- `/galaxy`：银河总览
- `/system/:systemId`：恒星系详情；页面直接消费 `/world/systems/{systemId}/runtime`，展示 `dyson_sphere` / `solar_sail_orbit` / `active_planet_context` 聚合出的戴森态势、层级产能、火箭累计发射次数，以及当前 active planet 对戴森操作链路的支撑建筑
- `/planet/:planetId`：行星观察页
- `/war`：战争工作台
- `/agents`：AI 智能体工作台

### 3.3 战争工作台

当前已支持：

- `/war` 新增长期战争工作台，沿用当前大战略骨架，不退回调试表单堆叠页
- 推荐直接配合 `server/config-war.yaml + map-war.yaml` 使用；官方战争验证局已经为 `p1` / `p2` 预置部署枢纽、军工底座、补给节点和 `prototype|precision_drone|corvette|destroyer` 公开科技，适合直接验证战争入口
- 蓝图工作台：可创建蓝图、查看底盘与组件槽位、执行 `blueprint_set_component` / `blueprint_validate` / `blueprint_finalize`，并直接展示非法原因、预算占用和角色预估
- 军工总览：聚合量产单、翻修单、部署枢纽和补给节点，可直接对选定蓝图发起一次部署尝试，并把“当前部署枢纽不支持该蓝图”等失败原因解释成玩家可读提示
- 战区面板：聚合任务群与战区目标，可直接调整 `task_force_set_stance`，并对当前焦点行星发起 `blockade_planet` / `landing_start`
- 战报与情报面板：集中展示 `contacts`、`battle_reports`、`planet_blockades`、`landing_operations`，并直接暴露当前补给状态和短缺项
- 命令反馈改为短历史，不会被下一条操作覆盖，便于在浏览器内连续核对蓝图、部署、封锁、登陆的 authoritative 回执
- 已补 `client-web/tests/war-workbench.spec.ts`，覆盖桌面和窄屏两条浏览器回归
- 已补 `client-web/tests/war-workbench-authoritative.spec.ts`，会配合 `server/config-war.yaml + map-war.yaml` 与 `server/scripts/start_official_war_test_server.sh` 启动官方战争验证局，实测蓝图改型、军工量产、舰队编成、战区配置、封锁与登陆链路
- `/war` 现在会以 1 秒轮询 authoritative 战争查询，保证“accepted, will execute at next tick”这类异步命令能在浏览器里追上真实运行态，而不是停在提交瞬间的旧缓存
- 当前边界：
  - 当前页面重点是蓝图查看/编辑、部署尝试、姿态调整、封锁/登陆和战报情报观察，不是把全部战争指挥入口都塞进一个页面
  - `task_force_create|assign`、`theater_create|define_zone|set_objective`、军工量产下单、翻修下单目前仍以 CLI 为最稳入口
  - AI 军事委派已经在 `/agents` 工作台和 `agent-gateway` 落地，但不在 `/war` 页内直接配置；推荐先用 CLI 或既有命令入口建好任务群/战区，再到 `/agents` 做委派和审计

### 3.4 行星页

当前已支持：

- 地形、资源、建筑、单位、迷雾图层
- 物流轨迹、电网、管网、施工、敌情图层
- 行星工作台首屏：`PlanetOperationHeader` 会固定显示当前路由行星、当前 active planet、最近命令结果和待处理命令数
- `PlanetCommandCenter` 作为首屏主操作区，已补齐 `transfer_item`、`switch_active_planet`、`build_dyson_*`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 等 typed form 入口
- `研究与装料` 页签现在是阶段化研究工作台：顶部展示当前研究卡片与开局推荐路径，中部按 `当前可研究 / 已完成 / 尚未满足前置` 分组科技，点击卡片后再通过 `start_research` 真正提交命令
- 研究派生逻辑已拆到独立模块；组件层主用 `summary.players[pid].tech.current_research` 与 `completed_techs` 推导 UI，若运行时仍遇到旧版 `completed_techs` level map，只在派生层内部归一化，不向组件扩散
- 命令结果账本：提交后先显示 `pending`，再优先由 SSE authoritative 回写切到最终成功或失败；默认会收口 `command_result`，并把 `research_completed`、`rocket_launched` 这类异步完成事件也视作最终成功态。如果等待超时，会补拉 `/events/snapshot` 对账，并附带下一步提示
- 命令结果账本的下一步提示现在带上下文：`transfer_item` 对 `matrix_lab` / `em_rail_ejector` / `vertical_launching_silo` 会分别提示后续研究、太阳帆发射或火箭发射；`set_ray_receiver_mode` 会根据 `power / photon / hybrid` 提示不同观察重点
- 实体详情侧栏
- 事件时间线与告警面板；活动流支持 `关键反馈 / 全部事件 / 仅命令 / 仅告警` 四种模式，默认会折叠 `tick_completed`、`resource_changed`、`threat_level_changed` 这类低信号事件
- SSE 增量同步与补拉
- 调试面板
- 窄屏/移动端会保留地图首屏，并把右侧区域收口成 `工作台 / 选中对象 / 活动流` 三个页签，默认进入 `工作台`

### 3.5 回放调试页

- 输入 `from_tick` / `to_tick`
- 调 `/replay`
- 查看 digest / drift 信息

### 3.6 AI 智能体工作台

- `/agents` 已改成 IM 风格协作工作台，核心对象是会话、消息、成员、权限、`ConversationTurn` 和定时任务
- 左栏提供频道列表、私聊列表、智能体目录，以及创建频道入口
- 中栏不再只平铺消息流，而是按“玩家请求/定时请求 -> turn 生命周期 -> 阶段消息/最终回复/失败原因”分组显示
- 右栏显示当前会话成员、agent 权限范围、按星球拉人入口和 heartbeat 式定时任务
- turn 卡片会展示当前状态、`outcomeKind` 结果徽标、规划摘要、动作摘要、执行动作数、repair 次数、最终回复和失败原因；回复消息通过 `replyToMessageId + turnId` 挂回原请求
- turn 完成语义已与 `agent-gateway` 对齐：provider 可以直接用 `assistantMessage + [] + true` 成功结束一轮；纯文本回复也会被包装成成功 turn，只有真实结构错误才会显示 `system failure`
- 模型 Provider 管理已把 `commandWhitelist` 可视化成按命令类别分组的白名单面板，默认展开完整 agent 命令集合；成员详情页会同时显示 Provider 命令覆盖范围，并提示与成员 `commandCategories` 的配置不一致
- 会话消息通过 `agent-gateway` 的 `message` 与 `turn.*` SSE 推送刷新，消息加载只影响消息区，不会整页回到 loading
- 当前工作台不再把协作模型塞进 `server/`，浏览器只通过 `/agent-api` 与 `agent-gateway` 通信
- 当 `serverUrl` 指向 fixture 模式时，工作台会进入只读，发送、建群、拉人、建定时任务入口会禁用

### 3.7 当前已接入的协作能力

- 玩家可创建频道，也可主动发起与某个 agent 的私聊
- 玩家或具备权限的总管类 agent 可按星球批量拉人，把某个星球范围内的 agent 加进会话
- 频道内 `@` 某个 agent 时，该 agent 会被自动唤醒；私聊里则默认唤醒另一侧 agent
- agent 回复会直接写回当前会话，不再只写传统单 agent thread 视图
- 支持给会话创建周期性定时任务，按固定间隔投递一段消息，驱动 agent 做持续巡检或汇报
- 右栏会显示会话内 agent 的运行时硬限制摘要，包括星球范围和命令类别

### 3.8 中英翻译配置

当前 `client-web` 已增加统一翻译层，用于把用户可见的英文枚举、类型名、状态名、命令名和关键字段标签翻成中文。

核心文件：

- `client-web/src/i18n/translation-config.ts`
  - 维护静态词典
- `client-web/src/i18n/translate.ts`
  - 提供统一翻译函数和回退逻辑

维护约束：

- 页面组件不要直接渲染 `event_type`、`alert_type`、`kind`、`mode`、`scope` 这类英文协议值，统一走翻译函数
- 建筑、物品、科技优先使用 `catalog` 中文名；目录缺失时再回退到本地翻译词典
- 翻译只影响显示层，不改变请求 payload、查询参数、路由参数和服务端协议值
- 新增英文枚举时，优先补 `translation-config.ts`，不要在页面里散写 `if/else`

## 4. 回归与验证方式

### 4.1 必做浏览器回归

本仓库对 `client-web` 的要求不是只跑单测，还要真实进浏览器确认：

- 建筑建造是否能显示
- 兵力调配或单位信息是否能显示
- 局势、网络态、详情面板是否正确回显
- 表单提交后 UI 是否保持正确状态
- 登录页在线模式是否明确提示“Web 入口地址”，并把原始 `Failed to fetch` 转成可理解的代理/CORS 错误
- 行星页在窄屏下是否仍保留地图首屏，并可在 `工作台 / 选中对象 / 活动流` 间切换
- 命令提交后是否先进入 `pending`，再被后续 `command_result` / `research_completed` / `rocket_launched` 覆盖为最终结果
- `/war` 是否能同时展示蓝图、军工、战区、战报四个长期面板，并能看到蓝图非法原因、部署失败原因、登陆失败原因等解释性提示
- `/war` 在窄屏下是否仍能看到蓝图创建、部署蓝图、任务群姿态和封锁入口，不会因为布局塌陷而失去最小操作闭环
- `/agents` 的频道切换、私聊、消息发送、按星球拉人、定时任务创建是否正常可见
- agent 自动回复后，请求卡片、turn 状态、最终回复和失败原因是否能自动刷新并挂回正确请求

### 4.2 常用验证组合

- Playwright：验证核心交互回归
  - `tests/war-workbench.spec.ts`：战争工作台桌面与窄屏回归
  - `tests/war-workbench-authoritative.spec.ts`：自动拉起官方战争验证局，验证 `/war` 对 authoritative 战争场景的真实操作闭环
- 手动浏览器检查：验证渲染和操作可见性
- Storybook：开发局部组件时快速预览

authoritative 战争回归：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npx playwright test tests/war-workbench-authoritative.spec.ts
```

这条用例会自动启动：

```bash
bash ../server/scripts/start_official_war_test_server.sh 19481
```

不需要手动再起一份 `config-war.yaml` 服务端。

Storybook：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run storybook
```

## 5. 归档文档

更早期的文档已归档：

- `docs/archive/design/client-web使用说明.md`
- `docs/archive/design/client-web可视化客户端技术方案.md`
