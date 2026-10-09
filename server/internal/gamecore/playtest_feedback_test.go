package gamecore

import (
	"strings"
	"testing"

	"siliconworld/internal/model"
)

// 玩法侧回归：移动/攻击/回能/回执文案（试玩报告 2026-10-07「新问题清单」第 3、6、9、12、13 条）。

// 未探索区移动：服务端是权威，不按已探索掩码拒绝，按真实地形寻路；
// 远距离目标一条命令下达整条路径（不再要求玩家每次 5–8 格分段）。
func TestMoveIntoUnexploredAreaIsAcceptedAndRealTime(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	// 本测试世界没有迷雾引擎（execMove 不读探索掩码），远距离目标即为「未探索区」语义。
	dest := model.Position{X: 14, Y: 2}
	res, events := execCommand(gc, model.CmdMove, ws, "p1", model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: unit.ID, Position: &dest},
	})
	if res.Code != model.CodeOK || !unit.HasPath() {
		t.Fatalf("unexplored-area move rejected: %+v", res)
	}
	if len(events) == 0 || events[0].Payload["path"] == nil {
		t.Fatalf("move must emit the full path for client interpolation: %+v", events)
	}
	// 12 格、士兵 0.25 格/tick：需要 ~48 tick，但绝不允许瞬移。
	advanceRTT(ws, 4)
	if unit.Position == dest {
		t.Fatal("long move teleported")
	}
	advanceRTT(ws, 80)
	if unit.Position != dest {
		t.Fatalf("unit did not arrive at %+v, at %+v", dest, unit.Position)
	}
}

// 移动失败必须给出中文原因，而不是空回执。
func TestMoveFailureMessagesAreChineseAndSpecific(t *testing.T) {
	ws := newRTTWorld(false)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})

	outOfBounds := model.Position{X: -1, Y: 2}
	res, _ := execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: unit.ID, Position: &outOfBounds}})
	if res.Code != model.CodeInvalidTarget || res.Message == "" {
		t.Fatalf("out-of-bounds move needs a message: %+v", res)
	}

	occupied := model.Position{X: 3, Y: 2}
	placeBuilding(ws, newBuilding("block", model.BuildingTypeDepotMk1, "p2", occupied))
	res, _ = execCommand(gc, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: unit.ID, Position: &occupied}})
	if res.Code != model.CodePositionOccupied || res.Message != "目标格已被建筑占用" {
		t.Fatalf("occupied target needs a clear message: %+v", res)
	}
}

// 机甲阵亡后对它的命令必须回「已阵亡，等待复活」，不能裸报未找到单位 u-7。
func TestDeadMechaCommandsReportRespawn(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	exec := player.ExecutorForPlanet(ws.PlanetID)
	unit := ws.Units[exec.UnitID]
	killUnit(ws, unit, "enemy", "p2", "unit")

	dest := model.Position{X: unit.Position.X + 1, Y: unit.Position.Y}
	res, _ := execCommand(core, model.CmdMove, ws, "p1", model.Command{Type: model.CmdMove, Target: model.CommandTarget{EntityID: unit.ID, Position: &dest}})
	if res.Code != model.CodeEntityNotFound {
		t.Fatalf("dead mecha move should fail with entity_not_found: %+v", res)
	}
	if !containsAny(res.Message, "机甲已阵亡") || !containsAny(res.Message, "复活") {
		t.Fatalf("dead mecha needs a respawn hint, got %q", res.Message)
	}
}

// 攻击超出射程：单位与机甲都自动靠近（不再直接报「目标距离 9 超出攻击范围 4」）。
func TestAttackOutOfRangeAutoApproaches(t *testing.T) {
	// 普通单位。
	ws := newRTTWorld(true)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 9, Y: 2})
	res, _ := execCommand(gc, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: unit.ID},
		Payload: map[string]any{"target_entity_id": enemy.ID},
	})
	if res.Code != model.CodeOK || !unit.HasPath() {
		t.Fatalf("out-of-range attack must chase: %+v path=%v", res, unit.HasPath())
	}
	if res.Message != "1 个单位正前往攻击步兵" {
		t.Fatalf("approach message should name the target, got %q", res.Message)
	}
	for i := 0; i < 300 && ws.SurfaceDistance(unit.Position, enemy.Position) > unit.AttackRange; i++ {
		advanceRTT(ws, 1)
	}
	if ws.SurfaceDistance(unit.Position, enemy.Position) > unit.AttackRange {
		t.Fatalf("unit never closed to attack range: %+v -> %+v", unit.Position, enemy.Position)
	}

	// 机甲（执行体）。
	mechaWS, mecha := mechaTestWorld()
	mecha.Mecha.Energy = 100
	target := spawnWorldTestUnit(mechaWS, model.UnitTypeSoldier, "p2", model.Position{X: 9, Y: 1})
	res, _ = execCommand(gc, model.CmdAttack, mechaWS, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: mecha.ID},
		Payload: map[string]any{"target_entity_id": target.ID},
	})
	if res.Code != model.CodeOK || !mecha.HasPath() {
		t.Fatalf("mecha out-of-range attack must approach: %+v", res)
	}
	if mecha.Position == target.Position {
		t.Fatal("mecha approach must not teleport")
	}
	// 靠近后必须真的开火：显式攻击目标不能因为「移动」而丢掉（回归：机甲走到位后忘掉要打谁）。
	hpBefore := target.HP
	for i := 0; i < 400 && mechaWS.Units[target.ID] != nil; i++ {
		advanceRTT(mechaWS, 1)
	}
	if mechaWS.Units[target.ID] != nil && mechaWS.Units[target.ID].HP >= hpBefore {
		t.Fatalf("mecha never fired at the ordered target after approaching: hp=%d target=%q",
			mechaWS.Units[target.ID].HP, mecha.AttackTarget)
	}
}

// 机甲显式攻击敌方建筑：建筑所在格被占，moveMecha 无法直达，必须走兜底追击路径，
// 到达射程后仍按 AttackTarget 开火（回归：清交战把显式目标一起清掉，机甲走到位就发呆）。
func TestMechaAttackEnemyBuildingKeepsTargetAfterApproach(t *testing.T) {
	ws, mecha := mechaTestWorld()
	gc := &GameCore{}
	mecha.Mecha.Energy = 100
	base := newBuilding("enemy-base", model.BuildingTypeDepotMk1, "p2", model.Position{X: 10, Y: 1})
	base.HP, base.MaxHP = 200, 200
	placeBuilding(ws, base)

	res, _ := execCommand(gc, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: mecha.ID},
		Payload: map[string]any{"target_entity_id": base.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("mecha building attack rejected: %+v", res)
	}
	if mecha.AttackTarget != base.ID {
		t.Fatalf("explicit attack target must survive the approach, got %q", mecha.AttackTarget)
	}
	damaged := false
	for i := 0; i < 600 && ws.Buildings[base.ID] != nil; i++ {
		for _, evt := range advanceRTT(ws, 1) {
			if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == base.ID {
				damaged = true
			}
		}
	}
	if !damaged {
		t.Fatalf("mecha never fired at the enemy building (pos=%+v base=%+v target=%q)",
			mecha.Position, base.Position, mecha.AttackTarget)
	}
}

// 攻击敌方建筑：服务端接受建筑目标并自动靠近。
func TestAttackEnemyBuildingAutoApproaches(t *testing.T) {
	ws := newRTTWorld(true)
	gc := &GameCore{}
	unit := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 2, Y: 2})
	base := newBuilding("enemy-base", model.BuildingTypeDepotMk1, "p2", model.Position{X: 10, Y: 2})
	base.HP, base.MaxHP = 60, 200
	placeBuilding(ws, base)

	res, _ := execCommand(gc, model.CmdAttack, ws, "p1", model.Command{
		Type:    model.CmdAttack,
		Target:  model.CommandTarget{EntityID: unit.ID},
		Payload: map[string]any{"target_entity_id": base.ID},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("enemy building attack rejected: %+v", res)
	}
	if res.Message != "1 个单位正前往攻击小型储物仓" && res.Message != "1 个单位正前往攻击仓库" {
		t.Fatalf("building target should be named in Chinese, got %q", res.Message)
	}
	damaged := false
	for i := 0; i < 2000 && ws.Buildings[base.ID] != nil; i++ {
		for _, evt := range advanceRTT(ws, 1) {
			if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == base.ID {
				damaged = true
			}
		}
	}
	if !damaged {
		t.Fatalf("unit never fired at the enemy building (pos=%+v base=%+v)", unit.Position, base.Position)
	}
	if ws.Buildings[base.ID] != nil {
		t.Fatalf("enemy building survived: hp=%d pos=%+v unit=%+v", base.HP, base.Position, unit.Position)
	}
}

// 机甲被动回能：数据配置 energy_regen_ticks，每 N tick 回 1 点，满能量不溢出。
func TestMechaPassiveEnergyRegenIsConfiguredAndCapped(t *testing.T) {
	interval := model.MechaEnergyRegenTicks()
	if interval <= 0 {
		t.Fatal("executor.mecha.energy_regen_ticks must be configured")
	}
	ws, unit := mechaTestWorld()
	unit.Mecha.Energy = 0
	ws.Tick = 1 // 下一个回能 tick 是 interval（1+interval-1 之前都不该回能）
	for i := 0; i < interval-2; i++ {
		ws.Tick++
		settleMechas(ws)
	}
	if unit.Mecha.Energy != 0 {
		t.Fatalf("regen fired early: %d", unit.Mecha.Energy)
	}
	ws.Tick++
	settleMechas(ws)
	if unit.Mecha.Energy != 1 {
		t.Fatalf("expected 1 point after a full regen interval, got %d", unit.Mecha.Energy)
	}
	// 满能量不回能、不发事件。
	unit.Mecha.Energy = unit.Mecha.MaxEnergy
	if events := settleMechas(ws); len(events) != 0 {
		t.Fatalf("full core must not emit regen events: %v", events)
	}
}

// 回执文案：物品/单位/建筑用中文名，不裸露内部 ID。
func TestCommandReceiptsUseChineseNames(t *testing.T) {
	ws, unit := mechaTestWorld()
	player := ws.Players["p1"]
	core := &GameCore{}

	// transfer_item：物品名用 items.yaml 的 name，建筑名用 buildings.yaml 的 name。
	depot := newBuilding("b-92", model.BuildingTypeDepotMk1, "p1", model.Position{X: 3, Y: 1})
	depot.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, depot)
	player.Inventory = model.ItemInventory{model.ItemIronIngot: 20}
	res, _ := execCommand(core, model.CmdTransferItem, ws, "p1", model.Command{
		Type:    model.CmdTransferItem,
		Target:  model.CommandTarget{EntityID: unit.ID},
		Payload: map[string]any{"building_id": depot.ID, "item_id": model.ItemIronIngot, "quantity": 20},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("transfer rejected: %+v", res)
	}
	if res.Message != "已传输 20 个「铁块」至小型储物仓" && res.Message != "已传输 20 个「铁块」至仓库" {
		t.Fatalf("transfer receipt must use Chinese names, got %q", res.Message)
	}
	if !containsAny(res.Message, "铁块") || containsAny(res.Message, "iron_ingot", "b-92") {
		t.Fatalf("transfer receipt leaks ids: %q", res.Message)
	}

	// produce：单位名用 units.yaml 的 name。
	barracks := newBuilding("b-barracks", model.BuildingType("barracks"), "p1", model.Position{X: 4, Y: 1})
	barracks.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, barracks)
	def, _ := model.UnitDefinitionByID(model.UnitTypeSoldier)
	for _, cost := range def.Cost {
		_, _, _ = barracks.Storage.Load(cost.ItemID, cost.Quantity)
	}
	res, _ = execCommand(core, model.CmdProduce, ws, "p1", model.Command{
		Type:    model.CmdProduce,
		Target:  model.CommandTarget{EntityID: barracks.ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeSoldier)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("produce rejected: %+v", res)
	}
	if !containsAny(res.Message, "步兵") || containsAny(res.Message, "soldier") {
		t.Fatalf("produce receipt must use the unit's Chinese name, got %q", res.Message)
	}
}

func containsAny(haystack string, needles ...string) bool {
	for _, needle := range needles {
		if needle != "" && strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

// 建造排队：并发上限（执行体/区域）导致的等待必须能解释清楚，
// 而不是静默失败——任务视图带 wait_reason，命令本身成功。
func TestBuildConcurrencyLimitIsReportedAsWaitNotFailure(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	exec := player.ExecutorForPlanet(ws.PlanetID)
	exec.OperateRange = 64
	exec.ConcurrentTasks = 1
	grantAllItems(ws, "p1", 200)
	player.Resources.Minerals = 5000
	player.Resources.Energy = 5000
	execUnit := ws.Units[exec.UnitID]

	buildAt := func(pos model.Position) model.CommandResult {
		res, _ := execCommand(core, model.CmdBuild, ws, "p1", model.Command{
			Type:    model.CmdBuild,
			Target:  model.CommandTarget{Position: &pos},
			Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
		})
		return res
	}

	var placed []model.Position
	for _, p := range ws.SurfaceDisc(execUnit.Position, 12) {
		if len(placed) >= 3 {
			break
		}
		tile := ws.Grid[p.Y][p.X]
		if !tile.Terrain.Buildable() || tile.ResourceNodeID != "" {
			continue
		}
		if _, occupied := ws.TileBuilding[model.TileKey(p.X, p.Y)]; occupied {
			continue
		}
		placed = append(placed, p)
	}
	if len(placed) < 3 {
		t.Fatal("fixture needs three free tiles")
	}
	for _, p := range placed {
		if res := buildAt(p); res.Code != model.CodeOK {
			t.Fatalf("build should queue, got %+v", res)
		}
	}

	// 推进到至少有一个任务开工：其余任务应带 wait_reason 说明并发上限。
	for i := 0; i < 5; i++ {
		core.settleConstructionQueue(ws)
		ws.Tick++
	}
	pending, inProgress, waits := 0, 0, map[string]int{}
	for _, task := range ws.Construction.Tasks {
		switch task.State {
		case model.ConstructionPending:
			pending++
			waits[task.WaitReason]++
		case model.ConstructionInProgress:
			inProgress++
		}
	}
	if inProgress == 0 {
		t.Fatal("expected one task to start")
	}
	if pending > 0 && waits["executor_concurrent_limit"] == 0 && waits["region_concurrent_limit"] == 0 {
		t.Fatalf("queued tasks must explain the concurrency wait: %+v", waits)
	}
}
