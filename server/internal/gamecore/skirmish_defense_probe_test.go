package gamecore

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 防守探针（2026-10-10 改为「无开局物资包」版本；同日再按试玩节奏把首攻推到 60000）：
//
// 遭遇战预设（config-skirmish + map-skirmish，bot easy）下，玩家 p1 从空背包
// 起步，靠「手动采矿 + 手搓 + 早期建筑」铺出兵营 barracks + 步兵 soldier +
// 子弹 ammo_bullet + 补给站 supply_station + 执行体机甲，能不能扛住 bot 首攻
// （bot_first_attack_tick=60000）与后续波次？
//
// p1 的脚本就是一个照着 UI 点的真人：手搓起步 → 风机/电塔/矿机/熔炉/制造台 →
// 电路板与子弹 → 兵营与补给站 → 8 个步兵站到 HQ 周围一圈的阵位上（姿态 hold：
// 原地坚守，不追出基地），机甲留在家里自动还手。不造炮塔（高斯机枪塔要武器系统，
// 而武器系统要先有电磁学 20 矩阵）。
//
// 跑到 tick 75000（首攻 60000 + 15000 的观察窗口），输出 p1 是否存活、首攻时间与规模、
// 进攻波次（各波 20 格内兵力峰值）、双方兵力与损失。跑得慢（2 seed 约 6–9 分钟）：
// `go test -short` 会跳过。
//
// 单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishDefenseProbe -v -timeout 30m
func TestSkirmishDefenseProbe(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战探针（每 seed 约 3–5 分钟）")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1011-0e2bz1"} {
		// hold 与 attack_move 实测逐 tick 结果一致（bot 是先到先打，站桩与前顶
		// 都不改变交火顺序），只保留 hold，省一半墙钟时间。
		for _, stance := range []string{"hold"} {
			t.Run(seed+"/"+stance, func(t *testing.T) {
				// 探针各自建 GameCore/WorldState（newSkirmishCoreForSeed）与
				// zeroOpening，不碰包级可变状态，seed 之间可以并行跑。
				t.Parallel()
				runSkirmishDefenseProbe(t, seed, stance)
			})
		}
	}
}

func runSkirmishDefenseProbe(t *testing.T, seed, stance string) {
	t.Helper()
	core := newSkirmishCoreForSeed(t, seed)
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, 75000)
	op.includeBarracks = true
	op.rallyOrder = stance
	// bot 发育里程碑（easy 无物资包下能不能自己走起来、还是死锁在某个环上）：
	// 每 tick 结算后采样一次，记录第一次达成。
	botMarks := map[string]int64{}
	op.onTick = func() {
		ws := op.ws
		counts := skirmishBuildingCounts(ws, "p2")
		mark := func(key string, cond bool) {
			if !cond {
				return
			}
			if _, ok := botMarks[key]; !ok {
				botMarks[key] = ws.Tick
			}
		}
		mark("wind_turbine", counts[model.BuildingTypeWindTurbine] >= 1)
		mark("tesla_tower", counts[model.BuildingTypeTeslaTower] >= 1)
		mark("mining_machine", counts[model.BuildingTypeMiningMachine] >= 1)
		mark("arc_smelter", counts[model.BuildingTypeArcSmelter] >= 1)
		mark("assembling_machine", counts[model.BuildingTypeAssemblingMachineMk1] >= 1)
		mark("barracks", counts[model.BuildingType("barracks")] >= 1)
		mark("soldier", countUnitsOfType(ws, "p2", model.UnitTypeSoldier) >= 1)
		mark("matrix_lab", counts[model.BuildingTypeMatrixLab] >= 1)
		if tech := ws.Players["p2"].Tech; tech != nil {
			mark("electromagnetism", tech.CompletedTechs["electromagnetism"] > 0)
		}
	}
	op.run()

	ws := op.ws
	player := ws.Players["p1"]
	p1Home := op.home

	t.Logf("seed=%s stance=%s 里程碑=%v", seed, stance, op.milestone)
	t.Logf("seed=%s stance=%s bot 发育里程碑=%v（-1 = 整局未达成）", seed, stance, botMarksOrMissing(botMarks))
	t.Logf("seed=%s stance=%s 结束 tick=%d p1 存活=%v 建筑=%s 运行中=%s 部队=%d 损失(单位/建筑)=%d/%d 击杀=%d",
		seed, stance, ws.Tick, player.IsAlive, fmtCounts(skirmishBuildingCounts(ws, "p1")), fmtCounts(skirmishRunningCounts(ws, "p1")),
		countArmy(ws, "p1"), player.Stats.CombatStats.UnitsLost, player.Stats.CombatStats.BuildingsLost, player.Stats.CombatStats.UnitsKilled)
	t.Logf("seed=%s stance=%s bot 首攻 tick=%d（首波 20 格内峰值=%d）p2 部队=%d p2 建筑=%s 逼近(20/40/80 格内)=%d/%d/%d 最近距离=%d",
		seed, stance, op.firstAttackTick, op.firstWavePeak, countArmy(ws, "p2"), fmtCounts(skirmishBuildingCounts(ws, "p2")),
		countP2ArmyNear(ws, p1Home, 60), countP2ArmyNear(ws, p1Home, 120), countP2ArmyNear(ws, p1Home, 240),
		nearestP2GroundDistance(ws, p1Home))
	t.Logf("seed=%s stance=%s p1 库存弹药=%d HQ=%v", seed, stance, countItemInBuildings(ws, "p1", model.ItemAmmoBullet), botPlayerHQQuiet(ws, "p1") != nil)
	if v := core.Victory(); v.Declared() {
		t.Logf("seed=%s stance=%s 终局宣判：winner=%s reason=%s tick=%d", seed, stance, v.WinnerID, v.Reason, v.DeclaredTick)
	}

	// 探针只记录事实（结论写在报告里）。硬性检查：
	//   - 开局链必须跑通（兵营/步兵/研究站都建得起来，无死锁）；
	//   - bot 必须真的打过来（否则没测到想测的东西）；
	//   - p1 在首攻后仍然存活（无物资包下靠手搓链也必须能守住）。
	if tick, ok := op.milestone["barracks"]; !ok || tick <= 0 {
		t.Fatalf("兵营没建起来（milestones=%v）", op.milestone)
	}
	if tick, ok := op.milestone["soldier"]; !ok || tick <= 0 {
		t.Fatalf("步兵没造出来（milestones=%v）", op.milestone)
	}
	if op.firstAttackTick < 0 {
		t.Fatal("bot 从未推进到 p1 基地附近：探针没有测到首攻")
	}
	if !player.IsAlive {
		t.Fatalf("p1 在 tick %d 被淘汰（首攻 %d，首波峰值 %d）", ws.Tick, op.firstAttackTick, op.firstWavePeak)
	}
}

func soldiersFull(ws *model.WorldState, seen map[string]bool, cap int) bool {
	alive := 0
	for id := range seen {
		if u := ws.Units[id]; u != nil && u.HP > 0 {
			alive++
		}
	}
	queued := 0
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == "p1" && b.Type == model.BuildingType("barracks") {
			queued += len(b.UnitQueue)
		}
	}
	return alive+queued >= cap
}

func produceSoldier(core *GameCore, ws *model.WorldState) model.CommandResult {
	var barracks *model.Building
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == "p1" && b.HP > 0 && b.Type == model.BuildingType("barracks") {
			if barracks == nil || b.ID < barracks.ID {
				barracks = b
			}
		}
	}
	if barracks == nil {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: "还没有兵营"}
	}
	if len(barracks.UnitQueue) >= 2 {
		return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "队列已满"}
	}
	res, _ := execCommand(core, model.CmdProduce, ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", EntityID: barracks.ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeSoldier)},
	})
	return res
}

// feedOpeningIndustry 一个真人式的开局物流循环：从矿机/熔炉/制造台取出产物，
// 再按配方把原料喂回去，最后把子弹灌进补给站（补给站按 supply_rate 给附近单位补弹）。
func feedOpeningIndustry(core *GameCore, ws *model.WorldState) {
	player := ws.Players["p1"]
	if player == nil || !player.IsAlive {
		return
	}
	withdraw := func(b *model.Building, item string, qty int) {
		if qty <= 0 {
			return
		}
		execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
			Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{
				"building_id": b.ID, "item_id": item, "quantity": qty, "direction": "to_player",
			},
		})
	}
	load := func(b *model.Building, item string, qty int) {
		if b == nil || qty <= 0 || player.Inventory[item] <= 0 {
			return
		}
		execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": min(qty, player.Inventory[item])},
		})
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var smelterIron, smelterCopper, cbAssembler, ammoAssembler, barracks, supply *model.Building
	// 先取加工品（熔炉的锭、制造台的电路板/子弹），最后才取矿石：背包只有 200 格，
	// 而三座矿机一周期（feedEvery=60）能产出 ~480 矿，先取矿会把背包塞满，
	// 之后取锭/电路板的命令全部落空（这是探针的物流顺序，不是游戏问题）。
	var miners []*model.Building
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil {
			continue
		}
		switch b.Type {
		case model.BuildingTypeMiningMachine:
			miners = append(miners, b)
		case model.BuildingTypeArcSmelter:
			withdraw(b, model.ItemIronIngot, b.Storage.OutputQuantity(model.ItemIronIngot))
			withdraw(b, model.ItemCopperIngot, b.Storage.OutputQuantity(model.ItemCopperIngot))
			if b.Production != nil {
				switch b.Production.RecipeID {
				case "smelt_iron":
					smelterIron = b
				case "smelt_copper":
					smelterCopper = b
				}
			}
		case model.BuildingTypeAssemblingMachineMk1:
			withdraw(b, model.ItemCircuitBoard, b.Storage.OutputQuantity(model.ItemCircuitBoard))
			withdraw(b, model.ItemAmmoBullet, b.Storage.OutputQuantity(model.ItemAmmoBullet))
			if b.Production != nil {
				switch b.Production.RecipeID {
				case "circuit_board":
					cbAssembler = b
				case "ammo_bullet":
					ammoAssembler = b
				}
			}
		case model.BuildingType("barracks"):
			barracks = b
		case model.BuildingTypeSupplyStation:
			supply = b
		}
	}
	// 矿石只补到「够熔炉吃 + 够手搓」的量（背包只有 200 格，取满会把锭/电路板挤掉）。
	for _, m := range miners {
		if player.Inventory[model.ItemIronOre] < 60 {
			withdraw(m, model.ItemIronOre, min(30, m.Storage.OutputQuantity(model.ItemIronOre)))
		}
		if player.Inventory[model.ItemCopperOre] < 60 {
			withdraw(m, model.ItemCopperOre, min(30, m.Storage.OutputQuantity(model.ItemCopperOre)))
		}
	}
	load(smelterIron, model.ItemIronOre, 20)
	load(smelterCopper, model.ItemCopperOre, 20)
	if cbAssembler != nil {
		load(cbAssembler, model.ItemIronIngot, 10)
		load(cbAssembler, model.ItemCopperIngot, 10)
	}
	load(ammoAssembler, model.ItemIronIngot, 20)
	load(barracks, model.ItemIronIngot, 20)
	load(barracks, model.ItemCircuitBoard, 10)
	load(supply, model.ItemAmmoBullet, 200)
}

// skirmishRunningCounts 与 skirmishBuildingCounts 相同，但只数 state=running 的建筑。
func skirmishRunningCounts(ws *model.WorldState, owner string) map[model.BuildingType]int {
	counts := map[model.BuildingType]int{}
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == owner && b.HP > 0 && b.Runtime.State == model.BuildingWorkRunning {
			counts[b.Type]++
		}
	}
	return counts
}

// countArmy 玩家在地面上的世界战斗单位数（含机甲，不含执行体与工程兵）。
func countArmy(ws *model.WorldState, owner string) int {
	n := 0
	for _, u := range ws.Units {
		if u == nil || u.OwnerID != owner || u.HP <= 0 {
			continue
		}
		switch u.Type {
		case model.UnitTypeExecutor, model.UnitTypeWorker:
			continue
		}
		if def, ok := model.UnitDefinitionByID(u.Type); ok && def.Public {
			n++
		}
	}
	return n
}

func countP2ArmyNear(ws *model.WorldState, at model.Position, radius int) int {
	n := 0
	for _, u := range ws.Units {
		if u == nil || u.OwnerID != "p2" || u.HP <= 0 || u.Domain != model.UnitDomainGround {
			continue
		}
		if ws.SurfaceDistance(u.Position, at) <= radius {
			n++
		}
	}
	return n
}

// nearestP2GroundDistance 最近的 p2 地面单位到 at 的地表距离；没有则返回 -1。
// 用来区分「bot 完全没来」和「bot 在 12 格外一直拆外圈」。
func nearestP2GroundDistance(ws *model.WorldState, at model.Position) int {
	best := -1
	for _, u := range ws.Units {
		if u == nil || u.OwnerID != "p2" || u.HP <= 0 || u.Domain != model.UnitDomainGround {
			continue
		}
		d := ws.SurfaceDistance(u.Position, at)
		if best < 0 || d < best {
			best = d
		}
	}
	return best
}

// countItemInBuildings 玩家所有建筑库存里的某件物品总量（补给站里的子弹）。
func countItemInBuildings(ws *model.WorldState, owner, item string) int {
	n := 0
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != owner || b.HP <= 0 || b.Storage == nil {
			continue
		}
		n += b.Storage.ItemQuantity(item)
	}
	return n
}

// botPlayerHQQuiet 与 botPlayerHQ 相同但不 Fatal：基地被打掉时返回 nil。
func botPlayerHQQuiet(ws *model.WorldState, playerID string) *model.Building {
	var found *model.Building
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID || b.Type != model.BuildingTypeBattlefieldAnalysisBase || b.HP <= 0 {
			continue
		}
		if found == nil || b.ID < found.ID {
			found = b
		}
	}
	return found
}

// executorUnitQuiet 玩家在本星球存活的执行体单位；阵亡待复活时返回 nil。
func executorUnitQuiet(ws *model.WorldState, playerID string) *model.Unit {
	player := ws.Players[playerID]
	if player == nil {
		return nil
	}
	state := player.ExecutorForPlanet(ws.PlanetID)
	if state == nil {
		return nil
	}
	if unit := ws.Units[state.UnitID]; unit != nil && unit.HP > 0 {
		return unit
	}
	return nil
}

// countUnitsOfType 玩家某类型单位的存活数（探针记录 bot 的出兵里程碑）。
func countUnitsOfType(ws *model.WorldState, owner string, typ model.UnitType) int {
	n := 0
	for _, u := range ws.Units {
		if u != nil && u.OwnerID == owner && u.HP > 0 && u.Type == typ {
			n++
		}
	}
	return n
}

// botMarksOrMissing 把里程碑 map 补齐成固定键序，未达成的写 -1，便于一眼看出卡在哪一环。
func botMarksOrMissing(marks map[string]int64) string {
	keys := []string{
		"wind_turbine", "tesla_tower", "mining_machine", "arc_smelter",
		"assembling_machine", "barracks", "soldier", "matrix_lab", "electromagnetism",
	}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		if tick, ok := marks[k]; ok {
			parts = append(parts, fmt.Sprintf("%s=%d", k, tick))
			continue
		}
		parts = append(parts, k+"=-1")
	}
	return strings.Join(parts, " ")
}
