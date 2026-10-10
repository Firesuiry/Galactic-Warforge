package gamecore

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 第 13 轮试玩（tmp/playtest-1013）报告 A 的调查探针：
//
//	「首攻后玩家没有防御手段，约 tick 24800 必然被淘汰」
//
// 本探针不改平衡，只回答一个问题：遭遇战预设（config-skirmish + map-skirmish，
// bot hard / enemy normal）下，玩家 p1 用**开局物资包能换到的东西**布防
// ——兵营 barracks + 步兵 soldier + 子弹 ammo_bullet + 补给站 supply_station +
// 执行体机甲——能不能扛住 bot 首攻（bot_first_attack_tick=16000）和后续 2–3 波？
//
// p1 的脚本就是一个照着 UI 点的真人：风机/电塔/矿机/熔炉/制造台起产线，
// 出电路板与子弹，建兵营与补给站，兵营出 8 个步兵，弹药灌进补给站，
// 步兵站到 HQ 周围一圈的阵位上（姿态 hold：原地坚守，不追出基地），
// 机甲留在家里自动还手。不造炮塔（高斯机枪塔要武器系统，
// 而武器系统要先有电磁学 20 矩阵——正是报告 A 说的问题）。
//
// 跑到 tick 26000，输出 p1 是否存活、首攻时间与规模、进攻波次（各波 20 格内兵力峰值）、
// 双方兵力与损失。两种姿态（hold / attack_move）实测结果一致，只保留 hold 省一半时间。
// 跑得慢（2 seed 约 2–3 分钟）：`go test -short` 会跳过。
//
// 单跑方式：
//
//	cd server && go test ./internal/gamecore/ -run TestSkirmishDefenseProbe -v -timeout 30m
func TestSkirmishDefenseProbe(t *testing.T) {
	if testing.Short() {
		t.Skip("整局遭遇战探针（每 seed 约 2–3 分钟）")
	}
	for _, seed := range []string{"skirmish-seed-001", "pt1011-0e2bz1"} {
		// hold 与 attack_move 实测逐 tick 结果一致（bot 是先到先打，站桩与前顶
		// 都不改变交火顺序），只保留 hold，省一半墙钟时间。
		for _, stance := range []string{"hold"} {
			t.Run(seed+"/"+stance, func(t *testing.T) {
				runSkirmishDefenseProbe(t, seed, stance)
			})
		}
	}
}

// defenseBuildStep 一条建造计划：矿机压在自己的矿点上，其余用基地附近空位。
type defenseBuildStep struct {
	btype  model.BuildingType
	recipe string
	node   *model.ResourceNodeState
}

func runSkirmishDefenseProbe(t *testing.T, seed, stance string) {
	t.Helper()
	core := newSkirmishCoreForSeed(t, seed)
	ws := core.World()
	player := ws.Players["p1"]
	p1Home := botPlayerHQ(t, ws, "p1").Position

	ctx := core.surveyBotWorld(ws, "p1")
	radius := botConstructRadius(ws, "p1", ctx)
	// 守家阵地：HQ 周围 3 格的一圈（hold 站桩；attack_move 则从阵地上前顶）。
	var ring []model.Position
	for _, p := range ws.SurfaceDisc(p1Home, 3) {
		if ws.SurfaceDistance(p1Home, p) == 3 && ws.InBounds(p.X, p.Y) && ws.Grid[p.Y][p.X].Terrain.Buildable() {
			ring = append(ring, p)
		}
	}
	if len(ring) == 0 {
		t.Fatal("HQ 周围没有可站的地面单位阵地")
	}
	stanceIndex := 0
	nextRally := func() model.Position {
		p := ring[stanceIndex%len(ring)]
		stanceIndex++
		return p
	}

	// 基地建造半径内最近的铁矿 ×2、铜矿 ×1（开局物资包只够 3 座矿机的电路板）。
	var ironNodes, copperNodes []*model.ResourceNodeState
	for _, node := range ws.Resources {
		if ws.SurfaceDistance(p1Home, node.Position) > radius || ws.TileBuilding[model.TileKey(node.Position.X, node.Position.Y)] != "" {
			continue
		}
		switch node.Kind {
		case model.ItemIronOre:
			ironNodes = append(ironNodes, node)
		case model.ItemCopperOre:
			copperNodes = append(copperNodes, node)
		}
	}
	byDistance := func(nodes []*model.ResourceNodeState) {
		sort.Slice(nodes, func(i, j int) bool {
			di, dj := ws.SurfaceDistance(p1Home, nodes[i].Position), ws.SurfaceDistance(p1Home, nodes[j].Position)
			if di != dj {
				return di < dj
			}
			return nodes[i].ID < nodes[j].ID
		})
	}
	byDistance(ironNodes)
	byDistance(copperNodes)
	if len(ironNodes) < 2 || len(copperNodes) < 1 {
		t.Fatalf("need 2 iron + 1 copper node near home, got %d/%d", len(ironNodes), len(copperNodes))
	}

	// 开局物资包（铁块 110 / 齿轮 40 / 磁线圈 30 / 电路板 24 / 石砖 4 / 玻璃 4，
	// 矿物 1200 / 能量 400）。24 块电路板是硬预算，按"真人先把兵营排进预算"的顺序花：
	//   矿机 ×3（2 板/座）= 6，熔炉 ×2（4 板/座）= 8 → 14，
	//   电路板制造台 4 → 18，兵营 4 → 22，补给站 2 → 24。
	// 子弹制造台的 4 块电路板只能自己产（所以它排在最后，等电路板制造台出货）。
	// 石砖只有 4 块，所以熔炉最多两座（每座 2 块）——这决定了铁块产能：
	// 一座铁熔炉在 pace_output=2 下是 120 tick/铁块，10000 tick 约 83 块铁，
	// 是「子弹够不够」的真正瓶颈（试玩报告 A 的直观感受来源之一）。
	steps := []defenseBuildStep{
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeMiningMachine, node: ironNodes[0]},
		{btype: model.BuildingTypeMiningMachine, node: copperNodes[0]},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_iron"},
		{btype: model.BuildingTypeArcSmelter, recipe: "smelt_copper"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "circuit_board"},
		{btype: model.BuildingType("barracks")},
		{btype: model.BuildingTypeSupplyStation},
		{btype: model.BuildingTypeAssemblingMachineMk1, recipe: "ammo_bullet"},
		{btype: model.BuildingTypeWindTurbine},
		{btype: model.BuildingTypeMiningMachine, node: ironNodes[1]},
	}

	const (
		simTicks   = 26000
		cmdEvery   = 30 // UI 正常速度：约 3 秒一条命令
		feedEvery  = 60 // 物流节拍
		soldierCap = 8
	)

	next := 0
	soldiers := map[string]bool{}
	var buildFail string
	barracksBuiltAt, firstSoldierAt := int64(-1), int64(-1)
	var firstApproach int64 = -1
	firstWaveSize := 0
	var waves []int64
	// wavePeak 与 waves 一一对应：该波开始后 600 tick 内，p1 基地 20 格范围内的
	// p2 地面单位峰值（= 这一波真正压上来的兵力）。
	var wavePeak []int
	lastApproach := int64(-1 << 40)
	var hqLostAt int64 = -1
	var eliminatedAt int64 = -1

	// buildDeadlineTick 建造段最多跑到这里（快进段，约 12 分钟游戏时间）；超时就带着
	// 半成品进战斗段，并把进度写进日志。
	const buildDeadlineTick = int64(7500)

	// 物流：矿机的矿送进熔炉、熔炉的锭送进制造台、制造台的电路板与子弹回背包。
	// 背包只有 200 格：给料太稀（60 tick 一次取三座矿机的 480 矿）会先把背包挤爆，
	// 之后的取锭/取电路板命令全部落空（这是探针的物流节拍问题，不是游戏问题）。
	lastFeedTick := int64(-1)
	doFeed := func() {
		if ws.Tick-lastFeedTick < 20 {
			return
		}
		lastFeedTick = ws.Tick
		feedOpeningIndustry(core, ws)
	}

	// tryBuildStep 追一条建造命令；成功返回 true。缺料时就地手搓（等价于真人把产物
	// 取回背包），机甲阵亡复活期间跳过。
	tryBuildStep := func() bool {
		s := steps[next]
		var pos *model.Position
		if s.node != nil {
			p := s.node.Position
			pos = &p
		} else {
			pos = botBuildSpotNear(ws, p1Home, radius, s.btype)
		}
		if pos == nil {
			return false
		}
		payload := map[string]any{"building_type": string(s.btype)}
		if s.recipe != "" {
			payload["recipe_id"] = s.recipe
		}
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Target:  model.CommandTarget{Layer: "planet", Position: pos},
			Payload: payload,
		})
		if res.Code == model.CodeOK {
			if s.btype == model.BuildingType("barracks") {
				barracksBuiltAt = ws.Tick
			}
			next++
			buildFail = ""
			return true
		}
		buildFail = fmt.Sprintf("build %s: %s", s.btype, res.Message)
		// 缺料就地手搓：等价于真人从矿机取矿、在熔炉/工作台把产物补回背包。
		// 手搓是机甲的个人作业（与建造的自动靠近串行），一次 10 个，做完再补。
		if exec := executorUnitQuiet(ws, "p1"); exec != nil && exec.Mecha != nil && exec.Mecha.Job == nil {
			recipe := "smelt_iron"
			if strings.Contains(res.Message, "电路板") {
				recipe = "circuit_board"
			}
			execCommand(core, model.CmdCraftItem, ws, "p1", model.Command{
				Target:  model.CommandTarget{Layer: "planet", EntityID: exec.ID},
				Payload: map[string]any{"recipe_id": recipe, "quantity": 10},
			})
		}
		return false
	}

	// powerLink 每 30 tick 重新巡检一次（botPowerLink 用的是快照 survey，新建筑必须
	// 出现在里面才会被接电）。开局这套建筑靠电塔无线覆盖（塔 4 格）接进电网。
	powerLink := func() {
		ctx = core.surveyBotWorld(ws, "p1")
		if cmd, ok := core.botPowerLink(ws, "p1", ctx); ok && cmd.Type == model.CmdBuild {
			execCommand(core, model.CmdBuild, ws, "p1", cmd)
		}
	}

	// rallyNewSoldiers 新兵出列即上前守家：站到 HQ 周围一圈的阵位上（一人一格，
	// 避免同格推挤），姿态由 -stance 决定。建造段与战斗段每 tick 都调用。
	rallyNewSoldiers := func() {
		for id, u := range ws.Units {
			if u == nil || u.OwnerID != "p1" || u.HP <= 0 || u.Type != model.UnitTypeSoldier || soldiers[id] {
				continue
			}
			soldiers[id] = true
			if firstSoldierAt < 0 {
				firstSoldierAt = ws.Tick
			}
			p := nextRally()
			execCommand(core, model.CmdUnitOrder, ws, "p1", model.Command{
				Target:  model.CommandTarget{Layer: "planet", EntityIDs: []string{id}, Position: &p},
				Payload: map[string]any{"order": stance},
			})
		}
	}

	// produceArmy 兵营一建好就出兵（不等整条建造计划跑完——真人也是先出兵再补后勤）。
	produceArmy := func() {
		if !soldiersFull(ws, soldiers, soldierCap) {
			if res := produceSoldier(core, ws); res.Code != model.CodeOK {
				buildFail = "soldier: " + res.Message
			}
		}
	}

	// 建造段（快进）：每 30 tick 追一条建造命令 + 巡检一次供电 + 试着出兵，
	// 物流每 20 tick 一次。
	buildStart := ws.Tick
	for ws.Tick < buildDeadlineTick && !core.Finished() && next < len(steps) {
		if ws.Tick > 0 && ws.Tick%cmdEvery == 0 {
			tryBuildStep()
			powerLink()
			produceArmy()
		}
		if ws.Tick%20 == 0 {
			doFeed()
		}
		rallyNewSoldiers()
		core.processTick()
	}
	buildTicks := ws.Tick - buildStart
	if next < len(steps) {
		t.Logf("seed=%s stance=%s 建造段超时：%d tick 内只建到第 %d/%d 步（%s），探针按当前状态继续跑",
			seed, stance, buildTicks, next, len(steps), steps[next].btype)
	}

	// 战斗段（实时）：建造段结束后不再快进，按 10 tick/s 的真人节奏出兵、拉线、补物流。
	for ws.Tick < simTicks && !core.Finished() {
		if ws.Tick > 0 && ws.Tick%cmdEvery == 0 {
			if next < len(steps) {
				tryBuildStep()
			}
			powerLink()
			produceArmy()
		}
		if ws.Tick%feedEvery == 0 {
			doFeed()
		}
		rallyNewSoldiers()

		core.processTick()

		// --- 观测 -----------------------------------------------------------
		if hqLostAt < 0 && botPlayerHQQuiet(ws, "p1") == nil {
			hqLostAt = ws.Tick
		}
		if eliminatedAt < 0 && !player.IsAlive {
			eliminatedAt = ws.Tick
		}
		// 推进波次：p2 地面单位进入 p1 基地 12 格内，间隔 ≥800 tick 记为新的一波。
		for _, u := range ws.Units {
			if u == nil || u.OwnerID != "p2" || u.HP <= 0 || u.Domain != model.UnitDomainGround {
				continue
			}
			if ws.SurfaceDistance(u.Position, p1Home) <= 12 && ws.Tick-lastApproach > 800 {
				waves = append(waves, ws.Tick)
				wavePeak = append(wavePeak, 0)
				lastApproach = ws.Tick
				if firstApproach < 0 {
					firstApproach = ws.Tick
				}
			}
		}
		if n := len(waves); n > 0 && ws.Tick-waves[n-1] <= 600 {
			if near := countP2ArmyNear(ws, p1Home, 20); near > wavePeak[n-1] {
				wavePeak[n-1] = near
			}
			if n == 1 {
				firstWaveSize = wavePeak[0]
			}
		}
		if ws.Tick%2000 == 0 {
			t.Logf("tick %d | p1 建筑=%s 运行中=%s 部队=%d 弹(库/背)=%d/%d 损失(单位/建筑)=%d/%d 击杀=%d | p2 部队=%d 建筑=%s",
				ws.Tick, fmtCounts(skirmishBuildingCounts(ws, "p1")), fmtCounts(skirmishRunningCounts(ws, "p1")),
				countArmy(ws, "p1"), countItemInBuildings(ws, "p1", model.ItemAmmoBullet), player.Inventory[model.ItemAmmoBullet],
				player.Stats.CombatStats.UnitsLost, player.Stats.CombatStats.BuildingsLost, player.Stats.CombatStats.UnitsKilled,
				countArmy(ws, "p2"), fmtCounts(skirmishBuildingCounts(ws, "p2")))
		}
	}

	t.Logf("seed=%s stance=%s 建造段=%d tick 建到第 %d/%d 步 兵营 tick=%d 首个步兵 tick=%d",
		seed, stance, buildTicks, next, len(steps), barracksBuiltAt, firstSoldierAt)
	t.Logf("seed=%s stance=%s 结束 tick=%d p1 存活=%v 被淘汰 tick=%d HQ 被拆 tick=%d 首攻 tick=%d（首波规模 %d）波次=%v 各波峰值=%v 部队=%d",
		seed, stance, ws.Tick, player.IsAlive, eliminatedAt, hqLostAt, firstApproach, firstWaveSize, waves, wavePeak, countArmy(ws, "p1"))
	t.Logf("seed=%s stance=%s p1 剩余建筑=%s 运行中=%s 部队=%d 损失(单位/建筑)=%d/%d 击杀=%d 库存弹药=%d | p2 部队=%d 逼近(20/40/80 格内)=%d/%d/%d 最近距离=%d 建筑=%s",
		seed, stance, fmtCounts(skirmishBuildingCounts(ws, "p1")), fmtCounts(skirmishRunningCounts(ws, "p1")), countArmy(ws, "p1"),
		player.Stats.CombatStats.UnitsLost, player.Stats.CombatStats.BuildingsLost, player.Stats.CombatStats.UnitsKilled,
		countItemInBuildings(ws, "p1", model.ItemAmmoBullet), countArmy(ws, "p2"),
		countP2ArmyNear(ws, p1Home, 20), countP2ArmyNear(ws, p1Home, 40), countP2ArmyNear(ws, p1Home, 80),
		nearestP2GroundDistance(ws, p1Home), fmtCounts(skirmishBuildingCounts(ws, "p2")))
	if buildFail != "" {
		t.Logf("seed=%s stance=%s 最后一条失败回执：%s", seed, stance, buildFail)
	}
	if v := core.Victory(); v.Declared() {
		t.Logf("seed=%s stance=%s 终局宣判：winner=%s reason=%s tick=%d", seed, stance, v.WinnerID, v.Reason, v.DeclaredTick)
	}

	// 探针只记录事实（结论写在报告里）。唯一的硬性检查：bot 必须真的打过来，
	// 否则说明探针没测到想测的东西。
	if firstApproach < 0 {
		t.Fatal("bot 从未推进到 p1 基地附近：探针没有测到首攻")
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
