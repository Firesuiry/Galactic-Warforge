package gamecore

import (
	"testing"

	"siliconworld/internal/model"
	"siliconworld/internal/query"
	"siliconworld/internal/visibility"
)

func TestT095OfficialMidgameRayReceiverPowerModeStopsPhotonGrowthAndBackfeedsGrid(t *testing.T) {
	ClearSolarSailOrbits()
	ClearDysonSphereStates()
	t.Cleanup(func() {
		ClearSolarSailOrbits()
		ClearDysonSphereStates()
	})

	core := newOfficialMidgameTestCore(t)
	ws := core.World()
	player := ws.Players["p1"]
	if player == nil {
		t.Fatal("expected player p1")
	}

	receiver := newBuilding("receiver-t095", model.BuildingTypeRayReceiver, "p1", model.Position{X: 6, Y: 6})
	receiver.Runtime.State = model.BuildingWorkRunning
	receiver.Storage.EnsureInventory()[model.ItemCriticalPhoton] = 3

	ejector := newEMRailEjectorBuilding("ejector-t095", model.Position{X: 5, Y: 6}, "p1")
	ejector.Runtime.State = model.BuildingWorkRunning
	ejector.Storage.EnsureInventory()[model.ItemSolarSail] = 2

	silo := newVerticalLaunchingSiloBuilding("silo-t095", model.Position{X: 7, Y: 6}, "p1")
	silo.Runtime.State = model.BuildingWorkRunning
	silo.Storage.EnsureInventory()[model.ItemSmallCarrierRocket] = 1

	consumer := newBuilding("consumer-t095", model.BuildingTypeAssemblingMachineMk1, "p1", model.Position{X: 6, Y: 7})
	consumer.Runtime.State = model.BuildingWorkRunning
	consumer.Runtime.Params.EnergyConsume = 20
	if consumer.Runtime.Functions.Energy != nil {
		consumer.Runtime.Functions.Energy.ConsumePerTick = 20
	}

	for _, building := range []*model.Building{ejector, receiver, silo, consumer} {
		placeBuilding(ws, building)
		model.RegisterPowerGridBuilding(ws, building)
	}

	AddDysonLayer("p1", "sys-1", 0, 1.2)
	if _, err := AddDysonNode("p1", "sys-1", 0, 10, 20); err != nil {
		t.Fatalf("add dyson node: %v", err)
	}
	if _, err := AddDysonShell("p1", "sys-1", 0, -10, 10, 0.35); err != nil {
		t.Fatalf("add dyson shell: %v", err)
	}

	res := issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdSetRayReceiverMode,
		Payload: map[string]any{
			"building_id": receiver.ID,
			"mode":        string(model.RayReceiverModePower),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("set ray receiver mode: %s (%s)", res.Code, res.Message)
	}

	res = issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLaunchSolarSail,
		Payload: map[string]any{
			"building_id":  ejector.ID,
			"count":        float64(2),
			"orbit_radius": 1.2,
			"inclination":  5.0,
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("launch solar sail: %s (%s)", res.Code, res.Message)
	}

	res = issueInternalCommand(core, "p1", model.Command{
		Type: model.CmdLaunchRocket,
		Payload: map[string]any{
			"building_id": silo.ID,
			"system_id":   "sys-1",
			"layer_index": 0,
			"count":       float64(1),
		},
	})
	if res.Code != model.CodeOK {
		t.Fatalf("launch rocket: %s (%s)", res.Code, res.Message)
	}

	ql := query.New(visibility.New(), core.Maps(), core.Discovery())
	baselineSummary := ql.Summary(ws, "p1", core.Victory())
	baselineStats := ql.Stats(ws, "p1")
	baselineNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected baseline networks view")
	}

	baselineEnergy := baselineSummary.Players["p1"].Resources.Energy
	baselineGeneration := baselineStats.EnergyStats.Generation
	baselineSupply := totalPowerNetworkSupply(baselineNetworks)
	baselinePhotons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)

	for i := 0; i < 3; i++ {
		core.processTick()
	}

	postSummary := ql.Summary(ws, "p1", core.Victory())
	postStats := ql.Stats(ws, "p1")
	postNetworks, ok := ql.PlanetNetworks(ws, "p1", ws.PlanetID, ws.PlanetID)
	if !ok {
		t.Fatal("expected post-tick networks view")
	}

	postEnergy := postSummary.Players["p1"].Resources.Energy
	postGeneration := postStats.EnergyStats.Generation
	postSupply := totalPowerNetworkSupply(postNetworks)
	postPhotons := receiver.Storage.OutputQuantity(model.ItemCriticalPhoton)

	if postEnergy < baselineEnergy {
		t.Fatalf("expected summary energy to stay non-decreasing in official midgame path, baseline=%d post=%d", baselineEnergy, postEnergy)
	}
	if postGeneration <= baselineGeneration {
		t.Fatalf("expected stats generation to increase in official midgame path, baseline=%d post=%d", baselineGeneration, postGeneration)
	}
	if postSupply <= baselineSupply {
		t.Fatalf("expected network supply to increase in official midgame path, baseline=%d post=%d", baselineSupply, postSupply)
	}
	if postPhotons != baselinePhotons {
		t.Fatalf("expected power mode to preserve existing photon stock without new growth, baseline=%d post=%d", baselinePhotons, postPhotons)
	}
}
