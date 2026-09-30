package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

const (
	btAntiAir   = model.BuildingType("anti_air_turret")
	btArtillery = model.BuildingType("artillery_turret")
	btSupply    = model.BuildingType("supply_station")
)

func newAirDefenseWorld() *model.WorldState {
	ws := model.NewWorldState("air", 32)
	ws.Players["p1"] = &model.PlayerState{PlayerID: "p1", IsAlive: true}
	ws.Players["p2"] = &model.PlayerState{PlayerID: "p2", IsAlive: true}
	ws.Tick = 100
	return ws
}

func addRunningTurret(ws *model.WorldState, id string, typ model.BuildingType, pos model.Position, ammo string, qty int) *model.Building {
	b := newBuilding(id, typ, "p1", pos)
	b.Runtime.State = model.BuildingWorkRunning
	if ammo != "" {
		b.Storage.EnsureInventory()[ammo] = qty
	}
	ws.Buildings[id] = b
	return b
}

// 敌方物流无人机：从 (0,5) 飞往 (20,5)，共 10 tick，可按剩余时间摆位。
func addEnemyFlyingDrone(ws *model.WorldState, remaining int) *model.LogisticsDroneState {
	target := model.Position{X: 20, Y: 5}
	d := &model.LogisticsDroneState{
		ID: "drone-x", StationID: "st-x", OwnerID: "p2", Status: model.LogisticsDroneInFlight,
		Position: model.Position{X: 0, Y: 5}, TargetPos: &target, TravelTicks: 10, RemainingTicks: remaining,
		Cargo: model.ItemInventory{"iron_ingot": 30},
	}
	ws.LogisticsDrones[d.ID] = d
	return d
}

func destroyedShotDown(events []*model.GameEvent, id string) *model.GameEvent {
	for _, e := range events {
		if e.EventType == model.EvtEntityDestroyed && e.Payload["entity_id"] == id && e.Payload["reason"] == "shot_down" {
			return e
		}
	}
	return nil
}

func TestAntiAirShootsDownEnemyLogisticsDrone(t *testing.T) {
	ws := newAirDefenseWorld()
	turret := addRunningTurret(ws, "aa", btAntiAir, model.Position{X: 12, Y: 5}, model.ItemAmmoMissile, 3)
	drone := addEnemyFlyingDrone(ws, 10)

	// 刚起飞在 (0,5)，距防空炮 12 > 射程 10：不会被击落。
	if events := settleTurrets(ws); destroyedShotDown(events, drone.ID) != nil || ws.LogisticsDrones[drone.ID] == nil {
		t.Fatal("drone outside range must survive")
	}
	// 飞行过半后插值到 (10,5)，进入射程。
	drone.RemainingTicks = 5
	ws.Tick += 100
	events := settleTurrets(ws)
	e := destroyedShotDown(events, drone.ID)
	if e == nil {
		t.Fatal("expected shot_down event")
	}
	if e.Payload["entity_type"] != "logistics_drone" || e.Payload["attacker_id"] != "aa" {
		t.Fatalf("bad payload: %+v", e.Payload)
	}
	lost, _ := e.Payload["cargo_lost"].(map[string]int)
	if lost["iron_ingot"] != 30 {
		t.Fatalf("cargo loss not reported: %+v", e.Payload["cargo_lost"])
	}
	if ws.LogisticsDrones[drone.ID] != nil {
		t.Fatal("drone must be removed")
	}
	if got := turret.Storage.Inventory[model.ItemAmmoMissile]; got != 2 {
		t.Fatalf("shot must consume 1 missile, left %d", got)
	}
	// 被击落方与防空方都能收到事件。
	scopes := map[string]bool{}
	for _, ev := range events {
		if ev.Payload["reason"] == "shot_down" {
			scopes[ev.VisibilityScope] = true
		}
	}
	if !scopes["p1"] || !scopes["p2"] {
		t.Fatalf("both sides must see the kill: %+v", scopes)
	}
}

func TestAntiAirIgnoresFriendlyGroundedAndNoAmmo(t *testing.T) {
	ws := newAirDefenseWorld()
	turret := addRunningTurret(ws, "aa", btAntiAir, model.Position{X: 10, Y: 5}, model.ItemAmmoMissile, 5)
	own := addEnemyFlyingDrone(ws, 5)
	own.OwnerID = "p1"
	settleTurrets(ws)
	if ws.LogisticsDrones[own.ID] == nil {
		t.Fatal("friendly drone must not be shot")
	}
	own.OwnerID = "p2"
	own.Status = model.LogisticsDroneLanding // 起降阶段不算空中目标
	ws.Tick += 100
	settleTurrets(ws)
	if ws.LogisticsDrones[own.ID] == nil {
		t.Fatal("landing drone must not be shot")
	}
	own.Status = model.LogisticsDroneInFlight
	turret.Storage.Inventory = model.ItemInventory{}
	ws.Tick += 100
	events := settleTurrets(ws)
	if ws.LogisticsDrones[own.ID] == nil || turret.Runtime.StateReason != "no_ammunition" {
		t.Fatalf("no ammo => no shootdown, reason=%q", turret.Runtime.StateReason)
	}
	if len(events) == 0 {
		t.Fatal("expected no_ammunition state event")
	}
	// 补弹后恢复击落。
	turret.Storage.EnsureInventory()[model.ItemAmmoMissile] = 1
	ws.Tick += 100
	settleTurrets(ws)
	if ws.LogisticsDrones[own.ID] != nil {
		t.Fatal("refilled turret must shoot the drone down")
	}
}

func TestAntiAirShootsDownEnemyDistributorBot(t *testing.T) {
	ws := newAirDefenseWorld()
	addRunningTurret(ws, "aa", btAntiAir, model.Position{X: 6, Y: 6}, model.ItemAmmoMissile, 2)
	bot := &model.LogisticsBotState{ID: "bot-x", OwnerID: "p2", Status: model.LogisticsDroneInFlight, Position: model.Position{X: 8, Y: 6}, Cargo: model.ItemInventory{"copper_ingot": 5}}
	ws.LogisticsBots[bot.ID] = bot
	events := settleTurrets(ws)
	e := destroyedShotDown(events, bot.ID)
	if e == nil || e.Payload["entity_type"] != "logistics_bot" || ws.LogisticsBots[bot.ID] != nil {
		t.Fatalf("bot must be shot down: %+v", e)
	}
}

func TestAntiAirPrefersCombatAircraftOverLogistics(t *testing.T) {
	ws := newAirDefenseWorld()
	turret := addRunningTurret(ws, "aa", btAntiAir, model.Position{X: 10, Y: 5}, model.ItemAmmoMissile, 5)
	drone := addEnemyFlyingDrone(ws, 5)
	air := spawnWorldTestUnit(ws, model.UnitTypeAttackDrone, "p2", model.Position{X: 11, Y: 5})
	before := air.HP
	settleTurrets(ws)
	if air.HP >= before || ws.LogisticsDrones[drone.ID] == nil {
		t.Fatalf("combat aircraft first: hp %d->%d", before, air.HP)
	}
	_ = turret
}

func TestAntiAirTurretOnlyHitsAirUnitsWithMissileAmmo(t *testing.T) {
	ws := newAirDefenseWorld()
	turret := addRunningTurret(ws, "aa", btAntiAir, model.Position{X: 10, Y: 10}, "", 0)
	ground := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 12, Y: 10})
	air := spawnWorldTestUnit(ws, model.UnitTypeAttackDrone, "p2", model.Position{X: 13, Y: 10})
	groundHP, airHP := ground.HP, air.HP

	// 装错弹种（炮弹/子弹）不能开火。
	turret.Storage.EnsureInventory()[model.ItemShellSet] = 5
	turret.Storage.EnsureInventory()[model.ItemAmmoBullet] = 5
	settleTurrets(ws)
	if air.HP != airHP || turret.Runtime.StateReason != "no_ammunition" {
		t.Fatalf("wrong ammo must not fire, hp=%d reason=%q", air.HP, turret.Runtime.StateReason)
	}
	turret.Storage.EnsureInventory()[model.ItemAmmoMissile] = 3
	ws.Tick += 100
	settleTurrets(ws)
	if air.HP >= airHP {
		t.Fatal("anti-air must damage air unit")
	}
	if ground.HP != groundHP {
		t.Fatal("anti-air must not shoot ground units")
	}
	if turret.Storage.Inventory[model.ItemAmmoMissile] != 2 || turret.Storage.Inventory[model.ItemShellSet] != 5 {
		t.Fatalf("only missiles are consumed: %+v", turret.Storage.Inventory)
	}
	if turret.Runtime.StateReason != "" {
		t.Fatalf("no_ammunition must clear after firing, got %q", turret.Runtime.StateReason)
	}
}

func TestArtilleryTurretLongRangeMinRangeAndShells(t *testing.T) {
	ws := newAirDefenseWorld()
	turret := addRunningTurret(ws, "art", btArtillery, model.Position{X: 10, Y: 10}, "", 0)
	far := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 24, Y: 10}) // 距离 14，超出常规炮塔射程
	far.HP = 500
	near := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 12, Y: 10}) // 距离 2 < 最小射程 4
	near.HP = 500
	air := spawnWorldTestUnit(ws, model.UnitTypeAttackDrone, "p2", model.Position{X: 20, Y: 10})
	airHP := air.HP

	// 子弹/导弹不能装填炮塔。
	turret.Storage.EnsureInventory()[model.ItemAmmoBullet] = 5
	turret.Storage.EnsureInventory()[model.ItemAmmoMissile] = 5
	settleTurrets(ws)
	if far.HP != 500 || turret.Runtime.StateReason != "no_ammunition" {
		t.Fatalf("artillery must not fire bullets/missiles, hp=%d", far.HP)
	}

	turret.Storage.EnsureInventory()[model.ItemShellSet] = 2
	ws.Tick += 100
	settleTurrets(ws)
	if far.HP >= 500 {
		t.Fatal("artillery must hit a target 14 tiles away")
	}
	if near.HP != 500 {
		t.Fatal("artillery must not hit inside its minimum range")
	}
	if air.HP != airHP {
		t.Fatal("artillery cannot hit air units")
	}
	if turret.Storage.Inventory[model.ItemShellSet] != 1 {
		t.Fatalf("one shell consumed per shot, left %d", turret.Storage.Inventory[model.ItemShellSet])
	}
	normalDamage := 500 - far.HP

	// 高档炮弹优先装填且增伤。
	far.HP = 500
	turret.Storage.EnsureInventory()["crystal_shell_set"] = 1
	ws.Tick += 100
	settleTurrets(ws)
	if turret.Storage.Inventory["crystal_shell_set"] != 0 || turret.Storage.Inventory[model.ItemShellSet] != 1 {
		t.Fatalf("higher tier shell must be used first: %+v", turret.Storage.Inventory)
	}
	if 500-far.HP <= normalDamage {
		t.Fatalf("crystal shell must deal more damage (%d vs %d)", 500-far.HP, normalDamage)
	}
}

func TestAttackMovePrioritisesSupplyChain(t *testing.T) {
	newScene := func() (*model.WorldState, *model.Unit) {
		ws := newAirDefenseWorld()
		attacker := spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p1", model.Position{X: 10, Y: 10})
		attacker.Stance = model.UnitStanceAttackMove
		attacker.AggroRange = 8
		// 最近的是普通步兵。
		spawnWorldTestUnit(ws, model.UnitTypeSoldier, "p2", model.Position{X: 11, Y: 10})
		return ws, attacker
	}
	cases := []struct {
		name string
		add  func(ws *model.WorldState) string
	}{
		{"supply_station", func(ws *model.WorldState) string {
			b := newBuilding("supply", btSupply, "p2", model.Position{X: 15, Y: 10})
			ws.Buildings[b.ID] = b
			ws.TileBuilding[model.TileKey(15, 10)] = b.ID
			return b.ID
		}},
		{"supply_truck", func(ws *model.WorldState) string {
			return spawnWorldTestUnit(ws, model.UnitTypeSupplyTruck, "p2", model.Position{X: 15, Y: 11}).ID
		}},
		{"ammo_factory", func(ws *model.WorldState) string {
			b := newBuilding("ammo-fac", model.BuildingType("assembling_machine_mk1"), "p2", model.Position{X: 15, Y: 9})
			b.Production = &model.ProductionState{RecipeID: model.ItemAmmoBullet}
			ws.Buildings[b.ID] = b
			ws.TileBuilding[model.TileKey(15, 9)] = b.ID
			return b.ID
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ws, attacker := newScene()
			want := tc.add(ws)
			got := autoAcquireTarget(ws, attacker)
			if got == nil || got.id != want {
				t.Fatalf("attack-move must prefer %s, got %+v", want, got)
			}
			// 非攻击移动（普通索敌）不受该优先级影响：只打最近的步兵。
			attacker.Stance = model.UnitStanceIdle
			if idle := autoAcquireTarget(ws, attacker); idle == nil || idle.id == want {
				t.Fatalf("idle units must not prioritise the supply chain: %+v", idle)
			}
		})
	}
	t.Run("plain_factory_is_not_priority", func(t *testing.T) {
		ws, attacker := newScene()
		b := newBuilding("plain", model.BuildingType("assembling_machine_mk1"), "p2", model.Position{X: 12, Y: 10})
		b.Production = &model.ProductionState{RecipeID: "gear"}
		ws.Buildings[b.ID] = b
		ws.TileBuilding[model.TileKey(12, 10)] = b.ID
		got := autoAcquireTarget(ws, attacker)
		if got == nil || got.kind != "unit" {
			t.Fatalf("ordinary building must rank behind units: %+v", got)
		}
	})
}
