# 已知问题

只记录仍未修复的问题；修复后直接删掉条目（历史见 git）。

## start_research 缺矩阵时静默失败

- 状态：待修复（2026-07-31，路径 A 试玩）
- 现象：研究站无对应矩阵时 `start_research` 返回 `accepted`，tick 时被 `execStartResearch` 以 `CodeValidationFailed` 拒绝，只进审计日志，玩家看不到失败。
- 建议：网关预校验时检查运行中研究站与矩阵库存并直接 `rejected`；或失败时发 `EvtCommandFailed` 事件让客户端展示。

## 普通制造台喷涂属性与额外耗电未贯通

- 状态：待修复（2026-09-16 代码核查）
- 现象：喷涂物料经建筑 IO 进入制造台时 `StoragePortInput` 只收物品 ID 和数量，`collectRecipeInputs` 构造无 Spray 的物品堆，增产效果丢失；配方 `EnergyCost` 与 `EnergyConsumeTotal` 未进入电网负载。
- 相关：`gamecore/building_io_settlement.go`、`model/storage.go`、`gamecore/production_settlement.go`、`model/production_cycle.go`。
- 修复方向：统一仓储/运输/取料/存档的真实物品堆表示，用喷涂→仓储→制造链验证守恒与收益。
