package model

import "testing"

func TestBuildingCatalogValid(t *testing.T) {
	defs := AllBuildingDefinitions()
	if len(defs) == 0 {
		t.Fatal("building catalog should not be empty")
	}
	for _, def := range defs {
		if def.ID == "" {
			t.Fatal("building id should not be empty")
		}
		if def.Name == "" {
			t.Fatalf("building %s missing name", def.ID)
		}
		if _, ok := validBuildingCategories[def.Category]; !ok {
			t.Fatalf("building %s has invalid category %q", def.ID, def.Category)
		}
		if _, ok := validBuildingSubcategories[def.Subcategory]; !ok {
			t.Fatalf("building %s has invalid subcategory %q", def.ID, def.Subcategory)
		}
		if def.Footprint.Width <= 0 || def.Footprint.Height <= 0 {
			t.Fatalf("building %s has invalid footprint", def.ID)
		}
		if def.BuildCost.Minerals < 0 || def.BuildCost.Energy < 0 {
			t.Fatalf("building %s has negative build cost", def.ID)
		}
	}
}

func TestBuildableDefinitionsHaveCost(t *testing.T) {
	for _, def := range AllBuildingDefinitions() {
		if !def.Buildable {
			continue
		}
		if def.BuildCost.Minerals == 0 && def.BuildCost.Energy == 0 && len(def.BuildCost.Items) == 0 {
			t.Fatalf("buildable building %s should define a build cost", def.ID)
		}
	}
}
