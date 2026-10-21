# 第三方 3D 素材

`client-web/public/assets/models/` 下的 GLB 全部来自 Kenney 的免费素材包，授权均为
**CC0 1.0（Creative Commons Zero）**：可商用、可修改、无需署名（本文件即署名记录）。
贴图随包提供（`city/Textures/colormap.png`，按 GLB 内的相对路径引用）。

| 目录 | 素材包 | 版本 | 来源 | 授权 |
| --- | --- | --- | --- | --- |
| `city/` | City Kit (Industrial) | 2.0 | https://kenney.nl/assets/city-kit-industrial | CC0 1.0 |
| `space/` | Space Kit | 2.0 | https://kenney.nl/assets/space-kit | CC0 1.0 |

原始 `License.txt` 随各自的包保留在 `city/License.txt`、`space/License.txt`。

## 使用范围

只保留当前 `three/industrial-gltf.ts` 映射表实际引用的模型；未引用的模型不提交，
避免把整个素材包（约 5 MB / 190 个文件）塞进前端产物。新增映射时按需从原包拷入即可。

## 不做的事

不引用《戴森球计划》或任何其他商业游戏的模型/贴图；不使用来源不明的社区 rip。
