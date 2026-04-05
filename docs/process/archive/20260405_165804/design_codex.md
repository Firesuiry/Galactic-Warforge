# T103 设计方案：默认新局首条采矿闭环收口（Codex）

> 对应任务：`docs/process/task/T103_默认新局首条采矿闭环仍需拆研究站绕行.md`
>
> 本文只覆盖 T103，不回退 T092/T102 已经收口的研究与文档语义。

## 1. 设计结论

T103 的本质不是“采矿系统没实现”，而是**默认新局 starter economy 没有覆盖当前公开起步路线的最低真实成本**。

当前默认新局已经具备：

- 真实的研究站通电与矩阵消耗规则
- `electromagnetism -> tesla_tower + mining_machine` 的真实解锁
- 真实的矿机上矿点建造与供电覆盖判定

真正断裂的是这条公开路线：

1. 先建 `wind_turbine`
2. 再建首台空 `matrix_lab`
3. 完成 `electromagnetism`
4. 再补 `tesla_tower`
5. 再补首台可运行 `mining_machine`

在当前 authoritative 数值下，这条链至少需要 `220 minerals`，而 `config-dev.yaml` 只给了 `200`。因此玩家只能靠拆首台研究站回收资源绕行。

本次推荐方案是：

1. **只调整默认新局 `config-dev.yaml` 的 starter minerals，收口 starter economy。**
2. **不改研究规则、不改科技树、不改全局建筑成本、不改供电覆盖语义。**
3. **新增独立 T103 回归测试，验证“保留首台研究站 + 首台矿机进入 running”这个闭环。**
4. **同步更新默认新局玩家/API 文档口径。**

推荐把默认新局每名玩家的 `bootstrap.minerals` 从 `200` 提升到 `240`。

## 2. 当前代码事实

### 2.1 默认新局启动包

`server/config-dev.yaml` 当前为每名玩家提供：

- `minerals = 200`
- `energy = 100`
- `electromagnetic_matrix x50`

这套启动包来自 `players[].bootstrap`，由 `server/internal/gamecore/core.go:applyPlayerBootstrap()` 直接灌入玩家状态，没有额外的“默认新局特判层”。

### 2.2 当前 starter 闭环的真实固定成本

按当前建筑定义与成本，保留首台研究站并补出首台可运行矿机，最少需要：

| 建筑 | minerals | energy | 说明 |
| --- | ---: | ---: | --- |
| `wind_turbine` | 30 | 0 | 默认新局第一座供电建筑 |
| `matrix_lab` | 120 | 60 | 第一座研究站 |
| `tesla_tower` | 20 | 10 | 当前默认图最近可运行矿点需要补一段供电覆盖 |
| `mining_machine` | 50 | 20 | 首台矿机 |
| 合计 | 220 | 90 | `minerals` 超预算 20，`energy` 仍有余量 |

因此当前问题是一个确定的 starter economy 缺口，而不是偶发施工失败。

### 2.3 为什么 `tesla_tower` 不是“可选建筑”

当前实现里：

- `battlefield_analysis_base` 自身 `generation_mw = 0`
- 普通建筑默认只有 `DefaultPowerLineRange = 1`
- `tesla_tower` 额外提供 `DefaultTeslaTowerRange = 4`

也就是说，默认新局第一台矿机在当前公开路线里不是“只要造出来就能跑”，而是需要真实接入电网覆盖。T103 里路径 B 已经证明：直接跳过电塔虽然能落矿机，但会停在 `no_power / power_out_of_range`。

所以这次不能通过“改文档说先上矿机就行”来规避问题，必须正面收口 starter economy。

### 2.4 T092 已覆盖什么，没覆盖什么

当前已有回归：

- `server/internal/model/t092_default_newgame_test.go`
  - 保护默认新局的科技入口与 unlock 关系
- `server/internal/startup/t092_config_dev_test.go`
  - 保护默认新局 bootstrap 资源
- `server/internal/gamecore/t092_default_newgame_test.go`
  - 保护“风机 -> 研究站 -> 装矩阵 -> 完成早期科研闭环”

但还没有任何测试覆盖：

- `electromagnetism` 完成后，玩家是否还能同时保留首台研究站和首台可运行矿机
- 默认新局公开文档中的 starter 扩张路线是否真的闭合

T103 需要新增自己的回归，不能继续把语义塞进 T092。

## 3. 目标与非目标

### 3.1 目标

1. brand-new 默认新局中，玩家完成 `electromagnetism` 后，无需拆首台研究站即可建出首台可运行矿机。
2. 修复后的路线继续符合当前公开玩家文档的叙述方向：
   - 先供电
   - 再研究
   - 再拉电网去矿区
   - 再获得首条稳定采矿收益
3. 改动尽量落在默认新局配置层，避免污染全局平衡。
4. 有独立自动化回归保护该闭环。

### 3.2 非目标

本次不做以下事情：

- 不回退“研究必须有 running 研究站 + 真实矩阵消耗”
- 不让 `battlefield_analysis_base` 重新自带发电
- 不修改 `electromagnetism` 的 unlock 结果
- 不改 `matrix_lab` / `mining_machine` / `tesla_tower` 的全局成本
- 不引入“研究完成奖励 minerals”之类 starter 特判逻辑
- 不把默认新局变成资源过剩的演示场景

## 4. 方案比较

### 4.1 方案 A：只提高默认新局 bootstrap minerals（推荐）

做法：

- 仅修改 `server/config-dev.yaml`
- 将两名玩家的 `bootstrap.minerals` 从 `200` 调整为 `240`

优点：

- 改动点最少，直接落在默认新局配置层
- 不影响中后期场景
- 不改变建筑全局成本、供电拓扑、科技树语义
- 与 T102 已统一的“基地不发电、先风机再研究站”口径完全兼容

缺点：

- 默认新局 starter 数值会发生变化，相关文档和 bootstrap 断言要同步
- 如果未来 starter 路线再增加额外硬成本，仍需重新评估配置

结论：

- 这是最直接、最解耦、最符合当前任务边界的方案

### 4.2 方案 B：降低 `matrix_lab` / `mining_machine` / `tesla_tower` 的全局建造成本

做法：

- 修改 `server/internal/model/building_defs.go` 或相关 building 定义，让 starter 路线上若干建筑更便宜

优点：

- 从表面上也能补足 20 minerals 缺口

缺点：

- 影响不是“默认新局专属”，而是全局建筑平衡
- `matrix_lab` 和 `mining_machine` 都是中后期仍大量铺设的建筑，不适合为了 starter 缺口做全局降价
- 会把一个启动配置问题，错误地下沉为核心数值系统问题

结论：

- 不推荐

### 4.3 方案 C：新增 starter 特权逻辑，比如预放建筑、研究奖励资源或特殊折扣

做法：

- 在 runtime bootstrap、研究完成或建造判定里加入“默认新局专属例外”

优点：

- 可以精确把资源补到某个节点

缺点：

- 耦合高
- 规则不透明
- 后续更难推断默认新局到底为什么能成立
- 违背当前项目“尽量简单直接、避免额外适配层”的规则

结论：

- 明确不选

## 5. 推荐方案细化

### 5.1 starter 资源目标值：`minerals = 240`

不建议只加到 `220`：

- `220` 只是把当前最短链路压成“刚好够”，没有任何容错
- 玩家一旦需要多补一格电网或临时多放一座 `tesla_tower`，马上再次断链

不建议直接加到过高数值（例如 `300+`）：

- 会把默认新局从“资源紧张但可闭环”推向“开局过肥”
- 与当前文档强调的 starter 压力不匹配

推荐值 `240` 的含义是：

- 覆盖当前最短公开路线的 `220 minerals`
- 额外留下 `20 minerals` 缓冲
- 这 `20 minerals` 刚好等于一座 `tesla_tower` 的成本，可以吸收“矿点稍远、需要再补一段电网”的 starter 波动
- 同时不会大到让玩家在首条采矿闭环前就能额外展开完整的第二条建筑线

### 5.2 保持哪些语义不变

本方案必须明确保持以下行为不变：

1. `battlefield_analysis_base` 继续不发电。
2. 第一座 `matrix_lab` 仍然必须先通电才能作为研究站运行。
3. `start_research electromagnetism` 仍然要求先把 `electromagnetic_matrix` 真正装进研究站。
4. `electromagnetism` 仍只解锁 `tesla_tower + mining_machine`。
5. `mining_machine` 仍必须建在资源点上，且必须真实接入电网覆盖才会 `running`。

换句话说，修的是 starter economy，不是回退规则强度。

### 5.3 受影响文件

实现阶段应至少覆盖以下文件。

#### 5.3.1 服务端配置

- `server/config-dev.yaml`
  - 两名玩家的 `bootstrap.minerals: 200 -> 240`

#### 5.3.2 服务端测试

- `server/internal/startup/t092_config_dev_test.go`
  - 更新默认新局 bootstrap 资源断言
- 新增独立 T103 回归测试文件，推荐：
  - `server/internal/gamecore/t103_default_newgame_mining_loop_test.go`

#### 5.3.3 玩家文档

- `docs/player/玩法指南.md`
  - 默认新局启动资源改为 `minerals = 240`
  - “第一条采矿收益入口”叙述要改成无需拆研究站的正向路线
- `docs/player/上手与验证.md`
  - 更新默认新局最小可玩路径和示例说明
- `docs/player/已知问题与回归.md`
  - 把 2026-04-05 这条问题从“当前问题”改为“历史问题/已修复回归项”

#### 5.3.4 服务端 API 文档

- `docs/dev/服务端API.md`
  - 默认新局启动包数值改为 `minerals = 240`
  - 普通新局默认入口描述要与新 starter 闭环一致

### 5.4 测试设计

#### 5.4.1 为什么要新建独立 T103

T092 的关注点是“默认新局科研入口是否闭合”。T103 的关注点已经前移到“第一门科研完成后，starter economy 是否足以进入首条稳定采矿收益”。

如果继续把这层语义硬塞进 T092，会导致：

- 单个测试职责过大
- 将来定位失败原因更困难
- starter 研究闭环和 starter 采矿闭环耦在同一个断言链里

因此推荐单独新建 T103 回归。

#### 5.4.2 T103 回归应验证什么

推荐的 T103 回归最少要覆盖：

1. fresh new game 中，玩家先完成：
   - 第一座 `wind_turbine`
   - 第一座 `matrix_lab`
   - `transfer electromagnetic_matrix`
   - `start_research electromagnetism`
2. 研究完成后，再建：
   - `tesla_tower`
   - `mining_machine`
3. 连续推进若干 tick 后，断言：
   - 第一台 `matrix_lab` 仍然存在
   - `matrix_lab` 仍处于研究语义，而不是被拆除或改配方
   - 第一台 `mining_machine` 已存在
   - `mining_machine.Runtime.State == running`
   - `mining_machine.Runtime.StateReason` 不是 `power_out_of_range`
   - 玩家 `minerals` 或矿机相关库存/统计已开始增长

#### 5.4.3 T103 回归的实现原则

测试不要硬编码某次试玩里的临时建筑 ID。

推荐复用现有测试辅助模式：

- 像 T092 一样，动态找基地旁可建格放 `wind_turbine` / `matrix_lab`
- 为 T103 新增一个“查找最近可建资源点 + 可接电塔落位”的测试辅助函数
- 如需移动执行体，也应通过公开命令或现有 helper 完成，而不是直接篡改单位坐标

这样能避免未来小幅地图调整后，测试只因为坐标脆断。

## 6. 文档口径设计

### 6.1 玩家文档应如何描述新局

修复后，默认新局对外统一表达为：

1. 开局资源：
   - `minerals = 240`
   - `energy = 100`
   - `electromagnetic_matrix x50`
2. 第一段路线：
   - 先补 `wind_turbine`
   - 再摆空 `matrix_lab`
   - 装 `10` 个 `electromagnetic_matrix`
   - 研究 `electromagnetism`
   - 再补 `tesla_tower`
   - 再上首台 `mining_machine`
3. 结果：
   - 无需拆首台研究站
   - 首台矿机可进入 `running`
   - starter 资源开始由负增长转为正增长

### 6.2 已知问题页应如何处理

`docs/player/已知问题与回归.md` 不应删除历史，而应改成：

- 保留“2026-04-05 曾发现 T103 问题”的时间线
- 在同一条目下补充“已由 T103 修复”的结论
- 说明修复方式是默认新局 starter minerals 上调，不是拆研究站 workaround

这样后续查历史时，仍能看出问题来龙去脉。

## 7. 风险与边界

### 7.1 风险 1：未来 starter 路线再次新增硬成本

如果未来默认新局又要求首条矿线前必须额外造别的 starter 建筑，`240` 可能再次不够。

应对：

- 把 T103 回归作为 starter economy 的守门测试
- 后续只要 starter 公开路线增加硬成本，就同步调整配置与测试

### 7.2 风险 2：文档改了，但自动化只验证科研，不验证采矿

这是当前问题能溜到 2026-04-05 的核心原因之一。

应对：

- T103 必须有独立 gamecore 回归，不接受只改文档或只改 bootstrap 数值

### 7.3 风险 3：把问题修成“默认新局资源泛滥”

如果一步把 minerals 拉得太高，会让 starter 经济约束失真。

应对：

- 使用 `240` 而不是更夸张的值
- 保持其他成本、科技和供电规则不变

## 8. 最终建议

本任务按以下准则落地：

1. **只修默认新局配置，不碰全局建筑成本。**
2. **推荐值：`server/config-dev.yaml` 中每名玩家 `bootstrap.minerals = 240`。**
3. **新增独立 `T103` 回归，验证“保留首台研究站 + 首台矿机 running”。**
4. **同步更新 `docs/player/*` 与 `docs/dev/服务端API.md`。**

这样能以最小改动把 T103 收口成一个真正成立的 starter 正向闭环。
