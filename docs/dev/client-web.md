# client-web 开发与联调

`client-web` 是可视化客户端（React + Vite + Pixi.js + Three.js），既是观察端也是操作端：总览、星图、行星、战争、科技、智能体、回放。所有游戏操作最终都是 `POST /commands`，接口契约见 [服务端API](服务端API.md)；与 CLI 共用 `shared-client/` 的类型与 API 层。启动整套环境见 [本地环境与测试](本地环境与测试.md)。

## 1. 启动

```bash
cd client-web
npm install
npm run dev                      # 默认 http://localhost:5173/login
VITE_SW_PROXY_TARGET=http://127.0.0.1:18081 npm run dev        # 改游戏服务端代理（默认 http://localhost:18080）
VITE_SW_AGENT_PROXY_TARGET=http://127.0.0.1:18181 npm run dev  # 改 agent-gateway 代理（默认 18180）
```

- 登录页在线模式填写的是 **Web 入口地址**（默认回填当前源站），不要填游戏服务端端口；浏览器经 Vite 代理访问后端，否则会出现代理/CORS 错误。
- `/agents` 依赖本地 `agent-gateway`（见 [agent-gateway](agent-gateway.md)）。
- 默认玩家 `p1 / key_player_1`、`p2 / key_player_2`。

## 2. 目录

| 目录 | 内容 |
| --- | --- |
| `src/app/` | 路由（`routes.tsx`）与 AppShell |
| `src/pages/` | 页面容器 |
| `src/features/` | 按领域划分：`planet-map`、`planet-commands`、`starmap`、`system-three`、`war`、`agents`、`lobby`、`onboarding`、`tech-tree`、`production`、`progression`、`notifications`、`audio` |
| `src/engine/` | Pixi 舞台、相机、程序化纹理、战斗事件总线、WebAudio 程序化音效、场景调色板 |
| `src/widgets/` | TopNav 资源栏、Outliner 等壳组件 |
| `src/common/` | 控件库（`controls/`）、图标（lucide + `icon-map.ts`） |
| `src/styles/` | token / base / components / shell / starmap / planet / war / pages |
| `src/i18n/` | 显示层翻译（`translation-config.ts` 词典 + `translate.ts`） |
| `src/fixtures/` | 离线 fixture 数据（P4 计划移出生产包） |

## 3. 页面

| 路由 | 能力 |
| --- | --- |
| `/login` | 游戏标题屏与登录 |
| `/lobby`、`/lobby/new` | 大厅与新局设置（`POST /games/new` 热重置） |
| `/overview` | 态势横幅、“下一步”主行动条、mini 星图、告警时间线、资源脉搏、行星态势列表 |
| `/galaxy` | Pixi 银河星图（登录后默认落地页）：恒星按谱型着色、航线、舰队徽标直选、舰队跨星系跃迁、战争覆盖层 |
| `/system/:systemId` | 恒星系视图（中心恒星 + 行星轨道），双击进入行星 |
| `/planet/:planetId` | 行星页，见第 4 节 |
| `/war` | 战争工作台，见第 5 节 |
| `/tech` | 科技树 |
| `/settlement` | 对局结算页 |
| `/agents` | AI 智能体协作工作台，见第 6 节 |
| `/replay` | 回放调试（`from_tick`/`to_tick` → digest / drift）。`/replay` 与代理条目同名，整页刷新会被代理到服务端返回 405，需从顶栏链接进入 |

全局 HUD：顶栏资源 chip（tick/矿产/能量/电力Δ）、警报按钮、静音开关（`sw.audio.muted`）；右下 toast 通知中心；右侧 Outliner（焦点行星/恒星系/舰队/警报）。资源与警报 5–10 秒轮询。

## 4. 行星页

- **视图**：默认 3D 立方体球面视图（`PlanetMapThree`）；`?view=2d` 切到 Pixi 平面战术视图（`PlanetMapPixi`）。2D 视图将在 P4 退役，届时 `data-entity-*` 测试钩子迁到 3D。3D 表现、画质档位与素材见 [3D与画质](../guide/3D与画质.md)。
- **网格协议**：行星为 `cube_sphere` 六面网格，`map_width=3N`、`map_height=2N` 是存储图集尺寸（N = `surface.face_size`），图集边缘相邻不代表地表相邻。scene 的跨面 `surface_patches` 按各自 bounds 合成；overview 使用响应中的实际 step。
- **寻路**：建造靠近与移动使用 `GET /world/planets/{id}/path`（`stop_range` 0..128，最多 512 步）；`reachable=false` 时不能直接尝试建造；局势变化后应刷新并重规划。
- **地图直操作**：`interactionMode`（`inspect / build / move / attack`）决定点击语义，Esc/右键退出。底部建造栏按 catalog 分类展示（锁定/可建/造价），选卡后幽灵预览跟随悬停；传送带 R 键切方向、支持拖拽铺设；有配方的建筑可随建造携带配方。建筑布局蓝图的选区需在单面内。
- **工作台抽屉**：生产（产线诊断、配方用料规划）、发展（六阶段路线）、研究与装料（阶段化研究工作台）、战斗与制造（`produce`、集结点）、取消与恢复、戴森链路 typed form（`transfer_item`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 等），以及分拣器/分流器/流量监测/物流站/配送器/机甲物流配置面板。
- **军团**：军团面板与地图标记、指令箭头（`form_squad` / `squad_order` / `dissolve_squad`）；弹药条与缺弹告警。
- **命令结果账本**：提交后显示 `pending`，由 SSE `command_result`（以及 `research_completed`、`rocket_launched` 等异步完成事件）回写最终结果；超时补拉 `/events/snapshot`。同步 `accepted` 只表示入队。
- **活动流**：`关键反馈 / 全部事件 / 仅命令 / 仅告警`，默认折叠 `tick_completed`、`resource_changed`、`threat_level_changed` 等低信号事件。
- 窄屏保留地图首屏，右侧收口为 `工作台 / 选中对象 / 生产 / 发展 / 活动流` 页签。
- `?freeze=1` 冻结星图、行星地图、战场图的动画与特效，供确定性截图。

## 5. 战争工作台 `/war`

- 战场图吃满页面（Pixi，星系级：恒星、轨道、舰队接触、封锁圈），右侧抽屉四组：**蓝图**（创建/填槽/校验/定型/改型，展示非法原因与预算）、**军工**（量产、翻修、部署枢纽、补给节点）、**战区**（任务群姿态/编组/部署、战区/区域/目标、封锁）、**战报与情报**（contacts、battle_reports、planet_blockades、补给短缺；舰队指挥）。
- 命令提交统一走 `features/war/use-war-command.ts`，查询键由 `war-query-keys.ts` 构造；实时层 `hooks/use-war-realtime.ts` 订阅 `/events/stream`。
- 推荐配合官方战争局 `server/config-war.yaml + map-war.yaml` 验证。AI 军事委派在 `/agents` 配置，不在 `/war` 内。

## 6. 智能体工作台 `/agents`

- IM 风格：频道/私聊/智能体目录（左）、按 turn 分组的消息流（中）、成员/权限/按星球拉人/定时任务（右）。
- turn 卡片显示状态、`outcomeKind`、规划与动作摘要、repair 次数、最终回复或失败原因；回复通过 `replyToMessageId + turnId` 挂回原请求。
- Provider 管理把 `commandWhitelist` 按命令类别分组展示，并提示与成员 `commandCategories` 不一致。
- 浏览器只通过 `/agent-api` 与 `agent-gateway` 通信；fixture 模式下只读。

## 7. 翻译约束

- 页面不直接渲染 `event_type`、`alert_type`、`kind`、`mode` 等英文协议值，统一走翻译函数。
- 建筑、物品、科技优先用 catalog 中文名，缺失再回退本地词典。
- 翻译只影响显示，不改请求 payload、查询参数和路由。新增枚举先补 `translation-config.ts`。

## 8. 测试与浏览器回归

```bash
cd client-web
npx tsc --noEmit && npx vitest run      # 类型 + 单测
npx playwright test                      # 浏览器用例（tests/*.spec.ts）
npx playwright test tests/war-workbench-authoritative.spec.ts  # 自动拉起 server/scripts/start_official_war_test_server.sh
npm run storybook
```

主要 Playwright 用例：`planet-build-workflow`（建造全流程）、`planet-entity-dom`（`data-entity-*` 定位契约）、`planet-three`、`cube-surface` / `cube-poles`、`planet-produce-units`、`research-workflow`、`dyson-workflow`、`industrial-development`、`war-workbench` / `war-workbench-authoritative` / `war-workbench-pure-gui`（纯 GUI 打完官方战争局）、`agent-platform`、`visual`（截图基线，重录前人工核对 actual）。

改到 client-web 必须进浏览器实测（AGENTS.md）：

- 建筑建造能显示，幽灵预览/放置回执/退出模式正常；
- 兵力调配、军团、单位信息能显示；
- 局势、网络态、详情面板正确回显；命令先 `pending` 再变最终结果；
- `/war` 四组面板可用并显示解释性失败原因，窄屏仍保留最小操作闭环；
- `/agents` 频道、私聊、拉人、定时任务正常，turn 状态自动刷新。

专项浏览器回放脚本在 `scripts/playtest-*.mjs`，用法见 [星球玩法覆盖与验收](../guide/星球玩法覆盖与验收.md)。
