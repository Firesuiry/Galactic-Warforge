package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
)

type installLogisticsVehiclePayload struct {
	ItemID   string  `json:"item_id" payload:"required"`
	Quantity int     `json:"quantity" payload:"required"`
	Source   *string `json:"source"`
}

// Installation consumes manufactured vehicles; changing station capacity never creates a fleet.
func (gc *GameCore) execInstallLogisticsVehicle(ws *model.WorldState, playerID string, cmd model.Command, p installLogisticsVehiclePayload) (model.CommandResult, []*model.GameEvent) {
	building, station, failure := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: message}, nil
	}
	if building.Type != model.BuildingTypePlanetaryLogisticsStation && building.Type != model.BuildingTypeInterstellarLogisticsStation {
		return fail("运输载具只能安装到行星或星际物流站")
	}
	itemID, quantity := p.ItemID, p.Quantity
	if quantity <= 0 {
		return fail("quantity 必须为正整数")
	}
	source := "player"
	if p.Source != nil {
		source = *p.Source
		if source != "player" && source != "station" {
			return fail("source 必须为 player 或 station")
		}
	}
	player := ws.Players[playerID]
	switch itemID {
	case model.ItemLogisticsDrone:
		if !CanBuildTech(player, model.TechUnlockUnit, "logistics_drone") {
			return fail("需要研究解锁物流无人机（planetary_logistics 或 distribution_logistics）")
		}
		limit := min(station.DroneCapacityValue(), model.DefaultLogisticsStationDroneCapacity)
		if quantity > limit-model.StationDroneCount(ws, building.ID) {
			return fail("无人机容量已满")
		}
	case model.ItemLogisticsVessel:
		if building.Type != model.BuildingTypeInterstellarLogisticsStation || !station.Interstellar.Enabled {
			return fail("运输船需要已启用的星际物流站")
		}
		if !CanBuildTech(player, model.TechUnlockUnit, "logistics_ship") {
			return fail("需要研究解锁物流运输船（interstellar_logistics）")
		}
		limit := min(station.ShipSlotCapacityValue(), model.DefaultLogisticsStationShipSlots)
		if quantity > limit-model.StationShipCount(ws, building.ID) {
			return fail("运输船槽位已满")
		}
	default:
		return fail("item_id 必须为 logistics_drone 或 logistics_vessel")
	}
	cost := []model.ItemAmount{{ItemID: itemID, Quantity: quantity}}
	if (source == "player" && (player == nil || !player.HasItems(cost))) || (source == "station" && station.Inventory[itemID] < quantity) {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeInsufficientResource, Message: source + " 库存中缺少已制造的运输载具"}, nil
	}
	// Capacity and ownership are checked for the whole batch before inventory or registry mutation.
	model.RegisterLogisticsStation(ws, building)
	drones := make([]string, 0, quantity)
	ships := make([]string, 0, quantity)
	var err error
	for i := 0; i < quantity; i++ {
		if itemID == model.ItemLogisticsDrone {
			d := model.NewLogisticsDroneState(ws.NextEntityID("drone"), building.ID, building.Position)
			err = model.RegisterLogisticsDrone(ws, d)
			if err == nil {
				drones = append(drones, d.ID)
			}
		} else {
			s := model.NewLogisticsShipState(ws.NextEntityID("ship"), building.ID, building.Position)
			s.OriginPlanetID = ws.PlanetID
			s.CurrentPlanetID = ws.PlanetID
			s.RefreshTechStats(player)
			err = model.RegisterLogisticsShip(ws, s)
			if err == nil {
				ships = append(ships, s.ID)
			}
		}
		if err != nil {
			for _, id := range drones {
				model.UnregisterLogisticsDrone(ws, id)
			}
			for _, id := range ships {
				model.UnregisterLogisticsShip(ws, id)
			}
			return fail(err.Error())
		}
	}
	if source == "player" {
		player.DeductItems(cost)
	} else {
		station.Inventory[itemID] -= quantity
		if station.Inventory[itemID] == 0 {
			delete(station.Inventory, itemID)
		}
		station.RefreshCapacityCache()
	}
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("已在 %[3]s 安装 %[1]d 个 %[2]s", quantity, itemID, building.ID)}, nil
}
