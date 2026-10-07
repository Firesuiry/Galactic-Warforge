package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

type setEnergyExchangerModePayload struct {
	buildingRef
	Mode model.EnergyExchangerMode `json:"mode" payload:"required"`
}

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
func (gc *GameCore) execSetEnergyExchangerMode(ws *model.WorldState, playerID string, cmd model.Command, p setEnergyExchangerModePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, mode := p.BuildingID, p.Mode

	if !model.IsEnergyExchangerMode(mode) {
		res.Code = model.CodeValidationFailed
		res.Message = "mode 必须为 charge、discharge 或 standby"
		return res, nil
	}

	building := ws.Buildings[buildingID]
	if building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到建筑 %s", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "建筑不属于该玩家"
		return res, nil
	}
	module := building.Runtime.Functions.EnergyExchanger
	if building.Type != model.BuildingTypeEnergyExchanger || module == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "目标建筑不是能量交换器"
		return res, nil
	}

	module.Mode = mode
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("能量交换器 %s 模式已设为 %s", buildingID, mode)
	return res, nil
}
