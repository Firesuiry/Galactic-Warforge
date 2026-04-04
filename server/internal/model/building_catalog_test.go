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

func TestVerticalLaunchingSiloDefaultRecipeAndIO(t *testing.T) {
	def, ok := BuildingDefinitionByID(BuildingTypeVerticalLaunchingSilo)
	if !ok {
		t.Fatal("vertical_launching_silo missing from building catalog")
	}
	if def.DefaultRecipeID != "small_carrier_rocket" {
		t.Fatalf("expected silo default recipe small_carrier_rocket, got %q", def.DefaultRecipeID)
	}

	runtimeDef, ok := BuildingRuntimeDefinitionByID(BuildingTypeVerticalLaunchingSilo)
	if !ok {
		t.Fatal("vertical_launching_silo missing runtime definition")
	}

	var inputPort *IOPort
	var outputPort *IOPort
	for i := range runtimeDef.Params.IOPorts {
		port := &runtimeDef.Params.IOPorts[i]
		switch port.ID {
		case "in-0":
			inputPort = port
		case "out-0":
			outputPort = port
		}
	}

	if inputPort == nil {
		t.Fatal("silo input port in-0 missing")
	}
	if inputPort.Direction != PortInput {
		t.Fatalf("silo input port direction mismatch: got %s", inputPort.Direction)
	}
	if len(inputPort.AllowedItems) != 0 {
		t.Fatalf("silo input port should accept recipe inputs generically, got %+v", inputPort.AllowedItems)
	}

	if outputPort == nil {
		t.Fatal("silo output port out-0 missing")
	}
	if outputPort.Direction != PortOutput {
		t.Fatalf("silo output port direction mismatch: got %s", outputPort.Direction)
	}
	if len(outputPort.AllowedItems) != 1 || outputPort.AllowedItems[0] != ItemSmallCarrierRocket {
		t.Fatalf("silo output port should export only small_carrier_rocket, got %+v", outputPort.AllowedItems)
	}
}
