package gamecore

import (
	"siliconworld/internal/model"
	"testing"
)

func TestDefenseTurretProfilesAndAmmoFire(t *testing.T) {
	ws := newPowerTestWorld()
	ws.Tick = 100
	for _, typ := range []model.BuildingType{model.BuildingTypeMissileTurret, model.BuildingTypeImplosionCannon, model.BuildingTypeLaserTurret, model.BuildingTypePlasmaTurret} {
		b := newBuilding(string(typ), typ, "p1", model.Position{X: 2, Y: 2})
		b.Runtime.State = model.BuildingWorkRunning
		ws.Buildings[b.ID] = b
		if b.Runtime.Functions.Combat == nil || b.Runtime.Functions.Combat.Attack <= 0 {
			t.Fatalf("%s missing combat runtime", typ)
		}
		if b.Runtime.Functions.Combat.AmmoItem != "" {
			b.Storage.EnsureInventory()[b.Runtime.Functions.Combat.AmmoItem] = 1
		}
	}
	enemy := model.UnitStats(model.UnitTypeSoldier)
	enemy.ID, enemy.OwnerID, enemy.Position = "enemy", "p2", model.Position{X: 3, Y: 2}
	ws.Units[enemy.ID] = &enemy
	events := settleTurrets(ws)
	if len(events) == 0 || enemy.HP >= model.UnitStats(model.UnitTypeSoldier).HP {
		t.Fatalf("expected turret damage events, hp=%d events=%d", enemy.HP, len(events))
	}
}

func TestMissileTurretStopsWithNoAmmoAndResumesAfterRefill(t *testing.T) {
	ws := newPowerTestWorld()
	ws.Tick = 10
	b := newBuilding("missile", model.BuildingTypeMissileTurret, "p1", model.Position{X: 2, Y: 2})
	b.Runtime.State = model.BuildingWorkRunning
	ws.Buildings[b.ID] = b
	enemy := model.UnitStats(model.UnitTypeSoldier)
	enemy.ID, enemy.OwnerID, enemy.Position = "enemy", "p2", model.Position{X: 3, Y: 2}
	ws.Units[enemy.ID] = &enemy
	settleTurrets(ws)
	if b.Runtime.StateReason != "no_ammunition" || enemy.HP != model.UnitStats(model.UnitTypeSoldier).HP {
		t.Fatalf("expected no-ammo stop, state=%s reason=%s hp=%d", b.Runtime.State, b.Runtime.StateReason, enemy.HP)
	}
	b.Storage.EnsureInventory()[model.ItemAmmoMissile] = 1
	ws.Tick = 50
	settleTurrets(ws)
	if enemy.HP >= model.UnitStats(model.UnitTypeSoldier).HP || b.Storage.Inventory[model.ItemAmmoMissile] != 0 {
		t.Fatalf("expected resumed fire, hp=%d ammo=%d", enemy.HP, b.Storage.Inventory[model.ItemAmmoMissile])
	}
}

func TestTurretLoadedAmmoSurvivesStorageSettlementAndCooldown(t *testing.T) {
	for _, typ := range []model.BuildingType{model.BuildingTypeMissileTurret, model.BuildingTypeImplosionCannon, model.BuildingTypePlasmaTurret} {
		t.Run(string(typ), func(t *testing.T) {
			ws := newPowerTestWorld()
			ws.Tick = 100
			b := newBuilding("turret", typ, "p1", model.Position{X: 2, Y: 2})
			b.Runtime.State = model.BuildingWorkRunning
			ws.Buildings[b.ID] = b
			combat := b.Runtime.Functions.Combat
			if accepted, _, err := b.Storage.Load(combat.AmmoItem, 2); err != nil || accepted != 2 {
				t.Fatalf("load: %d %v", accepted, err)
			}
			settleStorage(ws)
			if b.Storage.OutputBuffer[combat.AmmoItem] != 2 {
				t.Fatal("must exercise loaded ammo moved into output buffer")
			}
			enemy := model.UnitStats(model.UnitTypeSoldier)
			enemy.ID, enemy.OwnerID, enemy.Position, enemy.HP = "enemy", "p2", model.Position{X: 3, Y: 2}, 500
			ws.Units[enemy.ID] = &enemy
			events := settleTurrets(ws)
			firstHP := enemy.HP
			if firstHP >= 500 || b.Storage.OutputBuffer[combat.AmmoItem] != 1 {
				t.Fatal("loaded ammo did not fire")
			}
			notified := false
			for _, e := range events {
				if e.EventType == model.EvtDamageApplied && e.VisibilityScope == "p1" {
					notified = true
				}
			}
			if !notified {
				t.Fatal("firing player did not receive damage event")
			}
			ws.Tick += int64(combat.FireRate - 1)
			settleTurrets(ws)
			if enemy.HP != firstHP || b.Storage.OutputBuffer[combat.AmmoItem] != 1 {
				t.Fatal("cooldown consumed ammo or damaged target")
			}
			ws.Tick++
			settleTurrets(ws)
			if enemy.HP >= firstHP || b.Storage.OutputBuffer[combat.AmmoItem] != 0 {
				t.Fatal("cooldown boundary did not fire exactly once")
			}
			ws.Tick += int64(combat.FireRate)
			lastHP := enemy.HP
			settleTurrets(ws)
			if b.Runtime.StateReason != "no_ammunition" || enemy.HP != lastHP {
				t.Fatal("empty turret should stop")
			}
			if len(settleTurrets(ws)) != 0 {
				t.Fatal("unchanged missing-ammo reason should not spam")
			}
			b.Storage.Load(combat.AmmoItem, 1)
			settleTurrets(ws)
			if b.Runtime.StateReason != "" || enemy.HP >= lastHP {
				t.Fatal("input-buffer reload failed")
			}
		})
	}
}

func TestTurretAmmoConsumptionIsAtomicAcrossBuffers(t *testing.T) {
	s := &model.StorageState{InputBuffer: model.ItemInventory{"ammo": 1}, Inventory: model.ItemInventory{"ammo": 1}, OutputBuffer: model.ItemInventory{"ammo": 1, "other": 2}}
	if consumeTurretAmmunition(s, "ammo", 4) || s.InputBuffer["ammo"] != 1 || s.Inventory["ammo"] != 1 || s.OutputBuffer["ammo"] != 1 {
		t.Fatal("insufficient ammo partially consumed")
	}
	if !consumeTurretAmmunition(s, "ammo", 3) || availableStorageItem(s, "ammo") != 0 || s.OutputBuffer["ammo"] != 0 || s.OutputBuffer["other"] != 2 {
		t.Fatal("ammo conservation failed")
	}
}

func TestTurretDoesNotSpendAmmoWhenInactive(t *testing.T) {
	for _, scenario := range []string{"no_power", "paused", "friendly", "out_of_range", "no_target"} {
		t.Run(scenario, func(t *testing.T) {
			ws := newPowerTestWorld()
			ws.Tick = 100
			b := newBuilding("turret", model.BuildingTypeMissileTurret, "p1", model.Position{X: 0, Y: 0})
			b.Runtime.State = model.BuildingWorkRunning
			b.Storage.Load(model.ItemAmmoMissile, 2)
			ws.Buildings[b.ID] = b
			enemy := model.UnitStats(model.UnitTypeSoldier)
			enemy.ID, enemy.OwnerID, enemy.Position = "enemy", "p2", model.Position{X: 1, Y: 0}
			if scenario != "no_target" {
				ws.Units[enemy.ID] = &enemy
			}
			switch scenario {
			case "no_power", "paused":
				b.Runtime.State = model.BuildingWorkState(scenario)
			case "friendly":
				enemy.OwnerID = "p1"
			case "out_of_range":
				b.Runtime.Functions.Combat.Range = 1
				enemy.Position = model.Position{X: 4, Y: 4}
			}
			settleTurrets(ws)
			if availableStorageItem(b.Storage, model.ItemAmmoMissile) != 2 || enemy.HP != model.UnitStats(model.UnitTypeSoldier).HP {
				t.Fatal("inactive turret consumed ammo or applied damage")
			}
		})
	}
}
