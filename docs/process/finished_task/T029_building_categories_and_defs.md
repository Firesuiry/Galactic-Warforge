# T029 建筑分类与定义落地

## 需求细节
- 建筑分类体系落地：采集、运输、仓储、生产、化工、精炼、电力、电网、研究、物流枢纽、太空与戴森球、指挥与信号。
- 建筑定义与基础元数据（名称、分类、可建条件、解锁条件）。
- 详细建筑功能与规格对齐 `docs/archive/reference/建筑功能说明.md`。
- 为后续运行参数与功能挂载预留扩展点（不做兼容适配）。

## 前提任务
- 无

## 实现结果
- 现有实现已覆盖建筑分类体系与定义：`server/internal/model/building_catalog.go` + `server/internal/model/building_defs.go` 定义采集/运输/仓储/生产/化工/精炼/电力/电网/研究/物流枢纽/太空与戴森球/指挥与信号，并与 `docs/archive/reference/建筑功能说明.md` 的建筑清单对齐。
- 建筑定义包含名称、分类、可建条件（`Buildable`、`RequiresResourceNode`）与解锁条件字段（`UnlockTech`），满足基础元数据要求。
- 建筑目录支持注册/替换/加载（YAML/JSON），并与运行参数目录解耦，形成后续功能挂载的扩展点。

## 测试
- /home/firesuiry/sdk/go1.25.0/bin/go test ./... (workdir=server)
