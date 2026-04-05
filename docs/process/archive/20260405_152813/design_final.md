# T102 最终实现方案：统一默认新局玩家文档与科技树口径

> 对应任务：`docs/process/task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md`
>
> 本方案综合 `docs/process/design_claude.md` 与 `docs/process/design_codex.md`，输出一份可直接执行的最终实现方案。

## 1. 目标与最终结论

T102 的本质不是补玩法功能，而是把已经实现并可真实复现的默认新局入口，重新同步回文档体系。

本次采用的最终方案是：

1. 以服务端实现、配置与回归测试为唯一权威来源。
2. 修正 4 份主文档：
   - `docs/player/玩法指南.md`
   - `docs/player/上手与验证.md`
   - `docs/player/已知问题与回归.md`
   - `docs/dev/服务端API.md`
3. 同步回收仍对外可见、且会继续误导读者的已完成任务摘要。
   - 当前最少应覆盖 `docs/process/finished_task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
   - 当前最少应覆盖 `docs/process/finished_task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`
4. 不修改服务端、CLI 或 Web 行为，不在本任务中引入新的功能开发。
5. 不清洗 `docs/process/archive/*` 与旧 snapshot；只把它们明确视为非权威来源。

一句话结论：

- 默认新局开局只预完成 `dyson_sphere_program`
- 这门科技直接提供 `matrix_lab + wind_turbine`
- 基地本身不发电
- 第一段真实入口必须统一为“先风机、再研究站、再装矩阵、再开 `electromagnetism`”
- `electromagnetism` 当前只负责提供 `tesla_tower + mining_machine`

## 2. 权威事实与取真规则

### 2.1 权威来源优先级

本任务所有文档修正，统一按以下优先级取真相：

1. `server/internal/model/tech.go`
   - 科技树、前置、原始 unlock 定义的权威来源
2. `server/internal/model/tech.go` 中的归一化与 alias 逻辑
   - 对外展示 unlock 名称的权威来源
3. `config/defs/buildings/combat/battlefield_analysis_base.yaml`
   - 基地供电能力的权威来源
4. `server/config-dev.yaml`
   - 默认新局启动包与玩家 bootstrap 的权威来源
5. `server/internal/model/t092_default_newgame_test.go`
6. `server/internal/gamecore/t092_default_newgame_test.go`
   - 默认新局科技解锁与首段科研闭环的回归约束
7. 2026-04-05 真实 CLI 深度试玩记录
   - 作为运行证据，但优先级低于代码与测试

### 2.2 非权威来源

以下内容允许保留，但不能反向定义现状：

- `server/data/snapshots/*`
- `docs/process/archive/*`
- 旧设计稿、旧任务文本
- `docs/player/已知问题与回归.md` 中未经修正的历史条目

### 2.3 当前实现真相

根据代码、配置、测试与最新试玩，默认新局的真实口径应统一为：

- `dyson_sphere_program`
  - 开局已预完成
  - 直接解锁 `matrix_lab`
  - 直接解锁 `wind_turbine`
- `electromagnetism`
  - 前置：`dyson_sphere_program`
  - 成本：`electromagnetic_matrix x10`
  - 原始 unlock：`power_pylon`、`mining_machine`
  - 对外归一化后：`tesla_tower`、`mining_machine`
- `battlefield_analysis_base`
  - 不提供默认起步发电能力
  - 初始状态会表现为 `no_power / power_no_provider`
- 默认新局第一条真实可玩链路：
  - 先建 `wind_turbine`
  - 再建空 `matrix_lab`
  - 未装矩阵时开研应被拒绝
  - 装入 `10` 个 `electromagnetic_matrix` 后才能开 `electromagnetism`

## 3. 方案比较与最终选型

### 3.1 方案 A：只修 4 份主文档

优点：

- 改动最小
- 能快速修掉最显眼的玩家误导

缺点：

- `finished_task` 下仍可直接打开的摘要会继续传播旧口径
- 全文检索时仍会反复搜到“`electromagnetism` 解锁 `wind_turbine`”等过时结论

### 3.2 方案 B：主文档修正 + 对外可见历史摘要收口

优点：

- 能真正统一当前对外口径
- 搜索结果更干净
- 与 T102 的验收目标完全对齐

缺点：

- 需要谨慎保留历史时间线，避免过度改写

### 3.3 方案 C：在方案 B 基础上新增自动化文档一致性测试

优点：

- 长期最稳
- 能降低未来再次漂移的风险

缺点：

- 已超出 T102 当前范围
- 需要额外设计文档片段格式与校验边界

### 3.4 最终选型

采用方案 B：

- 修正 4 份主文档
- 修正仍对外可见的已完成任务摘要
- 不修改服务端实现
- 不扩展到 archive 清洗与自动化生成

## 4. 文档统一原则

所有目标文档统一遵守以下规则：

1. 面向玩家、CLI 使用者和 API 调用者时，统一使用对外名称 `tesla_tower`，不直接把内部 alias `power_pylon` 当成最终展示名。
2. 默认新局入口顺序必须统一为：
   - `wind_turbine`
   - `matrix_lab`
   - `electromagnetic_matrix`
   - `electromagnetism`
3. 不再出现“基地自带发电 5”之类与当前实现冲突的表述。
4. 不再出现“`electromagnetism` 解锁 `wind_turbine`”之类旧科技树口径。
5. 玩家指南优先使用相对位置描述，例如“基地正交相邻格”。
6. 验证文档可以保留当前默认地图的示例坐标，但必须写明这是“当前默认图可复现实例”，不是永远固定的世界规则。
7. 历史文档允许保留时间线，但所有仍可能被单独引用的句子，都不能继续裸露成当前事实。

## 5. 目标文件与具体改动设计

### 5.1 `docs/player/玩法指南.md`

目标：

- 纠正玩家对默认新局“第一步该干什么”的理解
- 把科技树口径改回当前真实实现

具体改动：

1. 在“开局你拥有什么”部分：
   - 将 `dyson_sphere_program` 的说明改成“直接提供 `matrix_lab + wind_turbine`”
   - 删除“基地自带发电 `5`，足够覆盖 `matrix_lab` 耗电 `4`”
   - 将第一段科研入口改成“先建风机，再建研究站，再装矩阵”
2. 在“阶段 B：稳定供电 + 采矿”部分：
   - 明确 `wind_turbine` 已由开局科技直接提供
   - 将 `electromagnetism` 的解锁列表修正为 `tesla_tower + mining_machine`
   - 将推荐顺序改为：
     1. 先在基地正交相邻格建 `wind_turbine`
     2. 再在基地另一侧建空 `matrix_lab`
     3. 装入 `10` 个 `electromagnetic_matrix`
     4. 研究 `electromagnetism`
     5. 研究完成后补 `tesla_tower` 与 `mining_machine`
3. 在“一条最实用的新手流程”部分：
   - 把建 `wind_turbine` 前移到建 `matrix_lab` 之前
   - 删除“研究完再造第一台风机”的旧顺序

要求：

- 这份文档以玩法顺序为主，不堆过多实现细节
- 但必须明确点破：基地本身不发电

### 5.2 `docs/player/上手与验证.md`

目标：

- 给出 brand-new 默认新局可以真实重放的最小验证链

具体改动：

1. 在“最小可玩路径”中：
   - 在建研究站前增加建风机步骤
   - 保留“先故意尝试未装矩阵开研，确认被正确拒绝”的验证点
   - 将研究成功后的结果修正为解锁 `tesla_tower + mining_machine`
2. 在命令示例中：
   - 可以保留当前默认图的示例坐标
   - 但必须注明这只是当前官方 seed 的可复现实例
3. 明确研究站 ID 必须写成运行时占位，例如 `<matrix_lab_id>`，不能硬编码某次试玩的临时实体 ID

### 5.3 `docs/player/已知问题与回归.md`

目标：

- 保留历史时间线
- 停止让旧结论继续冒充现状

具体改动：

1. 保留 2026-04-05 最新结论作为当前口径锚点。
2. 对仍会误导读者的旧条目做局部修正，至少覆盖：
   - “`electromagnetism` 解锁 `wind_turbine`”
   - “默认新局第一步直接摆 `matrix_lab` 即可开第一门科研”
   - “基地自带发电 `5`”
3. 优先使用以下修正文法：
   - 直接改成当前正确结论，并在括号中补一句：
     - `wind_turbine` 由开局预完成的 `dyson_sphere_program` 直接提供
   - 或显式标注：
     - 该处为旧结论，已被 2026-04-05 复测更新

要求：

- 不把历史重写成“从来没错过”
- 但所有仍可能被截取引用的句子，都不能继续误导当前实现

### 5.4 `docs/dev/服务端API.md`

目标：

- 消除同一份 API 文档内部的自相矛盾
- 让默认新局说明与 `/catalog` 示例保持一致

具体改动：

1. 在默认新局介绍部分：
   - 将“`dyson_sphere_program` 只解锁 `matrix_lab`”改为“解锁 `matrix_lab + wind_turbine`”
   - 删除基地自带起步发电的隐含语义
   - 明确默认新局第一步应先补风机
2. 在 `/catalog.techs` 示例部分：
   - 确保 `dyson_sphere_program.unlocks` 包含 `matrix_lab` 与 `wind_turbine`
   - 确保 `electromagnetism.unlocks` 只体现 `tesla_tower` 与 `mining_machine`
3. 如需解释内部实现，可补一句：
   - 代码中的 `power_pylon` 会在对外目录中归一化为 `tesla_tower`

要求：

- 面向外部调用者时必须写对外可见语义
- 不能把内部 alias 直接抄成 API 示例

### 5.5 `docs/process/finished_task/*`

目标：

- 回收仍对外可见、且容易被误当现状摘要的过时结论

当前至少应修正：

- `docs/process/finished_task/T099_戴森终局高阶舰队线未开放与人造恒星燃料态异常.md`
- `docs/process/finished_task/T100_戴森深度试玩确认终局高阶舰队线仍未开放.md`

具体改动：

1. 将“`electromagnetism` 完成后解锁 `wind_turbine / tesla_tower / mining_machine`”改为：
   - `electromagnetism` 完成后解锁 `tesla_tower / mining_machine`
   - `wind_turbine` 已由 `dyson_sphere_program` 开局提供
2. 如文内存在“先建 `matrix_lab` 就能直接开第一门科研”的语义，同步改成“先风机、后研究站”
3. 只做最小必要修正，不把整份历史任务重写成别的问题

补充要求：

- 实施时应对 `docs/process/finished_task` 做一次关键词检索
- 如果除了 T099、T100 之外还有其他仍对外可见摘要命中过时口径，也应一并修正

## 6. 明确不改动的范围

本次任务明确不包含：

- 服务端代码逻辑修改
- `client-cli` 指令行为修改
- `client-web` 展示逻辑修改
- `docs/process/archive/*` 批量清洗
- 新增自动化文档一致性测试

这样可以把 T102 严格限定为“以实现为准的文档收口任务”。

## 7. 统一后的默认新局最小口径

所有修正后的主文档，都应能表达出以下统一链路：

1. 查看默认新局状态
2. 在基地正交相邻格建第一台 `wind_turbine`
3. 在基地另一侧正交相邻格建第一台空 `matrix_lab`
4. 直接尝试 `start_research electromagnetism`
   - 预期被拒绝：缺少矩阵
5. 向研究站装入 `10` 个 `electromagnetic_matrix`
6. 再次执行 `start_research electromagnetism`
7. 研究完成后获得：
   - `tesla_tower`
   - `mining_machine`

验证型文档可补充当前默认地图的可复现实例：

```text
summary
build 3 2 wind_turbine
build 2 3 matrix_lab
start_research electromagnetism
transfer <matrix_lab_id> electromagnetic_matrix 10
start_research electromagnetism
```

要求：

- `build 3 2` / `build 2 3` 必须明确为当前默认图实例
- `<matrix_lab_id>` 必须保持占位，不写死某次试玩的临时实体 ID

## 8. 实施后的验证方案

### 8.1 文本检索验证

在目标文档范围内检索以下旧口径：

- `基地自带发电`
- `electromagnetism` 与 `wind_turbine` 的直接解锁表述
- “先摆 `matrix_lab` 再补风机”的旧顺序

建议命令：

```bash
rg -n "基地自带发电|electromagnetism.*wind_turbine|wind_turbine.*electromagnetism|先把第一台空 .*matrix_lab|先在基地旁边建一台空 .*matrix_lab" \
  docs/player docs/dev docs/process/finished_task
```

预期：

- 主文档中不再裸露命中过时口径
- 若历史文档必须保留旧说法，则必须显式标注“旧结论/已过时/已更新”

### 8.2 实现一致性复核

实施时应再次复核：

- `server/internal/model/tech.go`
- `config/defs/buildings/combat/battlefield_analysis_base.yaml`
- `server/config-dev.yaml`

确保文档没有偏离当前实现。

### 8.3 回归测试验证

建议运行 T092 相关测试，确认默认新局真实闭环未回退：

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/gamecore -run T092
```

### 8.4 真实玩法验证

按修正后的最小命令链重放一次 brand-new 默认新局，确认：

- 先建风机后，研究站能进入有电状态
- 未装矩阵时开研会被拒绝
- 装入矩阵后 `electromagnetism` 可正常完成
- 解锁结果为 `tesla_tower + mining_machine`

## 9. 风险与规避

### 9.1 内部 alias 与对外名称混用

风险：

- 代码中的原始 unlock 名称是 `power_pylon`
- 文档如果直接抄代码，会把对外名称写错

规避：

- 玩家文档和 API 文档统一写 `tesla_tower`
- 只有开发文档在必要时补充 alias 归一化说明

### 9.2 历史记录被修正过头

风险：

- 如果直接重写 `已知问题与回归.md` 或 `finished_task/*`，会破坏历史语境

规避：

- 只改会误导当前读者的句子
- 保留时间、环境和当时的复测背景
- 优先用括号修正或“现已更新为”的方式处理

### 9.3 旧 archive 与 snapshot 再次污染判断

风险：

- 后续全文检索时仍可能搜到旧资料

规避：

- 在本方案中明确它们是非权威来源
- 本轮只清理当前仍直接面对读者的文档

### 9.4 示例命令被误当硬编码规则

风险：

- 玩家可能把示例坐标和临时建筑 ID 当成永远固定的规则

规避：

- 坐标写成“当前默认图可复现实例”
- 建筑 ID 一律写成运行时占位

## 10. 验收标准

T102 达成的判定标准如下：

1. 文档不再声称基地初始自带可供第一台研究站使用的发电能力。
2. 默认新局最小命令链统一为“先风机、再研究站、再装矩阵、再开研”。
3. `docs/player/*` 与 `docs/dev/*` 对默认新局科技树口径一致。
4. `docs/process/finished_task/*` 中仍对外可见的摘要，不再继续传播“`electromagnetism` 解锁 `wind_turbine`”的旧结论。
5. 玩家按修正后的文档重放 brand-new `config-dev.yaml + map.yaml` 默认新局时，不会再把真实可玩入口误判为“默认新局未实现”。

满足以上 5 条后，T102 才算真正收口。
