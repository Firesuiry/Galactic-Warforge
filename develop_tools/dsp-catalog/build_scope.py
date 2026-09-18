#!/usr/bin/env python3
"""从 DSP 权威数据源生成本项目对齐目录。

输入（source/）:
- factoriolab-data.json  : factoriolab/factoriolab public/data/dsp/data.json (DSP 0.10.29.21950)
- factoriolab-zh.json    : 同仓库 i18n/zh.json（中文名）
- dspwiki-techinfo.json  : www.dsp-wiki.com TechInfo 模板抓取（每科技 Hashes=total hash needed）
- ../mapping_overrides.json : 人工裁定别名与政策

输出（当前目录）:
- scope.json     : 行星内范围闭包（物品/配方/科技/机器/种子资源）
- mapping.json   : DSP id -> SW id 映射 + 未匹配清单
- tech_costs.json: tech_id -> {hashes, costs:[{item, qty}], hashes_estimated}

用法: python3 build_scope.py
"""
import json, os, re, math
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")

data = json.load(open(os.path.join(SRC, "factoriolab-data.json")))
zh = json.load(open(os.path.join(SRC, "factoriolab-zh.json")))
wiki = json.load(open(os.path.join(SRC, "dspwiki-techinfo.json")))
overrides = json.load(open(os.path.join(HERE, "mapping_overrides.json")))

ZHI, ZHR = zh["items"], zh["recipes"]
ITEMS = {i["id"]: i for i in data["items"]}
RECIPES = data["recipes"]
DSP_EN = {i["id"]: i["name"] for i in data["items"]}

SPACE_MACHINES = {"orbital-collector", "ray-receiver", "ray-receiver-pro"}
EXTRACTORS = {"mining-machine", "advanced-mining-machine", "oil-extractor", "water-pump"}
ALL_PRODUCERS = sorted({p for r in RECIPES for p in r.get("producers") or []})
IN_PLANET_MACHINES = [m for m in ALL_PRODUCERS if m not in SPACE_MACHINES]


def zh_name(rid):
    v = ZHI.get(rid)
    if isinstance(v, str):
        return v
    return (v or {}).get("name")


def compute_closure():
    seeds = set()
    for r in RECIPES:
        if set(r.get("producers") or []) & EXTRACTORS:
            seeds |= set(r.get("out", {}).keys())
    seeds |= {"log", "plant-fuel"}  # 机甲采集
    reached = set(seeds)
    changed = True
    while changed:
        changed = False
        for r in RECIPES:
            ps = set(r.get("producers") or [])
            if not ps or not (ps & set(IN_PLANET_MACHINES)):
                continue
            ins = set(r.get("in", {}).keys())
            outs = set(r.get("out", {}).keys())
            if ins <= reached and not outs <= reached:
                reached |= outs
                changed = True
    return seeds, reached


def norm_en(n):
    return re.sub(r"[^a-z0-9]+", "", (n or "").lower())


# ----- 科技总成本：wiki Hashes 优先，缺失则按同矩阵族已知哈希中位数估计 -----
WIKI_HASH = {}
for title, f in wiki.items():
    name = f.get("Name")
    if name and f.get("Hashes"):
        try:
            WIKI_HASH[norm_en(name)] = int(f["Hashes"])
        except ValueError:
            pass

# DSP 数据集英文名与 wiki 页面名不一致的人工对齐
TECH_NAME_FIX = {
    "basic-assembling-processes": "Basic Assembling Processes",
    "high-speed-assembling-processes": "High-Speed Assembling Processes",
    "environment-modification": "Environment Modification",
    "improved-logistics-system": "Improved Logistics System",
}

TECH_RECIPE_BY_ID = {r["id"]: r for r in RECIPES if "technology" in (r.get("flags") or [])}


def family_base(tid):
    m = re.match(r"^(.*)-(\d+)$", tid)
    return m.group(1) if m else None


def tech_totals(rec):
    """返回 (hashes, costs{item:qty}, estimated)。

    游戏引擎口径（见 UXAssist 反编译引用）：total_items = ItemPoints * hashes / 3600。
    hashes 优先取 dsp-wiki TechInfo 实测值；缺失时估计。"""
    ins = rec.get("in", {}) or {}
    tid = rec["id"]
    dsp_name = TECH_NAME_FIX.get(tid) or DSP_EN.get(tid) or ""

    lvless_name = re.sub(r"\s*\(Lv\d+\)\s*$", "", dsp_name)
    h = WIKI_HASH.get(norm_en(lvless_name))
    est = h is None
    if h is None:
        # 多级升级：去掉 (LvN) 匹配家族等级1的 wiki 哈希，再按 ItemPoints 比例缩放
        base = family_base(tid)
        if base:
            base_name = TECH_NAME_FIX.get(base) or DSP_EN.get(base) or ""
            base_h = WIKI_HASH.get(norm_en(re.sub(r"\s*\(Lv\d+\)\s*$", "", base_name)))
            base_pts = sum((TECH_RECIPE_BY_ID.get(base, {}).get("in") or {}).values())
            cur_pts = sum(ins.values())
            if base_h and base_pts:
                h = max(1, round(base_h * cur_pts / base_pts))
                est = False
    if h is None:
        # 设计校准表（非 DSP 实测）：按最高输入矩阵档位给基准 hash，按等级缩放
        # 锚点：tier0/tier1 取 wiki 实测中位数（1800/9000），更高档按游戏节奏递增
        tier_of = {
            "universe-matrix": 6, "gravity-matrix": 5, "information-matrix": 4,
            "structure-matrix": 3, "energy-matrix": 2, "electromagnetic-matrix": 1,
        }
        TIER_HASH = {0: 1800, 1: 5400, 2: 9000, 3: 18000, 4: 27000, 5: 36000, 6: 72000}
        my_tier = max([tier_of.get(k, 0) for k in ins] or [0])
        base = family_base(tid)
        lvl = 1
        if base:
            lvl = int(re.match(r"^(.*)-(\d+)$", tid).group(2))
        h = int(TIER_HASH.get(my_tier, 1800) * (1 + 0.6 * (lvl - 1)))
    costs = {k: max(1, math.ceil(v * h / 3600)) for k, v in ins.items()}
    return h, costs, est


def main():
    seeds, reached = compute_closure()

    scope = {
        "meta": {
            "source": "factoriolab/factoriolab public/data/dsp",
            "dsp_version": data["version"]["DSP"],
            "definition": "行星内闭包：种子=采掘/抽取+机甲采集；机器排除轨道采集器/射线接收站系",
        },
        "machines": {m: {"zh": zh_name(m)} for m in IN_PLANET_MACHINES},
        "resources": sorted(seeds),
        "items": {},
        "recipes": {},
        "techs": {},
        "tech_costs": {},
    }

    for i in data["items"]:
        if i["category"] == "effects":
            continue
        rid = i["id"]
        scope["items"][rid] = {
            "cat": i["category"], "zh": zh_name(rid), "en": i["name"],
            "stack": i.get("stack"), "inPlanet": rid in reached,
        }
        if i.get("technology"):
            t = i["technology"]
            scope["techs"][rid] = {
                "zh": zh_name(rid), "en": i["name"], "cat": i["category"],
                "prereq": t.get("prerequisites", []),
                "unlocks": t.get("recipeUnlock", []),
            }

    for r in RECIPES:
        ps = r.get("producers") or []
        if not ps:
            continue
        rid = r["id"]
        ins = r.get("in", {}) or {}
        entry = {
            "cat": r["category"], "zh": ZHR.get(rid) if isinstance(ZHR.get(rid), str) else zh_name(rid),
            "time_s": r.get("time"), "in": ins, "out": r.get("out", {}) or {}, "machines": ps,
            "locked": "locked" in (r.get("flags") or []),
            "is_tech": "technology" in (r.get("flags") or []),
            "mining": "mining" in (r.get("flags") or []),
        }
        ok_machines = bool(set(ps) & set(IN_PLANET_MACHINES))
        if entry["is_tech"]:
            entry["inPlanet"] = True  # 科技本体不进物品闭包判断，用 researchable
            entry["researchable"] = set(ins) <= reached
            h, costs, est = tech_totals(r)
            scope["tech_costs"][rid] = {
                "hashes": h, "estimated": est,
                "costs": costs, "researchable": entry["researchable"],
            }
        else:
            entry["inPlanet"] = ok_machines and set(ins) <= reached
        scope["recipes"][rid] = entry

    json.dump(scope, open(os.path.join(HERE, "scope.json"), "w"), ensure_ascii=False, indent=1)

    # ----- 与当前 SW 目录对比（由 catalogdump 生成 current_dump.json 时） -----
    cur_path = os.path.join(HERE, "current_dump.json")
    mapping = {"mapping": defaultdict(list), "unmatched": defaultdict(list)}
    if os.path.exists(cur_path):
        sw = json.load(open(cur_path))
        sw_items = {i["id"]: i for i in sw["items"]}
        sw_techs = {t["id"]: t for t in sw["techs"]}
        sw_bld = {b["id"]: b for b in sw["buildings"]}
        sw_res = set(sw["resource_kinds"])
        swi_en = defaultdict(list)
        for i in sw["items"]:
            swi_en[norm_en(i.get("name"))].append(i["id"])
        swb_en = defaultdict(list)
        for b in sw["buildings"]:
            swb_en[norm_en(b.get("name"))].append(b["id"])
        swt_zh = defaultdict(list)
        swt_en = defaultdict(list)
        for t in sw["techs"]:
            swt_zh[(t.get("name") or "").strip()].append(t["id"])
            swt_en[norm_en(t.get("name_en") or "")].append(t["id"])

        alias_i = overrides["item_aliases"]
        alias_r = overrides.get("resource_aliases", {})
        alias_t = overrides.get("tech_aliases", {})

        def snake(s):
            return s.replace("-", "_")

        for did, it in scope["items"].items():
            if not it["inPlanet"] or it["cat"] in ("technologies", "upgrades", "buildings", "buildings-alt"):
                continue
            cand = [alias_i.get(did), snake(did)]
            hit = next((c for c in cand if c and c in sw_items), None)
            enk = norm_en(it["en"])
            if not hit and enk in swi_en:
                hit = swi_en[enk][0]
            (mapping["mapping"]["items"] if hit else mapping["unmatched"]["items"]).append(
                {did: hit} if hit else did)

        for did, b in scope["items"].items():
            if b["cat"] not in ("buildings", "buildings-alt") or not b["inPlanet"]:
                continue
            cands = [snake(did)]
            if did == "df-plasma-turret-sr":
                cands.append("sr_plasma_turret")
            if did == "sorter-4":
                cands.append("pile_sorter")
            hit = next((c for c in cands if c and c in sw_bld), None)
            enk = norm_en(b["en"])
            if not hit and enk in swb_en:
                hit = swb_en[enk][0]
            (mapping["mapping"]["buildings"] if hit else mapping["unmatched"]["buildings"]).append(
                {did: hit} if hit else did)

        for tid, t in scope["techs"].items():
            cands = [alias_t.get(tid), snake(tid)]
            hit = next((c for c in cands if c and c in sw_techs), None)
            if not hit:
                # DSP 展开多级升级 -> SW MaxLevel 聚合: xxx-3 -> xxx maxlevel>=3
                m = re.match(r"^(.*)-(\d+)$", tid)
                if m:
                    base = snake(m.group(1))
                    if base in sw_techs:
                        maxlv = next((st.get("max_level") for st in sw["techs"] if st["id"] == base), None)
                        hit = base if (maxlv is None or maxlv < 0 or maxlv >= int(m.group(2))) else None
            if not hit and t["zh"] in swt_zh:
                hit = swt_zh[t["zh"]][0]
            if not hit:
                enk = norm_en(t["en"])
                if enk in swt_en:
                    hit = swt_en[enk][0]
            key_hit = mapping["mapping"]["techs"]
            key_un = mapping["unmatched"]["techs"]
            (key_hit if hit else key_un).append({tid: hit} if hit else tid)

        for rid in scope["resources"]:
            cands = [alias_r.get(rid), snake(rid), snake(rid) + "_ore"]
            hit = next((c for c in cands if c and c in sw_res), None)
            (mapping["mapping"]["resources"] if hit else mapping["unmatched"]["resources"]).append(
                {rid: hit} if hit else rid)

        mapping["mapping"] = {k: v for k, v in mapping["mapping"].items()}
        mapping["unmatched"] = {k: v for k, v in mapping["unmatched"].items()}
        json.dump(mapping, open(os.path.join(HERE, "mapping.json"), "w"), ensure_ascii=False, indent=1)
    else:
        print("hint: 生成 current_dump.json 以获得映射对比: server 下 `go run ./cmd/catalogdump -out .../current_dump.json`")

    n_ip = sum(1 for v in scope["items"].values() if v["inPlanet"])
    n_prod = sum(1 for v in scope["recipes"].values() if v["inPlanet"] and not v["is_tech"])
    n_rt = sum(1 for v in scope["recipes"].values() if v["is_tech"] and v["researchable"])
    n_est = sum(1 for v in scope["tech_costs"].values() if v["estimated"])
    print(f"scope.json: inPlanet items={n_ip}, production recipes={n_prod}, tech nodes={len(scope['techs'])}, researchable={n_rt}, hash-estimated techs={n_est}")
    if mapping["unmatched"]:
        print("unmatched:", {k: len(v) for k, v in mapping["unmatched"].items()})


if __name__ == "__main__":
    main()
