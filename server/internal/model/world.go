package model

import "sync"

// Resources holds player resource counts
type Resources struct {
	Minerals int `json:"minerals"`
	Energy   int `json:"energy"`
}

// PlayerState holds per-player game state
type PlayerState struct {
	PlayerID  string    `json:"player_id"`
	Resources Resources `json:"resources"`
	IsAlive   bool      `json:"is_alive"`
}

// MapTile represents a single grid cell
type MapTile struct {
	X               int    `json:"x"`
	Y               int    `json:"y"`
	ResourceDeposit int    `json:"resource_deposit"` // mineral deposit value
	BuildingID      string `json:"building_id,omitempty"`
}

// WorldState is the authoritative game state
type WorldState struct {
	mu sync.RWMutex

	Tick      int64                   `json:"tick"`
	PlanetID  string                  `json:"planet_id"`
	MapWidth  int                     `json:"map_width"`
	MapHeight int                     `json:"map_height"`
	Players   map[string]*PlayerState `json:"players"`
	Buildings map[string]*Building    `json:"buildings"`
	Units     map[string]*Unit        `json:"units"`
	Grid      [][]MapTile             `json:"-"` // grid[y][x]

	// Tile occupancy: maps "x,y" -> entity ID
	TileBuilding map[string]string `json:"-"`
	TileUnits    map[string][]string `json:"-"`

	EntityCounter int64 `json:"-"`
}

// NewWorldState creates an empty world state
func NewWorldState(planetID string, mapWidth, mapHeight int) *WorldState {
	ws := &WorldState{
		PlanetID:    planetID,
		MapWidth:     mapWidth,
		MapHeight:    mapHeight,
		Players:      make(map[string]*PlayerState),
		Buildings:    make(map[string]*Building),
		Units:        make(map[string]*Unit),
		TileBuilding: make(map[string]string),
		TileUnits:    make(map[string][]string),
	}

	// Initialize grid
	ws.Grid = make([][]MapTile, mapHeight)
	for y := range ws.Grid {
		ws.Grid[y] = make([]MapTile, mapWidth)
		for x := range ws.Grid[y] {
			ws.Grid[y][x] = MapTile{X: x, Y: y}
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
