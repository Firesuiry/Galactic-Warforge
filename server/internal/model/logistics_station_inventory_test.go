package model

import "testing"

func TestLogisticsStationFiniteSharedItemSlotsAndAtomicReceive(t *testing.T) {
	b := &Building{Type: BuildingTypePlanetaryLogisticsStation}
	InitBuildingLogisticsStation(b)
	s := b.LogisticsStation
	for _, id := range []string{ItemIronOre, ItemCopperOre, ItemStoneOre} {
		if err := s.UpsertSetting(LogisticsStationItemSetting{ItemID: id, Mode: LogisticsStationModeNone}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.UpsertSetting(LogisticsStationItemSetting{ItemID: ItemCoal, Mode: LogisticsStationModeSupply}); err == nil {
		t.Fatal("exceeded three item slots")
	}
	if err := s.UpsertInterstellarSetting(LogisticsStationItemSetting{ItemID: ItemIronOre, Mode: LogisticsStationModeDemand, LocalStorage: 200}); err != nil {
		t.Fatal("same item consumed another slot")
	}
	if err := s.UpsertSetting(LogisticsStationItemSetting{ItemID: ItemIronOre, Mode: LogisticsStationModeDemand, LocalStorage: 201}); err == nil {
		t.Fatal("local storage exceeded physical item cap")
	}
	accepted, remaining, err := s.ReceiveItem(ItemIronOre, 250)
	if err != nil || accepted != 200 || remaining != 50 || s.Inventory[ItemIronOre] != 200 {
		t.Fatalf("unbounded or lost receive: %d %d %v", accepted, remaining, err)
	}
	if got, rest, err := s.ReceiveItem(ItemIronOre, 1); err != nil || got != 0 || rest != 1 {
		t.Fatal("full inventory consumed cargo")
	}
	if got, rest, err := s.ReceiveItem(ItemCoal, 1); err == nil || got != 0 || rest != 1 {
		t.Fatal("received unconfigured cargo")
	}
	if s.ConfiguredSlotCount() != 3 || s.AvailableItemCapacity(ItemCopperOre) != 200 || s.AvailableItemCapacity(ItemIronOre) != 0 {
		t.Fatal("item capacities were mixed")
	}
	s.BeltPorts = map[ConveyorDirection]LogisticsBeltPort{ConveyorWest: {Mode: "input", ItemID: ItemIronOre}}
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	clone := s.Clone()
	clone.BeltPorts[ConveyorWest] = LogisticsBeltPort{Mode: "output", ItemID: ItemIronOre}
	clone.Inventory[ItemIronOre] = 1
	if s.BeltPorts[ConveyorWest].Mode != "input" || s.Inventory[ItemIronOre] != 200 {
		t.Fatal("station clone aliases ports or inventory")
	}
}

func TestStationTypeProfilesAndEnergyAreFinite(t *testing.T) {
	for _, tc := range []struct {
		kind                         BuildingType
		slots, items, energy, charge int
	}{{BuildingTypePlanetaryLogisticsStation, 3, 200, 1000, 10}, {BuildingTypeInterstellarLogisticsStation, 5, 500, 10000, 30}, {BuildingTypeOrbitalCollector, 0, 0, 0, 0}} {
		b := &Building{Type: tc.kind}
		InitBuildingLogisticsStation(b)
		s := b.LogisticsStation
		if s.SlotCapacity != tc.slots || s.ItemCapacity != tc.items || s.EnergyCapacity != tc.energy || s.ChargePerTick != tc.charge || s.Energy != 0 {
			t.Fatalf("incorrect %s profile %+v", tc.kind, s)
		}
		if s.SpendEnergy(1) || s.SpendEnergy(-1) {
			t.Fatal("spent absent or negative energy")
		}
		s.Energy = tc.energy
		if !s.SpendEnergy(tc.energy) || s.Energy != 0 {
			t.Fatal("energy debit was not exact")
		}
	}
}
