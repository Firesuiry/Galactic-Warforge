package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

type switchActivePlanetPayload struct {
	PlanetID string `json:"planet_id" payload:"required"`
}

// execSwitchActivePlanet 设置该玩家的视图焦点/默认落点行星（F4）。
// 不再修改全局 gc.activePlanetID，也不再拖拽执行体绑定——所有已加载行星
// 始终参与结算，焦点只决定未显式指定行星的命令默认落在哪颗行星。
func (gc *GameCore) execSwitchActivePlanet(_ *model.WorldState, playerID string, cmd model.Command, p switchActivePlanetPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	planetID := p.PlanetID
	if !gc.discovery.IsPlanetDiscovered(playerID, planetID) {
		res.Code = model.CodeValidationFailed
		res.Message = "目标星球未被发现"
		return res, nil
	}

	targetWorld := gc.WorldForPlanet(planetID)
	if targetWorld == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "星球运行时不可用"
		return res, nil
	}
	if !playerHasFootholdOnWorld(targetWorld, playerID) {
		res.Code = model.CodeValidationFailed
		res.Message = "目标星球需先建立据点"
		return res, nil
	}
	player := targetWorld.Players[playerID]
	if player == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "未找到玩家"
		return res, nil
	}
	player.FocusPlanetID = planetID

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("焦点星球已切换为 %s", planetID)
	return res, nil
}

type setRayReceiverModePayload struct {
	buildingRef
	Mode model.RayReceiverMode `json:"mode" payload:"required"`
}

func (gc *GameCore) execSetRayReceiverMode(ws *model.WorldState, playerID string, cmd model.Command, p setRayReceiverModePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, mode := p.BuildingID, p.Mode

	if !model.IsRayReceiverMode(mode) {
		res.Code = model.CodeValidationFailed
		res.Message = "mode 必须为 power、photon 或 hybrid"
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
	if building.Type != model.BuildingTypeRayReceiver || building.Runtime.Functions.RayReceiver == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "目标建筑不是射线接收站"
		return res, nil
	}

	player := ws.Players[playerID]
	if mode == model.RayReceiverModePhoton && (player == nil || player.Tech == nil || !player.Tech.HasTech("dirac_inversion")) {
		res.Code = model.CodeValidationFailed
		res.Message = "photon 模式需先研究 dirac_inversion"
		return res, nil
	}

	building.Runtime.Functions.RayReceiver.Mode = mode
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("射线接收站 %s 模式已设为 %s", buildingID, mode)
	return res, nil
}
