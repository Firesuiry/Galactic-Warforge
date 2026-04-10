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

	views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)

	if player.Resources.Energy != 0 {
		t.Fatalf("expected no energy gain without dyson energy, got %d", player.Resources.Energy)
	}
	if got := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton); got != 0 {
		t.Fatalf("expected no photon output without dyson energy, got %d", got)
	}
	if len(views) != 1 {
		t.Fatalf("expected one receiver settlement view, got %d", len(views))
	}
	if len(ws.PowerInputs) != 0 {
		t.Fatalf("expected no power inputs without dyson energy, got %d", len(ws.PowerInputs))
	}
	if got := views[receiver.ID].PowerOutput; got != 0 {
		t.Fatalf("expected no power output without dyson energy, got %d", got)
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

	LaunchSolarSail(core.spaceRuntime, "p1", "sys-1", 1.2, 5, 1)

	views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)

	if player.Resources.Energy != 0 {
		t.Fatalf("expected no direct energy commit before finalize, got %d", player.Resources.Energy)
	}
	if got := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton); got != 0 {
		t.Fatalf("expected no photon output from a single capped sail, got %d", got)
	}
	if got := views[receiver.ID].PowerOutput; got != 7 {
		t.Fatalf("expected power output capped to 7, got %d", got)
	}
	if len(ws.PowerInputs) != 1 {
		t.Fatalf("expected 1 power input, got %d", len(ws.PowerInputs))
	}
	if ws.PowerInputs[0].BaseOutput != 10 {
		t.Fatalf("expected base output capped at 10, got %d", ws.PowerInputs[0].BaseOutput)
	}
	if got := views[receiver.ID].EffectiveInput; got != 10 {
		t.Fatalf("expected effective input 10, got %d", got)
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

	AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)
	if _, err := AddDysonShell(core.spaceRuntime, "p1", "sys-1", 0, -10, 10, 0.35); err != nil {
		t.Fatalf("add dyson shell: %v", err)
	}
	if got := GetDysonSphereEnergy(core.spaceRuntime, "p1", "sys-1"); got != 0 {
		t.Fatalf("expected dyson energy to remain unset before settlement, got %d", got)
	}
	settleDysonSpheres(core.spaceRuntime, ws.Tick)

	views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)

	if player.Resources.Energy != 0 {
		t.Fatalf("expected no direct energy commit before finalize, got %d", player.Resources.Energy)
	}
	if got := views[receiver.ID].PowerOutput; got != 60 {
		t.Fatalf("expected 60 power output from capped dyson shell input, got %d", got)
	}
	if len(ws.PowerInputs) != 1 {
		t.Fatalf("expected 1 power input, got %d", len(ws.PowerInputs))
	}
	if ws.PowerInputs[0].BaseOutput != 120 {
		t.Fatalf("expected base output capped at 120, got %d", ws.PowerInputs[0].BaseOutput)
	}
}

func TestSettleRayReceiversGainMoreFromRocketConstructionBonus(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	core := newE2ETestCore(t)
	ws := core.World()

	receiver := newRayReceiverBuilding("receiver-1", model.Position{X: 6, Y: 6}, "p1")
	receiver.Runtime.Functions.RayReceiver.InputPerTick = 1000
	receiver.Runtime.Functions.RayReceiver.PowerOutputPerTick = 1000
	attachBuilding(ws, receiver)

	AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)
	if _, err := AddDysonShell(core.spaceRuntime, "p1", "sys-1", 0, -10, 10, 0.35); err != nil {
		t.Fatalf("add dyson shell: %v", err)
	}
	settleDysonSpheres(core.spaceRuntime, ws.Tick)

	player := ws.Players["p1"]
	player.Resources.Energy = 0
	ws.PowerInputs = nil
	baseViews := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)
	basePowerGain := baseViews[receiver.ID].PowerOutput

	player.Resources.Energy = 0
	ws.PowerInputs = nil
	state := GetDysonSphereState(core.spaceRuntime, "p1", "sys-1")
	if state == nil || len(state.Layers) == 0 {
		t.Fatal("expected dyson sphere state")
	}
	state.Layers[0].ConstructionBonus = 0.20
	settleDysonSpheres(core.spaceRuntime, ws.Tick+1)
	boostedViews := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)

	if boostedViews[receiver.ID].PowerOutput <= basePowerGain {
		t.Fatalf("expected rocket bonus to increase ray receiver income, base=%d boosted=%d", basePowerGain, boostedViews[receiver.ID].PowerOutput)
	}
}

func TestSettleRayReceiversRespectModesAndKeepExistingPhotonStock(t *testing.T) {
	cases := []struct {
		name            string
		mode            model.RayReceiverMode
		seedPhotons     int
		wantEnergyGain  int
		wantPhotonDelta int
	}{
		{
			name:            "power",
			mode:            model.RayReceiverModePower,
			seedPhotons:     3,
			wantEnergyGain:  60,
			wantPhotonDelta: 0,
		},
		{
			name:            "photon",
			mode:            model.RayReceiverModePhoton,
			seedPhotons:     0,
			wantEnergyGain:  0,
			wantPhotonDelta: 2,
		},
		{
			name:            "hybrid",
			mode:            model.RayReceiverModeHybrid,
			seedPhotons:     1,
			wantEnergyGain:  60,
			wantPhotonDelta: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ClearSolarSailOrbits()
			ClearDysonSphereStates()

			core := newE2ETestCore(t)
			ws := core.World()

			receiver := newRayReceiverBuilding("receiver-1", model.Position{X: 6, Y: 6}, "p1")
			receiver.Runtime.State = model.BuildingWorkRunning
			receiver.Runtime.Functions.RayReceiver.Mode = tc.mode
			receiver.Storage.EnsureInventory()[model.ItemCriticalPhoton] = tc.seedPhotons
			attachBuilding(ws, receiver)

			AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)
			if _, err := AddDysonShell(core.spaceRuntime, "p1", "sys-1", 0, -10, 10, 0.35); err != nil {
				t.Fatalf("add dyson shell: %v", err)
			}
			settleDysonSpheres(core.spaceRuntime, ws.Tick)

			player := ws.Players["p1"]
			player.Resources.Energy = 0
			ws.PowerInputs = nil

			views := settleRayReceivers(ws, core.Maps(), core.spaceRuntime)
			settleStorage(ws)
			if player.Resources.Energy != 0 {
				t.Fatalf("expected no direct energy commit in %s mode, got %d", tc.mode, player.Resources.Energy)
			}
			gotPhotons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)
			if delta := gotPhotons - tc.seedPhotons; delta != tc.wantPhotonDelta {
				t.Fatalf("expected photon delta %d in %s mode, got %d (total=%d)", tc.wantPhotonDelta, tc.mode, delta, gotPhotons)
			}
			if tc.wantEnergyGain > 0 {
				if len(ws.PowerInputs) != 1 {
					t.Fatalf("expected one power input in %s mode, got %d", tc.mode, len(ws.PowerInputs))
				}
				if got := views[receiver.ID].PowerOutput; got != tc.wantEnergyGain {
					t.Fatalf("expected power output %d in %s mode, got %d", tc.wantEnergyGain, tc.mode, got)
				}
			} else {
				if len(ws.PowerInputs) != 0 {
					t.Fatalf("expected no power inputs in %s mode, got %d", tc.mode, len(ws.PowerInputs))
				}
				if got := views[receiver.ID].PowerOutput; got != 0 {
					t.Fatalf("expected no power output in %s mode, got %d", tc.mode, got)
				}
			}
		})
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
