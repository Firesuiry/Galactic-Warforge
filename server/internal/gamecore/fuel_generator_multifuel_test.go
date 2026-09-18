package gamecore

import (
	"testing"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

func fuelTestEnv() mapmodel.PlanetEnvironment {
	return mapmodel.PlanetEnvironment{WindFactor: 1, LightFactor: 1}
}

func addFuelPlant(ws *model.WorldState, id string, btype model.BuildingType, fuel string, qty int) *model.Building {
	plant := addPowerTestBuilding(ws, id, btype, model.Position{X: 1, Y: 1})
	if fuel != "" && qty > 0 {
		if _, _, err := plant.Storage.Load(fuel, qty); err != nil {
			panic(err)
		}
	}
	return plant
}

func TestFusionPlantBurnsDeuteriumRodWithHeatValueOutput(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "fus-1", model.BuildingTypeMiniFusionPowerPlant, model.ItemDeuteriumFuelRod, 2)

	// 氘棒热值为氢棒 2.5 倍：40 * 2.5 = 100 每 tick。
	settlePowerGeneration(ws, fuelTestEnv())
	input := powerInputFor(ws, plant.ID)
	if input == nil || input.Output != 100 {
		t.Fatalf("expected deuterium output 100, got %+v", ws.PowerInputs)
	}
	if len(input.FuelUsed) != 1 || input.FuelUsed[0].ItemID != model.ItemDeuteriumFuelRod || input.FuelUsed[0].Quantity != 1 {
		t.Fatalf("unexpected fuel usage: %+v", input.FuelUsed)
	}

	// Tick conservation: the second rod yields exactly one more 100-output tick.
	ws.PowerInputs = nil
	settlePowerGeneration(ws, fuelTestEnv())
	if input := powerInputFor(ws, plant.ID); input == nil || input.Output != 100 {
		t.Fatalf("expected second deuterium tick output 100, got %+v", ws.PowerInputs)
	}
	if got := plant.Storage.ItemQuantity(model.ItemDeuteriumFuelRod); got != 0 {
		t.Fatalf("expected deuterium rods exhausted, got %d", got)
	}

	// Fuel exhausted: generation stops with a no-fuel state.
	ws.PowerInputs = nil
	settlePowerGeneration(ws, fuelTestEnv())
	if input := powerInputFor(ws, plant.ID); input != nil {
		t.Fatalf("expected no output without fuel, got %+v", input)
	}
	if plant.Runtime.State != model.BuildingWorkNoPower || plant.Runtime.StateReason != stateReasonNoFuel {
		t.Fatalf("expected no_power/no_fuel, got %s/%s", plant.Runtime.State, plant.Runtime.StateReason)
	}
}

func TestFusionPlantPrefersHydrogenRodWhenBothAvailable(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "fus-1", model.BuildingTypeMiniFusionPowerPlant, model.ItemHydrogenFuelRod, 1)
	if _, _, err := plant.Storage.Load(model.ItemDeuteriumFuelRod, 1); err != nil {
		t.Fatalf("load deuterium: %v", err)
	}

	settlePowerGeneration(ws, fuelTestEnv())
	input := powerInputFor(ws, plant.ID)
	if input == nil || input.Output != 40 {
		t.Fatalf("expected hydrogen rod output 40, got %+v", ws.PowerInputs)
	}
	if got := plant.Storage.ItemQuantity(model.ItemHydrogenFuelRod); got != 0 {
		t.Fatalf("expected hydrogen rod consumed first, got %d", got)
	}
	if got := plant.Storage.ItemQuantity(model.ItemDeuteriumFuelRod); got != 1 {
		t.Fatalf("expected deuterium rod untouched, got %d", got)
	}
}

func TestThermalPlantBurnsGraphiteWithHigherHeatValue(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "th-1", model.BuildingTypeThermalPowerPlant, model.ItemEnergeticGraphite, 1)

	settlePowerGeneration(ws, fuelTestEnv())
	input := powerInputFor(ws, plant.ID)
	if input == nil || input.Output != 40 {
		t.Fatalf("expected graphite output 40 (20*2), got %+v", ws.PowerInputs)
	}
	if got := plant.Storage.ItemQuantity(model.ItemEnergeticGraphite); got != 0 {
		t.Fatalf("expected graphite consumed, got %d", got)
	}
}

func TestThermalPlantBurnsLogWithLowerHeatValue(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "th-1", model.BuildingTypeThermalPowerPlant, model.ItemLog, 2)

	settlePowerGeneration(ws, fuelTestEnv())
	input := powerInputFor(ws, plant.ID)
	if input == nil || input.Output != 12 {
		t.Fatalf("expected log output 12 (20*0.6), got %+v", ws.PowerInputs)
	}
}

func TestThermalPlantBurnsPlantFuelWithLowestHeatValue(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "th-1", model.BuildingTypeThermalPowerPlant, model.ItemPlantFuel, 2)

	settlePowerGeneration(ws, fuelTestEnv())
	input := powerInputFor(ws, plant.ID)
	if input == nil || input.Output != 4 {
		t.Fatalf("expected plant fuel output 4 (20*0.2), got %+v", ws.PowerInputs)
	}
}

func TestThermalPlantFuelPreferenceOrderAndConservation(t *testing.T) {
	ws := newPowerTestWorld()
	plant := addFuelPlant(ws, "th-1", model.BuildingTypeThermalPowerPlant, model.ItemCoal, 1)
	if _, _, err := plant.Storage.Load(model.ItemEnergeticGraphite, 1); err != nil {
		t.Fatalf("load graphite: %v", err)
	}
	if _, _, err := plant.Storage.Load(model.ItemHydrogen, 1); err != nil {
		t.Fatalf("load hydrogen: %v", err)
	}

	// Tick 1: coal first (20*1). Tick 2: graphite (20*2). Tick 3: hydrogen (20*1.2).
	expected := []struct {
		item   string
		output int
	}{
		{model.ItemCoal, 20},
		{model.ItemEnergeticGraphite, 40},
		{model.ItemHydrogen, 24},
	}
	total := 0
	for i, want := range expected {
		ws.PowerInputs = nil
		settlePowerGeneration(ws, fuelTestEnv())
		input := powerInputFor(ws, plant.ID)
		if input == nil || input.Output != want.output {
			t.Fatalf("tick %d: expected output %d from %s, got %+v", i, want.output, want.item, ws.PowerInputs)
		}
		if len(input.FuelUsed) != 1 || input.FuelUsed[0].ItemID != want.item || input.FuelUsed[0].Quantity != 1 {
			t.Fatalf("tick %d: expected 1 %s consumed, got %+v", i, want.item, input.FuelUsed)
		}
		total += input.Output
	}
	if total != 84 {
		t.Fatalf("expected conserved total output 84, got %d", total)
	}
	for _, item := range []string{model.ItemCoal, model.ItemEnergeticGraphite, model.ItemHydrogen} {
		if got := plant.Storage.ItemQuantity(item); got != 0 {
			t.Fatalf("expected %s exhausted, got %d", item, got)
		}
	}
}
