# T004 建筑与设施基础框架

## 需求细节
- 建筑分类与定义：采集、运输、仓储、生产、化工、精炼、电力、电网、研究、物流枢纽、太空与戴森球、指挥与信号。
- 建筑功能挂载与基础运行参数模型（功耗、产能、占格、连接点等）。
- 生产加成与喷涂系统：加速与增产规则、喷涂影响与消耗。
- 建筑升级与拆除：升级链、回收率、拆除规则与返还。
- 详细建筑功能与规格对齐 `docs/archive/reference/建筑功能说明.md`。

## 前提任务
- T029 建筑分类与定义落地
- T030 建筑功能挂载与基础运行参数
- T031 生产加成与喷涂集成到建筑
- T032 建筑升级与拆除规则落地

## 实现结果
- T029-T032 已完整覆盖本任务需求：建筑分类与定义（`server/internal/model/building_catalog.go`、`server/internal/model/building_defs.go`），运行参数与功能挂载（`server/internal/model/building_runtime.go`），喷涂与生产加成结算（`server/internal/model/production_cycle.go`），升级与拆除规则（`server/internal/model/building_rules.go` + `server/internal/gamecore/rules.go`）。
- 建筑功能与规格已与 `docs/archive/reference/建筑功能说明.md` 对齐，未新增兼容层或适配逻辑。

## 测试
- /home/firesuiry/sdk/go1.25.0/bin/go test ./... (workdir=server)
