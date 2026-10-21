"""3A 画质模型选型的槽位表（序号、槽位、用途、关键词）。

槽位与关键词来自 docs/guide/3A画质.md 第一阶段方案（tmp/plan.md）。
"""

# (序号, 槽位, 用途, 关键词列表)
SLOTS = [
    (1, "executor", "玩家机甲（英雄单位）", ["mech", "battle mech", "sci-fi mech walker", "exosuit"]),
    (2, "mecha", "重装战斗机甲", ["heavy mech", "assault mech"]),
    (3, "soldier", "步兵", ["sci-fi soldier", "robot soldier", "space marine", "combat android"]),
    (4, "worker", "工程兵", ["engineer robot", "worker robot", "construction drone"]),
    (5, "scout", "侦察车", ["sci-fi buggy", "scout rover", "hover bike"]),
    (6, "attack_drone", "攻击无人机", ["combat drone", "attack drone"]),
    (7, "artillery", "火炮", ["self-propelled artillery sci-fi", "mobile cannon"]),
    (8, "missile_vehicle", "导弹车", ["missile launcher vehicle", "MLRS"]),
    (9, "repair_vehicle", "维修车", ["utility vehicle sci-fi", "repair truck"]),
    (10, "supply_truck", "补给车", ["sci-fi cargo truck", "armored transport"]),
    (11, "dark_fog", "黑雾（敌对外星机械群体）", ["alien drone", "biomechanical alien", "alien crystal creature"]),
    (12, "ship", "行星物流飞船", ["cargo drone", "logistics drone", "small cargo ship"]),
    (13, "cargo_ship", "星际货船", ["space freighter", "cargo spaceship"]),
    (14, "logistics_bot", "小型物流机器人", ["delivery robot", "cargo robot"]),
    (15, "battlefield_analysis_base", "主基地", ["sci-fi command center", "headquarters"]),
    (16, "mining_machine", "采矿机", ["mining drill", "ore extractor"]),
    (17, "oil_extractor", "油井", ["oil pump jack", "derrick"]),
    (18, "arc_smelter", "熔炉", ["furnace", "smelter", "foundry"]),
    (19, "assembling_machine", "装配台（mk1-3 三级）", ["fabricator", "factory machine", "assembler"]),
    (20, "chemical_plant", "化工厂", ["chemical plant", "reactor tanks"]),
    (21, "oil_refinery", "炼油厂", ["refinery"]),
    (22, "matrix_lab", "研究站", ["research lab", "laboratory"]),
    (23, "wind_turbine", "风机", ["wind turbine"]),
    (24, "thermal_power_plant", "火电", ["power plant", "generator"]),
    (25, "solar_panel", "太阳能板", ["solar panel"]),
    (26, "tesla_tower", "电塔", ["power pylon", "tesla coil", "energy pylon"]),
    (27, "accumulator", "蓄电器", ["battery", "energy storage cell"]),
    (28, "depot", "仓库", ["storage container", "cargo crate stack", "warehouse"]),
    (29, "storage_tank", "储液罐", ["storage tank"]),
    (30, "logistics_station", "物流站", ["landing pad", "logistics hub", "spaceport"]),
    (31, "gauss_turret", "机枪/高斯炮塔", ["sci-fi turret", "gatling turret"]),
    (32, "laser_turret", "激光炮塔", ["laser turret"]),
    (33, "missile_turret", "导弹炮塔", ["missile launcher turret"]),
    (34, "plasma_turret", "等离子炮", ["plasma cannon", "heavy cannon turret"]),
    (35, "anti_air_turret", "防空炮", ["anti-air gun", "flak"]),
    (36, "barracks", "兵营", ["barracks", "military bunker"]),
    (37, "vehicle_factory", "载具工厂", ["vehicle factory", "hangar factory"]),
    (38, "airfield", "机场", ["landing pad hangar", "airfield"]),
    (39, "supply_station", "补给站", ["supply depot"]),
    (40, "ray_receiver", "射线接收站", ["satellite dish", "radio telescope"]),
    (41, "em_rail_ejector", "电磁轨道弹射器", ["railgun launcher", "mass driver"]),
    (42, "vertical_launching_silo", "垂直发射井", ["rocket launch pad", "missile silo"]),
    (43, "planetary_shield_generator", "护盾发生器", ["shield generator"]),
    (44, "artificial_star", "人造恒星", ["fusion reactor", "reactor core"]),
    (45, "radar_tower", "信号塔 / 干扰塔", ["radar tower", "communication tower", "jammer tower", "signal tower"]),
    (46, "water_pump", "抽水机", ["water pump"]),
    (47, "particle_collider", "微型粒子对撞机 / 分馏塔", ["particle accelerator", "centrifuge"]),
]

UNIT_SLOTS = {s[1] for s in SLOTS if s[0] <= 14}
BUILDING_SLOTS = {s[1] for s in SLOTS if s[0] >= 15}

# 「套装」联系表：把 8 个套装关键词分成 3 组，每组出一张按作者聚合的表
PACK_GROUPS = [
    ("buildings", "建筑套装", ["sci-fi buildings pack", "rts sci-fi buildings", "modular sci-fi base"]),
    ("industrial", "工业套装", ["sci-fi industrial kit", "sci-fi factory pack"]),
    ("vehicles", "载具/炮塔/机甲套装", ["sci-fi turret pack", "sci-fi vehicles pack", "mech pack"]),
]
