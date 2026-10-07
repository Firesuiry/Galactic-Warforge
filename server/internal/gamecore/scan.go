package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

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

	gc.discovery.DiscoverGalaxy(playerID, galaxyID)
	gc.discovery.DiscoverSystems(playerID, galaxy.SystemIDs)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "星系扫描完成"
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

	gc.discovery.DiscoverSystem(playerID, systemID)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "恒星系扫描完成"
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

	gc.discovery.DiscoverPlanet(playerID, planetID)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "星球扫描完成"
	return res, nil
}
