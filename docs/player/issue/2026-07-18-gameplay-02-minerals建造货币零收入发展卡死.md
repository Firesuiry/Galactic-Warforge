# minerals 建造货币零收入，开局 240 矿耗尽后发展永久卡死

- 状态：已修复
- 首次记录：2026-07-18
- 修复日期：2026-07-18
- 修复提交：f54bd9e
- 来源：2026-07-18 Web 试玩（新开局 config-dev + map.yaml）
- 类别：玩法 / 经济系统 / 发展主线

## 修复内容

按"推荐改进 2"落地：采集建筑产出物品入本地存储的同时，按实际入库数量折算 minerals 直充玩家矿物池。

- `server/internal/model/building_runtime.go`：`CollectModule` 新增 `MineralsKickback float64`（每入库 1 单位物品折算的 minerals）；`mining_machine = 1.0`、`advanced_mining_machine = 0.5`，`water_pump` / `oil_extractor` 保持 0（流体采集不产矿）。
- `server/internal/gamecore/rules.go`：`settleResources` 采集入库成功后经 `collectMineralsKickback()` 折算 minerals，复用既有矿物入账与 `ProductionSettlementSnapshot` 通道（`production_stats.by_item["minerals"]` 口径自动一致）。
- 回归测试 `TestOpeningBuildChainMiningRestoresMineralsIncome`：模拟 config-dev 开局 240 矿 → 真实 catalog 造价依次建 wind_turbine/matrix_lab/tesla_tower/mining_machine（剩 20）→ 矿机跑 20 tick，断言 minerals 每 tick 严格正增长、硅矿持续被采出运走、最终攒够 `depot_mk1` 造价（60）；另加 `TestFluidCollectorsDoNotYieldMinerals` 负向用例。
- `go test ./...`（server/ 下）全部通过；`docs/dev/服务端API.md` 已补充 minerals 持续收入规则。

## 问题描述

新开局玩家只有启动包 `minerals = 240`。按推荐路径建完 `wind_turbine(30) + matrix_lab(120) + tesla_tower(20) + mining_machine(50)` 后只剩 20 矿。而采矿机采出的硅矿进入建筑本地存储（`rules.go` 采集逻辑：有 Storage 的采集建筑产出走物品，不回 minerals），玩家 minerals 再无任何增长途径。

## 复现步骤

1. 全新 data_dir 启动（config-dev）
2. 依次建风机、研究站、完成 electromagnetism、电塔、矿机
3. 观察 `summary.players.p1.resources.minerals`：240 → 210 → 90 → 70 → 20，此后保持不变（矿机 `running`，硅矿持续进建筑存储）

## 实际现象

- 代码层面 `player.Resources.Minerals` 的增加路径只有：建造退款/拆除退款/无 Storage 采集建筑的旧路径（`rules.go:1027` 等）；没有任何周期性收入、没有物品→minerals 的兑换
- `depot_mk1` 要 60 矿、`arc_smelter` 等后续建筑全部永久买不起
- 等于默认新局的经济发展在第 5 个建筑后彻底锁死，只剩拆除退款来回倒腾

## 影响

- "能不能顺利发展"的答案目前是不能：这是比 web-07 更底层的阻断，即使 CLI 玩家也会撞上
- 文档阶段 C 以后的所有内容（物流、冶炼、制造、防御）在默认新局实际不可达

## 临时绕过

- 无（只能靠测试场景 config-midgame/config-war 预置资源跳过）

## 推荐改进

1. 明确经济模型：要么 minerals 是"通用建设资源"，就给它一条持续收入路径（例如矿机/基地周期性产出，或冶炼成品按比例折算）；要么把建筑成本从 minerals 改成真实物品链（铁矿→铁锭→建筑），彻底去掉这层抽象货币
2. 短期内成本最低的做法：让采集建筑产出物品的同时按产出量折算一定 minerals 回玩家池（或在基地加一条"矿物上缴"规则），保证开局资金链不断
3. 把"开局 240 矿能走到哪一步"写成一条服务端 e2e 回归：建到矿机后 N tick 内 minerals 必须恢复正增长

## 证据

- API 观测：tick 11493 → 12425，矿机 `running`、硅矿资源点 remaining 184 → 124，玩家 minerals 恒定 20
- 代码：`server/internal/gamecore/rules.go` `collectorOutputItemID()` 有 Storage 时产出全部入物品存储；全库 grep 无 minerals 周期收入
