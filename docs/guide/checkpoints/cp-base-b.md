# cp-base-b（已退役：并入 cp-base，不参与重建）

第 14 轮（1014 L4）的纯 UI 文字构建记录，parent=`cp-base-a`，原名
`cp-base-b.json`。它做的事——从 cp-base-a 建 2 台电弧熔炉 + 1 台制造台、
用「取出 / 装入建筑」把矿喂进熔炉、再把铁块喂给制造台出齿轮——现在由可执行的
`cp-base` 完整覆盖（`docs/guide/checkpoints/cp-base.json`：两台熔炉 + 制造台
running，末尾三条 `item_growth` 断言铁/铜锭真的在流进出货仓）。

## 它当初额外验证的两件事（现在由 Go 测试锁定）

1. **背包 200 上限对手搓入包硬生效**：手搓批次装不下时作业停在 `inventory_full`，
   不扣能量，腾空后自动继续。回归测试：
   `server/internal/gamecore/skirmish_from_zero_test.go`（`inventory_full` 断言）
   与 `model.PlayerState.AddItems` 的容量裁剪用例。
2. **「装入建筑」把生产建筑塞死**：主库存被原料塞满后熔炉 running 却不产出
   （`storeProductionOutputs` 整批落货失败）。第 16 轮起用产出预留
   （`StorageState.Reserve`）修复，回归测试：
   `server/internal/gamecore/production_1015_landing_test.go`
   与 `alert_resolve_test.go` 的 `output_blocked` 用例。

第 16 轮（实物经济 + 分拣器）之后存档格式 v3→v4，旧文字记录也读不进来；
本层没有需要单独保留的局面，故退役。原始步骤见 git 历史
（`git log -- docs/guide/checkpoints/cp-base-b.json`）。
