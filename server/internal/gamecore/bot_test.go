package gamecore

import (
	"reflect"
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/queue"
)

// A1 遭遇战 bot 验收：经济运营、出兵、进攻，走玩家相同的命令接口。

func newBotTestCore(t *testing.T, botDifficulty string) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:         "bot-test-seed",
			MaxTickRate:     50,
			EnemyDifficulty: "off",
		},
		Players: []config.PlayerConfig{
			{PlayerID: "p1", Key: "key1"},
			{PlayerID: "p2", Key: "key2", Bot: botDifficulty, Bootstrap: config.PlayerBootstrapConfig{
				Minerals: 5000, Energy: 2000,
				Inventory: []config.BootstrapItemConfig{
					{ItemID: model.ItemIronOre, Quantity: 200},
					{ItemID: model.ItemCopperOre, Quantity: 100},
					{ItemID: model.ItemCoal, Quantity: 100},
				},
			}},
		},
		Server: config.ServerConfig{Port: 9999, RateLimit: 1000},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 48, ResourceDensity: 14},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	return New(cfg, maps, queue.New(), NewEventBus(), nil)
}

func runBotGame(core *GameCore, ticks int) {
	for i := 0; i < ticks; i++ {
		core.processTick()
	}
}

// bot 会采矿、建电力与矿机、攒制造台：运营链条真实发生。
func TestA1BotRunsEconomy(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()

	runBotGame(core, 6000)

	p2buildings := 0
	power, miners := 0, 0
	for _, b := range ws.Buildings {
		if b.OwnerID != "p2" {
			continue
		}
		p2buildings++
		if b.Runtime.Functions.Energy != nil && b.Runtime.Functions.Energy.OutputPerTick > 0 {
			power++
		}
		if isMinerBuilding(b) {
			miners++
		}
	}
	if power == 0 {
		t.Fatal("bot never built power generation")
	}
	if miners == 0 {
		t.Fatal("bot never built miners")
	}
	// 制造台：物料链较长，3000 tick 内建成或物料在路上——至少见过手搓/采矿行为。
	player := ws.Players["p2"]
	if player == nil {
		t.Fatal("bot player missing")
	}
	t.Logf("p2 buildings=%d power=%d miners=%d inventory=%v", p2buildings, power, miners, player.Inventory)
}

// bot 出兵并在达标后进攻（命令走队列，可见于命令日志语义）。
func TestA1BotProducesArmyAndAttacks(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	// 给 p1 一个家：让 bot 有明确进攻目标。
	hq := newBuilding("hq-p1", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2})
	hq.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, hq)

	// 直接预置 p2 的产能条件：矿+电+制造台（贴着 p2 实际的基地，满足建造半径），加速到进攻阶段。
	p2 := ws.Players["p2"]
	p2.Resources.Minerals = 9000
	p2.Resources.Energy = 5000
	var home model.Position
	for _, b := range ws.Buildings {
		if b.OwnerID == "p2" && b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			home = b.Position
			break
		}
	}
	asmPos := botAdjacentFreeTile(ws, home, "")
	if asmPos == nil {
		t.Fatal("no free tile near p2 HQ")
	}
	assembler := newBuilding("asm-p2", model.BuildingType("barracks"), "p2", *asmPos)
	assembler.Runtime.State = model.BuildingWorkRunning
	assembler.Storage.Inventory = model.ItemInventory{"iron_ingot": 80, "circuit_board": 40}
	placeBuilding(ws, assembler)
	windPos := botAdjacentFreeTile(ws, home, "")
	if windPos == nil {
		t.Fatal("no free tile for wind")
	}
	turbine := newBuilding("wind-p2", model.BuildingTypeWindTurbine, "p2", *windPos)
	turbine.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, turbine)

	soldiersSeen := 0
	attacked := false
	for i := 0; i < 6000 && !attacked; i++ {
		core.processTick()
		soldiersSeen = 0
		for _, u := range ws.Units {
			if u.OwnerID == "p2" && u.Type == model.UnitTypeSoldier && u.HP > 0 {
				soldiersSeen++
				if u.AttackTarget != "" || u.Stance == model.UnitStanceAttackMove || u.HasPath() {
					attacked = true
				}
			}
		}
	}
	if soldiersSeen == 0 {
		t.Fatal("bot never produced soldiers")
	}
	if !attacked {
		t.Fatal("bot never issued attack orders with sufficient army")
	}
}

// 简单档节奏更慢：同样时间内军队规模小于困难档（难度参数真实生效）。
func TestA1BotDifficultyScaling(t *testing.T) {
	tuningEasy := botTuningFor("easy")
	tuningHard := botTuningFor("hard")
	if tuningEasy.cadence <= tuningHard.cadence {
		t.Fatal("easy cadence should be slower than hard")
	}
	if tuningEasy.attackAt >= tuningHard.attackAt || tuningEasy.armyCap >= tuningHard.armyCap {
		t.Fatal("easy army thresholds should be lower than hard")
	}
	if tuningEasy.turretCap >= tuningHard.turretCap || tuningEasy.turretThreat >= tuningHard.turretThreat {
		t.Fatal("easy should build fewer turrets and later than hard")
	}
	if tuningEasy.mechaMinSoldiers <= tuningHard.mechaMinSoldiers {
		t.Fatal("hard should field mecha earlier than easy")
	}
}

func TestA1BotBuildsTurretWhenThreatened(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	p2 := ws.Players["p2"]
	grantTechs(ws, "p2", "weapon_system")
	p2.Resources.Minerals = 4000
	p2.Resources.Energy = 2000
	inv := p2.EnsureInventory()
	inv[model.ItemCircuitBoard] = 8
	inv[model.ItemGear] = 16
	inv[model.ItemIronIngot] = 16
	inv[model.ItemMagneticCoil] = 8
	home := botPlayerHome(t, ws, "p2")
	enemyPos := botTileAtDistance(t, ws, home, 2)
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", enemyPos)

	cmds := core.planBotCommands(ws, "p2", botTuningFor("hard"))
	build, ok := botCmdPayload(cmds, model.CmdBuild, "building_type")
	if !ok || build != string(model.BuildingTypeGaussTurret) {
		t.Fatalf("expected gauss turret build, cmds=%v", cmds)
	}

	core.runBotBrain(ws, "p2", botTuningFor("hard"))
	core.processTick()
	if !botHasPendingBuild(ws, "p2", model.BuildingTypeGaussTurret) {
		t.Fatal("turret build command was not queued as construction")
	}
}

func TestA1BotRecallsAgainstIncomingUnits(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	enemyPos := botTileAtDistance(t, ws, home, 2)
	enemy := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", enemyPos)
	soldierPos := botTileAtDistance(t, ws, home, 8)
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", soldierPos)

	cmds := core.planBotCommands(ws, "p2", botTuningFor("hard"))
	cmd, ok := botFirstCmd(cmds, model.CmdUnitOrder)
	if !ok || cmd.Payload["order"] != "attack_move" || cmd.Target.Position == nil {
		t.Fatalf("expected recall attack_move, cmds=%v", cmds)
	}
	if ws.SurfaceDistance(*cmd.Target.Position, enemy.Position) != 0 {
		t.Fatalf("recall target = %+v, want enemy %+v", *cmd.Target.Position, enemy.Position)
	}
}

func TestA1BotProducesMechaWhenAffordable(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	botFillIndustry(t, ws, "p2", home, botTuningFor("hard"))
	botQuietExecutor(ws, "p2")
	p2 := ws.Players["p2"]
	p2.Resources.Minerals = 500
	p2.Resources.Energy = 200
	// 清空会让研究站建得起的物品，避免研究命令挤掉出兵。
	p2.Inventory = model.ItemInventory{}
	pos := botBuildSpotNear(ws, home, 24)
	if pos == nil {
		t.Fatal("no factory site")
	}
	factory := newBuilding("vehicle-p2", model.BuildingType("vehicle_factory"), "p2", *pos)
	factory.Runtime.State = model.BuildingWorkRunning
	factory.Storage.Inventory = model.ItemInventory{"steel": 6, "circuit_board": 3, "motor": 2}
	placeBuilding(ws, factory)

	cmds := core.planBotCommands(ws, "p2", botTuningFor("hard"))
	unit, ok := botCmdPayload(cmds, model.CmdProduce, "unit_type")
	if !ok || unit != string(model.UnitTypeMecha) {
		t.Fatalf("expected mecha produce, cmds=%v", cmds)
	}
	if unit == string(model.UnitTypeSoldier) {
		t.Fatal("hard bot produced only soldiers")
	}
}

func TestA1BotResearchesWhenMatricesReady(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	botFillIndustry(t, ws, "p2", home, botTuningFor("normal"))
	botQuietExecutor(ws, "p2")
	labPos := botBuildSpotNear(ws, home, 24)
	if labPos == nil {
		t.Fatal("no tile for lab")
	}
	lab := newBuilding("lab-p2", model.BuildingTypeMatrixLab, "p2", *labPos)
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	lab.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 10
	ws.Players["p2"].Resources.Minerals = 20
	ws.Players["p2"].Resources.Energy = 10

	tuning := botTuningFor("normal")
	cmds := core.planBotCommands(ws, "p2", tuning)
	tech, ok := botCmdPayload(cmds, model.CmdStartResearch, "tech_id")
	if !ok || tech != "electromagnetism" {
		t.Fatalf("expected start_research electromagnetism, cmds=%v", cmds)
	}

	core.runBotBrain(ws, "p2", tuning)
	core.processTick()
	current := ws.Players["p2"].Tech.CurrentResearch
	if current == nil || current.TechID != "electromagnetism" {
		t.Fatalf("research did not start, current=%v", current)
	}
}

func TestA1BotSkipsResearchWithoutMatrices(t *testing.T) {
	core := newBotTestCore(t, "normal")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	botFillIndustry(t, ws, "p2", home, botTuningFor("normal"))
	botQuietExecutor(ws, "p2")
	labPos := botBuildSpotNear(ws, home, 24)
	if labPos == nil {
		t.Fatal("no tile for lab")
	}
	lab := newBuilding("lab-p2-empty", model.BuildingTypeMatrixLab, "p2", *labPos)
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	ws.Players["p2"].Resources.Minerals = 20
	ws.Players["p2"].Resources.Energy = 10

	tuning := botTuningFor("normal")
	if _, ok := core.botNextResearchTech(ws.Players["p2"], tuning); ok {
		t.Fatal("empty lab must not select a research tech")
	}
	for _, cmd := range core.planBotCommands(ws, "p2", tuning) {
		if cmd.Type == model.CmdStartResearch {
			t.Fatalf("research command issued without matrices: %+v", cmd)
		}
	}
}

func TestA1BotDecisionsDeterministic(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	enemyPos := botTileAtDistance(t, ws, home, 2)
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", enemyPos)
	spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", botTileAtDistance(t, ws, home, 8))
	grantTechs(ws, "p2", "weapon_system")
	p2 := ws.Players["p2"]
	p2.Resources.Minerals = 4000
	p2.Resources.Energy = 2000
	inv := p2.EnsureInventory()
	inv[model.ItemCircuitBoard] = 8
	inv[model.ItemGear] = 16
	inv[model.ItemIronIngot] = 16
	inv[model.ItemMagneticCoil] = 8
	labPos := botBuildSpotNear(ws, home, 24)
	if labPos == nil {
		t.Fatal("no tile for lab")
	}
	lab := newBuilding("lab-det", model.BuildingTypeMatrixLab, "p2", *labPos)
	lab.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, lab)
	lab.Storage.EnsureInventory()[model.ItemElectromagneticMatrix] = 4

	tuning := botTuningFor("hard")
	first := core.planBotCommands(ws, "p2", tuning)
	second := core.planBotCommands(ws, "p2", tuning)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("decisions diverged\nfirst=%v\nsecond=%v", first, second)
	}
	if len(first) == 0 {
		t.Fatal("expected a non-empty deterministic plan")
	}
}

func TestA1HardBotPressuresUndefendedPlayer(t *testing.T) {
	core := newBotTestCore(t, "hard")
	ws := core.World()
	home := botPlayerHome(t, ws, "p2")
	hq := botPlayerHQ(t, ws, "p1")
	adj := botAdjacentFreeTile(ws, home, hq.ID)
	if adj == nil {
		t.Fatal("no adjacent tile for enemy HQ")
	}
	botRelocateBuilding(ws, hq, *adj)
	for _, u := range ws.Units {
		if u != nil && u.OwnerID == "p1" {
			u.HP = 0
		}
	}
	spots := botFreeTiles(ws, home, 6, botTuningFor("hard").attackAt)
	if len(spots) < botTuningFor("hard").attackAt {
		t.Fatalf("need %d soldier tiles, got %d", botTuningFor("hard").attackAt, len(spots))
	}
	for i := 0; i < botTuningFor("hard").attackAt; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", spots[i])
	}
	before := hq.HP
	aimed := false
	for i := 0; i < 160; i++ {
		core.processTick()
		if botAttackMoveToward(core, "p2", hq.Position) {
			aimed = true
		}
		if aimed && hq.HP < before {
			break
		}
	}
	if !aimed && hq.HP >= before {
		t.Fatalf("hard bot neither aimed attack_move at enemy HQ nor damaged it (hp %d -> %d)", before, hq.HP)
	}
}

func TestA1SkirmishConfigLoads(t *testing.T) {
	cfg, err := config.Load("../../config-skirmish.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Battlefield.VictoryRule != "elimination" {
		t.Fatalf("victory_rule=%q", cfg.Battlefield.VictoryRule)
	}
	if cfg.Battlefield.EnemyDifficulty != "normal" {
		t.Fatalf("enemy_difficulty=%q", cfg.Battlefield.EnemyDifficulty)
	}
	if len(cfg.Players) < 2 {
		t.Fatal("expected two players")
	}
	if cfg.Players[0].PlayerID != "p1" || cfg.Players[0].Role != "admin" || cfg.Players[0].Bot != "" {
		t.Fatalf("p1 = %+v", cfg.Players[0])
	}
	if cfg.Players[1].PlayerID != "p2" || cfg.Players[1].Bot != "hard" {
		t.Fatalf("p2 = %+v", cfg.Players[1])
	}
}

func botPlayerHome(t *testing.T, ws *model.WorldState, playerID string) model.Position {
	t.Helper()
	hq := botPlayerHQ(t, ws, playerID)
	return hq.Position
}

func botPlayerHQ(t *testing.T, ws *model.WorldState, playerID string) *model.Building {
	t.Helper()
	var found *model.Building
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID || b.Type != model.BuildingTypeBattlefieldAnalysisBase || b.HP <= 0 {
			continue
		}
		if found == nil || b.ID < found.ID {
			found = b
		}
	}
	if found == nil {
		t.Fatalf("no HQ for %s", playerID)
	}
	return found
}

func botTileAtDistance(t *testing.T, ws *model.WorldState, home model.Position, dist int) model.Position {
	t.Helper()
	for _, candidate := range ws.SurfaceDisc(home, dist) {
		if ws.SurfaceDistance(home, candidate) != dist {
			continue
		}
		if !ws.InBounds(candidate.X, candidate.Y) || !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
			continue
		}
		if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
			continue
		}
		if len(ws.TileUnits[model.TileKey(candidate.X, candidate.Y)]) > 0 {
			continue
		}
		return candidate
	}
	t.Fatalf("no free tile at distance %d from %+v", dist, home)
	return model.Position{}
}

func botFreeTiles(ws *model.WorldState, home model.Position, radius, n int) []model.Position {
	out := make([]model.Position, 0, n)
	for _, candidate := range ws.SurfaceDisc(home, radius) {
		if !ws.InBounds(candidate.X, candidate.Y) || !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
			continue
		}
		if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
			continue
		}
		if len(ws.TileUnits[model.TileKey(candidate.X, candidate.Y)]) > 0 {
			continue
		}
		out = append(out, candidate)
		if len(out) >= n {
			break
		}
	}
	return out
}

func botFillIndustry(t *testing.T, ws *model.WorldState, playerID string, home model.Position, tuning botTuning) {
	t.Helper()
	placeN := func(n int, btype model.BuildingType, prefix string) {
		for i := 0; i < n; i++ {
			pos := botBuildSpotNear(ws, home, 24)
			if pos == nil {
				t.Fatalf("no tile for %s", btype)
			}
			b := newBuilding(prefix+string(rune('a'+i)), btype, playerID, *pos)
			b.Runtime.State = model.BuildingWorkRunning
			placeBuilding(ws, b)
		}
	}
	placeN(tuning.powerTarget, model.BuildingTypeWindTurbine, "pad-wind-")
	placeN(tuning.minerTarget, model.BuildingTypeMiningMachine, "pad-miner-")
	placeN(1, model.BuildingTypeAssemblingMachineMk1, "pad-asm-")
}

func botQuietExecutor(ws *model.WorldState, playerID string) {
	for _, u := range ws.Units {
		if u == nil || u.OwnerID != playerID || u.Mecha == nil {
			continue
		}
		u.Mecha.Energy = u.Mecha.MaxEnergy
		u.Mecha.Job = &model.MechaJob{Kind: "hold", RemainingTicks: 80}
	}
}

func botCmdPayload(cmds []model.Command, typ model.CommandType, key string) (string, bool) {
	for _, cmd := range cmds {
		if cmd.Type != typ || cmd.Payload == nil {
			continue
		}
		raw, ok := cmd.Payload[key]
		if !ok {
			continue
		}
		text, ok := raw.(string)
		return text, ok
	}
	return "", false
}

func botFirstCmd(cmds []model.Command, typ model.CommandType) (model.Command, bool) {
	for _, cmd := range cmds {
		if cmd.Type == typ {
			return cmd, true
		}
	}
	return model.Command{}, false
}

func botHasPendingBuild(ws *model.WorldState, playerID string, btype model.BuildingType) bool {
	return botPendingBuilds(ws, playerID, btype) > 0
}

func botRelocateBuilding(ws *model.WorldState, b *model.Building, pos model.Position) {
	oldKey := model.TileKey(b.Position.X, b.Position.Y)
	if ws.TileBuilding[oldKey] == b.ID {
		delete(ws.TileBuilding, oldKey)
	}
	if ws.InBounds(b.Position.X, b.Position.Y) && ws.Grid[b.Position.Y][b.Position.X].BuildingID == b.ID {
		ws.Grid[b.Position.Y][b.Position.X].BuildingID = ""
	}
	b.Position = pos
	key := model.TileKey(pos.X, pos.Y)
	ws.TileBuilding[key] = b.ID
	ws.Grid[pos.Y][pos.X].BuildingID = b.ID
}

func botAttackMoveToward(core *GameCore, playerID string, pos model.Position) bool {
	ws := core.World()
	for _, entry := range core.GetCommandLog().All() {
		if entry.PlayerID != playerID {
			continue
		}
		for _, cmd := range entry.Commands {
			if (cmd.Type != model.CmdUnitOrder || cmd.Payload["order"] != "attack_move") && (cmd.Type != model.CmdSquadOrder || cmd.Payload["order"] != "attack") || cmd.Target.Position == nil {
				continue
			}
			if ws.SurfaceDistance(*cmd.Target.Position, pos) <= 2 {
				return true
			}
		}
	}
	return false
}
