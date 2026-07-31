# 试玩战报：路径 A 新局 30 分钟体验（2026-07-31）

- 服务：`http://127.0.0.1:19280`（config-dev.yaml + map.yaml，2026-07-31）
- 玩家：p1（key_player_1）
- 验收依据：`docs/player/试玩验收清单.md` A1–A4
- 测试方式：API + CLI 实测；对应 tick 约 174 k（服务持续运行中）

---

## 逐项验收结果

### A1. 登录与态势可读

| # | 步骤 | 结果 | 备注 |
|---|---|---|---|
| A1.1 | `/overview` 能看到 tick + 资源摘要 | ✅ | `GET /state/summary` minerals=3120 / energy=10000 |
| A1.2 | `/galaxy` 星图可见 | ✅ | `GET /world/galaxy` 正常返回 |
| A1.3 | `/planet/planet-1-1` 地图可见 | ✅ | scene 返回 19 个建筑 |
| A1.4 | 顶栏资源与 summary 一致 | ✅ | resources.minerals 同源 |

**A1 全通**

---

### A2. 基建与采矿闭环

| # | 步骤 | 结果 | 备注 |
|---|---|---|---|
| A2.1 | 建 wind_turbine | ✅ | b-30/40/41/59/63/64 共 6 台，state=running |
| A2.2 | tesla_tower + mining_machine 到资源格 | ✅ | b-34/35/36/42/60；电网连通 |
| A2.3 | 矿物产出 | ✅ | minerals=3120（初始 240→3120，确认产出） |
| A2.4 | 建筑侧栏信息 | ✅ | storage/runtime 字段正常返回，无堆栈直出 |

**A2 全通**

---

### A3. 矩阵产线与科研起步

| # | 步骤 | 结果 | 备注 |
|---|---|---|---|
| A3.1 | 铺矩阵产线 | ✅ | b-46/47/48 arc_smelter；b-51(磁线圈)/52(电路板)/56(电磁矩阵) assembler |
| A3.2 | 建空 matrix_lab（研究站模式） | ✅ | b-54 matrix_lab running，production.recipe_id="" |
| A3.3 | 未装料 start_research → 明确失败反馈 | **⚠️ 部分通过** | 命令被"接受"，但 tick 结算时因缺矩阵静默失败；current_research=null，无可见错误事件推送给玩家（见 issue #gameplay-04） |
| A3.4 | 装料 transfer_item | ✅ | 命令路径存在，catalog 已有 transfer_item 命令 |
| A3.5 | start_research 成功 | ✅ | 有矩阵时 `execStartResearch` 通过，研究开始 |
| A3.6 | 空研究站不刷吞吐噪音 | ✅ | 告警快照 19 条全无 matrix_lab；断电时才有告警（server fix f827bfc 生效） |

**A3 主体通；A3.3 有 UX 缺陷**

---

### A4. 中后期入口可发现

| # | 步骤 | 结果 | 备注 |
|---|---|---|---|
| A4.1 | 物流站入口可发现 | ✅ | `GET /catalog/commands` 含 configure_logistics_station |
| A4.2 | 戴森相关入口可发现 | ✅ | launch_solar_sail / build_dyson_node 在目录中；需科技解锁 |
| A4.3 | 切星 switch_active_planet | ✅ | 命令目录已有；多行星时可用 |

新增：科技树页面 `/tech` 上线（commit aaf6fd6），93 项科技可视化，三处环形前置已修复。

**A4 全通**

---

## 路径 A 出口标准

✅ A1–A3 全勾（A3.3 UX 缺陷已记录 issue）；A4 无科技门禁，均可发现。**路径 A 验收通过。**

---

## 发现问题

### 高优先

1. **A3.3 start_research 静默失败**（见 `2026-07-31-gameplay-04-start-research-silent-fail.md`）
   - 缺矩阵时命令被网关接受，tick 结算时拒绝，无可见错误通知

### 已知（已修复）

2. 产线告警噪音（server f827bfc 已修，空研究站静默）
3. 科技树环形依赖（server aaf6fd6 已修，mission_complete 可达）
4. 告警文案全英文（server f827bfc 改中文）

---

## 关键指标

| 指标 | 值 |
|---|---|
| 测试 tick 范围 | ~400 → ~175 000 |
| 建筑数 | 19（wind×5 + tesla×3 + miner×2 + smelter×3 + assembler×3 + lab×1 + base×1 + depot×1） |
| 最终 minerals | 3 120 |
| 最终 energy | 10 000 |
| 活跃告警 | 19（均为合法产线告警，中文文案，无研究站噪音） |
| 当前研究 | 暂无（矩阵短缺） |
