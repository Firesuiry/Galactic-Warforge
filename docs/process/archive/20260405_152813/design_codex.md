# T102 设计方案：统一默认新局玩家文档与科技树口径（Codex）

> 对应任务：`docs/process/task/T102_默认新局玩家文档仍沿用旧科研起步与科技树口径.md`
>
> 当前 `docs/process/task/` 下只有这一项未完成任务。本设计只覆盖 T102，不混入新的玩法功能开发。

## 1. 设计结论

T102 的本质不是“默认新局还没实现”，而是“默认新局已经改成可玩的真实闭环，但文档还在传播旧闭环”。

因此本次推荐方案不是改服务端逻辑，而是做一轮**以实现为准的文档收口**：

1. 以当前服务端科技定义、建筑定义、默认配置和 T092 闭环测试作为唯一权威来源。
2. 统一 `docs/player/*` 与 `docs/dev/*` 中默认新局的入口顺序、供电前提和科技树口径。
3. 对仍然对外可见的历史摘要做“保留时间线但修正现状口径”的处理，避免旧结论继续污染新试玩。
4. 明确哪些内容不是权威来源，避免后续再被旧 snapshot、旧设计稿或历史归档带偏。

本任务完成后，玩家和开发者都应得到同一条信息：

- 默认新局开局只预完成 `dyson_sphere_program`
- 这门科技直接提供 `matrix_lab + wind_turbine`
- 基地本身不发电
- 第一段真实入口是“先风机、再研究站、再装矩阵、再开 `electromagnetism`”
- `electromagnetism` 只负责提供 `tesla_tower + mining_machine`

## 2. 当前权威事实

### 2.1 权威来源层级

本次文档修正必须按以下优先级取真相：

1. `server/internal/model/tech.go`
   - 科技树、前置、原始 unlock 定义的权威来源
2. `server/internal/model/tech.go` 中的 `normalizeTechDefinitions()` / `techUnlockAliases`
   - 对外展示 unlock 时的归一化权威来源
3. `config/defs/buildings/combat/battlefield_analysis_base.yaml`
   - 基地供电能力的权威定义
4. `server/config-dev.yaml`
   - 默认新局启动包和玩家 bootstrap 的权威定义
5. `server/internal/model/t092_default_newgame_test.go`
   - 默认新局科技解锁关系的回归约束
6. `server/internal/gamecore/t092_default_newgame_test.go`
   - 默认新局第一段科研闭环的真实玩法回归约束
7. 2026-04-05 最新试玩记录
   - 仅作为运行证据，不高于代码与测试

以下内容必须明确视为**非权威来源**：

- `server/data/snapshots/*`
  - 仓库里仍残留旧快照，里面还能看到 `battlefield_analysis_base.output_per_tick = 5` 之类历史数据
- 旧设计稿、archive、历史任务文本
  - 这些文件记录的是“当时的判断”，不能反向覆盖当前实现
- `docs/player/已知问题与回归.md` 的旧条目
  - 它是历史记录，不是科技树真相表

### 2.2 当前实现真相

根据当前代码与测试，默认新局的真实口径是：

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
  - `generation_mw = 0`
  - 不提供默认起步发电
- `server/config-dev.yaml`
  - 每名玩家默认启动包包含：
    - `minerals = 200`
    - `energy = 100`
    - `electromagnetic_matrix x50`
- T092 闭环测试已证明：
  - fresh new game 可以先建 `wind_turbine`
  - 再建 `matrix_lab`
  - 研究站通电后可进入 `running`
  - 未装矩阵时 `start_research electromagnetism` 会被拒绝
  - 装入真实矩阵后可完成 `electromagnetism`

因此，当前默认新局不是“主线未实现”，而是“文档还在描述旧主线”。

## 3. 方案比较

### 3.1 方案 A：只修任务里点名的 4 份文档

范围：

- `docs/player/玩法指南.md`
- `docs/player/上手与验证.md`
- `docs/player/已知问题与回归.md`
- `docs/dev/服务端API.md`

优点：

- 改动最小
- 能快速消除最核心的玩家误导

缺点：

- `docs/process/finished_task/*` 中仍存在对外可见的旧摘要
- 之后全文检索时，仍会搜到“`electromagnetism` 解锁 `wind_turbine`”这类过时说法
- 只能解决“主文档错”，不能解决“可见归档继续传播旧口径”

结论：不推荐单独采用。

### 3.2 方案 B：主文档修正 + 仍可见历史摘要收口

范围：

- 修正 4 份主文档
- 同步修正 `docs/process/finished_task/` 下仍会被人直接打开阅读的相关摘要
- 保留 archive 和纯历史记录，但不把它们当现状口径

优点：

- 能真正把“当前对外口径”统一成一套
- 搜索结果更干净，后续试玩不容易再被旧结论误导
- 仍然保持改动聚焦，不引入新的实现范围

缺点：

- 比方案 A 多做一轮归档清理
- 需要谨慎处理历史文案，避免把“历史曾经出错”也一起抹掉

结论：推荐采用。

### 3.3 方案 C：进一步做文档自动生成或一致性测试

范围：

- 在方案 B 基础上，再增加脚本或测试，自动比对 `/catalog.techs` 与文档关键片段

优点：

- 长期最稳
- 能降低下一次科技树变更后的文档漂移风险

缺点：

- 已超出 T102 的直接范围
- 需要额外设计文档片段格式、提取策略和测试边界

结论：可作为后续增强，不纳入本次 T102。

## 4. 推荐方案

采用**方案 B：主文档修正 + 仍可见历史摘要收口**。

理由：

1. T102 关心的是“当前玩家和开发者会看到什么”，而不是只修其中一部分页面。
2. 仅修主文档不够，`finished_task` 里的旧结论仍然会被当成“最近一次结论”继续引用。
3. 当前问题已经有完整代码真相和回归测试，不需要再碰服务端实现。

## 5. 详细设计

### 5.1 文档统一原则

所有目标文档统一遵守以下规则：

1. 面向玩家和 API 使用者时，使用**归一化后的对外名称**
   - 写 `tesla_tower`
   - 不写内部 alias `power_pylon`
2. 默认新局入口必须统一成同一顺序
   - 先 `wind_turbine`
   - 再 `matrix_lab`
   - 再装 `electromagnetic_matrix`
   - 再开 `electromagnetism`
3. 不再出现“基地自带发电 5”之类与当前实现冲突的表述
4. 不再出现“`electromagnetism` 解锁 `wind_turbine`”之类旧科技树口径
5. 玩家指南优先使用**相对位置描述**
   - 例如“基地正交相邻格”
6. 验证文档可以保留**当前官方 seed 下的示例命令链**
   - 例如 `build 3 2 wind_turbine`
   - 但应注明这是当前默认地图的可复现实例，不应被写成永远固定的世界规则

### 5.2 目标文件与改动设计

#### 5.2.1 `docs/player/玩法指南.md`

目标：

- 修正玩家对默认新局“第一步该干什么”的认知
- 把阶段 B 的科技树描述改回当前真实实现

具体改动：

1. “开局你拥有什么”
   - 将 `dyson_sphere_program` 的描述改为“直接提供 `matrix_lab + wind_turbine`”
   - 删除“基地自带发电 `5`，足够覆盖 `matrix_lab` 耗电”的说法
   - 将第一段科研入口改成“先建风机，再建研究站”
2. “阶段 B：稳定供电 + 采矿”
   - 将 `electromagnetism` 的解锁列表修正为 `tesla_tower + mining_machine`
   - 明确 `wind_turbine` 已由开局科技提供
   - 将推荐顺序改为：
     - 先风机
     - 再研究站
     - 再装矩阵开研
     - 研究完成后接电塔、铺矿机
3. “一条最实用的新手流程”
   - 把 `wind_turbine` 前移到 `matrix_lab` 之前
   - 删除“研究完再造第一台风机”的旧流程

设计要求：

- 这是玩家主文档，应强调玩法顺序和误区，不必堆 API 内部细节
- 但要明确点破一个关键信息：**基地本身不发电**

#### 5.2.2 `docs/player/上手与验证.md`

目标：

- 提供一条 brand-new 默认新局可直接复现的最小验证链

具体改动：

1. “最小可玩路径”
   - 在建研究站之前补入建风机步骤
   - 保留“先故意试一次未装矩阵开研，确认被正确拒绝”的验证点
   - 研究成功后的说明改为“解锁 `tesla_tower + mining_machine`”
2. 示例命令
   - 可以继续使用当前默认图的示例坐标
   - 但要把措辞写成“当前默认图可复现实例”

设计要求：

- 本文件是“验证文档”，应该比 `玩法指南.md` 更具体
- 这里允许出现明确命令链，但不能再隐含“基地先天有电”

#### 5.2.3 `docs/player/已知问题与回归.md`

目标：

- 保留历史时间线
- 停止让旧结论在当前阅读体验里继续冒充现状

具体改动：

1. 保留 2026-04-05 最新结论作为当前口径
2. 对 2026-04-04 及更早条目中以下表述做局部修正：
   - `electromagnetism` 解锁 `wind_turbine`
   - 默认新局先摆 `matrix_lab` 就能进入第一门科研
3. 修正文案方式优先采用：
   - 直接改成当前正确结论，并在括号里补一句“`wind_turbine` 已由 `dyson_sphere_program` 开局提供”
   - 或补一行“该处为当时试玩结论，现已被 2026-04-05 复测更新”

设计要求：

- 不把历史记录彻底重写成“从来没错过”
- 但所有仍可能被单独引用的句子，都必须读起来不再误导现状

#### 5.2.4 `docs/dev/服务端API.md`

目标：

- 消除同一份 API 文档内部的自相矛盾
- 让默认新局介绍和 `/catalog.techs` 示例保持一致

具体改动：

1. “普通新局默认入口”
   - 将“`dyson_sphere_program` 只解锁 `matrix_lab`”改为“解锁 `matrix_lab + wind_turbine`”
   - 明确基地本身不发电，因此第一步要先补风机
2. `/catalog` 示例
   - 将 `electromagnetism.unlocks` 改为 `tesla_tower + mining_machine`
   - 如需解释内部实现，可加一句：
     - 内部 alias `power_pylon` 在对外目录里归一化为 `tesla_tower`

设计要求：

- API 文档面向的是外部调用者，所以必须写对外可见语义
- 不能把内部 alias 直接抄进示例，造成“代码里一个名、文档里另一个名、接口里又一个名”

#### 5.2.5 `docs/process/finished_task/T099_*.md` 与 `T100_*.md`

目标：

- 回收仍然可见、且容易被误当现状摘要的过时口径

具体改动：

1. 将“`electromagnetism` 完成后解锁 `wind_turbine / tesla_tower / mining_machine`”改为：
   - `electromagnetism` 完成后解锁 `tesla_tower / mining_machine`
   - `wind_turbine` 已由 `dyson_sphere_program` 开局提供
2. 如文内存在“先建 `matrix_lab` 即可开第一门科研”的语义，也同步改为“先风机后研究站”

设计要求：

- 这里只做**最小必要修正**
- 不扩散修改旧 archive
- 不把整个任务历史重写成别的问题

### 5.3 明确不改动的范围

本次设计明确不包含：

- 服务端代码修改
- `client-cli` 命令行为修改
- `client-web` 展示逻辑修改
- archive 下旧设计稿批量清洗
- 新增自动化文档一致性测试

这样可以保证 T102 作为文档收口任务，边界足够清晰。

### 5.4 统一后的默认新局最小口径

所有修正后的主文档，应统一能表达出下面这条最小链路：

1. 查看默认新局状态
2. 在基地正交相邻格建第一台 `wind_turbine`
3. 在基地另一侧正交相邻格建第一台空 `matrix_lab`
4. 直接尝试 `start_research electromagnetism`
   - 预期被拒绝：缺少矩阵
5. 向研究站装入 `10` 个 `electromagnetic_matrix`
6. 再次 `start_research electromagnetism`
7. 研究完成后获得：
   - `tesla_tower`
   - `mining_machine`

对于验证型文档，可补充当前默认地图的可复现实例：

```text
build 3 2 wind_turbine
build 2 3 matrix_lab
start_research electromagnetism
transfer <matrix_lab_id> electromagnetic_matrix 10
start_research electromagnetism
```

其中 `<matrix_lab_id>` 应写成运行时占位，不应硬编码成某次试玩里的临时 building ID。

## 6. 验证设计

实现该方案时，建议按以下顺序验证：

1. 文本检索验证
   - 在 `docs/player`、`docs/dev`、`docs/process/finished_task` 中检索：
     - `基地自带发电`
     - `electromagnetism` 与 `wind_turbine` 的直接解锁表述
     - “先摆 `matrix_lab` 再补电”的旧顺序
2. 实现一致性验证
   - 复核 `server/internal/model/tech.go`
   - 复核 `config/defs/buildings/combat/battlefield_analysis_base.yaml`
   - 复核 `server/config-dev.yaml`
3. 回归测试验证
   - 运行 T092 相关测试，确认默认新局闭环没有回退
4. 真实玩法验证
   - 按修正后的最小命令链重放一次默认新局
   - 确认不会再进入“研究站先天无电”的误导路径

建议使用的最小验证命令：

```bash
rg -n "基地自带发电|electromagnetism.*wind_turbine|wind_turbine.*electromagnetism|先把第一台空 .*matrix_lab|先在基地旁边建一台空 .*matrix_lab" docs/player docs/dev docs/process/finished_task

cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH go test ./internal/model ./internal/gamecore -run T092
```

第一条命令的预期是：

- `docs/player`、`docs/dev`、`docs/process/finished_task` 中不再命中过时口径
- 若为了保留历史而必须出现命中，相关句子必须显式标注“该结论已过时”或等价说明，不能再裸露成当前事实

## 7. 风险与规避

### 7.1 内部 alias 与对外名称混用

风险：

- 代码里 `electromagnetism` 的原始 unlock 用的是 `power_pylon`
- 文档直接抄代码时容易把对外名写错

规避：

- 统一规定：玩家文档和 API 文档一律写 `tesla_tower`
- 如需解释内部实现，只在开发文档中补充 alias 归一化说明

### 7.2 历史记录被“修正过头”

风险：

- 如果直接大改 `已知问题与回归.md`、`finished_task/*`，可能会让时间线失真

规避：

- 只改会误导现状的句子
- 保留时间、环境、当时复测事实
- 优先用“现已更新为”或括号修正，而不是整段重写

### 7.3 旧 snapshot 或 archive 再次污染判断

风险：

- 后续有人全文检索时，仍可能搜到旧 snapshot、旧 archive

规避：

- 在本次设计中明确把它们定义为非权威来源
- 本轮只清理仍可见、仍会被直接阅读引用的文档

## 8. 验收标准映射

T102 的验收可直接映射为以下 4 条：

1. 文档不再声称基地初始自带可供第一台研究站使用的发电能力
2. 默认新局最小命令链按“先风机、再研究站、再装矩阵、再开研”统一表达
3. `docs/player/*` 与 `docs/dev/*` 对默认新局科技树口径一致
4. `docs/process/finished_task/*` 中仍对外可见的旧摘要，不再继续传播 `electromagnetism` 解锁 `wind_turbine` 的过时结论

达到这 4 条后，T102 才算真正收口。
