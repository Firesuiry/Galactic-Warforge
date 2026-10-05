package gamecore

import (
	"fmt"

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
		res.Message = "failed to build dyson node"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("dyson node %s built", node.ID)
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
		res.Message = "failed to build dyson frame"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("dyson frame %s built", frame.ID)
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
		res.Message = "failed to build dyson shell"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("dyson shell %s built", shell.ID)
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
		res.Message = fmt.Sprintf("dyson component %s not found", componentID)
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("dyson component %s demolished", componentID)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: playerID,
		Payload: map[string]any{
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
	return fmt.Errorf("dyson structure requires research unlock: %s", unlockID)
}
