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
		return fmt.Errorf("local_storage 超出物流站单项容量 %d", s.ItemCapacity)
	}
	if !setting.Mode.Valid() {
		return fmt.Errorf("无效的物流站物品模式")
	}
	if s.SlotCapacity > 0 && !s.ConfiguredItem(setting.ItemID) && s.ConfiguredSlotCount() >= s.SlotCapacity {
		return fmt.Errorf("物流站物品槽位已满（%d）", s.SlotCapacity)
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
		return 0, quantity, fmt.Errorf("缺少物流站")
	}
	if quantity < 0 {
		return 0, quantity, fmt.Errorf("数量不能为负")
	}
	if _, ok := Item(itemID); !ok {
		return 0, quantity, fmt.Errorf("未知物品 %s", itemID)
	}
	if !s.ConfiguredItem(itemID) {
		return 0, quantity, fmt.Errorf("请先为 %s 配置物流站槽位", itemID)
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
		return fmt.Errorf("缺少物流站")
	}
	if s.SlotCapacity < 0 || s.ItemCapacity < 0 || s.EnergyCapacity < 0 || s.ChargePerTick < 0 || s.Energy < 0 || s.Energy > s.EnergyCapacity || s.LastChargeAmount < 0 || s.LastChargeTick < -1 {
		return fmt.Errorf("物流站容量或能量无效")
	}
	if s.SlotCapacity > 0 && s.ConfiguredSlotCount() > s.SlotCapacity {
		return fmt.Errorf("物流站物品槽位过多")
	}
	for _, settings := range []map[string]LogisticsStationItemSetting{s.Settings, s.InterstellarSettings} {
		for id, setting := range settings {
			if setting.ItemID != id {
				return fmt.Errorf("物流站槽位物品不一致")
			}
			if _, ok := Item(id); !ok {
				return fmt.Errorf("未知的物流站物品 %s", id)
			}
			if err := s.validateSettingCapacity(setting); err != nil {
				return err
			}
		}
	}
	for id, quantity := range s.Inventory {
		if quantity < 0 || s.ItemCapacity > 0 && quantity > s.ItemCapacity {
			return fmt.Errorf("%s 的物流站库存无效", id)
		}
		if _, ok := Item(id); !ok {
			return fmt.Errorf("未知的物流站库存物品 %s", id)
		}
		if quantity > 0 && s.SlotCapacity > 0 && !s.ConfiguredItem(id) {
			return fmt.Errorf("物流站库存物品 %s 未配置槽位", id)
		}
	}
	for dir, port := range s.BeltPorts {
		if !dir.Valid() || dir == ConveyorAuto {
			return fmt.Errorf("物流站传送带端口须为东南西北方向")
		}
		if port.Mode != "input" && port.Mode != "output" {
			return fmt.Errorf("物流站传送带端口模式必须为 input 或 output")
		}
		if !s.ConfiguredItem(port.ItemID) {
			return fmt.Errorf("物流站传送带端口物品 %s 必须已配置槽位", port.ItemID)
		}
	}
	return nil
}
