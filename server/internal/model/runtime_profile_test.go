package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMatrixLabProfileExposesProductionAndResearch(t *testing.T) {
	profile := BuildingProfileFor(BuildingTypeMatrixLab, 1)
	if profile.Runtime.Functions.Production == nil {
		t.Fatal("matrix lab should expose production module")
	}
	if profile.Runtime.Functions.Research == nil {
		t.Fatal("matrix lab should expose research module")
	}
	if profile.Runtime.Functions.Storage == nil {
		t.Fatal("matrix lab should expose storage module")
	}
}

func TestAssemblyTierProfilesHaveIndependentCapacityAndPower(t *testing.T) {
	mk1 := BuildingProfileFor(BuildingTypeAssemblingMachineMk1, 1).Runtime
	mk2 := BuildingProfileFor(BuildingTypeAssemblingMachineMk2, 1).Runtime
	mk3 := BuildingProfileFor(BuildingTypeAssemblingMachineMk3, 1).Runtime
	if mk2.Functions.Production == nil || mk3.Functions.Production == nil {
		t.Fatal("assembly Mk2/Mk3 should expose production modules")
	}
	if mk2.Functions.Production.Throughput <= mk1.Functions.Production.Throughput || mk3.Functions.Production.Throughput <= mk2.Functions.Production.Throughput {
		t.Fatalf("expected tiered throughput, got %d/%d/%d", mk1.Functions.Production.Throughput, mk2.Functions.Production.Throughput, mk3.Functions.Production.Throughput)
	}
	if mk2.Params.EnergyConsume <= mk1.Params.EnergyConsume || mk3.Params.EnergyConsume <= mk2.Params.EnergyConsume {
		t.Fatalf("expected tiered energy consumption, got %d/%d/%d", mk1.Params.EnergyConsume, mk2.Params.EnergyConsume, mk3.Params.EnergyConsume)
	}
	if mk2.Functions.Storage.Capacity <= mk1.Functions.Storage.Capacity || mk3.Functions.Storage.Capacity <= mk2.Functions.Storage.Capacity {
		t.Fatalf("expected tiered storage capacity")
	}
}

func TestResourceNodeStateSerializesZeroRemaining(t *testing.T) {
	payload, err := json.Marshal(ResourceNodeState{
		ID:           "r-1",
		PlanetID:     "planet-1",
		Kind:         "titanium_ore",
		Behavior:     "finite",
		Position:     Position{X: 1, Y: 2},
		MaxAmount:    10,
		Remaining:    0,
		BaseYield:    4,
		CurrentYield: 0,
	})
	if err != nil {
		t.Fatalf("marshal resource node: %v", err)
	}
	if !strings.Contains(string(payload), "\"remaining\":0") {
		t.Fatalf("expected remaining=0 in payload, got %s", string(payload))
	}
}
