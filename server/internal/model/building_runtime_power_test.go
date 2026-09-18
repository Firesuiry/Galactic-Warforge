package model

import (
	"testing"

	modelpower "siliconworld/internal/model/power"
)

func TestLavaProximityHelpers(t *testing.T) {
	if !RequiresLavaProximity(BuildingTypeGeothermalPowerStation) {
		t.Fatalf("expected geothermal to require lava proximity")
	}
	if RequiresLavaProximity(BuildingTypeThermalPowerPlant) {
		t.Fatalf("expected thermal plant to not require lava proximity")
	}

	lava := map[[2]int]bool{{3, 3}: true}
	isLava := func(x, y int) bool { return lava[[2]int{x, y}] }

	if !LavaProximityOk(isLava, 2, 2, 1, 1) {
		t.Fatalf("expected adjacency to lava at (3,3) to qualify")
	}
	if !LavaProximityOk(isLava, 3, 3, 1, 1) {
		t.Fatalf("expected on-lava placement to qualify")
	}
	if LavaProximityOk(isLava, 0, 0, 1, 1) {
		t.Fatalf("expected distant placement to fail")
	}
	if LavaProximityOk(nil, 2, 2, 1, 1) {
		t.Fatalf("expected nil lookup to fail")
	}
}

func TestGeothermalRuntimeDefinition(t *testing.T) {
	def, ok := BuildingRuntimeDefinitionByID(BuildingTypeGeothermalPowerStation)
	if !ok {
		t.Fatalf("missing geothermal runtime definition")
	}
	module := def.Functions.Energy
	if module == nil || module.SourceKind != modelpower.PowerSourceGeothermal {
		t.Fatalf("expected geothermal energy module, got %+v", module)
	}
	if module.OutputPerTick != 30 || def.Params.EnergyGenerate != 30 {
		t.Fatalf("expected 30/tick generation, got module=%+v params=%+v", module, def.Params)
	}
	if !modelpower.IsPowerSourceKind(modelpower.PowerSourceGeothermal) {
		t.Fatalf("expected geothermal to be a registered power source")
	}
	if modelpower.IsFuelBasedPowerSource(modelpower.PowerSourceGeothermal) {
		t.Fatalf("geothermal must not be fuel based")
	}
}

func TestEnergyExchangerDefinitionItemCycleParams(t *testing.T) {
	def, ok := BuildingRuntimeDefinitionByID(BuildingTypeEnergyExchanger)
	if !ok {
		t.Fatalf("missing energy exchanger runtime definition")
	}
	module := def.Functions.EnergyExchanger
	if module == nil || !module.Hub {
		t.Fatalf("expected exchanger hub module, got %+v", module)
	}
	if module.Mode != EnergyExchangerModeStandby {
		t.Fatalf("expected standby default mode, got %s", module.Mode)
	}
	if module.EnergyPerItem != AccumulatorItemEnergy || module.ItemsPerTick <= 0 {
		t.Fatalf("unexpected item cycle params: %+v", module)
	}
	if module.EmptyItemID != ItemAccumulator || module.FullItemID != ItemAccumulatorFull {
		t.Fatalf("unexpected item ids: %+v", module)
	}
	if def.Functions.Storage == nil {
		t.Fatalf("expected exchanger storage module for accumulator items")
	}
	if def.Functions.EnergyStorage == nil {
		t.Fatalf("expected exchanger energy storage module preserved")
	}
}

func TestEnergyExchangerModeValidation(t *testing.T) {
	for _, mode := range []EnergyExchangerMode{EnergyExchangerModeStandby, EnergyExchangerModeCharge, EnergyExchangerModeDischarge} {
		if !IsEnergyExchangerMode(mode) {
			t.Fatalf("expected mode %s to be valid", mode)
		}
	}
	if IsEnergyExchangerMode("bogus") {
		t.Fatalf("expected bogus mode to be invalid")
	}
}

func TestEnergyExchangerModuleClonedPerBuilding(t *testing.T) {
	first := BuildingProfileFor(BuildingTypeEnergyExchanger, 1)
	second := BuildingProfileFor(BuildingTypeEnergyExchanger, 1)
	if first.Runtime.Functions.EnergyExchanger == second.Runtime.Functions.EnergyExchanger {
		t.Fatalf("expected exchanger module to be cloned per building instance")
	}
	first.Runtime.Functions.EnergyExchanger.Mode = EnergyExchangerModeCharge
	if second.Runtime.Functions.EnergyExchanger.Mode != EnergyExchangerModeStandby {
		t.Fatalf("mode change leaked across building instances")
	}
}
