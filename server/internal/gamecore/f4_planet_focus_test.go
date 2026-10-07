package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// F4 每人独立的行星焦点：命令按目标行星路由，所有已加载行星都结算；
// switch_active_planet 只改玩家自己的焦点，不再拖拽他人。

// newF4DualPlanetCore 构建双行星对局：planet-1-1 为主行星，planet-1-2 为全局
// 活动行星（InitialActivePlanetID）；两颗行星都已加载，双方玩家在两者上都有
// 基地与执行体。返回 (core, planetA, planetB)。
func newF4DualPlanetCore(t *testing.T, enemyDifficulty string) (*GameCore, *model.WorldState, *model.WorldState) {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:               "f4-test-seed",
			MaxTickRate:           10,
			InitialActivePlanetID: "planet-1-2",
			EnemyDifficulty:       enemyDifficulty,
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2"},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 2, GasGiantRatio: 0},
		Planet: mapconfig.PlanetConfig{FaceSize: 24, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := New(cfg, maps, queue.New(), NewEventBus(), nil)
	planetA := core.WorldForPlanet("planet-1-1")
	planetB := core.WorldForPlanet("planet-1-2")
	if planetA == nil || planetB == nil {
		t.Fatalf("expected both planet runtimes loaded, got A=%v B=%v", planetA != nil, planetB != nil)
	}
	return core, planetA, planetB
}

func f4BasePos(t *testing.T, ws *model.WorldState, playerID string) model.Position {
	t.Helper()
	for _, b := range ws.Buildings {
		if b != nil && b.OwnerID == playerID && b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			return b.Position
		}
	}
	t.Fatalf("player %s has no base on %s", playerID, ws.PlanetID)
	return model.Position{}
}

func f4OpenTileNear(t *testing.T, ws *model.WorldState, center model.Position) model.Position {
	t.Helper()
	pos := findOpenTileNearLocked(ws, center, 8, 0)
	if pos == nil {
		t.Fatalf("no open tile near %+v on %s", center, ws.PlanetID)
	}
	return *pos
}

func f4ConstructionTaskCount(ws *model.WorldState, playerID string) int {
	if ws.Construction == nil {
		return 0
	}
	n := 0
	for _, task := range ws.Construction.Tasks {
		if task != nil && task.PlayerID == playerID {
			n++
		}
	}
	return n
}

// 双行星各自建造：p1 焦点切到 planet-1-1 后直接建造（焦点路由）；
// p2 焦点保持 planet-1-2 原地建造；p1 再用 target.planet_id 显式在
// planet-1-2 建造。三条命令各自命中目标行星，互不拖拽。
func TestF4DualPlanetIndependentBuild(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	grantAllItems(planetA, "p1", 100)
	grantAllItems(planetA, "p2", 100)

	// p1 切换焦点到 planet-1-1。
	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdSwitchActivePlanet,
		Payload: map[string]any{"planet_id": "planet-1-1"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p1 switch focus failed: %s (%s)", res.Code, res.Message)
	}
	if core.ActivePlanetID() != "planet-1-2" {
		t.Fatalf("global active planet must not move, got %s", core.ActivePlanetID())
	}

	// p1 在焦点行星（planet-1-1）建造：不带 planet_id。
	p1PosA := f4OpenTileNear(t, planetA, f4BasePos(t, planetA, "p1"))
	res = issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &p1PosA},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p1 build on focus planet failed: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetA, "p1"); got != 1 {
		t.Fatalf("expected p1 task on planet-1-1, got %d", got)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 0 {
		t.Fatalf("p1 task leaked to planet-1-2, got %d", got)
	}

	// p2 焦点仍是 planet-1-2（未被 p1 拖拽），原地建造。
	if got := planetB.Players["p2"].FocusPlanetID; got != "planet-1-2" {
		t.Fatalf("p2 focus should stay planet-1-2, got %s", got)
	}
	p2PosB := f4OpenTileNear(t, planetB, f4BasePos(t, planetB, "p2"))
	res = issueInternalCommand(core, "p2", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &p2PosB},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p2 build on own focus planet failed: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetB, "p2"); got != 1 {
		t.Fatalf("expected p2 task on planet-1-2, got %d", got)
	}
	if got := f4ConstructionTaskCount(planetA, "p2"); got != 0 {
		t.Fatalf("p2 task leaked to planet-1-1, got %d", got)
	}

	// p1 显式 target.planet_id 在 planet-1-2 建造（覆盖焦点）。
	p1PosB := f4OpenTileNear(t, planetB, f4BasePos(t, planetB, "p1"))
	res = issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &p1PosB, PlanetID: "planet-1-2"},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p1 explicit-planet build failed: %s (%s)", res.Code, res.Message)
	}
	if got := f4ConstructionTaskCount(planetB, "p1"); got != 1 {
		t.Fatalf("expected p1 explicit task on planet-1-2, got %d", got)
	}

	// 显式指定未加载行星 → 路由失败。
	badPos := p1PosB
	res = issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdBuild,
		Target:  model.CommandTarget{Position: &badPos, PlanetID: "planet-9-9"},
		Payload: map[string]any{"building_type": string(model.BuildingTypeWindTurbine)},
	})
	if res.Code != model.CodeInvalidTarget {
		t.Fatalf("expected INVALID_TARGET for unloaded planet, got %s (%s)", res.Code, res.Message)
	}

	// 两颗行星的建造队列都在结算：推进足够 tick 后两处都应完工。
	for i := 0; i < defaultConstructionDurationTick+2; i++ {
		core.processTick()
	}
	countTurbine := func(ws *model.WorldState, owner string) int {
		n := 0
		for _, b := range ws.Buildings {
			if b != nil && b.OwnerID == owner && b.Type == model.BuildingTypeWindTurbine {
				n++
			}
		}
		return n
	}
	if got := countTurbine(planetA, "p1"); got != 1 {
		t.Fatalf("expected p1 turbine completed on planet-1-1, got %d", got)
	}
	if got := countTurbine(planetB, "p1"); got != 1 {
		t.Fatalf("expected p1 turbine completed on planet-1-2, got %d", got)
	}
	if got := countTurbine(planetB, "p2"); got != 1 {
		t.Fatalf("expected p2 turbine completed on planet-1-2, got %d", got)
	}
}

// 生产按建筑所在行星路由：p1 的工厂在 planet-1-1、p2 的工厂在 planet-1-2，
// 双方互不切换焦点也能各自生产。
func TestF4DualPlanetIndependentProduce(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")

	mkFactory := func(ws *model.WorldState, id, owner string) *model.Building {
		base := f4BasePos(t, ws, owner)
		pos := f4OpenTileNear(t, ws, base)
		factory := newBuilding(id, model.BuildingType("barracks"), owner, pos)
		factory.Runtime.State = model.BuildingWorkRunning
		factory.Runtime.Params.EnergyConsume = 0
		if factory.Runtime.Functions.Energy != nil {
			factory.Runtime.Functions.Energy.ConsumePerTick = 0
		}
		factory.Storage.Inventory = model.ItemInventory{"iron_ingot": 2, "circuit_board": 1}
		attachBuilding(ws, factory)
		return factory
	}
	factoryA := mkFactory(planetA, "f4-factory-a", "p1")
	factoryB := mkFactory(planetB, "f4-factory-b", "p2")

	unitsOf := func(ws *model.WorldState, owner string) int {
		n := 0
		for _, u := range ws.Units {
			if u != nil && u.OwnerID == owner && u.Type == model.UnitTypeWorker {
				n++
			}
		}
		return n
	}

	// p1 焦点在 planet-1-2（默认），但 produce 按工厂实体路由到 planet-1-1。
	res := issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdProduce,
		Target:  model.CommandTarget{EntityID: factoryA.ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeWorker)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p1 produce on planet-1-1 factory failed: %s (%s)", res.Code, res.Message)
	}
	duration := factoryA.UnitQueue[0].TotalTicks
	for i := 0; i < duration; i++ {
		settleUnitProduction(planetA)
	}
	if got := unitsOf(planetA, "p1"); got != 1 {
		t.Fatalf("expected p1 worker on planet-1-1, got %d", got)
	}
	if got := unitsOf(planetB, "p1"); got != 0 {
		t.Fatalf("p1 worker leaked to planet-1-2, got %d", got)
	}

	res = issueInternalCommand(core, "p2", model.Command{
		Type:    model.CmdProduce,
		Target:  model.CommandTarget{EntityID: factoryB.ID},
		Payload: map[string]any{"unit_type": string(model.UnitTypeWorker)},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("p2 produce on planet-1-2 factory failed: %s (%s)", res.Code, res.Message)
	}
	duration = factoryB.UnitQueue[0].TotalTicks
	for i := 0; i < duration; i++ {
		settleUnitProduction(planetB)
	}
	if got := unitsOf(planetB, "p2"); got != 1 {
		t.Fatalf("expected p2 worker on planet-1-2, got %d", got)
	}
	if got := unitsOf(planetA, "p2"); got != 0 {
		t.Fatalf("p2 worker leaked to planet-1-1, got %d", got)
	}
}

// 移动命令按单位实体所在行星路由；跨行星同 ID 时优先焦点行星，
// 也可用 target.planet_id 显式消歧。
func TestF4MoveRoutingByEntityAndDisambiguation(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")

	// p2 在 planet-1-1 上放一个独有 ID 的单位。
	scoutPos := f4OpenTileNear(t, planetA, f4BasePos(t, planetA, "p2"))
	scout := spawnWorldTestUnit(planetA, model.UnitTypeWorker, "p2", scoutPos)
	delete(planetA.Units, scout.ID)
	scout.ID = "f4-scout-a"
	planetA.Units[scout.ID] = scout
	key := model.TileKey(scoutPos.X, scoutPos.Y)
	planetA.TileUnits[key] = []string{scout.ID}

	destA := f4OpenTileNear(t, planetA, scout.Position)
	res := issueInternalCommand(core, "p2", model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: "f4-scout-a", Position: &destA},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("move by unique entity id failed: %s (%s)", res.Code, res.Message)
	}
	// 普通单位实时移动：推进若干 tick 到达目标格。
	for i := 0; i < 40 && scout.Position != destA; i++ {
		core.processTick()
	}
	if scout.Position != destA {
		t.Fatalf("scout should move on planet-1-1 to %+v, got %+v", destA, scout.Position)
	}

	// 跨行星同 ID：双方执行体在两颗行星上同号（各自的 u 序列）。
	execA := planetB.Players["p1"].ExecutorForPlanet("planet-1-1")
	execB := planetB.Players["p1"].ExecutorForPlanet("planet-1-2")
	if execA == nil || execB == nil {
		t.Fatal("expected p1 executors on both planets")
	}
	unitA := planetA.Units[execA.UnitID]
	unitB := planetB.Units[execB.UnitID]
	if unitA == nil || unitB == nil {
		t.Fatalf("executor units missing: A=%v B=%v", unitA != nil, unitB != nil)
	}
	if execA.UnitID != execB.UnitID {
		t.Fatalf("test expects colliding executor ids, got %s vs %s", execA.UnitID, execB.UnitID)
	}

	// 无消歧提示 → 落在焦点行星（p1 焦点 = planet-1-2）。
	destFocus := f4OpenTileNear(t, planetB, unitB.Position)
	res = issueInternalCommand(core, "p1", model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: execB.UnitID, Position: &destFocus},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("focus-routed move failed: %s (%s)", res.Code, res.Message)
	}
	if unitB.Position != destFocus {
		t.Fatalf("focus planet executor should move to %+v, got %+v", destFocus, unitB.Position)
	}

	// 显式 target.planet_id 消歧 → 落在 planet-1-1。
	destExplicit := f4OpenTileNear(t, planetA, unitA.Position)
	res = issueInternalCommand(core, "p1", model.Command{
		Type:   model.CmdMove,
		Target: model.CommandTarget{EntityID: execA.UnitID, Position: &destExplicit, PlanetID: "planet-1-1"},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("explicit-planet move failed: %s (%s)", res.Code, res.Message)
	}
	if unitA.Position != destExplicit {
		t.Fatalf("planet-1-1 executor should move to %+v, got %+v", destExplicit, unitA.Position)
	}
}

// 非活动行星上的黑雾照常结算：巢穴守军在 planet-1-1 接战入侵者，
// 全程全局活动行星保持 planet-1-2。
func TestF4NonActivePlanetEnemyCombatSettles(t *testing.T) {
	core, planetA, _ := newF4DualPlanetCore(t, "normal")
	provokeDarkFogFor(planetA, "p1", "p2") // 玩家已与黑雾交战
	spawnE4Nest(planetA, "nest-f4", 1, 200, model.Position{X: 40, Y: 40})
	planetA.EnemyForces.Forces[0].LastWaveTick = planetA.Tick - blackFogBaseWaveInterval

	core.processTick()
	guards := nestGuards(planetA, "nest-f4")
	if len(guards) == 0 {
		t.Fatal("nest on non-active planet should have guards after the first wave")
	}

	anchor := guards[0].Position
	var intruder *model.Unit
	for _, d := range []model.Position{{X: 1, Y: 0}, {X: -1, Y: 0}, {X: 0, Y: 1}, {X: 0, Y: -1}, {X: 1, Y: 1}, {X: -1, Y: -1}} {
		pos := model.Position{X: anchor.X + d.X, Y: anchor.Y + d.Y}
		if !planetA.InBounds(pos.X, pos.Y) || !planetA.Grid[pos.Y][pos.X].Terrain.Buildable() {
			continue
		}
		if len(planetA.TileUnits[model.TileKey(pos.X, pos.Y)]) > 0 {
			continue
		}
		intruder = spawnWorldTestUnit(planetA, model.UnitTypeSoldier, "p1", pos)
		break
	}
	if intruder == nil {
		t.Fatal("no free tile next to a guard for the intruder")
	}
	intruder.HP = 100000
	intruder.MaxHP = 100000

	for i := 0; i < 30 && intruder.HP >= 100000; i++ {
		core.processTick()
	}
	if intruder.HP >= 100000 {
		t.Fatal("intruder on non-active planet should have taken damage from nest guards")
	}
	if core.ActivePlanetID() != "planet-1-2" {
		t.Fatalf("global active planet must stay planet-1-2, got %s", core.ActivePlanetID())
	}
}

// 军工订单在非活动行星照常推进；deploy_squad 按建筑路由，小队落在建筑所在行星。
func TestF4WarIndustrySettlesOnNonActivePlanet(t *testing.T) {
	core, planetA, planetB := newF4DualPlanetCore(t, "off")
	grantTechs(planetA, "p1", "prototype")
	grantItems(planetA, "p1",
		model.ItemAmount{ItemID: model.ItemCircuitBoard, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemProcessor, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemTitaniumAlloy, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemQuantumChip, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemDeuteriumFuelRod, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemFrameMaterial, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemMicrocrystalline, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemGraphene, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemCarbonNanotube, Quantity: 80},
		model.ItemAmount{ItemID: model.ItemEnergeticGraphite, Quantity: 80},
	)

	base := f4BasePos(t, planetA, "p1")
	factory := newBuilding("f4-factory", model.BuildingTypeRecomposingAssembler, "p1", f4OpenTileNear(t, planetA, base))
	factory.Runtime.State = model.BuildingWorkRunning
	factory.Runtime.Params.EnergyConsume = 0
	if factory.Runtime.Functions.Energy != nil {
		factory.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(planetA, factory)

	hub := newBuilding("f4-hub", model.BuildingTypeBattlefieldAnalysisBase, "p1", f4OpenTileNear(t, planetA, base))
	hub.Runtime.State = model.BuildingWorkRunning
	hub.Runtime.Params.EnergyConsume = 0
	if hub.Runtime.Functions.Energy != nil {
		hub.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(planetA, hub)

	// 蓝图：variant → validate → finalize（与 t113 相同的最小路径）。
	for _, cmd := range []model.Command{
		{Type: model.CmdBlueprintVariant, Payload: map[string]any{
			"parent_blueprint_id": "prototype", "blueprint_id": "raider_f4", "allowed_slot_ids": []string{"utility"},
		}},
		{Type: model.CmdBlueprintValidate, Payload: map[string]any{"blueprint_id": "raider_f4"}},
		{Type: model.CmdBlueprintFinalize, Payload: map[string]any{"blueprint_id": "raider_f4", "target_state": "prototype"}},
	} {
		if res := issueInternalCommand(core, "p1", cmd); res.Code != model.CodeOK {
			t.Fatalf("%s failed: %s (%s)", cmd.Type, res.Code, res.Message)
		}
	}

	// queue_military_production 按 building_id 路由到 planet-1-1（p1 焦点在 planet-1-2）。
	res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdQueueMilitaryProduction,
		Payload: map[string]any{
			"building_id":       factory.ID,
			"deployment_hub_id": hub.ID,
			"blueprint_id":      "raider_f4",
			"count":             1,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("queue_military_production failed: %s (%s)", res.Code, res.Message)
	}

	player := planetA.Players["p1"]
	var order *model.WarProductionOrder
	for _, o := range player.WarIndustry.ProductionOrders {
		order = o
	}
	if order == nil {
		t.Fatal("expected a queued production order")
	}
	initialRemaining := order.StageRemainingTicks

	// 非活动行星的订单随 tick 推进（settleWarIndustry 全行星化）。
	for i := 0; i < 5; i++ {
		core.processTick()
	}
	if order.StageRemainingTicks >= initialRemaining {
		t.Fatalf("order on non-active planet should progress, remaining=%d initial=%d", order.StageRemainingTicks, initialRemaining)
	}

	// 直接注入就绪载荷，验证 deploy_squad 落在建筑所在行星而非焦点行星。
	hubState := ensureWarDeploymentHubState(player.EnsureWarIndustry(), hub.ID, 0)
	hubState.ReadyPayloads["raider_f4"] = 1
	res = issueInternalCommand(core, "p1", model.Command{
		Type:    model.CmdDeploySquad,
		Payload: map[string]any{"building_id": hub.ID, "blueprint_id": "raider_f4", "count": 1},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("deploy_squad failed: %s (%s)", res.Code, res.Message)
	}
	if planetA.CombatRuntime == nil || len(planetA.CombatRuntime.Squads) != 1 {
		t.Fatalf("expected squad on planet-1-1, got %+v", planetA.CombatRuntime)
	}
	if planetB.CombatRuntime != nil && len(planetB.CombatRuntime.Squads) > 0 {
		t.Fatalf("squad leaked to focus planet-1-2: %+v", planetB.CombatRuntime.Squads)
	}
	for _, squad := range planetA.CombatRuntime.Squads {
		if squad.PlanetID != "planet-1-1" {
			t.Fatalf("squad planet should be planet-1-1, got %s", squad.PlanetID)
		}
	}
}
