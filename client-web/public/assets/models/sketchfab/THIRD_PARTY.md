# Sketchfab 3D 模型（CC BY 4.0）

`client-web/public/assets/models/sketchfab/` 下的 GLB 来自 Sketchfab，全部为
**CC BY 4.0**（Creative Commons Attribution 4.0）：可商用、可修改，**必须署名**。
客户端「鸣谢」弹窗（顶栏 → 设置 → 鸣谢）读 `public/assets/credits.json`，数据由
`node develop_tools/three_assets/credits.mjs` 从 `develop_tools/sketchfab/selection.json`
与下载时的许可记录生成；本文件是同一份署名的仓库内副本。

## 改动说明（全部模型）

规整管线见 `develop_tools/sketchfab/normalize.mjs`，统一做了：

- 去相机 / 灯光 / 空节点 / 特效面片（尾焰、烟雾、排气）；
- 剥蒙皮（烘进静止姿态）、合并材质、按位置减面到预算（英雄 40k / 单位 12k / 建筑炮塔 20k）；
- 贴图缩到 1K（executor 2K 档）、**去饱和到 35%**、按均值拉到中灰、转 webp；
- 坐标统一（Y 上、底面落 Y=0、水平居中、最长边 1），炮塔另把炮管转到 +Z 并拆出 `turret-barrel`；
- `EXT_meshopt_compression` 压缩；运行期按阵营重上色（底色乘阵营主色、发光件换阵营发光色）。

个别模型另有旋转对齐（见下表「附加改动」）。

## 逐个署名

| 用途（服务端类型） | 标题 | 作者 | 模型页 | 附加改动 |
| --- | --- | --- | --- | --- |
| `accumulator` | Sci-Fi Batteries | [DanielCardonaArt](https://sketchfab.com/DanielCardonaArt) | https://sketchfab.com/3d-models/sci-fi-batteries-88a6ae64f3874c57aa5d008ed1d1c5d9 | |
| `airfield` | Airfield base | [rakshaan](https://sketchfab.com/rakshaan) | https://sketchfab.com/3d-models/airfield-base-f77e37ea3db44ff5afdc92a1554c1e71 | |
| `anti_air_turret` | AA turret | [kirikom9000](https://sketchfab.com/kirikom9000) | https://sketchfab.com/3d-models/aa-turret-a2c5ebb07a6b434f88880f31522e07b6 | 绕 Y 180°（炮管朝 +Z） |
| `artificial_star` | Sci-Fi Reactor Core | [yewonkim0621](https://sketchfab.com/yewonkim0621) | https://sketchfab.com/3d-models/sci-fi-reactor-core-a996292bc068406590b4ddd045f7bd19 | |
| `artillery` | Death Crawler Tank | [Herrsher](https://sketchfab.com/Herrsher) | https://sketchfab.com/3d-models/death-crawler-tank-26a0ef2d8b8b4b8ca4dc9a2bd27ea810 | |
| `attack_drone` | K07 Drone | [klaus5](https://sketchfab.com/klaus5) | https://sketchfab.com/3d-models/k07-drone-ca849f95d9874d58a19324eec223ccdf | |
| `cargo_ship` | SPACESHIP - CARGO | [Keremz](https://sketchfab.com/Keremz) | https://sketchfab.com/3d-models/spaceship-cargo-e9faa887c3684271b67be00649e11dcf | |
| `dark_fog` | Free - Biomechanical Mutant | [Game-Ready](https://sketchfab.com/Game-Ready) | https://sketchfab.com/3d-models/free-biomechanical-mutant-bdb9c9cfcf9c4a5eafec9f58b170bf98 | |
| `executor` | XR-88 Mecha | [rafadurand](https://sketchfab.com/rafadurand) | https://sketchfab.com/3d-models/xr-88-mecha-94cbf12e92c4490ba2ea5739221e7252 | |
| `gauss_turret` | Sci-fi Turret 3 | [everlastinggrey](https://sketchfab.com/everlastinggrey) | https://sketchfab.com/3d-models/sci-fi-turret-3-28fb90b851b5454589f5170b08c8c66d | 绕 Y 90°（炮管朝 +Z） |
| `laser_turret` | Mounted Laser Cannon | [cosmiccobra](https://sketchfab.com/cosmiccobra) | https://sketchfab.com/3d-models/mounted-laser-cannon-93a6929ad9ee45bd977637fcfde5abbd | |
| `mecha` | Markhor Heavy Gunner | [jw202471](https://sketchfab.com/jw202471) | https://sketchfab.com/3d-models/markhor-heavy-gunner-c4465bbc0aaf4eb19b8da339cf5b8969 | 绕 Y 90°（正面朝 +Z） |
| `missile_turret` | WEAPONS: MISSILE TURRET | [Nayo3D](https://sketchfab.com/Nayo3D) | https://sketchfab.com/3d-models/weapons-missile-turret-c5504e5ca6d742008eda50e9bfd942f4 | |
| `missile_vehicle` | Shaanxi SX2190 Missile Launcher | [MirzaArrafiERV_45](https://sketchfab.com/MirzaArrafiERV_45) | https://sketchfab.com/3d-models/shaanxi-sx2190-missile-launcher-a3cb343f3bf8486c8a0482df5b753c38 | 绕 Y 90°（正面朝 +Z） |
| `oil_extractor` | Oil Pumpjack - Animated | [felhamard](https://sketchfab.com/felhamard) | https://sketchfab.com/3d-models/oil-pumpjack-animated-7c5fdd845bf54d3e80d954bd4b08c5b5 | |
| `oil_refinery` | Rare Earth Element Refinery | [novusod](https://sketchfab.com/novusod) | https://sketchfab.com/3d-models/rare-earth-element-refinery-41fc8f48094f4e74ae5cf9c1e915dead | |
| `plasma_turret` / `sr_plasma_turret` | Heavy Turbolaser Cannon V3 | [ademis](https://sketchfab.com/ademis) | https://sketchfab.com/3d-models/heavy-turbolaser-cannon-v3-9818bd406a9b499395ac51ec47a0aeca | 绕 Y -90°（炮管朝 +Z） |
| `ray_receiver` | Satellite Dish | [JordieLitt](https://sketchfab.com/JordieLitt) | https://sketchfab.com/3d-models/satellite-dish-3d1668dc014e4ff3b5205773b7940e71 | |
| `repair_vehicle` | 1955 Sci-Fi \| Africa Tow Truck | [dougitougi123](https://sketchfab.com/dougitougi123) | https://sketchfab.com/3d-models/1955-sci-fi-africa-tow-truck-a96241f8fbcf400d92eb7ea4aaaa37c6 | 绕 Y 180°（正面朝 +Z） |
| `scout` | Hoverbike | [Nixak](https://sketchfab.com/Nixak) | https://sketchfab.com/3d-models/hoverbike-74ee92cf4d224af4bacfb234b41d6708 | |
| `ship` | Futuristic Cargo Drone | [johndarrenmagturo](https://sketchfab.com/johndarrenmagturo) | https://sketchfab.com/3d-models/futuristic-cargo-drone-00ae2c7c273448338d84b45fc35d3f9c | |
| `soldier` | Robo-soldier | [efforya](https://sketchfab.com/efforya) | https://sketchfab.com/3d-models/robo-soldier-e5ce9b92325d45d6b75799716a28844e | |
| `storage_tank` | Black vertical storage tank | [Gertol](https://sketchfab.com/Gertol) | https://sketchfab.com/3d-models/black-vertical-storage-tank-a9d52429810644fbafdd435b7f698bd1 | |
| `supply_truck` | Military Truck 1/2 Ton | [andrewswihart](https://sketchfab.com/andrewswihart) | https://sketchfab.com/3d-models/military-truck-12-ton-5d19c751b12849eeb390d637b2b686a1 | 绕 Y 180°（正面朝 +Z） |
| `tesla_tower` | Tesla Coil | [pretendlabs](https://sketchfab.com/pretendlabs) | https://sketchfab.com/3d-models/tesla-coil-ebf82bbb494e43388fee954d8359011e | |
| `thermal_power_plant` | SCIFI GENERATOR | [LordCinn](https://sketchfab.com/LordCinn) | https://sketchfab.com/3d-models/scifi-generator-bf2e1a087adb4628a376ffbed17c41ff | |
| `vehicle_factory` | Vehicle_Factory | [rakshaan](https://sketchfab.com/rakshaan) | https://sketchfab.com/3d-models/vehicle-factory-62c4768df1334909a3d206dcf610ea7e | |
| `vertical_launching_silo` | Low Poly Space Launch Station | [anais.fernandez](https://sketchfab.com/anais.fernandez) | https://sketchfab.com/3d-models/low-poly-space-launch-station-cbe59336373c40f98fb1695359928395 | |
| `worker` | Worker ROBOT | [NickBorovik](https://sketchfab.com/NickBorovik) | https://sketchfab.com/3d-models/worker-robot-c6f928098b0d417e80cdde71231d328d | |

## 没采用的槽位

`battlefield_analysis_base`、`matrix_lab`、`mining_machine`、`em_rail_ejector`、`barracks`
下载过候选模型但观感不达标（俯视读不出功能 / 规整后只剩一根线），保持程序化或 Kenney 模型，
产物不提交；候选仍留在 `develop_tools/sketchfab/raw/`（gitignore）。

## 许可全文

https://creativecommons.org/licenses/by/4.0/legalcode
