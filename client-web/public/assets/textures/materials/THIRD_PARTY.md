# 工业材质贴图（第 23 轮 3A 画质）

`client-web/public/assets/textures/materials/` 下的全部 webp 来自 **ambientCG**，
授权均为 **CC0 1.0（Creative Commons Zero）**：可商用、可修改、无需署名（本文件即来源记录）。

| 文件组 | 原素材 | 来源 | 用途 |
| --- | --- | --- | --- |
| `painted_metal-*` | Paint004 | https://ambientcg.com/view?id=Paint004 | 白色涂装金属面板（陶瓷族，己方主装甲） |
| `brushed_metal-*` | Metal010 | https://ambientcg.com/view?id=Metal010 | 拉丝钛（结构件、支架、炮管） |
| `plate_metal-*` | MetalPlates001 | https://ambientcg.com/view?id=MetalPlates001 | 铆接钢板（底座、机架、暗部；1 格 1 块板） |
| `diamond_plate-*` | DiamondPlate004 | https://ambientcg.com/view?id=DiamondPlate004 | 花纹钢板（地基、踏板、平台） |
| `rubber-*` | Rubber001 | https://ambientcg.com/view?id=Rubber001 | 橡胶（传送带带面、轮子） |
| `plastic-*` | Plastic013A | https://ambientcg.com/view?id=Plastic013A | 哑光塑料（线槽、按钮座、非金属小件） |

## 改动

原始素材是 1K JPG（albedo / roughness / metalness / AO / normalGL）。转换脚本做的事：

1. albedo 原样转 webp（质量 88，1K）；
2. roughness / metalness / AO 打包成一张 ORM webp：`R = AO`（没有 AO 的素材填白）、
   `G = roughness`、`B = metalness`，线性色彩空间；
3. 法线用 NormalGL 原图转 webp（线性色彩空间）；
4. 不做放大、不做色彩调整——阵营色由 `three/industrial-materials.ts` 的 `uTriTint`
   （目标色 / albedo 均值）在着色器里乘上去，贴图本身保持中性。

## 体积

18 个文件、合计约 **2.7 MB**（预算：材质纹理 ≤ 15 MB）。三平面映射按对象空间采样，
纹素密度 1 格 = 1 次重复，与几何 UV 无关。
