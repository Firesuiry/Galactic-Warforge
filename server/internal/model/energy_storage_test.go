package model

import "testing"

func TestEnergyStorageChargeAndDischarge(t *testing.T) {
	module := &EnergyStorageModule{
		Capacity:            100,
		ChargePerTick:       10,
		DischargePerTick:    10,
		ChargeEfficiency:    0.5,
		DischargeEfficiency: 0.5,
		Priority:            1,
	}
	state := &EnergyStorageState{Energy: 0}
	nodes := []EnergyStorageNode{{ID: "s1", Module: module, State: state}}

	_, charged := ApplyEnergyStorageCharge(nodes, 10, false)
	if charged != 10 {
		t.Fatalf("expected charge input 10, got %d", charged)
	}
	if state.Energy != 5 {
		t.Fatalf("expected stored energy 5, got %d", state.Energy)
	}

	_, discharged := ApplyEnergyStorageDischarge(nodes, 10, false)
	if discharged != 2 {
		t.Fatalf("expected discharge output 2, got %d", discharged)
	}
	if state.Energy != 1 {
		t.Fatalf("expected energy remaining 1, got %d", state.Energy)
	}
}

func TestEnergyStorageBalanceWithHub(t *testing.T) {
	module := &EnergyStorageModule{
		Capacity:            100,
		ChargePerTick:       10,
		DischargePerTick:    10,
		ChargeEfficiency:    1,
		DischargeEfficiency: 1,
		Priority:            1,
	}
	stateA := &EnergyStorageState{Energy: 0}
	stateB := &EnergyStorageState{Energy: 0}
	nodes := []EnergyStorageNode{
		{ID: "a", Module: module, State: stateA},
		{ID: "b", Module: module, State: stateB},
	}

	ApplyEnergyStorageCharge(nodes, 10, false)
	if stateA.Energy != 10 || stateB.Energy != 0 {
		t.Fatalf("expected greedy charge 10/0, got %d/%d", stateA.Energy, stateB.Energy)
	}

	stateA.Energy = 0
	stateB.Energy = 0

	ApplyEnergyStorageCharge(nodes, 10, true)
	if stateA.Energy != 5 || stateB.Energy != 5 {
		t.Fatalf("expected balanced charge 5/5, got %d/%d", stateA.Energy, stateB.Energy)
	}
}
