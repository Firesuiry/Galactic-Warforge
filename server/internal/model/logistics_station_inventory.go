package model

import "fmt"

type LogisticsBeltPort struct {
	Mode   string `json:"mode"`
	ItemID string `json:"item_id"`
}

func IsGroundLogisticsBuilding(kind BuildingType) bool {
	return kind == BuildingTypePlanetaryLogisticsStation || kind == BuildingTypeInterstellarLogisticsStation
}

func (s *LogisticsStationState) ConfiguredItem(itemID string) bool {
	if s == nil {
		return false
	}
	_, local := s.Settings[itemID]
	_, remote := s.InterstellarSettings[itemID]
	return local || remote
}

func (s *LogisticsStationState) validateSettingCapacity(setting LogisticsStationItemSetting) error {
	if setting.LocalStorage < 0 || s.ItemCapacity > 0 && setting.LocalStorage > s.ItemCapacity {
		return fmt.Errorf("local_storage exceeds station item capacity %d", s.ItemCapacity)
	}
	if !setting.Mode.Valid() {
		return fmt.Errorf("invalid station item mode")
	}
	if s.SlotCapacity > 0 && !s.ConfiguredItem(setting.ItemID) && s.ConfiguredSlotCount() >= s.SlotCapacity {
		return fmt.Errorf("station item slots full (%d)", s.SlotCapacity)
	}
	return nil
}

func (s *LogisticsStationState) ConfiguredSlotCount() int {
	items := map[string]bool{}
	for id := range s.Settings {
		items[id] = true
	}
	for id := range s.InterstellarSettings {
		items[id] = true
	}
	return len(items)
}

func (s *LogisticsStationState) AvailableItemCapacity(itemID string) int {
	if s == nil || !s.ConfiguredItem(itemID) || s.ItemCapacity <= 0 {
		return 0
	}
	return max(0, s.ItemCapacity-s.Inventory[itemID])
}

func (s *LogisticsStationState) ReceiveItem(itemID string, quantity int) (int, int, error) {
	if s == nil {
		return 0, quantity, fmt.Errorf("station required")
	}
	if quantity < 0 {
		return 0, quantity, fmt.Errorf("quantity must not be negative")
	}
	if _, ok := Item(itemID); !ok {
		return 0, quantity, fmt.Errorf("unknown item %s", itemID)
	}
	if !s.ConfiguredItem(itemID) {
		return 0, quantity, fmt.Errorf("configure a station slot for %s first", itemID)
	}
	accepted := min(quantity, s.AvailableItemCapacity(itemID))
	if accepted > 0 {
		if s.Inventory == nil {
			s.Inventory = make(ItemInventory)
		}
		s.Inventory[itemID] += accepted
		s.RefreshCapacityCache()
	}
	return accepted, quantity - accepted, nil
}

func (s *LogisticsStationState) SpendEnergy(amount int) bool {
	if s == nil || amount < 0 || amount > s.Energy {
		return false
	}
	s.Energy -= amount
	return true
}

func (s *LogisticsStationState) ChargingDemand() int {
	if s == nil {
		return 0
	}
	return max(0, min(s.ChargePerTick, s.EnergyCapacity-s.Energy))
}

func (s *LogisticsStationState) Validate() error {
	if s == nil {
		return fmt.Errorf("station required")
	}
	if s.SlotCapacity < 0 || s.ItemCapacity < 0 || s.EnergyCapacity < 0 || s.ChargePerTick < 0 || s.Energy < 0 || s.Energy > s.EnergyCapacity || s.LastChargeAmount < 0 || s.LastChargeTick < -1 {
		return fmt.Errorf("invalid station capacity or energy")
	}
	if s.SlotCapacity > 0 && s.ConfiguredSlotCount() > s.SlotCapacity {
		return fmt.Errorf("station has too many item slots")
	}
	for _, settings := range []map[string]LogisticsStationItemSetting{s.Settings, s.InterstellarSettings} {
		for id, setting := range settings {
			if setting.ItemID != id {
				return fmt.Errorf("station slot item mismatch")
			}
			if _, ok := Item(id); !ok {
				return fmt.Errorf("unknown station item %s", id)
			}
			if err := s.validateSettingCapacity(setting); err != nil {
				return err
			}
		}
	}
	for id, quantity := range s.Inventory {
		if quantity < 0 || s.ItemCapacity > 0 && quantity > s.ItemCapacity {
			return fmt.Errorf("invalid station inventory for %s", id)
		}
		if _, ok := Item(id); !ok {
			return fmt.Errorf("unknown station inventory item %s", id)
		}
		if quantity > 0 && s.SlotCapacity > 0 && !s.ConfiguredItem(id) {
			return fmt.Errorf("unconfigured station inventory item %s", id)
		}
	}
	for dir, port := range s.BeltPorts {
		if !dir.Valid() || dir == ConveyorAuto {
			return fmt.Errorf("station belt ports require cardinal directions")
		}
		if port.Mode != "input" && port.Mode != "output" {
			return fmt.Errorf("station belt port mode must be input or output")
		}
		if !s.ConfiguredItem(port.ItemID) {
			return fmt.Errorf("station belt port item %s must have a configured slot", port.ItemID)
		}
	}
	return nil
}
