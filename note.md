# 项目操作与约定

- 2026-09-29 遭遇战骨架：`server/map-skirmish.yaml`（face 96、同面双出生点、`resources.contested_center`）配合 `server/config-skirmish.yaml`（p2 bot hard；pace_research 6 / pace_build 2 / pace_output 2 / time_limit_ticks 54000 / threat_growth_scale 1.5）。启动：`cd server && go run ./cmd/server -config config-skirmish.yaml -map-config map-skirmish.yaml`。地形改为球面 3D 噪声，scene 可选 `height`。默认 map.yaml 仍 face_size 816、节奏倍率 1。旧种子的地形/资源位置不再与白噪声生成器一致。缺口余项见 [缺失内容清单](docs/guide/缺失内容清单.md)。

- 2026-09-18 DSP 行星内全量对齐进行中：冻结范围与验收基线见 [dsp行星内生产对齐范围](docs/dev/dsp行星内生产对齐范围.md)；数据工具链 develop_tools/dsp-catalog（scope.json=冻结闭包，mapping.json=未匹配清单，catalogdump 生成 current_dump.json 后跑 build_scope.py 即得差距）。W1 目录对齐已合 main（物品102/资源18/配方118/科技147/建筑62，parity+closure 测试在 model/dsp_alignment_test.go）。
- 用户要求：复杂游戏计算留在后端；浏览器负责 3D 表现与操作，目标为《戴森球计划》式工业与星球质感，不能把能转动的球体当成画质完成。
- 行星与恒星系默认 3D，`?view=2d` 切平面战术；3D 必须实际浏览器验证建造、兵力移动和局势显示。
- Go：`/home/firesuiry/sdk/go1.25.0/bin`。前端构建和测试在 `client-web/` 运行。
- 3D 开发、验证、素材与待完成事项见 [3D表现开发指南](docs/guide/3D表现开发指南.md)；素材来源见 [3D素材来源](docs/guide/3D素材来源.md)。
- 用户已有的 AGENTS.md、B站 cookie/二维码、视频和下载目录不随本任务提交。只提交当前任务文件，测试通过后提交 main 并推远程。
- 静态与转子动画部件均已跨建筑实例化；工业材质新增共享PBR纹理。千栋风机24000→16次绘制仅为同类隔离诊断，不等于完整混合工业场景 FPS 达标。
- 2026-09-15 用户重新要求提升画质、完善玩法与内容，对标《戴森球计划》；本轮新增工业生产规划、六阶段发展导航与动态画质档位，说明见 [工业发展与画质增强](docs/guide/工业发展与画质增强.md)。

- 行星网格已改为唯一六面 cube_sphere；配置只用 planet.face_size，旧平面存档拒绝加载。坐标/面方向/跨面场景协议见 [立方体球面网格](docs/guide/立方体球面网格.md)。
- 行星内生产配方已进 `server/internal/model` 权威目录并由科技门控；无科技引用的非基础配方不得默认放行。缺口批次见 [DSP行星内容缺口实现计划](docs/guide/DSP行星内容缺口实现计划.md)。
- CLI 具名动词覆盖 `shared-client` 公开命令目录；`summary` 会打印执行体 ID 与背包，便于观察 `craft_item` / `transfer` 结果。

- 全量星球玩法目标与缺口持续记录在 [星球玩法覆盖与验收](docs/guide/星球玩法覆盖与验收.md)。量产战斗 mecha 尚不等于玩家机甲；piler 的总缓存容量尚不等于真实叠层增运。精炼闭环浏览器回放用 `scripts/playtest-refinery.mjs`。

- 玩家机甲核心回放：`scripts/playtest-player-mecha.mjs`。近距双玩家隔离配置、已解锁核心/引擎/护盾及煤库存；UI 补能和真实攻防验证，仍不等于完整玩家机甲（飞行/采集/充电等见覆盖文档）。

- 传送带/分拣器截图必须验证真实库存增长与机械臂动作；慢刷新不能丢弃两次观察间的新搬运。回放与证据见 [物流浏览器回归](docs/guide/传送带与分拣器浏览器回归.md)。

- 制造台/地基/炮塔回放分别用 `scripts/playtest-assemblers-browser.mjs`、`scripts/playtest-foundation-browser.mjs`、`scripts/playtest-defense-browser.mjs`；隔离配置要求见脚本头部，结果与未完成项见星球玩法覆盖文档。

- 连续皮带还需识别建筑真实 IO 端口；分拣器长臂动态实例须更新包围球，搬运中不能切换端点。回放加 `SW_TRANSPORT_RECORD=1` 可录真实搬运动图（需 ffmpeg），详见物流浏览器回归文档。

- 默认新局机甲起步回放：`scripts/playtest-mecha-start-browser.mjs`；空库存UI采铁/煤、补能、手造取消退款、建风机/电塔充电均有证据。大地图headless建议流畅画质；原均衡画质回放曾超时并从同局分段续作，准确范围见星球玩法覆盖与验收。

- 四向分流器回放：`scripts/playtest-splitter-browser.mjs`，CLI建造/装料、UI过滤/优先级、满带旁路与重建恢复；使用明确预解锁平地隔离场景。缺状态的旧装饰性分流器存档拒绝恢复；分流器高度布局仍待实现。

- 小地图scene首屏未知图集尺寸时不传默认窗口推算的near中心，先矩形查询，再按当前server/player/planet缓存尺寸裁剪；避免face16的48×32地图返回400。

- 高级加工回放：`scripts/playtest-advanced-processing-browser.mjs`，预置科技/原料的隔离场景；真实氢外循环、喷涂耗剂和三种对撞配方。分馏/喷涂固定西入东出及专属侧口，不支持旋转/管道。通用生产已按供电比例减速并保留progress_fraction，完整缺口见星球玩法覆盖文档。

- 欠压/监测回放：`scripts/playtest-power-monitor-browser.mjs`（19497/4187独立场景），分阶段保存重编续档验证。监测器按相邻皮带真实流出统计，配置重置窗口，关闭告警不停止采样。

- SSE高频刷新使用串行合并调度并保留在途变更的尾随刷新，防止取消慢查询或漏掉最后事件；不能单独加cancelRefetch:false。回归 `realtime-invalidation.test.ts`。

- 物流站不再免费生成运输器；先接电配槽/皮带，再制造并安装无人机/运输船；install默认扣背包，`--source station` 扣站库成品，支持制造台皮带入站安装。唯一库存为 `logistics_station.inventory`，喷涂货物入口背压。回放 `scripts/playtest-logistics-station-browser.mjs`（19498/4188），运行边界与待验收项见 [星球玩法覆盖与验收](docs/guide/星球玩法覆盖与验收.md)。
- 本轮完成仓库配送器、配送机器人、机甲物流请求的服务端、CLI、Web 与 3D 可视化；验证命令和运行约束见 docs/dev/服务端API.md、docs/dev/客户端CLI.md、docs/player/玩法指南.md。
- 配送器真实回放 `scripts/playtest-distributor-browser.mjs`（19500/4190；隔离配置见同目录fixtures/distributor/README.md）。配送库存必须包括主仓和IO缓存；详情用runtime刷新库存/充电。2026-09-17补齐实际仓库缓存回归、机甲送收与飞行截图。
- 2026-09-18 W2 研究站与建造体验：新增 set_recipe 命令（原地切换配方/研究模式，进度清零库存保留、非法原子拒绝）；研究站/生产建筑垂直叠层（vertical_construction 逐级解锁，叠层共享底层库存、研究吞吐线性叠加）；mass_construction 接入建造区域并发上限；战斗科技效果（weapon_damage/structure_hp/shield_capacity）经主科技树 start_research 研究、settleCombatTech 每 tick 结算到战斗单位（更正：CombatUnit 只在测试中生成，真实对局里只对执行体生效，见缺失内容清单 U6），旧的并行 CombatTechManager/PlayerCombatTechState 死代码已删除；dark_fog_matrix 隐藏科技改为持有触发物品可见。测试在 server/internal/gamecore/research_station_w2_test.go。
- 2026-09-28 用户目标“戴森球计划+红警感”：工业侧已厚，红警侧（实时战斗/进攻型敌人/遭遇战AI/RTS操作/对局框架）基本空缺；全系统缺口（带代码证据、验收标准、P0-P2 与里程碑）见 [缺失内容清单](docs/guide/缺失内容清单.md)。
- 2026-09-29 用户纠偏：只要红警/星际的“感觉”，不照搬红警内容（超武、EVA、英雄/空降等不做）。两条主线：①多兵种交战（星际式少而精）②弹药补给由 DSP 产线生产并运到前线。D7 已拍板（大混战+军团指挥、单位实物造价、弹药三类、打空停火、补给站+补给车、不做墙），见 docs/guide/对局设计决策.md。
- 2026-09-29 整体规划：docs/guide/整体规划.md（阶段一 行星内可玩：3.0 数据配置化 F8→3.1 底座→3.2 弹药补给 U10→3.3 兵种/生产→3.4 军团→3.5 防御袭扰→3.6 bot 与收口；阶段二 舰队/星际；阶段三 终局）。各块靠自动化测试收口，全部完成后统一试玩（用户 2026-09-29 要求）。
- 2026-09-28 缺失内容清单实施启动：目标文档 docs/guide/缺失内容清单.md，拍板 docs/guide/对局设计决策.md（D1 60-90分钟遭遇战主模式/D2 机甲英雄+建造半径/D3 黑雾+bot+PvP 三位一体/D4 暂缓/D5 顾问+对手/D6 双轨划界），进度追踪 docs/guide/缺失内容清单-进度.md。M1 服务端核心已完成：单位统一实时移动/自动交战/unit_order 指令集/小队实体化/地面 PvP；执行体（机甲）保留瞬移与手动一击至 I16；单位寻路预算上限 800 格，占位不重叠+侧移绕行。
- 2026-09-28 落地视图与失败提示：登录/根路径默认直达 active_planet 的 3D 行星视图（OnlyGuests 改跳 "/"，由 routes 的 ActivePlanetLanding 统一决定落地页，回退 /galaxy）；命令失败三条提示路径都要中文+显眼——HTTP 拒绝走 executor 弹 danger toast，执行期失败靠 event-toasts 的 command_result 映射兜底（accepted 后 executor 不弹），日志文案在 store 写入时翻译（toPlayerFacingMessage 错误兜底/toPlayerFacingFeedback 成功保留原文）；提示推导（resolveNextHint/error-hints）依赖英文原文，必须用 debugMessage 匹配。planet-terrain-chunks 环绕像素测试在全量并行下偶发 5s 超时，单跑稳定通过（既有性能抖动）。
- 2026-09-29 F1 新局热重置落地：服务端从“一局一生”改为 Runtime/Session 原子换局（startup.Runtime 持有 atomic.Pointer[Session]，gateway 全部 handler 经 rt.Current() 访问）；新增 POST /games/new（仅 admin）与 GET /games/current；victory_rule 新增 sandbox；快照 store 按局隔离防止跨局 rollback 污染；autosave/tick goroutine 由 Runtime 交接；CLI 新增 game_new/game_status（game_new 成功后自动切到新局 admin key）。注意 LoadRuntime 现在不启动 goroutine，须显式 rt.Start()（main.go 已接）。
- 2026-09-29 F2 客户端结算：路由 `/settlement`（AppShell 已登录）。终局提示记 `sessionStorage` 键 `gw.settlement-prompted`（started_at::declared_tick），同一局不重复刷。命令拒绝码 `GAME_FINISHED` 走行星 executor、战争 `useWarCommand`、SSE `command_result`。终局不登出。CLI `game_status` 打 status/战损。

- 2026-09-29 F4 每人独立的行星焦点落地：命令按目标行星路由（gamecore/command_routing.go 的 resolveCommandWorld：target.planet_id 显式提示 → 目标实体所在行星 → 玩家 focus_planet_id → 全局活动行星兜底）；switch_active_planet 只写 PlayerState.FocusPlanetID，不再改全局 activePlanetID、不拖拽执行体；settleWarIndustry 小队落地按订单 SourcePlanetID 反查世界、settleDistributors 去掉 active 门控（每颗行星配送器服务本行星执行体）、执行体并发占用跨行星聚合（countActiveExecutorUsage 收 worlds）。CLI 行星层命令普遍支持 --planet；shared-client 同名函数加可选 planetId（后兼容），cmdDeploySquad 的 target 不再带 planet_id（落点只在 payload）。测试 server/internal/gamecore/f4_planet_focus_test.go（TestF4* 五个）。

- 2026-09-29 当前 WSL 会话 Go 实际路径：/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin/go（2026-09-30 实测；旧 PHYSICALDRIVE3p1 路径已失效）；受限环境测试用 GOCACHE=/tmp/gw-go-cache GOTOOLCHAIN=local。游戏配置覆盖键为 server.game_data_dir，server.data_dir 仍用于存档，格式见 [数据配置文件](docs/dev/数据配置文件.md)。

- 2026-09-30 第一阶段自动化收口：3.0–3.6 服务端与客户端已实现，`go test ./...`、client-web（tsc+vitest）、client-cli、command_coverage 全绿。`df_` 单位物品配方已删（弹药类 df_ 配方保留）；新增 form_squad/squad_order/dissolve_squad、set_rally_point、防空击落物流无人机（air_defense.go）。测试注意：client-web 并行跑时 AgentsPage/industrial-finishes 偶发 5s 超时（单跑或 --testTimeout=60000 通过）；client-cli 的 official-war-regression 需要 PATH 里有 go（脚本写死的 /home/firesuiry/sdk 路径在本机不存在）。遗留：bot 尚未用 form_squad 编军团、C9 新手引导、浏览器实拍与 60–90 分钟试玩（整体规划第 4 节）。
- 2026-09-30 补缺口：补给收敛为三类弹药（ammo/shells/missiles，删燃料/备件/护盾电池/维修无人机；precision_drone 因是无人机载荷保留）；子弹<炮弹<导弹科技门控有测试；舰队只从补给站/补给车补弹；bot 用 form_squad/squad_order 编军团（bot_legion.go）；客户端军团面板/标记/箭头、新手引导（war-guide.ts）、全星球缺弹横幅。case1 测试的 agent_already_running 是 agent-gateway 上一条消息仍 running 的时序竞争，测试改为重试。
