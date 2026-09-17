# 项目操作与约定

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
