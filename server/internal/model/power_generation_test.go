package model

import "testing"

func TestResolvePowerGenerationWind(t *testing.T) {
	module := &EnergyModule{
		OutputPerTick: 10,
		SourceKind:    PowerSourceWind,
	}
	result, err := ResolvePowerGeneration(PowerGenerationRequest{
		Module:    module,
		EnvFactor: 1.2,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Output != 12 {
		t.Fatalf("expected output 12, got %d", result.Output)
	}
	if len(result.FuelUsed) != 0 {
		t.Fatalf("expected no fuel usage, got %v", result.FuelUsed)
	}
}

func TestResolvePowerGenerationThermalFuel(t *testing.T) {
	storage := NewStorageState(StorageModule{Capacity: 10, Slots: 1, Buffer: 0})
	storage.EnsureInventory()[ItemCoal] = 1
	module := &EnergyModule{
		OutputPerTick: 20,
		SourceKind:    PowerSourceThermal,
		FuelRules: []FuelRule{
			{ItemID: ItemCoal, ConsumePerTick: 2, OutputMultiplier: 1},
		},
	}
	result, err := ResolvePowerGeneration(PowerGenerationRequest{
		Module:    module,
		EnvFactor: 1,
		Storage:   storage,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Output != 10 {
		t.Fatalf("expected output 10, got %d", result.Output)
	}
	if len(result.FuelUsed) != 1 || result.FuelUsed[0].ItemID != ItemCoal || result.FuelUsed[0].Quantity != 1 {
		t.Fatalf("unexpected fuel usage: %+v", result.FuelUsed)
	}
	if qty := storage.Inventory[ItemCoal]; qty != 0 {
		t.Fatalf("expected remaining fuel 0, got %d", qty)
	}
}

func TestResolvePowerGenerationDoesNotConsumeFuelFromOutputBuffer(t *testing.T) {
	storage := NewStorageState(StorageModule{Capacity: 10, Slots: 1, Buffer: 4})
	storage.EnsureOutputBuffer()[ItemCoal] = 1
	module := &EnergyModule{
		OutputPerTick: 20,
		SourceKind:    PowerSourceThermal,
		FuelRules: []FuelRule{
			{ItemID: ItemCoal, ConsumePerTick: 1, OutputMultiplier: 1},
		},
	}

	result, err := ResolvePowerGeneration(PowerGenerationRequest{
		Module:    module,
		EnvFactor: 1,
		Storage:   storage,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Output != 0 {
		t.Fatalf("expected output 0 without reachable fuel, got %d", result.Output)
	}
	if len(result.FuelUsed) != 0 {
		t.Fatalf("expected no fuel usage from output buffer, got %+v", result.FuelUsed)
	}
	if qty := storage.OutputBuffer[ItemCoal]; qty != 1 {
		t.Fatalf("expected output buffer fuel untouched, got %d", qty)
	}
}
