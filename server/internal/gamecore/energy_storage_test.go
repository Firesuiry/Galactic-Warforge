package gamecore

import (
	"testing"

	"siliconworld/internal/model"
)

func TestEnergyStorageRestoresPower(t *testing.T) {
	ws := newPowerTestWorld()
	acc := addPowerTestBuilding(ws, "acc-1", model.BuildingTypeAccumulator, model.Position{X: 1, Y: 1})
	model.InitBuildingEnergyStorage(acc)
	if acc.EnergyStorage == nil {
		t.Fatalf("expected accumulator energy storage initialized")
	}
	acc.Runtime.Functions.EnergyStorage.ChargeEfficiency = 1
	acc.Runtime.Functions.EnergyStorage.DischargeEfficiency = 1
	acc.EnergyStorage.Energy = 10

	consumer := addPowerTestBuilding(ws, "c-1", model.BuildingTypeMiningMachine, model.Position{X: 2, Y: 1})
	addResourceNode(ws, "r-1", consumer.Position, 8)

	ws.PowerInputs = nil
	ws.PowerGrid = model.BuildPowerGridGraph(ws)

	finalizePowerSettlement(ws, nil)
	settleResources(ws)

	if consumer.Runtime.State != model.BuildingWorkRunning {
		t.Fatalf("expected consumer running with storage, got %s", consumer.Runtime.State)
	}
	if acc.EnergyStorage.Energy != 8 {
		t.Fatalf("expected accumulator energy 8 after discharge, got %d", acc.EnergyStorage.Energy)
	}
}
