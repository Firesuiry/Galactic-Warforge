package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT094RayReceiverPowerAppearsInSummaryStatsAndNetworksSameTick(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	t.Cleanup(func() {
		ClearSolarSailOrbits()
		ClearDysonSphereStates()
	})

	core := newE2ETestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	wind := newBuilding("wind-t094", model.BuildingTypeWindTurbine, "p1", model.Position{X: 5, Y: 6})
	wind.Runtime.State = model.BuildingWorkRunning

	receiver := newBuilding("receiver-t094", model.BuildingTypeRayReceiver, "p1", model.Position{X: 6, Y: 6})
	receiver.Runtime.State = model.BuildingWorkRunning
	if receiver.Runtime.Functions.RayReceiver == nil {
		t.Fatal("expected ray receiver module")
	}
	receiver.Runtime.Functions.RayReceiver.Mode = model.RayReceiverModePower

	consumer := newBuilding("consumer-t094", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 7, Y: 6})
	consumer.Runtime.State = model.BuildingWorkRunning
	consumer.Runtime.Params.EnergyConsume = 20
	if consumer.Runtime.Functions.Energy != nil {
		consumer.Runtime.Functions.Energy.ConsumePerTick = 20
	}

	for _, building := range []*model.Building{wind, receiver, consumer} {
		placeBuilding(ws, building)
		model.RegisterPowerGridBuilding(ws, building)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())

	player.Resources.Energy = 0
	core.processTick()

	baselineSummary := ql.Summary(ws, "p1", core.Victory())
	baselineStats := ql.Stats(ws, "p1")
	baselineNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected baseline networks view")
	}

	baselineEnergy := baselineSummary.Players["p1"].Resources.Energy
	baselineGeneration := baselineStats.EnergyStats.Generation
	baselineSupply := totalPowerNetworkSupply(baselineNetworks)

	player.Resources.Energy = 0
	AddDysonLayer(core.spaceRuntime, "p1", "sys-1", 0, 1.2)
	if _, err := AddDysonShell(core.spaceRuntime, "p1", "sys-1", 0, -10, 10, 0.35); err != nil {
		t.Fatalf("add dyson shell: %v", err)
	}

	core.processTick()

	postSummary := ql.Summary(ws, "p1", core.Victory())
	postStats := ql.Stats(ws, "p1")
	postNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected post-dyson networks view")
	}

	postEnergy := postSummary.Players["p1"].Resources.Energy
	postGeneration := postStats.EnergyStats.Generation
	postSupply := totalPowerNetworkSupply(postNetworks)

	if postEnergy <= baselineEnergy {
		t.Fatalf("expected summary energy to exceed baseline after dyson refresh, baseline=%d post=%d", baselineEnergy, postEnergy)
	}
	if postGeneration <= baselineGeneration {
		t.Fatalf("expected generation to exceed baseline after dyson refresh, baseline=%d post=%d", baselineGeneration, postGeneration)
	}
	if postSupply <= baselineSupply {
		t.Fatalf("expected network supply to exceed baseline after dyson refresh, baseline=%d post=%d", baselineSupply, postSupply)
	}
	if !hasRayReceiverPowerInput(ws.PowerInputs) {
		t.Fatalf("expected ray receiver power input in %+v", ws.PowerInputs)
	}
}

func totalPowerNetworkSupply(view *query.PlanetNetworksView) int {
	if view == nil {
		return 0
	}
	total := 0
	for _, network := range view.PowerNetworks {
		total += network.Supply
	}
	return total
}

func hasRayReceiverPowerInput(inputs []model.PowerInput) bool {
	for _, input := range inputs {
		if input.SourceKind == model.PowerSourceRayReceiver {
			return true
		}
	}
	return false
}
