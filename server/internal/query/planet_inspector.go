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
		if ws.PlanetID != planetID {
			return nil, false
		}
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
	case "unit":
		if ws.PlanetID != planetID {
			return nil, false
		}
		ws.RLock()
		defer ws.RUnlock()
		unit := ws.Units[req.TargetID]
		if unit == nil {
			return nil, false
		}
		if unit.OwnerID != playerID && !ql.vis.IsVisible(ws, playerID, unit.Position) {
			return nil, false
		}
		view.Title = string(unit.Type)
		view.Unit = unit
		return view, true
	case "resource":
		if ws.PlanetID == planetID {
			ws.RLock()
			resource := ws.Resources[req.TargetID]
			ws.RUnlock()
			if resource != nil {
				if !ql.vis.IsVisible(ws, playerID, resource.Position) {
					return nil, false
				}
				view.Title = resource.Kind
				view.Resource = resource
				return view, true
			}
		}
		for _, resource := range staticPlanetResources(planet) {
			if resource.ID != req.TargetID {
				continue
			}
			view.Title = resource.Kind
			view.Resource = resource
			return view, true
		}
		return nil, false
	case "sector":
		view.Title = "Sector " + req.TargetID
		return view, true
	default:
		return nil, false
	}
}
