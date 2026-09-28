package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// F4 每人独立的行星焦点：命令按目标行星路由，所有已加载行星都参与结算。
//
// resolveCommandWorld 为每条命令解析它应当结算的世界，优先级（仅限
// 行星层命令，见 commandEntityRefs 的命令集合 + build）：
//  1. target.planet_id 显式路由提示；
//  2. 命令引用的目标实体（建筑/单位/建造任务）所在行星——跨行星同 ID 时
//     优先落在玩家焦点行星；
//  3. 玩家焦点行星（switch_active_planet 写入的 PlayerState.FocusPlanetID）；
//  4. 全局活动行星（冷启动/兜底默认值）。
//
// 太空层/玩家级命令（fleet_*、task_force_*、theater_*、blueprint_*、dyson、
// research 等）的 target.planet_id 是作战参数而非路由提示，不参与路由；
// 它们只读共享玩家状态，落到焦点/全局世界即可。
//
// 返回的 CommandResult 非空表示路由失败（显式指定的行星未加载）。
func (gc *GameCore) resolveCommandWorld(player *model.PlayerState, cmd model.Command) (*model.WorldState, *model.CommandResult) {
	if planetRoutedCommand(cmd.Type) && cmd.Target.PlanetID != "" {
		ws := gc.WorldForPlanet(cmd.Target.PlanetID)
		if ws == nil {
			return nil, &model.CommandResult{
				Status:  model.StatusFailed,
				Code:    model.CodeInvalidTarget,
				Message: fmt.Sprintf("planet runtime %s not loaded", cmd.Target.PlanetID),
			}
		}
		return ws, nil
	}

	focusPlanetID := ""
	if player != nil {
		focusPlanetID = player.FocusPlanetID
	}
	if ws := gc.worldForCommandEntities(cmd, focusPlanetID); ws != nil {
		return ws, nil
	}

	if focusPlanetID != "" {
		if ws := gc.WorldForPlanet(focusPlanetID); ws != nil {
			return ws, nil
		}
	}
	return gc.World(), nil
}

// planetRoutedCommand 报告命令是否在行星层结算（target.planet_id 可作路由提示）。
func planetRoutedCommand(cmdType model.CommandType) bool {
	switch cmdType {
	case model.CmdBuild,
		model.CmdMove, model.CmdAttack, model.CmdUnitOrder,
		model.CmdRefuelMecha, model.CmdMineResource, model.CmdCraftItem,
		model.CmdCancelMechaJob, model.CmdConfigureMechaLogistics,
		model.CmdProduce, model.CmdUpgrade, model.CmdDemolish,
		model.CmdConfigureDistributor, model.CmdInstallLogisticsBot, model.CmdUninstallLogisticsBot,
		model.CmdInstallLogisticsVehicle, model.CmdConfigureLogisticsStation, model.CmdConfigureLogisticsSlot,
		model.CmdSetRecipe, model.CmdConfigureSplitter, model.CmdConfigureTrafficMonitor,
		model.CmdTransferItem, model.CmdLaunchSolarSail, model.CmdLaunchRocket,
		model.CmdSetRayReceiverMode, model.CmdSetEnergyExchangerMode,
		model.CmdQueueMilitaryProduction, model.CmdDeploySquad, model.CmdCommissionFleet,
		model.CmdRefitUnit, model.CmdCancelConstruction, model.CmdRestoreConstruction:
		return true
	}
	return false
}

// FocusPlanetIDFor 返回玩家当前的焦点行星；未设置时回落到全局活动行星。
func (gc *GameCore) FocusPlanetIDFor(playerID string) string {
	if gc == nil {
		return ""
	}
	if ws := gc.World(); ws != nil {
		if player := ws.Players[playerID]; player != nil && player.FocusPlanetID != "" {
			return player.FocusPlanetID
		}
	}
	return gc.ActivePlanetID()
}

// commandEntityRefs 从命令中抽取可用于行星路由的实体引用。
// 注意：attack/unit_order 的 payload.target_entity_id 是被攻击/跟随对象，
// 与施令单位必然同行星，不参与路由（避免跨行星同 ID 时误导路由）。
func commandEntityRefs(cmd model.Command) (buildingIDs, unitIDs, taskIDs []string) {
	appendPayloadString := func(dst []string, key string) []string {
		raw, ok := cmd.Payload[key]
		if !ok {
			return dst
		}
		if s, ok := raw.(string); ok && s != "" {
			return append(dst, s)
		}
		return dst
	}

	switch cmd.Type {
	case model.CmdMove, model.CmdAttack, model.CmdUnitOrder:
		if cmd.Target.EntityID != "" {
			unitIDs = append(unitIDs, cmd.Target.EntityID)
		}
		unitIDs = append(unitIDs, cmd.Target.EntityIDs...)
	case model.CmdRefuelMecha, model.CmdMineResource, model.CmdCraftItem,
		model.CmdCancelMechaJob, model.CmdConfigureMechaLogistics:
		if cmd.Target.EntityID != "" {
			unitIDs = append(unitIDs, cmd.Target.EntityID)
		}
	case model.CmdProduce, model.CmdUpgrade, model.CmdDemolish,
		model.CmdConfigureDistributor, model.CmdInstallLogisticsBot, model.CmdUninstallLogisticsBot,
		model.CmdInstallLogisticsVehicle, model.CmdConfigureLogisticsStation, model.CmdConfigureLogisticsSlot,
		model.CmdSetRecipe, model.CmdConfigureSplitter, model.CmdConfigureTrafficMonitor:
		if cmd.Target.EntityID != "" {
			buildingIDs = append(buildingIDs, cmd.Target.EntityID)
		}
	case model.CmdTransferItem, model.CmdLaunchSolarSail, model.CmdLaunchRocket,
		model.CmdSetRayReceiverMode, model.CmdSetEnergyExchangerMode,
		model.CmdQueueMilitaryProduction, model.CmdDeploySquad, model.CmdCommissionFleet,
		model.CmdRefitUnit:
		buildingIDs = appendPayloadString(buildingIDs, "building_id")
	case model.CmdCancelConstruction, model.CmdRestoreConstruction:
		taskIDs = appendPayloadString(taskIDs, "task_id")
	}
	return buildingIDs, unitIDs, taskIDs
}

// worldForCommandEntities 找到包含命令全部引用实体的世界；多个世界同时命中
// （跨行星实体 ID 撞号）时优先玩家焦点行星，其余按行星 ID 字典序取第一个，
// 保证确定性。一个世界都不命中时返回 nil，由调用方回落到焦点/全局行星，
// 让执行器在该世界上报“实体不存在”。
func (gc *GameCore) worldForCommandEntities(cmd model.Command, focusPlanetID string) *model.WorldState {
	buildingIDs, unitIDs, taskIDs := commandEntityRefs(cmd)
	if len(buildingIDs)+len(unitIDs)+len(taskIDs) == 0 {
		return nil
	}

	var candidates []*model.WorldState
	for _, ws := range gc.sortedWorlds() {
		if worldContainsAllRefs(ws, buildingIDs, unitIDs, taskIDs) {
			candidates = append(candidates, ws)
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	if len(candidates) == 1 {
		return candidates[0]
	}
	for _, ws := range candidates {
		if ws.PlanetID == focusPlanetID {
			return ws
		}
	}
	return candidates[0]
}

func worldContainsAllRefs(ws *model.WorldState, buildingIDs, unitIDs, taskIDs []string) bool {
	if ws == nil {
		return false
	}
	for _, id := range buildingIDs {
		if ws.Buildings[id] == nil {
			return false
		}
	}
	for _, id := range unitIDs {
		if ws.Units[id] == nil {
			return false
		}
	}
	for _, id := range taskIDs {
		if ws.Construction == nil || ws.Construction.Tasks[id] == nil {
			return false
		}
	}
	return true
}
