package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// E4 可攻打的黑雾巢穴验收：巢穴守军、摧毁奖励放大、区域安全（威胁回落+遗址冷却）。

// spawnE4Nest 在世界中放置一座指定等级/强度的巢穴。
func spawnE4Nest(ws *model.WorldState, id string, level, strength int, pos model.Position) {
	if ws.EnemyForces == nil {
		ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	}
	ws.EnemyForces.Forces = append(ws.EnemyForces.Forces, model.EnemyForce{
		ID:           id,
		Type:         model.EnemyForceTypeHive,
		Position:     pos,
		Strength:     strength,
		SpreadRadius: 1.0,
		SpawnTick:    ws.Tick,
		Level:        level,
	})
}

// nestGuards 返回锚定在指定巢穴上的存活守军。
func nestGuards(ws *model.WorldState, nestID string) []*model.Unit {
	var guards []*model.Unit
	for _, unit := range ws.Units {
		if unit != nil && unit.OwnerID == model.DarkFogOwnerID && unit.HP > 0 &&
			unit.Stance == model.UnitStanceGuard && unit.GuardTargetID == nestID {
			guards = append(guards, unit)
		}
	}
	return guards
}

func findNestDestroyedEvent(events []*model.GameEvent, nestID string) *model.GameEvent {
	for _, evt := range events {
		if evt == nil || evt.EventType != model.EvtEnemyNestDestroyed {
			continue
		}
		if id, _ := evt.Payload["nest_id"].(string); id == nestID {
			return evt
		}
	}
	return nil
}

// 守军编制：随波次补足到编制上限，guard 姿态锚定巢位，守巢半径随等级缩放；
// 进攻队照旧外派（attack_move）。
func TestE4NestSpawnsGuards(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-e4", 2, 200, model.Position{X: 40, Y: 40})

	// 袭击目标：保证进攻队照常外派。
	plant := newBuilding("plant-e4", model.BuildingTypeWindTurbine, "p1", model.Position{X: 60, Y: 40})
	placeBuilding(ws, plant)

	tuning := blackFogTuningFor("normal")
	wantCap := blackFogGuardCap(2, tuning)
	if wantCap != 3 {
		t.Fatalf("normal level-2 guard cap should be 3, got %d", wantCap)
	}
	if blackFogGuardCap(1, tuning) != 2 || blackFogGuardCap(10, tuning) != tuning.guardMax {
		t.Fatalf("guard cap scaling wrong: l1=%d l10=%d (max %d)",
			blackFogGuardCap(1, tuning), blackFogGuardCap(10, tuning), tuning.guardMax)
	}

	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	driveBlackFogTicks(core, ws, 3)

	guards := nestGuards(ws, "nest-e4")
	if len(guards) != wantCap {
		t.Fatalf("nest should keep %d guards, got %d", wantCap, len(guards))
	}
	for _, guard := range guards {
		if guard.CombatAnchor == nil || *guard.CombatAnchor != (model.Position{X: 40, Y: 40}) {
			t.Fatalf("guard anchor should be the nest position, got %+v", guard.CombatAnchor)
		}
		if guard.AttackTarget != "" || guard.OrderPos != nil {
			t.Fatalf("guard must not be dispatched on raids: %+v", guard)
		}
		wantAggro := model.UnitStats(model.UnitTypeDarkFog).VisionRange + blackFogGuardAggroPerLevel*(2-1)
		if guard.AggroRange != wantAggro {
			t.Fatalf("guard aggro should scale with nest level: want %d got %d", wantAggro, guard.AggroRange)
		}
	}

	// 进攻队照旧：仍有 attack_move 黑雾单位奔向电厂。
	raiders := 0
	for _, unit := range ws.Units {
		if unit.OwnerID == model.DarkFogOwnerID && unit.Stance == model.UnitStanceAttackMove {
			raiders++
		}
	}
	if raiders == 0 {
		t.Fatal("wave should still dispatch raiders alongside guards")
	}

	// 守军不被空闲重指派外派：推进跨过重指派周期后仍在守巢。
	driveBlackFogTicks(core, ws, blackFogRaidReassignTicks*2)
	guards = nestGuards(ws, "nest-e4")
	if len(guards) != wantCap {
		t.Fatalf("guards must not be reassigned to raids, %d/%d still guarding", len(guards), wantCap)
	}

	// 守军死亡后按既有孵化节奏补员：击杀一名守军，下一波次补足到编制。
	killUnit(ws, guards[0], "test", "", "test")
	if got := len(nestGuards(ws, "nest-e4")); got != wantCap-1 {
		t.Fatalf("expected %d guards after one killed, got %d", wantCap-1, got)
	}
	for i := range ws.EnemyForces.Forces {
		ws.EnemyForces.Forces[i].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	}
	driveBlackFogTicks(core, ws, 1)
	if got := len(nestGuards(ws, "nest-e4")); got != wantCap {
		t.Fatalf("next wave should top up guards to %d, got %d", wantCap, got)
	}
}

// 守军交战：玩家单位进入守巢半径会被守军自动攻击。
func TestE4GuardsEngageIntruder(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-e4b", 1, 200, model.Position{X: 40, Y: 40})

	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	driveBlackFogTicks(core, ws, 1)
	guards := nestGuards(ws, "nest-e4b")
	if len(guards) == 0 {
		t.Fatal("nest should have guards after the first wave")
	}
	guardIDs := map[string]bool{}
	for _, guard := range guards {
		guardIDs[guard.ID] = true
	}

	// 入侵者：高 HP 保证存活观察窗口；直接落在守军射程内
	// （避免与进攻队挤位时绕行拥堵干扰断言——拥堵属 R1 通用移动语义）。
	anchor := guards[0].Position
	var intruder *model.Unit
	for _, d := range []model.Position{{X: 1, Y: 0}, {X: -1, Y: 0}, {X: 0, Y: 1}, {X: 0, Y: -1}, {X: 1, Y: 1}, {X: -1, Y: -1}} {
		pos := model.Position{X: anchor.X + d.X, Y: anchor.Y + d.Y}
		if !ws.InBounds(pos.X, pos.Y) || !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
			continue
		}
		if len(ws.TileUnits[model.TileKey(pos.X, pos.Y)]) > 0 {
			continue
		}
		intruder = spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", pos)
		break
	}
	if intruder == nil {
		t.Fatal("no free tile next to a guard for the intruder")
	}
	intruder.HP = 100000
	intruder.MaxHP = 100000

	events := driveBlackFogTicks(core, ws, 30)
	guardHits := 0
	for _, evt := range events {
		if evt.EventType != model.EvtDamageApplied {
			continue
		}
		if evt.Payload["target_id"] != intruder.ID {
			continue
		}
		attackerID, _ := evt.Payload["attacker_id"].(string)
		if guardIDs[attackerID] {
			guardHits++
		}
	}
	if guardHits == 0 {
		t.Fatal("nest guards should auto-engage the intruder inside the guard radius")
	}
	if intruder.HP >= 100000 {
		t.Fatal("intruder should have taken damage from nest defense")
	}
}

// 摧毁奖励（单位路径）：掉落按巢穴等级放大，dark_fog_matrix 保底 level+1，
// enemy_nest_destroyed 事件字段齐全（含 planet_id），威胁回落，遗址登记。
func TestE4NestDestroyRewardsUnitPath(t *testing.T) {
	ws := newPowerTestWorld()
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战
	ws.Tick = 10
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 500}
	spawnE4Nest(ws, "hive-e4", 3, 10, model.Position{X: 3, Y: 2})
	killer := spawnLootKillerUnit(ws, "p1", model.Position{X: 2, Y: 2})

	events := settleUnitCombat(ws)

	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("nest should be destroyed, remaining %+v", ws.EnemyForces.Forces)
	}
	// 威胁回落：500 - 100*3*0.5 = 350。
	if ws.EnemyForces.ThreatMeter != 350 {
		t.Fatalf("threat meter should drop by level ratio, got %v", ws.EnemyForces.ThreatMeter)
	}
	// 遗址登记。
	if len(ws.EnemyForces.NestRuins) != 1 {
		t.Fatalf("nest ruin should be recorded, got %+v", ws.EnemyForces.NestRuins)
	}
	ruin := ws.EnemyForces.NestRuins[0]
	if ruin.Position != (model.Position{X: 3, Y: 2}) || ruin.DestroyedTick != 10 || ruin.Level != 3 {
		t.Fatalf("ruin fields wrong: %+v", ruin)
	}
	// 掉落保底：3 级巢 dark_fog_matrix ≥ 4。
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got < 4 {
		t.Fatalf("level-3 nest must drop at least 4 dark_fog_matrix, got %d", got)
	}
	// 通用摧毁事件仍在。
	entityDestroyed := false
	for _, evt := range events {
		if evt.EventType == model.EvtEntityDestroyed && evt.Payload["entity_id"] == "hive-e4" {
			entityDestroyed = true
		}
	}
	if !entityDestroyed {
		t.Fatal("entity_destroyed event missing for the nest")
	}
	// 巢穴摧毁战报。
	evt := findNestDestroyedEvent(events, "hive-e4")
	if evt == nil {
		t.Fatalf("enemy_nest_destroyed event missing, events=%+v", events)
	}
	if evt.VisibilityScope != "all" {
		t.Fatalf("nest destroyed event should be visible to all, got %q", evt.VisibilityScope)
	}
	if evt.Payload["planet_id"] != ws.PlanetID {
		t.Fatalf("nest destroyed event must carry planet_id, got %+v", evt.Payload)
	}
	if evt.Payload["level"] != 3 || evt.Payload["killed_by"] != killer.ID ||
		evt.Payload["killer_owner"] != "p1" || evt.Payload["source"] != "unit" {
		t.Fatalf("nest destroyed payload fields wrong: %+v", evt.Payload)
	}
	if evt.Payload["threat_meter"] != 350.0 {
		t.Fatalf("nest destroyed payload should carry post-refund threat meter, got %+v", evt.Payload["threat_meter"])
	}
	drops, _ := evt.Payload["drops"].([]map[string]any)
	matrixQty := 0
	for _, drop := range drops {
		if drop["item_id"] == model.ItemDarkFogMatrix {
			matrixQty, _ = drop["quantity"].(int)
		}
	}
	if matrixQty < 4 {
		t.Fatalf("drops list should include >=4 dark_fog_matrix, got %+v", drops)
	}
}

// 摧毁奖励（炮塔路径）：与单位路径同语义——掉落放大、战报事件、遗址登记。
func TestE4NestDestroyRewardsTurretPath(t *testing.T) {
	ws := newPowerTestWorld()
	provokeDarkFogFor(ws, "p1", "p2") // 玩家已与黑雾交战
	ws.Tick = 10
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 300}

	turret := newBuilding("turret-e4", model.BuildingTypeMissileTurret, "p1", model.Position{X: 2, Y: 2})
	turret.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[turret.ID] = turret
	combat := turret.Runtime.Functions.Combat
	if accepted, _, err := turret.Storage.Load(combat.AmmoItem, 10); err != nil || accepted != 10 {
		t.Fatalf("load ammo: %d %v", accepted, err)
	}
	spawnE4Nest(ws, "hive-e4t", 2, 2, model.Position{X: 3, Y: 2})

	var events []*model.GameEvent
	for tick := int64(10); tick < 10+int64(combat.FireRate)*10 && len(ws.EnemyForces.Forces) > 0; tick++ {
		ws.Tick = tick
		events = append(events, settleTurrets(ws)...)
	}
	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("turret should destroy the nest, remaining %+v", ws.EnemyForces.Forces)
	}
	// 威胁回落：300 - 100*2*0.5 = 200。
	if ws.EnemyForces.ThreatMeter != 200 {
		t.Fatalf("threat meter should drop after turret kill, got %v", ws.EnemyForces.ThreatMeter)
	}
	if len(ws.EnemyForces.NestRuins) != 1 {
		t.Fatalf("turret kill should record a ruin, got %+v", ws.EnemyForces.NestRuins)
	}
	// 2 级巢：matrix 保底 3；炮塔弹仓被弹药占用，战利品入击杀者背包。
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got < 3 {
		t.Fatalf("turret kill should grant >=3 dark_fog_matrix, got %d", got)
	}
	evt := findNestDestroyedEvent(events, "hive-e4t")
	if evt == nil {
		t.Fatal("enemy_nest_destroyed missing for turret kill")
	}
	if evt.Payload["source"] != "turret" || evt.Payload["killed_by"] != turret.ID ||
		evt.Payload["killer_owner"] != "p1" || evt.Payload["planet_id"] != ws.PlanetID {
		t.Fatalf("turret nest destroyed payload wrong: %+v", evt.Payload)
	}
}

// 区域安全：遗址冷却期内半径内不刷新新巢，冷却结束解除；遗址随结算过期清理。
func TestE4NestRuinBlocksRespawn(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	tuning := blackFogTuningFor("normal")
	ws.EnemyForces = &model.EnemyForceState{
		SystemID: ws.PlanetID,
		NestRuins: []model.NestRuin{
			{Position: model.Position{X: 60, Y: 40}, DestroyedTick: 100, Level: 2},
		},
	}

	// 冷却期内：半径内被拦截，半径外放行。
	ws.Tick = 100 + tuning.ruinCooldown - 1
	if !nestSiteInRuinCooldown(ws, model.Position{X: 60 + tuning.ruinRadius, Y: 40}, tuning) {
		t.Fatal("site inside ruin radius should be blocked during cooldown")
	}
	if nestSiteInRuinCooldown(ws, model.Position{X: 60 + tuning.ruinRadius + 1, Y: 40}, tuning) {
		t.Fatal("site outside ruin radius should not be blocked")
	}
	// 冷却结束：解除拦截。
	ws.Tick = 100 + tuning.ruinCooldown
	if nestSiteInRuinCooldown(ws, model.Position{X: 60, Y: 40}, tuning) {
		t.Fatal("ruin cooldown expired, site should be eligible again")
	}

	// 集成：冷却期内连续 spawn 均避开遗址半径（哈希选位不变，仅筛选候选点）。
	ws.Tick = 200
	for i := 0; i < 8; i++ {
		nest := core.spawnBlackFogNest(ws, 1)
		if nest == nil {
			continue
		}
		if ws.SurfaceDistance(nest.Position, model.Position{X: 60, Y: 40}) <= tuning.ruinRadius {
			t.Fatalf("new nest %s spawned inside ruin safety radius at %+v", nest.ID, nest.Position)
		}
	}
	if len(ws.EnemyForces.Forces) == 0 {
		t.Fatal("expected at least one nest spawn during the integration check")
	}

	// 冷却结束后推进结算：遗址被清理，状态有界。
	ws.Tick = 100 + tuning.ruinCooldown + 1
	core.settleEnemyForces(ws)
	if len(ws.EnemyForces.NestRuins) != 0 {
		t.Fatalf("expired ruins should be pruned, got %+v", ws.EnemyForces.NestRuins)
	}
}

// 区域安全跨存档：遗址与威胁回落随快照持久化。
func TestE4NestRuinSurvivesSaveRestore(t *testing.T) {
	cfg, maps, q, bus, store := newSaveHarnessDeps(t)
	core := New(cfg, maps, q, bus, store)

	ws := core.World()
	ws.Tick = 10
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID, ThreatMeter: 300}
	spawnE4Nest(ws, "hive-e4save", 2, 10, model.Position{X: 3, Y: 2})
	killer := spawnLootKillerUnit(ws, "p1", model.Position{X: 2, Y: 2})
	killer.AttackTarget = "hive-e4save"

	settleUnitCombat(ws)
	if len(ws.EnemyForces.NestRuins) != 1 || ws.EnemyForces.ThreatMeter != 200 {
		t.Fatalf("pre-save state wrong: ruins=%+v meter=%v", ws.EnemyForces.NestRuins, ws.EnemyForces.ThreatMeter)
	}

	save, err := core.ExportSaveFile("manual")
	if err != nil {
		t.Fatalf("export save: %v", err)
	}
	restored, err := NewFromSave(cfg, maps, q, bus, store, save)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	rws := restored.World()
	if rws.EnemyForces == nil || len(rws.EnemyForces.NestRuins) != 1 {
		t.Fatalf("ruins lost across save/restore: %+v", rws.EnemyForces)
	}
	ruin := rws.EnemyForces.NestRuins[0]
	if ruin.Position != (model.Position{X: 3, Y: 2}) || ruin.DestroyedTick != 10 || ruin.Level != 2 {
		t.Fatalf("restored ruin fields wrong: %+v", ruin)
	}
	if rws.EnemyForces.ThreatMeter != 200 {
		t.Fatalf("threat refund lost across save/restore: %v", rws.EnemyForces.ThreatMeter)
	}
}

// 事件回归：enemy_wave_incoming 与巢穴 entity_created 均携带 planet_id（跨行星定向）。
func TestE4BlackFogEventsCarryPlanetID(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	provokeDarkFogFor(ws, "p1") // 玩家已与黑雾交战

	// 初始巢穴生成：entity_created(enemy_force) 带 planet_id 与 level。
	ws.Tick++
	events := core.settleEnemyForces(ws)
	nestEvents := 0
	for _, evt := range events {
		if evt.EventType == model.EvtEntityCreated && evt.Payload["entity_type"] == "enemy_force" {
			nestEvents++
			if evt.Payload["planet_id"] != ws.PlanetID {
				t.Fatalf("nest event missing planet_id: %+v", evt.Payload)
			}
			if level, _ := evt.Payload["level"].(int); level < 1 {
				t.Fatalf("nest event should carry level: %+v", evt.Payload)
			}
		}
	}
	if nestEvents == 0 {
		t.Fatal("expected initial nest spawn events")
	}

	// 波次预警：enemy_wave_incoming 带 planet_id 与守军数。
	plant := newBuilding("plant-e4evt", model.BuildingTypeWindTurbine, "p1", model.Position{X: 30, Y: 30})
	placeBuilding(ws, plant)
	for i := range ws.EnemyForces.Forces {
		ws.EnemyForces.Forces[i].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	}
	ws.Tick++
	events = core.settleEnemyForces(ws)
	waveSeen := false
	for _, evt := range events {
		if evt.EventType != model.EvtEnemyWaveIncoming {
			continue
		}
		waveSeen = true
		if evt.Payload["planet_id"] != ws.PlanetID {
			t.Fatalf("wave event missing planet_id: %+v", evt.Payload)
		}
		if _, ok := evt.Payload["guards"]; !ok {
			t.Fatalf("wave event should report guard count: %+v", evt.Payload)
		}
	}
	if !waveSeen {
		t.Fatal("expected a wave event after nests reached their wave interval")
	}
}

// 舰队路径：舰队摧毁巢穴同样吃到掉落放大/威胁回落/遗址/战报语义。
func TestE4NestDestroyRewardsFleetPath(t *testing.T) {
	core := newE2ETestCore(t)
	ws := core.World()
	systemID := core.Maps().PrimaryPlanet().SystemID

	grantTechs(ws, "p1", "destroyer")

	base := newBuilding("battle-hub-e4", model.BuildingTypeBattlefieldAnalysisBase, "p1", model.Position{X: 6, Y: 6})
	base.Runtime.State = model.BuildingWorkRunning
	base.Runtime.Params.EnergyConsume = 0
	if base.Runtime.Functions.Energy != nil {
		base.Runtime.Functions.Energy.ConsumePerTick = 0
	}
	attachBuilding(ws, base)

	power := newBuilding("battle-power-e4", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	power.Runtime.State = model.BuildingWorkRunning
	attachBuilding(ws, power)

	createMissileDestroyerBlueprintForT117(t, core, ws, "missile_destroyer_e4")

	ws.Players["p1"].EnsureWarIndustry().DeploymentHubs[base.ID] = &model.WarDeploymentHubState{
		BuildingID:    base.ID,
		Capacity:      8,
		ReadyPayloads: map[string]int{"missile_destroyer_e4": 1},
	}

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdCommissionFleet,
		Payload: map[string]any{
			"building_id":  base.ID,
			"blueprint_id": "missile_destroyer_e4",
			"count":        1,
			"system_id":    systemID,
			"fleet_id":     "fleet-e4",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("commission fleet failed: %s (%s)", res.Code, res.Message)
	}

	// 一级巢，强度 1：一轮齐射即摧毁。
	ws.EnemyForces = &model.EnemyForceState{
		SystemID:    systemID,
		ThreatMeter: 300,
		Forces: []model.EnemyForce{{
			ID:   "hive-e4fleet",
			Type: model.EnemyForceTypeHive,
			// 未编队舰队只打锚点交战半径内的巢穴。
			Position:  model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2},
			Strength:  1,
			SpawnTick: ws.Tick,
			Level:     2,
		}},
	}
	settlePlanetSensorContacts(ws, ws.Tick)

	if res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdFleetAttack,
		Payload: map[string]any{
			"fleet_id":  "fleet-e4",
			"planet_id": ws.PlanetID,
			"target_id": "hive-e4fleet",
		},
	}); res.Code != model.CodeOK {
		t.Fatalf("fleet_attack failed: %s (%s)", res.Code, res.Message)
	}

	var events []*model.GameEvent
	for i := 0; i < 8 && len(ws.EnemyForces.Forces) > 0; i++ {
		ws.Tick++
		events = append(events, settleSpaceFleets(core.worlds, core.maps, core.spaceRuntime, ws.Tick)...)
	}
	if len(ws.EnemyForces.Forces) != 0 {
		t.Fatalf("fleet should destroy the nest, remaining %+v", ws.EnemyForces.Forces)
	}
	// 2 级巢：matrix 保底 3 进舰队所属玩家背包。
	if got := ws.Players["p1"].Inventory[model.ItemDarkFogMatrix]; got < 3 {
		t.Fatalf("fleet kill should grant >=3 dark_fog_matrix to owner, got %d", got)
	}
	if ws.EnemyForces.ThreatMeter != 200 {
		t.Fatalf("threat meter should drop after fleet kill, got %v", ws.EnemyForces.ThreatMeter)
	}
	if len(ws.EnemyForces.NestRuins) != 1 {
		t.Fatalf("fleet kill should record a ruin, got %+v", ws.EnemyForces.NestRuins)
	}
	evt := findNestDestroyedEvent(events, "hive-e4fleet")
	if evt == nil {
		t.Fatal("enemy_nest_destroyed missing for fleet kill")
	}
	if evt.Payload["source"] != "fleet" || evt.Payload["killed_by"] != "fleet-e4" ||
		evt.Payload["killer_owner"] != "p1" || evt.Payload["planet_id"] != ws.PlanetID {
		t.Fatalf("fleet nest destroyed payload wrong: %+v", evt.Payload)
	}
}
