package model

import "testing"

func TestPowerGridAggregationTotals(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}

	generator := newTestBuilding("g-1", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 2, Y: 1})
	ws.Buildings[generator.ID] = generator
	ws.Buildings[consumer.ID] = consumer
	ws.PowerGrid = BuildPowerGridGraph(ws)
	ws.PowerInputs = []PowerInput{{BuildingID: generator.ID, OwnerID: "p1", Output: 12}}

	state := ResolvePowerNetworks(ws)
	if len(state.Networks) != 1 {
		t.Fatalf("expected 1 power network, got %d", len(state.Networks))
	}
	var network *PowerNetwork
	for _, net := range state.Networks {
		network = net
		break
	}
	if network == nil {
		t.Fatalf("missing power network")
	}
	if network.Supply != 12 {
		t.Fatalf("expected supply 12, got %d", network.Supply)
	}
	if network.Demand != 5 {
		t.Fatalf("expected demand 5, got %d", network.Demand)
	}
	if network.Net != 7 {
		t.Fatalf("expected net 7, got %d", network.Net)
	}
}

func TestPowerGridSplitMerge(t *testing.T) {
	ws := NewWorldState("p1", 10, 10)
	ws.Players["p1"] = &PlayerState{PlayerID: "p1", IsAlive: true}

	gen := newTestBuilding("g-1", BuildingTypeWindTurbine, Position{X: 1, Y: 1})
	bridge := newTestBuilding("b-1", BuildingTypeTeslaTower, Position{X: 2, Y: 1})
	consumer := newTestBuilding("c-1", BuildingTypeAssemblingMachineMk1, Position{X: 3, Y: 1})
	ws.Buildings[gen.ID] = gen
	ws.Buildings[bridge.ID] = bridge
	ws.Buildings[consumer.ID] = consumer
	ws.PowerGrid = BuildPowerGridGraph(ws)
	ws.PowerInputs = []PowerInput{{BuildingID: gen.ID, OwnerID: "p1", Output: 10}}

	state := ResolvePowerNetworks(ws)
	if len(state.Networks) != 1 {
		t.Fatalf("expected 1 power network before split, got %d", len(state.Networks))
	}

	ws.PowerGrid.RemoveBuilding(bridge.ID)
	delete(ws.Buildings, bridge.ID)

	split := ResolvePowerNetworks(ws)
	if len(split.Networks) != 2 {
		t.Fatalf("expected 2 power networks after split, got %d", len(split.Networks))
	}
	if split.BuildingNetwork[gen.ID] == split.BuildingNetwork[consumer.ID] {
		t.Fatalf("expected generator and consumer in different networks after split")
	}

	ws.Buildings[bridge.ID] = bridge
	ws.PowerGrid.AddBuilding(bridge)

	merged := ResolvePowerNetworks(ws)
	if len(merged.Networks) != 1 {
		t.Fatalf("expected 1 power network after merge, got %d", len(merged.Networks))
	}
	if merged.BuildingNetwork[gen.ID] != merged.BuildingNetwork[consumer.ID] {
		t.Fatalf("expected generator and consumer in same network after merge")
	}
}
