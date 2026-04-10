package gamecore

import (
	"fmt"
	"math"

	"siliconworld/internal/model"
)

// Dyson sphere module - handles Dyson sphere structure settlement per tick

var dysonStressParams = model.DefaultDysonStressParams()

// GetDysonSphereState returns the Dyson sphere state for one player in one system.
func GetDysonSphereState(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string) *model.DysonSphereState {
	return model.GetDysonSphereState(spaceRuntime, playerID, systemID)
}

// GetOrCreateDysonSphereState returns existing or creates new Dyson sphere state
func GetOrCreateDysonSphereState(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string) *model.DysonSphereState {
	return model.EnsureDysonSphereState(spaceRuntime, playerID, systemID)
}

// AddDysonLayer adds a new layer to player's Dyson sphere
func AddDysonLayer(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, layerIndex int, orbitRadius float64) *model.DysonSphereState {
	state := GetOrCreateDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return nil
	}
	state.AddLayer(layerIndex, orbitRadius)
	return state
}

// AddDysonNode adds a node to a Dyson sphere layer
func AddDysonNode(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, layerIndex int, latitude, longitude float64) (*model.DysonNode, error) {
	state := GetOrCreateDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return nil, nil
	}
	if layerIndex < 0 || layerIndex >= len(state.Layers) {
		return nil, nil
	}

	layer := &state.Layers[layerIndex]
	nodeID := fmt.Sprintf("%s-node-l%d-lat%s-lon%s", state.PlayerID, layerIndex, formatDysonCoord(latitude), formatDysonCoord(longitude))
	node := model.DysonNode{
		ID:           nodeID,
		LayerIndex:   layerIndex,
		Latitude:     latitude,
		Longitude:    longitude,
		EnergyOutput: 10,
		Integrity:    1.0,
		Built:        true,
	}
	layer.Nodes = append(layer.Nodes, node)
	return &node, nil
}

// AddDysonFrame adds a frame connecting two nodes
func AddDysonFrame(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, layerIndex int, nodeAID, nodeBID string) (*model.DysonFrame, error) {
	state := GetOrCreateDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return nil, nil
	}
	if layerIndex < 0 || layerIndex >= len(state.Layers) {
		return nil, nil
	}

	layer := &state.Layers[layerIndex]
	// Verify both nodes exist
	nodeA := layer.FindNodeByID(nodeAID)
	nodeB := layer.FindNodeByID(nodeBID)
	if nodeA == nil || nodeB == nil {
		return nil, nil
	}

	frameID := fmt.Sprintf("%s-frame-l%d-%s-%s", state.PlayerID, layerIndex, nodeAID, nodeBID)
	frame := model.DysonFrame{
		ID:         frameID,
		LayerIndex: layerIndex,
		NodeAID:    nodeAID,
		NodeBID:    nodeBID,
		Integrity:  1.0,
		Built:      true,
	}
	layer.Frames = append(layer.Frames, frame)
	return &frame, nil
}

// AddDysonShell adds a shell segment to a layer
func AddDysonShell(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string, layerIndex int, latMin, latMax, coverage float64) (*model.DysonShell, error) {
	state := GetOrCreateDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return nil, nil
	}
	if layerIndex < 0 || layerIndex >= len(state.Layers) {
		return nil, nil
	}

	layer := &state.Layers[layerIndex]
	shellID := fmt.Sprintf("%s-shell-l%d-lat%s-lat%s", state.PlayerID, layerIndex, formatDysonCoord(latMin), formatDysonCoord(latMax))
	shell := model.DysonShell{
		ID:           shellID,
		LayerIndex:   layerIndex,
		LatitudeMin:  latMin,
		LatitudeMax:  latMax,
		Coverage:     coverage,
		EnergyOutput: int(coverage * 1000),
		Integrity:    1.0,
		Built:        true,
	}
	layer.Shells = append(layer.Shells, shell)
	return &shell, nil
}

// DemolishDysonComponent removes a Dyson sphere component and returns refund info
func DemolishDysonComponent(spaceRuntime *model.SpaceRuntimeState, playerID, systemID, componentType, componentID string) (map[string]int, error) {
	state := GetDysonSphereState(spaceRuntime, playerID, systemID)
	if state == nil {
		return nil, nil
	}

	refunds := make(map[string]int)

	for li := range state.Layers {
		layer := &state.Layers[li]

		switch componentType {
		case "node":
			for i := range layer.Nodes {
				if layer.Nodes[i].ID == componentID {
					refunds["node_material"] = 10 // simplified refund
					layer.Nodes = append(layer.Nodes[:i], layer.Nodes[i+1:]...)
					return refunds, nil
				}
			}
		case "frame":
			for i := range layer.Frames {
				if layer.Frames[i].ID == componentID {
					refunds["frame_material"] = 20
					layer.Frames = append(layer.Frames[:i], layer.Frames[i+1:]...)
					return refunds, nil
				}
			}
		case "shell":
			for i := range layer.Shells {
				if layer.Shells[i].ID == componentID {
					refunds["shell_material"] = int(float64(layer.Shells[i].Coverage) * 50)
					layer.Shells = append(layer.Shells[:i], layer.Shells[i+1:]...)
					return refunds, nil
				}
			}
		}
	}

	return refunds, nil
}

// settleDysonSpheres processes all Dyson sphere states per tick
func settleDysonSpheres(spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}
	var events []*model.GameEvent

	for playerID, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for systemID, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil || systemRuntime.DysonSphere == nil {
				continue
			}
			sphere := systemRuntime.DysonSphere

			// Recalculate total energy
			sphere.CalculateTotalEnergy(dysonStressParams)

			// Generate event for energy update
			if currentTick%100 == 0 { // Only emit every 100 ticks to reduce noise
				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityUpdated,
					VisibilityScope: playerID,
					Payload: map[string]any{
						"entity_type":  "dyson_sphere",
						"player_id":    playerID,
						"system_id":    systemID,
						"total_energy": sphere.TotalEnergy,
					},
				})
			}
		}
	}

	return events
}

// GetDysonSphereEnergy returns total energy from one player's Dyson sphere in one system.
func GetDysonSphereEnergy(spaceRuntime *model.SpaceRuntimeState, playerID, systemID string) int {
	sphere := GetDysonSphereState(spaceRuntime, playerID, systemID)
	if sphere == nil {
		return 0
	}
	return sphere.TotalEnergy
}

// ClearDysonSphereStates remains for backward-compatible tests; Dyson sphere state is now per space runtime.
func ClearDysonSphereStates() {}

func formatDysonCoord(value float64) string {
	scaled := int(math.Round(value * 100))
	if scaled < 0 {
		return fmt.Sprintf("m%d", -scaled)
	}
	return fmt.Sprintf("p%d", scaled)
}
