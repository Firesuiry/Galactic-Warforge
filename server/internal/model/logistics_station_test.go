package model

import "testing"

func TestLogisticsStationSettings(t *testing.T) {
	station := NewLogisticsStationState()
	err := station.UpsertSetting(LogisticsStationItemSetting{
		ItemID:       ItemIronOre,
		Mode:         LogisticsStationModeSupply,
		LocalStorage: 120,
	})
	if err != nil {
		t.Fatalf("upsert setting error: %v", err)
	}
	setting, ok := station.SettingFor(ItemIronOre)
	if !ok {
		t.Fatalf("expected setting for %s", ItemIronOre)
	}
	if setting.Mode != LogisticsStationModeSupply {
		t.Fatalf("expected mode supply, got %s", setting.Mode)
	}
	if setting.LocalStorage != 120 {
		t.Fatalf("expected local storage 120, got %d", setting.LocalStorage)
	}

	err = station.UpsertSetting(LogisticsStationItemSetting{
		ItemID:       ItemIronOre,
		Mode:         LogisticsStationModeDemand,
		LocalStorage: 60,
	})
	if err != nil {
		t.Fatalf("upsert setting error: %v", err)
	}
	setting, ok = station.SettingFor(ItemIronOre)
	if !ok {
		t.Fatalf("expected updated setting for %s", ItemIronOre)
	}
	if setting.Mode != LogisticsStationModeDemand {
		t.Fatalf("expected mode demand, got %s", setting.Mode)
	}
	if setting.LocalStorage != 60 {
		t.Fatalf("expected local storage 60, got %d", setting.LocalStorage)
	}
}

func TestLogisticsStationCapacityCache(t *testing.T) {
	station := NewLogisticsStationState()
	err := station.UpsertSetting(LogisticsStationItemSetting{
		ItemID:       ItemIronOre,
		Mode:         LogisticsStationModeBoth,
		LocalStorage: 100,
	})
	if err != nil {
		t.Fatalf("upsert setting error: %v", err)
	}
	station.SetInventory(ItemInventory{ItemIronOre: 80})
	if station.DemandCapacity(ItemIronOre) != 20 {
		t.Fatalf("expected demand 20, got %d", station.DemandCapacity(ItemIronOre))
	}
	if station.SupplyCapacity(ItemIronOre) != 0 {
		t.Fatalf("expected supply 0, got %d", station.SupplyCapacity(ItemIronOre))
	}
	if station.LocalCapacity(ItemIronOre) != 100 {
		t.Fatalf("expected local capacity 100, got %d", station.LocalCapacity(ItemIronOre))
	}

	station.SetInventory(ItemInventory{ItemIronOre: 140})
	if station.DemandCapacity(ItemIronOre) != 0 {
		t.Fatalf("expected demand 0, got %d", station.DemandCapacity(ItemIronOre))
	}
	if station.SupplyCapacity(ItemIronOre) != 40 {
		t.Fatalf("expected supply 40, got %d", station.SupplyCapacity(ItemIronOre))
	}
}

func TestLogisticsStationPriority(t *testing.T) {
	station := &LogisticsStationState{}
	if station.InputPriorityValue() != 1 {
		t.Fatalf("expected default input priority 1, got %d", station.InputPriorityValue())
	}
	if station.OutputPriorityValue() != 1 {
		t.Fatalf("expected default output priority 1, got %d", station.OutputPriorityValue())
	}

	station.Priority = LogisticsStationPriority{Input: 2, Output: 5}
	if station.InputPriorityValue() != 2 {
		t.Fatalf("expected input priority 2, got %d", station.InputPriorityValue())
	}
	if station.OutputPriorityValue() != 5 {
		t.Fatalf("expected output priority 5, got %d", station.OutputPriorityValue())
	}
}
