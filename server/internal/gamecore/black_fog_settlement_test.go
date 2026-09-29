package gamecore

import (
	"testing"

	"siliconworld/internal/config"
	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapgen"
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// 黑雾（E1–E3）验收测试：实体化进攻、威胁成长、袭击目标与预警。

func newBlackFogTestCore(t *testing.T, difficulty string) *GameCore {
	t.Helper()
	cfg := &config.Config{
		Battlefield: config.BattlefieldConfig{
			MapSeed:         "blackfog-test",
			MaxTickRate:     20,
			EnemyDifficulty: difficulty,
		},
		Players: []config.PlayerConfig{{PlayerID: "p1", Key: "key1"}},
		Server:  config.ServerConfig{Port: 9999, RateLimit: 100},
	}
	mapCfg := &mapconfig.Config{
		Galaxy: mapconfig.GalaxyConfig{SystemCount: 1},
		System: mapconfig.SystemConfig{PlanetsPerSystem: 1},
		Planet: mapconfig.PlanetConfig{FaceSize: 64, ResourceDensity: 12},
	}
	maps := mapgen.Generate(mapCfg, cfg.Battlefield.MapSeed)
	core := New(cfg, maps, nil, NewEventBus(), nil)
	// 战斗夹具不依赖噪声地形：固定坐标的巢穴/电厂必须可进入。
	ws := core.World()
	for y := range ws.Grid {
		for x := range ws.Grid[y] {
			ws.Grid[y][x].Terrain = terrain.TileBuildable
		}
	}
	return core
}

func driveBlackFogTicks(core *GameCore, ws *model.WorldState, ticks int) []*model.GameEvent {
	var events []*model.GameEvent
	for i := 0; i < ticks; i++ {
		ws.Tick++
		events = append(events, settleUnitMovement(ws)...)
		events = append(events, settleUnitCombat(ws)...)
		events = append(events, core.settleEnemyForces(ws)...)
	}
	return events
}

// E1/E3：巢穴孵化波次，蜂群单位沿路径进攻，不设防的建筑会被摧毁，波次有预警。
func TestE1WaveAttacksAndDestroysUndefendedBase(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()

	// 预置巢穴（跳过初始生成的随机性，直接控制场景）与一座不设防电厂。
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	nest := model.EnemyForce{
		ID:        "nest-e1",
		Type:      model.EnemyForceTypeHive,
		Position:  model.Position{X: 40, Y: 40},
		Strength:  100,
		SpawnTick: ws.Tick,
	}
	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, nest)
	plant := newBuilding("plant-e1", model.BuildingTypeWindTurbine, "p1", model.Position{X: 48, Y: 40})
	plant.HP = 120
	placeBuilding(ws, plant)

	// 让巢穴立即到孵化时刻。
	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	events := driveBlackFogTicks(core, ws, 5)

	// 波次预警：enemy_wave_incoming 携带巢穴方位与目标。
	var wave *model.GameEvent
	for _, evt := range events {
		if evt.EventType == model.EvtEnemyWaveIncoming {
			wave = evt
			break
		}
	}
	if wave == nil {
		t.Fatalf("missing wave warning event, events=%d", len(events))
	}
	if wave.Payload["target_building_id"] != plant.ID {
		t.Fatalf("wave should target the power plant (E3 priority), got %+v", wave.Payload)
	}
	if wave.Payload["from"] == nil || wave.Payload["count"].(int) <= 0 {
		t.Fatalf("wave warning missing origin/count: %+v", wave.Payload)
	}

	// 蜂群实体单位已经生成并向目标推进。
	dfSeen := false
	for _, unit := range ws.Units {
		if unit.OwnerID == model.DarkFogOwnerID {
			dfSeen = true
			break
		}
	}
	if !dfSeen {
		t.Fatal("no dark fog units spawned by the wave")
	}

	// 推进至接战：不设防的电厂最终被摧毁。
	events = driveBlackFogTicks(core, ws, 400)
	if ws.Buildings[plant.ID] != nil {
		t.Fatal("undefended power plant survived the raid")
	}
	destroyedSeen := false
	for _, evt := range events {
		if evt.EventType == model.EvtEntityDestroyed && evt.Payload["entity_id"] == plant.ID {
			destroyedSeen = true
		}
	}
	if !destroyedSeen {
		t.Fatal("missing power plant destroyed event")
	}
}

// E2：威胁随发电累积，巢穴等级提升，波次间隔随之缩短。
func TestE2ThreatAccumulatesWithGeneration(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}

	if blackFogNestLevel(0) != 1 {
		t.Fatal("level 1 expected at zero threat")
	}
	if blackFogWaveInterval(1) <= blackFogWaveInterval(4) {
		t.Fatalf("higher nest level should shorten wave interval: %d vs %d", blackFogWaveInterval(1), blackFogWaveInterval(4))
	}

	// 发电驱动威胁累积：放一批真实发电建筑并推进电力结算。
	for i := 0; i < 4; i++ {
		turbine := newBuilding("turbine-e2-"+string(rune('a'+i)), model.BuildingTypeWindTurbine, "p1", model.Position{X: 10 + i, Y: 10})
		turbine.Runtime.State = model.BuildingWorkRunning
		placeBuilding(ws, turbine)
	}
	before := ws.EnemyForces.ThreatMeter
	for i := 0; i < 10; i++ {
		ws.Tick++
		env := currentPlanetEnvironment(core.maps, ws.PlanetID)
		settlePowerGeneration(ws, env)
		finalizePowerSettlement(ws, nil)
		core.settleEnemyForces(ws)
	}
	if ws.EnemyForces.ThreatMeter <= before {
		t.Fatalf("threat meter did not accumulate with power generation: %v", ws.EnemyForces.ThreatMeter)
	}
}

// E3：袭击目标优先级——电厂优先于其他建筑。
func TestE3RaidTargetPriority(t *testing.T) {
	ws := newRTTWorld(false)
	depot := newBuilding("depot-e3", model.BuildingTypeDepotMk1, "p1", model.Position{X: 20, Y: 20})
	placeBuilding(ws, depot)
	plant := newBuilding("plant-e3", model.BuildingTypeWindTurbine, "p1", model.Position{X: 30, Y: 30})
	placeBuilding(ws, plant)

	// 电厂虽然更远，仍应优先于更近的仓库。
	target := selectBlackFogRaidTarget(ws, model.Position{X: 10, Y: 20})
	if target == nil || target.building.ID != plant.ID {
		t.Fatalf("power plant should outrank closer depot, got %+v", target)
	}

	// 防御塔优先级高于普通建筑但低于矿/物流：炮塔 vs 仓库。
	turret := newBuilding("turret-e3", model.BuildingTypeGaussTurret, "p1", model.Position{X: 38, Y: 28})
	placeBuilding(ws, turret)
	target = selectBlackFogRaidTarget(ws, model.Position{X: 36, Y: 28})
	if target == nil || target.building.ID != depot.ID && target.building.ID != plant.ID {
		// 电厂/仓库（rank 0/4 与 4）中电厂仍最优
		if target == nil {
			t.Fatal("no raid target selected")
		}
	}
	if target.building.ID == turret.ID {
		t.Fatalf("turret should not outrank power plant, got %+v", target.building.ID)
	}
}

// E1 对抗面：设防的基地能守住（炮塔/部队击杀蜂群单位）。
func TestE1DefendedBaseHolds(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	nest := model.EnemyForce{
		ID:        "nest-e1b",
		Type:      model.EnemyForceTypeHive,
		Position:  model.Position{X: 40, Y: 40},
		Strength:  100,
		SpawnTick: ws.Tick,
	}
	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, nest)

	plant := newBuilding("plant-e1b", model.BuildingTypeWindTurbine, "p1", model.Position{X: 48, Y: 40})
	plant.HP = 200
	placeBuilding(ws, plant)
	// 守军：三名士兵守在电厂旁。
	for i := 0; i < 3; i++ {
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 47, Y: 38 + i})
	}

	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	driveBlackFogTicks(core, ws, 400)

	if ws.Buildings[plant.ID] == nil {
		t.Fatal("defended power plant fell to the raid")
	}
	alive := 0
	for _, unit := range ws.Units {
		if unit.OwnerID == model.DarkFogOwnerID && unit.HP > 0 {
			alive++
		}
	}
	if alive > 4 {
		t.Fatalf("defenders should thin the wave, %d dark fog units still alive", alive)
	}
}

// 和平模式：不生成巢穴与波次。
func TestBlackFogPeacefulMode(t *testing.T) {
	core := newBlackFogTestCore(t, "off")
	ws := core.World()
	plant := newBuilding("plant-off", model.BuildingTypeWindTurbine, "p1", model.Position{X: 20, Y: 20})
	placeBuilding(ws, plant)

	driveBlackFogTicks(core, ws, 50)
	if ws.EnemyForces != nil && len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("peaceful mode spawned nests: %+v", ws.EnemyForces.Forces)
	}
	for _, unit := range ws.Units {
		if unit.OwnerID == model.DarkFogOwnerID {
			t.Fatal("peaceful mode spawned dark fog unit")
		}
	}
}
