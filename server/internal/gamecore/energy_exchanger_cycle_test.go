package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

// newExchangerTestWorld builds a p1 world with a wind generator, an energy
// exchanger and a mining machine consumer wired into one line network.
func newExchangerTestWorld() (*model.WorldState, *model.Building) {
	ws := newPowerTestWorld()
	addPowerTestBuilding(ws, "gen-1", model.BuildingTypeWindTurbine, model.Position{X: 1, Y: 1})
	exchanger := addPowerTestBuilding(ws, "ex-1", model.BuildingTypeEnergyExchanger, model.Position{X: 2, Y: 1})
	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 3, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)
	model.InitBuildingEnergyStorage(exchanger)
	return ws, exchanger
}

func settleExchangerWorld(ws *model.WorldState, supply int) map[string]int {
	if supply > 0 {
		ws.PowerInputs = []model.PowerInput{{BuildingID: "gen-1", OwnerID: "p1", Output: supply}}
	} else {
		ws.PowerInputs = nil
	}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	return settleEnergyStorage(ws)
}

func TestEnergyExchangerChargeModeConvertsItemsWithSurplus(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	exchanger.Runtime.Functions.EnergyExchanger.Mode = model.EnergyExchangerModeCharge
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulator, 3); err != nil {
		t.Fatalf("load empties: %v", err)
	}

	// Supply 200, demand 2 (mining machine). The exchanger's own storage module
	// absorbs 80, leaving 118 surplus: enough to charge exactly one item (100).
	charged := settleExchangerWorld(ws, 200)

	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulator); got != 2 {
		t.Fatalf("expected 2 empty accumulators left, got %d", got)
	}
	if got := exchanger.Storage.OutputQuantity(model.ItemAccumulatorFull); got != 1 {
		t.Fatalf("expected 1 full accumulator produced, got %d", got)
	}
	if charged[exchanger.ID] != 180 {
		t.Fatalf("expected charged energy 180 (80 storage + 100 item), got %d", charged[exchanger.ID])
	}
}

func TestEnergyExchangerChargeModeStallsWhenOutputFull(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	exchanger.Runtime.Functions.EnergyExchanger.Mode = model.EnergyExchangerModeCharge
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulator, 3); err != nil {
		t.Fatalf("load empties: %v", err)
	}
	// Fill the output buffer completely with full accumulators.
	for {
		accepted, _, err := exchanger.Storage.ReceiveOutput(model.ItemAccumulatorFull, 1)
		if err != nil || accepted != 1 {
			break
		}
	}
	fullBefore := exchanger.Storage.ItemQuantity(model.ItemAccumulatorFull)
	if fullBefore == 0 {
		t.Fatalf("expected output buffer prefilled")
	}

	charged := settleExchangerWorld(ws, 200)

	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulator); got != 3 {
		t.Fatalf("expected empties untouched when output full, got %d", got)
	}
	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulatorFull); got != fullBefore {
		t.Fatalf("expected full count unchanged, got %d", got)
	}
	if charged[exchanger.ID] != 80 {
		t.Fatalf("expected only storage charge 80, got %d", charged[exchanger.ID])
	}
}

func TestEnergyExchangerChargeModeStallsOnGridDeficit(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	exchanger.Runtime.Functions.EnergyExchanger.Mode = model.EnergyExchangerModeCharge
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulator, 3); err != nil {
		t.Fatalf("load empties: %v", err)
	}

	// No generation: the network runs a deficit, so charging must not happen.
	settleExchangerWorld(ws, 0)

	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulator); got != 3 {
		t.Fatalf("expected empties untouched on deficit, got %d", got)
	}
	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulatorFull); got != 0 {
		t.Fatalf("expected no full accumulators on deficit, got %d", got)
	}
}

func TestEnergyExchangerDischargeModeReleasesEnergy(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	exchanger.Runtime.Functions.EnergyExchanger.Mode = model.EnergyExchangerModeDischarge
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulatorFull, 2); err != nil {
		t.Fatalf("load fulls: %v", err)
	}

	// No generation, demand 2: deficit draws from storage (empty), then one
	// full accumulator is converted to cover the rest.
	settleExchangerWorld(ws, 0)

	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulatorFull); got != 1 {
		t.Fatalf("expected 1 full accumulator left, got %d", got)
	}
	if got := exchanger.Storage.OutputQuantity(model.ItemAccumulator); got != 1 {
		t.Fatalf("expected 1 empty accumulator produced, got %d", got)
	}
	input := powerInputFor(ws, exchanger.ID)
	if input == nil || input.Output != model.AccumulatorItemEnergy {
		t.Fatalf("expected storage power input %d from exchanger, got %+v", model.AccumulatorItemEnergy, ws.PowerInputs)
	}
}

func TestEnergyExchangerStandbyModeLeavesItemsUntouched(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	// Default mode is standby.
	if exchanger.Runtime.Functions.EnergyExchanger.Mode != model.EnergyExchangerModeStandby {
		t.Fatalf("expected standby default, got %s", exchanger.Runtime.Functions.EnergyExchanger.Mode)
	}
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulator, 3); err != nil {
		t.Fatalf("load empties: %v", err)
	}

	settleExchangerWorld(ws, 200)

	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulator); got != 3 {
		t.Fatalf("expected empties untouched in standby, got %d", got)
	}
	if got := exchanger.Storage.ItemQuantity(model.ItemAccumulatorFull); got != 0 {
		t.Fatalf("expected no full accumulators in standby, got %d", got)
	}
}

func TestEnergyExchangerItemCycleAlignsWithPowerSnapshot(t *testing.T) {
	ws, exchanger := newExchangerTestWorld()
	exchanger.Runtime.Functions.EnergyExchanger.Mode = model.EnergyExchangerModeCharge
	if _, _, err := exchanger.Storage.Load(model.ItemAccumulator, 3); err != nil {
		t.Fatalf("load empties: %v", err)
	}

	ws.PowerInputs = []model.PowerInput{{BuildingID: "gen-1", OwnerID: "p1", Output: 200}}
	ws.PowerGrid = model.BuildPowerGridGraph(ws)
	finalizePowerSettlement(ws, nil)

	if ws.PowerSnapshot == nil {
		t.Fatalf("expected power snapshot")
	}
	networkID := ws.PowerSnapshot.Networks.BuildingNetwork[exchanger.ID]
	network := ws.PowerSnapshot.Networks.Networks[networkID]
	if network == nil {
		t.Fatalf("expected exchanger network")
	}
	// Demand includes the mining machine (2), the exchanger's own storage
	// charge (80) and the item-cycle charge (100).
	if network.Demand != 182 {
		t.Fatalf("expected network demand 182, got %d", network.Demand)
	}
	if got := exchanger.Storage.OutputQuantity(model.ItemAccumulatorFull); got != 1 {
		t.Fatalf("expected 1 full accumulator after settlement, got %d", got)
	}
}
