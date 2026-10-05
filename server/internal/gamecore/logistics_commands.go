package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

type configureLogisticsStationPayload struct {
	InputPriority  *int                                        `json:"input_priority"`
	OutputPriority *int                                        `json:"output_priority"`
	DroneCapacity  *int                                        `json:"drone_capacity"`
	Interstellar   *logisticsInterstellarPayload               `json:"interstellar"`
	BeltPorts      map[model.ConveyorDirection]beltPortPayload `json:"belt_ports"`
}

type logisticsInterstellarPayload struct {
	Enabled     *bool `json:"enabled"`
	WarpEnabled *bool `json:"warp_enabled"`
	ShipSlots   *int  `json:"ship_slots"`
}

type beltPortPayload struct {
	Mode   string `json:"mode" payload:"required,allowempty"`
	ItemID string `json:"item_id" payload:"required,allowempty"`
}

func (gc *GameCore) execConfigureLogisticsStation(ws *model.WorldState, playerID string, cmd model.Command, p configureLogisticsStationPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	building, station, execRes := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if execRes != nil {
		return *execRes, nil
	}

	staged := station.Clone()

	if p.DroneCapacity != nil {
		droneCapacity := *p.DroneCapacity
		if droneCapacity < 1 || droneCapacity > model.DefaultLogisticsStationDroneCapacity {
			res.Code = model.CodeValidationFailed
			res.Message = "drone_capacity must be between 1 and 10"
			return res, nil
		}
		staged.DroneCapacity = droneCapacity
	}
	if p.InputPriority != nil {
		staged.Priority.Input = *p.InputPriority
	}
	if p.OutputPriority != nil {
		staged.Priority.Output = *p.OutputPriority
	}

	if cfg := p.Interstellar; cfg != nil {
		if !supportsInterstellarConfigCommand(building) {
			res.Code = model.CodeValidationFailed
			res.Message = "planetary logistics station does not support interstellar config"
			return res, nil
		}
		if cfg.Enabled != nil {
			staged.Interstellar.Enabled = *cfg.Enabled
		}
		if cfg.WarpEnabled != nil {
			staged.Interstellar.WarpEnabled = *cfg.WarpEnabled
		}
		if cfg.ShipSlots != nil {
			if *cfg.ShipSlots < 1 || *cfg.ShipSlots > model.DefaultLogisticsStationShipSlots {
				res.Code = model.CodeValidationFailed
				res.Message = "ship_slots must be between 1 and 5"
				return res, nil
			}
			staged.Interstellar.ShipSlots = *cfg.ShipSlots
		}
	}

	if p.BeltPorts != nil {
		staged.BeltPorts = make(map[model.ConveyorDirection]model.LogisticsBeltPort, len(p.BeltPorts))
		for direction, port := range p.BeltPorts {
			staged.BeltPorts[direction] = model.LogisticsBeltPort{Mode: port.Mode, ItemID: port.ItemID}
		}
	}
	if err := staged.Validate(); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	staged.Normalize()

	if staged.DroneCapacity < model.StationDroneCount(ws, building.ID) || staged.DroneCapacity > model.DefaultLogisticsStationDroneCapacity || staged.Interstellar.ShipSlots < model.StationShipCount(ws, building.ID) || staged.Interstellar.ShipSlots > model.DefaultLogisticsStationShipSlots {
		res.Code = model.CodeValidationFailed
		res.Message = "vehicle slots must cover installed fleet and remain within physical limits (10 drones, 5 ships)"
		return res, nil
	}
	*station = *staged

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("logistics station %s configured", building.ID)
	return res, nil
}

type configureLogisticsSlotPayload struct {
	Scope        string `json:"scope" payload:"required"`
	ItemID       string `json:"item_id" payload:"required"`
	Mode         string `json:"mode" payload:"required"`
	LocalStorage int    `json:"local_storage" payload:"required"`
	Remove       bool   `json:"remove"`
}

func (gc *GameCore) execConfigureLogisticsSlot(ws *model.WorldState, playerID string, cmd model.Command, p configureLogisticsSlotPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	building, station, execRes := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if execRes != nil {
		return *execRes, nil
	}

	scope, itemID, localStorage := p.Scope, p.ItemID, p.LocalStorage
	mode := model.LogisticsStationMode(p.Mode)
	if !mode.Valid() {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.mode must be one of none|supply|demand|both"
		return res, nil
	}
	if p.Remove {
		if mode != model.LogisticsStationModeNone || localStorage != 0 {
			res.Code = model.CodeValidationFailed
			res.Message = "slot removal requires mode none and local_storage 0"
			return res, nil
		}
		if err := gc.removeLogisticsSlot(ws, building, scope, itemID); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		return model.CommandResult{Status: model.StatusExecuted, Code: model.CodeOK, Message: "empty logistics slot removed"}, nil
	}
	setting := model.LogisticsStationItemSetting{
		ItemID:       itemID,
		Mode:         mode,
		LocalStorage: localStorage,
	}

	var err error
	switch scope {
	case "planetary":
		err = station.UpsertSetting(setting)
	case "interstellar":
		if !supportsInterstellarConfigCommand(building) {
			res.Code = model.CodeValidationFailed
			res.Message = "planetary logistics station does not support interstellar scope"
			return res, nil
		}
		err = station.UpsertInterstellarSetting(setting)
	default:
		res.Code = model.CodeValidationFailed
		res.Message = "payload.scope must be planetary or interstellar"
		return res, nil
	}
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	station.Normalize()
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("logistics slot configured for %s", itemID)
	return res, nil
}

func supportsInterstellarConfigCommand(building *model.Building) bool {
	return building != nil && building.Type == model.BuildingTypeInterstellarLogisticsStation
}

func isConfigurableLogisticsStationType(buildingType model.BuildingType) bool {
	return buildingType == model.BuildingTypePlanetaryLogisticsStation || buildingType == model.BuildingTypeInterstellarLogisticsStation
}

func requireOwnedLogisticsStation(ws *model.WorldState, playerID, buildingID string) (*model.Building, *model.LogisticsStationState, *model.CommandResult) {
	res := model.CommandResult{Status: model.StatusFailed}
	if buildingID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id required"
		return nil, nil, &res
	}

	building, ok := ws.Buildings[buildingID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return nil, nil, &res
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot configure building owned by another player"
		return nil, nil, &res
	}
	if !isConfigurableLogisticsStationType(building.Type) || building.LogisticsStation == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target building is not a logistics station"
		return nil, nil, &res
	}
	return building, building.LogisticsStation, nil
}
