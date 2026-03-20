package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

func settlePipelineIO(ws *model.WorldState) {
	if ws == nil || ws.Pipelines == nil {
		return
	}
	endpoints := model.PipelineEndpointsFromWorld(ws, isPipelineEndpoint)
	if len(endpoints) == 0 {
		return
	}
	graph := model.BuildPipelineGraph(ws.Pipelines, endpoints)
	if graph == nil {
		return
	}
	sort.Slice(endpoints, func(i, j int) bool {
		return endpoints[i].ID < endpoints[j].ID
	})
	for _, endpoint := range endpoints {
		if endpoint.Direction != model.PortInput && endpoint.Direction != model.PortBoth {
			continue
		}
		settlePipelineEndpointInput(ws, graph, endpoint)
	}
	for _, endpoint := range endpoints {
		if endpoint.Direction != model.PortOutput && endpoint.Direction != model.PortBoth {
			continue
		}
		settlePipelineEndpointOutput(ws, graph, endpoint)
	}
}

func isPipelineEndpoint(building *model.Building, port model.IOPort) bool {
	if building == nil {
		return false
	}
	if len(port.AllowedItems) == 0 {
		return false
	}
	for _, itemID := range port.AllowedItems {
		if !model.IsFluidItem(itemID) {
			return false
		}
	}
	return true
}

func settlePipelineEndpointInput(ws *model.WorldState, graph *model.PipelineGraph, endpoint model.PipelineEndpoint) {
	if ws == nil || ws.Pipelines == nil {
		return
	}
	building := ws.Buildings[endpoint.BuildingID]
	if building == nil || building.Storage == nil {
		return
	}
	nodeID, ok := graph.EndpointNode(endpoint.ID)
	if !ok {
		return
	}
	node := ws.Pipelines.Nodes[nodeID]
	if node == nil || node.State.Buffer <= 0 {
		return
	}
	fluidID := node.State.FluidID
	if fluidID == "" || !model.IsFluidItem(fluidID) {
		return
	}
	limit := minInt(endpointCapacity(endpoint), node.State.Buffer)
	if limit <= 0 {
		return
	}
	accepted, _, err := model.StoragePortPreviewInput(building, endpoint.PortID, fluidID, limit)
	if err != nil || accepted <= 0 {
		return
	}
	moved := pipelineNodeTake(ws.Pipelines, nodeID, accepted)
	if moved <= 0 {
		return
	}
	inserted, _, err := model.StoragePortInput(building, endpoint.PortID, fluidID, moved)
	if err != nil {
		pipelineNodeAdd(ws.Pipelines, nodeID, fluidID, moved, 0)
		return
	}
	if inserted < moved {
		pipelineNodeAdd(ws.Pipelines, nodeID, fluidID, moved-inserted, 0)
	}
}

func settlePipelineEndpointOutput(ws *model.WorldState, graph *model.PipelineGraph, endpoint model.PipelineEndpoint) {
	if ws == nil || ws.Pipelines == nil {
		return
	}
	building := ws.Buildings[endpoint.BuildingID]
	if building == nil || building.Storage == nil {
		return
	}
	nodeID, ok := graph.EndpointNode(endpoint.ID)
	if !ok {
		return
	}
	node := ws.Pipelines.Nodes[nodeID]
	if node == nil {
		return
	}
	fluidID := selectOutputFluid(building.Storage, endpoint)
	if fluidID == "" {
		return
	}
	if node.State.Buffer > 0 && node.State.FluidID != "" && node.State.FluidID != fluidID {
		return
	}
	capacity := model.PipelineNodeCapacity(ws.Pipelines, graph, nodeID)
	available := model.PipelineAvailable(capacity, node.State.Buffer)
	if available <= 0 {
		return
	}
	limit := minInt(endpointCapacity(endpoint), available)
	if limit <= 0 {
		return
	}
	outputQty := building.Storage.OutputQuantity(fluidID)
	if outputQty <= 0 {
		return
	}
	take := minInt(limit, outputQty)
	if take <= 0 {
		return
	}
	beforeOut := 0
	if building.Storage.OutputBuffer != nil {
		beforeOut = building.Storage.OutputBuffer[fluidID]
	}
	provided, _, err := model.StoragePortOutput(building, endpoint.PortID, fluidID, take)
	if err != nil || provided <= 0 {
		return
	}
	inserted := pipelineNodeAdd(ws.Pipelines, nodeID, fluidID, provided, capacity)
	if inserted < provided {
		removedFromOutput := minInt(beforeOut, provided)
		removedFromInventory := provided - removedFromOutput
		rollbackStorageOutput(building.Storage, fluidID, removedFromOutput, removedFromInventory, provided-inserted)
	}
}

func endpointCapacity(endpoint model.PipelineEndpoint) int {
	if endpoint.Capacity <= 0 {
		return maxPortCapacity
	}
	return endpoint.Capacity
}

func pipelineNodeTake(state *model.PipelineNetworkState, nodeID string, qty int) int {
	if state == nil || nodeID == "" || qty <= 0 {
		return 0
	}
	node := state.Nodes[nodeID]
	if node == nil || node.State.Buffer <= 0 {
		return 0
	}
	if qty > node.State.Buffer {
		qty = node.State.Buffer
	}
	node.State.Buffer -= qty
	if node.State.Buffer == 0 {
		node.State.FluidID = ""
	}
	return qty
}

func pipelineNodeAdd(state *model.PipelineNetworkState, nodeID, fluidID string, qty, capacity int) int {
	if state == nil || nodeID == "" || fluidID == "" || qty <= 0 {
		return 0
	}
	node := state.Nodes[nodeID]
	if node == nil {
		return 0
	}
	if node.State.FluidID != "" && node.State.FluidID != fluidID {
		return 0
	}
	if capacity > 0 {
		available := capacity - node.State.Buffer
		if available <= 0 {
			return 0
		}
		if qty > available {
			qty = available
		}
	}
	node.State.Buffer += qty
	node.State.FluidID = fluidID
	return qty
}

func selectOutputFluid(storage *model.StorageState, endpoint model.PipelineEndpoint) string {
	if storage == nil {
		return ""
	}
	if len(endpoint.AllowedItems) > 0 {
		for _, itemID := range endpoint.AllowedItems {
			if !model.IsFluidItem(itemID) {
				continue
			}
			if storage.OutputQuantity(itemID) > 0 {
				return itemID
			}
		}
		return ""
	}
	for _, itemID := range storage.OutputCandidates() {
		if !model.IsFluidItem(itemID) {
			continue
		}
		if storage.OutputQuantity(itemID) > 0 {
			return itemID
		}
	}
	return ""
}
