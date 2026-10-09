package gamecore

import (
	"fmt"
	"math/rand"

	"siliconworld/internal/model"
)

// dysonLayerRef 是戴森结构命令共用的层定位字段。
type dysonLayerRef struct {
	SystemID    string  `json:"system_id" payload:"required"`
	LayerIndex  int     `json:"layer_index" payload:"required"`
	OrbitRadius float64 `json:"orbit_radius"`
}

type buildDysonNodePayload struct {
	dysonLayerRef
	Latitude  float64 `json:"latitude" payload:"required"`
	Longitude float64 `json:"longitude" payload:"required"`
}

type buildDysonFramePayload struct {
	dysonLayerRef
	NodeAID string `json:"node_a_id" payload:"required"`
	NodeBID string `json:"node_b_id" payload:"required"`
}

type buildDysonShellPayload struct {
	dysonLayerRef
	LatitudeMin float64 `json:"latitude_min" payload:"required"`
	LatitudeMax float64 `json:"latitude_max" payload:"required"`
	Coverage    float64 `json:"coverage" payload:"required"`
}

type demolishDysonPayload struct {
	SystemID      string `json:"system_id" payload:"required"`
	ComponentType string `json:"component_type" payload:"required"`
	ComponentID   string `json:"component_id" payload:"required"`
}

func (gc *GameCore) execBuildDysonNode(ws *model.WorldState, playerID string, cmd model.Command, p buildDysonNodePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius := p.SystemID, p.LayerIndex, p.OrbitRadius
	latitude, longitude := p.Latitude, p.Longitude

	ensureDysonLayer(gc.spaceRuntime, playerID, systemID, layerIndex, orbitRadius)
	node, err := AddDysonNode(gc.spaceRuntime, playerID, systemID, layerIndex, latitude, longitude)
	if err != nil || node == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "建造戴森节点失败"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "已建造戴森节点"
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "dyson_node",
			"entity_id":   node.ID,
			"system_id":   systemID,
			"layer_index": layerIndex,
			"node":        node,
		},
	}}
}

func (gc *GameCore) execBuildDysonFrame(ws *model.WorldState, playerID string, cmd model.Command, p buildDysonFramePayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius := p.SystemID, p.LayerIndex, p.OrbitRadius
	nodeAID, nodeBID := p.NodeAID, p.NodeBID

	ensureDysonLayer(gc.spaceRuntime, playerID, systemID, layerIndex, orbitRadius)
	frame, err := AddDysonFrame(gc.spaceRuntime, playerID, systemID, layerIndex, nodeAID, nodeBID)
	if err != nil || frame == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "建造戴森框架失败"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "已建造戴森框架"
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "dyson_frame",
			"entity_id":   frame.ID,
			"system_id":   systemID,
			"layer_index": layerIndex,
			"frame":       frame,
		},
	}}
}

func (gc *GameCore) execBuildDysonShell(ws *model.WorldState, playerID string, cmd model.Command, p buildDysonShellPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius := p.SystemID, p.LayerIndex, p.OrbitRadius
	latitudeMin, latitudeMax, coverage := p.LatitudeMin, p.LatitudeMax, p.Coverage

	ensureDysonLayer(gc.spaceRuntime, playerID, systemID, layerIndex, orbitRadius)
	shell, err := AddDysonShell(gc.spaceRuntime, playerID, systemID, layerIndex, latitudeMin, latitudeMax, coverage)
	if err != nil || shell == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "建造戴森壳失败"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "已建造戴森壳"
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityCreated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "dyson_shell",
			"entity_id":   shell.ID,
			"system_id":   systemID,
			"layer_index": layerIndex,
			"shell":       shell,
		},
	}}
}

func (gc *GameCore) execDemolishDyson(ws *model.WorldState, playerID string, cmd model.Command, p demolishDysonPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	systemID, componentType, componentID := p.SystemID, p.ComponentType, p.ComponentID

	refunds, err := DemolishDysonComponent(gc.spaceRuntime, playerID, systemID, componentType, componentID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if len(refunds) == 0 {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("未找到戴森组件 %s", componentID)
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = "已拆除戴森组件"
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_kind":    "dyson_component",
			"entity_type":    "dyson_" + componentType,
			"entity_id":      componentID,
			"system_id":      systemID,
			"refunds":        refunds,
			"component_type": componentType,
		},
	}}
}

func ensureDysonLayer(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, layerIndex int, orbitRadius float64) {
	state := GetOrCreateDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return
	}
	for len(state.Layers) <= layerIndex {
		index := len(state.Layers)
		radius := orbitRadius
		if radius <= 0 {
			radius = 1.0 + float64(index)*0.5
		}
		state.AddLayer(index, radius)
	}
}

func requireDysonTech(ws *model.WorldState, playerID, unlockID string) error {
	player := ws.Players[playerID]
	if CanBuildTech(player, model.TechUnlockSpecial, unlockID) {
		return nil
	}
	return fmt.Errorf("戴森结构需先研究解锁：%s", unlockID)
}

type launchSolarSailPayload struct {
	buildingRef
	Count       int     `json:"count"`
	OrbitRadius float64 `json:"orbit_radius"`
	Inclination float64 `json:"inclination"`
}

// execLaunchSolarSail handles the "launch_solar_sail" command.
//
//	Payload: {
//	  "building_id": "id of EM rail ejector or vertical launching silo",
//	  "orbit_radius": 1.0,  // optional, default 1.0 AU
//	  "inclination": 0.0,   // optional, default 0.0 degrees
//	}
func (gc *GameCore) execLaunchSolarSail(ws *model.WorldState, playerID string, cmd model.Command, p launchSolarSailPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	bid := p.BuildingID

	building, ok := ws.Buildings[bid]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到建筑（可能已被拆除）"
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能使用其他玩家的建筑"
		return res, nil
	}

	// Solar sails are launched by the EM Rail Ejector. Vertical silos are reserved for rockets.
	if building.Type != model.BuildingTypeEMRailEjector {
		res.Code = model.CodeInvalidTarget
		res.Message = "只有电磁轨道弹射器可以发射太阳帆"
		return res, nil
	}

	// Check building is running
	if building.Runtime.State != model.BuildingWorkRunning {
		res.Code = model.CodeValidationFailed
		res.Message = "建筑未在运行"
		return res, nil
	}

	// Check player has solar sails
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "玩家不存在或已阵亡"
		return res, nil
	}

	sailCount := min(max(p.Count, 1), 10) // default 1, cap at 10 per launch

	// Check launch building has enough loaded solar sails.
	if building.Storage == nil {
		res.Code = model.CodeInsufficientResource
		res.Message = "发射建筑没有太阳帆存储"
		return res, nil
	}
	loadedSails := building.Storage.OutputQuantity(model.ItemSolarSail)
	if loadedSails < sailCount {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("需装填 %d 张太阳帆，当前 %d 张", sailCount, loadedSails)
		return res, nil
	}

	// Get orbit parameters
	orbitRadius := 1.0
	if p.OrbitRadius > 0 {
		orbitRadius = p.OrbitRadius
	}
	inclination := p.Inclination

	// Validate orbit parameters against building's launch constraints
	if building.Runtime.Functions.Launch != nil {
		lm := building.Runtime.Functions.Launch
		if orbitRadius < lm.OrbitRadiusMin {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("orbit_radius %.2f 低于最小值 %.2f", orbitRadius, lm.OrbitRadiusMin)
			return res, nil
		}
		if orbitRadius > lm.OrbitRadiusMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("orbit_radius %.2f 超过最大值 %.2f", orbitRadius, lm.OrbitRadiusMax)
			return res, nil
		}
		if inclination < -lm.InclinationMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("inclination %.2f 低于最小值 %.2f", inclination, -lm.InclinationMax)
			return res, nil
		}
		if inclination > lm.InclinationMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("inclination %.2f 超过最大值 %.2f", inclination, lm.InclinationMax)
			return res, nil
		}
	}

	// Check launch success rate
	launchSuccessRate := 1.0
	if building.Runtime.Functions.Launch != nil {
		launchSuccessRate = building.Runtime.Functions.Launch.SuccessRate
	}
	if rand.Float64() > launchSuccessRate {
		// Launch failed, consume sails but no orbit entry
		provided, _, err := building.Storage.Provide(model.ItemSolarSail, sailCount)
		if err != nil || provided != sailCount {
			res.Code = model.CodeInsufficientResource
			res.Message = "消耗已装填的太阳帆失败"
			return res, nil
		}
		res.Status = model.StatusFailed
		res.Code = model.CodeValidationFailed
		res.Message = "设备故障，发射失败"
		return res, nil
	}

	// Consume solar sails from the ejector's local storage.
	provided, _, err := building.Storage.Provide(model.ItemSolarSail, sailCount)
	if err != nil || provided != sailCount {
		res.Code = model.CodeInsufficientResource
		res.Message = "消耗已装填的太阳帆失败"
		return res, nil
	}

	// Get system ID from maps
	systemID := ""
	if gc.maps != nil {
		planet, _ := gc.maps.Planet(ws.PlanetID)
		if planet != nil {
			systemID = planet.SystemID
		}
	}

	// Launch solar sails
	var events []*model.GameEvent
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	for i := 0; i < sailCount; i++ {
		sail := LaunchSolarSail(gc.spaceRuntime, playerID, systemID, orbitRadius, inclination, ws.Tick)
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "solar_sail",
				"entity_id":   sail.ID,
				"sail":        sail,
			},
		})
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("已发射 %d 张太阳帆入轨", sailCount)
	return res, events
}
