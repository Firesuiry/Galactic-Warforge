# 第三方 VFX 素材

`client-web/public/assets/vfx/` 下的粒子序列帧图集**不是第三方素材**：由仓库内的
`scripts/gen-vfx-atlas.mjs` 离线程序生成（固定种子的哈希噪声 + 极简 PNG 编码），
与客户端渲染共用同一套噪声乘子。可自由使用，无需署名。

| 文件 | 生成方式 | 尺寸 | 授权 |
| --- | --- | --- | --- |
| `particles.png` | `node scripts/gen-vfx-atlas.mjs` | 512×512（4×4 帧 × 128px） | 本项目自产（程序生成） |

重新生成（输出字节确定，同一脚本任意机器一致）：

```bash
node scripts/gen-vfx-atlas.mjs            # 写 client-web/public/assets/vfx/particles.png
node scripts/gen-vfx-atlas.mjs /tmp/x.png # 写别处（比对用）
```

如需替换为 Kenney Particle Pack（CC0），保持同样的 4×4 网格与「行 = 类型、列 = 帧序」布局即可，
并在此处补充来源 URL、作者与授权。
