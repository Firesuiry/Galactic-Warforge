package model

import "testing"

func TestDistributorStateValidationAndEnergy(t *testing.T) {
	s := NewDistributorState("depot")
	s.ItemID = ItemIronOre
	s.Mode = LogisticsStationModeSupply
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	s.Energy = 999
	if s.ChargingDemand() != 1 {
		t.Fatalf("charging demand=%d", s.ChargingDemand())
	}
	if !s.SpendEnergy(500) || s.Energy != 499 || s.SpendEnergy(500) {
		t.Fatalf("energy budget not enforced")
	}
	s.Mode = LogisticsStationMode("bad")
	if s.Validate() == nil {
		t.Fatal("invalid mode accepted")
	}
}

func TestLogisticsBotCargoAndActiveFlightValidation(t *testing.T) {
	b := NewLogisticsBotState("bot", "dist", Position{X: 1, Y: 1})
	b.OwnerID = "p1"
	if err := b.Validate(); err != nil {
		t.Fatal(err)
	}
	if got, _, err := b.Load(ItemIronOre, 12); err != nil || got != 10 {
		t.Fatalf("load=%d err=%v", got, err)
	}
	b.Status = LogisticsDroneInFlight
	b.TargetKind = "distributor"
	b.TargetID = "target"
	p := Position{X: 4, Y: 1}
	b.TargetPos = &p
	b.TripKind = "delivery"
	b.PickupItemID = ItemIronOre
	b.PickupQuantity = 10
	b.EnergyCost = 4
	b.EnergyRemaining = 4
	if err := b.Validate(); err != nil {
		t.Fatal(err)
	}
	b.Cargo = ItemInventory{ItemIronOre: 11}
	if err := b.Validate(); err == nil {
		t.Fatal("overcapacity cargo accepted")
	}
}
