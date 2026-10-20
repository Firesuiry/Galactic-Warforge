# 开局路线：从新局到第一项研究

实测环境：`scripts/playtest-up.sh <N> --checkpoint cp-root`（遭遇战，地图 `skirmish-seed-001`，研究、建造、产出节奏都是 2）。
下面的坐标是这张图的实测值。换图时，用 `scene` 找到同类位置，按相对关系平移。
**建筑 ID 每局都可能不同，一律用 `scene` 现查**，不要照抄本页的 ID。

## 1. 开局状态（cp-root，tick 27）

| 项 | 值 |
| --- | --- |
| 我的机甲 | `u-40`，在 (54,143)，核心能量 100/100 |
| 背包（40 格用了 5 格） | 电路板 15、齿轮 32、铁块 96、磁线圈 22、石材（`stone_brick`）3 |
| 基站 | `battlefield_analysis_base` (54,144)，5×5，建造半径 72，耗电 2，本身不发电 |
| 科技 | 只有 `dyson_sphere_program`。已解锁：风机、电塔、矿机、熔炉、传送带、分拣器、制造台、研究站、兵营、补给站 |
| 矿 | 铁 x54–56,y138–140；铜 x53–55,y139–141；石矿（`stone_ore`）x47–50,y130–131（西北约 20 格）；煤 x44–45,y136–137 |

> 物品名别混：`stone_ore` 是石矿，`stone_brick` 是石材（石矿手搓得来）；同理 `iron_ore` 是铁矿，`iron_ingot` 是铁块。
| 对手 | bot（easy），tick 60000 才会首次进攻 |

### 开局造价（`catalog building <id>` 可查）

| 建筑 | 占地 | 造价 |
| --- | --- | --- |
| `wind_turbine` | 2×2 | 齿轮 1、铁块 6、磁线圈 3 |
| `tesla_tower` | 1×1 | 铁块 2、磁线圈 1 |
| `mining_machine` | 3×3 | 电路板 2、齿轮 2、铁块 4、磁线圈 2 |
| `conveyor_belt_mk1` | 1×1 | 齿轮 1、铁块 2 |
| `sorter_mk1` | 1×1 | 电路板 1、铁块 1 |
| `arc_smelter` | 3×3 | 电路板 4、铁块 4、磁线圈 2、石材 2 |
| `assembling_machine_mk1` | 3×3 | 电路板 4、齿轮 8、铁块 4 |
| `matrix_lab` | 3×3 | 电路板 4、玻璃 4、铁块 8、磁线圈 4 |
| `depot_mk1`（研究电磁学后解锁） | 3×3 | 铁块 4、石材 4 |

**开局背包不够完整的开局链**：
- 建完风机、电塔、铁线和制造台之后，铜线还缺**电路板 3、石材 1**；
- 研究站还要**玻璃 4**，只能手搓。

所以开局第一件事是**采石矿、手搓石材和玻璃**。

## 2. 阶段路线

每个阶段的固定动作：先查（料够不够、位置空不空），再用 `scripts/sw -` 批量发命令，最后验证。

### 阶段 0：看局势

```bash
scripts/sw briefing          # 机甲 ID、背包、科技
scripts/sw scene             # 机甲周边的建筑、矿点汇总（含代表矿点 ID）、单位
scripts/sw scene 44 128 32 24   # 想看更大一块就指定窗口
```

### 阶段 1：采石、手搓（为熔炉和研究站备料）

```bash
scripts/sw - <<'EOF'
move u-40 50 132                       # 走到石矿 6 格内（手动采集的距离限制）
EOF
scripts/sw scene 46 128 8 6            # 现查石矿点 ID
scripts/sw mine_resource <石矿点ID> 15 # 15 个石矿：石材 5 用 5 个，玻璃 5 用 10 个
scripts/sw wait job
scripts/sw craft_item smelt_stone 5
scripts/sw wait job
scripts/sw craft_item glass 5
scripts/sw wait job
```

- 一台机甲同一时间只有一个作业（采集或手搓）。每次都要 `wait job` 之后再发下一条。
- **大批量手搓要加超时**：`wait job` 默认 120 秒。例如手搓 20 批铁块要 1200 tick，10 tick/s 下正好 120 秒，卡在边界上。这种情况用 `wait job --timeout 300`。
- 采集每个约 10 tick、耗 3 点能量；能量不够时用 `refuel_mecha coal N`（煤要先采到）。

### 阶段 2：发电

```bash
scripts/sw - <<'EOF'
build 55 142 wind_turbine
build 53 142 tesla_tower
EOF
scripts/sw networks          # 发电 10，用电 2（基站）
```

### 阶段 3：铁矿线（矿机 → 带子 → 分拣器 → 熔炉）

```bash
scripts/sw - <<'EOF'
build 57 140 mining_machine                       # 回执会写「将开采『铁矿』」
build 60 141 conveyor_belt_mk1 --direction east   # 贴着矿机东边，出货方向背离矿机
build 61 141 sorter_mk1 --rotation 90             # 背面（西）取带子，正面（东）放进熔炉
build 62 140 arc_smelter --recipe smelt_iron
EOF
scripts/sw wait build
scripts/sw scene 55 136 12 10          # 查熔炉 ID
scripts/sw wait running <熔炉ID>
scripts/sw inspect <熔炉ID>            # output 一项出现 iron_ingot 就成了
```

熔炉的成品先放在输出缓冲里（容量 8），满了熔炉就停。所以要么接出料分拣器（见 [logistics.md](logistics.md) 6.1），要么定期 `transfer <熔炉ID> iron_ingot 8 --take`。

### 阶段 4：铜线 + 第二组电

```bash
scripts/sw - <<'EOF'
build 52 143 tesla_tower
build 50 140 mining_machine                       # 框住铜矿
build 49 141 conveyor_belt_mk1 --direction west   # 贴着矿机西边，出货方向朝西
build 48 141 sorter_mk1 --rotation 270            # 背面（东）取带子，正面（西）放进熔炉
build 45 140 arc_smelter --recipe smelt_copper
build 52 145 wind_turbine
EOF
scripts/sw wait build
scripts/sw networks          # 发电 20，用电约 16
```

有了铜块就能手搓电路板：

```bash
scripts/sw transfer <铜熔炉ID> copper_ingot 8 --take
scripts/sw craft_item circuit_board 8
scripts/sw wait job
```

### 阶段 5：研究站

```bash
scripts/sw - <<'EOF'
build 62 146 matrix_lab          # 不要带 --recipe：不设配方就是研究模式
build 65 146 wind_turbine        # 研究站耗电 4
EOF
scripts/sw wait build
scripts/sw inspect <研究站ID>    # state=running，production 没有 recipe
```

### 阶段 6：电磁矩阵线（制造台 → 分拣器 → 带子 → 分拣器 → 研究站）

```bash
scripts/sw - <<'EOF'
build 62 151 assembling_machine_mk1 --recipe electromagnetic_matrix
build 65 151 sorter_mk1 --rotation 90             # 背面（西）取制造台，正面（东）放到带子
build 66 151 conveyor_belt_mk1 --direction north
build 66 150 conveyor_belt_mk1 --direction west
build 65 150 conveyor_belt_mk1 --direction west
build 64 150 conveyor_belt_mk1 --direction west
build 63 150 conveyor_belt_mk1 --direction west
build 63 149 sorter_mk1 --rotation 0              # 背面（南）取带尾，正面（北）放进研究站
build 66 152 tesla_tower
build 72 152 wind_turbine                         # 这张网要带制造台 5 + 分拣器 2 + 研究站 4
EOF
scripts/sw wait build
scripts/sw networks                               # 不能有缺电和未接电的建筑
```

实测的坑：只补电塔不补风机，这张新网就是 0 发电，所有建筑都会是 `no_power`。

### 阶段 7：喂料 → 矩阵 → 研究电磁学

- 电磁矩阵的配方是磁线圈 1 + 电路板 1 → 矩阵 1（`catalog recipes --building assembling_machine_mk1` 可查），不能手搓，只能用制造台做。
- 制造台每种原料一次最多收 2 个（配方用量的 2 倍），所以要分轮装料。**喂料前先算总量**：把研究成本（`catalog techs --available` 里电磁学显示 **电磁矩阵 ×20**，已按本局节奏换算）按配方反推，得到这一整轮总共要喂多少，**一次备齐**，不要边喂边补——制造台的原料窗口只有 2，喂进去的会被立刻消耗；中途断料时，后面每一轮都会以同样的「背包不够」失败。
  - `plan need` 子命令可用时直接按产物反算：`scripts/sw plan need electromagnetic_matrix 20`（它会按配方逐层展开到基础原料，并标出背包/本方建筑里已有的量）；没有这个子命令时按配方手算（每批的输入/输出见 `catalog recipes`）：
    ```text
    电磁矩阵 ×20  ← 磁线圈 1 + 电路板 1 → 矩阵 1 / 批（制造台 20 批）
      → 磁线圈 20 + 电路板 20
    磁线圈 20     ← 磁铁 2 + 铜块 1 → 磁线圈 2 / 批（手搓 10 批）
      → 磁铁 20 + 铜块 10
    磁铁 20       ← 铁矿 1 → 磁铁 1 / 批（手搓 20 批）
      → 铁矿 20
    电路板 20     ← 铁块 1 + 铜块 1 → 电路板 1 / 批（手搓 20 批）
      → 铁块 20 + 铜块 20
    合计：铁矿 20、铁块 20、铜块 30
    ```
    注意**按每批的输出数量折算**：磁线圈配方一批出 2 个，所以 20 个只要 10 批、20 个磁铁，不是 40 个。
  - 所以背包/仓库里要**先凑齐磁线圈 20、电路板 20**（或它们的原料）再开始喂。背包格数不够时，先把原料分批手搓成磁线圈、电路板，存进附近的补给站，再从补给站边取边喂。
- 研究成本：`catalog techs --available` 里电磁学显示 **电磁矩阵 ×20**（已按本局节奏换算）。
- **研究站是边研究边消耗矩阵的**，所以：
  - 在 `start_research` **之前**把 20 个矩阵都送进研究站，再用 `wait item` 确认；
  - `start_research` 之后库存会往下掉，**不要**再用 `wait item … --in 研究站` 等 20 个；
  - 研究开始后看 `briefing` 的 `research <科技> progress=n/20`。矩阵不够时，进度会停住（`blocked_reason` 里能看到原因），补料后继续。
- 速度：一座矩阵研究站是 `research_per_tick=1`，也就是每 tick 消耗 1 个矩阵、推进 1 点。20 个矩阵理论上 20 tick，但**供电不足会按比例降速**，实际可能慢好几倍。用 `wait ticks` 轮询 `briefing` 的 progress，不要假设固定时长。

```bash
# 喂料是分轮的：制造台每种原料一次只收 2 个（配方用量的 2 倍）。
# 总量要一次备齐：磁线圈 20、电路板 20；喂之前先 mecha list 确认背包数量，不要边喂边补。
for i in $(seq 10); do
  scripts/sw transfer <制造台ID> magnetic_coil 2
  scripts/sw transfer <制造台ID> circuit_board 2
  scripts/sw wait item electromagnetic_matrix $((2*i)) --in <研究站ID>
done
scripts/sw start_research electromagnetism
scripts/sw wait ticks 30
scripts/sw briefing          # 已完成科技里出现 electromagnetism
```

- 循环里每一轮都要能成功。**中途某一轮报「机甲背包需有 2 个「电路板」，当前 0 个」，就停下来补料，不要继续跑后面的轮次**——后面每一轮都会以同样的原因失败，白白刷出一串失败记录（第三次验证因此产生了 20 条重复失败）。补料后再从断点接着喂。
- 料不够就先手搓：磁线圈要磁铁（`smelt_magnet`，吃**铁矿**），电路板要铁块 + 铜块。
- 矩阵不够时，`start_research` 也会成功，但进度会停住（`blocked_reason` 显示等待矩阵或供电不足）。所以要先等 20 个都到位。


### 阶段 8：验证解锁

```bash
scripts/sw build 70 146 depot_mk1   # 研究前报「小型储物仓需先研究解锁」，研究后可以建
```

## 3. 参考数字

- 构建记录走同一条路线，从 cp-root 到电磁学完成，到 tick 13320。
- 一个代理逐条下令、逐条等结果，实测约 85–90 条命令，失败 13 条左右（主要是缺料，其次是机甲已有作业），在 tick 13962–19478 之间完成（取决于等料和试错）。
- 照本页的「先查再做，`wait` 之后再发下一条」，这两类失败都能避免。

## 3.5 cp-base 存档点里已经有什么

从 cp-base 开始时，下面这些建筑已经存在（ID 用 `scene` 现查，这里只是让你心里有数）：

| 建筑 | 大概位置 | 存了什么 |
| --- | --- | --- |
| 基站 `battlefield_analysis_base` | (54,144) | 建造半径 72 |
| 铁熔炉 `arc_smelter`（smelt_iron） | (62,140) | 铁块 |
| 铜熔炉 `arc_smelter`（smelt_copper） | (45,140) | 铜块 |
| 铁矿机 / 铜矿机 | (57,140) / (50,140) | 铁、铜都接进了熔炉 |
| 制造台 `assembling_machine_mk1` | (59,144) | 齿轮 |
| 铁补给站 `supply_station` | (65,143) | 铁块（取料用 `transfer <ID> iron_ingot N --take`） |
| 铜补给站 `supply_station` | (41,142) | 铜块 |

- **不要照搬本页开局的坐标**：这些位置已经被占，建东西前先用 `find_space`。
- 想取铁块、铜块，直接去这两个补给站 `--take`，不用自己建熔炉。
- 想新建产线，用 `find_space 3 3 --near <目标矿点> --spacing 4` 找一块不挨着的空地。

## 4. 之后做什么

- **自动化原料**：铁块、铜块接出料分拣器进补给站（[logistics.md](logistics.md) 6.1，注意那是 cp-mining 上的坐标，cp-base 上已被占用）；再建齿轮、电路板、磁线圈制造台，用分拣器从补给站取料。
- **研究**：`catalog techs --available` 选下一项。
- **防御**：bot 在 tick 60000 首次进攻。建兵营（`barracks`）、`produce <兵营ID> soldier`，详见 `docs/player/玩法指南.md` 阶段 F。
