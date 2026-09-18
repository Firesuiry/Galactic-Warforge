# dsp-catalog — DSP 对齐数据工具链

把《戴森球计划》(DSP) 行星内生产/科技目录对齐到本游戏的数据管线与冻结基线。

## 目录

- `source/factoriolab-data.json` — factoriolab/factoriolab `public/data/dsp/data.json` 快照（DSP 版本 0.10.29.21950）
- `source/factoriolab-zh.json` — 同仓库 i18n 中文名
- `source/dspwiki-techinfo.json` — www.dsp-wiki.com 全量 TechInfo 模板抓取（108 页，含各科技 `Hashes`=总数据量与实测消耗）
- `mapping_overrides.json` — DSP→SW 人工裁定别名与政策表
- `build_scope.py` — 生成器（python3 直跑，无第三方依赖）
- `scope.json` — **冻结范围**：行星内闭包（物品 428、生产配方 171、科技节点 304/可研究 270、机器 19、种子资源 18）
- `tech_costs.json`（在 scope.json 的 `tech_costs` 节内）— 每科技 `hashes` + 总物品消耗（`estimated:true` 为校准估值）
- `mapping.json` — DSP id → SW id 映射表 + 未匹配清单（实现 TODO 的权威依据）
- `current_dump.json` — 服务端权威目录快照（由 `server/cmd/catalogdump` 生成）

## 用法

```bash
# 1. 更新服务端目录快照（在 server/ 下）
go run ./cmd/catalogdump -out ../develop_tools/dsp-catalog/current_dump.json
# 2. 重新计算闭包与映射
cd ../develop_tools/dsp-catalog && python3 build_scope.py
```

`unmatched` 非零即表示服务端目录尚未对齐；目标是 `items/buildings/resources/recipes/techs` 全部收敛（政策豁免除外：holo-beacon 不实现；building 合成配方并入 BuildCost.Items 不作为生产配方）。

## 关键口径

- **行星内可完成**：种子资源（18 种：12 矿脉 + 硫酸/有机晶体/刺笋/金伯利/木材/植物燃料 + 原油/水/可燃冰等）经行星内机器（排除轨道采集器、射线接收站系）闭包可达。
- **科技消耗**：游戏引擎公式 `总消耗 = ItemPoints × Hashes / 3600`（ItemPoints 见 factoriolab `in`，Hashes 优先取 dsp-wiki 实测，缺失按矩阵档位校准表估计并标 `estimated`）。
- **ID 规范**：DSP kebab-case → SW snake_case；差异项一律写进 `mapping_overrides.json` 别名，不允许在代码里写特判。
