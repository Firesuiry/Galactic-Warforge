package model

import "fmt"

type PowerGridLinkKind string

type PowerConnectorKind string

const (
	PowerLinkLine     PowerGridLinkKind = "line"
	PowerLinkWireless PowerGridLinkKind = "wireless"
)

const (
	PowerConnectorLine     PowerConnectorKind = "line"
	PowerConnectorWireless PowerConnectorKind = "wireless"
)

const (
	DefaultPowerLineRange           = 1
	DefaultWirelessPowerTowerRange  = 6
	DefaultSatelliteSubstationRange = 10
)

// PowerConnector describes a single connection point for power grid linking.
type PowerConnector struct {
	BuildingID string
	Position   Position
	Kind       PowerConnectorKind
	Range      int
	Capacity   int
}

// PowerGridNode represents a node in the power grid topology.
type PowerGridNode struct {
	ID           string
	BuildingType BuildingType
	OwnerID      string
	Position     Position
	Connectors   []PowerConnector
}

// PowerGridEdge represents a link between two power grid nodes.
type PowerGridEdge struct {
	Kind     PowerGridLinkKind
	Distance int
}

// PowerGridGraph stores power grid nodes and edges with spatial indexing.
type PowerGridGraph struct {
	MapWidth  int
	MapHeight int
	Nodes     map[string]*PowerGridNode
	Edges     map[string]map[string]PowerGridEdge

	connectorIndex    map[string][]PowerConnector
	maxConnectorRange int
}

// NewPowerGridGraph creates an empty power grid graph.
func NewPowerGridGraph(width, height int) *PowerGridGraph {
	return &PowerGridGraph{
		MapWidth:       width,
		MapHeight:      height,
		Nodes:          make(map[string]*PowerGridNode),
		Edges:          make(map[string]map[string]PowerGridEdge),
		connectorIndex: make(map[string][]PowerConnector),
	}
}

// BuildPowerGridGraph rebuilds the power grid topology from world state.
func BuildPowerGridGraph(ws *WorldState) *PowerGridGraph {
	if ws == nil {
		return NewPowerGridGraph(0, 0)
	}
	graph := NewPowerGridGraph(ws.MapWidth, ws.MapHeight)
	for _, building := range ws.Buildings {
		graph.AddBuilding(building)
	}
	return graph
}

// RegisterPowerGridBuilding adds a building to the world power grid if applicable.
func RegisterPowerGridBuilding(ws *WorldState, building *Building) {
	if ws == nil || building == nil {
		return
	}
	if ws.PowerGrid == nil {
		ws.PowerGrid = NewPowerGridGraph(ws.MapWidth, ws.MapHeight)
	}
	ws.PowerGrid.AddBuilding(building)
}

// UnregisterPowerGridBuilding removes a building from the world power grid.
func UnregisterPowerGridBuilding(ws *WorldState, buildingID string) {
	if ws == nil || ws.PowerGrid == nil || buildingID == "" {
		return
	}
	ws.PowerGrid.RemoveBuilding(buildingID)
}

// RebuildPowerGrid replaces the world power grid using current buildings.
func RebuildPowerGrid(ws *WorldState) {
	if ws == nil {
		return
	}
	ws.PowerGrid = BuildPowerGridGraph(ws)
}

// AddBuilding inserts a building node and updates edges. Returns true if added.
func (g *PowerGridGraph) AddBuilding(building *Building) bool {
	if g == nil || building == nil {
		return false
	}
	if !isPowerGridNode(building) {
		return false
	}
	if _, exists := g.Nodes[building.ID]; exists {
		return false
	}
	connectors := powerGridConnectors(building)
	if len(connectors) == 0 {
		return false
	}

	node := &PowerGridNode{
		ID:           building.ID,
		BuildingType: building.Type,
		OwnerID:      building.OwnerID,
		Position:     building.Position,
		Connectors:   connectors,
	}
	g.Nodes[building.ID] = node
	if g.Edges[building.ID] == nil {
		g.Edges[building.ID] = make(map[string]PowerGridEdge)
	}

	oldMaxRange := g.maxConnectorRange
	for _, conn := range connectors {
		g.addConnector(conn)
		if conn.Range > g.maxConnectorRange {
			g.maxConnectorRange = conn.Range
		}
	}

	for _, conn := range connectors {
		scanRange := maxIntValue(conn.Range, oldMaxRange)
		g.connectConnector(conn, scanRange)
	}

	return true
}

// RemoveBuilding removes a building node and cleans up edges and connectors.
func (g *PowerGridGraph) RemoveBuilding(buildingID string) {
	if g == nil || buildingID == "" {
		return
	}
	node := g.Nodes[buildingID]
	if node == nil {
		return
	}
	maxRange := 0
	for _, conn := range node.Connectors {
		if conn.Range > maxRange {
			maxRange = conn.Range
		}
		g.removeConnector(conn)
	}

	neighbors := g.Edges[buildingID]
	for neighbor := range neighbors {
		delete(g.Edges[neighbor], buildingID)
	}
	delete(g.Edges, buildingID)
	delete(g.Nodes, buildingID)

	if maxRange >= g.maxConnectorRange {
		g.recalculateMaxRange()
	}
}

// Validate verifies graph consistency.
func (g *PowerGridGraph) Validate() error {
	if g == nil {
		return fmt.Errorf("power grid graph is nil")
	}
	for id, node := range g.Nodes {
		if node == nil {
			return fmt.Errorf("power grid node %s is nil", id)
		}
		if node.ID != id {
			return fmt.Errorf("power grid node id mismatch: %s", id)
		}
		for _, conn := range node.Connectors {
			if conn.BuildingID != id {
				return fmt.Errorf("power grid connector building mismatch: %s", id)
			}
		}
	}
	for from, edges := range g.Edges {
		if g.Nodes[from] == nil {
			return fmt.Errorf("power grid edge source missing: %s", from)
		}
		for to, edge := range edges {
			if g.Nodes[to] == nil {
				return fmt.Errorf("power grid edge target missing: %s", to)
			}
			rev, ok := g.Edges[to][from]
			if !ok {
				return fmt.Errorf("power grid edge missing reverse: %s -> %s", from, to)
			}
			if rev.Kind != edge.Kind || rev.Distance != edge.Distance {
				return fmt.Errorf("power grid edge mismatch between %s and %s", from, to)
			}
		}
	}
	return nil
}

func (g *PowerGridGraph) addConnector(conn PowerConnector) {
	key := TileKey(conn.Position.X, conn.Position.Y)
	g.connectorIndex[key] = append(g.connectorIndex[key], conn)
}

func (g *PowerGridGraph) removeConnector(conn PowerConnector) {
	key := TileKey(conn.Position.X, conn.Position.Y)
	entries := g.connectorIndex[key]
	if len(entries) == 0 {
		return
	}
	kept := entries[:0]
	for _, entry := range entries {
		if entry.BuildingID == conn.BuildingID && entry.Kind == conn.Kind && entry.Position == conn.Position {
			continue
		}
		kept = append(kept, entry)
	}
	if len(kept) == 0 {
		delete(g.connectorIndex, key)
		return
	}
	g.connectorIndex[key] = kept
}

func (g *PowerGridGraph) connectConnector(conn PowerConnector, scanRange int) {
	if scanRange <= 0 {
		return
	}
	startX := conn.Position.X - scanRange
	endX := conn.Position.X + scanRange
	startY := conn.Position.Y - scanRange
	endY := conn.Position.Y + scanRange
	for y := startY; y <= endY; y++ {
		if g.MapHeight > 0 && (y < 0 || y >= g.MapHeight) {
			continue
		}
		for x := startX; x <= endX; x++ {
			if g.MapWidth > 0 && (x < 0 || x >= g.MapWidth) {
				continue
			}
			key := TileKey(x, y)
			neighbors := g.connectorIndex[key]
			if len(neighbors) == 0 {
				continue
			}
			for _, other := range neighbors {
				if other.BuildingID == conn.BuildingID {
					continue
				}
				dist := manhattanDistance(conn.Position, other.Position)
				if dist <= 0 {
					continue
				}
				kind, ok := linkKind(conn, other, dist)
				if !ok {
					continue
				}
				g.addEdge(conn.BuildingID, other.BuildingID, kind, dist)
			}
		}
	}
}

func (g *PowerGridGraph) addEdge(a, b string, kind PowerGridLinkKind, distance int) {
	if a == "" || b == "" || a == b {
		return
	}
	if g.Edges[a] == nil {
		g.Edges[a] = make(map[string]PowerGridEdge)
	}
	if g.Edges[b] == nil {
		g.Edges[b] = make(map[string]PowerGridEdge)
	}
	current, exists := g.Edges[a][b]
	if exists {
		if !shouldReplaceEdge(current, kind, distance) {
			return
		}
	}
	edge := PowerGridEdge{Kind: kind, Distance: distance}
	g.Edges[a][b] = edge
	g.Edges[b][a] = edge
}

func (g *PowerGridGraph) recalculateMaxRange() {
	maxRange := 0
	for _, node := range g.Nodes {
		for _, conn := range node.Connectors {
			if conn.Range > maxRange {
				maxRange = conn.Range
			}
		}
	}
	g.maxConnectorRange = maxRange
}

func linkKind(a, b PowerConnector, distance int) (PowerGridLinkKind, bool) {
	if distance <= 0 {
		return "", false
	}
	if a.Kind == PowerConnectorLine && b.Kind == PowerConnectorLine {
		if distance <= DefaultPowerLineRange {
			return PowerLinkLine, true
		}
		return "", false
	}
	maxRange := a.Range
	if b.Range > maxRange {
		maxRange = b.Range
	}
	if distance <= maxRange {
		return PowerLinkWireless, true
	}
	return "", false
}

func shouldReplaceEdge(current PowerGridEdge, kind PowerGridLinkKind, distance int) bool {
	if current.Kind == PowerLinkLine {
		if kind == PowerLinkLine && distance < current.Distance {
			return true
		}
		return false
	}
	if kind == PowerLinkLine {
		return true
	}
	return distance < current.Distance
}

func isPowerGridNode(building *Building) bool {
	if building == nil {
		return false
	}
	if IsPowerGridBuilding(building.Type) {
		return true
	}
	if hasPowerConnection(building) {
		return true
	}
	return needsPowerConnection(building)
}

func hasPowerConnection(building *Building) bool {
	for _, conn := range building.Runtime.Params.ConnectionPoints {
		if conn.Kind == ConnectionPower {
			return true
		}
	}
	return false
}

func powerGridConnectors(building *Building) []PowerConnector {
	if building == nil {
		return nil
	}
	connectors := make([]PowerConnector, 0)
	for _, conn := range building.Runtime.Params.ConnectionPoints {
		if conn.Kind != ConnectionPower {
			continue
		}
		pos := Position{
			X: building.Position.X + conn.Offset.X,
			Y: building.Position.Y + conn.Offset.Y,
			Z: building.Position.Z,
		}
		connectors = append(connectors, PowerConnector{
			BuildingID: building.ID,
			Position:   pos,
			Kind:       PowerConnectorLine,
			Range:      DefaultPowerLineRange,
			Capacity:   conn.Capacity,
		})
	}
	if len(connectors) == 0 && needsPowerConnection(building) {
		connectors = append(connectors, PowerConnector{
			BuildingID: building.ID,
			Position:   building.Position,
			Kind:       PowerConnectorLine,
			Range:      DefaultPowerLineRange,
			Capacity:   1,
		})
	}
	if wirelessRange := powerGridWirelessRange(building.Type); wirelessRange > 0 {
		connectors = append(connectors, PowerConnector{
			BuildingID: building.ID,
			Position:   building.Position,
			Kind:       PowerConnectorWireless,
			Range:      wirelessRange,
		})
	}
	return connectors
}

func powerGridWirelessRange(btype BuildingType) int {
	switch btype {
	case BuildingTypeWirelessPowerTower:
		return DefaultWirelessPowerTowerRange
	case BuildingTypeSatelliteSubstation:
		return DefaultSatelliteSubstationRange
	default:
		return 0
	}
}

// IsPowerGridBuilding returns true when a building belongs to the power grid category.
func IsPowerGridBuilding(btype BuildingType) bool {
	switch btype {
	case BuildingTypeTeslaTower,
		BuildingTypeWirelessPowerTower,
		BuildingTypeSatelliteSubstation,
		BuildingTypeEnergyExchanger,
		BuildingTypeAccumulator,
		BuildingTypeAccumulatorFull:
		return true
	default:
		return false
	}
}

func needsPowerConnection(building *Building) bool {
	if building == nil {
		return false
	}
	params := building.Runtime.Params
	if params.EnergyConsume > 0 || params.EnergyGenerate > 0 || params.MaintenanceCost.Energy > 0 {
		return true
	}
	if building.Runtime.Functions.Energy != nil {
		if building.Runtime.Functions.Energy.ConsumePerTick > 0 || building.Runtime.Functions.Energy.OutputPerTick > 0 {
			return true
		}
	}
	return false
}

func manhattanDistance(a, b Position) int {
	dx := a.X - b.X
	if dx < 0 {
		dx = -dx
	}
	dy := a.Y - b.Y
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

func maxIntValue(a, b int) int {
	if a >= b {
		return a
	}
	return b
}
