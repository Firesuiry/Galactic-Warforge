package gamecore

import (
	"fmt"
	"siliconworld/internal/model"
)

// Installation consumes manufactured vehicles; changing station capacity never creates a fleet.
func (gc *GameCore) execInstallLogisticsVehicle(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	building, station, failure := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if failure != nil {
		return *failure, nil
	}
	fail := func(message string) (model.CommandResult, []*model.GameEvent) {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: message}, nil
	}
	if building.Type != model.BuildingTypePlanetaryLogisticsStation && building.Type != model.BuildingTypeInterstellarLogisticsStation {
		return fail("vehicles can only be installed at planetary or interstellar logistics stations")
	}
	itemID, err := payloadStrictString(cmd.Payload, "item_id")
	if err != nil {
		return fail(err.Error())
	}
	quantity, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil || quantity <= 0 {
		return fail("quantity must be a positive integer")
	}
	source := "player"
	if raw, ok := cmd.Payload["source"]; ok {
		value, valid := raw.(string)
		if !valid || (value != "player" && value != "station") {
			return fail("source must be player or station")
		}
		source = value
	}
	player := ws.Players[playerID]
	switch itemID {
	case model.ItemLogisticsDrone:
		if !CanBuildTech(player, model.TechUnlockUnit, "logistics_drone") {
			return fail("research required: logistics drone unit unlock (planetary_logistics or distribution_logistics)")
		}
		limit := min(station.DroneCapacityValue(), model.DefaultLogisticsStationDroneCapacity)
		if quantity > limit-model.StationDroneCount(ws, building.ID) {
			return fail("drone capacity exceeded")
		}
	case model.ItemLogisticsVessel:
		if building.Type != model.BuildingTypeInterstellarLogisticsStation || !station.Interstellar.Enabled {
			return fail("vessels require an enabled interstellar logistics station")
		}
		if !CanBuildTech(player, model.TechUnlockUnit, "logistics_ship") {
			return fail("research required: logistics ship unit unlock (interstellar_logistics)")
		}
		limit := min(station.ShipSlotCapacityValue(), model.DefaultLogisticsStationShipSlots)
		if quantity > limit-model.StationShipCount(ws, building.ID) {
			return fail("ship slots exceeded")
		}
	default:
		return fail("item_id must be logistics_drone or logistics_vessel")
	}
	cost := []model.ItemAmount{{ItemID: itemID, Quantity: quantity}}
	if (source == "player" && (player == nil || !player.HasItems(cost))) || (source == "station" && station.Inventory[itemID] < quantity) {
		return model.CommandResult{Status: model.StatusFailed, Code: model.CodeInsufficientResource, Message: "manufactured vehicles required in " + source + " inventory"}, nil
	}
	// Capacity and ownership are checked for the whole batch before inventory or registry mutation.
	model.RegisterLogisticsStation(ws, building)
	drones := make([]string, 0, quantity)
	ships := make([]string, 0, quantity)
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
	return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: fmt.Sprintf("installed %d %s at %s", quantity, itemID, building.ID)}, nil
}
