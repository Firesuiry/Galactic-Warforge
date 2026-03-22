package gamecore

import (
	"fmt"
	"strconv"

	"siliconworld/internal/model"
)

func (gc *GameCore) execBuildDysonNode(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius, err := parseDysonLayerPayload(cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	latitude, err := payloadFloat(cmd.Payload, "latitude")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	longitude, err := payloadFloat(cmd.Payload, "longitude")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	ensureDysonLayer(playerID, systemID, layerIndex, orbitRadius)
	node, err := AddDysonNode(playerID, systemID, layerIndex, latitude, longitude)
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

func (gc *GameCore) execBuildDysonFrame(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius, err := parseDysonLayerPayload(cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	nodeAID, err := payloadString(cmd.Payload, "node_a_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	nodeBID, err := payloadString(cmd.Payload, "node_b_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	ensureDysonLayer(playerID, systemID, layerIndex, orbitRadius)
	frame, err := AddDysonFrame(playerID, systemID, layerIndex, nodeAID, nodeBID)
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

func (gc *GameCore) execBuildDysonShell(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	if err := requireDysonTech(ws, playerID, "dyson_component"); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	systemID, layerIndex, orbitRadius, err := parseDysonLayerPayload(cmd.Payload)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	latitudeMin, err := payloadFloat(cmd.Payload, "latitude_min")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	latitudeMax, err := payloadFloat(cmd.Payload, "latitude_max")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	coverage, err := payloadFloat(cmd.Payload, "coverage")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	ensureDysonLayer(playerID, systemID, layerIndex, orbitRadius)
	shell, err := AddDysonShell(playerID, systemID, layerIndex, latitudeMin, latitudeMax, coverage)
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

func (gc *GameCore) execDemolishDyson(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	systemID, err := payloadString(cmd.Payload, "system_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	componentType, err := payloadString(cmd.Payload, "component_type")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	componentID, err := payloadString(cmd.Payload, "component_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	refunds, err := DemolishDysonComponent(playerID, systemID, componentType, componentID)
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

func ensureDysonLayer(playerID, systemID string, layerIndex int, orbitRadius float64) {
	state := GetOrCreateDysonSphereState(playerID, systemID)
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

func parseDysonLayerPayload(payload map[string]any) (string, int, float64, error) {
	systemID, err := payloadString(payload, "system_id")
	if err != nil {
		return "", 0, 0, err
	}
	layerIndex, err := payloadInt(payload, "layer_index")
	if err != nil {
		return "", 0, 0, err
	}
	orbitRadius := 0.0
	if raw, ok := payload["orbit_radius"]; ok {
		orbitRadius, err = anyToFloat(raw)
		if err != nil {
			return "", 0, 0, fmt.Errorf("payload.orbit_radius invalid: %w", err)
		}
	}
	return systemID, layerIndex, orbitRadius, nil
}

func payloadString(payload map[string]any, key string) (string, error) {
	raw, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("payload.%s required", key)
	}
	value := fmt.Sprintf("%v", raw)
	if value == "" {
		return "", fmt.Errorf("payload.%s required", key)
	}
	return value, nil
}

func payloadInt(payload map[string]any, key string) (int, error) {
	raw, ok := payload[key]
	if !ok {
		return 0, fmt.Errorf("payload.%s required", key)
	}
	switch value := raw.(type) {
	case int:
		return value, nil
	case int32:
		return int(value), nil
	case int64:
		return int(value), nil
	case float64:
		return int(value), nil
	default:
		parsed, err := strconv.Atoi(fmt.Sprintf("%v", raw))
		if err != nil {
			return 0, fmt.Errorf("payload.%s invalid", key)
		}
		return parsed, nil
	}
}

func payloadFloat(payload map[string]any, key string) (float64, error) {
	raw, ok := payload[key]
	if !ok {
		return 0, fmt.Errorf("payload.%s required", key)
	}
	value, err := anyToFloat(raw)
	if err != nil {
		return 0, fmt.Errorf("payload.%s invalid", key)
	}
	return value, nil
}

func anyToFloat(raw any) (float64, error) {
	switch value := raw.(type) {
	case float64:
		return value, nil
	case float32:
		return float64(value), nil
	case int:
		return float64(value), nil
	case int32:
		return float64(value), nil
	case int64:
		return float64(value), nil
	default:
		return strconv.ParseFloat(fmt.Sprintf("%v", raw), 64)
	}
}
