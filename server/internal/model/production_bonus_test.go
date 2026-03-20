package model

import "testing"

func TestProductionBonusCatalogDefault(t *testing.T) {
	if _, err := buildProductionBonusCatalog(DefaultProductionBonusConfig()); err != nil {
		t.Fatalf("default bonus config invalid: %v", err)
	}
}

func TestApplySprayToStack(t *testing.T) {
	catalog, err := buildProductionBonusCatalog(DefaultProductionBonusConfig())
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	target := ItemStack{ItemID: ItemIronOre, Quantity: 10}
	spray := ItemStack{ItemID: ItemProliferatorMk1, Quantity: 1}
	result, err := catalog.applySprayToStack(target, spray)
	if err != nil {
		t.Fatalf("apply spray: %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected spray applied, got reason=%s", result.Reason)
	}
	if result.Sprayed.Spray == nil || result.Sprayed.Spray.Level != 1 {
		t.Fatalf("expected spray level 1 on sprayed stack")
	}
	if result.SprayConsumed.Quantity != 1 {
		t.Fatalf("expected to consume 1 spray item, got %d", result.SprayConsumed.Quantity)
	}
	if result.Remainder.Quantity != 0 {
		t.Fatalf("expected no remainder, got %d", result.Remainder.Quantity)
	}
}

func TestApplySprayToStackInsufficient(t *testing.T) {
	catalog, err := buildProductionBonusCatalog(DefaultProductionBonusConfig())
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	target := ItemStack{ItemID: ItemIronOre, Quantity: 20}
	spray := ItemStack{ItemID: ItemProliferatorMk1, Quantity: 1}
	result, err := catalog.applySprayToStack(target, spray)
	if err != nil {
		t.Fatalf("apply spray: %v", err)
	}
	if result.Applied {
		t.Fatalf("expected spray to fail on insufficient units")
	}
	if result.Reason != BonusFailureInsufficientSpray {
		t.Fatalf("expected insufficient spray reason, got %s", result.Reason)
	}
}

func TestEvaluateProductionBonusSpeed(t *testing.T) {
	catalog, err := buildProductionBonusCatalog(DefaultProductionBonusConfig())
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	recipe, ok := Recipe("smelt_iron")
	if !ok {
		t.Fatalf("missing recipe smelt_iron")
	}
	req := ProductionBonusRequest{
		Recipe:  recipe,
		Mode:    BonusModeSpeed,
		Sources: []BonusSource{{Level: 1, AvailableUses: 1}},
	}
	result := catalog.evaluateProductionBonus(req)
	if !result.Applied {
		t.Fatalf("expected bonus applied, got reason=%s", result.Reason)
	}
	if result.Duration != 48 {
		t.Fatalf("expected duration 48, got %d", result.Duration)
	}
}

func TestEvaluateProductionBonusExtra(t *testing.T) {
	catalog, err := buildProductionBonusCatalog(DefaultProductionBonusConfig())
	if err != nil {
		t.Fatalf("build catalog: %v", err)
	}
	recipe, ok := Recipe("plastic")
	if !ok {
		t.Fatalf("missing recipe plastic")
	}
	req := ProductionBonusRequest{
		Recipe:  recipe,
		Mode:    BonusModeExtra,
		Sources: []BonusSource{{Level: 1, AvailableUses: 1}},
	}
	result := catalog.evaluateProductionBonus(req)
	if !result.Applied {
		t.Fatalf("expected bonus applied, got reason=%s", result.Reason)
	}
	if len(result.Outputs) == 0 || result.Outputs[0].Quantity != 3 {
		t.Fatalf("expected output quantity 3, got %+v", result.Outputs)
	}
}
