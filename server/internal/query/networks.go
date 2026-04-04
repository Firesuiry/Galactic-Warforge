package query

import (
	"sort"

	"siliconworld/internal/model"
)

// PlanetNetworksView exposes network topology and allocation read models.
type PlanetNetworksView struct {
	PlanetID          string                 `json:"planet_id"`
	Discovered        bool                   `json:"discovered"`
	Available         bool                   `json:"available"`
	ActivePlanetID    string                 `json:"active_planet_id,omitempty"`
	Tick              int64                  `json:"tick"`
	PowerNetworks     []PowerNetworkView     `json:"power_networks,omitempty"`
	PowerNodes        []PowerNodeView        `json:"power_nodes,omitempty"`
	PowerLinks        []PowerLinkView        `json:"power_links,omitempty"`
	PowerCoverage     []PowerCoverageView    `json:"power_coverage,omitempty"`
	PipelineNodes     []PipelineNodeView     `json:"pipeline_nodes,omitempty"`
	PipelineSegments  []PipelineSegmentView  `json:"pipeline_segments,omitempty"`
	PipelineEndpoints []PipelineEndpointView `json:"pipeline_endpoints,omitempty"`
}

type PowerNetworkView struct {
	ID        string   `json:"id"`
	OwnerID   string   `json:"owner_id"`
	Supply    int      `json:"supply"`
	Demand    int      `json:"demand"`
	Allocated int      `json:"allocated"`
	Net       int      `json:"net"`
	Shortage  bool     `json:"shortage"`
	NodeIDs   []string `json:"node_ids,omitempty"`
}

type PowerNodeView struct {
	BuildingID   string               `json:"building_id"`
	OwnerID      string               `json:"owner_id"`
	BuildingType model.BuildingType   `json:"building_type"`
	Position     model.Position       `json:"position"`
	NetworkID    string               `json:"network_id,omitempty"`
	Connectors   []PowerConnectorView `json:"connectors,omitempty"`
}

type PowerConnectorView struct {
	BuildingID string                   `json:"building_id"`
	Position   model.Position           `json:"position"`
	Kind       model.PowerConnectorKind `json:"kind"`
	Range      int                      `json:"range"`
	Capacity   int                      `json:"capacity"`
}

type PowerLinkView struct {
	FromBuildingID string                  `json:"from_building_id"`
	ToBuildingID   string                  `json:"to_building_id"`
	Kind           model.PowerGridLinkKind `json:"kind"`
	Distance       int                     `json:"distance"`
	FromPosition   model.Position          `json:"from_position"`
	ToPosition     model.Position          `json:"to_position"`
}

type PowerCoverageView struct {
	BuildingID   string                           `json:"building_id"`
	OwnerID      string                           `json:"owner_id"`
	BuildingType model.BuildingType               `json:"building_type"`
	Position     model.Position                   `json:"position"`
	Connected    bool                             `json:"connected"`
	Reason       model.PowerCoverageFailureReason `json:"reason,omitempty"`
	ProviderID   string                           `json:"provider_id,omitempty"`
	NetworkID    string                           `json:"network_id,omitempty"`
	Demand       int                              `json:"demand,omitempty"`
	Allocated    int                              `json:"allocated,omitempty"`
	Ratio        float64                          `json:"ratio,omitempty"`
	Priority     int                              `json:"priority,omitempty"`
}

type PipelineNodeView struct {
	ID       string         `json:"id"`
	Position model.Position `json:"position"`
	Buffer   int            `json:"buffer"`
	Pressure int            `json:"pressure"`
	FluidID  string         `json:"fluid_id,omitempty"`
}

type PipelineSegmentView struct {
	ID           string         `json:"id"`
	FromNodeID   string         `json:"from_node_id"`
	ToNodeID     string         `json:"to_node_id"`
	FromPosition model.Position `json:"from_position"`
	ToPosition   model.Position `json:"to_position"`
	FlowRate     int            `json:"flow_rate"`
	Pressure     int            `json:"pressure"`
	Capacity     int            `json:"capacity"`
	Attenuation  float64        `json:"attenuation,omitempty"`
	CurrentFlow  int            `json:"current_flow"`
	Buffer       int            `json:"buffer"`
	FluidID      string         `json:"fluid_id,omitempty"`
}

type PipelineEndpointView struct {
	ID           string              `json:"id"`
	NodeID       string              `json:"node_id"`
	BuildingID   string              `json:"building_id"`
	OwnerID      string              `json:"owner_id"`
	PortID       string              `json:"port_id"`
	Direction    model.PortDirection `json:"direction"`
	Position     model.Position      `json:"position"`
	Capacity     int                 `json:"capacity"`
	AllowedItems []string            `json:"allowed_items,omitempty"`
}

// PlanetNetworks returns network topology and power allocation views for a loaded planet runtime.
func (ql *Layer) PlanetNetworks(ws *model.WorldState, playerID, planetID, activePlanetID string) (*PlanetNetworksView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	_ = planet
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetNetworksView{
		PlanetID:       planetID,
		Discovered:     discovered,
		ActivePlanetID: activePlanetID,
	}
	if !discovered || ws == nil {
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()

	view.Tick = ws.Tick
	if ws.PlanetID != planetID {
		return view, true
	}
	view.Available = true

	grid := ws.PowerGrid
	if grid == nil {
		grid = model.BuildPowerGridGraph(ws)
	}
	coverage := model.ResolvePowerCoverage(ws)
	allocations := model.ResolvePowerAllocations(ws, coverage)
	networks := model.ResolvePowerNetworks(ws)
	view.PowerNetworks = collectPowerNetworks(networks, allocations, playerID)
	view.PowerNodes = collectPowerNodes(ws, grid, networks, playerID)
	view.PowerLinks = collectPowerLinks(ws, grid, playerID)
	view.PowerCoverage = collectPowerCoverage(ws, coverage, allocations, playerID)
	view.PipelineNodes, view.PipelineSegments, view.PipelineEndpoints = collectPipelineViews(ws, playerID)

	return view, true
}

func collectPowerNetworks(
	networks model.PowerNetworkState,
	allocations model.PowerAllocationState,
	playerID string,
) []PowerNetworkView {
	if len(networks.Networks) == 0 {
		return []PowerNetworkView{}
	}
	ids := make([]string, 0, len(networks.Networks))
	for id, network := range networks.Networks {
		if network == nil || network.OwnerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]PowerNetworkView, 0, len(ids))
	for _, id := range ids {
		network := networks.Networks[id]
		if network == nil {
			continue
		}
		allocation := allocations.Networks[id]
		allocated := 0
		shortage := network.Net < 0
		if allocation != nil {
			allocated = allocation.Allocated
			shortage = allocation.Shortage
		}
		nodeIDs := append([]string(nil), network.NodeIDs...)
		sort.Strings(nodeIDs)
		out = append(out, PowerNetworkView{
			ID:        network.ID,
			OwnerID:   network.OwnerID,
			Supply:    network.Supply,
			Demand:    network.Demand,
			Allocated: allocated,
			Net:       network.Net,
			Shortage:  shortage,
			NodeIDs:   nodeIDs,
		})
	}
	return out
}

func collectPowerNodes(ws *model.WorldState, grid *model.PowerGridGraph, networks model.PowerNetworkState, playerID string) []PowerNodeView {
	if ws == nil || grid == nil || len(grid.Nodes) == 0 {
		return []PowerNodeView{}
	}
	ids := make([]string, 0, len(grid.Nodes))
	for id, node := range grid.Nodes {
		if node == nil || node.OwnerID != playerID {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]PowerNodeView, 0, len(ids))
	for _, id := range ids {
		node := grid.Nodes[id]
		building := ws.Buildings[id]
		if node == nil || building == nil {
			continue
		}
		connectors := make([]PowerConnectorView, 0, len(node.Connectors))
		for _, connector := range node.Connectors {
			connectors = append(connectors, PowerConnectorView{
				BuildingID: connector.BuildingID,
				Position:   connector.Position,
				Kind:       connector.Kind,
				Range:      connector.Range,
				Capacity:   connector.Capacity,
			})
		}
		out = append(out, PowerNodeView{
			BuildingID:   id,
			OwnerID:      node.OwnerID,
			BuildingType: building.Type,
			Position:     node.Position,
			NetworkID:    networks.BuildingNetwork[id],
			Connectors:   connectors,
		})
	}
	return out
}

func collectPowerLinks(ws *model.WorldState, grid *model.PowerGridGraph, playerID string) []PowerLinkView {
	if ws == nil || grid == nil || len(grid.Edges) == 0 {
		return []PowerLinkView{}
	}
	seen := make(map[string]struct{})
	out := make([]PowerLinkView, 0)
	for fromID, edges := range grid.Edges {
		fromNode := grid.Nodes[fromID]
		fromBuilding := ws.Buildings[fromID]
		if fromNode == nil || fromBuilding == nil || fromNode.OwnerID != playerID {
			continue
		}
		for toID, edge := range edges {
			toNode := grid.Nodes[toID]
			toBuilding := ws.Buildings[toID]
			if toNode == nil || toBuilding == nil || toNode.OwnerID != playerID {
				continue
			}
			key := fromID + "->" + toID
			revKey := toID + "->" + fromID
			if _, ok := seen[key]; ok {
				continue
			}
			if _, ok := seen[revKey]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, PowerLinkView{
				FromBuildingID: fromID,
				ToBuildingID:   toID,
				Kind:           edge.Kind,
				Distance:       edge.Distance,
				FromPosition:   fromBuilding.Position,
				ToPosition:     toBuilding.Position,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].FromBuildingID != out[j].FromBuildingID {
			return out[i].FromBuildingID < out[j].FromBuildingID
		}
		return out[i].ToBuildingID < out[j].ToBuildingID
	})
	return out
}

func collectPowerCoverage(
	ws *model.WorldState,
	coverage map[string]model.PowerCoverageResult,
	allocations model.PowerAllocationState,
	playerID string,
) []PowerCoverageView {
	if ws == nil {
		return []PowerCoverageView{}
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building == nil || building.OwnerID != playerID {
			continue
		}
		if !powerRelevantBuilding(building) {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]PowerCoverageView, 0, len(ids))
	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil {
			continue
		}
		cov := coverage[id]
		alloc := allocations.Buildings[id]
		out = append(out, PowerCoverageView{
			BuildingID:   id,
			OwnerID:      building.OwnerID,
			BuildingType: building.Type,
			Position:     building.Position,
			Connected:    cov.Connected,
			Reason:       cov.Reason,
			ProviderID:   cov.ProviderID,
			NetworkID:    alloc.NetworkID,
			Demand:       alloc.Demand,
			Allocated:    alloc.Allocated,
			Ratio:        alloc.Ratio,
			Priority:     alloc.Priority,
		})
	}
	return out
}

func collectPipelineViews(ws *model.WorldState, playerID string) ([]PipelineNodeView, []PipelineSegmentView, []PipelineEndpointView) {
	if ws == nil || ws.Pipelines == nil {
		return []PipelineNodeView{}, []PipelineSegmentView{}, []PipelineEndpointView{}
	}
	endpoints := model.PipelineEndpointsFromWorld(ws, func(building *model.Building, port model.IOPort) bool {
		return building != nil && building.OwnerID == playerID && isFluidPipelinePort(port)
	})
	graph := model.BuildPipelineGraph(ws.Pipelines, endpoints)
	if graph == nil {
		return []PipelineNodeView{}, []PipelineSegmentView{}, []PipelineEndpointView{}
	}
	nodeSet := reachablePipelineNodeSet(graph, endpoints)
	nodeIDs := sortedNodeIDs(nodeSet)
	segmentIDs := sortedPipelineSegmentIDs(ws.Pipelines, nodeSet)

	nodeViews := make([]PipelineNodeView, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		node := ws.Pipelines.Nodes[id]
		if node == nil {
			continue
		}
		nodeViews = append(nodeViews, PipelineNodeView{
			ID:       node.ID,
			Position: node.Position,
			Buffer:   node.State.Buffer,
			Pressure: node.State.Pressure,
			FluidID:  node.State.FluidID,
		})
	}

	segmentViews := make([]PipelineSegmentView, 0, len(segmentIDs))
	for _, id := range segmentIDs {
		segment := ws.Pipelines.Segments[id]
		if segment == nil {
			continue
		}
		fromNode := ws.Pipelines.Nodes[segment.From]
		toNode := ws.Pipelines.Nodes[segment.To]
		if fromNode == nil || toNode == nil {
			continue
		}
		segmentViews = append(segmentViews, PipelineSegmentView{
			ID:           segment.ID,
			FromNodeID:   segment.From,
			ToNodeID:     segment.To,
			FromPosition: fromNode.Position,
			ToPosition:   toNode.Position,
			FlowRate:     segment.Params.FlowRate,
			Pressure:     segment.Params.Pressure,
			Capacity:     segment.Params.Capacity,
			Attenuation:  segment.Params.Attenuation,
			CurrentFlow:  segment.State.CurrentFlow,
			Buffer:       segment.State.Buffer,
			FluidID:      segment.State.FluidID,
		})
	}

	sort.Slice(endpoints, func(i, j int) bool {
		return endpoints[i].ID < endpoints[j].ID
	})
	endpointViews := make([]PipelineEndpointView, 0, len(endpoints))
	for _, endpoint := range endpoints {
		nodeID, ok := graph.EndpointNode(endpoint.ID)
		if !ok {
			continue
		}
		endpointViews = append(endpointViews, PipelineEndpointView{
			ID:           endpoint.ID,
			NodeID:       nodeID,
			BuildingID:   endpoint.BuildingID,
			OwnerID:      endpoint.OwnerID,
			PortID:       endpoint.PortID,
			Direction:    endpoint.Direction,
			Position:     endpoint.Position,
			Capacity:     endpoint.Capacity,
			AllowedItems: append([]string(nil), endpoint.AllowedItems...),
		})
	}

	return nodeViews, segmentViews, endpointViews
}

func powerRelevantBuilding(building *model.Building) bool {
	if building == nil {
		return false
	}
	if building.Runtime.Params.EnergyConsume > 0 || building.Runtime.Params.EnergyGenerate > 0 {
		return true
	}
	if building.Runtime.Params.MaintenanceCost.Energy > 0 {
		return true
	}
	if building.Runtime.Functions.Energy != nil {
		return true
	}
	return building.Runtime.Functions.EnergyStorage != nil
}

func isFluidPipelinePort(port model.IOPort) bool {
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

func reachablePipelineNodeSet(graph *model.PipelineGraph, endpoints []model.PipelineEndpoint) map[string]struct{} {
	nodeSet := make(map[string]struct{})
	if graph == nil {
		return nodeSet
	}
	queue := make([]string, 0, len(endpoints))
	for _, endpoint := range endpoints {
		nodeID, ok := graph.EndpointNode(endpoint.ID)
		if !ok {
			continue
		}
		if _, seen := nodeSet[nodeID]; seen {
			continue
		}
		nodeSet[nodeID] = struct{}{}
		queue = append(queue, nodeID)
	}
	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		for _, neighbor := range graph.Adjacent(nodeID) {
			if _, seen := nodeSet[neighbor]; seen {
				continue
			}
			nodeSet[neighbor] = struct{}{}
			queue = append(queue, neighbor)
		}
	}
	return nodeSet
}

func sortedNodeIDs(nodeSet map[string]struct{}) []string {
	ids := make([]string, 0, len(nodeSet))
	for id := range nodeSet {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func sortedPipelineSegmentIDs(state *model.PipelineNetworkState, nodeSet map[string]struct{}) []string {
	if state == nil || len(state.Segments) == 0 {
		return []string{}
	}
	ids := make([]string, 0, len(state.Segments))
	for id, segment := range state.Segments {
		if segment == nil {
			continue
		}
		if _, ok := nodeSet[segment.From]; !ok {
			continue
		}
		if _, ok := nodeSet[segment.To]; !ok {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
