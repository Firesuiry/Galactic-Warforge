package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func eventsOfType(events []*model.GameEvent, typ model.EventType) []*model.GameEvent {
	var out []*model.GameEvent
	for _, evt := range events {
		if evt.EventType == typ {
			out = append(out, evt)
		}
	}
	return out
}

// 黑雾默认中立：相邻也不互相开火，巢穴不派进攻波次。
func TestDarkFogPassiveUntilProvoked(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-p", 1, 200, model.Position{X: 40, Y: 40})
	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	plant := newBuilding("plant-p", model.BuildingTypeWindTurbine, "p1", model.Position{X: 48, Y: 40})
	placeBuilding(ws, plant)
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 44, Y: 40})
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 45, Y: 40})
	soldierHP, fogHP := soldier.HP, fog.HP

	events := driveBlackFogTicks(core, ws, 60)
	if n := len(eventsOfType(events, model.EvtEnemyWaveIncoming)); n != 0 {
		t.Fatalf("neutral dark fog must not send raids, got %d waves", n)
	}
	if soldier.HP != soldierHP || fog.HP != fogHP || plant.HP != plant.MaxHP {
		t.Fatalf("neutral sides must not fight: soldier %d/%d fog %d/%d plant %d", soldier.HP, soldierHP, fog.HP, fogHP, plant.HP)
	}
	for _, u := range ws.Units {
		if u.OwnerID == model.DarkFogOwnerID && u.Stance == model.UnitStanceAttackMove {
			t.Fatalf("neutral dark fog unit %s dispatched to raid", u.ID)
		}
	}
	if ws.Players["p1"].DarkFog.Hostile {
		t.Fatal("p1 must stay neutral")
	}
}

// 玩家伤害黑雾 → 敌对（发 dark_fog_provoked），黑雾还手且波次只派向该玩家；冷静期后恢复中立。
func TestDarkFogProvokedRetaliatesThenCalms(t *testing.T) {
	core := newBlackFogTestCore(t, "normal")
	ws := core.World()
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	ws.DarkFogCalmTicks = 500
	ws.EnemyForces = &model.EnemyForceState{SystemID: ws.PlanetID}
	spawnE4Nest(ws, "nest-q", 1, 200, model.Position{X: 40, Y: 40})
	plant1 := newBuilding("plant-1", model.BuildingTypeWindTurbine, "p1", model.Position{X: 52, Y: 40})
	placeBuilding(ws, plant1)
	plant2 := newBuilding("plant-2", model.BuildingTypeWindTurbine, "p2", model.Position{X: 44, Y: 40})
	placeBuilding(ws, plant2)
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 30, Y: 30})
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 31, Y: 30})
	soldier.AttackTarget = fog.ID

	events := driveBlackFogTicks(core, ws, 1)
	provoked := eventsOfType(events, model.EvtDarkFogProvoked)
	if len(provoked) != 1 || provoked[0].Payload["player_id"] != "p1" || provoked[0].Payload["until_tick"] != ws.Tick+500 {
		t.Fatalf("expected one dark_fog_provoked for p1, got %+v", provoked)
	}
	rel := ws.Players["p1"].DarkFog
	if !rel.Hostile || rel.HostileUntilTick != ws.Tick+500 || ws.Players["p2"].DarkFog.Hostile {
		t.Fatalf("relations wrong: p1=%+v p2=%+v", rel, ws.Players["p2"].DarkFog)
	}

	// 黑雾还手。
	hpBefore := soldier.HP
	driveBlackFogTicks(core, ws, 20)
	if _, alive := ws.Units[soldier.ID]; alive && soldier.HP == hpBefore {
		t.Fatal("provoked dark fog must fight back")
	}

	// 波次只打敌对的 p1（p2 的电厂更近也不打）。
	ws.EnemyForces.Forces[0].LastWaveTick = ws.Tick - blackFogBaseWaveInterval
	waves := eventsOfType(driveBlackFogTicks(core, ws, 2), model.EvtEnemyWaveIncoming)
	if len(waves) != 1 || waves[0].Payload["target_owner"] != "p1" {
		t.Fatalf("wave must target hostile p1 only, got %+v", waves)
	}

	// 冷静期到：恢复中立并发 dark_fog_calmed。
	ws.Tick = ws.Players["p1"].DarkFog.HostileUntilTick
	calmed := settleDarkFogCalm(ws.Players, ws.Tick)
	if len(calmed) != 1 || calmed[0].EventType != model.EvtDarkFogCalmed || calmed[0].Payload["player_id"] != "p1" {
		t.Fatalf("expected dark_fog_calmed for p1, got %+v", calmed)
	}
	if ws.Players["p1"].DarkFog != (model.DarkFogRelation{}) {
		t.Fatalf("relation must reset, got %+v", ws.Players["p1"].DarkFog)
	}
	// 中立后进攻队撤销奔袭。
	ws.Tick = ws.Tick - ws.Tick%blackFogRaidReassignTicks + blackFogRaidReassignTicks - 1
	driveBlackFogTicks(core, ws, 1)
	for _, u := range ws.Units {
		if u.OwnerID == model.DarkFogOwnerID && (u.Stance == model.UnitStanceAttackMove || u.AttackTarget != "") {
			t.Fatalf("calmed dark fog unit %s still raiding: stance=%s target=%s", u.ID, u.Stance, u.AttackTarget)
		}
	}
}

// 玩家单位不会自动招惹中立黑雾；黑雾敌对后才自动索敌。
func TestPlayerUnitsDoNotAutoProvokeDarkFog(t *testing.T) {
	ws := newRTTWorld(false)
	ws.Tick = 1
	soldier := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 5, Y: 5})
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 6, Y: 5})
	events := advanceRTT(ws, 10)
	if len(eventsOfType(events, model.EvtDarkFogProvoked)) != 0 || fog.HP != fog.MaxHP || ws.Players["p1"].DarkFog.Hostile {
		t.Fatal("idle units must not auto-attack neutral dark fog")
	}
	provokeDarkFogFor(ws, "p1")
	advanceRTT(ws, 10)
	if _, alive := ws.Units[fog.ID]; alive && fog.HP == fog.MaxHP {
		t.Fatal("units must auto-engage hostile dark fog")
	}
	_ = soldier
}

// 执行体空闲时自动打射程内敌对单位；有移动路径时不自动开火。
func TestMechaAutoFiresWhenIdle(t *testing.T) {
	ws, mecha := mechaTestWorld()
	enemy := model.UnitStats(model.UnitTypeSoldier)
	enemy.ID, enemy.OwnerID = "enemy", "p2"
	enemy.Position = model.Position{X: 2, Y: 1}
	enemy.Attack = 0
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	ws.Units[enemy.ID] = &enemy
	ws.TileUnits[model.TileKey(2, 1)] = []string{enemy.ID}

	mecha.Path = []model.Position{{X: 1, Y: 1}, {X: 1, Y: 2}}
	mecha.PathIndex = 1
	settleUnitCombat(ws)
	if enemy.HP != enemy.MaxHP {
		t.Fatal("moving mecha must not auto-fire")
	}
	mecha.ClearMovement()
	ws.Tick++
	settleUnitCombat(ws)
	if enemy.HP == enemy.MaxHP {
		t.Fatal("idle mecha must auto-fire at hostile unit in range")
	}
	if mecha.AttackTarget != "" {
		t.Fatal("auto-fire must not write an explicit attack target")
	}

	// 中立黑雾不自动打。
	delete(ws.Units, enemy.ID)
	ws.TileUnits[model.TileKey(2, 1)] = nil
	fog := spawnWorldTestUnit(ws, model.UnitTypeDarkFog, model.DarkFogOwnerID, model.Position{X: 2, Y: 1})
	ws.Tick += 100
	settleUnitCombat(ws)
	if fog.HP != fog.MaxHP || ws.Players["p1"].DarkFog.Hostile {
		t.Fatal("mecha must not auto-provoke neutral dark fog")
	}
}
