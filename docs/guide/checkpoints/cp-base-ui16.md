# cp-base-ui16（已退役：不完整的纯 UI 导出，不参与重建）

第 16 轮纯 UI 试玩 A 段（worktree r16-integration，`playtest-up.sh 41 --tick-rate 4`，
新局 skirmish 从 tick 0）导出的构建记录，原名 `cp-base-ui16.json`，parent=`cp-root`。

## 为什么不能作为可执行层

导出时存档点（tick 47470）的审计日志已被快照保留窗口裁掉：服务端每次快照执行
`TrimAuditBeforeTick(oldest)`，当时 `server.snapshot_retention_ticks=6000`，所以
审计日志只剩 tick ≈41470 之后的条目。导出的 68 步只覆盖 tick 41508–47037
（手搓铁块/铜块/电路板/磁铁/磁线圈 → 制造台 Mk.I → 装料 → 启动研究），
**不含**风机 / 电塔 / 矿机 / 传送带 / 分拣器 / 电弧熔炉 / 矩阵研究站的建造段
（都在 tick < 41500）。

直接 `-from cp-root` 重建时，它从 cp-root（tick 27）一路快进到 41508，再回放这些
只针对“已经建好的基地”的操作：所有 `transfer_item` 报「未找到建筑（可能已被拆除）」，
`start_research` 报「需要至少一台运行中的研究站」，契约里 6 条建筑/科技断言全部
实际=0。它无法修复成绿色——缺失的是整整 4 万 tick 的开局建造段，而不是参数。

## 保留的价值

这局实际建成的布局与逐步截图见 `tmp/playtest-1016/测试报告A.md`：

- 矿机(55,136) → 带(58,137,东) → 分拣器(59,137, rot 90) → 电弧熔炉(60,137, smelt_iron)
  → 分拣器(63,138, rot 90) → 带(64..66,138,东)
- 矩阵研究站(58,141)、制造台 Mk.I(61,141, 电磁矩阵)
- 风机(60,146)/(63,146)、电塔(57,142)、HQ(54,144)

它记录了「纯 UI 从零开局」的原始布局，作为 UI 操作参考仍有意义；开局建造段现在由
`cp-root → cp-power → cp-mining → cp-base-a → cp-base` 这组 API 构建记录覆盖。

## 如何再拿到完整导出

把 `snapshot_retention_ticks` 提到 ≥ 整局长度（或用 `scripts/playtest-up.sh` 生成的
临时配置，它固定写 `server.audit_retention_ticks: 0`）后再跑一次纯 UI 试玩，然后
`checkpointbuild -export -layer <名> -write`。
