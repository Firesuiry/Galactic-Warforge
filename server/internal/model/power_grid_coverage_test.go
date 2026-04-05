package model

import "testing"

func TestPowerCoverageLineAdjacency(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	provider := newTestBuilding("p-grid", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 1})
	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer.ID] = consumer
	ws.PowerGrid = BuildPowerGridGraph(ws)

	coverage := ResolvePowerCoverage(ws)
	res, ok := coverage[consumer.ID]
	if !ok {
		t.Fatalf("missing coverage result for %s", consumer.ID)
	}
	if !res.Connected {
		t.Fatalf("expected consumer connected, got reason=%s", res.Reason)
	}
}

func TestPowerCoverageOutOfRange(t *testing.T) {
	ws := NewWorldState("p1", 20, 20)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	provider := newTestBuilding("p-grid", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 10, Y: 10})
	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer.ID] = consumer
	ws.PowerGrid = BuildPowerGridGraph(ws)

	coverage := ResolvePowerCoverage(ws)
	res, ok := coverage[consumer.ID]
	if !ok {
		t.Fatalf("missing coverage result for %s", consumer.ID)
	}
	if res.Connected {
		t.Fatalf("expected consumer disconnected")
	}
	if res.Reason != PowerCoverageOutOfRange {
		t.Fatalf("expected reason %s, got %s", PowerCoverageOutOfRange, res.Reason)
	}
}

func TestPowerCoverageWirelessAccess(t *testing.T) {
	ws := NewWorldState("p1", 20, 20)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	source := newTestBuilding("gen-1", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	provider := newTestBuilding("p-grid", BuildingTypeWirelessPowerTower, Position{X: 2, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 1 + DefaultWirelessPowerTowerRange - 1, Y: 1})
	ws.Buildings[source.ID] = source
	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer.ID] = consumer
	ws.PowerGrid = BuildPowerGridGraph(ws)

	coverage := ResolvePowerCoverage(ws)
	res, ok := coverage[consumer.ID]
	if !ok {
		t.Fatalf("missing coverage result for %s", consumer.ID)
	}
	if !res.Connected {
		t.Fatalf("expected wireless coverage, got reason=%s", res.Reason)
	}
}

func TestPowerCoverageRelayHasNoConsumerSlotLimit(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	source := newTestBuilding("gen-1", BuildingTypeWindTurbine, Position{X: 1, Y: 2})
	provider := newTestBuilding("p-grid", BuildingTypeTeslaTower, Position{X: 2, Y: 2})
	consumer1 := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 4, Y: 2})
	consumer2 := newTestBuilding("c-2", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 5})
	ws.Buildings[source.ID] = source
	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer1.ID] = consumer1
	ws.Buildings[consumer2.ID] = consumer2
	ws.PowerGrid = BuildPowerGridGraph(ws)

	coverage := ResolvePowerCoverage(ws)
	res1 := coverage[consumer1.ID]
	res2 := coverage[consumer2.ID]
	if !res1.Connected {
		t.Fatalf("expected %s connected, got reason=%s", consumer1.ID, res1.Reason)
	}
	if !res2.Connected {
		t.Fatalf("expected %s connected, got reason=%s", consumer2.ID, res2.Reason)
	}
}

func TestPowerCoverageTreatsDynamicPowerInputsAsProvider(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["player-1"] = &PlayerState{PlayerID: "player-1", IsAlive: true}
	provider := newTestBuilding("rr-1", BuildingTypeRayReceiver, Position{X: 1, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 1})
	ws.Buildings[provider.ID] = provider
	ws.Buildings[consumer.ID] = consumer
	ws.PowerInputs = []PowerInput{
		{BuildingID: provider.ID, OwnerID: "player-1", SourceKind: PowerSourceRayReceiver, Output: 18},
	}
	ws.PowerGrid = BuildPowerGridGraph(ws)

	networks := ResolvePowerNetworks(ws)
	networkID := networks.BuildingNetwork[consumer.ID]
	if networkID == "" {
		t.Fatalf("expected consumer network membership, got %+v", networks)
	}
	if networks.Networks[networkID] == nil || networks.Networks[networkID].Supply <= 0 {
		t.Fatalf("expected dynamic ray receiver power to reach network supply, got %+v", networks.Networks[networkID])
	}

	coverage := ResolvePowerCoverage(ws)
	res, ok := coverage[consumer.ID]
	if !ok {
		t.Fatalf("missing coverage result for %s", consumer.ID)
	}
	if !res.Connected {
		t.Fatalf("expected dynamic power input to count as provider, got reason=%s", res.Reason)
	}
	if res.ProviderID != provider.ID {
		t.Fatalf("expected provider %s, got %s", provider.ID, res.ProviderID)
	}
}
