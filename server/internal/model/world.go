package model

import (
	"strconv"
	"sync"
	"sync/atomic"

	"siliconworld/internal/surface"

	"siliconworld/internal/terrain"
)

// Resources holds player resource counts
type Resources struct {
	Minerals int `json:"minerals"`
	Energy   int `json:"energy"`
}

// PlayerState holds per-player game state
type PlayerState struct {
	PlayerID    string        `json:"player_id"`
	TeamID      string        `json:"team_id"`
	Role        string        `json:"role"`
	Resources   Resources     `json:"resources"`
	Inventory   ItemInventory `json:"inventory,omitempty"`
	IsAlive     bool          `json:"is_alive"`
	Permissions []string      `json:"permissions,omitempty"`
	// FocusPlanetID 是该玩家的视图焦点/默认落点行星（F4）：未显式指定行星的
	// 命令在此行星结算；switch_active_planet 只改这个字段，不再影响全局模拟。
	FocusPlanetID   string                    `json:"focus_planet_id,omitempty"`
	Executors       map[string]*ExecutorState `json:"executors,omitempty"`
	Tech            *PlayerTechState          `json:"tech,omitempty"`
	Stats           *PlayerStats              `json:"stats,omitempty"`
	WarBlueprints   map[string]*WarBlueprint  `json:"war_blueprints,omitempty"`
	WarIndustry     *WarIndustryState         `json:"war_industry,omitempty"`
	WarCoordination *WarCoordinationState     `json:"war_coordination,omitempty"`
	// DarkFog 黑雾对该玩家的敌对关系：黑雾默认中立，被该玩家伤害后敌对，
	// 最后一次伤害后经过 dark_fog_calm_ticks 恢复中立。
	DarkFog DarkFogRelation `json:"dark_fog"`

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
	SurfaceMetadata surface.Metadata `json:"surface"`
	mu              sync.RWMutex

	Tick int64 `json:"tick"`
	// PaceOutput 生产配方时长倍率。0 表示 1。由结算管线按战场配置每 tick 写入，不进快照。
	PaceOutput float64 `json:"-"`
	// DarkFogCalmTicks 黑雾被激怒后恢复中立所需 tick。0 表示默认值。由结算管线按战场配置写入，不进快照。
	DarkFogCalmTicks   int64                             `json:"-"`
	PlanetID           string                            `json:"planet_id"`
	MapWidth           int                               `json:"map_width"`
	MapHeight          int                               `json:"map_height"`
	Players            map[string]*PlayerState           `json:"players"`
	Buildings          map[string]*Building              `json:"buildings"`
	Units              map[string]*Unit                  `json:"units"`
	Grid               [][]MapTile                       `json:"-"` // grid[y][x]
	Resources          map[string]*ResourceNodeState     `json:"resources"`
	LogisticsStations  map[string]*LogisticsStationState `json:"-"`
	LogisticsBots      map[string]*LogisticsBotState     `json:"-"`
	LogisticsDrones    map[string]*LogisticsDroneState   `json:"-"`
	LogisticsShips     map[string]*LogisticsShipState    `json:"-"`
	PowerInputs        []PowerInput                      `json:"-"`
	PowerSnapshot      *PowerSettlementSnapshot          `json:"-"`
	ConveyorTraffic    *ConveyorTrafficSnapshot          `json:"-"`
	ProductionSnapshot *ProductionSettlementSnapshot     `json:"-"`
	PowerGrid          *PowerGridGraph                   `json:"-"`
	Pipelines          *PipelineNetworkState             `json:"pipelines,omitempty"`
	Construction       *ConstructionQueue                `json:"construction,omitempty"`
	EnemyForces        *EnemyForceState                  `json:"enemy_forces,omitempty"`
	SensorContacts     map[string]*SensorContactState    `json:"sensor_contacts,omitempty"` // player_id -> scoped contact state
	CombatRuntime      *CombatRuntimeState               `json:"combat_runtime,omitempty"`

	// Tile occupancy: maps "x,y" -> entity ID
	TileBuilding map[string]string `json:"-"`
	// 寻路暂存（epoch 戳免清零）：仅供结算期单线程 BFS 复用，不落盘。
	PathScratchParent []int32             `json:"-"`
	PathScratchDepth  []int32             `json:"-"`
	PathScratchEpoch  []int32             `json:"-"`
	PathScratchGen    int32               `json:"-"`
	PathScratchQueue  []int32             `json:"-"`
	TileUnits         map[string][]string `json:"-"`

	EntityCounter int64 `json:"-"`
}

// NewWorldState creates an empty world state
func NewWorldState(planetID string, faceSize int) *WorldState {
	if faceSize < 1 {
		panic("face size must be positive")
	}
	mapWidth, mapHeight := 3*faceSize, 2*faceSize
	ws := &WorldState{
		SurfaceMetadata:   (surface.Grid{Size: faceSize}).Metadata(),
		PlanetID:          planetID,
		MapWidth:          mapWidth,
		MapHeight:         mapHeight,
		Players:           make(map[string]*PlayerState),
		Buildings:         make(map[string]*Building),
		Units:             make(map[string]*Unit),
		Resources:         make(map[string]*ResourceNodeState),
		LogisticsStations: make(map[string]*LogisticsStationState),
		LogisticsBots:     make(map[string]*LogisticsBotState),
		LogisticsDrones:   make(map[string]*LogisticsDroneState),
		LogisticsShips:    make(map[string]*LogisticsShipState),
		TileBuilding:      make(map[string]string),
		TileUnits:         make(map[string][]string),
		PowerGrid:         NewPowerGridGraph(surface.Grid{Size: faceSize}),
		Construction:      NewConstructionQueue(),
		CombatRuntime:     NewCombatRuntimeState(),
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

// tileKeyCacheDim TileKey 缓存覆盖的坐标范围（x、y 均 < 该值）。立方体球面地图
// 宽 = 3×面宽、高 = 2×面宽，面宽 ≤170 都落在缓存内。
const tileKeyCacheDim = 512

// tileKeyCache 惰性填充的 TileKey 字符串表：TileKey 是索敌/寻路/占位判定里每格
// 都要调的热路径，按需拼字符串会让整局 GC 压力随单位数线性上涨（试玩 1011：
// 大量单位空闲索敌时 TileKey 分配占 CPU 15%，GC 占一半以上）。
// 并发安全：查询协程与 tick 可能同时调用，原子指针保证读到的总是完整字符串。
var tileKeyCache [tileKeyCacheDim * tileKeyCacheDim]atomic.Pointer[string]

// TileKey returns a string key for tile coordinates
func TileKey(x, y int) string {
	if uint(x) >= tileKeyCacheDim || uint(y) >= tileKeyCacheDim {
		return strconv.Itoa(x) + "," + strconv.Itoa(y)
	}
	slot := &tileKeyCache[y*tileKeyCacheDim+x]
	if key := slot.Load(); key != nil {
		return *key
	}
	key := strconv.Itoa(x) + "," + strconv.Itoa(y)
	slot.Store(&key)
	return key
}

func int64ToStr(n int64) string {
	return strconv.FormatInt(n, 10)
}

// InBounds returns true if the position is within map bounds
func (ws *WorldState) InBounds(x, y int) bool {
	return x >= 0 && x < ws.MapWidth && y >= 0 && y < ws.MapHeight
}
