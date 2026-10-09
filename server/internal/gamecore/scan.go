package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// scan_* 是"星图登记"命令，不是"开图"命令：它们把星系/恒星系/星球登记进玩家的
// 星图（Discovery），供星图导航与运行时加载使用；它们不揭示行星地表的迷雾
// （explored 掩码只由视野源推进）。回执必须如实说明，避免玩家以为能开图
// （试玩报告 #7：「扫描当前行星」回执「星球扫描完成」但 explored 完全不变）。
func (gc *GameCore) execScanGalaxy(_ *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	galaxyID := cmd.Target.GalaxyID
	if galaxyID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "scan_galaxy 缺少 galaxy_id"
		return res, nil
	}
	galaxy, ok := gc.maps.Galaxies[galaxyID]
	if !ok || galaxy == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到星系 %s", galaxyID)
		return res, nil
	}

	added := 0
	if gc.discovery.DiscoverGalaxy(playerID, galaxyID) {
		added++
	}
	added += gc.discovery.DiscoverSystems(playerID, galaxy.SystemIDs)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = scanResultMessage(added, "星系 %s 已登记到星图", "星系 %s 本就在星图中（扫描只登记星图，不揭示地表迷雾）", galaxyID)
	return res, nil
}

func (gc *GameCore) execScanSystem(_ *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	systemID := cmd.Target.SystemID
	if systemID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "scan_system 缺少 system_id"
		return res, nil
	}
	if _, ok := gc.maps.Systems[systemID]; !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到恒星系 %s", systemID)
		return res, nil
	}

	added := 0
	if gc.discovery.DiscoverSystem(playerID, systemID) {
		added++
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = scanResultMessage(added, "恒星系 %s 已登记到星图", "恒星系 %s 本就在星图中（扫描只登记星图，不揭示地表迷雾）", systemID)
	return res, nil
}

func (gc *GameCore) execScanPlanet(_ *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	planetID := cmd.Target.PlanetID
	if planetID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "scan_planet 缺少 planet_id"
		return res, nil
	}
	if _, ok := gc.maps.Planets[planetID]; !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到星球 %s", planetID)
		return res, nil
	}

	added := 0
	if gc.discovery.DiscoverPlanet(playerID, planetID) {
		added++
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = scanResultMessage(added, "星球 %s 已登记到星图", "星球 %s 本就在星图中（扫描只登记星图，不揭示地表迷雾）", planetID)
	return res, nil
}

// scanResultMessage 按"本次是否新增登记"给出回执：新增 = 命令生效，
// 已登记 = 如实说明这是空操作且不会揭示地表迷雾。
func scanResultMessage(added int, successFormat, noopFormat, id string) string {
	if added > 0 {
		return fmt.Sprintf(successFormat, id)
	}
	return fmt.Sprintf(noopFormat, id)
}
