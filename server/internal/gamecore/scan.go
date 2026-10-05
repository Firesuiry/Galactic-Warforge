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
		res.Message = "galaxy_id required for scan_galaxy"
		return res, nil
	}
	galaxy, ok := gc.maps.Galaxies[galaxyID]
	if !ok || galaxy == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("galaxy %s not found", galaxyID)
		return res, nil
	}

	gc.discovery.DiscoverGalaxy(playerID, galaxyID)
	gc.discovery.DiscoverSystems(playerID, galaxy.SystemIDs)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "galaxy scanned"
	return res, nil
}

func (gc *GameCore) execScanSystem(_ *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	systemID := cmd.Target.SystemID
	if systemID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "system_id required for scan_system"
		return res, nil
	}
	if _, ok := gc.maps.Systems[systemID]; !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("system %s not found", systemID)
		return res, nil
	}

	gc.discovery.DiscoverSystem(playerID, systemID)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "system scanned"
	return res, nil
}

func (gc *GameCore) execScanPlanet(_ *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	planetID := cmd.Target.PlanetID
	if planetID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "planet_id required for scan_planet"
		return res, nil
	}
	if _, ok := gc.maps.Planets[planetID]; !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("planet %s not found", planetID)
		return res, nil
	}

	gc.discovery.DiscoverPlanet(playerID, planetID)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "planet scanned"
	return res, nil
}
