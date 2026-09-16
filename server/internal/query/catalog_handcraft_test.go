package query

import (
	"encoding/json"
	"testing"
)

func TestCatalogExposesExplicitHandcraftPolicy(t *testing.T) {
	catalog := (&Layer{}).Catalog()
	policies := map[string]bool{}
	for _, recipe := range catalog.Recipes {
		policies[recipe.ID] = recipe.HandcraftAllowed
	}
	for _, id := range []string{"smelt_iron", "smelt_copper", "smelt_magnet", "smelt_stone", "gear", "circuit_board", "magnetic_coil", "coal_to_graphite"} {
		if !policies[id] {
			t.Fatalf("basic recipe %s must advertise handcrafting", id)
		}
	}
	for _, id := range []string{"oil_fractionation", "electromagnetic_matrix", "quantum_chip", "plasma_capsule", "precision_drone"} {
		if allowed, ok := policies[id]; !ok || allowed {
			t.Fatalf("factory-only recipe %s missing or handcraftable", id)
		}
	}
	data, err := json.Marshal(catalog)
	if err != nil {
		t.Fatal(err)
	}
	var exposed struct {
		Recipes []map[string]any `json:"recipes"`
	}
	if err := json.Unmarshal(data, &exposed); err != nil {
		t.Fatal(err)
	}
	for _, recipe := range exposed.Recipes {
		if _, ok := recipe["handcraft_allowed"].(bool); !ok {
			t.Fatalf("catalog omitted boolean handcraft policy: %v", recipe["id"])
		}
	}
}
