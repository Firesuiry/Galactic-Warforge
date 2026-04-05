# T102 设计方案：统一默认新局玩家文档与科技树口径

## 问题概述

默认新局的玩家文档仍沿用旧的科研起步口径，与当前服务端实际实现存在多处冲突，会误导玩家认为"开局卡死"。

### 当前实现（authoritative 真相）

根据 `server/internal/model/tech.go` 代码确认：

| 科技 | 解锁内容 |
|------|----------|
| `dyson_sphere_program`（开局预完成） | `matrix_lab` + `wind_turbine` |
| `electromagnetism`（Level 1，需 10 electromagnetic_matrix） | `power_pylon` → 映射到 `tesla_tower` + `mining_machine` |

基地 `battlefield_analysis_base` 的实际发电能力：
- `runtime.functions.energy.output_per_tick = 0`
- 即**基地不自带发电**，初始状态为 `no_power / power_no_provider`

### 文档中的错误口径

| 错误描述 | 出现位置 |
|----------|----------|
| "基地自带发电 5，足够覆盖 matrix_lab 的耗电 4" | `玩法指南.md` §2 |
| "先把第一台空 matrix_lab 贴着基地摆下去"（暗示不需要先建风机） | `玩法指南.md` §2, §7 |
| `electromagnetism` 解锁 `wind_turbine` | `玩法指南.md` §4 阶段 B |
| "在基地旁边建一台空 matrix_lab"作为最小可玩路径第一步 | `上手与验证.md` §4.1 |
| `electromagnetism` 完成后解锁 `wind_turbine` / `tesla_tower` / `mining_machine` | `已知问题与回归.md` 多处历史结论 |
| 服务端API文档中 catalog 示例与前文默认新局介绍互相冲突 | `服务端API.md` |

---

## 改动方案

### 改动 1：更新 `docs/player/玩法指南.md`

#### 1.1 §2 "开局你拥有什么"

**当前文本（第 68-75 行）：**
```
- 初始已完成科技：
  - `dyson_sphere_program`
    - 现在会直接提供 `matrix_lab` 建造权限

这意味着默认新局的第一段科研入口已经固定下来：

- 先把第一台空 `matrix_lab` 贴着基地摆下去
- 基地自带发电 `5`，足够覆盖 `matrix_lab` 的耗电 `4`
- 再把启动包里的 `electromagnetic_matrix` 装进研究站，就能合法启动第一门 `electromagnetism`
```

**改为：**
```
- 初始已完成科技：
  - `dyson_sphere_program`
    - 直接提供 `matrix_lab` 和 `wind_turbine` 建造权限

这意味着默认新局的第一段科研入口已经固定下来：

- 先在基地旁边建一台 `wind_turbine`（基地本身不发电，必须先接电）
- 再贴着基地建一台空 `matrix_lab`，确保它在风机供电范围内
- 把启动包里的 `electromagnetic_matrix` 装进研究站，就能合法启动第一门 `electromagnetism`
```

#### 1.2 §4 阶段 B "第一优先级永远是拿到稳定供电 + 采矿"

**当前文本（第 213-219 行）：**
```
当前真正建议的第一项关键科技是：

- `electromagnetism`

它会解锁一组非常关键的早期能力：

- `wind_turbine`
- `tesla_tower`
- `mining_machine`
```

**改为：**
```
开局已经由 `dyson_sphere_program` 解锁了 `wind_turbine`，所以第一步是先把风机贴基地建好，让基地和后续建筑有电。

当前真正建议的第一项关键科技是：

- `electromagnetism`

它会解锁一组非常关键的早期能力：

- `tesla_tower`
- `mining_machine`
```

#### 1.3 §4 阶段 B 推荐顺序

**当前文本（第 221-228 行）：**
```
推荐顺序：

1. 先在基地旁边建一台空 `matrix_lab`
2. 把 `10` 个 `electromagnetic_matrix` 装进这台研究站，再研究 `electromagnetism`
3. **先确认执行体到目标矿点是否在操作范围内；超出范围就先移动执行体**
4. 摆 `wind_turbine`，保证有持续发电
5. 视距离补 `tesla_tower`，把电网接出去
6. 把 `mining_machine` 直接压到资源点上
```

**改为：**
```
推荐顺序：

1. 先在基地正交相邻格建一台 `wind_turbine`（开局已解锁）
2. 再在基地另一侧正交相邻格建一台空 `matrix_lab`
3. 把 `10` 个 `electromagnetic_matrix` 装进研究站，研究 `electromagnetism`
4. 研究完成后解锁 `tesla_tower` 和 `mining_machine`
5. **先确认执行体到目标矿点是否在操作范围内；超出范围就先移动执行体**
6. 视距离补 `tesla_tower`，把电网接出去
7. 把 `mining_machine` 直接压到资源点上
```

#### 1.4 §7 "一条最实用的新手流程"

**当前文本（第 772-776 行）：**
```
1. 先查当前星球、迷雾、资源点分布
2. 在基地旁边建一台空 `matrix_lab`
3. 把 `10` 个 `electromagnetic_matrix` 装进研究站，再研究 `electromagnetism`
4. 造 `wind_turbine`
```

**改为：**
```
1. 先查当前星球、迷雾、资源点分布
2. 在基地正交相邻格建一台 `wind_turbine`（开局已解锁，基地本身不发电）
3. 在基地另一侧建一台空 `matrix_lab`
4. 把 `10` 个 `electromagnetic_matrix` 装进研究站，研究 `electromagnetism`
```

后续步骤顺序相应后移，原第 4 步"造 wind_turbine"删除，原第 5 步起保持不变。

---

### 改动 2：更新 `docs/player/上手与验证.md`

#### 2.1 §4.1 最小可玩路径

**当前文本（第 88-94 行）：**
```
1. 登录后执行 `summary`
2. 扫描银河 / 恒星系 / 行星
3. 在基地旁边建一台空 `matrix_lab`
4. 先直接执行一次 `start_research electromagnetism`，确认"有研究站但没装矩阵"时仍不会凭空开研
5. 把 `10` 个 `electromagnetic_matrix` 装入研究站本地存储
6. 再执行 `start_research electromagnetism`
7. 继续推进供电、采矿、物流与制造链
```

**改为：**
```
1. 登录后执行 `summary`
2. 扫描银河 / 恒星系 / 行星
3. 在基地正交相邻格建一台 `wind_turbine`（开局已由 `dyson_sphere_program` 解锁，基地本身不发电）
4. 在基地另一侧正交相邻格建一台空 `matrix_lab`
5. 先直接执行一次 `start_research electromagnetism`，确认"有研究站但没装矩阵"时仍不会凭空开研
6. 把 `10` 个 `electromagnetic_matrix` 装入研究站本地存储
7. 再执行 `start_research electromagnetism`
8. 研究完成后解锁 `tesla_tower` 和 `mining_machine`，继续推进采矿、物流与制造链
```

---

### 改动 3：更新 `docs/player/已知问题与回归.md`

#### 3.1 修正历史结论中的错误口径

以下历史段落中出现了 `electromagnetism` 解锁 `wind_turbine` 的旧口径，需要修正：

**第 135 行（2026-04-04 终局补充复测）：**
```
- 向研究站装入 `10` 个 `electromagnetic_matrix` 后，`electromagnetism` 可正常完成并解锁 `wind_turbine` / `tesla_tower` / `mining_machine`
```
**改为：**
```
- 向研究站装入 `10` 个 `electromagnetic_matrix` 后，`electromagnetism` 可正常完成并解锁 `tesla_tower` / `mining_machine`（`wind_turbine` 由开局预完成的 `dyson_sphere_program` 直接提供）
```

**第 215 行（2026-04-04 深夜追加复测）：**
```
- `electromagnetism` 完成后，`wind_turbine`、`tesla_tower`、`mining_machine` 可继续真实建造
```
**改为：**
```
- `electromagnetism` 完成后，`tesla_tower`、`mining_machine` 可继续真实建造（`wind_turbine` 由 `dyson_sphere_program` 开局直接提供）
```

**第 315 行（2026-04-04 深度试玩）：**
```
- `transfer b-28 electromagnetic_matrix 10` 后再次开研，可正常完成并解锁 `wind_turbine` / `tesla_tower` / `mining_machine`
```
**改为：**
```
- `transfer b-28 electromagnetic_matrix 10` 后再次开研，可正常完成并解锁 `tesla_tower` / `mining_machine`（`wind_turbine` 由 `dyson_sphere_program` 开局直接提供）
```

---

### 改动 4：更新 `docs/dev/服务端API.md`

#### 4.1 默认新局介绍段落

找到描述默认新局的段落，将以下内容对齐：

- `dyson_sphere_program` 解锁 `matrix_lab` **和** `wind_turbine`（不是只有 `matrix_lab`）
- 删除"基地自带发电"相关描述
- 明确默认新局第一步是先建风机再建研究站

#### 4.2 catalog 示例中的科技树

确保 catalog 示例中：
- `dyson_sphere_program.unlocks` 包含 `[matrix_lab, wind_turbine]`
- `electromagnetism.unlocks` 包含 `[tesla_tower, mining_machine]`（不包含 `wind_turbine`）

注意：代码中 `electromagnetism` 的 unlock ID 是 `power_pylon`，但 `power_pylon` 通过 `unlockAliases` 映射到实际建筑 `tesla_tower`。文档面向玩家时应使用最终建筑名 `tesla_tower`。

---

## 真实可复现的默认新局最小命令链

修改完成后，所有文档中的默认新局入口应统一为以下可复现步骤：

```
1. summary                                          # 确认开局状态
2. build 3 2 wind_turbine                           # 先建风机供电
3. build 2 3 matrix_lab                             # 再建研究站
4. start_research electromagnetism                  # 会被拒绝：缺矩阵
5. transfer <matrix_lab_id> electromagnetic_matrix 10  # 装填矩阵
6. start_research electromagnetism                  # 开始研究
7. # 等待研究完成 → 解锁 tesla_tower + mining_machine
```

---

## 验收标准

1. **文档不再声称基地初始自带可供第一台研究站使用的发电能力**
   - `玩法指南.md` 中不再出现"基地自带发电 5"
   - 所有提到开局步骤的地方都以"先建 wind_turbine"为第一步

2. **文档中的默认新局最小命令链可在 brand-new `config-dev.yaml + map.yaml` 下真实复现**
   - 按文档步骤操作不会遇到 `no_power` 死局

3. **`docs/player/*` 与 `docs/dev/*` 对默认新局科技树口径一致**
   - `dyson_sphere_program` → `matrix_lab` + `wind_turbine`
   - `electromagnetism` → `tesla_tower` + `mining_machine`
   - 不存在互相矛盾的描述

4. **历史回归记录中的旧口径已标注或修正**
   - `已知问题与回归.md` 中不再传播 `electromagnetism` 解锁 `wind_turbine` 的错误信息

---

## 影响范围

| 文件 | 改动类型 |
|------|----------|
| `docs/player/玩法指南.md` | 修正 4 处段落 |
| `docs/player/上手与验证.md` | 修正 1 处段落 |
| `docs/player/已知问题与回归.md` | 修正 3 处历史结论 |
| `docs/dev/服务端API.md` | 修正默认新局介绍 + catalog 示例 |

不涉及任何服务端代码改动。纯文档修正任务。
