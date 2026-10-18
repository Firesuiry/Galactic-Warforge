# -*- coding: utf-8 -*-
"""把主代理定稿的 cp-belt-dsp 方案写成可执行构建记录
docs/guide/checkpoints/cp-belt-dsp.json。

用法：
  python3 gen.py --probe      # 只建到全部 running（探路，读新建筑 ID）
  python3 gen.py --configure  # 正式生成：用 ids.json 里实测的建筑 ID 回填 configure_sorter
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))  # develop_tools/checkpoint-gen/cp_belt_dsp → 仓库根
OUT = os.path.join(ROOT, "docs/guide/checkpoints/cp-belt-dsp.json")
IDS = os.path.join(HERE, "ids.json")
PLANET = "planet-1-1"
PROBE = "--probe" in sys.argv
WITH_CONFIGURE = "--configure" in sys.argv and not PROBE

IRON_BATCH = 30      # 第一次 item_growth 前补进 I_src 的铁锭
IRON_BATCH2 = 6      # 第二次：背包里只余 6 个铁锭（建材已用掉其余）
GROWTH_TICKS = 300
END_TICK = 14832      # 本层落档 tick（重建实测：最后一条 item_growth 结束在 14832）

STEPS = []

def add(step, note=None):
    if note:
        step = dict(step); step["note"] = note
    STEPS.append(step)

def cmd(c, note=None):
    add({"cmd": c}, note)

def move(x, y, note=None):
    cmd({"type": "move", "target": {"layer": "planet", "planet_id": PLANET,
                                    "entity_id": "u-40", "position": {"x": x, "y": y, "z": 0}}}, note)

def wait(check, timeout=600, note=None):
    add({"wait_until": check, "timeout_ticks": timeout}, note)

def wcount(btype, n, timeout=3600):
    wait({"kind": "building_count_gte", "player": "p1", "type": btype, "n": n}, timeout)

def transfer(bid, item, qty, direction="to_player", note=None):
    cmd({"type": "transfer_item", "target": {"layer": "planet", "planet_id": PLANET},
         "payload": {"building_id": bid, "item_id": item, "quantity": qty, "direction": direction}}, note)

def craft(recipe, qty, note=None):
    cmd({"type": "craft_item", "target": {"layer": "planet", "planet_id": PLANET, "entity_id": "u-40"},
         "payload": {"recipe_id": recipe, "quantity": qty}}, note)

def build(btype, x, y, direction="auto", rotation=None, elevation=None, note=None):
    payload = {"building_type": btype, "direction": direction}
    if rotation is not None:
        payload["rotation"] = rotation
    if elevation:
        payload["elevation"] = elevation
    cmd({"type": "build", "target": {"layer": "planet", "position": {"x": x, "y": y, "z": 0}},
         "payload": payload}, note)

def configure(bid, items, note=None):
    cmd({"type": "configure_sorter", "target": {"layer": "planet", "planet_id": PLANET, "entity_id": bid},
         "payload": {"filter_mode": "allow", "filter_items": items}}, note)

def item_growth(x, y, item, growth, ticks, elevation=None, note=None):
    g = {"position": {"x": x, "y": y, "z": 0}, "item_id": item, "growth": growth, "advance_ticks": ticks}
    if elevation:
        g["elevation"] = elevation
    add({"item_growth": g}, note)

# ---------------------------------------------------------------- 1. 到位 + 取料
move(50, 150, "机甲从 (49,134) 开到场景区旁 (50,150)：建造射程 18 格，场景区最远的 (58,152) 距离 10")
wait({"kind": "unit_near", "player": "p1", "type": "executor", "n": 1,
      "position": {"x": 50, "y": 150, "z": 0}, "radius": 2}, 900)

transfer("b-105", "iron_ingot", 51, note="料全部来自自家产线：取 b-105 铁补给站里的铁锭 51")
transfer("b-97", "copper_ingot", 30, note="取 b-97 铜补给站里的铜锭 30")
transfer("b-49", "iron_ore", 48, note="取 b-49 铁矿机输出缓冲里的铁矿 48（配合背包 16 手搓成锭）")
transfer("b-59", "copper_ore", 6, note="取 b-59 铜矿机里的铜矿 6（C_src 要放 6 铜矿）")

# ---------------------------------------------------------------- 2. 手搓
craft("smelt_iron", 64, "手搓铁矿→铁锭 64（背包 16 + 取来 48）")
wait({"kind": "item_gte", "player": "p1", "item_id": "iron_ingot", "n": 132}, 9000)

craft("gear", 6, "手搓齿轮 6（背包原有 13，本层建材共需 19 个）")
wait({"kind": "item_gte", "player": "p1", "item_id": "gear", "n": 19}, 1800)

craft("circuit_board", 13, "手搓电路板 13（4 补给站 ×2 + 5 分拣器 ×1）")
wait({"kind": "item_gte", "player": "p1", "item_id": "circuit_board", "n": 13}, 1800)

# ---------------------------------------------------------------- 3. 供电：电塔 + 2 风机
build("tesla_tower", 51, 151, note="电力感应塔 (51,151)：离现有电塔 b-57 (52,143) 曼哈顿 9 格（无线 12 格内），接上现有电网")
wcount("tesla_tower", 3)
build("wind_turbine", 47, 156, note="风机 W1 (47,156)：新增负载 13（5 分拣器 ×1 + 4 补给站 ×2），现有余量不够，补 2 台风机")
wcount("wind_turbine", 4)
build("wind_turbine", 56, 156, note="风机 W2 (56,156)")
wcount("wind_turbine", 5)

# ---------------------------------------------------------------- 4. 4 座补给站
build("supply_station", 44, 152, note="C_src 铜源补给站 (44,152)，占地 44..46,152..154")
wcount("supply_station", 3)
build("supply_station", 58, 152, note="C_dst 铜收货补给站 (58,152)，占地 58..60,152..154")
wcount("supply_station", 4)
build("supply_station", 51, 147, note="I_src 铁源补给站 (51,147)，占地 51..53,147..149")
wcount("supply_station", 5)
build("supply_station", 52, 158, note="I_dst 铁收货补给站 (52,158)，占地 52..54,158..160")
wcount("supply_station", 6)

# ---------------------------------------------------------------- 5. 传送带
for x in range(48, 57):
    b = ("铜主线 y=153（48..56 向东）：地面带，和 (53,153) 高架铁带共格不同层" if x == 48 else None)
    build("conveyor_belt_mk1", x, 153, direction="east", note=b)
wcount("conveyor_belt_mk1", 13)

build("conveyor_belt_mk1", 48, 152, direction="east", note="侧汇支带 (48,152)(49,152) 向东 → (50,152) 转南汇入 (50,153) 主线")
build("conveyor_belt_mk1", 49, 152, direction="east")
build("conveyor_belt_mk1", 50, 152, direction="south")
wcount("conveyor_belt_mk1", 16)

build("conveyor_belt_mk1", 53, 151, direction="south", elevation=0, note="铁线 (53,151) 地面南（分拣器 53,150 放货端）")
wcount("conveyor_belt_mk1", 17)
build("conveyor_belt_mk1", 53, 152, direction="south", elevation=1, note="上坡：e0 (53,151) 的输出南 = 同格 e1 (53,152) 的行进方向")
wcount("conveyor_belt_mk1", 18)
build("conveyor_belt_mk1", 53, 153, direction="south", elevation=1, note="高架跨线格 (53,153) e1：下方是同格地面铜带 e0（低矮物流建筑，允许架高）")
wcount("conveyor_belt_mk1", 19)
build("conveyor_belt_mk1", 53, 154, direction="south", elevation=0, note="下坡：e1 (53,153) 同层无带 → 邻格 e0 (53,154) 直行延续")
wcount("conveyor_belt_mk1", 20)
build("conveyor_belt_mk1", 53, 155, direction="south", elevation=0, note="铁带带尾 (53,155)；(53,156) 留空给跨格分拣器取货")
wcount("conveyor_belt_mk1", 21)

# ---------------------------------------------------------------- 6. 分拣器
build("sorter_mk1", 47, 153, rotation=90, note="铜主线上料：背取 (46,153)=C_src，前放 (48,153)=主线（过滤 allow copper_ingot）")
wcount("sorter_mk1", 7)
build("sorter_mk1", 47, 152, rotation=90, note="支线上料：背取 (46,152)=C_src，前放 (48,152)=支带（过滤 allow copper_ore）")
wcount("sorter_mk1", 8)
build("sorter_mk1", 57, 153, rotation=90, note="铜收货：背取 (56,153)=主线，前放 (58,153)=C_dst（不过滤）")
wcount("sorter_mk1", 9)
build("sorter_mk1", 53, 150, rotation=180, note="铁线上料：背取 (53,149)=I_src，前放 (53,151)=铁带")
wcount("sorter_mk1", 10)
build("sorter_mk1", 53, 157, rotation=180, note="跨格铁收货：取货端沿背面（北）扫 range=3，(53,156) 空 → 取 (53,155) 带（2 步），前放 (53,158)=I_dst")
wcount("sorter_mk1", 11)

# ---------------------------------------------------------------- 7. 过滤配置（ID 实测回填）
if WITH_CONFIGURE:
    ids = json.load(open(IDS, encoding="utf-8"))
    configure(ids["c_main"], ["copper_ingot"], "铜主线上料只放行铜锭")
    configure(ids["c_side"], ["copper_ore"], "支线上料只放行铜矿")
    configure(ids["i_line"], ["iron_ingot"], "铁线上料只放行铁锭")

# ---------------------------------------------------------------- 8. 全部 running
wait({"kind": "building_running_gte", "player": "p1", "type": "tesla_tower", "n": 3}, 3600)
wait({"kind": "building_running_gte", "player": "p1", "type": "wind_turbine", "n": 5}, 3600)
wait({"kind": "building_running_gte", "player": "p1", "type": "supply_station", "n": 6}, 3600)
wait({"kind": "building_running_gte", "player": "p1", "type": "sorter_mk1", "n": 11}, 3600)

# ---------------------------------------------------------------- 9. 放货 + item_growth
if not PROBE:
    if WITH_CONFIGURE:
        ids = json.load(open(IDS, encoding="utf-8"))
        c_src, i_src = ids["c_src"], ids["i_src"]
    else:
        raise SystemExit("正式生成需要 --configure（先 --probe 跑一遍读建筑 ID）")
    transfer(c_src, "copper_ingot", 10, "to_building", note="C_src 放铜锭 10（主线分拣器只放行 copper_ingot）")
    transfer(c_src, "copper_ore", 6, "to_building", note="C_src 放铜矿 6（支线分拣器只放行 copper_ore，证明侧汇支线的货能进主线）")
    transfer(i_src, "iron_ingot", IRON_BATCH, "to_building", note="I_src 放铁锭 %d：高架铁线走货的料" % IRON_BATCH)

    # 方案原打算直接观察 (53,153) elevation 1 的带格。实测：铁线上料分拣器每 6 tick
    # 才放 1 件，带子 throughput=1、每格只停留 1 tick，窗口结束时该格为空是常态
    # （tick 10730→11030 两次计数都是 0，但下游 I_dst 在同一时段收到了铁锭）。
    # 按方案允许的备选改成观察高架铁线的终点 I_dst：它只可能由这条线喂货，
    # 增量同样证明「I_src → 分拣器 → (53,151) → e1 (53,152)(53,153) → (53,154)(53,155) → 分拣器 → I_dst」整条线在走。
    item_growth(52, 158, "iron_ingot", 1, 600,
                note="高架铁线走货（改看终点 I_dst：高架带格瞬时件数不稳，见 note 说明）：放铁锭后 600 tick 内 I_dst 收到铁锭")

    transfer(c_src, "copper_ingot", 12, "to_building", note="再补铜锭 12 进 C_src（下一段观察窗口的料）")
    item_growth(58, 152, "copper_ingot", 2, 1200, note="C_dst 铜锭继续增长，证明主线持续流动")

    transfer(i_src, "iron_ingot", IRON_BATCH2, "to_building", note="再补铁锭 %d 进 I_src" % IRON_BATCH2)
    item_growth(52, 158, "iron_ingot", 1, 600, note="I_dst 铁锭继续增长（补 6 个后 600 tick 内至少再到 1 个），证明高架铁线持续流动")

# ---------------------------------------------------------------- 10. UI 操作测试余量补丁（plan2）
# 第 19 轮 UI 操作测试 D/E：南侧资源点密集、没有干净拖拽走廊（D），电网满载（E），
# 真死端红杠没有现成样本。新增内容全部追加在上面最后一条 item_growth 之后，
# 现有建筑 ID 不变；走廊 x36..52,y161..165 除 x=44 一列外保持全空（以后别在这里建东西）。
# 探路（--probe）也要把这些建造步骤跑一遍，才能读到新分拣器的建筑 ID；
# 只有 configure / 放货 / item_growth 依赖 ids.json 或落档语义，探路时跳过。
if True:
    # 10.1 取料 + 手搓：风机 2（磁线圈 6）、带 8（齿轮 8）、分拣器 1（电路板 1、铁锭 1）
    transfer("b-105", "iron_ingot", 51, note="补丁用料：取 b-105 铁锭 51（带 8×2 + 风机 2×6 + 分拣器 1 = 29，另 10 个手搓齿轮；余 12 留背包）")
    transfer("b-49", "iron_ore", 6, note="补丁用料：取 b-49 铁矿 6，手搓磁铁 6 → 磁线圈 6（背包原有磁铁 2 + 磁线圈 2）")
    wait({"kind": "item_gte", "player": "p1", "item_id": "iron_ingot", "n": 51}, 900)
    craft("smelt_magnet", 4, "手搓磁铁 4（背包 2 + 铁矿 6 = 6，磁线圈 6 需磁铁 6）")
    wait({"kind": "item_gte", "player": "p1", "item_id": "magnet", "n": 6}, 1800)
    craft("magnetic_coil", 3, "手搓磁线圈 3 批（每批 2 个，共 6 个；背包原有 2 个刚好够风机 2 台的 6 个）")
    wait({"kind": "item_gte", "player": "p1", "item_id": "magnetic_coil", "n": 8}, 1800)
    craft("gear", 10, "手搓齿轮 10（带 8 条 + 风机 2 台各 1）")
    wait({"kind": "item_gte", "player": "p1", "item_id": "gear", "n": 10}, 1800)
    craft("circuit_board", 1, "手搓电路板 1（死端分拣器 1 台）")
    wait({"kind": "item_gte", "player": "p1", "item_id": "circuit_board", "n": 1}, 900)

    # 10.2 两台风机（基地 b-39 正下方；离电塔 b-120 (51,151) 曼哈顿 7 / 9，都在无线 12 格内）
    build("wind_turbine", 56, 149, note="风机 W3 (56,149)（2×2，56..57,149..150）：+10 电，离 b-120 曼哈顿 7")
    wcount("wind_turbine", 6)
    build("wind_turbine", 58, 149, note="风机 W4 (58,149)（2×2，58..59,149..150）：+10 电，离 b-120 曼哈顿 9")
    wcount("wind_turbine", 7)

    # 10.3 8 条带：死端 3 条（(45,156)(45,157)(45,158) 向南）+ 走廊 5 条（(44,161)..(44,165) 向南）
    for y in (156, 157, 158):
        build("conveyor_belt_mk1", 45, y, direction="south",
              note="死端带 (45,%d) 向南，elevation 0" % y)
    wcount("conveyor_belt_mk1", 24)
    for y in range(161, 166):
        build("conveyor_belt_mk1", 44, y, direction="south",
              note="走廊地面带 (44,%d) 向南：空带不上货，UI 沿 y=163 拖高架带从 x=38 到 x=50 时被跨的对象" % y)
    wcount("conveyor_belt_mk1", 29)

    # 10.4 死端上料分拣器 (45,155) rotation 180：取 (45,154)=C_src，放 (45,156) 带
    build("sorter_mk1", 45, 155, rotation=180,
          note="死端上料分拣器 (45,155) rot180：背取 (45,154)=C_src，前放 (45,156) 死端带")
    wcount("sorter_mk1", 12)

    # 10.5 等全部 running（死端分拣器断电就不算，契约同口径）
    wait({"kind": "building_running_gte", "player": "p1", "type": "sorter_mk1", "n": 12}, 3600)
    wait({"kind": "building_running_gte", "player": "p1", "type": "wind_turbine", "n": 7}, 3600)

    # 10.6 死端分拣器过滤配置（ID 由 --probe 实测回填 ids.json）
    if not PROBE:
        if not WITH_CONFIGURE:
            raise SystemExit("补丁段需要 --configure（先 --probe 跑一遍读新分拣器 ID）")
        ids = json.load(open(IDS, encoding="utf-8"))
        configure(ids["deadend"], ["copper_ingot"], "死端分拣器只放行铜锭（取 C_src 的铜锭上死端带）")

        # 10.7 往 C_src 放铜锭 8（死端带的料，放在分拣器落成 + 配置之后）
        transfer(c_src, "copper_ingot", 8, "to_building", note="C_src 放铜锭 8：死端带上料")
        item_growth(45, 158, "copper_ingot", 1, 300,
                    note="死端带尾 (45,158) 堆上铜锭（8 个足够填满 3 格带）：真死端 = 带上有货、前方 (45,159) 空、无分拣器")

CHECKS = [
    {"kind": "game_not_finished"},
    {"kind": "player_alive", "player": "p1"},
    {"kind": "building_item_at_gte", "player": "p1", "item_id": "copper_ingot", "n": 3,
     "position": {"x": 58, "y": 152, "z": 0}},
    {"kind": "building_item_at_gte", "player": "p1", "item_id": "copper_ore", "n": 1,
     "position": {"x": 58, "y": 152, "z": 0}},
    {"kind": "building_item_at_lt", "player": "p1", "item_id": "iron_ingot", "n": 1,
     "position": {"x": 58, "y": 152, "z": 0}},
    {"kind": "building_item_at_gte", "player": "p1", "item_id": "iron_ingot", "n": 3,
     "position": {"x": 52, "y": 158, "z": 0}},
    {"kind": "building_item_at_lt", "player": "p1", "item_id": "copper_ingot", "n": 1,
     "position": {"x": 52, "y": 158, "z": 0}},
    {"kind": "building_item_at_lt", "player": "p1", "item_id": "copper_ore", "n": 1,
     "position": {"x": 52, "y": 158, "z": 0}},
    {"kind": "building_running_gte", "player": "p1", "type": "sorter_mk1", "n": 12},
    {"kind": "building_running_gte", "player": "p1", "type": "supply_station", "n": 6},
    {"kind": "building_running_gte", "player": "p1", "type": "tesla_tower", "n": 3},
    {"kind": "building_running_gte", "player": "p1", "type": "wind_turbine", "n": 7},
]
if PROBE:
    CHECKS = [{"kind": "game_not_finished"}]

NOTE = (
    "L5 cp-belt-dsp（第 19 轮 §5 多层传送带逻辑层）：从 cp-base 读档，只用玩家命令 + 快进"
    "（料全部来自自家产线：b-105 铁锭 / b-97 铜锭 / b-49 铁矿 / b-59 铜矿，手搓铁锭 64、齿轮 6、电路板 13），"
    "在基地南侧空地上搭一条立体交叉的物流场景：① 铜主线 y=153 从 x=48 到 x=56 向东，源头是补给站 C_src(44,152) "
    "经两台分拣器上料（主线只放行 copper_ingot，侧汇支线只放行 copper_ore），终点由分拣器 (57,153) 卸进 C_dst(58,152)。"
    "② 侧汇支带 (48,152)(49,152) 向东 → (50,152) 转南，从北侧汇入地面主线 (50,153)。"
    "③ 铁线 (53,151)→(53,155) 向南：其中 (53,152) 升到 1 层、(53,153) 保持 1 层跨过同格的地面铜带、(53,154) 落回地面，"
    "起点是 I_src(51,147) 经分拣器 (53,150) 上料，终点由跨格分拣器 (53,157)（背面扫 2 格取 (53,155) 带、正面放 (53,158)）卸进 I_dst(52,158)。"
    "供电：新增电塔 (51,151) 接现有电网（离 b-57 曼哈顿 9 格），另补 2 台风机（新负载 13 > 现有余量）。"
    "契约：两条线终点各自只收到自己的物品（C_dst 有铜锭/铜矿、无铁锭；I_dst 有铁锭、无铜），"
    "11 台分拣器 / 6 座补给站 / 3 座电塔 running，并用 item_growth 证明高架铁线与铜主线此刻真的在走货 "
    "（item_growth 的料在窗口开始前才放进源站，存量断言不能只靠读档前攒下的量）。"
    "高架段走货的观察点取该线终点 I_dst 而不是高架带格 (53,153)e1：铁线上料分拣器每 6 tick 才放 1 件，"
    "带子 throughput=1、每格停留 1 tick，按 300/600 tick 窗口采样时该格为空的概率极高（实测两次计数都是 0，"
    "而同一时段 I_dst 收到了货）；I_dst 只可能由这条高架线喂货，其增长等价地证明整条线在走。"
    "【2026-10-18 补丁】按主代理定稿的 plan2 在末尾追加：手搓磁铁/磁线圈/齿轮/电路板后补 2 台风机 "
    "(56,149)(58,149)（p1 电网发电 70 / 负载 43，余量 27）、死端带 (45,156)(45,157)(45,158) 向南 + "
    "上料分拣器 (45,155) rot180（取 C_src 铜锭，allow copper_ingot），往 C_src 放铜锭 8 后带尾 (45,158) 堆货、"
    "blocked_ticks 持续增长（真死端样本：带上有货、前方 (45,159) 空、无分拣器）；另在走廊铺地面带 "
    "(44,161)..(44,165) 向南（空带）。契约 sorter running 11→12，新增 wind_turbine running 7。"
    "走廊 x36..52,y161..165 除 x=44 这一列外保持全空，为 UI 拖拽测试保留（沿 y=163 拖 1 层高架带从 x=38 到 x=50 跨过 x=44 的地面带）——以后别在这里建东西。"
)

BUILD_SUMMARY = [
    "机甲从 (49,134) 开到 (50,150)",
    "从 b-105 取铁锭 51、b-97 取铜锭 30、b-49 取铁矿 48、b-59 取铜矿 6（全是玩家命令，无管理员发料）",
    "手搓铁锭 64、齿轮 6、电路板 13",
    "电力感应塔 (51,151)，风机 (47,156)、(56,156)",
    "补给站 C_src(44,152)、C_dst(58,152)、I_src(51,147)、I_dst(52,158)",
    "铜主线 y=153：x=48..56 向东（地面）",
    "侧汇支带：(48,152)(49,152) 向东 → (50,152) 转南汇入 (50,153)",
    "铁线：x=53，y=151 地面 → y=152 升 1 层 → y=153 保持 1 层跨过地面铜带 → y=154 落回地面 → y=155 带尾",
    "5 台分拣器：(47,153) 铜主线上料、(47,152) 支线上料、(57,153) 铜收货、(53,150) 铁线上料、(53,157) 跨格铁收货",
    "configure_sorter 过滤：主线 allow copper_ingot、支线 allow copper_ore、铁线 allow iron_ingot",
    "往 C_src 放铜锭 10 + 铜矿 6、往 I_src 放铁锭（分两批），item_growth 证明高架段与两条主线在走货",
    "补丁（plan2）：风机 W3(56,149)、W4(58,149)；死端带 (45,156..158) + 分拣器 (45,155) allow copper_ingot；C_src 放铜锭 8 → 死端带尾堆货（blocked_ticks>0）",
    "补丁：走廊地面带 (44,161)..(44,165) 向南（空带）；x36..52,y161..165 其余格保持全空供 UI 拖拽测试",
]

spec = {
    "parent": "cp-base",
    "note": NOTE,
    "build": BUILD_SUMMARY,
    "steps": STEPS,
    "end_tick": END_TICK,
    "contract": {"checks": CHECKS},
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(spec, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("wrote", OUT, "steps", len(STEPS), "configure:", WITH_CONFIGURE, "probe:", PROBE)
