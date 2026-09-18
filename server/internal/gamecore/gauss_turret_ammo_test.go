package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func newGaussTurret(ws *model.WorldState, id, owner string, pos model.Position) *model.Building {
	turret := newBuilding(id, model.BuildingTypeGaussTurret, owner, pos)
	turret.Runtime.State = model.BuildingWorkRunning
	placeBuilding(ws, turret)
	return turret
}

func TestGaussTurretConsumesAmmoWhenFiring(t *testing.T) {
	ws, unit := mechaTestWorld()
	turret := newGaussTurret(ws, "t-1", "p2", model.Position{X: 2, Y: 1})
	if _, _, err := turret.Storage.Load(model.ItemAmmoBullet, 2); err != nil {
		t.Fatalf("load ammo: %v", err)
	}

	events := settleTurrets(ws)

	foundDamage := false
	for _, evt := range events {
		if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == unit.ID {
			foundDamage = true
		}
	}
	if !foundDamage {
		t.Fatalf("expected gauss turret to fire with ammo, events=%+v", events)
	}
	if got := turret.Storage.ItemQuantity(model.ItemAmmoBullet); got != 1 {
		t.Fatalf("expected 1 ammo consumed, %d left", got)
	}
	if turret.Runtime.Functions.Combat.LastFireTick != ws.Tick {
		t.Fatalf("expected last fire tick %d, got %d", ws.Tick, turret.Runtime.Functions.Combat.LastFireTick)
	}
}

func TestGaussTurretHoldsFireWithoutAmmo(t *testing.T) {
	ws, unit := mechaTestWorld()
	turret := newGaussTurret(ws, "t-1", "p2", model.Position{X: 2, Y: 1})
	hpBefore := unit.HP

	events := settleTurrets(ws)

	for _, evt := range events {
		if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == unit.ID {
			t.Fatalf("expected no firing without ammo, events=%+v", events)
		}
	}
	if unit.HP != hpBefore {
		t.Fatalf("expected unit hp unchanged, got %d -> %d", hpBefore, unit.HP)
	}
	if turret.Runtime.StateReason != "no_ammunition" {
		t.Fatalf("expected no_ammunition reason, got %q", turret.Runtime.StateReason)
	}

	// Reloading clears the hold and the turret fires again.
	if _, _, err := turret.Storage.Load(model.ItemAmmoBullet, 1); err != nil {
		t.Fatalf("load ammo: %v", err)
	}
	ws.Tick += 100
	events = settleTurrets(ws)
	foundDamage := false
	for _, evt := range events {
		if evt.EventType == model.EvtDamageApplied && evt.Payload["target_id"] == unit.ID {
			foundDamage = true
		}
	}
	if !foundDamage {
		t.Fatalf("expected firing after reload, events=%+v", events)
	}
	if got := turret.Storage.ItemQuantity(model.ItemAmmoBullet); got != 0 {
		t.Fatalf("expected reloaded ammo consumed, %d left", got)
	}
}

func TestGaussTurretRuntimeExposesAmmoLoopData(t *testing.T) {
	def, ok := model.BuildingRuntimeDefinitionByID(model.BuildingTypeGaussTurret)
	if !ok {
		t.Fatalf("missing gauss turret runtime definition")
	}
	combat := def.Functions.Combat
	if combat == nil {
		t.Fatalf("missing combat module")
	}
	if combat.AmmoItem != model.ItemAmmoBullet || combat.AmmoConsume != 1 {
		t.Fatalf("expected primary ammo ammo_bullet x1, got %+v", combat)
	}
	if combat.AltAmmoItem != model.ItemTitaniumAmmo || combat.AltAmmoAttack <= combat.Attack {
		t.Fatalf("expected titanium upgrade ammo with higher attack, got %+v", combat)
	}
	if def.Functions.Storage == nil {
		t.Fatalf("expected ammo storage module")
	}
	var ammoPort *model.IOPort
	for i := range def.Params.IOPorts {
		if def.Params.IOPorts[i].ID == "ammo" {
			ammoPort = &def.Params.IOPorts[i]
		}
	}
	if ammoPort == nil || ammoPort.Direction != model.PortInput {
		t.Fatalf("expected ammo input port, got %+v", def.Params.IOPorts)
	}
	allows := map[string]bool{}
	for _, item := range ammoPort.AllowedItems {
		allows[item] = true
	}
	if !allows[model.ItemAmmoBullet] || !allows[model.ItemTitaniumAmmo] {
		t.Fatalf("expected ammo port to allow ammo_bullet and titanium_ammo, got %+v", ammoPort.AllowedItems)
	}
}
