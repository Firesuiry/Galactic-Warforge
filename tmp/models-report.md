# 现成 3D 模型（Kenney CC0）提升工业建筑与载具质感 —— 实现报告

分支 `feat/kenney-models`（worktree `/home/firesuiry/develop/siliconWorld/.worktrees/kenney-models`）。
范围：只补原来走通用兜底 `factory()` 的 19 个建筑 + 单位/飞船；已有专属程序化模型的 48 个建筑不动。

## 1. 结论摘要

- 19 个兜底建筑全部换成 Kenney City Kit (Industrial) / Space Kit 的 CC0 GLB，6 类单位（工兵、步兵、侦察车、
  攻击无人机、物流运输船、星图舰队标记）也换了。
- 同步 API 未破坏：`IndustrialModels.building()` / `unit()` 签名与调用方式不变，GLB 未加载完时照常返回程序化模型。
- 绘制调用**没有增加**：同一存档点同机位，静态批次从 58 降到 49、动态批次 9→8，总绘制调用
  overview 机位 350→310、兵营机位 320→282、补给站 221→198（明细见 §4）。
- 缩略图从 62 张补到 68 张（含此前完全缺失的 6 个）。

## 2. 模型映射表

### 建筑（`client-web/src/features/planet-map/three/industrial-gltf.ts` 的 `BUILDING_GLTF`）

| SW 建筑类型 | 占地 | Kenney 文件 | 来源包 | 说明 |
| --- | --- | --- | --- | --- |
| `assembling_machine_mk1` | 3×3 | `city/building-b.glb` | City Kit Industrial | 制造车间，屋顶有设备 |
| `assembling_machine_mk2` | 3×3 | `city/building-e.glb` | City Kit Industrial | 双烟囱车间 |
| `assembling_machine_mk3` | 3×3 | `city/building-d.glb` | City Kit Industrial | 多层塔式车间 |
| `recomposing_assembler` | 3×3 | `city/building-c.glb` | City Kit Industrial | 带外挂管线的车间 |
| `chemical_plant` | 3×3 | `city/building-l.glb` | City Kit Industrial | 带高烟囱化工厂 |
| `quantum_chemical_plant` | 3×3 | `city/building-m.glb` | City Kit Industrial | 多烟囱厂房 |
| `barracks` | 3×3 | `city/building-a.glb` | City Kit Industrial | 两层营房（换过一次，见 §6） |
| `supply_station` | 3×3 | `city/building-g.glb` | City Kit Industrial | 带屋顶设备的仓储楼 |
| `vehicle_factory` | 5×5 | `city/building-f.glb` | City Kit Industrial | 大厂房 + 烟囱 |
| `airfield` | 5×5 | `space/hangar_largeA.glb` | Space Kit | 大机库 |
| `ray_receiver` | 5×5 | `space/satelliteDish_large.glb` | Space Kit | 大型接收天线 |
| `em_rail_ejector` | 5×5 | `space/rocket_baseA.glb` | Space Kit | 火箭基座（发射轨道语义） |
| `jammer_tower` | 2×2 | `space/machine_wireless.glb` | Space Kit | 无线干扰设备 |
| `signal_tower` | 1×1 | `space/satelliteDish_detailed.glb` | Space Kit | 小型天线 |
| `orbital_collector` | 1×1 | `space/machine_generator.glb` | Space Kit | 小型收集器 |
| `planetary_shield_generator` | 5×5 | `space/structure_detailed.glb` | Space Kit | 桁架护盾结构 |
| `artificial_star` | 5×5 | `space/gate_complex.glb`（`scale: 1.15`） | Space Kit | 环形人造星结构 |
| `water_pump` | 3×3 | `city/water-tower.glb` | City Kit Industrial | 水塔 |
| `automatic_piler` | 1×1 | `space/barrels.glb` | Space Kit | 货桶堆（换过一次，见 §6） |

### 单位/飞船（`UNIT_GLTF`）

| SW 单位 | Kenney 文件 | 说明 |
| --- | --- | --- |
| `worker` | `space/astronautA.glb`（`scale: 0.8`） | 工程兵，浅色宇航服 |
| `soldier` | `space/astronautB.glb`（`scale: 0.8`）+ 程序化步枪 | 深色宇航服 + 端在身前的步枪，与工兵可区分 |
| `scout` | `space/rover.glb`（`scale: 1.05`） | 月球车式侦察车 |
| `attack_drone` | `space/craft_speederA.glb`（`scale: 1.5`） | 攻击无人机 |
| `ship` | `space/craft_cargoB.glb`（`scale: 1.6`） | 行星页物流无人机/运输船（场景里统一用 `'ship'` 渲染） |
| `cargo_ship` | `space/craft_cargoB.glb`（`scale: 1.4`） | 星图舰队标记 |

**保持程序化的**（有意不换，理由写进代码注释）：

- `logistics_bot` / `transport_robot`：场景按节点名 `logistics-bot-cargo` / `transport-robot-cargo`
  做载货显隐与逐单位上色，还依赖 `industrialRotation` 转子动画。
- `mecha` / `executor`：Kenney 两个包里**没有机甲**。评估过 Quaternius Ultimate Space Kit 的
  CC0 机甲（狐/蛙驾驶）与 poly.pizza 上的 CC-BY 机甲（Mechsuit / Sentinel / Mech Assault Walker），
  造型与「白陶瓷 + 蓝橙发光」的洁净工业风冲突，主代理也认可保持程序化。
- `artillery` / `missile_vehicle` / `repair_vehicle` / `supply_truck`：Kenney Car Kit 的车辆用彩色
  colormap，与本作阵营涂装冲突，且没有军用底盘。
- 48 个已有专属模型的建筑（研究站、矿机、熔炉、带子、分拣器、炮塔、发电、仓储、物流站等）全部不动。

## 3. 实现要点

1. **同步 API 不变**：`industrial-gltf.ts` 拆成「异步预加载」+「同步实例化」。
   `preloadIndustrialGltf()`（经 `IndustrialModels.preload()` 暴露，保证与 `building()/unit()` 用同一个模块实例）
   在场景构造后调用一次；加载完成 → `IndustrialModels.reloadTemplates()` + 场景 `reloadModels()` 重建实体。
   加载期间照常画程序化模型，不会出现空建筑。
2. **不污染共享材质**：模板阶段把 GLB 的材质**按阵营各克隆一份**（`prepare()` 里 `materials` 表保证
   同一源材质在一份模板里只克隆一次），实例之间共享这份阵营材质；`clone(true)` 只复制节点。
   Space Kit 的 `KHR_materials_unlit`（GLTFLoader 给 `MeshBasicMaterial`）在模板阶段转成
   `MeshStandardMaterial`，否则进场景没有明暗、像贴纸。
3. **尺寸**：建筑按包围盒等比缩进 `footprint * .86 * .86` 内（外圈是场景已有的地基/格内留缝口径），
   Y 底贴 0，高度不额外拉伸；5×5 的基站不会被放大成 25 格。单位按最长边归一化到 1 cell 的 0.62
   （现有程序化单位约 0.6×0.55），再乘每类 `scale` 微调。
4. **阵营涂装**：底色按阵营乘系数（己方 >1 提亮到白陶瓷、敌方偏暖橙、黑雾紫/暗红），
   再加一条正面窄发光条（`accentGeometry` + 每阵营一个共享材质）。
5. **性能**：几何/材质在实例间共享，`StaticBatches` 照常按 geometry+material 归并成 `InstancedMesh`；
   静态网格合并前统一属性集合（只留 position/normal/uv），否则 `mergeGeometries` 会失败。
6. **许可**：`client-web/public/assets/models/THIRD_PARTY.md` + 两个包原始 `License.txt`（CC0 1.0）。
   只提交映射表实际引用的 25 个 GLB（1.8 MB），不把整个素材包塞进产物。

## 4. 绘制调用 / 几何 / 三角面对比

同存档点（cp-army）、同机位、同一台机器，`--procedural` 走程序化回退、默认走 GLB。
数字来自场景新增的 `PlanetThreeScene.renderStats`（`renderer.info`，每帧 `reset()` 后统计整趟 composer）。

| 机位 | 绘制调用（程序化 → GLB） | 三角面（程序化 → GLB） | 静态批次 | 动态批次 |
| --- | --- | --- | --- | --- |
| `industry-overview` | 350 → **310**（−11%） | 594,690 → 533,690（−10%） | 58 → 49 | 9 → 8 |
| `assembling-machine` | 168 → **154**（−8%） | 525,220 → 494,824（−6%） | 58 → 49 | 9 → 8 |
| `barracks-squad` | 320 → **282**（−12%） | 571,778 → 514,402（−10%） | 58 → 49 | 9 → 8 |
| `supply-station` | 221 → **198**（−10%） | 534,526 → 496,076（−7%） | 58 → 49 | 9 → 8 |

静态实例数 232 → 214、动态实例 71 → 47：GLB 模型的零件数比程序化模型少，合批后批次也少。
**没有性能退化**，因此不需要「只对少数标志性建筑用 GLB」的降级方案。

帧耗时：本轮没有做整帧耗时基准（软件光栅化的数字不代表真机），只给了上面的绘制调用/三角面量级；
场景原有 `render-quality` 档位与合批路径未改。

## 5. 截图

固定机位 1200×1000，`scripts/playtest-shots/cp-army.mjs`（新增场景，已提交）。

- 真机前后对照：`tmp/models-before/`（程序化，`--procedural`）与 `tmp/models-after/`（GLB）
  - `industry-overview.png` —— 厂区全貌（装配台、兵营、补给站、基地同框）
  - `assembling-machine.png` / `@2x.png` —— 装配台特写
  - `barracks-squad.png` / `@2x.png` —— 兵营 + 10 个士兵（看士兵模型与步枪）
  - `supply-station.png` / `@2x.png` —— 补给站特写
- 逐模型成对画廊（正交固定机位，1 cell 棋盘做比例尺）：`tmp/models-gallery/`
  文件名 `<type>-before.png` / `<type>-after.png`，覆盖 19 个建筑 + 9 个单位类型。
  生成：`cd client-web && npx vite --port 4173`，然后
  `node develop_tools/three_assets/gallery.mjs <输出目录> --units`。
- 建造栏缩略图（重新生成，68 张）：`client-web/public/assets/buildings/*.png`。

## 6. 本轮返工记录（主代理提的三条）

1. **barracks / supply_station 太像灰盒子**：`barracks` 从 `building-s`（长条仓库）换成 `building-a`
   （两层营房、屋顶设备），`supply_station` 从 `building-p`（长条）换成 `building-g`（带屋顶设备的仓储楼）；
   同时把己方建筑底色系数从 1.34 提到 1.5（Kenney 墙体是中性灰，直接搬进场景比白陶瓷暗一档）。
2. **automatic_piler 的橙色集装箱**：橙色与敌方/警报语义冲突，换成 `space/barrels.glb`（货桶堆，白+黄，中性）。
3. **worker / soldier 区分度**：两个 astronaut 只差配色，远处确实分不清。给 `soldier` 挂了一把
   程序化步枪（枪身/枪管/弹匣三个方块，全场共用一份几何与材质，合批后只多 1 个绘制调用），
   端在身前、枪管伸出轮廓外。`unit-soldier-after.png` 里能看出与 `unit-worker-after.png` 的区别。

## 7. 测试

在 `client-web/` 下：

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过（exit 0） |
| `npm test`（= `vitest run`） | **Test Files 139 passed (139)，Tests 1204 passed (1204)**，13.70s |
| `npm run build` | 通过（exit 0，18.48s；`industrial-models` chunk 720 KB，构建警告仍是原有的 chunk 体积提示） |
| `npx vitest run src/features/planet-map/three/industrial-models.test.ts` | 3 passed |

服务端（改了 `building_defs.go` 常量）：

| 命令 | 结果 |
| --- | --- |
| `go build ./...` | 通过 |
| `go vet ./internal/model/ ./internal/gamecore/` | 通过 |
| `go test ./internal/model/ -count=1` | ok（1.434s） |

**没跑的**：`npx playwright test tests/planet-three.spec.ts`（本轮只改了模型来源与统计钩子，未改交互；
真机验收用固定机位截图做的）、`gamecore -short`、长测试组（归主代理合并前统一跑）。

## 8. 遗留问题（按严重度）

1. **`barracks` / `supply_station` 的辨识度仍偏弱**：现在换成两层营房 / 带屋顶设备的仓储楼，
   比长条灰盒子好，但和「兵营」「补给站」的语义关联还是靠体量，不像程序化模型那样有明确功能件。
   若要更强辨识度，需要给这两类各做 1 个专属附挂件（例如兵营门口旗杆、补给站顶棚吊钩）。
2. **机甲/火炮/导弹车/维修车/补给车仍是程序化方块**：Kenney 没有机甲素材，Car Kit 车辆与阵营涂装冲突。
   要提升只能引入 Quaternius/poly.pizza 的 CC-BY 素材（需署名、风格不统一）或自建模型。
3. **单位尺寸靠手工 `scale` 微调**：`worker/soldier 0.8`、`scout 1.05`、`drone 1.5`、`ship 1.6` 是按
   gallery 比例尺试出来的，没有自动「人形高 0.8 cell / 载具长 1.2 cell」的规则。换模型要重新调。
4. **`?procedural-models=1` 是调试开关**：为前后对照加在 `preloadIndustrialGltf()` 里，
   生产构建也会保留这个查询串分支（无副作用，但属于调试残留）。
5. **`water_pump` 的水塔比程序化模型高一截**（2.14 单位 vs 1.62），在密集厂区里略抢眼；
   已按占地归一化，但高度未额外压。若嫌高可在 spec 里给 `scale: 0.85`。
6. **缩略图与场景里 GLB 模型比例不完全一致**：`render.mjs` 用 `building(type, 1, 1, own)`（1×1 占地）出图，
   而场景里多格建筑按真实占地缩放，所以 5×5 建筑的缩略图看起来比场景里「瘦」。
   这是原有渲染脚本的口径（程序化模型同样如此），本轮未改。
