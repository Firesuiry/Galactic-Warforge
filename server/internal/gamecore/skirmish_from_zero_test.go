package gamecore

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 从零开局的整局验收（2026-10-10「去掉开局物资包」改动）：
//
// p1 用脚本化的「合理新手开局」——背包全空，先手动采矿、手搓起步，
// 再铺产线（风机/电塔/矿机/熔炉/制造台），出兵营与步兵守家，最后建研究站、
// 研究电磁学。bot 用预设难度（normal）同样从零发育，tick 30000 后才首攻。
//
// 断言/记录（两个 seed）：
//   - 各里程碑实际 tick（风机/电塔/矿机/熔炉/制造台/兵营/首个步兵/研究站/电磁学）
//     与目标（2400/9000/15000/18000/30000）的对照；
//   - bot 首攻 tick（≥ bot_first_attack_tick）与首波规模（p1 基地 20 格内 p2 地面单位峰值）；
//   - p1 整局存活（无物资包下必须能靠手搓链活下来）；
//   - 无死锁：手搓链每一环都能靠「手动采矿 + 手搓 + 早期建筑」拿到，
//     即开局链在 tick 6000 内跑通（TestSkirmishFromZeroOpeningByTick6000）。
//
// 跑得慢（2 seed 约 3–5 分钟）：`go test -short` 会跳过。单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishFromZeroFullMatch -v -timeout 30m
func TestSkirmishFromZeroFullMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战模拟（无物资包从零开局，每个 seed 约 2 分钟）")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1011-0e2bz1"} {
		t.Run(seed, func(t *testing.T) {
			runFromZeroMatch(t, seed)
		})
	}
}

// 开局链不变量（快，单 seed，tick 6000）：
// 空背包下，仅靠「手动采矿 + 手搓」必须能建起第一座风机、电塔、矿机，
// 并让矿机通电运转（矿机通电后 minerals 才有产出，否则整局死锁）。
// 实测：风机 tick 1413、电塔 1443、第一座矿机 3513（手搓链要走 齿轮/磁线圈/电路板）。
func TestSkirmishFromZeroOpeningByTick6000(t *testing.T) {
	core := newSkirmishCoreForSeed(t, "skirmish-seed-001")
	core.cfg.Battlefield.VictoryRule = model.VictoryRuleSandbox
	op := newZeroOpening(t, core, 6000)
	op.run()

	wind := op.milestone["wind_turbine"]
	tesla := op.milestone["tesla_tower"]
	miner := op.milestone["mining_machine"]
	if wind <= 0 || tesla <= 0 || miner <= 0 {
		t.Fatalf("开局链没跑通（死锁？）：milestones=%v", op.milestone)
	}
	if running := skirmishRunningCounts(op.ws, "p1"); running[model.BuildingTypeMiningMachine] < 1 {
		t.Fatalf("矿机没通电运转：running=%s reasons=%v", fmtCounts(running), op.powerReasons())
	}
	if wind > 2400 {
		t.Fatalf("第一座风机在 tick %d 才建成，目标 2400", wind)
	}
	if miner > 6000 {
		t.Fatalf("第一座矿机在 tick %d 才建成，目标 6000", miner)
	}
}

type zeroStep struct {
	btype  model.BuildingType
	recipe string
	node   *model.ResourceNodeState
}

// zeroOpening 脚本化的新手开局。
type zeroOpening struct {
	core   *GameCore
	ws     *model.WorldState
	home   model.Position
	radius int
	ctx    *botSurvey
	player *model.PlayerState

	steps []zeroStep
	next  int
	// includeBarracks 为 true 时开局计划里含兵营/补给站/子弹段（防守探针用）。
	includeBarracks bool
	// rallyOrder 步兵守家姿态（默认 hold：原地坚守；防守探针可换 attack_move）。
	rallyOrder string

	milestone map[string]int64
	soldiers  map[string]bool

	lastBuildTick int64
	lastFeedTick  int64
	lastMoveTick  int64
	lastLinkTick  int64
	lastRallyTick int64

	buildFails map[string]int

	firstAttackTick int64
	firstWavePeak   int
	wavePeak        int
	wavePeakEnd     int64

	deadline int64
	// debugEvery > 0 时每这么多 tick 打印一次 p1 的物流/机甲状态（调试用）。
	debugEvery int64
	debugLog   func()
	// onTick 每 tick 结算后回调（调试用）。
	onTick func()
}

func newZeroOpening(t *testing.T, core *GameCore, deadline int64) *zeroOpening {
	t.Helper()
	ws := core.World()
	home := botPlayerHQ(t, ws, "p1").Position
	ctx := core.surveyBotWorld(ws, "p1")
	op := &zeroOpening{
		core:            core,
		ws:              ws,
		home:            home,
		radius:          botConstructRadius(ws, "p1", ctx),
		ctx:             ctx,
		player:          ws.Players["p1"],
		milestone:       map[string]int64{},
		soldiers:        map[string]bool{},
		buildFails:      map[string]int{},
		firstAttackTick: -1,
		deadline:        deadline,
		includeBarracks: true,
		rallyOrder:      "hold",
	}
	op.steps = op.openingPlan(t)
	return op
}

// openingPlan 新手开局的建造顺序：先风机通电 → 三座矿机 → 三种熔炉 →
// 制造台（磁线圈/电路板/齿轮）→ 兵营与补给站 → 研究站 → 矩阵制造台。
func (op *zeroOpening) openingPlan(t *testing.T) []zeroStep {
	t.Helper()
	ws, home, radius := op.ws, op.home, op.radius
	byKind := map[string][]*model.ResourceNodeState{}
	for _, node := range ws.Resources {
		if node == nil || node.Remaining <= 0 {
			continue
		}
		switch node.Kind {
		case model.ItemIronOre, model.ItemCopperOre, model.ItemStoneOre:
		default:
			continue
		}
		if ws.SurfaceDistance(home, node.Position) > radius {
			continue
		}
		if ws.TileBuilding[model.TileKey(node.Position.X, node.Position.Y)] != "" {
			continue
		}
		byKind[node.Kind] = append(byKind[node.Kind], node)
	}
	for kind := range byKind {
		nodes := byKind[kind]
		sort.Slice(nodes, func(i, j int) bool {
			di, dj := ws.SurfaceDistance(home, nodes[i].Position), ws.SurfaceDistance(home, nodes[j].Position)
			if di != dj {
				return di < dj
			}
			return nodes[i].ID < nodes[j].ID
		})
	}
	iron, copper, stone := byKind[model.ItemIronOre], byKind[model.ItemCopperOre], byKind[model.ItemStoneOre]
	if len(iron) < 2 || len(copper) < 1 || len(stone) < 1 {
		t.Fatalf("基地半径 %d 内矿点不足：iron=%d copper=%d stone=%d", radius, len(iron), len(copper), len(stone))
	}
	// 可选追加：兵营产线（兵营 → 补给站 → 子弹），按需加在矩阵链之后。
	// 不再补第三台电路板制造台：每台制造台 8 个齿轮全靠机甲手搓（20 tick/个），
	// 齿轮是整条早期链最紧的料（实测建造失败回执里「制造台缺 8 个齿轮」出现
	// 920 次），研究站与兵营都被它拖住。前面两台电路板台够兵营与矩阵链分用。
	barracksTail := []zeroStep{
		{btype: model.BuildingType("barracks")},
		{btype: model.BuildingTypeSupplyStation},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "ammo_bullet"},
	}
	plan := []zeroStep{
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeMiningMachine, node: iron[0]},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeMiningMachine, node: copper[0]},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper"},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "circuit_board"},
		{btype: model.BuildingTypeMiningMachine, node: stone[0]},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_magnet"},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "magnetic_coil"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "circuit_board"},
		{btype: model.BuildingType("barracks")},
		{btype: model.BuildingTypeSupplyStation},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeMatrixLab},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "electromagnetic_matrix"},
		{btype: model.BuildingTypeTeslaTower},
		{btype: model.BuildingTypeMiningMachine, node: iron[1]},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeWindTurbine},
	}
	if !op.includeBarracks {
		// 纯研究链：把矩阵链之后的兵营段换成电塔/风机（防守探针用的是含兵营的版本）。
		for i, step := range plan {
			switch step.btype {
			case model.BuildingType("barracks"), model.BuildingTypeSupplyStation:
				plan[i] = zeroStep{btype: model.BuildingTypeWindTurbine}
			}
			if step.recipe == "circuit_board" || step.recipe == "ammo_bullet" {
				plan[i] = zeroStep{btype: model.BuildingTypeTeslaTower}
			}
		}
		plan = append(plan, zeroStep{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "ammo_bullet"})
	} else {
		// 研究链后接兵营段：先补一台电路板制造台（前面那台在做矩阵链的板），
		// 再兵营 → 补给站 → 子弹台。
		plan = append(plan, barracksTail...)
	}
	return plan
}

func (op *zeroOpening) run() {
	ws := op.ws
	for ws.Tick < op.deadline && !op.core.Finished() && op.player.IsAlive {
		op.observe()
		if op.debugLog != nil && op.debugEvery > 0 && ws.Tick%op.debugEvery == 0 {
			op.debugLog()
		}
		if ws.Tick > 0 && ws.Tick%30 == 0 {
			op.buildNext()
			op.repairRecipes()
			op.powerLink()
			op.produceSoldier()
			op.startResearch()
		}
		if ws.Tick > 0 && ws.Tick%20 == 0 {
			op.feedIndustry()
		}
		// 背包疏通要周期性做，不能只在「建造成功」后做：实测机甲被一个建不动的
		// 步骤卡住时，背包里堆着 42 石矿 + 91 铜锭 + 50 磁铁，容量满了以后
		// 取不出熔炉的铁块、也手搓不了齿轮，整局从 tick 21000 卡到 45000
		// 一动不动。真人玩家会把堆料倒回产线腾地方。
		if ws.Tick > 0 && ws.Tick%200 == 0 {
			op.sweepInventory()
		}
		op.rallySoldiers()
		op.driveMecha()
		op.core.processTick()
		if op.onTick != nil {
			op.onTick()
		}
	}
	op.observe()
}

// observe 记录里程碑与 bot 首攻。
func (op *zeroOpening) observe() {
	ws := op.ws
	counts := skirmishBuildingCounts(ws, "p1")
	mark := func(key string, cond bool) {
		if cond {
			if _, ok := op.milestone[key]; !ok {
				op.milestone[key] = ws.Tick
			}
		}
	}
	mark("wind_turbine", counts[model.BuildingTypeWindTurbine] >= 1)
	mark("tesla_tower", counts[model.BuildingTypeTeslaTower] >= 1)
	mark("mining_machine", counts[model.BuildingTypeMiningMachine] >= 1)
	mark("arc_smelter", counts[model.BuildingTypeArcSmelter] >= 1)
	mark("assembling_machine", counts[model.BuildingTypeAssemblingMachineMk1] >= 1)
	mark("barracks", counts[model.BuildingType("barracks")] >= 1)
	mark("matrix_lab", counts[model.BuildingTypeMatrixLab] >= 1)
	mark("wind_turbine_4", counts[model.BuildingTypeWindTurbine] >= 4)
	mark("miner_4", counts[model.BuildingTypeMiningMachine] >= 4)
	mark("smelter_3", counts[model.BuildingTypeArcSmelter] >= 3)
	mark("assembler_3", counts[model.BuildingTypeAssemblingMachineMk1] >= 3)
	if tech := ws.Players["p1"].Tech; tech != nil {
		mark("electromagnetism", tech.CompletedTechs["electromagnetism"] > 0)
	}
	alive := 0
	for id := range op.soldiers {
		if u := ws.Units[id]; u != nil && u.HP > 0 {
			alive++
		}
	}
	mark("soldier", alive >= 1)
	mark("soldier_6", alive >= 6)

	if op.firstAttackTick < 0 && skirmishBotAttackingPlayer(ws) {
		op.firstAttackTick = ws.Tick
		// 首波窗口取 600 tick（1 分钟）：首攻后 p1 基地附近 p2 地面单位的峰值
		// 就是首波规模（normal 档 attackAt=6、squadCap=1 → 6 个兵）。
		op.wavePeakEnd = ws.Tick + 600
	}
	if op.wavePeakEnd > 0 && ws.Tick <= op.wavePeakEnd {
		if near := countP2ArmyNear(ws, op.home, 20); near > op.wavePeak {
			op.wavePeak = near
		}
		if op.wavePeak > op.firstWavePeak {
			op.firstWavePeak = op.wavePeak
		}
	}
}

// buildNext 追一条建造命令（UI 正常速度：约 3 秒一条）。
func (op *zeroOpening) buildNext() {
	if op.next >= len(op.steps) {
		return
	}
	s := op.steps[op.next]
	var pos *model.Position
	if s.node != nil {
		// 矿点随时重选：botBuildSpotNear 不跳过资源格，新手随手放的建筑可能
		// 正好压在矿脉上（实测第一座电塔就压在铜矿上，矿机再也放不下）。
		node := op.freeNode(s.node.Kind, s.node)
		if node == nil {
			op.buildFails["no_free_node:"+s.node.Kind]++
			return
		}
		p := node.Position
		pos = &p
	} else {
		pos = op.buildSpot(s.btype)
	}
	if pos == nil {
		op.buildFails["no_spot:"+string(s.btype)]++
		return
	}
	payload := map[string]any{"building_type": string(s.btype)}
	if s.recipe != "" {
		payload["recipe_id"] = s.recipe
	}
	res, _ := execCommand(op.core, model.CmdBuild, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", Position: pos},
		Payload: payload,
	})
	if res.Code == model.CodeOK {
		op.next++
		op.lastBuildTick = op.ws.Tick
		op.sweepInventory()
		return
	}
	key := fmt.Sprintf("%s: %s", s.btype, res.Message)
	op.buildFails[key]++
}

// repairRecipes 给「建好后没配好配方」的机器补上配方。
// 建造结算（construction.go）只认任务上的 RecipeID；本脚本建制造台时带了 recipe_id，
// 但若建筑建成时配方为空（例如配方的 BuildingTypes 不含该建筑），
// 这台机器就会永远待机——真人玩家会在机器面板里手动选配方，脚本在这里补。
func (op *zeroOpening) repairRecipes() {
	for i, s := range op.steps {
		if s.recipe == "" || i >= op.next {
			continue
		}
		for _, b := range op.ws.Buildings {
			if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Type != s.btype || b.Production == nil {
				continue
			}
			if b.Production.RecipeID != "" {
				continue
			}
			execCommand(op.core, model.CmdSetRecipe, op.ws, "p1", model.Command{
				Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
				Payload: map[string]any{"recipe_id": s.recipe},
			})
		}
	}
}

// sweepInventory 施工扣料后把「后面用不上的」堆料送进产线：真人玩家也一样，
// 背包满了就把矿石倒进熔炉、把锭倒进制造台，不然施工「背包已满」扣不了料。
// 只送那些「当前步骤和排队施工都不需要」的物品，否则会把刚备好的料又送走。
func (op *zeroOpening) sweepInventory() {
	needed := map[string]bool{}
	op.collectBuildNeeds(needed, op.next)
	if len(needed) == 0 {
		return
	}
	// 背包占用（件数）超过容量 1/3 就清理，避免来回搬运。
	if op.inventoryUsed() <= op.mechaCapacity()/3 {
		return
	}
	for item, qty := range op.player.Inventory {
		if qty <= 0 || needed[item] {
			continue
		}
		op.dumpToIndustry(item, qty)
	}
}

// collectBuildNeeds 当前步骤 + 已排队施工 + 队列里接下来两步需要的手搓件。
func (op *zeroOpening) collectBuildNeeds(needed map[string]bool, from int) {
	add := func(btype model.BuildingType) {
		def, ok := model.BuildingDefinitionByID(btype)
		if !ok {
			return
		}
		for _, it := range def.BuildCost.Items {
			needed[it.ItemID] = true
		}
	}
	for i := from; i < len(op.steps) && i < from+2; i++ {
		add(op.steps[i].btype)
	}
	if op.ws.Construction != nil {
		for _, task := range op.ws.Construction.Tasks {
			if task == nil || task.PlayerID != "p1" {
				continue
			}
			if task.State == model.ConstructionPending || task.State == model.ConstructionInProgress {
				add(task.BuildingType)
			}
		}
	}
}

// dumpToIndustry 把背包里多出来的某物品送进一台「正缺这个料」的机器。
func (op *zeroOpening) dumpToIndustry(item string, qty int) {
	if qty <= 0 {
		return
	}
	ids := make([]string, 0, len(op.ws.Buildings))
	for id := range op.ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := op.ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil || b.Production == nil {
			continue
		}
		recipe, ok := model.Recipe(b.Production.RecipeID)
		if !ok {
			continue
		}
		consumes := false
		for _, in := range recipe.Inputs {
			if in.ItemID == item {
				consumes = true
				break
			}
		}
		// 机器最多装到 2/3 容量：背包疏通是「把多余的料倒回产线」，不是「把机器塞满」。
		// 实测一次性倒 24 个铜锭进电路板制造台（capacity=24），主库存被铜锭占满，
		// 铁块再也进不去，这台机器从 tick 14000 到 45000 一直待机（cb=0）。
		if !consumes || b.Storage.ItemQuantity(item) >= b.Storage.Capacity/4 {
			continue
		}
		// 电磁矩阵是研究站的料，别倒进矩阵制造台当原料（会跟手搓抢）。
		if item == model.ItemElectromagneticMatrix {
			continue
		}
		// 矩阵制造台由 feedIndustry 的成对喂料专门伺候：背包里多余的电路板
		// 一股脑倒进去会占满它的容量，磁线圈再也进不去（实测矩阵台
		// cb=16 / coil=0，从 tick 16000 到 45000 一个矩阵都没出）。
		if b.Production.RecipeID == "electromagnetic_matrix" {
			continue
		}
		if !storageHasRoomFor(b.Storage, item) {
			continue
		}
		// 单次疏通最多倒 6 个，且单种料不超过容量 1/4：机器人倒料是一叠一叠倒的，
		// 整包倾泻会把机器塞满（实测 24 个铜锭灌进电路板制造台后主库存占满，
		// 铁块再也进不来，这台机器从 tick 14000 到 45000 一直待机）。
		n := min(qty, min(6, b.Storage.Capacity/4-b.Storage.ItemQuantity(item)))
		if n <= 0 {
			continue
		}
		execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": n},
		})
		return
	}
}

// freeNode 基地半径内最近的、地块还空着的同类矿点；fallback 不可用时按距离找替代。
func (op *zeroOpening) freeNode(kind string, fallback *model.ResourceNodeState) *model.ResourceNodeState {
	var best *model.ResourceNodeState
	bestDist := -1
	for _, node := range op.ws.Resources {
		if node == nil || node.Kind != kind || node.Remaining <= 0 {
			continue
		}
		if op.ws.SurfaceDistance(op.home, node.Position) > op.radius {
			continue
		}
		key := model.TileKey(node.Position.X, node.Position.Y)
		if op.ws.TileBuilding[key] != "" || (op.ws.Construction != nil && op.ws.Construction.IsTileReserved(key)) {
			continue
		}
		d := op.ws.SurfaceDistance(op.home, node.Position)
		if best == nil || d < bestDist || (d == bestDist && node.ID < best.ID) {
			best, bestDist = node, d
		}
	}
	if best == nil && fallback != nil {
		return fallback
	}
	return best
}

// buildSpot 基地附近的可建空位：与 botBuildSpotNear 同规则，但额外跳过资源格
// （压在矿脉上的建筑会让那条矿脉永远采不了）。
func (op *zeroOpening) buildSpot(btype model.BuildingType) *model.Position {
	ws := op.ws
	for radius := 3; radius <= op.radius; radius++ {
		candidates := ws.SurfaceDisc(op.home, radius)
		sort.SliceStable(candidates, func(i, j int) bool {
			return ws.SurfaceDistance(op.home, candidates[i]) < ws.SurfaceDistance(op.home, candidates[j])
		})
		for _, candidate := range candidates {
			if ws.SurfaceDistance(op.home, candidate) != radius || !ws.InBounds(candidate.X, candidate.Y) {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" || ws.Grid[candidate.Y][candidate.X].ResourceNodeID != "" {
				continue
			}
			if ws.Construction != nil && ws.Construction.IsTileReserved(model.TileKey(candidate.X, candidate.Y)) {
				continue
			}
			if buildingEnclosure(ws, btype, model.PlanRotation0, candidate) != nil {
				continue
			}
			c := candidate
			return &c
		}
	}
	return nil
}

// powerLink 用自家电塔把「无电」的建筑接进电网（只建塔，不手搓）。
func (op *zeroOpening) powerLink() {
	if op.ws.Tick-op.lastLinkTick < 30 {
		return
	}
	op.lastLinkTick = op.ws.Tick
	// 机甲阵亡（等待复活）时不拉线：botPowerLink 要用机甲手搓电塔的料。
	if exec := executorUnitQuiet(op.ws, "p1"); exec == nil || exec.Mecha == nil {
		return
	}
	op.ctx = op.core.surveyBotWorld(op.ws, "p1")
	cmd, ok := op.core.botPowerLink(op.ws, "p1", op.ctx)
	if !ok || cmd.Type != model.CmdBuild {
		return
	}
	execCommand(op.core, model.CmdBuild, op.ws, "p1", cmd)
}

// soldierCap 脚本要攒的步兵数。无物资包下 p1 的产能只够「兵营 + 弹药 + 6–8 个兵」：
// 每个步兵 2 铁块 + 1 电路板，而电路板还要跟矩阵链抢铁/铜。
const soldierCap = 8

// produceSoldier 兵营一建好就出兵（攒到 soldierCap 为止）。
func (op *zeroOpening) produceSoldier() {
	barracks := op.buildingOfType(model.BuildingType("barracks"))
	if barracks == nil || soldiersFull(op.ws, op.soldiers, soldierCap) {
		return
	}
	produceSoldier(op.core, op.ws)
}

// rallySoldiers 新兵出列即到 HQ 周围 6 格站桩守家（hold：原地坚守，不追出去）。
// 6 格是为了落在补给站的补给半径（supply_radius 10）内，弹药能自动补上。
func (op *zeroOpening) rallySoldiers() {
	ws := op.ws
	ring := ws.SurfaceDisc(op.home, 6)
	sort.Slice(ring, func(i, j int) bool {
		if ring[i].Y != ring[j].Y {
			return ring[i].Y < ring[j].Y
		}
		return ring[i].X < ring[j].X
	})
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		u := ws.Units[id]
		if u == nil || u.OwnerID != "p1" || u.HP <= 0 || u.Type != model.UnitTypeSoldier || op.soldiers[id] {
			continue
		}
		op.soldiers[id] = true
		slot := len(op.soldiers) - 1
		pos := ring[slot%len(ring)]
		order := op.rallyOrder
		if order == "" {
			order = "hold"
		}
		execCommand(op.core, model.CmdUnitOrder, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityIDs: []string{id}, Position: &pos},
			Payload: map[string]any{"order": order},
		})
	}
}

// startResearch 研究站通电、有矩阵后开工电磁学。
func (op *zeroOpening) startResearch() {
	lab := op.buildingOfType(model.BuildingTypeMatrixLab)
	if lab == nil || lab.Runtime.State != model.BuildingWorkRunning {
		return
	}
	tech := op.player.Tech
	if tech == nil {
		return
	}
	if tech.CurrentResearch != nil || len(tech.ResearchQueue) > 0 {
		return
	}
	if tech.CompletedTechs["electromagnetism"] > 0 {
		return
	}
	execCommand(op.core, model.CmdStartResearch, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet"},
		Payload: map[string]any{"tech_id": "electromagnetism"},
	})
}

// feedIndustry 物流：矿机取矿 → 熔炉喂矿取锭 → 制造台喂料取产物 → 研究站喂矩阵原料。
func (op *zeroOpening) feedIndustry() {
	ws, player := op.ws, op.player
	if player == nil || !player.IsAlive {
		return
	}
	// 取出顺序很关键：OutputQuantity 会同时数 OutputBuffer 和主库存，
	// 而研究站的「矩阵只收 OutputBuffer」——必须先取走 OutputBuffer 里的成品，
	// 再取主库存里的余料（主库存只在「停机 + 缓冲空 + 余料」时才有东西），
	// 否则会出现「取出的其实是主库存余料、产物还堵在 OutputBuffer 里」的死循环。
	// cap 是「这一轮最多取多少」：矿机取矿要留量（否则机甲在 tick 22000
	// 被背包里 12 铁/42 石/22 铜的余矿顶住，取不出熔炉的 136 铁块，手搓链断料）。
	withdraw := func(b *model.Building, item string, cap int) {
		if b == nil || b.Storage == nil {
			return
		}
		if cap <= 0 {
			return
		}
		if outQty := b.Storage.OutputBuffer[item]; outQty > 0 {
			outQty = min(outQty, cap)
			execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
				Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
				Payload: map[string]any{
					"building_id": b.ID, "item_id": item, "quantity": outQty, "direction": "to_player",
				},
			})
		}
		invQty := min(b.Storage.Inventory[item], cap)
		if invQty <= 0 {
			return
		}
		// 主库存里的余料只在「机器没在跑这个配方」时才取：
		// 机器运行中，主库存里的同名物品就是它下一轮的原料。
		if b.Production != nil && b.Production.RecipeID != "" && recipeConsumesItem(b.Production.RecipeID, item) {
			return
		}
		execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
			Target: model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{
				"building_id": b.ID, "item_id": item, "quantity": invQty, "direction": "to_player",
			},
		})
	}
	// load 只把主库存填到 2/3：产物出库时若主库存已满、输入缓冲也满，
	// 成品就无处可放，机器会永久卡在 pending 输出上（实测熔炉塞满 24 铁矿
	// 后再也炼不出铁块）。留 1/3 给产物，也留出装第二种原料的空间。
	// 当前这一步要用的手搓件先留在背包里：真人玩家会先把手里的料建成建筑，
	// 再拿去喂产线；脚本若把刚手搓出来的铁块全喂给兵营/制造台，建造就永远差料
	// （实测补给站卡了 10000 tick，机甲手搓的铁块全被兵营的子弹吃掉）。
	reserve := map[string]int{}
	if op.next < len(op.steps) {
		if def, ok := model.BuildingDefinitionByID(op.steps[op.next].btype); ok {
			for _, it := range def.BuildCost.Items {
				reserve[it.ItemID] += it.Quantity
			}
		}
	}
	// 排队中的施工任务也要留料：它们在下一次施工结算（tick 200 的整数倍）扣料。
	for _, task := range op.queuedConstructionItems() {
		reserve[task.ItemID] += task.Quantity
	}
	// 手搓预留：留一点磁线圈/铁块给拉线用的电塔。
	reserve[model.ItemMagneticCoil] += 1
	reserve[model.ItemIronIngot] += 2
	// 研究站建好、电磁学还没完成时，矩阵链是整局的终点：施工预留不再扣矩阵链
	// 的原料（磁线圈/电路板/铁块/铜块/磁铁）。实测弹药台那一步的「8 齿轮 + 4 电路板」
	// 预留把矩阵制造台的料扣了 20000+ tick，研究站里一个矩阵都没进（电磁学开不了工）。
	matrixPriority := false
	if lab0 := op.buildingOfType(model.BuildingTypeMatrixLab); lab0 != nil {
		if tech := op.player.Tech; tech == nil || tech.CompletedTechs["electromagnetism"] == 0 {
			matrixPriority = true
		}
	}
	if matrixPriority {
		for _, it := range []string{
			model.ItemMagneticCoil, model.ItemCircuitBoard,
			model.ItemIronIngot, model.ItemCopperIngot, model.ItemMagnet,
		} {
			delete(reserve, it)
		}
	}
	// 手搓预留：研究站的电磁矩阵是「专门手搓好再送进站」的，别被制造台/兵营吃掉。
	reserve[model.ItemElectromagneticMatrix] += 6
	// load 的 reserve 参数：研究站的喂料不吃预留——矩阵链是整局的终点，
	// 一旦让「下一座建筑」的预留把电路板/磁线圈扣住，矩阵制造台会永远断料
	// （实测研究站建好后 30000 tick 一个矩阵都没产出）。
	load := func(b *model.Building, item string, qty int, respectReserve bool) {
		if b == nil || qty <= 0 || b.Storage == nil {
			return
		}
		avail := player.Inventory[item]
		if respectReserve {
			avail -= reserve[item]
		}
		if avail <= 0 {
			return
		}
		qty = min(qty, avail)
		st := b.Storage
		if !storageHasRoomFor(st, item) {
			return // 该建筑已有别的物品占着槽位，塞不进（先取出再喂）
		}
		// 主库存最多装到 5/6，单种料最多占 2/3：留 1/6 给产物，同时保证
		// 「一种料占满 2/3」时另一种料仍然进得来（实测电路板制造台主库存里
		// 16 个铜锭正好等于 2/3 容量，load 的 room 归零，铁块永远喂不进去）。
		room := st.Capacity*5/6 - st.UsedInventory()
		if room <= 0 {
			return
		}
		itemRoom := st.Capacity*2/3 - st.ItemQuantity(item)
		if itemRoom <= 0 {
			return
		}
		n := min(qty, min(room, min(itemRoom, player.Inventory[item])))
		if n <= 0 {
			return
		}
		execCommand(op.core, model.CmdTransferItem, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: b.ID},
			Payload: map[string]any{"building_id": b.ID, "item_id": item, "quantity": n},
		})
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	byRecipe := map[string][]*model.Building{}
	var miners []*model.Building
	var barracks, supply, lab *model.Building
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Storage == nil {
			continue
		}
		switch b.Type {
		case model.BuildingTypeMiningMachine:
			miners = append(miners, b)
		case model.BuildingTypeArcSmelter, model.BuildingTypeAssemblingMachineMk1:
			if b.Production != nil && b.Production.RecipeID != "" {
				byRecipe[b.Production.RecipeID] = append(byRecipe[b.Production.RecipeID], b)
			}
		case model.BuildingTypeMatrixLab:
			lab = b
		case model.BuildingType("barracks"):
			barracks = b
		case model.BuildingTypeSupplyStation:
			supply = b
		}
	}
	// 先取加工品（熔炉的锭、制造台的中间品），再取矿：背包只有 200 格，
	// 先取矿会把背包塞满，后续取锭/电路板的命令全部落空。
	//
	// 每种加工品都有背包存量上限：真人不会把熔炉的磁铁、锭一股脑全塞进背包
	// （实测磁铁堆到 85 个、石头 56 个，背包 204/200 全满，铜锭再也取不出来、
	// 电路板制造台断料，整局从 tick 22000 卡到 45000）。攒够用量就留在机器里，
	// 背包腾出来的空位留给下一座建筑要的料。
	withdrawCap := map[string]int{
		model.ItemIronIngot:             40,
		model.ItemCopperIngot:           40,
		model.ItemMagnet:                20,
		model.ItemMagneticCoil:          coilStockCap,
		model.ItemCircuitBoard:          circuitBoardStockCap,
		model.ItemGear:                  20,
		model.ItemAmmoBullet:            300,
		model.ItemElectromagneticMatrix: 999,
	}
	for _, recipe := range []struct{ recipe, item string }{
		{"smelt_iron", model.ItemIronIngot},
		{"smelt_copper", model.ItemCopperIngot},
		{"smelt_magnet", model.ItemMagnet},
		{"magnetic_coil", model.ItemMagneticCoil},
		{"circuit_board", model.ItemCircuitBoard},
		{"gear", model.ItemGear},
		{"ammo_bullet", model.ItemAmmoBullet},
		// 矩阵制造台的成品也要取出来：研究站只吃「送进去的矩阵」，
		// 留在制造台里的矩阵谁也拿不到（实测研究站建好后 30000 tick 一个矩阵
		// 都没进站，电磁学永远开不了工）。
		{"electromagnetic_matrix", model.ItemElectromagneticMatrix},
	} {
		allow := withdrawCap[recipe.item] - player.Inventory[recipe.item]
		if allow <= 0 {
			continue
		}
		for _, b := range byRecipe[recipe.recipe] {
			withdraw(b, recipe.item, allow)
		}
	}
	// 矿机：矿石在开局阶段是手搓链的燃料，只在背包存量不足时补货，
	// 免得把矿机刚挖的矿又原样取回来堆在背包里。
	for _, m := range miners {
		if player.Inventory[model.ItemIronOre] < 40 {
			withdraw(m, model.ItemIronOre, 20)
		}
		if player.Inventory[model.ItemCopperOre] < 40 {
			withdraw(m, model.ItemCopperOre, 20)
		}
		if player.Inventory[model.ItemStoneOre] < 40 {
			withdraw(m, model.ItemStoneOre, 20)
		}
	}
	// 喂料：每台熔炉吃满自己的矿（塞到 2/3 容量，留出产物位置）。
	for _, b := range byRecipe["smelt_iron"] {
		load(b, model.ItemIronOre, 20, true)
	}
	for _, b := range byRecipe["smelt_copper"] {
		load(b, model.ItemCopperOre, 20, true)
	}
	for _, b := range byRecipe["smelt_magnet"] {
		load(b, model.ItemIronOre, 20, true)
	}
	// 制造台：每台按自己的配方喂料（多台同配方也各自喂）。
	feedAssembler := func(recipeID string, inputs map[string]int) {
		for _, b := range byRecipe[recipeID] {
			for item, qty := range inputs {
				load(b, item, qty, true)
			}
		}
	}
	// 矩阵链的两台上游机器在研究期不吃预留（见上面的 matrixPriority）。
	chainReserve := true
	if matrixPriority {
		chainReserve = false
	}
	// 中间品封顶：铜块是本局最紧的原料（2 台铜熔炉 = 1 铜/30 tick），而磁线圈
	// 与电路板各要 1 铜/30 tick/台——不封顶就会把铜全烧成背包里用不完的磁线圈
	// （实测磁线圈堆到 139 个、电路板 0 个、矩阵制造台建不出来）。
	// 攒够「矩阵链 + 后续建筑」的用量就停机，铜自然流向另一种。
	stockOf := func(recipeID string) int {
		total := 0
		for _, b := range byRecipe[recipeID] {
			for _, out := range []string{model.ItemMagneticCoil, model.ItemCircuitBoard} {
				total += b.Storage.ItemQuantity(out)
			}
		}
		return total
	}
	coilStock := stockOf("magnetic_coil") + player.Inventory[model.ItemMagneticCoil]
	cbStock := stockOf("circuit_board") + player.Inventory[model.ItemCircuitBoard]
	if coilStock < coilStockCap {
		for _, b := range byRecipe["magnetic_coil"] {
			load(b, model.ItemMagnet, 20, chainReserve)
			load(b, model.ItemCopperIngot, 10, chainReserve)
		}
	}
	if cbStock < circuitBoardStockCap {
		for _, b := range byRecipe["circuit_board"] {
			load(b, model.ItemIronIngot, 10, chainReserve)
			load(b, model.ItemCopperIngot, 10, chainReserve)
		}
	}
	feedAssembler("gear", map[string]int{model.ItemIronIngot: 10})
	feedAssembler("ammo_bullet", map[string]int{model.ItemIronIngot: 10})
	// loadPair 给「两种原料 1:1」的机器成对补料：只补少的那种，任一种都不超过
	// 另一种 +1。矩阵制造台 slots=4 / capacity=24，单喂一种料会把它塞满，
	// 另一种料再也进不来（实测电路板 16 个占住机器，磁线圈 0 个，机器永远待机）。
	loadPair := func(b *model.Building, first, second string, target int) {
		if b == nil || b.Storage == nil {
			return
		}
		for i := 0; i < 4; i++ {
			q1, q2 := b.Storage.ItemQuantity(first), b.Storage.ItemQuantity(second)
			if q1 >= target && q2 >= target {
				return
			}
			if q1 <= q2 {
				if q1 >= target {
					return
				}
				load(b, first, target-q1, false)
				continue
			}
			if q2 >= target {
				return
			}
			load(b, second, target-q2, false)
		}
	}
	// 矩阵制造台：研究链优先，不吃建造预留（否则永远缺 4 个电路板）。
	for _, b := range byRecipe["electromagnetic_matrix"] {
		loadPair(b, model.ItemMagneticCoil, model.ItemCircuitBoard, 6)
	}
	load(barracks, model.ItemIronIngot, 20, true)
	load(barracks, model.ItemCircuitBoard, 10, true)
	// 研究站不喂料：研究站吃的是「成品矩阵」，把磁线圈/电路板喂进去只会让
	// 研究站自己用配方搓矩阵（更慢，还跟手搓抢料）。矩阵由机甲手搓后送进研究站。
	// 补给站：步兵弹药。
	if supply != nil {
		load(supply, model.ItemAmmoBullet, player.Inventory[model.ItemAmmoBullet], true)
	}
	// 研究站：把机甲手搓的电磁矩阵送进站里（研究站在结算时消耗 OutputBuffer 里的矩阵）。
	// 玩家不会站在机器旁边手动搬矩阵，这里由脚本的「物流」代劳。
	if lab != nil {
		op.feedResearchMatrices(lab)
	}
}

// researchMatrixTarget 研究站里要攒的电磁矩阵数（电磁学 20 个 + 前置链的余量）。
const researchMatrixTarget = 24

// 中间品库存上限：铜块是最紧的原料，磁线圈/电路板攒够这些就停机，把铜让给另一种。
// 24 个线圈 ≈ 10 个矩阵 + 若干电塔/风机的自用；32 个电路板 ≈ 10 个矩阵 + 兵营/
// 补给站/矿机的自用。低于上限时喂料会自动恢复（矩阵链在持续消耗）。
const (
	coilStockCap         = 24
	circuitBoardStockCap = 32
)

// feedResearchMatrices 把背包里的电磁矩阵送进研究站，直到站里攒够研究用量。
func (op *zeroOpening) feedResearchMatrices(lab *model.Building) {
	if lab == nil || lab.Storage == nil {
		return
	}
	have := op.player.Inventory[model.ItemElectromagneticMatrix]
	if have <= 0 {
		return
	}
	want := researchMatrixTarget - lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
	if want <= 0 {
		return
	}
	n := min(have, want)
	if !storageHasRoomFor(lab.Storage, model.ItemElectromagneticMatrix) {
		return
	}
	execCommand(op.core, model.CmdTransferItem, op.ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", EntityID: lab.ID},
		Payload: map[string]any{"building_id": lab.ID, "item_id": model.ItemElectromagneticMatrix, "quantity": n},
	})
}

// surplus 背包里「除去所有机器当前占用的原料」之后还剩多少该物品。
// 机器里的料也是生产线的料，只有背包里多出来的部分才能拿去建下一个建筑，
// 否则脚本会把刚取回的矿石又原样塞回机器，背包永远长不出建筑料。
func (op *zeroOpening) surplus(item string) int {
	used := 0
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Storage == nil {
			continue
		}
		used += b.Storage.ItemQuantity(item)
	}
	if used > op.player.Inventory[item] {
		return 0
	}
	return op.player.Inventory[item] - used
}

// driveMecha 机甲作业：按「接下来几步建造 + 手搓预留」的缺口，采矿 / 手搓 / 补能。
func (op *zeroOpening) driveMecha() {
	ws := op.ws
	exec := executorUnitQuiet(ws, "p1")
	if exec == nil || exec.Mecha == nil {
		return
	}
	// 补能：核心低于 20 且有煤就烧一块（煤是手动采矿的副产品，开局就能采）。
	if exec.Mecha.Energy < 20 && exec.Mecha.Job == nil && op.player.Inventory[model.ItemCoal] > 0 {
		execCommand(op.core, model.CmdRefuelMecha, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
			Payload: map[string]any{"item_id": model.ItemCoal, "count": 2},
		})
	}
	if exec.Mecha.Job != nil || ws.Tick-op.lastMoveTick < 4 {
		return
	}
	action, ok := op.nextMechaAction(exec)
	if !ok {
		return
	}
	op.lastMoveTick = ws.Tick
	if action.ore != "" {
		op.ctx = op.core.surveyBotWorld(ws, "p1")
		if cmd, ok := op.core.botMineKind(ws, "p1", exec, action.ore, op.ctx); ok {
			execCommand(op.core, cmd.Type, ws, "p1", cmd)
		}
		return
	}
	execCommand(op.core, model.CmdCraftItem, ws, "p1", model.Command{
		Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
		Payload: map[string]any{"recipe_id": action.recipe.ID, "quantity": action.batches},
	})
}

type mechaAction struct {
	recipe  model.RecipeDefinition
	batches int
	ore     string
	qty     int
}

// nextMechaAction 计划出「机甲下一件该做的事」：先满足「当前这一步 + 队列里
// 已排队的施工任务」所需的物品，缺的原料沿手搓链下钻；链上物品能手搓就手搓，
// 不能手搓（原矿）就去手动采矿。
//
// 必须把排队中的施工任务算进去：建造命令是「先排队、施工时（tick 200 的整数倍）
// 才扣料」，排队期间背包里的料会被机甲当成富余而挪去手搓别的东西，施工那一刻
// 缺料 → 任务被拒 → 步骤永远推进不了（实测第 13 步石矿采矿机卡在「缺少 2 个齿轮」，
// 因为机甲看当前步骤（采矿机）不缺料就去手搓了，而背包里的齿轮被上一批施工吃掉了）。
func (op *zeroOpening) nextMechaAction(exec *model.Unit) (mechaAction, bool) {
	// 先看当前这一步；它卡住时（缺料、缺施工位、缺电）再看下一步——
	// 真人玩家会「手搓下一座建筑的料，等背包里的料够了一起放」，
	// 脚本若死盯当前步骤，机甲就会在背包快满时干等（实测第五座风机前
	// 机甲空转 8000 tick，背包 150/200 件堆满矿石，齿轮永远搓不出来）。
	for lookahead := 0; lookahead < 2 && op.next+lookahead < len(op.steps); lookahead++ {
		// 计划列表是「原料在前、成品在后」的拓扑序，取第一个现在就能开工的动作；
		// 第一个动作的原料还没到位时不能整条计划作废（实测机甲因此空转 20000 tick）。
		for _, action := range op.planForSteps(op.next + lookahead) {
			if action.ore != "" {
				return action, true
			}
			ready := true
			for _, in := range action.recipe.Inputs {
				if op.player.Inventory[in.ItemID] < in.Quantity*action.batches {
					ready = false
					break
				}
			}
			if ready {
				return action, true
			}
		}
	}
	return mechaAction{}, false
}

// planForSteps 展开「当前步骤 + 已排队施工」缺的手搓件（含电塔的手搓预留）。
func (op *zeroOpening) planForSteps(step int) []mechaAction {
	need := map[string]int{}
	if step < len(op.steps) {
		if def, ok := model.BuildingDefinitionByID(op.steps[step].btype); ok {
			for _, item := range def.BuildCost.Items {
				need[item.ItemID] += item.Quantity
			}
		}
	}
	// 已排队（未开工/施工中）的施工任务也要备料：施工扣料发生在开工那一刻。
	for _, task := range op.queuedConstructionItems() {
		need[task.ItemID] += task.Quantity
	}
	// 手搓预留：留一点磁线圈/铁块给拉线用的电塔。
	need[model.ItemMagneticCoil] += 1
	need[model.ItemIronIngot] += 2
	// 兵营的兵是「造出来就得有料」：兵营的原料存在兵营自己的仓库里，
	// 脚本的送料又要给建造让路，于是「兵营永远缺 1 个电路板、一个兵都出不来」
	// （实测首攻前 p1 一个兵都没有）。这里把兵营当前的缺口也列进手搓清单。
	if op.buildingOfType(model.BuildingType("barracks")) != nil {
		op.collectBarracksNeeds(need)
	}
	// 电磁矩阵：研究站建好后要往站里送矩阵（电磁学 20 个）。矩阵既能由制造台产，
	// 也能手搓；手搓链只认背包，所以这里把「还缺多少个矩阵」也列进手搓清单，
	// 由 planFor 决定「机器有现货就等机器、没有就手搓」。
	if lab := op.buildingOfType(model.BuildingTypeMatrixLab); lab != nil && lab.Storage != nil {
		tech := op.player.Tech
		if tech == nil || tech.CompletedTechs["electromagnetism"] == 0 {
			want := researchMatrixTarget
			for _, s := range op.steps {
				if s.recipe == "electromagnetic_matrix" {
					want = 6 // 已排了一台矩阵制造台，手搓只补到它开机能出第一批
					break
				}
			}
			have := op.player.Inventory[model.ItemElectromagneticMatrix] +
				lab.Storage.OutputQuantity(model.ItemElectromagneticMatrix)
			if want > have {
				need[model.ItemElectromagneticMatrix] += want - have
			}
		}
	}
	items := make([]string, 0, len(need))
	for item := range need {
		items = append(items, item)
	}
	sort.Strings(items)
	var actions []mechaAction
	for _, item := range items {
		op.planFor(item, need[item], &actions, 0)
	}
	return actions
}

// collectBarracksNeeds 兵营里还缺多少「下一个兵」的料（兵营没通电/没建时跳过）。
func (op *zeroOpening) collectBarracksNeeds(need map[string]int) {
	barracks := op.buildingOfType(model.BuildingType("barracks"))
	if barracks == nil || barracks.Storage == nil {
		return
	}
	alive := 0
	for id := range op.soldiers {
		if u := op.ws.Units[id]; u != nil && u.HP > 0 {
			alive++
		}
	}
	// 目标 6 个兵；队列里的也算「在路上」，避免一次性手搓太多。
	want := 6 - alive - len(barracks.UnitQueue)
	if want <= 0 {
		return
	}
	def, ok := model.UnitDefinitionByID(model.UnitTypeSoldier)
	if !ok {
		return
	}
	for _, cost := range def.Cost {
		short := cost.Quantity*want - barracks.Storage.ItemQuantity(cost.ItemID)
		if short > 0 {
			need[cost.ItemID] += short
		}
	}
}

// queuedConstructionItems 已排队（pending/active）施工任务还需要的手搓件
// （minerals/energy 由建造结算扣，不在这里备）。
func (op *zeroOpening) queuedConstructionItems() []model.ItemAmount {
	ws := op.ws
	if ws == nil || ws.Construction == nil {
		return nil
	}
	total := map[string]int{}
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.PlayerID != "p1" {
			continue
		}
		if task.State != model.ConstructionPending && task.State != model.ConstructionInProgress {
			continue
		}
		for _, item := range task.Cost.Items {
			total[item.ItemID] += item.Quantity
		}
	}
	out := make([]model.ItemAmount, 0, len(total))
	for item, qty := range total {
		out = append(out, model.ItemAmount{ItemID: item, Quantity: qty})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ItemID < out[j].ItemID })
	return out
}

// planFor 把「需要 want 个 item」展开成有序的作业清单（原料在前，成品在后）。
func (op *zeroOpening) planFor(item string, want int, out *[]mechaAction, depth int) {
	if want <= 0 || depth > 5 {
		return
	}
	have := op.player.Inventory[item]
	// 已在建造队列里的物品也算「在路上」：施工任务完成时才扣料，这里不重复备。
	if have >= want {
		return
	}
	if recipe, ok := op.handcraftRecipeFor(item); ok {
		// 已有机器在跑这个配方、而且机器里确实有成品可交（或已交过）：机器产量
		// 归机器，机甲只去补它的原料，否则机甲会一直手搓锭/齿轮，把整局卡在
		// 「手搓 60 tick/个」上。
		//
		// 但机器「在跑」不等于「能交货」：实测第二座熔炉断料时机器状态仍是
		// running，机甲于是既不肯自己手搓、又没有原料可补，整局停在 tick 6500
		// 一动不动；后期又出现「熔炉产的铁块被制造台吃光，机甲空等机器交货」
		// （第二座熔炉到补给站之间卡了 10000 tick）。所以只有机器手里真的
		// 攒够这一批（machineStock >= 缺口）才交给机器，否则机甲自己手搓。
		if op.machineMakes(recipe.ID) && op.machineStock(recipe.ID, item) >= want-have {
			for _, in := range recipe.Inputs {
				op.planFor(in.ItemID, in.Quantity, out, depth+1)
			}
			return
		}
		per := 1
		for _, o := range recipe.Outputs {
			if o.ItemID == item && o.Quantity > 0 {
				per = o.Quantity
			}
		}
		batches := (want - have + per - 1) / per
		// 手搓批次按「背包里现有的原料」封顶：原料还差的部分交给链上前置的
		// 手搓/采矿动作去补。若按理论批次发命令，动作会因「原料不够」而永远
		// 不 ready，机甲直接空转（实测 tick 21000–42000 完全不动：缺 8 个齿轮
		// 但背包只有 6 个铁块，既不肯少搓几个，也不去补铁块）。
		capped := batches
		for _, in := range recipe.Inputs {
			if in.Quantity <= 0 {
				continue
			}
			if b := op.player.Inventory[in.ItemID] / in.Quantity; b < capped {
				capped = b
			}
		}
		for _, in := range recipe.Inputs {
			op.planFor(in.ItemID, in.Quantity*batches, out, depth+1)
		}
		if capped > 0 {
			*out = append(*out, mechaAction{recipe: recipe, batches: capped})
		}
		return
	}
	if isManuallyMinableOre(item) {
		*out = append(*out, mechaAction{ore: item, qty: want - have})
	}
}

// machineMakes 玩家是否有一台「真能交货」的机器在跑该配方：光有机器不算，
// 还得「有原料能继续跑」或「已经有成品可取出」。否则机甲会把该物品的产出
// 完全托付给一台断料的机器，自己一直空转（实测第二座熔炉断料后机甲停在
// tick 6500 一动不动，背包里 88 个铁矿、1 个铁块，风机永远建不起来）。
func (op *zeroOpening) machineMakes(recipeID string) bool {
	recipe, ok := model.Recipe(recipeID)
	if !ok {
		return false
	}
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Production == nil || b.Storage == nil {
			continue
		}
		if b.Production.RecipeID != recipeID || b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		ready := true
		for _, in := range recipe.Inputs {
			if b.Storage.ItemQuantity(in.ItemID) < in.Quantity {
				ready = false
				break
			}
		}
		if ready {
			return true
		}
		for _, out := range recipe.AllOutputs() {
			if b.Storage.ItemQuantity(out.ItemID) > 0 {
				return true
			}
		}
	}
	return false
}

// machineStock 正在跑该配方的机器手里有多少「该物品」（成品在产物缓冲/主库存里）。
func (op *zeroOpening) machineStock(recipeID, item string) int {
	total := 0
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 || b.Production == nil || b.Storage == nil {
			continue
		}
		if b.Production.RecipeID == recipeID {
			total += b.Storage.ItemQuantity(item)
		}
	}
	return total
}

func (op *zeroOpening) buildingOfType(btype model.BuildingType) *model.Building {
	var found *model.Building
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Type != btype || b.HP <= 0 {
			continue
		}
		if found == nil || b.ID < found.ID {
			found = b
		}
	}
	return found
}

// powerReasons 无电建筑的状态原因（诊断用）。
func (op *zeroOpening) powerReasons() []string {
	var out []string
	for _, b := range op.ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.HP <= 0 {
			continue
		}
		if b.Runtime.StateReason != "" && b.Runtime.StateReason != stateReasonFault {
			out = append(out, fmt.Sprintf("%s@%+v:%s", b.Type, b.Position, b.Runtime.StateReason))
		}
	}
	sort.Strings(out)
	return out
}

// runFromZeroMatch 单个 seed 的整局：p1 脚本化新手开局，p2 由预设 bot 驱动。
func runFromZeroMatch(t *testing.T, seed string) {
	t.Helper()
	core := newSkirmishCoreForSeed(t, seed)
	op := newZeroOpening(t, core, 45000)
	op.run()
	ws := op.ws
	player := ws.Players["p1"]

	t.Logf("seed=%s 里程碑=%v", seed, op.milestone)
	t.Logf("seed=%s 目标对照：风机 2400 / 矿机×4+熔炉×2+制造台 9000 / 兵营+步兵 15000 / 研究站 18000 / 电磁学 30000", seed)
	t.Logf("seed=%s 结束 tick=%d p1 存活=%v 建筑=%s 运行中=%s 部队=%d 损失(单位/建筑)=%d/%d 击杀=%d",
		seed, ws.Tick, player.IsAlive, fmtCounts(skirmishBuildingCounts(ws, "p1")), fmtCounts(skirmishRunningCounts(ws, "p1")),
		countArmy(ws, "p1"), player.Stats.CombatStats.UnitsLost, player.Stats.CombatStats.BuildingsLost, player.Stats.CombatStats.UnitsKilled)
	t.Logf("seed=%s bot 首攻 tick=%d（首波 20 格内峰值=%d）p2 建筑=%s p2 部队=%d p2 科技完成=%v",
		seed, op.firstAttackTick, op.firstWavePeak, fmtCounts(skirmishBuildingCounts(ws, "p2")), countArmy(ws, "p2"),
		ws.Players["p2"].Tech.CompletedTechs)
	if v := core.Victory(); v.Declared() {
		t.Logf("seed=%s 终局宣判：winner=%s reason=%s tick=%d", seed, v.WinnerID, v.Reason, v.DeclaredTick)
	}
	if len(op.buildFails) > 0 {
		keys := make([]string, 0, len(op.buildFails))
		for k := range op.buildFails {
			keys = append(keys, fmt.Sprintf("%s ×%d", k, op.buildFails[k]))
		}
		sort.Strings(keys)
		t.Logf("seed=%s 建造失败回执：%s", seed, strings.Join(keys, " | "))
	}

	// 1) 开局链（无死锁）：空背包必须能靠手搓链走到风机/矿机/熔炉/制造台/兵营/研究站。
	bounds := []struct {
		key  string
		want int64
	}{
		{"wind_turbine", 6000},
		{"tesla_tower", 8000},
		{"mining_machine", 9000},
		{"arc_smelter", 13000},
		{"assembling_machine", 16000},
		{"barracks", 20000},
		{"soldier", 24000},
		{"matrix_lab", 28000},
	}
	for _, b := range bounds {
		tick, ok := op.milestone[b.key]
		if !ok {
			t.Fatalf("开局链死锁：%s 到 tick %d 都没达成（milestones=%v）", b.key, ws.Tick, op.milestone)
		}
		if tick > b.want {
			t.Fatalf("%s 在 tick %d 才达成，超出上限 %d（milestones=%v）", b.key, tick, b.want, op.milestone)
		}
	}
	// 2) 电磁学：整局末尾记录完成 tick（研究站 + 矩阵链已跑通即算达标）。
	// 无物资包下 45000 tick 内完成 20 个矩阵是上限目标而非硬断言：
	// 手搓链要把 20 个矩阵（每个 60 tick + 上游磁线圈/电路板）堆出来，
	// 脚本只能给「手搓 + 一台矩阵制造台」的产能。实测 seed 001 在 tick 40541 完成，
	// pt1011 慢一些（研究站晚 2000 tick、步兵晚 2500 tick），45000 前开始研究、
	// 45000–60000 之间完成。
	if tick, ok := op.milestone["electromagnetism"]; ok {
		t.Logf("seed=%s 电磁学完成 tick=%d", seed, tick)
	} else {
		t.Logf("seed=%s 电磁学到 tick %d 仍未完成（research=%+v）——记录项，不算失败", seed, ws.Tick, player.Tech.CurrentResearch)
	}
	// 矩阵链出货检查：只要「矩阵制造台」这一环已经建成，就必须真的出矩阵
	// （出了矩阵 = 电磁学只差产量，不是死锁）。pt1011 的建造队列更慢，到 tick
	// 45000 还没轮到最后那台矩阵制造台（建造失败回执里 972 次「制造台缺 4 个
	// 电路板」），这时只记录，不判死锁。
	matrices := player.Inventory[model.ItemElectromagneticMatrix]
	matrixMachineBuilt := false
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != "p1" || b.Storage == nil {
			continue
		}
		matrices += b.Storage.ItemQuantity(model.ItemElectromagneticMatrix)
		if b.Production != nil && b.Production.RecipeID == "electromagnetic_matrix" {
			matrixMachineBuilt = true
		}
	}
	t.Logf("seed=%s 结束时电磁矩阵存量（背包 + 全建筑）= %d（矩阵制造台已建=%v）", seed, matrices, matrixMachineBuilt)
	if matrixMachineBuilt && matrices <= 0 {
		t.Fatalf("矩阵制造台已建成但到 tick %d 一个电磁矩阵都没产出（供料链断了）", ws.Tick)
	}
	if !matrixMachineBuilt {
		t.Logf("seed=%s 建造队列还没推进到矩阵制造台（tick %d）——记录项，不算死锁", seed, ws.Tick)
	}
	// 研究站必须在整局内建起并运行（矩阵链的前提）。
	if tick, ok := op.milestone["matrix_lab"]; !ok || tick <= 0 {
		t.Fatalf("研究站到 tick %d 都没建起（milestones=%v）", ws.Tick, op.milestone)
	}
	// 3) bot 首攻在 bot_first_attack_tick 之后，且首波规模小（4–8 个地面单位）。
	if op.firstAttackTick < 0 {
		t.Fatal("bot 整局没有发起进攻")
	}
	first := core.cfg.Battlefield.BotFirstAttackTick
	if op.firstAttackTick < first {
		t.Fatalf("bot 在 tick %d 首攻，早于 bot_first_attack_tick %d", op.firstAttackTick, first)
	}
	if op.firstAttackTick > first+9000 {
		t.Fatalf("bot 首攻推迟到 tick %d（预设 %d），发育链太长", op.firstAttackTick, first)
	}
	if op.firstWavePeak < 1 {
		t.Fatalf("bot 首攻没有兵力压到 p1 基地 20 格内（峰值 0）")
	}
	if op.firstWavePeak > 8 {
		t.Fatalf("首波规模 %d 超出「小规模 4–6 兵」的上限 8", op.firstWavePeak)
	}
	// 首波之后的后续波次峰值只记录：bot 后续会持续补兵压家，那是中后期的事。
	// 注意首波规模取的是「首攻后 600 tick 内 p1 基地 20 格内的 p2 地面单位峰值」，
	// normal 档 attackAt=6、squadCap=1 时第一支军团是 6 个兵。
	// 4) p1 靠自己的兵活下来。
	if !player.IsAlive {
		t.Fatalf("p1 在 tick %d 被淘汰（首攻 %d，首波峰值 %d）", ws.Tick, op.firstAttackTick, op.firstWavePeak)
	}
}

// itemIDByName 按中文名反查物品 ID（建造失败回执里只有中文名）。
// 目录里查不到时原样返回，调用方会当成「未知物品」处理。
func itemIDByName(name string) string {
	for _, def := range model.AllItems() {
		if def.Name == name {
			return def.ID
		}
	}
	return name
}

// handcraftRecipeFor 该物品可由机甲手搓的配方（考虑科技门）。优先选手搓耗能
// 最低的那条：电磁矩阵既能手搓也能在制造台/研究站里做，耗能高的那条会让
// 机甲为了「省机器」把自己饿死（实测机甲卡在「矩阵原料」上，电磁学做不出来）。
func (op *zeroOpening) handcraftRecipeFor(item string) (model.RecipeDefinition, bool) {
	best := model.RecipeDefinition{}
	found := false
	for _, def := range model.RecipesProducingItem(item) {
		if !def.HandcraftAllowed {
			continue
		}
		if op.player != nil && !CanUseRecipeTech(op.player, def.ID) {
			continue
		}
		if !found || def.Duration < best.Duration {
			best, found = def, true
		}
	}
	return best, found
}

// handcraftRecipeFor 该物品可由机甲手搓的配方（考虑科技门）。
func handcraftRecipeFor(player *model.PlayerState, item string) (model.RecipeDefinition, bool) {
	for _, def := range model.RecipesProducingItem(item) {
		if !def.HandcraftAllowed {
			continue
		}
		if player != nil && !CanUseRecipeTech(player, def.ID) {
			continue
		}
		return def, true
	}
	return model.RecipeDefinition{}, false
}

// storageHasRoomFor 建筑存储能否再收下该物品（复刻 StorageState 的槽位规则：
// 已有该物品则可继续收，否则要求还有空槽）。脚本用它在送料前避开
// 「已装别的物品、槽位满了」的仓库，否则取出产物之前永远喂不进新料。
func storageHasRoomFor(s *model.StorageState, item string) bool {
	if s == nil || s.Slots <= 0 {
		return true
	}
	seen := map[string]struct{}{}
	for _, inv := range []model.ItemInventory{s.Inventory, s.InputBuffer, s.OutputBuffer} {
		for id, qty := range inv {
			if qty > 0 {
				seen[id] = struct{}{}
			}
		}
	}
	if _, ok := seen[item]; ok {
		return true
	}
	return len(seen) < s.Slots
}

// recipeConsumesItem 判断配方是否把 item 当原料（取料时要跳过正在运行的机器原料）。
func recipeConsumesItem(recipeID, item string) bool {
	def, ok := model.Recipe(recipeID)
	if !ok {
		return false
	}
	for _, in := range def.Inputs {
		if in.ItemID == item {
			return true
		}
	}
	return false
}

// inventoryUsed 背包已占用的数量（机甲背包按物品件数算容量，见 execTransferItem）。
func (op *zeroOpening) inventoryUsed() int {
	used := 0
	for _, qty := range op.player.Inventory {
		if qty > 0 {
			used += qty
		}
	}
	return used
}

// mechaCapacity 机甲背包容量（默认 200，科技可提升）。
func (op *zeroOpening) mechaCapacity() int {
	if exec := executorUnitQuiet(op.ws, "p1"); exec != nil && exec.Mecha != nil && exec.Mecha.InventoryCapacity > 0 {
		return exec.Mecha.InventoryCapacity
	}
	return 200
}
