package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// F4 每人独立的行星焦点：命令按目标行星路由，所有已加载行星都参与结算。
//
// resolveCommandWorld 为每条命令解析它应当结算的世界，优先级（仅限
// 行星层命令，即注册表里 route != routeSpace 的命令）：
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
func (gc *GameCore) resolveCommandWorld(player *model.PlayerState, cmd model.Command, route commandRoute, refs entityRefs) (*model.WorldState, *model.CommandResult) {
	if route != routeSpace && cmd.Target.PlanetID != "" {
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
	if ws := gc.worldForEntityRefs(refs, focusPlanetID); ws != nil {
		return ws, nil
	}

	if focusPlanetID != "" {
		if ws := gc.WorldForPlanet(focusPlanetID); ws != nil {
			return ws, nil
		}
	}
	return gc.World(), nil
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

// worldForEntityRefs 找到包含命令全部引用实体的世界；多个世界同时命中
// （跨行星实体 ID 撞号）时优先玩家焦点行星，其余按行星 ID 字典序取第一个，
// 保证确定性。一个世界都不命中时返回 nil，由调用方回落到焦点/全局行星，
// 让执行器在该世界上报“实体不存在”。
func (gc *GameCore) worldForEntityRefs(refs entityRefs, focusPlanetID string) *model.WorldState {
	if refs.empty() {
		return nil
	}

	var candidates []*model.WorldState
	for _, ws := range gc.sortedWorlds() {
		if worldContainsAllRefs(ws, refs) {
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

func worldContainsAllRefs(ws *model.WorldState, refs entityRefs) bool {
	if ws == nil {
		return false
	}
	for _, id := range refs.buildings {
		if ws.Buildings[id] == nil {
			return false
		}
	}
	for _, id := range refs.units {
		if ws.Units[id] == nil {
			return false
		}
	}
	for _, id := range refs.tasks {
		if ws.Construction == nil || ws.Construction.Tasks[id] == nil {
			return false
		}
	}
	return true
}
