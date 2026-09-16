package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
	"sort"
)

func settleLogisticsCharging(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	snapshot := model.CurrentPowerSettlementSnapshot(ws)
	if snapshot == nil {
		return nil
	}
	var events []*model.GameEvent
	for _, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeLogisticsDistributor && b.Distributor != nil {
			d := b.Distributor
			if d.LastChargeTick != ws.Tick {
				d.LastChargeTick = ws.Tick
				d.LastChargeAmount = 0
				if b.Runtime.State == model.BuildingWorkRunning {
					base := model.PowerDemandForBuilding(b) - d.ChargingDemand()
					allocation, ok := snapshot.Allocations.Buildings[b.ID]
					if ok && allocation.Allocated >= base {
						amount := min(d.ChargingDemand(), max(0, allocation.Allocated-base))
						d.Energy += amount
						d.LastChargeAmount = amount
					}
				}
			}
			continue
		}
		if b == nil || !model.IsGroundLogisticsBuilding(b.Type) || b.LogisticsStation == nil {
			continue
		}
		s := b.LogisticsStation
		if s.LastChargeTick == ws.Tick {
			continue
		}
		s.LastChargeTick = ws.Tick
		s.LastChargeAmount = 0
		if b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		base := model.PowerDemandForBuilding(b) - s.ChargingDemand()
		allocation, ok := snapshot.Allocations.Buildings[b.ID]
		if !ok || allocation.Allocated < base {
			if event := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonUnderPower); event != nil {
				events = append(events, event)
			}
			continue
		}
		amount := min(s.ChargingDemand(), max(0, allocation.Allocated-base))
		s.Energy += amount
		s.LastChargeAmount = amount
	}
	return events
}

func settleLogisticsStationIO(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ids := make([]string, 0)
	for id, b := range ws.Buildings {
		if b != nil && model.IsGroundLogisticsBuilding(b.Type) && b.LogisticsStation != nil && b.Runtime.State == model.BuildingWorkRunning {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := ws.Buildings[id]
		s := b.LogisticsStation
		for _, dir := range conveyorDirOrder {
			port, ok := s.BeltPorts[dir]
			if !ok || port.Mode != "input" || !s.ConfiguredItem(port.ItemID) {
				continue
			}
			belt := machineBelt(ws, b, dir, true)
			if belt == nil {
				continue
			}
			budget := min(6, s.AvailableItemCapacity(port.ItemID))
			for budget > 0 && len(belt.Conveyor.Buffer) > 0 {
				front := belt.Conveyor.Buffer[0]
				if front.ItemID != port.ItemID {
					break
				}
				// Count-only station inventory cannot retain per-item spray. Coated cargo
				// remains on the belt instead of silently losing its paid coating.
				if front.Spray != nil && front.Spray.RemainingUses > 0 {
					break
				}
				accepted, _, err := s.ReceiveItem(port.ItemID, min(budget, front.Quantity))
				if err != nil || accepted <= 0 {
					break
				}
				belt.Conveyor.Take(accepted)
				recordConveyorDeparture(ws, belt, accepted)
				budget -= accepted
			}
		}
		for _, dir := range conveyorDirOrder {
			port, ok := s.BeltPorts[dir]
			if !ok || port.Mode != "output" || !s.ConfiguredItem(port.ItemID) {
				continue
			}
			belt := machineBelt(ws, b, dir, false)
			if belt == nil {
				continue
			}
			quantity := min(6, s.Inventory[port.ItemID], belt.Conveyor.AvailableCapacity())
			if quantity <= 0 {
				continue
			}
			accepted, _, err := belt.Conveyor.Insert(port.ItemID, quantity)
			if err != nil {
				continue
			}
			s.Inventory[port.ItemID] -= accepted
			if s.Inventory[port.ItemID] == 0 {
				delete(s.Inventory, port.ItemID)
			}
		}
		s.RefreshCapacityCache()
	}
}

func parseLogisticsBeltPorts(raw any) (map[model.ConveyorDirection]model.LogisticsBeltPort, error) {
	object, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("payload.belt_ports must be an object")
	}
	ports := make(map[model.ConveyorDirection]model.LogisticsBeltPort, len(object))
	for direction, value := range object {
		entry, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("belt_ports.%s must be an object", direction)
		}
		mode, modeOK := entry["mode"].(string)
		item, itemOK := entry["item_id"].(string)
		if !modeOK || !itemOK {
			return nil, fmt.Errorf("belt_ports.%s requires mode and item_id strings", direction)
		}
		ports[model.ConveyorDirection(direction)] = model.LogisticsBeltPort{Mode: mode, ItemID: item}
	}
	return ports, nil
}

func (gc *GameCore) removeLogisticsSlot(ws *model.WorldState, b *model.Building, scope, itemID string) error {
	s := b.LogisticsStation
	switch scope {
	case "planetary":
		if _, ok := s.Settings[itemID]; !ok {
			return fmt.Errorf("planetary slot is not configured")
		}
	case "interstellar":
		if !supportsInterstellarConfigCommand(b) {
			return fmt.Errorf("station does not support interstellar slots")
		}
		if _, ok := s.InterstellarSettings[itemID]; !ok {
			return fmt.Errorf("interstellar slot is not configured")
		}
	default:
		return fmt.Errorf("scope must be planetary or interstellar")
	}
	if s.Inventory[itemID] > 0 {
		return fmt.Errorf("cannot remove a slot with stored inventory")
	}
	for _, port := range s.BeltPorts {
		if port.ItemID == itemID {
			return fmt.Errorf("remove belt port references before removing this slot")
		}
	}
	worlds := make(map[string]*model.WorldState, len(gc.worlds)+1)
	for id, world := range gc.worlds {
		worlds[id] = world
	}
	worlds[ws.PlanetID] = ws
	if logisticsItemInFlight(worlds, ws.PlanetID, b.ID, itemID) {
		return fmt.Errorf("cannot remove a slot while its cargo is in transit")
	}
	if scope == "planetary" {
		s.RemoveSetting(itemID)
	} else {
		s.RemoveInterstellarSetting(itemID)
	}
	return nil
}
