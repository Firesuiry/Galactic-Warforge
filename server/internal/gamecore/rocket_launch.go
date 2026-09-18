package gamecore

import (
	"fmt"
	"hash/fnv"
	"math"
	"sort"

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

	state := GetDysonSphereState(gc.spaceRuntime, playerID, systemID)
	if state == nil {
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

// settleAutoLaunch settles automatic continuous launches for every loaded,
// powered launch building (em_rail_ejector / vertical_launching_silo).
//
// The cadence derives from the world tick and a per-building phase offset, so
// no mutable countdown state is needed and behavior is identical after a
// save/restore cycle: building b fires on tick T when
// (T + phase(b.ID)) % LaunchInterval == 0. Each launch consumes one loaded
// item and EnergyPerLaunch from the owner's energy reserve; a building that
// is unpowered, underfunded or empty simply skips its slot.
func (gc *GameCore) settleAutoLaunch(ws *model.WorldState) []*model.GameEvent {
	if gc == nil || ws == nil {
		return nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var events []*model.GameEvent
	for _, id := range ids {
		b := ws.Buildings[id]
		if b == nil {
			continue
		}
		lm := b.Runtime.Functions.Launch
		if lm == nil || lm.LaunchInterval <= 0 {
			continue
		}
		if b.Type != model.BuildingTypeEMRailEjector && b.Type != model.BuildingTypeVerticalLaunchingSilo {
			continue
		}
		if b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if (ws.Tick+launchPhaseOffset(b.ID, lm.LaunchInterval))%int64(lm.LaunchInterval) != 0 {
			continue
		}
		player := ws.Players[b.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}
		if lm.EnergyPerLaunch > 0 && player.Resources.Energy < lm.EnergyPerLaunch {
			continue
		}
		var evt *model.GameEvent
		switch b.Type {
		case model.BuildingTypeEMRailEjector:
			evt = gc.autoLaunchSolarSail(ws, b, player, lm)
		case model.BuildingTypeVerticalLaunchingSilo:
			evt = gc.autoLaunchRocket(ws, b, player, lm)
		}
		if evt != nil {
			events = append(events, evt)
		}
	}
	return events
}

// launchPhaseOffset spreads launch ticks across buildings deterministically.
func launchPhaseOffset(buildingID string, interval int) int64 {
	if interval <= 1 {
		return 0
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(buildingID))
	return int64(h.Sum32() % uint32(interval))
}

func (gc *GameCore) launchSystemID(ws *model.WorldState) string {
	if gc.maps == nil || ws == nil {
		return ""
	}
	planet, _ := gc.maps.Planet(ws.PlanetID)
	if planet == nil {
		return ""
	}
	return planet.SystemID
}

// chargeLaunchEnergy deducts the per-launch energy cost from the owner's
// reserve. Callers have already verified the reserve covers the cost.
func chargeLaunchEnergy(player *model.PlayerState, energyPerLaunch int) {
	if player == nil || energyPerLaunch <= 0 {
		return
	}
	player.Resources.Energy -= energyPerLaunch
	if player.Resources.Energy < 0 {
		player.Resources.Energy = 0
	}
}

func (gc *GameCore) autoLaunchSolarSail(ws *model.WorldState, b *model.Building, player *model.PlayerState, lm *model.LaunchModule) *model.GameEvent {
	if b.Storage == nil {
		return nil
	}
	if b.Storage.OutputQuantity(model.ItemSolarSail) < 1 {
		return nil
	}
	provided, _, err := b.Storage.Provide(model.ItemSolarSail, 1)
	if err != nil || provided != 1 {
		return nil
	}
	chargeLaunchEnergy(player, lm.EnergyPerLaunch)

	orbitRadius := 1.0
	if orbitRadius < lm.OrbitRadiusMin {
		orbitRadius = lm.OrbitRadiusMin
	}
	if lm.OrbitRadiusMax > 0 && orbitRadius > lm.OrbitRadiusMax {
		orbitRadius = lm.OrbitRadiusMax
	}

	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	sail := LaunchSolarSail(gc.spaceRuntime, b.OwnerID, gc.launchSystemID(ws), orbitRadius, 0, ws.Tick)
	if sail == nil {
		return nil
	}
	return &model.GameEvent{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: b.OwnerID,
		Payload: map[string]any{
			"entity_type": "solar_sail",
			"entity_id":   sail.ID,
			"sail":        sail,
			"building_id": b.ID,
			"auto":        true,
		},
	}
}

func (gc *GameCore) autoLaunchRocket(ws *model.WorldState, b *model.Building, player *model.PlayerState, lm *model.LaunchModule) *model.GameEvent {
	if b.Storage == nil {
		return nil
	}
	rocketItemID := lm.RocketItemID
	if rocketItemID == "" {
		rocketItemID = model.ItemSmallCarrierRocket
	}
	if b.Storage.OutputQuantity(rocketItemID) < 1 {
		return nil
	}
	systemID := gc.launchSystemID(ws)
	if gc.maps != nil {
		if _, ok := gc.maps.System(systemID); !ok {
			return nil
		}
	}
	state := GetDysonSphereState(gc.spaceRuntime, b.OwnerID, systemID)
	if state == nil {
		return nil
	}
	layerIndex := -1
	for i := range state.Layers {
		if hasDysonScaffold(state.Layers[i]) {
			layerIndex = i
			break
		}
	}
	if layerIndex < 0 {
		return nil
	}

	provided, _, err := b.Storage.Provide(rocketItemID, 1)
	if err != nil || provided != 1 {
		return nil
	}
	chargeLaunchEnergy(player, lm.EnergyPerLaunch)

	layer := &state.Layers[layerIndex]
	layer.RocketLaunches++
	layer.ConstructionBonus = math.Min(0.5, float64(layer.RocketLaunches)*0.02)
	applyRocketCoverage(layer, 1)
	state.CalculateTotalEnergy(dysonStressParams)

	return &model.GameEvent{
		EventType:       model.EvtRocketLaunched,
		VisibilityScope: b.OwnerID,
		Payload: map[string]any{
			"building_id":         b.ID,
			"system_id":           systemID,
			"layer_index":         layerIndex,
			"count":               1,
			"rocket_launches":     layer.RocketLaunches,
			"construction_bonus":  layer.ConstructionBonus,
			"layer_energy_output": layer.EnergyOutput,
			"auto":                true,
		},
	}
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
