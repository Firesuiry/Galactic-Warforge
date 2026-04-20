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
	}

	return view
}
