package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestSettleRayReceiversRequiresDysonEnergy(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newRayReceiverBuilding("receiver-1", model.Position{X: 6, Y: 6}, "p1")
	attachBuilding(ws, receiver)

	player := ws.Players["p1"]
	player.Resources.Energy = 0

	events := settleRayReceivers(ws)

	if player.Resources.Energy != 0 {
		t.Fatalf("expected no energy gain without dyson energy, got %d", player.Resources.Energy)
	}
	if got := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton); got != 0 {
		t.Fatalf("expected no photon output without dyson energy, got %d", got)
	}
	if len(events) != 0 {
		t.Fatalf("expected no events without dyson energy, got %d", len(events))
	}
	if len(ws.PowerInputs) != 0 {
		t.Fatalf("expected no power inputs without dyson energy, got %d", len(ws.PowerInputs))
	}
}

func TestSettleRayReceiversConsumeSolarSailEnergyUpToInputCap(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newRayReceiverBuilding("receiver-1", model.Position{X: 6, Y: 6}, "p1")
	receiver.Runtime.Functions.RayReceiver.InputPerTick = 10
	attachBuilding(ws, receiver)

	player := ws.Players["p1"]
	player.Resources.Energy = 0

	LaunchSolarSail("p1", "sys-1", 1.2, 5, 1)

	events := settleRayReceivers(ws)

	if player.Resources.Energy != 7 {
		t.Fatalf("expected power gain capped to 7, got %d", player.Resources.Energy)
	}
	if got := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton); got != 0 {
		t.Fatalf("expected no photon output from a single capped sail, got %d", got)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 resource change event, got %d", len(events))
	}
	if len(ws.PowerInputs) != 1 {
		t.Fatalf("expected 1 power input, got %d", len(ws.PowerInputs))
	}
	if ws.PowerInputs[0].BaseOutput != 10 {
		t.Fatalf("expected base output capped at 10, got %d", ws.PowerInputs[0].BaseOutput)
	}
}

func TestSettleRayReceiversConsumeDysonSphereEnergyUpToInputCap(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newRayReceiverBuilding("receiver-1", model.Position{X: 6, Y: 6}, "p1")
	receiver.Runtime.Functions.RayReceiver.InputPerTick = 120
	attachBuilding(ws, receiver)

	player := ws.Players["p1"]
	player.Resources.Energy = 0

	AddDysonLayer("p1", "sys-1", 0, 1.2)
	if _, err := AddDysonShell("p1", "sys-1", 0, -10, 10, 0.35); err != nil {
		t.Fatalf("add dyson shell: %v", err)
	}
	if got := GetDysonSphereEnergyForPlayer("p1"); got != 0 {
		t.Fatalf("expected dyson energy to remain unset before settlement, got %d", got)
	}
	settleDysonSpheres(ws.Tick)

	events := settleRayReceivers(ws)

	if player.Resources.Energy != 60 {
		t.Fatalf("expected 60 energy from capped dyson shell input, got %d", player.Resources.Energy)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 resource change event, got %d", len(events))
	}
	if len(ws.PowerInputs) != 1 {
		t.Fatalf("expected 1 power input, got %d", len(ws.PowerInputs))
	}
	if ws.PowerInputs[0].BaseOutput != 120 {
		t.Fatalf("expected base output capped at 120, got %d", ws.PowerInputs[0].BaseOutput)
	}
}

func newRayReceiverBuilding(id string, pos model.Position, owner string) *model.Building {
	profile := model.BuildingProfileFor(model.BuildingTypeRayReceiver, 1)
	b := &model.Building{
		ID:          id,
		Type:        model.BuildingTypeRayReceiver,
		OwnerID:     owner,
		Position:    pos,
		Runtime:     profile.Runtime,
		VisionRange: profile.VisionRange,
		MaxHP:       profile.MaxHP,
		HP:          profile.MaxHP,
		Level:       1,
	}
	model.InitBuildingStorage(b)
	return b
}
