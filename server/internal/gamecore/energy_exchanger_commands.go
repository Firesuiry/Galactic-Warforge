package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// execSetEnergyExchangerMode handles the "set_energy_exchanger_mode" command.
//
//	Payload: {
//	  "building_id": "id of an owned energy_exchanger",
//	  "mode": "charge|discharge|standby",
//	}
//
// The mode selects the accumulator item cycle: charge converts empty
// accumulators into full ones using grid surplus, discharge converts full
// accumulators back into grid energy, standby leaves items untouched.
func (gc *GameCore) execSetEnergyExchangerMode(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingIDRaw, ok := cmd.Payload["building_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.building_id required"
		return res, nil
	}
	modeRaw, ok := cmd.Payload["mode"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.mode required"
		return res, nil
	}
	buildingID := fmt.Sprintf("%v", buildingIDRaw)
	mode := model.EnergyExchangerMode(fmt.Sprintf("%v", modeRaw))

	if !model.IsEnergyExchangerMode(mode) {
		res.Code = model.CodeValidationFailed
		res.Message = "mode must be charge, discharge, or standby"
		return res, nil
	}

	building := ws.Buildings[buildingID]
	if building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "building not owned by player"
		return res, nil
	}
	module := building.Runtime.Functions.EnergyExchanger
	if building.Type != model.BuildingTypeEnergyExchanger || module == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target building is not an energy exchanger"
		return res, nil
	}

	module.Mode = mode
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("energy exchanger %s mode set to %s", buildingID, mode)
	return res, nil
}
