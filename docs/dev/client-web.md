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
- `/system/:systemId`：恒星系详情
- `/planet/:planetId`：行星观察页
- `/agents`：AI 智能体工作台

### 3.3 行星页

当前已支持：

- 地形、资源、建筑、单位、迷雾图层
- 物流轨迹、电网、管网、施工、敌情图层
- 实体详情侧栏
- 事件时间线与告警面板
- SSE 增量同步与补拉
- 命令面板与调试面板

### 3.4 回放调试页

- 输入 `from_tick` / `to_tick`
- 调 `/replay`
- 查看 digest / drift 信息

### 3.5 AI 智能体工作台

- `/agents` 已改成 IM 风格协作工作台，核心对象是会话、消息、成员、权限和定时任务
- 左栏提供频道列表、私聊列表、智能体目录，以及创建频道入口
- 中栏显示当前会话消息流，玩家可直接发送消息，用 `@智能体名` 或私聊唤醒对应 agent
- 右栏显示当前会话成员、agent 权限范围、按星球拉人入口和 heartbeat 式定时任务
- 会话消息通过 `agent-gateway` 的 SSE 推送刷新，消息加载只影响消息区，不会整页回到 loading
- 当前工作台不再把协作模型塞进 `server/`，浏览器只通过 `/agent-api` 与 `agent-gateway` 通信
- 当 `serverUrl` 指向 fixture 模式时，工作台会进入只读，发送、建群、拉人、建定时任务入口会禁用

### 3.6 当前已接入的协作能力

- 玩家可创建频道，也可主动发起与某个 agent 的私聊
- 玩家或具备权限的总管类 agent 可按星球批量拉人，把某个星球范围内的 agent 加进会话
- 频道内 `@` 某个 agent 时，该 agent 会被自动唤醒；私聊里则默认唤醒另一侧 agent
- agent 回复会直接写回当前会话，不再只写传统单 agent thread 视图
- 支持给会话创建周期性定时任务，按固定间隔投递一段消息，驱动 agent 做持续巡检或汇报
- 右栏会显示会话内 agent 的运行时硬限制摘要，包括星球范围和命令类别

## 4. 回归与验证方式

### 4.1 必做浏览器回归

本仓库对 `client-web` 的要求不是只跑单测，还要真实进浏览器确认：

- 建筑建造是否能显示
- 兵力调配或单位信息是否能显示
- 局势、网络态、详情面板是否正确回显
- 表单提交后 UI 是否保持正确状态
- `/agents` 的频道切换、私聊、消息发送、按星球拉人、定时任务创建是否正常可见
- agent 自动回复后，会话消息流是否能自动刷新

### 4.2 常用验证组合

- Playwright：验证核心交互回归
- 手动浏览器检查：验证渲染和操作可见性
- Storybook：开发局部组件时快速预览

Storybook：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run storybook
```

## 5. 归档文档

更早期的文档已归档：

- `docs/archive/design/client-web使用说明.md`
- `docs/archive/design/client-web可视化客户端技术方案.md`
