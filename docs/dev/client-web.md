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

### 3.0 游戏 HUD 骨架

- 顶栏（`widgets/TopNav.tsx`）：群星式细条——图标菜单（总览/星图/战争/智能体/回放）、资源 chip（tick/矿产/能量/电力Δ，赤字红脉冲）、警报按钮（带计数，点击跳活跃行星）、静音开关（期4b：🔊/🔇 全局音效开关，状态持久化到 localStorage `sw.audio.muted`，解除静音时播一声 uiClick 确认）、保存与设置图标；玩家/服务器信息收进设置弹层
- 全局事件通知中心（期6b，`features/notifications/`）：zustand store（toast 栈上限 5 / 历史环 20 / 5s 消退 sweep / hover 暂停消退 / mergeKey 5s 窗口合并计数）+ 右下 `NotificationToasts` toast 栈 + TopNav 铃铛（未读角标 / 历史面板 / href 跳转）；`event-toasts.ts` 纯函数映射 17 类事件，两路 SSE（`use-war-realtime` / `use-planet-realtime`）各挂一行 `notifyGameEvent`，event_id 环形缓冲去重；`?freeze=1` 全抑制保截图确定性；音效去重原则——已有音效覆盖的事件不再重复配音，无声事件按 kind 补一声
- 右侧 Outliner（`widgets/Outliner.tsx`）：焦点行星/恒星系（谱型色点）/舰队/警报四区，点击跳转；以布局列嵌入 AppShell（不遮挡页面），可折叠且状态持久化到 localStorage
- 资源/警报数据 5~10s 轮询刷新；顶栏无后台信息（服务地址等已收进设置弹层）

### 3.1 总览页

- 世界摘要
- 玩家统计
- 最近事件与告警
- 顶栏手动保存

### 3.2 星图导航

- `/galaxy`：Pixi.js 渲染的全屏银河星图（`features/starmap/`），登录后的默认落地页。恒星按谱型（O/B/A/F/G/K/M）着色发光、按真实坐标布局，近邻恒星间有航线连线；未探明星系暗淡显示。支持拖拽平移、滚轮连续缩放（文字标签保持屏幕空间大小）、单击选中浮出情报卡、双击或持续放大进入恒星系
- `/system/:systemId`：与星图同一场景的恒星系视图深链——中心恒星 + 行星轨道环 + 公转动画，行星按种类着色（气态带条纹），单击选中浮出情报卡，双击或卡片按钮进入 `/planet/:planetId`；双击空白或持续缩小返回银河；面包屑可返回银河层
- 星图战争覆盖层（期4c）：`model.ts` 新增 `summarizeFleetsBySystem`（舰队按 system_id 聚合成驻留概况：总数 + attacking 计数，按 systemId 排序保证确定性）与 `selectWarLanes`（筛出端点为 attacking 星系的航线，方向定为从 attacking 端向外）；`scene.ts` 据此新增舰队徽标层（菱形+glow+数量角标，驻留蓝色微光 / attacking 红色脉冲，脉冲相位差确定性、不用随机）与战火航线（attacking 星系的相连航线叠红色基线，亮点沿线循环流动、两端渐隐）；`StarmapView.tsx` 复用与 WarPage 相同的 `war-fleets` query key/函数装配数据（共享 react-query 缓存，不发新请求）；全部动画走 frozen 门
- 渲染基础在 `src/engine/`：`PixiStage`（React 挂载点）、`camera`（连续缩放/飞行补间相机）、`textures`（程序化纹理：恒星光晕/行星球体/星场/星云/emoji 字形，零美术资源）、`tween`；星图 URL 加 `?freeze=1` 可冻结动画供截图测试
- 战斗事件总线（期4a）：`src/engine/battle-events.ts` 把 SSE 瞬时战斗事件（`missile_salvo_fired / point_defense_intercept / battle_report_generated / damage_applied / entity_destroyed`）从 react-query 失效管线分流一份给演出层（特效/音效），payload 透传、不进任何 store；总线内自增 seq 供订阅方去重（StrictMode 双挂载/多重转发时同一事件只演出一次），订阅返回退订函数；`use-war-realtime`（/war，期4a）与 `use-planet-realtime`（/planet，期4c）各自在 SSE 回调里 `forwardGameEventToBattleBus`，两 hook 挂在不同路由，不会同页双转发
- 程序化音效（期4b）：`src/engine/audio.ts` WebAudio 合成引擎，零音频资源零新依赖——振荡器 + 白噪声两个合成原语，惰性 AudioContext + 首次手势（pointerdown/keydown 捕获阶段）解锁，解锁前播放静默丢弃；语义 `sfx` API：`fire / explosion(big) / intercept / commandOk / commandFail / buildComplete / researchComplete / alert / uiClick`；同类 50ms 窗口限流 3 次防炸耳、战斗音效 ±30 音分 detune 防机械感、无 AudioContext 环境整体 no-op 降级。挂接：App 级 `features/audio/use-game-audio.ts`（AppShell 挂一次）订阅战斗总线——齐射→fire、点防→intercept、战报/击毁→explosion（damage_applied 不发声，避免同帧叠音）；`use-war-command` 的 notify 按成功/失败播 `commandOk / commandFail`；`use-planet-realtime` 经 `features/audio/planet-audio.ts` 播建造完成/研究完成/产线告警/火箭发射（event_id 去重）；顶栏静音开关见 3.0
- `/planet/:planetId`：行星观察页
- `/war`：战争工作台
- `/agents`：AI 智能体工作台

### 3.3 战争工作台

当前已支持：

- `/war` 新增长期战争工作台，沿用当前大战略骨架，不退回调试表单堆叠页
- 推荐直接配合 `server/config-war.yaml + map-war.yaml` 使用；官方战争验证局已经为 `p1` / `p2` 预置部署枢纽、军工底座、补给节点和 `prototype|precision_drone|corvette|destroyer` 公开科技，适合直接验证战争入口
- 蓝图工作台：可创建蓝图、查看底盘与组件槽位、执行 `blueprint_set_component` / `blueprint_validate` / `blueprint_finalize` / `blueprint_variant`（蓝图改型），并直接展示非法原因、预算占用和角色预估
- 军工总览：聚合量产单、翻修单、部署枢纽和补给节点，可直接对选定蓝图发起一次部署尝试，并可通过「量产排队」「翻修改装」表单下达 `queue_military_production` / `refit_unit`，把“当前部署枢纽不支持该蓝图”等失败原因解释成玩家可读提示
- 战区面板：聚合任务群与战区目标，可直接调整 `task_force_set_stance`，对当前焦点行星发起 `blockade_planet` / `landing_start`，并通过表单完成 `task_force_create` / `task_force_assign` / `task_force_deploy` 与 `theater_create` / `theater_define_zone` / `theater_set_objective`
- 战报与情报面板：集中展示 `contacts`、`battle_reports`、`planet_blockades`、`landing_operations`，并直接暴露当前补给状态和短缺项；舰队指挥表单可下达 `fleet_assign` / `fleet_attack` / `fleet_disband`
- 战场态势面板：`features/war/battlefield/BattlefieldMap.tsx` 绘制星系级示意图（恒星、行星轨道圈、己方/敌方舰队接触标记、封锁圈虚线、登陆行动），点击标记可选中并回传，让玩家「看懂战局」而不再只看文字列表；渲染已 Pixi 化（期4a）：`battlefield-scene.ts` 场景类（glow 恒星/行星节点、菱形舰队标记、虚线封锁环）+ `battlefield-model.ts` 布局纯函数 + `battlefield-effects.ts` 特效池，DOM chrome（标题/图例 war-list/制空权摘要/已选中回显）契约不变
- 战场事件驱动演出（期4a）：场景订阅战斗事件总线，导弹齐射画弹道轨迹+拖尾、爆炸播扩散环+火花+伤害飘字、点防拦截闪光、击毁播大爆炸；与星图同一约定，URL 加 `?freeze=1` 进入 frozen 模式冻结脉冲与全部特效，供确定性截图
- 命令反馈改为短历史，不会被下一条操作覆盖，便于在浏览器内连续核对蓝图、部署、封锁、登陆的 authoritative 回执
- 命令提交管道统一收敛到 `features/war/use-war-command.ts`，查询键统一由 `features/war/war-query-keys.ts` 构造；新增命令表单落在 `features/war/components/forms/` 下，自管表单状态、复用同一提交与反馈通道，避免在 WarPage 内堆叠手写 handler
- 已补 `client-web/tests/war-workbench.spec.ts`，覆盖桌面和窄屏两条浏览器回归
- 已补 `client-web/tests/war-workbench-authoritative.spec.ts`，会配合 `server/config-war.yaml + map-war.yaml` 与 `server/scripts/start_official_war_test_server.sh` 启动官方战争验证局，实测蓝图改型、军工量产、舰队编成、战区配置、封锁与登陆链路
- 已补 `client-web/tests/war-workbench-pure-gui.spec.ts`（P0 验收）：全程只用 GUI 打完官方战争局——蓝图创建/填槽/校验/定型→量产排队→舰队编成→任务群组建/编组/部署→战区创建/定义/目标→封锁，0 处 apiCommand 战争准备
- `WarPage.test.tsx` 新增「12 个新战争命令表单的纯 GUI 提交」用例，覆盖 `blueprint_variant / queue_military_production / refit_unit / theater_create|define_zone|set_objective / task_force_create|assign|deploy / fleet_assign|attack|disband`
- 实时层收敛：`features/war/hooks/use-war-realtime.ts` 复刻 `use-planet-realtime` 模式，订阅 `/events/stream`（`shared-client/config.ts` 的 `ALL_EVENT_TYPES` 已补齐 13 个战争事件）→ 150ms 防抖批量失效对应 query；WarPage 的 8 路 1 秒轮询收敛为 `summary`(15s) + `system-runtime`(10s) 兜底，其余改 SSE 驱动
- 顺手修复创建蓝图表单的 domain 口径：选项由过时的 `ground_unit/space_unit` 改为真实 catalog 的 `ground/air/orbital/space`，底盘选择基于 `isSpaceDomain` 判定，避免与 server 校验不一致导致创建执行失败
- 战争页全屏化（期6a）：WarPage 重写——战场图吃满 app-body、左上标题片，蓝图/军工/战区/战报四组 Tab 收右侧抽屉（选中标记/新回执自动滑出）；抽取共用抽屉组件 `common/MapDrawer`（行星页工作台抽屉同步换用）；BattlefieldMap chrome HUD 化（摘要右上 / 图例左下 / 选中回显底部居中）；战场视觉密度按 1/√scale 补偿适配大画布；`page-grid--planet` 改名 `page-grid--map`
- 当前边界：
  - AI 军事委派已经在 `/agents` 工作台和 `agent-gateway` 落地，但不在 `/war` 页内直接配置；推荐先用 `/war` 建好任务群/战区，再到 `/agents` 做委派和审计

### 3.4 行星页

当前已支持：

- 地形、资源、建筑、单位、迷雾图层
- 物流轨迹、电网、管网、施工、敌情图层
- 行星工作台首屏：`PlanetOperationHeader` 会固定显示当前路由行星、当前 active planet、最近命令结果和待处理命令数
- `PlanetCommandCenter` 作为首屏主操作区，已补齐 `transfer_item`、`switch_active_planet`、`build_dyson_*`、`launch_solar_sail`、`launch_rocket`、`set_ray_receiver_mode` 等 typed form 入口
- `战斗与制造` 页签：建筑量产（`produce`），候选从生产建筑动态填充；`attack` / `upgrade` 表单已随期3a 迁到地图直操作（见下方"地图直操作"）
- `取消与恢复` 页签：取消建造（`cancel_construction`）、恢复建造（`restore_construction`）、取消当前研究（`cancel_research`）、拆除戴森组件（`demolish_dyson`）集中处理；任务候选来自 `runtime.construction_tasks`，研究来自 `current_research`，戴森组件来自 `systemRuntime.dyson_sphere.layers`
- 地图直操作（期3a）：store 的 `interactionMode`（`inspect / build / move / attack`）决定地图点击语义，Esc/右键退出当前模式。底部建造栏 `PlanetBuildBar`（推荐/已解锁分组 + 造价显示）点选建筑进入建造模式，地图悬停显示幽灵 footprint（绿=可建 / 红=阻塞，复用 `build-workflow` 格评估），点击直接下达，本地预检拦截会写 journal，模式保持支持连续放置；`PlanetSelectionBar` 给选中建筑升级/拆除、选中单位移动/攻击（进入地图点选模式，准星高亮），与表单共用同一 `submitPlanetCommand` 管道
- `研究与装料` 页签现在是阶段化研究工作台：顶部展示当前研究卡片与开局推荐路径，中部按 `当前可研究 / 已完成 / 尚未满足前置` 分组科技，点击卡片后再通过 `start_research` 真正提交命令
- 研究派生逻辑已拆到独立模块；组件层主用 `summary.players[pid].tech.current_research` 与 `completed_techs` 推导 UI，若运行时仍遇到旧版 `completed_techs` level map，只在派生层内部归一化，不向组件扩散
- 命令结果账本：提交后先显示 `pending`，再优先由 SSE authoritative 回写切到最终成功或失败；默认会收口 `command_result`，并把 `research_completed`、`rocket_launched` 这类异步完成事件也视作最终成功态。如果等待超时，会补拉 `/events/snapshot` 对账，并附带下一步提示
- 命令结果账本的下一步提示现在带上下文：`transfer_item` 对 `matrix_lab` / `em_rail_ejector` / `vertical_launching_silo` 会分别提示后续研究、太阳帆发射或火箭发射；`set_ray_receiver_mode` 会根据 `power / photon / hybrid` 提示不同观察重点
- 实体详情侧栏
- 事件时间线与告警面板；活动流支持 `关键反馈 / 全部事件 / 仅命令 / 仅告警` 四种模式，默认会折叠 `tick_completed`、`resource_changed`、`threat_level_changed` 这类低信号事件
- SSE 增量同步与补拉
- 调试面板
- 地图渲染已迁到 Pixi（期3b）：`PlanetMapPixi.tsx` + `planet-scene.ts`（替代已删除的 `PlanetMapCanvas.tsx` 与 `entity-draw.ts`）。底图（地形/网格/迷雾/overview 热力）由 `planet-base-map.ts` 离屏生成 1px/tile（overview 1px/cell）画布转纹理，地形 nearest 放大保硬边、迷雾 linear 得软边界；实体视觉已随期5c 换代为程序化矢量精灵（见下），物流/船虚线、电网、管道、敌情、选中框/建造幽灵/准星仍走 Pixi Graphics，虚线用 `buildDashSegments` 切段模拟（Pixi Graphics 无原生 dash）
- 单位平滑移动：ticker 每帧把单位显示位置向数据位置指数趋近（`smoothingBlend`，k≈8/s，帧率无关），ticker 只做平滑移动/选中环脉冲/建筑轻量动效（期5c 风机叶片、警示与辉光呼吸）这类轻量动效，不做数据重建；URL 加 `?freeze=1` 冻结动效供截图测试
- 行星战斗伤害特效（期4c）：`planet-effects.ts`（特效池 + damage_applied→特效指令映射纯函数，不依赖 Pixi）+ `planet-scene.ts` 的 `effectsLayer` / `handleBattleEvent`；行星页 SSE 经 `use-planet-realtime` 新增的 `forwardGameEventToBattleBus` 分流到战斗事件总线，组件侧订阅总线驱动演出：damage_applied 触发开火闪光（攻击方→目标弹道亮点 + 渐隐亮线，防御塔黄白/普通单位青白）、`-{damage}` 伤害飘字（敌方受击红/己方受击橙）、受击节点闪白（alpha 正弦脉冲，节点中途销毁则停演）；目标解析不到当前实体树（如敌情 marker）时不演出，entity_destroyed 不做演出、由实体增量同步自然消失承担；frozen 模式不演出
- 语义实体 DOM 层以 ghost 形式保留（`entity-layer--ghost`，`opacity:0` + `pointer-events:none`，禁止 display:none/visibility:hidden）：带 `data-entity-*` 的节点仍供 DevTools/agent 定位（Playwright 对 opacity:0 仍判 visible），点击命中仍走 surface 的 pointToTile；可见实体收集与资源色板在 `visible-entities.ts`（Pixi 场景与 DOM 层共用）
- 调试面板"导出 PNG"改用 Pixi `extract.canvas(app.stage)` 整体抓舞台（与屏幕所见一致），不再走 canvas + entity-draw 合成
- 行星页全屏化（期5a）：删 page-hero/三列 workbench，地图吃满 app-body，行星信息改悬浮标题片、图层与缩放收左下 `PlanetMapToolbar`、工作台改右侧抽屉（选中/回执自动滑出）；缩放档重排 9 档（scene 1/2/4/8/16/32px，默认 8px），档间 180ms 补间 + zoom-to-cursor，统一 `requestZoom` 入口（±按钮/快捷键/滚轮同一管道），+/- 快捷键以视口中心为锚；网格默认关、建造模式自动叠加，迷雾 alpha 用确定性噪声抖动
- 拟真分块地表（期5b）：`planet-terrain-chunks.ts` 在有效 tileSize ≥4px 的 scene 档启用 64×64 tile/chunk、8px/tile 离屏烘焙（1/2px 档与 overview 维持低成本整图画布）；可见块按需生成（含 1 圈余量、视口中心优先），LRU 上限 64 块，惰性补块每帧 ≤2（frozen 同步补齐保截图确定），地形变化按 FNV-1a 变体签名逐块脏校验；每格 8×8px 内土壤/水面噪色、水岸泡沫、岩浆描边暗壳、blocked 隆起浮雕全部确定性种子（(x,y,px,py) hash，纯函数可测）；氛围层：水面低分辨率动态遮罩流光（add 混合 + alpha 呼吸）+ 岩浆呼吸辉光 + 全屏轻暗角，相位走固定时钟、frozen 锁 0；相机对小图两轴视口居中、拖拽/缩放逐轴钳位
- 行星实体程序化矢量精灵（期5c）：`planet-building-sprites.ts` 把建筑从"footprint 描边盒 + 居中 emoji"换代为离屏烘焙剪影精灵——6 种原型（tower/dome/furnace/depot/belt/special，类型映射表 + 关键词兜底）按 32px/tile 超采样绘制"投影 → 底座板 → 主体结构 → 顶部细节"，水平约 8% 溢出 footprint（Factorio/Civ 式伪 3D），同原型内靠类型级点缀色区分；纹理全局缓存（键 `bldg:<archetype>:<w>x<h>:<state>`，队伍归属不入键、由场景侧底座描边条承担），Sprite 缩放到 footprint×tileSize 显示，建筑层按 tile 底部 y 排序防溢出穿插；emoji 降级为右上角类型角标（≥16px 档显示），受损/故障走 distressed 烘焙变体（暗化 + 警示斜纹）+ ⚠️ 角标呼吸，wind_turbine 叶片独立 sprite 在 ticker 旋转（id hash 相位、frozen 锁 0），furnace 发光窗辉光呼吸；单位圆点改带朝向楔形（朝向 = 移动目标/攻击目标/最近朝向，默认朝上，队色描边 + 暗底），受伤画 HP 弧（顶部 90°、绿→黄→红，不随朝向旋转）；资源 emoji 坐上晶簇/岩块底座贴花（kind hash 确定性形状）；工地 3px 色框改脚手架（虚线轮廓 + 四角 L 支架 + 对角撑 + 底部进度条）；水岸泡沫打磨为按边过渡（只在水格与陆格相邻的边画、水-水边无缝融合，大片水域内部均匀只有轮廓岸线），消除散点水域的"每格全边白框"瓷砖感
- 行星页交互与视觉打磨（期6c）：建筑+单位合并为单个 `entitiesLayer`（sortableChildren）按统一排序键遮挡——建筑取 footprint 底行 y、单位取平滑移动显示位置的小数 tile y（创建/frozen 同步/ticker 逐帧三处更新），单位走到高建筑北侧会被向上溢出的结构遮住；buildings/units 图层开关相应落到逐节点 visible；传送带 chevron 方向纹接通 server 既有数据（`Building.conveyor.output`，shared-client 补类型声明，仅 conveyor_belt_* 携带，建成时服务器已把 auto 解析为实方向），belt 原型按 4 向烘焙变体（横/竖带体 + 朝向 chevron，缓存键追加方向段，auto/缺失回退 east）；地块 hover 轻量高亮为独立 Graphics（1px 内缩白框 + 6% 白填充，形状只随 tileSize 重画，hover 变化仅动位置/可见性零重建；inspect/move/attack 显示，build 由幽灵 footprint 承担不叠加，overview 隐藏）；建造范围圈预览评估后跳过（catalog 无 range 数据，`runtime.functions.combat.range` 只存在于已放置建筑，放置前幽灵拿不到，不硬造）；受损 distressed 建筑/受伤单位 HP 弧已做运行时目检（临时 fixture + 离线截图，不进仓库）
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
- 行星地图直操作：建造栏选卡后幽灵预览是否跟随悬停（绿/红着色）、点击放置是否有命令回执、右键/Esc 是否退出模式；Pixi 地图是否正确显示地形/迷雾/建筑/单位/资源，缩放平移与单位移动是否顺滑
- 命令提交后是否先进入 `pending`，再被后续 `command_result` / `research_completed` / `rocket_launched` 覆盖为最终结果
- `/war` 是否能同时展示蓝图、军工、战区、战报四个长期面板，并能看到蓝图非法原因、部署失败原因、登陆失败原因等解释性提示
- `/war` 在窄屏下是否仍能看到蓝图创建、部署蓝图、任务群姿态和封锁入口，不会因为布局塌陷而失去最小操作闭环
- `/agents` 的频道切换、私聊、消息发送、按星球拉人、定时任务创建是否正常可见
- agent 自动回复后，请求卡片、turn 状态、最终回复和失败原因是否能自动刷新并挂回正确请求

### 4.2 常用验证组合

- Playwright：验证核心交互回归
  - `tests/war-workbench.spec.ts`：战争工作台桌面与窄屏回归
  - `tests/war-workbench-authoritative.spec.ts`：自动拉起官方战争验证局，验证 `/war` 对 authoritative 战争场景的真实操作闭环
  - `tests/planet-entity-dom.spec.ts`：行星地图实体的 ghost DOM 可见性契约（`data-entity-*` 可定位、点击穿透后命中选中）
  - `tests/planet-build-workflow.spec.ts`：建造栏选卡 + 地图点选放置的全流程 authoritative 回执
  - `tests/visual.spec.ts`：总览/星图/行星地图/回放的截图基线（行星地图基线已随 Pixi 迁移及期5 各期视觉换代重录，期6b 星图基线因 TopNav 新增铃铛重录，重录前人工核对 actual）
- vitest 纯逻辑单测（期4 新增）：`src/engine/battle-events.test.ts`（总线分流/seq 去重）、`features/war/battlefield/battlefield-model.test.ts` + `battlefield-effects.test.ts`（布局纯函数/特效池）、`src/engine/audio.test.ts` + `features/audio/game-audio.test.ts`（合成参数/限流/事件→音效映射）、`features/planet-map/planet-effects.test.ts`（伤害特效映射）、`features/starmap/model.test.ts` 增补（舰队聚合/战火航线定向）
- vitest 行星地图单测（期5 新增）：`features/planet-map/planet-terrain-chunks.test.ts`（分块可见集合/LRU/FNV 签名/按边过渡邻域规则与像素级泡沫）、`features/planet-map/planet-building-sprites.test.ts`（原型映射/烘焙布局与缓存键/distressed 判定）、`features/planet-map/planet-scene.test.ts` 增补（单位楔形与朝向/HP 弧参数/工地进度/资源贴花确定性）
- vitest 期6 新增：`features/notifications/notifications.test.ts`（期6b：store 栈上限/消退 sweep/mergeKey 合并/event_id 去重 + 17 类事件映射）；`features/planet-map/planet-scene.test.ts` 增补（期6c：遮挡排序键/hover 高亮状态机）、`planet-building-sprites.test.ts` 增补（期6c：方向纹变体缓存键/conveyor.output 方向解析）；期6c 未触动既有截图基线（无鼠标截图天然不受遮挡排序/hover 影响）
- 冻结截图约定：星图/行星地图/战场图统一用 URL `?freeze=1` 进入 frozen 模式，脉冲/公转/特效演出/风机叶片与辉光呼吸全部静止（相位锁 0），供确定性截图
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
