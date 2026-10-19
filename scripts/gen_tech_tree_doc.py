#!/usr/bin/env python3
"""生成 docs/guide/科技树与建造前置.md（科技树 + 所有建筑的解锁/放置/运行前置）。

数据源（全部权威，不手抄）：
  - `go run ./cmd/catalogdump` 导出的服务端目录（items/recipes/techs/buildings/runtimes）
  - server/data/units.yaml      单位生产建筑与造价
  - server/data/war.yaml        战争蓝图可见性科技

判定口径与代码对齐：
  - 建筑解锁：gamecore.CanBuildTech —— 任一已完成科技在 unlocks 里声明了该建筑即解锁；
  - 配方解锁：gamecore.CanUseRecipeTech —— 无任何科技门控 = 基础配方；有门控则任一完成即可；
  - 开局预完成科技：model.DefaultCompletedTechs（dyson_sphere_program）；
  - 隐藏科技：model.AllTechDefinitions 派生后的 Hidden（无公开价值且无可见后继，或被标记 hidden）。

用法：
  python3 scripts/gen_tech_tree_doc.py          # 重写文档
  python3 scripts/gen_tech_tree_doc.py --check  # 文档过期则非零退出
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/guide/科技树与建造前置.md"
GO_FALLBACKS = [
    "/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin/go",
    "/home/firesuiry/sdk/go1.25.0/bin/go",
]

# 开局预完成科技（model.DefaultCompletedTechs）。
INITIAL_TECHS = {"dyson_sphere_program"}

# 科技 special 解锁的展示名（代码里有对应逻辑，见 model.knownSpecialUnlocks）。
SPECIAL_NAMES = {
    "dyson_component": "戴森球组件建造",
    "satellite_power": "卫星配电",
    "vertical_construction": "垂直堆叠",
    "dyson_stress": "戴森球应力",
    "ionosphere_utilization": "电离层利用",
    "photon_mode": "射线接收站光子模式",
    "warp_drive": "曲速飞行",
    "game_win": "任务完成胜利",
    "blueprint_prototype": "原型机蓝图",
    "blueprint_corvette": "护卫舰蓝图",
    "blueprint_destroyer": "驱逐舰蓝图",
}

# 建筑放置/运行前置里需要逐条说明的特殊建筑（与 gamecore/build_commands.go、
# model/resource.go、model/logistics_distributor.go 的校验一一对应）。
PLACEMENT_SPECIAL = {
    "water_pump": "必须压在 `water` 或 `sulfuric_acid` 资源节点上（占地+外圈覆盖）",
    "oil_extractor": "必须压在 `crude_oil` 资源节点上",
    "orbital_collector": "只能建在**气态巨行星**上（planet.Kind == gas_giant）",
    "geothermal_power_station": "占地必须压在熔岩上或紧邻熔岩",
    "logistics_distributor": "必须叠在己方 `depot_mk1`/`depot_mk2` 上（z=1），一个仓库只能装一台",
    "foundation": "可铺在水面/熔岩等不可建地形上，铺完该格变为可建",
    "conveyor_belt_mk1": "可架高到 1–4 层；高架带必须有明确输出方向",
    "conveyor_belt_mk2": "可架高到 1–4 层；高架带必须有明确输出方向",
    "conveyor_belt_mk3": "可架高到 1–4 层；高架带必须有明确输出方向",
    "battlefield_analysis_base": "建造中心：半径 72 cell 内可直接建造（否则要机甲在作业范围内）",
}

# 科技栏（TechPage 的 lane 顺序）。
LANE_ORDER = ["main", "energy", "smelting", "chemical", "logistics", "mecha", "combat", "dyson"]
LANE_LABELS = {
    "main": "主线",
    "energy": "能源",
    "smelting": "冶金",
    "chemical": "化工",
    "logistics": "物流",
    "mecha": "机甲",
    "combat": "军事",
    "dyson": "戴森球",
}
CATEGORY_LABELS = {"main": "主线", "branch": "分支", "bonus": "可重复（加成）"}


def find_go() -> str:
    go = shutil.which("go")
    if go:
        return go
    for cand in GO_FALLBACKS:
        if os.path.exists(cand):
            return cand
    raise SystemExit("gen_tech_tree_doc: 找不到 go，可执行文件需在 PATH 中")


def load_catalog() -> dict:
    env = dict(os.environ)
    env.setdefault("GOCACHE", "/tmp/gw-go-cache")
    env.setdefault("GOTOOLCHAIN", "local")
    out = subprocess.run(
        [find_go(), "run", "./cmd/catalogdump"],
        cwd=ROOT / "server",
        env=env,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def load_yaml(rel: str) -> dict:
    return yaml.safe_load((ROOT / "server" / rel).read_text(encoding="utf-8"))


def fmt_items(amounts, item_names) -> str:
    if not amounts:
        return "—"
    return "、".join(f"{item_names.get(a['item_id'], a['item_id'])}×{a['quantity']}" for a in amounts)


def cell(text: str) -> str:
    """表格单元格转义（竖线会破表）。"""
    return str(text).replace("|", "\\|").replace("\n", " ")


class Doc:
    def __init__(self, catalog: dict):
        # catalogdump 从 map 导出，条目顺序不稳定；这里统一按 id 排序，保证文档可复现。
        catalog = {
            key: sorted(
                value,
                key=lambda entry: entry["id"] if isinstance(entry, dict) else str(entry),
            )
            for key, value in catalog.items()
        }
        self.catalog = catalog
        self.items = {i["id"]: i for i in catalog["items"]}
        self.item_names = {i["id"]: i["name"] for i in catalog["items"]}
        self.recipes = {r["id"]: r for r in catalog["recipes"]}
        self.techs = {t["id"]: t for t in catalog["techs"]}
        self.buildings = {b["id"]: b for b in catalog["buildings"]}
        self.runtimes = {r["id"]: r for r in catalog["building_runtimes"]}
        self.units = {u["id"]: u for u in load_yaml("data/units.yaml")["units"]}
        self.war = load_yaml("data/war.yaml")
        techs_yaml = load_yaml("data/techs.yaml")
        self.explicit_hidden = {
            t["id"] for t in techs_yaml["techs"] if t.get("hidden")
        }
        self.pending_recipe_unlocks = techs_yaml.get("pending_recipe_unlocks") or {}
        self.visible_techs = [t for t in catalog["techs"] if not t.get("hidden")]
        self.hidden_techs = [t for t in catalog["techs"] if t.get("hidden")]

        self.building_techs: dict[str, list[str]] = {}
        self.recipe_techs: dict[str, list[str]] = {}
        self.unit_techs: dict[str, list[str]] = {}
        self.special_techs: dict[str, list[str]] = {}
        for tech in catalog["techs"]:
            for unlock in tech.get("unlocks") or []:
                bucket = {
                    "building": self.building_techs,
                    "recipe": self.recipe_techs,
                    "unit": self.unit_techs,
                    "special": self.special_techs,
                }.get(unlock["type"])
                if bucket is not None:
                    bucket.setdefault(unlock["id"], []).append(tech["id"])
        for bucket in (self.building_techs, self.recipe_techs, self.unit_techs, self.special_techs):
            for ids in bucket.values():
                ids.sort()

    # ---- 名称解析 ----
    def recipe_gate_techs(self, recipe_id: str) -> list[str]:
        """配方门控科技：配方自身 tech_unlock 与科技侧 TechUnlockRecipe 的并集（对齐 CanUseRecipeTech）。"""
        gates = set(self.recipes.get(recipe_id, {}).get("tech_unlock") or [])
        gates.update(self.recipe_techs.get(recipe_id, []))
        return sorted(gates)

    def item_gate_techs(self, item_id: str) -> list[str]:
        """物品的生产门控：所有产出它的配方的门控并集；没有任何配方 = 空（非生产来源）。"""
        gates: set[str] = set()
        for recipe in self.catalog["recipes"]:
            if any(out["item_id"] == item_id for out in recipe.get("outputs") or []):
                gates.update(self.recipe_gate_techs(recipe["id"]))
        return sorted(gates)

    def longest_chain(self, target_id: str) -> list[str]:
        """返回到 target 的最长前置链（含 target 自身），用于展示主线主干。"""
        memo: dict[str, list[str]] = {}

        def resolve(tech_id: str) -> list[str]:
            if tech_id in memo:
                return memo[tech_id]
            tech = self.techs.get(tech_id) or {}
            prereqs = [p for p in tech.get("prerequisites") or [] if p in self.techs]
            if not prereqs:
                memo[tech_id] = [tech_id]
            else:
                best = max((resolve(p) for p in prereqs), key=len)
                memo[tech_id] = [*best, tech_id]
            return memo[tech_id]

        return resolve(target_id)

    def tech_name(self, tech_id: str) -> str:
        tech = self.techs.get(tech_id)
        return tech["name"] if tech else tech_id

    def unlock_label(self, unlock: dict) -> str:
        kind, uid = unlock["type"], unlock["id"]
        if kind == "building":
            return self.buildings.get(uid, {}).get("name", uid)
        if kind == "recipe":
            return f"配方·{self.recipes.get(uid, {}).get('name', uid)}"
        if kind == "unit":
            return f"单位·{self.units.get(uid, {}).get('name', uid)}"
        return SPECIAL_NAMES.get(uid, uid)

    # ---- 建筑条件 ----
    def building_conditions(self, b: dict) -> list[str]:
        bid = b["id"]
        rt = self.runtimes.get(bid, {})
        funcs = rt.get("functions") or {}
        conds: list[str] = []
        if bid in PLACEMENT_SPECIAL:
            conds.append(PLACEMENT_SPECIAL[bid])
        if b.get("requires_resource_node") and bid not in PLACEMENT_SPECIAL:
            collect = funcs.get("collect") or {}
            allowed = collect.get("allowed_resources") or []
            names = "、".join(self.item_names.get(a, a) for a in allowed)
            rings = collect.get("coverage_radius")
            area = f"占地+外扩 {rings} 格" if rings else "占地+外扩 1 格"
            conds.append(f"{area}内必须有可采矿脉（{names}）；落成时定死开采矿种（覆盖框内数量最多的那种）")
        if funcs.get("energy", {}).get("consume_per_tick"):
            conds.append(f"需供电（{funcs['energy']['consume_per_tick']} 电/tick）")
        if funcs.get("energy", {}).get("output_per_tick"):
            conds.append(f"发电 {funcs['energy']['output_per_tick']} 电/tick（需接电网）")
        if funcs.get("research"):
            conds.append(f"研究模式：需通电、只收矩阵（{funcs['research']['research_per_tick']} 点/tick）")
        if funcs.get("combat"):
            ammo = funcs["combat"].get("ammo_item")
            conds.append(f"战斗建筑：射程 {funcs['combat'].get('range')}，需{'供弹 ' + self.item_names.get(ammo, ammo) if ammo else '供电'}")
        if funcs.get("launch"):
            launch = funcs["launch"]
            rocket = launch.get("rocket_item_id")
            if rocket:
                conds.append(f"发射建筑：需装填 {self.item_names.get(rocket, rocket)}")
            else:
                allowed = []
                for port in rt.get("params", {}).get("io_ports") or []:
                    allowed.extend(port.get("allowed_items") or [])
                names = "、".join(self.item_names.get(a, a) for a in allowed)
                conds.append(f"发射建筑：需装填 {names}" if names else "发射建筑")
            if launch.get("launch_interval"):
                conds.append(f"发射间隔 {launch['launch_interval']} tick，成功率 {launch.get('success_rate')}")
        if funcs.get("shield"):
            conds.append("护盾发生器：需供电")
        if funcs.get("ray_receiver"):
            conds.append("射线接收：需太阳帆/戴森球供能，`photon` 模式另需 `dirac_inversion`")
        if funcs.get("collect") and bid not in PLACEMENT_SPECIAL and not b.get("requires_resource_node"):
            conds.append("采集建筑")
        if b.get("can_produce_units"):
            produced = [u for u in self.units.values() if u.get("producer") == bid and u.get("public")]
            if produced:
                conds.append("可生产单位：" + "、".join(u["name"] for u in produced))
        if b.get("default_recipe_id"):
            conds.append(f"默认配方：{self.recipes.get(b['default_recipe_id'], {}).get('name', b['default_recipe_id'])}")
        if funcs.get("production") or funcs.get("research"):
            if bid != "logistics_distributor":
                conds.append("可垂直叠层（需 `vertical_construction`，层数=1+已完成级数）")
        return conds

    # ---- 渲染 ----
    def render(self) -> str:
        out: list[str] = []
        add = out.append
        add("# 科技树与建造前置")
        add("")
        add("> 本文由 `python3 scripts/gen_tech_tree_doc.py` 从服务端权威目录（`cmd/catalogdump` +")
        add("> `server/data/*.yaml`）生成，**不要手改**；改数据后重跑脚本。")
        add("")
        add("## 1. 判定规则（代码口径）")
        add("")
        add("| 规则 | 语义 | 代码 |")
        add("| --- | --- | --- |")
        add("| 建筑解锁 | 玩家**已完成**的任一科技在 `unlocks` 里声明了该建筑即可建（any，不是 every） | `gamecore.CanBuildTech` |")
        add("| 配方解锁 | 配方无任何科技门控 = 基础配方开局可用；有门控则任一已完成即可用 | `gamecore.CanUseRecipeTech` |")
        add("| 研究前置 | 科技的 `prerequisites` **全部**完成才能开始研究 | `model.PlayerTechState.HasPrerequisites` |")
        add("| 开局预完成 | `dyson_sphere_program`（开局即视为已完成，1 级） | `model.DefaultCompletedTechs` |")
        add("| 研究站 | 开始研究需至少 1 台**运行中**的研究站（`matrix_lab`/`self_evolution_lab`，未设配方） | `gamecore.runningResearchLabs` |")
        add("| 研究耗材 | 矩阵物品必须装在研究站里（不是背包），按 `research_per_tick` 消耗；多站并行 | `gamecore.researchThroughput` |")
        add("| 研究成本 | 目录成本 × 本局 `pace_research`（四舍五入、下限 1）；可重复科技按 `cost_per_level` | `model.ScaledResearchCost` |")
        add("| 隐藏科技 | 无公开价值且无可见后继的科技自动隐藏；`hidden: true` 需先持有触发物品才可研究 | `model.ensureTechCatalogDerived` / `gamecore.hiddenTechDiscovered` |")
        add("| 建造范围 | 任一己方 `build_radius>0` 建筑半径内，或机甲 `operate_range` 内；否则需 `auto_approach` 派机甲走过去 | `gamecore.requireBuildRange` |")
        add("| 建造扣料 | 下单即从**机甲背包**校验并预留全部造价（不是从仓库扣）；仓库要先用 `transfer`/皮带/机器人送进背包 | `gamecore.reserveConstructionMaterials` |")
        add("| 拆除退款 | 可建造建筑默认允许拆除，返还 50% 造价（`demolish.refund_rate`）；基地 HQ 不可拆，拆地基恢复原地形，仓库要先卸配送器 | `model.BuildingDemolishRuleFor` / `gamecore.execDemolish` |")
        add("| 建造并发 | 玩家 `executor.concurrent_tasks`（默认 2）+ 每 8×8 区域 `construction_region_concurrent_limit`（默认 4，`mass_construction` 每级 +1）；超限只是排队 | `gamecore.constructionRegionLimitFor` |")
        add("| 围死校验 | 建造不能把任何地面单位关进无出口的连通区（会拒绝并回执单位名/坐标） | `gamecore.buildingEnclosure` |")
        add("| 地形 | 占地每格必须可建（`foundation` 与熔岩上的地热站例外） | `gamecore.build_commands.go` |")
        add("| 垂直叠层 | 研究站/生产建筑可在同类型地面建筑上叠层，上限 = 1 + `vertical_construction` 已完成级数；共享底层库存 | `gamecore.resolveVerticalPlacement` |")
        add("| 高架传送带 | 只有 3 种传送带可架到 1–4 层，占 1 格，必须有明确方向 | `gamecore.build_commands.go` |")
        add("")
        add("> UI 入口：科技树页 `/tech` **只读**（看前置/成本/解锁与 `leads_to`）；真正下 `start_research`")
        add("> 在行星页的「研究与装料」卡片，研究站里装好矩阵后选科技开始。CLI 用 `start_research <tech_id>`。")
        add("")
        add("## 2. 开局即可用的内容")
        add("")
        start = self.techs.get("dyson_sphere_program", {})
        start_buildings = [u["id"] for u in start.get("unlocks") or [] if u["type"] == "building"]
        add("开局预完成科技 **戴森球计划**（`dyson_sphere_program`）解锁：")
        add("")
        for bid in start_buildings:
            add(f"- {self.buildings.get(bid, {}).get('name', bid)}（`{bid}`）")
        add("")
        add("开局可用配方（门控为空，或只被开局预完成科技门控）：")
        add("")
        add("| 配方 | 产出 | 建筑 | 可手搓 | 门控 |")
        add("| --- | --- | --- | --- | --- |")
        basic_rows = []
        for recipe in self.catalog["recipes"]:
            rid = recipe["id"]
            gates = self.recipe_gate_techs(rid)
            if gates and not set(gates) <= INITIAL_TECHS:
                continue
            basic_rows.append((recipe, gates))
        for recipe, gates in sorted(basic_rows, key=lambda row: row[0]["id"]):
            add(
                f"| {cell(recipe['name'])}（`{recipe['id']}`） | "
                f"{cell(fmt_items(recipe.get('outputs'), self.item_names))} | "
                f"{cell('、'.join(self.buildings.get(b, {}).get('name', b) for b in recipe.get('building_types') or []))} | "
                f"{'是' if recipe.get('handcraft_allowed') else '否'} | "
                f"{cell('、'.join(self.tech_name(t) for t in gates) + '（开局）' if gates else '无（基础配方）')} |"
            )
        add("")
        add("## 3. 科技树")
        add("")
        add(f"共 {len(self.catalog['techs'])} 条科技定义：可见 {len(self.visible_techs)} 条、隐藏 {len(self.hidden_techs)} 条。")
        add("等级（`level`）只是目录排序字段，真正的依赖看 `前置` 列；同一科技的所有前置都完成才能研究。")
        add("")
        add("### 3.0 主线主干（开局 → 任务完成的最长前置链）")
        add("")
        chain = self.longest_chain("mission_complete")
        add(" → ".join(self.tech_name(t) for t in chain))
        add("")
        add("这条链上任一科技完成前，它后面的全部科技都锁着；支线科技只是从这条链上分叉出去的节点。")
        add("")
        for lane in LANE_ORDER:
            lane_techs = [t for t in self.visible_techs if (t.get("type") or "main") == lane]
            if not lane_techs:
                continue
            add(f"### 3.{LANE_ORDER.index(lane) + 1} {LANE_LABELS[lane]}（{lane}，{len(lane_techs)} 条）")
            add("")
            add("| 科技 | 分类 | 等级 | 前置 | 成本 | 解锁 |")
            add("| --- | --- | --- | --- | --- | --- |")
            for tech in sorted(lane_techs, key=lambda t: (t.get("level") or 0, t["id"])):
                prereq = "、".join(self.tech_name(p) for p in tech.get("prerequisites") or []) or "无"
                cost = fmt_items(tech.get("cost"), self.item_names)
                if tech.get("max_level"):
                    cost += f"（可升 {tech['max_level']} 级，逐级 `cost_per_level`）"
                unlocks = "、".join(self.unlock_label(u) for u in tech.get("unlocks") or [])
                if tech.get("effects"):
                    effects = "、".join(f"{e['type']}+{e['value']}" for e in tech["effects"])
                    unlocks = f"{unlocks}；效果 {effects}" if unlocks else f"效果 {effects}"
                add(f"| {cell(tech['name'])}（`{tech['id']}`） | {CATEGORY_LABELS.get(tech.get('category') or '', tech.get('category') or '')} | {tech.get('level') or 0} | {cell(prereq)} | {cell(cost)} | {cell(unlocks or '—')} |")
            add("")
        add("### 3.9 隐藏科技")
        add("")
        add("隐藏科技不在 `/catalog` 的 `techs[]` 里下发（科技树页看不到），但仍可用 `start_research` 研究：")
        add("`hidden: true` 的科技要先**持有它的成本物品**才会显现（`gamecore.hiddenTechDiscovered`）。")
        add("")
        add("| 科技 | 隐藏方式 | 前置 | 成本 | 解锁 |")
        add("| --- | --- | --- | --- | --- |")
        for tech in sorted(self.hidden_techs, key=lambda t: t["id"]):
            prereq = "、".join(self.tech_name(p) for p in tech.get("prerequisites") or []) or "无"
            cost = fmt_items(tech.get("cost"), self.item_names)
            unlocks = "、".join(self.unlock_label(u) for u in tech.get("unlocks") or []) or "—"
            if tech["id"] in self.explicit_hidden:
                how = "yaml `hidden: true`，持有成本物品后显现"
            else:
                how = "派生隐藏：无公开解锁/效果且无可见后继"
                if any(u["type"] == "recipe" and u["id"] in self.pending_recipe_unlocks for u in tech.get("unlocks") or []):
                    how += "（唯一解锁是 `pending_recipe_unlocks` 里的未落地配方）"
            add(f"| {cell(tech['name'])}（`{tech['id']}`） | {cell(how)} | {cell(prereq)} | {cell(cost)} | {cell(unlocks)} |")
        add("")
        if self.pending_recipe_unlocks:
            add("尚未落地的配方解锁（`pending_recipe_unlocks`，加载时会从科技 `unlocks` 里剔除）：")
            add("")
            for rid, reason in sorted(self.pending_recipe_unlocks.items()):
                add(f"- `{rid}`：{reason}")
            add("")
        add("## 4. 全部可建造建筑的前置条件")
        add("")
        add("「解锁」列是**任一**完成即可的科技；「放置/运行」列是命令校验的硬条件。")
        add("")
        categories = [
            ("collect", "采集"),
            ("transport", "输送与分拣"),
            ("storage", "仓储"),
            ("refining", "冶炼与精炼"),
            ("production", "制造与军工"),
            ("chemical", "化工"),
            ("power", "发电"),
            ("power_grid", "电网"),
            ("research", "研究"),
            ("logistics_hub", "物流枢纽"),
            ("dyson", "戴森球"),
            ("command_signal", "指挥、防御与特殊"),
        ]
        for category, label in categories:
            rows = [b for b in self.catalog["buildings"] if b.get("category") == category and b.get("buildable")]
            if not rows:
                continue
            add(f"### 4.{categories.index((category, label)) + 1} {label}（{len(rows)}）")
            add("")
            add("| 建筑 | 解锁科技（任一） | 造价 | 占地 | 放置/运行条件 |")
            add("| --- | --- | --- | --- | --- |")
            for b in sorted(rows, key=lambda x: x["id"]):
                techs = self.building_techs.get(b["id"], [])
                unlock = "、".join(f"{self.tech_name(t)}" + ("（开局）" if t in INITIAL_TECHS else "") for t in techs) or "无（不可建）"
                cost = fmt_items((b.get("build_cost") or {}).get("items"), self.item_names)
                fp = b.get("footprint") or {}
                conds = self.building_conditions(b) or ["—"]
                add(f"| {cell(b['name'])}（`{b['id']}`） | {cell(unlock)} | {cell(cost)} | {fp.get('width')}×{fp.get('height')} | {cell('；'.join(conds))} |")
            add("")
        add("### 4.13 不可建造条目")
        add("")
        for b in self.catalog["buildings"]:
            if not b.get("buildable"):
                add(f"- {b['name']}（`{b['id']}`）：`buildable: false`，只能由运行时机制产生（如能量枢纽充放电）")
        add("")
        add("## 5. 单位、弹药与蓝图的前置")
        add("")
        add("### 5.1 世界单位生产")
        add("")
        add("| 单位 | 生产建筑 | 生产建筑解锁 | 造价 | 生产 tick |")
        add("| --- | --- | --- | --- | --- |")
        for unit in sorted(self.units.values(), key=lambda u: u["id"]):
            if not unit.get("public"):
                continue
            producer = unit.get("producer", "")
            producer_techs = self.building_techs.get(producer, [])
            add(
                f"| {cell(unit['name'])}（`{unit['id']}`） | {cell(self.buildings.get(producer, {}).get('name', producer))} | "
                f"{cell('、'.join(self.tech_name(t) for t in producer_techs) or '—')} | "
                f"{cell(fmt_items(unit.get('cost'), self.item_names))} | {unit.get('production_ticks')} |"
            )
        add("")
        add("单位生产还需：生产建筑已通电运行、自身库存里有造价物品、出生点有空位（堵住则排队等）。")
        add("")
        add("### 5.2 运输载具与战争蓝图")
        add("")
        drone_techs = self.unit_techs.get("logistics_drone", [])
        ship_techs = self.unit_techs.get("logistics_ship", [])
        add(f"- 物流无人机 `logistics_drone`：需 {' / '.join(self.tech_name(t) for t in drone_techs)}")
        add(f"- 星际运输船 `logistics_ship`：需 {' / '.join(self.tech_name(t) for t in ship_techs)}")
        for bp in self.war.get("public_blueprints") or []:
            add(f"- 蓝图 {bp['name']}（`{bp['id']}`）：需研究 {self.tech_name(bp['visible_tech_id'])}")
        add("")
        add("### 5.3 弹药与炮塔")
        add("")
        add("「可装弹药」取建筑 IO 口的 `allowed_items`（含升级弹种），「弹药解锁」是该弹药配方的科技门控。")
        add("")
        add("| 炮塔 | 解锁科技 | 可装弹药 | 弹药解锁 |")
        add("| --- | --- | --- | --- |")
        for b in self.catalog["buildings"]:
            rt = self.runtimes.get(b["id"], {})
            funcs = rt.get("functions") or {}
            combat = funcs.get("combat")
            if not combat:
                continue
            ammo_ids: list[str] = []
            for port in (rt.get("params") or {}).get("io_ports") or []:
                for item in port.get("allowed_items") or []:
                    if item not in ammo_ids:
                        ammo_ids.append(item)
            if not ammo_ids and combat.get("ammo_item"):
                ammo_ids = [combat["ammo_item"]]
            if not ammo_ids:
                ammo_cell = "（电力）"
                unlock_cell = "—"
            else:
                ammo_cell = "、".join(self.item_names.get(a, a) for a in ammo_ids)
                gate_cells = []
                for ammo in ammo_ids:
                    gates = self.item_gate_techs(ammo)
                    gate_cells.append(
                        f"{self.item_names.get(ammo, ammo)}："
                        + ("、".join(self.tech_name(t) for t in gates) or "基础配方")
                    )
                unlock_cell = "；".join(gate_cells)
            add(
                f"| {cell(b['name'])}（`{b['id']}`） | {cell('、'.join(self.tech_name(t) for t in self.building_techs.get(b['id'], [])))} | "
                f"{cell(ammo_cell)} | {cell(unlock_cell)} |"
            )
        add("")
        add("### 5.4 生产建筑可执行的配方")
        add("")
        add("配方只能在该建筑上跑（`building_types` 命中）；「配方科技」为空 = 基础配方。")
        add("")
        for b in sorted(self.catalog["buildings"], key=lambda x: x["id"]):
            if not b.get("buildable"):
                continue
            rt = self.runtimes.get(b["id"], {})
            if not (rt.get("functions") or {}).get("production"):
                continue
            recipes = [
                r for r in self.catalog["recipes"] if b["id"] in (r.get("building_types") or [])
            ]
            if not recipes:
                continue
            add(f"<details><summary>{b['name']}（`{b['id']}`）：{len(recipes)} 个配方</summary>")
            add("")
            add("| 配方 | 产出 | 配方科技 | 可手搓 |")
            add("| --- | --- | --- | --- |")
            for recipe in sorted(recipes, key=lambda r: r["id"]):
                gates = self.recipe_gate_techs(recipe["id"])
                add(
                    f"| {cell(recipe['name'])}（`{recipe['id']}`） | "
                    f"{cell(fmt_items(recipe.get('outputs'), self.item_names))} | "
                    f"{cell('、'.join(self.tech_name(t) for t in gates) or '无（基础）')} | "
                    f"{'是' if recipe.get('handcraft_allowed') else '否'} |"
                )
            add("")
            add("</details>")
            add("")
        add("## 6. 相关文档")
        add("")
        add("- [玩法指南](../player/玩法指南.md)：阶段 A–I 的开局到戴森球操作路径（含每种产线的搭法）。")
        add("- [数据配置文件](../dev/数据配置文件.md)：`techs.yaml` / `buildings.yaml` / `recipes.yaml` 的字段口径。")
        add("- [服务端 API](../dev/服务端API.md)：`/catalog` 下发的 `techs[].prerequisites`、`buildings[].unlock_tech`、`recipes[].tech_unlock` 字段。")
        add("- [缺失内容清单](缺失内容清单.md)：尚未落地的系统与已知缺口。")
        add("")
        add("## 7. 维护")
        add("")
        add("```bash")
        add("python3 scripts/gen_tech_tree_doc.py          # 重新生成本文")
        add("python3 scripts/gen_tech_tree_doc.py --check  # 文档与数据不一致则非零退出")
        add("```")
        add("")
        add("改动 `server/data/{techs,buildings,recipes,units,war}.yaml` 后必须重跑；脚本直接读")
        add("`cmd/catalogdump`（与 `GET /catalog` 同源）与 YAML，不手抄任何数值。")
        add("")
        return "\n".join(out).rstrip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成科技树与建造前置文档")
    parser.add_argument("--check", action="store_true", help="文档过期则非零退出")
    args = parser.parse_args(argv)

    text = Doc(load_catalog()).render()
    if args.check:
        current = DOC.read_text(encoding="utf-8") if DOC.exists() else ""
        if current != text:
            print(f"科技树文档过期，请运行 python3 scripts/gen_tech_tree_doc.py：{DOC.relative_to(ROOT)}", file=sys.stderr)
            return 1
        print("tech tree doc OK")
        return 0
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text(text, encoding="utf-8")
    print(f"wrote {DOC.relative_to(ROOT)} ({len(text.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
