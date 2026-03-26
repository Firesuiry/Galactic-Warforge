package query

import "siliconworld/internal/model"

type PlanetInspectRequest struct {
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id,omitempty"`
}

type PlanetInspectView struct {
	PlanetID   string                   `json:"planet_id"`
	Discovered bool                     `json:"discovered"`
	TargetType string                   `json:"target_type,omitempty"`
	TargetID   string                   `json:"target_id,omitempty"`
	Title      string                   `json:"title,omitempty"`
	Building   *model.Building          `json:"building,omitempty"`
	Unit       *model.Unit              `json:"unit,omitempty"`
	Resource   *model.ResourceNodeState `json:"resource,omitempty"`
}

func (ql *Layer) PlanetInspect(ws *model.WorldState, playerID, planetID string, req PlanetInspectRequest) (*PlanetInspectView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetInspectView{
		PlanetID:   planet.ID,
		Discovered: discovered,
		TargetType: req.TargetType,
		TargetID:   req.TargetID,
	}
	if !discovered || ws == nil {
		return view, true
	}

	switch req.TargetType {
	case "building":
		ws.RLock()
		defer ws.RUnlock()
		building := ws.Buildings[req.TargetID]
		if building == nil {
			return nil, false
		}
		if building.OwnerID != playerID && !ql.vis.IsVisible(ws, playerID, building.Position) {
			return nil, false
		}
		view.Title = string(building.Type)
		view.Building = building
		return view, true
	default:
		return nil, false
	}
}
