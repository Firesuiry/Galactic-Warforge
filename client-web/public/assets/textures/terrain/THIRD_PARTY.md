# 地表纹理（3A 画质地表分支）

全部来自 [ambientCG](https://ambientcg.com/)，许可 **CC0 1.0**（Public Domain，无需署名；此处仍记录来源）。
ambientCG 的资产由 Lennart Demes 制作并发布（站内统一署名为 ambientCG / Lennart Demes）。
均为 1K JPG 原图 → 1024² webp 重编码（albedo sRGB q86；packed q88）。
打包贴图通道：**R = 法线 x，G = 法线 y（OpenGL 约定），B = 粗糙度，A = 高度（AO 0.65 + 位移 0.35）**。

| 文件前缀 | ambientCG 资产 | 来源 URL | 用途 |
| --- | --- | --- | --- |
| `moss_grass_*` | Grass004 | https://ambientcg.com/view?id=Grass004 | 苔草（buildable 主色） |
| `grass_*` | Grass005 | https://ambientcg.com/view?id=Grass005 | 草地（buildable 次色） |
| `volcanic_soil_*` | Ground037 | https://ambientcg.com/view?id=Ground037 | 火山土（buildable 第三色，湿苔土） |
| `gravel_*` | Ground110 | https://ambientcg.com/view?id=Ground110 | 碎石 |
| `basalt_*` | Rock058 | https://ambientcg.com/view?id=Rock058 | 玄武岩（blocked） |
| `lichen_rock_*` | Rock063 | https://ambientcg.com/view?id=Rock063 | 带地衣岩石（blocked 混合） |
| `snow_*` | Snow010A | https://ambientcg.com/view?id=Snow010A | 雪（ice 星球） |
| `ice_*` | Ice001 | https://ambientcg.com/view?id=Ice001 | 蓝冰（ice 星球） |
| `sand_mud_*` | Ground054 | https://ambientcg.com/view?id=Ground054 | 岸边沙泥 |
| `mud_*` | Ground109 | https://ambientcg.com/view?id=Ground109 | 泥地（湿地混合） |
| `lava_*` | Lava004 | https://ambientcg.com/view?id=Lava004 | 岩浆冷却硬壳；`lava_emissive.webp` 为其 Emission 图 |
| `water_normal.webp` | Ice001（法线图派生） | https://ambientcg.com/view?id=Ice001 | 水面两层滚动法线（原法线 45% + 高斯模糊 55%，512²，非贴图内容原样） |

改动：仅裁切/缩放到 1024²、通道打包与 webp 压缩；未做内容修改。

