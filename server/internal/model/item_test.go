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
