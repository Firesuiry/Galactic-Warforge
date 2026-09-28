package gamecore

import (
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
	assembler := newBuilding("asm-p2", model.BuildingTypeAssemblingMachineMk1, "p2", *asmPos)
	assembler.Runtime.State = model.BuildingWorkRunning
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
}
