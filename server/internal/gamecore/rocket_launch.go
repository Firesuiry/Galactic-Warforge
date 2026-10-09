package gamecore

import (
	"fmt"
	"hash/fnv"
	"math"
	"sort"

	"siliconworld/internal/model"
)

type launchRocketPayload struct {
	buildingRef
	SystemID   string `json:"system_id" payload:"required"`
	LayerIndex int    `json:"layer_index"`
	Count      int    `json:"count"`
}

func (gc *GameCore) execLaunchRocket(ws *model.WorldState, playerID string, cmd model.Command, p launchRocketPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, systemID, layerIndex := p.BuildingID, p.SystemID, p.LayerIndex
	count := min(max(p.Count, 1), 5)

	building, ok := ws.Buildings[buildingID]
	if !ok || building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到建筑（可能已被拆除）"
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能使用其他玩家的建筑"
		return res, nil
	}
	if building.Type != model.BuildingTypeVerticalLaunchingSilo {
		res.Code = model.CodeInvalidTarget
		res.Message = "只有 vertical_launching_silo 可以发射火箭"
		return res, nil
	}
	if building.Runtime.State != model.BuildingWorkRunning {
		res.Code = model.CodeValidationFailed
		res.Message = "建筑未在运行"
		return res, nil
	}
	if building.Storage == nil {
		res.Code = model.CodeInsufficientResource
		res.Message = "发射建筑没有火箭存储"
		return res, nil
	}
	loadedRockets := building.Storage.OutputQuantity(model.ItemSmallCarrierRocket)
	if loadedRockets < count {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("需装填 %d 枚 small_carrier_rocket，当前 %d 枚", count, loadedRockets)
		return res, nil
	}
	if gc.maps != nil {
		if _, ok := gc.maps.System(systemID); !ok {
			res.Code = model.CodeInvalidTarget
			res.Message = fmt.Sprintf("未找到星系 %s", systemID)
			return res, nil
		}
	}

	state := GetDysonSphereState(gc.spaceRuntime, playerID, systemID)
	if state == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("未找到戴森层 %d（星系 %s）", layerIndex, systemID)
		return res, nil
	}
	if layerIndex < 0 || layerIndex >= len(state.Layers) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("未找到戴森层 %d（星系 %s）", layerIndex, systemID)
		return res, nil
	}

	layer := &state.Layers[layerIndex]
	if !hasDysonScaffold(*layer) {
		res.Code = model.CodeValidationFailed
		res.Message = "目标戴森层至少需要一个骨架"
		return res, nil
	}

	provided, _, err := building.Storage.Provide(model.ItemSmallCarrierRocket, count)
	if err != nil || provided != count {
		res.Code = model.CodeInsufficientResource
		res.Message = "消耗已装填的火箭失败"
		return res, nil
	}

	layer.RocketLaunches += count
	layer.ConstructionBonus = math.Min(0.5, float64(layer.RocketLaunches)*0.02)
	applyRocketCoverage(layer, count)

	state.CalculateTotalEnergy(dysonStressParams)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("已发射 %d 枚火箭至戴森层 %d", count, layerIndex)
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
