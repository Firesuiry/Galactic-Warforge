package model

import "testing"

func TestT111WorldUnitsAndWarBlueprintsUseSeparatedCatalogs(t *testing.T) {
	if _, ok := PublicUnitCatalogEntryByID(ItemPrototype); ok {
		t.Fatalf("expected %s to leave /catalog.units after T111", ItemPrototype)
	}
	if _, ok := PublicUnitCatalogEntryByID(ItemCorvette); ok {
		t.Fatalf("expected %s to leave /catalog.units after T111", ItemCorvette)
	}

	prototype, ok := PublicWarBlueprintByID(ItemPrototype)
	if !ok {
		t.Fatalf("expected %s to exist as preset public blueprint", ItemPrototype)
	}
	if prototype.Source != WarBlueprintSourcePreset {
		t.Fatalf("expected preset blueprint source, got %+v", prototype)
	}
	if prototype.BaseFrameID == "" || prototype.BaseHullID != "" {
		t.Fatalf("expected ground prototype to use a base frame, got %+v", prototype)
	}
	if prototype.RuntimeClass != UnitRuntimeClassCombatSquad {
		t.Fatalf("expected combat squad runtime, got %+v", prototype)
	}

	corvette, ok := PublicWarBlueprintByID(ItemCorvette)
	if !ok {
		t.Fatalf("expected %s to exist as preset public blueprint", ItemCorvette)
	}
	if corvette.BaseHullID == "" || corvette.BaseFrameID != "" {
		t.Fatalf("expected corvette to use a base hull, got %+v", corvette)
	}
	if corvette.RuntimeClass != UnitRuntimeClassFleet {
		t.Fatalf("expected fleet runtime, got %+v", corvette)
	}
	if len(corvette.ComponentIDs) == 0 {
		t.Fatalf("expected corvette to list blueprint components, got %+v", corvette)
	}
}

func TestT111WarComponentCatalogCoversAllCoreCategories(t *testing.T) {
	components := PublicWarComponentCatalogEntries()
	if len(components) == 0 {
		t.Fatal("expected non-empty war component catalog")
	}

	categories := map[WarComponentCategory]bool{}
	for _, component := range components {
		categories[component.Category] = true
	}

	for _, category := range []WarComponentCategory{
		WarComponentCategoryPower,
		WarComponentCategoryPropulsion,
		WarComponentCategoryDefense,
		WarComponentCategorySensor,
		WarComponentCategoryWeapon,
		WarComponentCategoryUtility,
	} {
		if !categories[category] {
			t.Fatalf("expected category %s in %+v", category, components)
		}
	}
}
