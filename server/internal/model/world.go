package model

import (
	"sync"

	"siliconworld/internal/terrain"
)

// Resources holds player resource counts
type Resources struct {
	Minerals int `json:"minerals"`
	Energy   int `json:"energy"`
}

// PlayerState holds per-player game state
type PlayerState struct {
	PlayerID    string         `json:"player_id"`
	TeamID      string         `json:"team_id"`
	Role        string         `json:"role"`
	Resources   Resources      `json:"resources"`
	Inventory   ItemInventory  `json:"inventory,omitempty"`
	IsAlive     bool           `json:"is_alive"`
	Permissions []string       `json:"permissions,omitempty"`
	Executor    *ExecutorState `json:"executor,omitempty"`
	Tech        *PlayerTechState `json:"tech,omitempty"`

	permissionSet map[string]struct{} `json:"-"`
}

// MapTile represents a single grid cell
type MapTile struct {
	X              int              `json:"x"`
	Y              int              `json:"y"`
	ResourceNodeID string           `json:"resource_node_id,omitempty"`
	BuildingID     string           `json:"building_id,omitempty"`
	Terrain        terrain.TileType `json:"terrain"`
}

// WorldState is the authoritative game state
type WorldState struct {
	mu sync.RWMutex

	Tick              int64                             `json:"tick"`
	PlanetID          string                            `json:"planet_id"`
	MapWidth          int                               `json:"map_width"`
	MapHeight         int                               `json:"map_height"`
	Players           map[string]*PlayerState           `json:"players"`
	Buildings         map[string]*Building              `json:"buildings"`
	Units             map[string]*Unit                  `json:"units"`
	Grid              [][]MapTile                       `json:"-"` // grid[y][x]
	Resources         map[string]*ResourceNodeState     `json:"resources"`
	LogisticsStations map[string]*LogisticsStationState `json:"-"`
	LogisticsDrones   map[string]*LogisticsDroneState   `json:"-"`
	LogisticsShips    map[string]*LogisticsShipState    `json:"-"`
	PowerInputs       []PowerInput                      `json:"-"`
	PowerGrid         *PowerGridGraph                   `json:"-"`
	Pipelines         *PipelineNetworkState             `json:"pipelines,omitempty"`
	Construction      *ConstructionQueue                `json:"construction,omitempty"`
	EnemyForces       *EnemyForceState                  `json:"enemy_forces,omitempty"`
	Detections        map[string]*DetectionState        `json:"detections,omitempty"` // player_id -> detection state

	// Tile occupancy: maps "x,y" -> entity ID
	TileBuilding map[string]string   `json:"-"`
	TileUnits    map[string][]string `json:"-"`

	EntityCounter int64 `json:"-"`
}

// NewWorldState creates an empty world state
func NewWorldState(planetID string, mapWidth, mapHeight int) *WorldState {
	ws := &WorldState{
		PlanetID:          planetID,
		MapWidth:          mapWidth,
		MapHeight:         mapHeight,
		Players:           make(map[string]*PlayerState),
		Buildings:         make(map[string]*Building),
		Units:             make(map[string]*Unit),
		Resources:         make(map[string]*ResourceNodeState),
		LogisticsStations: make(map[string]*LogisticsStationState),
		LogisticsDrones:   make(map[string]*LogisticsDroneState),
		LogisticsShips:    make(map[string]*LogisticsShipState),
		TileBuilding:      make(map[string]string),
		TileUnits:         make(map[string][]string),
		PowerGrid:         NewPowerGridGraph(mapWidth, mapHeight),
		Construction:      NewConstructionQueue(),
	}

	// Initialize grid
	ws.Grid = make([][]MapTile, mapHeight)
	for y := range ws.Grid {
		ws.Grid[y] = make([]MapTile, mapWidth)
		for x := range ws.Grid[y] {
			ws.Grid[y][x] = MapTile{X: x, Y: y, Terrain: terrain.TileBuildable}
		}
	}

	return ws
}

// Lock acquires write lock
func (ws *WorldState) Lock() { ws.mu.Lock() }

// Unlock releases write lock
func (ws *WorldState) Unlock() { ws.mu.Unlock() }

// RLock acquires read lock
func (ws *WorldState) RLock() { ws.mu.RLock() }

// RUnlock releases read lock
func (ws *WorldState) RUnlock() { ws.mu.RUnlock() }

// NextEntityID generates a new unique entity ID
func (ws *WorldState) NextEntityID(prefix string) string {
	ws.EntityCounter++
	return prefix + "-" + int64ToStr(ws.EntityCounter)
}

// TileKey returns a string key for tile coordinates
func TileKey(x, y int) string {
	return int64ToStr(int64(x)) + "," + int64ToStr(int64(y))
}

func int64ToStr(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := make([]byte, 0, 20)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}

// InBounds returns true if the position is within map bounds
func (ws *WorldState) InBounds(x, y int) bool {
	return x >= 0 && x < ws.MapWidth && y >= 0 && y < ws.MapHeight
}

// ManhattanDist returns the manhattan distance between two positions
func ManhattanDist(a, b Position) int {
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
