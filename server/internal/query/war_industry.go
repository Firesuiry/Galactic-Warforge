package query

import (
	"sort"

	"siliconworld/internal/model"
)

// WarIndustry returns the current player's military production, refit and hub state.
func (ql *Layer) WarIndustry(ws *model.WorldState, playerID string) *model.WarIndustryView {
	view := &model.WarIndustryView{
		ProductionOrders: []model.WarProductionOrder{},
		RefitOrders:      []model.WarRefitOrder{},
		DeploymentHubs:   []model.WarDeploymentHubView{},
		SupplyNodes:      []model.WarSupplyNodeView{},
	}
	if ws == nil {
		return view
	}
	ws.RLock()
	defer ws.RUnlock()

	player := ws.Players[playerID]
	if player == nil || player.WarIndustry == nil {
		return view
	}
	industry := player.WarIndustry

	productionIDs := make([]string, 0, len(industry.ProductionOrders))
	for id := range industry.ProductionOrders {
		productionIDs = append(productionIDs, id)
	}
	sort.Strings(productionIDs)
	for _, id := range productionIDs {
		order := industry.ProductionOrders[id]
		if order == nil {
			continue
		}
		view.ProductionOrders = append(view.ProductionOrders, *order)
	}

	refitIDs := make([]string, 0, len(industry.RefitOrders))
	for id := range industry.RefitOrders {
		refitIDs = append(refitIDs, id)
	}
	sort.Strings(refitIDs)
	for _, id := range refitIDs {
		order := industry.RefitOrders[id]
		if order == nil {
			continue
		}
		view.RefitOrders = append(view.RefitOrders, *order)
	}

	hubIDs := make([]string, 0, len(industry.DeploymentHubs))
	for id := range industry.DeploymentHubs {
		hubIDs = append(hubIDs, id)
	}
	sort.Strings(hubIDs)
	for _, id := range hubIDs {
		hub := industry.DeploymentHubs[id]
		if hub == nil {
			continue
		}
		hubView := model.WarDeploymentHubView{
			BuildingID:    hub.BuildingID,
			Capacity:      hub.Capacity,
			ReadyPayloads: map[string]int{},
		}
		if building := ws.Buildings[hub.BuildingID]; building != nil {
			hubView.BuildingType = building.Type
			hubView.PlanetID = ws.PlanetID
		}
		for blueprintID, count := range hub.ReadyPayloads {
			hubView.ReadyPayloads[blueprintID] = count
		}
		view.DeploymentHubs = append(view.DeploymentHubs, hubView)

		if building := ws.Buildings[hub.BuildingID]; building != nil && building.Storage != nil {
			view.SupplyNodes = append(view.SupplyNodes, model.WarSupplyNodeView{
				NodeID:      "hub:" + hub.BuildingID,
				SourceType:  model.WarSupplySourceOrbitalSupplyPort,
				Label:       "Orbital Supply Port",
				PlanetID:    ws.PlanetID,
				BuildingID:  hub.BuildingID,
				Inventory:   model.MilitarySupplyFromInventory(building.Storage.Inventory),
				UpdatedTick: hub.UpdatedTick,
			})
		}
	}

	for stationID, station := range ws.LogisticsStations {
		building := ws.Buildings[stationID]
		if station == nil || building == nil || building.OwnerID != playerID {
			continue
		}
		sourceType := model.WarSupplySourcePlanetaryLogisticsStation
		label := "Planetary Logistics Station"
		if building.Type == model.BuildingTypeInterstellarLogisticsStation {
			sourceType = model.WarSupplySourceInterstellarLogistics
			label = "Interstellar Logistics Station"
		}
		view.SupplyNodes = append(view.SupplyNodes, model.WarSupplyNodeView{
			NodeID:      "station:" + stationID,
			SourceType:  sourceType,
			Label:       label,
			PlanetID:    ws.PlanetID,
			BuildingID:  stationID,
			Inventory:   model.MilitarySupplyFromInventory(station.Inventory),
			UpdatedTick: ws.Tick,
		})
	}

	for droneID, drone := range ws.LogisticsDrones {
		building := ws.Buildings[drone.StationID]
		if drone == nil || building == nil || building.OwnerID != playerID {
			continue
		}
		view.SupplyNodes = append(view.SupplyNodes, model.WarSupplyNodeView{
			NodeID:      "drone:" + droneID,
			SourceType:  model.WarSupplySourceFrontlineSupplyDrop,
			Label:       "Frontline Supply Drop",
			PlanetID:    ws.PlanetID,
			BuildingID:  drone.StationID,
			UnitID:      droneID,
			Inventory:   model.MilitarySupplyFromInventory(drone.Cargo),
			UpdatedTick: ws.Tick,
		})
	}

	for shipID, ship := range ws.LogisticsShips {
		building := ws.Buildings[ship.StationID]
		if ship == nil || building == nil || building.OwnerID != playerID {
			continue
		}
		view.SupplyNodes = append(view.SupplyNodes, model.WarSupplyNodeView{
			NodeID:      "ship:" + shipID,
			SourceType:  model.WarSupplySourceSupplyShip,
			Label:       "Supply Ship",
			PlanetID:    ws.PlanetID,
			BuildingID:  ship.StationID,
			UnitID:      shipID,
			Inventory:   model.MilitarySupplyFromInventory(ship.Cargo),
			UpdatedTick: ws.Tick,
		})
	}

	return view
}
