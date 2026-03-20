package model

import "fmt"

// PipelineEndpoint represents a building IO port attached to a pipeline network.
type PipelineEndpoint struct {
	ID           string
	BuildingID   string
	OwnerID      string
	PortID       string
	Direction    PortDirection
	Position     Position
	Capacity     int
	AllowedItems []string
}

// PipelineEndpointID returns a stable endpoint identifier.
func PipelineEndpointID(buildingID, portID string) string {
	if buildingID == "" || portID == "" {
		return ""
	}
	return buildingID + ":" + portID
}

// PipelineEndpointFilter decides whether a building IO port should become a pipeline endpoint.
type PipelineEndpointFilter func(building *Building, port IOPort) bool

// PipelineEndpointsFromWorld collects pipeline endpoints from building IO ports.
func PipelineEndpointsFromWorld(ws *WorldState, filter PipelineEndpointFilter) []PipelineEndpoint {
	if ws == nil {
		return nil
	}
	endpoints := make([]PipelineEndpoint, 0)
	for _, building := range ws.Buildings {
		if building == nil {
			continue
		}
		for _, port := range building.Runtime.Params.IOPorts {
			if filter != nil && !filter(building, port) {
				continue
			}
			pos := Position{
				X: building.Position.X + port.Offset.X,
				Y: building.Position.Y + port.Offset.Y,
				Z: building.Position.Z,
			}
			endpoint := PipelineEndpoint{
				ID:           PipelineEndpointID(building.ID, port.ID),
				BuildingID:   building.ID,
				OwnerID:      building.OwnerID,
				PortID:       port.ID,
				Direction:    port.Direction,
				Position:     pos,
				Capacity:     port.Capacity,
				AllowedItems: append([]string(nil), port.AllowedItems...),
			}
			endpoints = append(endpoints, endpoint)
		}
	}
	return endpoints
}

// PipelineGraphNode represents a topology node for pipelines.
type PipelineGraphNode struct {
	ID          string
	Position    Position
	HasPosition bool
	Endpoints   []PipelineEndpoint
}

// PipelineGraphEdge represents a directed pipeline edge.
type PipelineGraphEdge struct {
	SegmentID string
	From      string
	To        string
}

// PipelineGraph stores topology nodes/edges and endpoint ownership.
type PipelineGraph struct {
	Nodes         map[string]*PipelineGraphNode
	Edges         map[string]map[string]PipelineGraphEdge
	ReverseEdges  map[string]map[string]PipelineGraphEdge
	EndpointIndex map[string]string

	positionIndex map[string]string
}

// NewPipelineGraph creates an empty pipeline graph.
func NewPipelineGraph() *PipelineGraph {
	return &PipelineGraph{
		Nodes:         make(map[string]*PipelineGraphNode),
		Edges:         make(map[string]map[string]PipelineGraphEdge),
		ReverseEdges:  make(map[string]map[string]PipelineGraphEdge),
		EndpointIndex: make(map[string]string),
		positionIndex: make(map[string]string),
	}
}

// BuildPipelineGraph builds a topology graph from pipeline segments and endpoints.
func BuildPipelineGraph(state *PipelineNetworkState, endpoints []PipelineEndpoint) *PipelineGraph {
	graph := NewPipelineGraph()
	if state != nil {
		for id, node := range state.Nodes {
			if node == nil {
				continue
			}
			graph.addNode(id, node.Position, true)
		}
		for id, seg := range state.Segments {
			if seg == nil {
				continue
			}
			graph.addNode(seg.From, Position{}, false)
			graph.addNode(seg.To, Position{}, false)
			graph.addEdge(PipelineGraphEdge{SegmentID: id, From: seg.From, To: seg.To})
		}
	}
	for _, endpoint := range endpoints {
		if endpoint.ID == "" {
			endpoint.ID = PipelineEndpointID(endpoint.BuildingID, endpoint.PortID)
		}
		graph.attachEndpoint(endpoint)
	}
	return graph
}

// Downstream returns the directly reachable nodes from nodeID.
func (g *PipelineGraph) Downstream(nodeID string) []string {
	if g == nil || nodeID == "" {
		return nil
	}
	neighbors := g.Edges[nodeID]
	return sortedEdgeKeys(neighbors)
}

// Upstream returns the nodes that connect into nodeID.
func (g *PipelineGraph) Upstream(nodeID string) []string {
	if g == nil || nodeID == "" {
		return nil
	}
	neighbors := g.ReverseEdges[nodeID]
	return sortedEdgeKeys(neighbors)
}

// Adjacent returns the union of upstream and downstream nodes.
func (g *PipelineGraph) Adjacent(nodeID string) []string {
	if g == nil || nodeID == "" {
		return nil
	}
	set := make(map[string]struct{})
	for _, id := range g.Downstream(nodeID) {
		set[id] = struct{}{}
	}
	for _, id := range g.Upstream(nodeID) {
		set[id] = struct{}{}
	}
	return sortedKeySet(set)
}

// EndpointNode returns the node ID that owns the endpoint.
func (g *PipelineGraph) EndpointNode(endpointID string) (string, bool) {
	if g == nil || endpointID == "" {
		return "", false
	}
	nodeID, ok := g.EndpointIndex[endpointID]
	return nodeID, ok
}

// EndpointsForNode returns endpoints attached to a node.
func (g *PipelineGraph) EndpointsForNode(nodeID string) []PipelineEndpoint {
	if g == nil || nodeID == "" {
		return nil
	}
	node := g.Nodes[nodeID]
	if node == nil || len(node.Endpoints) == 0 {
		return nil
	}
	out := make([]PipelineEndpoint, len(node.Endpoints))
	copy(out, node.Endpoints)
	return out
}

// Validate checks graph consistency.
func (g *PipelineGraph) Validate() error {
	if g == nil {
		return fmt.Errorf("pipeline graph is nil")
	}
	for id, node := range g.Nodes {
		if node == nil {
			return fmt.Errorf("pipeline node %s is nil", id)
		}
		if node.ID != id {
			return fmt.Errorf("pipeline node id mismatch: %s", id)
		}
		for _, endpoint := range node.Endpoints {
			if endpoint.ID == "" {
				return fmt.Errorf("pipeline endpoint missing id on node %s", id)
			}
			if owner, ok := g.EndpointIndex[endpoint.ID]; !ok || owner != id {
				return fmt.Errorf("pipeline endpoint index mismatch: %s", endpoint.ID)
			}
		}
	}
	for from, edges := range g.Edges {
		if g.Nodes[from] == nil {
			return fmt.Errorf("pipeline edge source missing: %s", from)
		}
		for to, edge := range edges {
			if g.Nodes[to] == nil {
				return fmt.Errorf("pipeline edge target missing: %s", to)
			}
			rev, ok := g.ReverseEdges[to][from]
			if !ok {
				return fmt.Errorf("pipeline edge missing reverse: %s -> %s", from, to)
			}
			if rev.SegmentID != edge.SegmentID || rev.From != edge.From || rev.To != edge.To {
				return fmt.Errorf("pipeline edge mismatch between %s and %s", from, to)
			}
		}
	}
	return nil
}

func (g *PipelineGraph) addNode(id string, pos Position, hasPos bool) *PipelineGraphNode {
	if g.Nodes == nil {
		g.Nodes = make(map[string]*PipelineGraphNode)
	}
	node := g.Nodes[id]
	if node == nil {
		node = &PipelineGraphNode{ID: id}
		g.Nodes[id] = node
	}
	if hasPos && !node.HasPosition {
		node.Position = pos
		node.HasPosition = true
		if g.positionIndex != nil {
			key := TileKey(pos.X, pos.Y)
			if _, ok := g.positionIndex[key]; !ok {
				g.positionIndex[key] = id
			}
		}
	}
	return node
}

func (g *PipelineGraph) addEdge(edge PipelineGraphEdge) {
	if g.Edges == nil {
		g.Edges = make(map[string]map[string]PipelineGraphEdge)
	}
	if g.ReverseEdges == nil {
		g.ReverseEdges = make(map[string]map[string]PipelineGraphEdge)
	}
	if g.Edges[edge.From] == nil {
		g.Edges[edge.From] = make(map[string]PipelineGraphEdge)
	}
	if g.ReverseEdges[edge.To] == nil {
		g.ReverseEdges[edge.To] = make(map[string]PipelineGraphEdge)
	}
	g.Edges[edge.From][edge.To] = edge
	g.ReverseEdges[edge.To][edge.From] = edge
}

func (g *PipelineGraph) attachEndpoint(endpoint PipelineEndpoint) string {
	if g.Nodes == nil {
		g.Nodes = make(map[string]*PipelineGraphNode)
	}
	if g.EndpointIndex == nil {
		g.EndpointIndex = make(map[string]string)
	}
	var nodeID string
	if g.positionIndex != nil {
		key := TileKey(endpoint.Position.X, endpoint.Position.Y)
		if existing, ok := g.positionIndex[key]; ok {
			nodeID = existing
		}
	}
	if nodeID == "" {
		nodeID = positionNodeID(endpoint.Position)
		g.addNode(nodeID, endpoint.Position, true)
		if g.positionIndex != nil {
			key := TileKey(endpoint.Position.X, endpoint.Position.Y)
			g.positionIndex[key] = nodeID
		}
	}
	node := g.Nodes[nodeID]
	node.Endpoints = append(node.Endpoints, endpoint)
	g.EndpointIndex[endpoint.ID] = nodeID
	return nodeID
}

func positionNodeID(pos Position) string {
	return "pnode-" + int64ToStr(int64(pos.X)) + "-" + int64ToStr(int64(pos.Y))
}

func sortedEdgeKeys(edges map[string]PipelineGraphEdge) []string {
	if len(edges) == 0 {
		return nil
	}
	keys := make([]string, 0, len(edges))
	for id := range edges {
		keys = append(keys, id)
	}
	sortStrings(keys)
	return keys
}

func sortedKeySet(set map[string]struct{}) []string {
	if len(set) == 0 {
		return nil
	}
	keys := make([]string, 0, len(set))
	for id := range set {
		keys = append(keys, id)
	}
	sortStrings(keys)
	return keys
}

func sortStrings(items []string) {
	if len(items) < 2 {
		return
	}
	for i := 1; i < len(items); i++ {
		j := i
		for j > 0 && items[j-1] > items[j] {
			items[j-1], items[j] = items[j], items[j-1]
			j--
		}
	}
}
