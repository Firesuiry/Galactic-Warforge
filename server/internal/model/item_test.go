package model

import "testing"

func TestItemCatalogValid(t *testing.T) {
	for id, def := range itemCatalog {
		if def.ID != id {
			t.Fatalf("item id mismatch: key=%s def=%s", id, def.ID)
		}
		if def.Name == "" {
			t.Fatalf("item %s missing name", id)
		}
		if def.StackLimit <= 0 {
			t.Fatalf("item %s invalid stack limit %d", id, def.StackLimit)
		}
		if def.UnitVolume <= 0 {
			t.Fatalf("item %s invalid unit volume %d", id, def.UnitVolume)
		}
		switch def.Form {
		case ResourceSolid:
			if def.ContainerID != "" {
				t.Fatalf("solid item %s should not require container", id)
			}
		case ResourceLiquid, ResourceGas:
			if def.ContainerID == "" {
				t.Fatalf("fluid item %s missing container", id)
			}
			if expected, ok := ContainerForForm(def.Form); !ok || expected != def.ContainerID {
				t.Fatalf("item %s container mismatch: expected %s got %s", id, expected, def.ContainerID)
			}
		default:
			t.Fatalf("item %s has unknown form %s", id, def.Form)
		}
	}
}

func TestRareResourcesPresent(t *testing.T) {
	required := []string{ItemFireIce, ItemFractalSilicon, ItemGratingCrystal, ItemMonopoleMagnet}
	for _, id := range required {
		def, ok := Item(id)
		if !ok {
			t.Fatalf("missing rare resource %s", id)
		}
		if !def.IsRare {
			t.Fatalf("rare resource %s not marked rare", id)
		}
	}
}

func TestMidLateItemsPresent(t *testing.T) {
	cases := []struct {
		itemID     string
		category   ItemCategory
		stackLimit int
	}{
		{itemID: ItemTitaniumCrystal, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemTitaniumAlloy, category: ItemCategoryMaterial, stackLimit: 100},
		{itemID: ItemFrameMaterial, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemQuantumChip, category: ItemCategoryComponent, stackLimit: 50},
	}

	for _, tc := range cases {
		def, ok := Item(tc.itemID)
		if !ok {
			t.Fatalf("missing item %s", tc.itemID)
		}
		if def.Category != tc.category {
			t.Fatalf("item %s category mismatch: want %s got %s", tc.itemID, tc.category, def.Category)
		}
		if def.StackLimit != tc.stackLimit {
			t.Fatalf("item %s stack limit mismatch: want %d got %d", tc.itemID, tc.stackLimit, def.StackLimit)
		}
	}
}

func TestDSPAlignmentItemsPresent(t *testing.T) {
	cases := []struct {
		itemID     string
		category   ItemCategory
		stackLimit int
		rare       bool
	}{
		{itemID: ItemKimberliteOre, category: ItemCategoryOre, stackLimit: 50, rare: true},
		{itemID: ItemSpiniformStalagmiteCrystal, category: ItemCategoryOre, stackLimit: 50, rare: true},
		{itemID: ItemLog, category: ItemCategoryFuel, stackLimit: 100},
		{itemID: ItemPlantFuel, category: ItemCategoryFuel, stackLimit: 500},
		{itemID: ItemTitaniumGlass, category: ItemCategoryMaterial, stackLimit: 100},
		{itemID: ItemPlaneFilter, category: ItemCategoryComponent, stackLimit: 200},
		{itemID: ItemParticleBroadband, category: ItemCategoryComponent, stackLimit: 200},
		{itemID: ItemReinforcedThruster, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemGravitonLens, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemCasimirCrystal, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemDysonSphereComponent, category: ItemCategoryComponent, stackLimit: 100},
		{itemID: ItemFoundationSupply, category: ItemCategoryMaterial, stackLimit: 1000},
		{itemID: ItemSupersonicMissileSet, category: ItemCategoryAmmo, stackLimit: 100},
		{itemID: ItemAttackDrone, category: ItemCategoryComponent, stackLimit: 50},
		{itemID: ItemCrystalShellSet, category: ItemCategoryAmmo, stackLimit: 100},
		{itemID: ItemJammingCapsule, category: ItemCategoryAmmo, stackLimit: 100},
		{itemID: ItemSuppressingCapsule, category: ItemCategoryAmmo, stackLimit: 100},
	}

	for _, tc := range cases {
		def, ok := Item(tc.itemID)
		if !ok {
			t.Fatalf("missing item %s", tc.itemID)
		}
		if def.Category != tc.category {
			t.Fatalf("item %s category mismatch: want %s got %s", tc.itemID, tc.category, def.Category)
		}
		if def.StackLimit != tc.stackLimit {
			t.Fatalf("item %s stack limit mismatch: want %d got %d", tc.itemID, tc.stackLimit, def.StackLimit)
		}
		if def.IsRare != tc.rare {
			t.Fatalf("item %s rare flag mismatch: want %v got %v", tc.itemID, tc.rare, def.IsRare)
		}
		if err := ValidateStack(tc.itemID, def.StackLimit); err != nil {
			t.Fatalf("item %s full stack should validate: %v", tc.itemID, err)
		}
	}
}

func TestStackRules(t *testing.T) {
	if err := ValidateStack(ItemIronOre, 0); err == nil {
		t.Fatalf("expected error for zero quantity")
	}
	if err := ValidateStack(ItemIronOre, 101); err == nil {
		t.Fatalf("expected error for exceeding stack limit")
	}
	if vol, err := StackVolume(ItemIronOre, 2); err != nil || vol != 2 {
		t.Fatalf("unexpected volume result: %d err=%v", vol, err)
	}
}
