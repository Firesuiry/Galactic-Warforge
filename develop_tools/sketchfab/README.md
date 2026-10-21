# develop_tools/sketchfab

3A 画质模型选型工具链：Sketchfab 搜索 → 候选联系表（PNG）→ 选定后下载 GLB + 许可记录。
只依赖 Python 3 标准库 + Pillow（`sheet.py` 用）。

## 用法

```bash
# 1. 搜全部槽位关键词（结果缓存在 /tmp/sketchfab-cache，重跑不重复请求）
python3 develop_tools/sketchfab/search.py --out tmp/3a-models/raw.json --count 24

# 只搜指定关键词
python3 develop_tools/sketchfab/search.py --out /tmp/x.json --q "sci-fi mech" --count 24

# 2. 候选 → 联系表 + candidates.json（槽位定义在 slots.py）
python3 develop_tools/sketchfab/sheet.py --raw tmp/3a-models/raw.json --out-dir tmp/3a-models
python3 develop_tools/sketchfab/sheet.py --only executor --only mecha   # 只重出某几个槽位

# 3. 选定后下载（需要 token；只接受 CC0 / CC-BY / CC-BY-SA，--allow-nc 才放 NC）
python3 develop_tools/sketchfab/fetch.py --from-candidates tmp/3a-models/candidates.json \
    --slot executor --idx 1 --dest client-web/public/assets/models/sketchfab
```

## 环境

- token：仓库根 `.env` 的 `SKETCHFAB_TOKEN=...`（gitignore），或同名环境变量。**不打印、不写进提交与报告。**
- 搜索接口不需要 token，只有下载需要。
- 网络特性：本机到 `api.sketchfab.com` / `media.sketchfab.com` 单次请求经常 1–200 s 才返回（服务端排队，
  与请求大小无关）。实测串行最差（每张图约 60 s），**高并发反而把尾延迟摊平**：搜索 24 并发、缩略图 120 并发，
  110 个搜索约 5 分钟、290 张缩略图约 5 分钟。响应写 `/tmp/sketchfab-cache/`，按 URL 哈希缓存，重跑免费。
- 下载（`fetch.py`）需要 token；本阶段只实现，未批量下载。

## 筛选口径

- `downloadable=true`；面数 ≤ 300k；
- 许可优先级 CC0 > CC-BY > CC-BY-SA；CC-BY-NC* 只在该槽位合格候选不足 8 个时补入，图上红框 + `NC` 角标；
- 名称/标签命中整栋场景、房间内景、玩具卡通风词表（`sheet.py` 的 `BAN_WORDS`）剔除；
  士兵/工兵槽以外的写实人形剔除；
- 同一槽位合并多个关键词结果去重，按 `log10(点赞+10)^2 × 相关度`（相关度 = 命中关键词数、名称/标签命中、
  staff pick）取前 8。
- 联系表：每槽 4×2，格子 300×225（API 缩略图取 ≥720 宽里最小的那张，contain 缩放），
  每格两行：`[编号] 名称 | 作者 | 许可 | 面数 | 是否带动画`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `sf.py` | API 封装：搜索（磁盘缓存 + 重试）、详情、下载、许可归一化 |
| `slots.py` | 47 个槽位（序号/槽位/用途/关键词）+ 3 组套装关键词 |
| `search.py` | 关键词 → 候选 JSON |
| `sheet.py` | 候选 → 联系表 PNG + `candidates.json` / `summary.json` |
| `fetch.py` | uid → GLB + `<uid>.license.json` + `THIRD_PARTY.md` 片段 |
