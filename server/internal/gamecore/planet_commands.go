package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// execSwitchActivePlanet 设置该玩家的视图焦点/默认落点行星（F4）。
// 不再修改全局 gc.activePlanetID，也不再拖拽执行体绑定——所有已加载行星
// 始终参与结算，焦点只决定未显式指定行星的命令默认落在哪颗行星。
func (gc *GameCore) execSwitchActivePlanet(playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	planetIDRaw, ok := cmd.Payload["planet_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.planet_id required"
		return res, nil
	}
	planetID := fmt.Sprintf("%v", planetIDRaw)
	if !gc.discovery.IsPlanetDiscovered(playerID, planetID) {
		res.Code = model.CodeValidationFailed
		res.Message = "target planet not discovered"
		return res, nil
	}

	targetWorld := gc.WorldForPlanet(planetID)
	if targetWorld == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "planet runtime not available"
		return res, nil
	}
	if !playerHasFootholdOnWorld(targetWorld, playerID) {
		res.Code = model.CodeValidationFailed
		res.Message = "target planet requires foothold"
		return res, nil
	}
	player := targetWorld.Players[playerID]
	if player == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found"
		return res, nil
	}
	player.FocusPlanetID = planetID

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("focus planet switched to %s", planetID)
	return res, nil
}

func (gc *GameCore) execSetRayReceiverMode(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
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
	mode := model.RayReceiverMode(fmt.Sprintf("%v", modeRaw))

	if !model.IsRayReceiverMode(mode) {
		res.Code = model.CodeValidationFailed
		res.Message = "mode must be power, photon, or hybrid"
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
	if building.Type != model.BuildingTypeRayReceiver || building.Runtime.Functions.RayReceiver == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target building is not a ray receiver"
		return res, nil
	}

	player := ws.Players[playerID]
	if mode == model.RayReceiverModePhoton && (player == nil || player.Tech == nil || !player.Tech.HasTech("dirac_inversion")) {
		res.Code = model.CodeValidationFailed
		res.Message = "photon mode requires dirac_inversion"
		return res, nil
	}

	building.Runtime.Functions.RayReceiver.Mode = mode
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("ray receiver %s mode set to %s", buildingID, mode)
	return res, nil
}
