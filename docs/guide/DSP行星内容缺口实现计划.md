# DSP 行星内容缺口实现计划

来源: 2026-09-17 八维审计工作流 (wf_3203be90-088)。审计口径: 公共命令/API 可触发 + Tick 真实结算才算完成。

# SiliconWorld 缺口实现清单（按批次分组）

优先级：P0=高 / P1=中 / P2=低。路径均相对 `/home/firesuiry/develop/siliconWorld/server/`。

---

## 批次 A：配方与物品基座（最先做，一切的前提）

### A0. 科技-配方门控系统性修复（P0，其他所有配方工作的前置）
- 文件：`internal/model/tech.go`、`internal/model/recipe.go`、`internal/gamecore/research.go:576-597`
- 要点：35 个 TechUnlockRecipe ID 悬空或拼写不匹配（steel/diamond/graphite/missile 等），且 `CanUseRecipeTech` 对未被任何科技引用的配方默认放行——导致科技不真正门禁配方、矩阵 special 解锁形同虚设；需对齐 ID、修正 `tech.go:326-327` 把 prism/plasma_exciter 错标为建筑解锁、让矩阵配方由对应矩阵科技门控。

### A1. 基础中间品补齐（P0）
- 文件：`internal/model/item.go`、`internal/model/recipe.go`、`internal/model/tech.go`
- 要点：新增钢材（铁×3→钢，熔炉）、金刚石（石墨→金刚石，熔炉）、玻璃配方（石×2→玻璃）、有机晶体（塑料+精炼油+水，化工厂）、电磁涡轮（电动机+磁线圈）、超级磁环（涡轮+磁铁+石墨）。

### A2. 光学/量子链（P0）
- 文件：同上
- 要点：新增棱镜（玻璃×3→×2）、电浆激发器、钛化玻璃、平面滤波器、粒子宽带、卡西米尔晶体；为晶格硅/粒子容器/光子合并器补 DSP 常规配方（现仅有稀有矿配方 `recipe.go:285-311`）。

### A3. 增产剂 Mk.I/II/III 生产配方（P0）
- 文件：`internal/model/recipe.go`、`internal/model/tech.go:521/903/1126`
- 要点：物品与喷涂消耗侧已闭环，补 Mk.I=煤×2、Mk.II=Mk.I×2+金刚石、Mk.III=Mk.II×2+碳纳米管三条配方，消除悬空解锁（依赖 A1 金刚石）。

### A4. 引力透镜 + 空间曲率器配方（P1）
- 文件：`internal/model/item.go`、`internal/model/recipe.go`、`internal/model/tech.go:1235/1329`
- 要点：透镜（金刚石×4+奇异物质）→曲率器配方；曲率器物品已被运输船消耗（`logistics_ship.go:30`）但无产出（依赖 A1 金刚石）。

### A5. 弹药升级链（P0/P1）
- 文件：`internal/model/item.go`、`internal/model/recipe.go`、`internal/model/tech.go:368/387-396/780/920-929/1144-1153/1212-1248`
- 要点：燃烧单元→爆破单元→晶石爆破单元三级中间品，炮弹组/高爆/晶石炮弹组、超音速导弹组、钛化/超级合金弹药箱、干扰/压制胶囊，逐条消除悬空科技解锁。

### A6. 推进器链（P1）
- 文件：`internal/model/item.go`、`internal/model/recipe.go`、`internal/model/tech.go:881-890`
- 要点：推进器（钢+铜）与强化推进器（钛合金+电磁涡轮）（依赖 A1）。

### A7. 戴森球组件（P2）
- 文件：`internal/model/item.go`、`internal/model/recipe.go:371-380`
- 要点：新增组件物品并把火箭配方改为经组件（框架材料+太阳帆+处理器→组件→火箭）。

---

## 批次 B：能源闭环

### B1. 地热电站运行时（P0，当前唯一纯装饰建筑）
- 文件：`internal/model/building_runtime.go`（补 Energy 模块）、`internal/model/power/types.go`（补 PowerSourceGeothermal）、`internal/gamecore/power_generation.go`、`internal/mapgen`（岩浆口/岩浆行星耦合）
- 要点：为 geothermal_power_station 注册 EnergyModule+电源种类，建于岩浆口持续发电，接入 settlePowerGeneration。

### B2. 蓄电器物品充放循环（P1）
- 文件：`internal/model/item.go`、`internal/model/building_runtime.go:1086-1142`、`internal/gamecore/energy_storage_settlement.go`、`internal/model/building_defs.go:489`
- 要点：新增空/满蓄电器物品，能量枢纽加充/放/待机模式与物品 IO；处理 accumulator_full 死条目（转为物品态或删除建筑条目）（依赖 A1 超级磁环/晶格硅作配方原料）。

### B3. 聚变电站烧氘棒（P1，单行级修改）
- 文件：`internal/model/building_runtime.go:1230-1232`
- 要点：FuelRules 由氢燃料棒改/加氘燃料棒，盘活闲置氘棒配方。

### B4. 火电多燃料+热值折算（P2）
- 文件：`internal/model/building_runtime.go:1196-1198`
- 要点：利用已支持的多 FuelRules+OutputMultiplier 机制，给火电配煤/石墨/氢/燃料棒多规则。

### B5. 太阳能昼夜/潮汐锁定（P2）
- 文件：`internal/mapmodel/environment.go`、`internal/gamecore/power_generation.go:91-100`
- 要点：TidalLocked/DayLengthHours 字段接入 tick 级输出调制。

---

## 批次 C：科研与科技效果接线

### C1. 矿脉利用（Veins Utilization）可重复科技（P0）
- 文件：`internal/model/tech.go`（新 effect 类型）、`internal/gamecore/rules.go:1218-1274` mineResource
- 要点：每级 +采矿速度/-矿脉消耗，是白糖最重要的重复消耗出口。

### C2. 三个死效果科技接线（P1）
- 文件：`internal/model/logistics_drone.go:20`（drone_engine→速度）、`internal/model/solar_sail_orbit.go:35`（solar_sail_life→寿命）、`internal/visibility/visibility.go:191-197`+`internal/model/entity.go:150`（universe_exploration→视野）
- 要点：为 TechEffectValue("drone_speed"/"solar_sail_life"/"exploration_range") 补消费点。

### C3. TechUnlockUnit 门控（P1）
- 文件：`internal/gamecore/logistics_vehicle_commands.go:36-64`、`internal/model/tech.go:1716-1721`
- 要点：无人机/运输船部署命令补科技校验；修复 "engine" 解锁被白名单丢弃。

### C4. 并行战斗科技系统接线或删除（P1）
- 文件：`internal/gamecore/combat_tech_settlement.go`、`internal/model/combat_tech.go`
- 要点：整套 CombatTechManager 零调用；要么接命令入口+tick 结算，要么删除死代码。

### C5. 研究站体验（P1）
- 文件：`internal/model/command.go`、`internal/gamecore/construction.go:609`、`internal/gamecore/research.go:407`
- 要点：新增 set_recipe 命令（研究/生产模式原地切换）；可重复科技成本随等级递增。

### C6. 研究站堆叠 / vertical_construction 实效（P1）
- 文件：`internal/model/tech.go:1157-1168`、`internal/gamecore/construction.go`
- 要点：研究站垂直叠层共享库存/吞吐，科技逐级解锁层数。

### C7. dyson_stress 效果（P2）
- 文件：`internal/gamecore/dyson_sphere_settlement.go:12,177`
- 要点：应力参数按科技等级替代全局默认。

### C8. 哈希层+喷涂矩阵研究加成（P2）
- 文件：`internal/gamecore/research.go:486-552`
- 要点：矩阵→哈希→进度两层模型，喷涂矩阵给哈希加成。

### C9. research_speed 多级化（P2）
- 文件：`internal/model/tech.go:1626-1634`
- 要点：单次 +10% 改为可重复多级。

---

## 批次 D：机甲

### D1. 死亡重生（P0，死亡即永久失去建造能力）
- 文件：`internal/gamecore/rules.go:564-568`、`internal/gamecore/executor.go:28-35`、`internal/model/command.go`
- 要点：新增 respawn/rebuild_mecha 命令与资源代价，消除 executor 删除后永久失败。

### D2. 飞行（P0）
- 文件：`internal/model/command.go`、`internal/gamecore/rules.go:408-468`、`internal/terrain/terrain.go`、`internal/model/mecha.go`
- 要点：fly 状态/命令，跨越水面与障碍、高耗能，驱动引擎科技分级解锁。

### D3. 建造无人机（P1，依赖 C2 的 drone_engine 接线）
- 文件：`internal/gamecore/construction.go:302-449`、`internal/model/mecha.go`
- 要点：建造队列改为无人机实体飞出施工，数量/速度吃 drone_engine 等级。

### D4. 燃料仓细化（P1）
- 文件：`internal/gamecore/mecha.go:39-101`
- 要点：多格燃料仓、按燃料区分燃烧功率、允许空仓再加注。

### D5. 机甲 HP 修复（P2）
- 文件：`internal/gamecore/mecha.go`（参考 `war_sustainment.go:274-345` 小队修理）

### D6. 冲刺 sprint（P2）
- 文件：`internal/gamecore/rules.go` 移动结算、`internal/model/mecha.go`

---

## 批次 E：防御与黑雾

### E1. 高斯机枪塔弹药闭环（P0，小改动）
- 文件：`internal/model/building_runtime.go:1367-1378`
- 要点：补 AmmoItem/AmmoConsume+弹药 IOPort，接入现有 consumeTurretAmmunition（依赖 A5 仅升级弹药，基础 ammo_bullet 已有）。

### E2. 战利品回收闭环（P0，连带解锁链断裂）
- 文件：`internal/gamecore/combat_settlement.go:107-120`、`internal/gamecore/turret_settlement.go:128-132`、`internal/model/item.go`
- 要点：掉落物实体化/入库+机甲或基站拾取；打通 dark_fog_matrix 掉落→隐藏科技（`tech.go:1648-1660`）→自演化研究站的断链。

### E3. 建筑修理（P0）
- 文件：`internal/gamecore/war_sustainment.go` 扩展、战场分析基地 Deployment 模块
- 要点：基站自动修理范围内受损建筑/炮塔（当前全仓库无建筑 HP 恢复机制）。

### E4. 黑雾地面基地实体（P1）
- 文件：`internal/model/enemy_force.go:28-45`、`internal/gamecore/enemy_force_settlement.go:114-160`
- 要点：行星表面可攻击的基地建筑（HP/出兵），摧毁后停袭并掉残骸；并解决非活动行星无黑雾。

### E5. 信号塔修复（P1，伪 implemented）
- 文件：`internal/model/building_runtime.go`（补 SignalTower 条目+耗电）、`internal/gamecore/enemy_force_settlement.go:316-353`
- 要点：补 runtime 定义使断电失效；修复 TargetPlayer 永不赋值导致的重定向死代码，实现 DSP 式嘲讽吸火。

### E6. 行星护盾覆盖范围（P1）
- 文件：`internal/gamecore/planetary_shield_settlement.go:73-99`
- 要点：按半径保护，全球覆盖需多台组网。

### E7. 侵袭波次真实化（P1）
- 文件：`internal/gamecore/enemy_force_settlement.go:202-313`
- 要点：敌军朝目标移动、从位置发起攻击、攻击消耗 Strength 使波次衰减（当前目标取"距图中心最近建筑"）。

### E8. 机甲对黑雾地面武器（P2）
- 文件：`internal/gamecore/rules.go` attack 路径扩展（依赖 D 批机甲完善度）

---

## 批次 F：采集深化

### F1. 刺笋结晶 + 金伯利矿石（P0）
- 文件：`internal/mapmodel/resource.go`、`internal/model/item.go`、`internal/mapgen/resource.go:17-61`、`internal/gamecore/rules.go:1690-1700`
- 要点：两种稀有矿进枚举/物品/生成调色板/采集映射，为碳纳米管与金刚石提供稀有矿路径（A 批常规配方不依赖本项）。

### F2. 矿机覆盖脉数机制（P1，最大玩法差距）
- 文件：`internal/gamecore/rules.go:1218-1232`、`internal/model/building_runtime.go:666-700`
- 要点：矿机按覆盖范围内 ClusterID 脉数决定产量，大矿机大范围多脉同采（ClusterID 已生成未消费）。

### F3. 行星植被采集（P1）
- 文件：`internal/model/item.go`（wood/plant_fuel）、`internal/mapgen`、`internal/gamecore/mecha_jobs.go`
- 要点：地表植被实体+机甲采集木材/植物燃料。

### F4. 冰巨星变体与采集系数（P2）
- 文件：`internal/mapmodel/astro.go:28-32`、`internal/gamecore/orbital_collector_settlement.go`
- 要点：星球级采集系数字段，冰巨星产可燃冰+氢。

### F5. 矿脉扫描/迷雾探明（P2）
- 文件：`internal/visibility`、`internal/query` 图层（依赖 C2 universe_exploration 接线）

### F6. 采集边角（P2）
- 文件：`internal/gamecore/rules.go:1259-1270`、`internal/mapgen/resource.go:149-150`
- 要点：抽水机水源地形约束；油井闲置衰减语义对齐。

---

## 批次 G：物流 / 地形 / 边缘玩法

### G1. 集装机/集装分拣器 DSP 行为（P2）
- 文件：`internal/gamecore/conveyor_settlement.go`、`internal/gamecore/sorter_settlement.go:85-97`
- 要点：piler 主动压缩成 2x/4x 堆；pile_sorter 整堆抓放而非逐件。

### G2. 弹射器/发射井自动连续发射（P2）
- 文件：`internal/gamecore/rules.go:1853-2025`、`internal/gamecore/rocket_launch.go:10`、`internal/model/building_runtime.go:1451-1489`
- 要点：消费已定义但无人读取的 LaunchInterval/EnergyPerLaunch，装料后自动按间隔发射。

### G3. 储液罐接入管线网络（P2）
- 文件：`internal/gamecore/pipeline_io_settlement.go:38-48`、`internal/model/building_runtime.go:866-876`
- 要点：储液罐 IOPort 补流体 AllowedItems 使其成为管线节点。

### G4. 沙土体系+地基物品（P2）
- 文件：`internal/model/item.go`（soil/地基物品）、`internal/gamecore/construction.go:620-624`
- 要点：地形改造产/耗沙土，地基物品配方（石砖+钢材，依赖 A1 钢材）。

### G5. 射线接收器引力透镜增益+预热爬坡（P2，依赖 A4）
- 文件：`internal/gamecore/ray_receiver_settlement.go`

### G6. 轨道采集器建造校验补齐（P2）
- 文件：`internal/model/building_defs.go:130-137`、`internal/gamecore/rules.go:135-142`
- 要点：建筑定义补星球类型约束声明，避免普通行星空转无提示。

### G7. 分拣器堆叠/运输船载量升级科技（P2，依赖 C 批科技效果框架）
- 文件：`internal/model/tech.go`、`internal/gamecore/sorter_settlement.go`、`internal/model/logistics_ship.go`

### G8. 干扰塔完整化（P2）
- 文件：`internal/gamecore/enemy_force_settlement.go:361-397`
- 要点：干扰效果扩展到拦截/致盲维度。

---

## 建议实现顺序与依赖关系

```
A0(门控修复) ─┬─> A1~A7(配方物品) ─┬─> B2(蓄电器物品, 需A1磁环/硅)
              │                    ├─> A4 ──> G5(透镜增益)
              │                    ├─> A5 ──> E1(高斯弹药用基础弹已有, 升级链需A5)
              │                    └─> A1 ──> A6/G4(地基物品需钢材)
              └─> C 批全部(新科技/配方生效前提)
B1(地热) 独立, 可与 A 并行
C2(drone_engine接线) ──> D3(建造无人机)
C2(universe_exploration) ──> F5(矿物扫描)
C1(矿脉利用) ──消费者在 rules.go, 与 F2 协调改动同一函数
D1/D2 独立; D 批 ──> E8(机甲对黑雾)
E2(战利品) ──> 打通 dark_fog_matrix ──> 自演化研究站解锁(研究批的断链在此修复)
F1(稀有矿) 独立, 为 A 配方提供稀有路径但不阻塞
G 批全部依赖 A/C 完成后穿插进行
```

**关键路径**：A0 → A1~A3 → C1~C3 → D1/D2 → E1~E3。
**快速见效项**（改动小、可先行合入）：A0 门控修复、B3 聚变氘棒、E1 高斯弹药、G6 轨道采集器校验。
**并行性**：A（纯数据表）与 B1（地热）互不冲突；E4/E7（黑雾重写）与 F2（矿机覆盖）改动不同文件，可并行；G 批各项彼此独立，适合作为穿插小提交。