# T103 最终实现方案：默认新局首条采矿闭环收口

> 基于 `docs/process/design_claude.md` 与 `docs/process/design_codex.md` 的综合定稿。
>
> 本文的目标不是并列复述两份方案，而是对冲突点做出最终裁决，形成一份可直接执行的实现方案。

## 1. 最终结论

T103 的本质问题已经明确：

- 当前默认新局 starter economy 只有 `minerals = 200`
- 按当前真实公开起步路线，保留首台 `matrix_lab` 并补出首台可运行矿机，至少需要：
  - `wind_turbine = 30`
  - `matrix_lab = 120`
  - `tesla_tower = 20`
  - `mining_machine = 50`
  - 合计 `220 minerals`

因此问题不在研究系统、科技树或供电规则，而在于**默认新局启动包没有覆盖当前真实 starter 闭环的最低成本**。

最终方案确定为：

1. **只调整默认新局 `config-dev.yaml` 的 `bootstrap.minerals`。**
2. **推荐值采用 `240`，而不是 `250`。**
3. **不修改任何全局建筑成本、研究规则、供电语义或科技解锁。**
4. **新增独立 T103 回归测试，专门保护“保留首台研究站 + 首台矿机 running”的闭环。**
5. **同步更新默认新局相关玩家文档与服务端 API 文档。**

## 2. 综合裁决

### 2.1 两份方案的一致结论

`design_claude` 与 `design_codex` 在核心方向上并不冲突，已经达成以下共识：

- 问题是 starter economy 缺口，不是功能缺失
- 最优修法是改默认新局配置，而不是改全局成本
- 不应引入“默认新局专属奖励”之类特判逻辑
- 必须保持基地不发电、研究站要通电、矩阵要真实装填和消耗、矿机要真实接电
- 玩家文档必须和实际路线保持一致

因此最终方案继续沿用这个共同主轴，不再考虑全局降价或特判补偿。

### 2.2 冲突点一：`240` 还是 `250`

最终裁决：**采用 `240`。**

理由如下：

1. `220` 只是理论最低值，零容错，不可取。
2. `230` 只多出 `10`，不足以覆盖一座额外 `tesla_tower`，缓冲仍然过薄。
3. `240` 恰好提供 `20` 缓冲，等于一座 `tesla_tower` 的成本，已经能覆盖 starter 阶段最现实的额外电网延伸需求。
4. `250` 虽然也能解决问题，但相比 `240` 多出的 `10` 没有带来新的闭环能力，只会进一步放松开局约束。

所以，`240` 是当前已知条件下“刚好够用且不过肥”的更优平衡点。

### 2.3 冲突点二：是否必须新增独立 T103 回归

最终裁决：**必须新增独立 T103 回归测试。**

理由如下：

- T092 当前保护的是“默认新局科研入口是否闭合”
- T103 要保护的是“第一门科研完成后，starter economy 是否足以进入首条稳定采矿收益”

两者关注点不同。如果继续把 T103 语义塞进 T092，会让测试职责过重，失败定位也会变差。因此必须单独新增 T103 回归，而不是继续扩写 T092。

### 2.4 冲突点三：文档同步范围

最终裁决：**以 `design_codex` 的同步范围为主，结合 `design_claude` 的数值更新要求。**

必须同步：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/服务端API.md`

其中：

- 面向当前真实口径的描述一律改成 `minerals = 240`
- 历史问题记录可以保留“当时是 `200` 导致断链”的时间线，但必须补充“现已修复”的说明

## 3. 最终设计

### 3.1 配置层修改

修改：

- `server/config-dev.yaml`

具体变更：

- 两名玩家的 `bootstrap.minerals: 200 -> 240`
- 保持 `energy = 100`
- 保持 `electromagnetic_matrix x50`

这是本次唯一的行为层改动。其余系统语义全部保持不变。

### 3.2 明确保持不变的规则

以下规则在本次实现中不得被动到：

1. `battlefield_analysis_base` 继续不发电。
2. 第一座 `matrix_lab` 仍然必须通电才能以研究站身份 `running`。
3. `start_research electromagnetism` 仍然要求研究站本地库存里有真实 `electromagnetic_matrix`。
4. `electromagnetism` 仍只解锁 `tesla_tower + mining_machine`。
5. `mining_machine` 仍必须建在矿点上，且处于有效供电覆盖中才会进入 `running`。
6. 不新增任何“默认新局专属折扣、补贴、奖励资源、预放建筑”之类特判逻辑。

### 3.3 修复后默认新局的公开路线

默认新局修复后，对外统一叙述为：

1. `build 3 2 wind_turbine`
2. `build 2 3 matrix_lab`
3. `transfer <matrix_lab_id> electromagnetic_matrix 10`
4. `start_research electromagnetism`
5. `build 4 2 tesla_tower`
6. `build 5 1 mining_machine`

预期结果：

- 首台 `matrix_lab` 仍然保留
- 首台 `mining_machine` 可进入 `running`
- 完成这条链后还剩 `20 minerals`

这 `20 minerals` 既不会让 starter economy 过度宽松，也足以覆盖一段额外的基础电网延伸。

## 4. 实现范围

### 4.1 服务端配置

- `server/config-dev.yaml`
  - 更新默认新局两名玩家的 `bootstrap.minerals`

### 4.2 服务端测试

- `server/internal/startup/t092_config_dev_test.go`
  - 把默认启动包资源断言中的 `minerals = 200` 更新为 `240`
- 新增：
  - `server/internal/gamecore/t103_default_newgame_mining_loop_test.go`

新增 T103 回归最少要验证：

1. fresh new game 中先完成 `wind_turbine -> matrix_lab -> transfer matrix -> start_research electromagnetism`
2. 研究完成后继续建造 `tesla_tower -> mining_machine`
3. 推进若干 tick 后断言：
   - 首台 `matrix_lab` 仍然存在
   - `matrix_lab` 仍保持研究语义
   - `mining_machine` 已存在
   - `mining_machine.Runtime.State == running`
   - `mining_machine.Runtime.StateReason` 不是 `power_out_of_range`
   - 玩家矿物收入或相关统计已经开始增长

测试实现原则：

- 不要硬编码试玩时的临时建筑 ID
- 尽量复用 T092 的测试辅助模式
- 如需找矿点或电塔位置，写成独立 helper，避免坐标脆断

### 4.3 文档同步

- `docs/player/玩法指南.md`
  - 默认新局资源改成 `minerals = 240`
  - 起步路线改成“保留首台研究站后继续补电塔和矿机”的正向表述
- `docs/player/上手与验证.md`
  - 更新默认新局最小可玩路径与验证步骤
- `docs/player/已知问题与回归.md`
  - 保留 2026-04-05 的问题记录
  - 在同一条目下补充“已由 T103 修复”
  - 明确修法是 starter minerals 上调，而不是拆研究站 workaround
- `docs/dev/服务端API.md`
  - 更新普通新局默认入口中的启动包描述
  - 保持 API 行为语义不变，只同步默认新局数值与路线口径

## 5. 验证方案

### 5.1 自动化验证

至少执行：

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/startup ./internal/gamecore
```

重点确认：

- `t092_config_dev_test.go` 的启动包断言已收敛到 `240`
- 新增 T103 回归稳定通过
- 既有 T092 不因 starter 资源调整而出现语义回退

### 5.2 真实回放验证

用默认新局实际重放以下步骤：

1. 新开一局默认新局
2. 建造 `wind_turbine`
3. 建造 `matrix_lab`
4. 向研究站转入 `10` 个 `electromagnetic_matrix`
5. 完成 `electromagnetism`
6. 建造 `tesla_tower`
7. 建造 `mining_machine`

验收观察点：

- 无需拆除任何 starter 建筑
- 首台研究站仍存在
- 首台矿机状态为 `running`
- 不再出现“只能拆研究站回收资源才能收口”的情况

## 6. 验收标准

1. brand-new 默认新局中，玩家在完成 `electromagnetism` 后，无需拆首台研究站即可建出首台可运行矿机。
2. starter 路线保持为“先供电、再研究、再拉电网去矿区、再获得首条稳定采矿收益”的正向入口。
3. 服务端实现层只改默认新局配置，不改全局建筑成本、研究规则、供电语义和科技树。
4. 存在独立 T103 自动化回归，专门保护该闭环。
5. 默认新局相关玩家文档与 API 文档中的资源数值和玩法描述与实现一致。

## 7. 最终建议

按以下顺序落地：

1. 修改 `server/config-dev.yaml`，把 `bootstrap.minerals` 调整为 `240`
2. 更新 `server/internal/startup/t092_config_dev_test.go`
3. 新增 `server/internal/gamecore/t103_default_newgame_mining_loop_test.go`
4. 同步更新 `docs/player/*` 与 `docs/dev/服务端API.md`
5. 跑自动化回归并做一次默认新局真实回放

这样能以最小改动、最低耦合，把 T103 从“需要拆研究站绕行”收口成一个真正成立的 starter 正向闭环。
