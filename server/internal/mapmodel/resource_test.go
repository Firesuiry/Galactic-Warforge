package mapmodel

import "testing"

func TestAllResourceKindsComplete(t *testing.T) {
	kinds := AllResourceKinds()
	if len(kinds) != 18 {
		t.Fatalf("expected 18 resource kinds, got %d", len(kinds))
	}
	seen := make(map[ResourceKind]bool, len(kinds))
	for _, k := range kinds {
		if seen[k] {
			t.Fatalf("duplicate resource kind %s", k)
		}
		seen[k] = true
	}
	required := []ResourceKind{
		ResourceKimberliteOre,
		ResourceSpiniformStalagmiteCrystal,
		ResourceOrganicCrystal,
		ResourceSulfuricAcid,
		ResourceLog,
		ResourcePlantFuel,
	}
	for _, k := range required {
		if !seen[k] {
			t.Fatalf("missing new resource kind %s", k)
		}
	}
}
