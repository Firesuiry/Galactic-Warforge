# 扫描岩石（地表装饰，3A 画质地表分支）

来源 [Poly Haven](https://polyhaven.com/)，许可 **CC0**（无需署名；此处记录来源）。

| 文件 | Poly Haven 资产 | 作者 | 来源 URL | 改动 |
| --- | --- | --- | --- | --- |
| `boulder_a.*` | rock_09 | Jenelle van Heerden | https://polyhaven.com/a/rock_09 | 减面到 1799 三角（原 12416），归一化到高 1、底面 y=0；贴图 512² webp |
| `boulder_b.*` | rock_07 | Jenelle van Heerden | https://polyhaven.com/a/rock_07 | 减面到 1799 三角（原 14844），同上 |
| `boulder_c.*` | moon_rock_01 | Greg Zaal / Rico Cilliers（摄影）、Jenelle van Heerden / Dario Barresi（处理） | https://polyhaven.com/a/moon_rock_01 | 取 LOD0，减面到 1798 三角（原 9958），同上 |

`.bin` 是自定义紧凑格式（不是 GLB）：`uint32 头长 + JSON 头 + uint32 索引数 + uint32 索引 + float32 顶点（pos3, normal3, uv2）`，
由 `client-web/src/features/planet-map/three/rock-meshes.ts` 解析。纹理：`*_albedo.webp`（sRGB），
`*_packed.webp`（R/G = 法线 xy，B = 粗糙度）。
