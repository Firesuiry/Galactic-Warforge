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
