package model

import "testing"

func TestPowerCoverageLineAdjacency(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	provider := newTestBuilding("p-grid", BuildingTypeTeslaTower, Position{X: 1, Y: 1})
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
	provider := newTestBuilding("p-grid", BuildingTypeTeslaTower, Position{X: 1, Y: 1})
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
	provider := newTestBuilding("p-grid", BuildingTypeWirelessPowerTower, Position{X: 1, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 1 + DefaultWirelessPowerTowerRange - 1, Y: 1})
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

func TestPowerCoverageCapacityFull(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}
	provider := newTestBuilding("p-grid", BuildingTypeTeslaTower, Position{X: 2, Y: 2})
	consumer1 := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 1, Y: 2})
	consumer2 := newTestBuilding("c-2", BuildingTypeAssemblingMachineMk1, Position{X: 3, Y: 2})
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
	if res2.Connected {
		t.Fatalf("expected %s disconnected", consumer2.ID)
	}
	if res2.Reason != PowerCoverageCapacityFull {
		t.Fatalf("expected reason %s, got %s", PowerCoverageCapacityFull, res2.Reason)
	}
}
