package gamecore

import (
	"fmt"
	"math"

	"siliconworld/internal/model"
)

func (gc *GameCore) execLaunchRocket(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	systemID, err := payloadString(cmd.Payload, "system_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	layerIndex := 0
	if _, ok := cmd.Payload["layer_index"]; ok {
		layerIndex, err = payloadInt(cmd.Payload, "layer_index")
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}
	count := 1
	if _, ok := cmd.Payload["count"]; ok {
		count, err = payloadInt(cmd.Payload, "count")
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}
	if count <= 0 {
		count = 1
	}
	if count > 5 {
		count = 5
	}

	building, ok := ws.Buildings[buildingID]
	if !ok || building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if building.Type != model.BuildingTypeVerticalLaunchingSilo {
		res.Code = model.CodeInvalidTarget
		res.Message = "only vertical_launching_silo can launch rockets"
		return res, nil
	}
	if building.Runtime.State != model.BuildingWorkRunning {
		res.Code = model.CodeValidationFailed
		res.Message = "building is not operational"
		return res, nil
	}
	if building.Storage == nil {
		res.Code = model.CodeInsufficientResource
		res.Message = "launch building has no rocket storage"
		return res, nil
	}
	loadedRockets := building.Storage.OutputQuantity(model.ItemSmallCarrierRocket)
	if loadedRockets < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d small_carrier_rocket loaded, have %d", count, loadedRockets)
		return res, nil
	}
	if gc.maps != nil {
		if _, ok := gc.maps.System(systemID); !ok {
			res.Code = model.CodeInvalidTarget
			res.Message = fmt.Sprintf("system %s not found", systemID)
			return res, nil
		}
	}

	state := GetDysonSphereState(playerID)
	if state == nil || state.SystemID != systemID {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("dyson layer %d for system %s not found", layerIndex, systemID)
		return res, nil
	}
	if layerIndex < 0 || layerIndex >= len(state.Layers) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("dyson layer %d for system %s not found", layerIndex, systemID)
		return res, nil
	}

	layer := &state.Layers[layerIndex]
	if !hasDysonScaffold(*layer) {
		res.Code = model.CodeValidationFailed
		res.Message = "target dyson layer requires at least one scaffold"
		return res, nil
	}

	provided, _, err := building.Storage.Provide(model.ItemSmallCarrierRocket, count)
	if err != nil || provided != count {
		res.Code = model.CodeInsufficientResource
		res.Message = "failed to consume loaded rockets"
		return res, nil
	}

	layer.RocketLaunches += count
	layer.ConstructionBonus = math.Min(0.5, float64(layer.RocketLaunches)*0.02)
	applyRocketCoverage(layer, count)

	state.CalculateTotalEnergy(dysonStressParams)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("launched %d rocket(s) into dyson layer %d", count, layerIndex)
	return res, []*model.GameEvent{{
		EventType:       model.EvtRocketLaunched,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"building_id":         buildingID,
			"system_id":           systemID,
			"layer_index":         layerIndex,
			"count":               count,
			"rocket_launches":     layer.RocketLaunches,
			"construction_bonus":  layer.ConstructionBonus,
			"layer_energy_output": layer.EnergyOutput,
		},
	}}
}

func hasDysonScaffold(layer model.DysonLayer) bool {
	return len(layer.Nodes) > 0 || len(layer.Frames) > 0 || len(layer.Shells) > 0
}

func applyRocketCoverage(layer *model.DysonLayer, count int) {
	if layer == nil || count <= 0 || len(layer.Shells) == 0 {
		return
	}
	for i := 0; i < count; i++ {
		for idx := range layer.Shells {
			if layer.Shells[idx].Coverage >= 1.0 {
				continue
			}
			layer.Shells[idx].Coverage = math.Min(1.0, layer.Shells[idx].Coverage+0.02)
			layer.Shells[idx].EnergyOutput = int(layer.Shells[idx].Coverage * 1000)
			break
		}
	}
}
