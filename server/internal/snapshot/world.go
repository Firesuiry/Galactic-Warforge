package snapshot

import (
	"errors"
	"fmt"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// WorldSnapshot captures the authoritative world state at a tick.
type WorldSnapshot struct {
	Tick            int64                                 `json:"tick"`
	PlanetID        string                                `json:"planet_id"`
	MapWidth        int                                   `json:"map_width"`
	MapHeight       int                                   `json:"map_height"`
	EntityCounter   int64                                 `json:"entity_counter"`
	Players         map[string]*model.PlayerState         `json:"players"`
	Buildings       map[string]*BuildingSnapshot          `json:"buildings"`
	Units           map[string]*model.Unit                `json:"units"`
	LogisticsDrones map[string]*model.LogisticsDroneState `json:"logistics_drones,omitempty"`
	LogisticsShips  map[string]*model.LogisticsShipState  `json:"logistics_ships,omitempty"`
	Resources       map[string]*model.ResourceNodeState   `json:"resources"`
	Pipelines       *model.PipelineNetworkState           `json:"pipelines,omitempty"`
	Construction    *model.ConstructionQueue              `json:"construction,omitempty"`
	EnemyForces     *model.EnemyForceState                `json:"enemy_forces,omitempty"`
	SensorContacts  map[string]*model.SensorContactState  `json:"sensor_contacts,omitempty"`
	CombatRuntime   *model.CombatRuntimeState             `json:"combat_runtime,omitempty"`
	Terrain         [][]terrain.TileType                  `json:"terrain"`
}

// BuildingSnapshot is a snapshot-friendly building payload.
type BuildingSnapshot struct {
	ID               string                       `json:"id"`
	Type             model.BuildingType           `json:"type"`
	OwnerID          string                       `json:"owner_id"`
	Position         model.Position               `json:"position"`
	HP               int                          `json:"hp"`
	MaxHP            int                          `json:"max_hp"`
	Level            int                          `json:"level"`
	VisionRange      int                          `json:"vision_range"`
	Runtime          model.BuildingRuntime        `json:"runtime"`
	Storage          *model.StorageState          `json:"storage,omitempty"`
	EnergyStorage    *model.EnergyStorageState    `json:"energy_storage,omitempty"`
	Conveyor         *model.ConveyorState         `json:"conveyor,omitempty"`
	Sorter           *model.SorterState           `json:"sorter,omitempty"`
	LogisticsStation *model.LogisticsStationState `json:"logistics_station,omitempty"`
	Job              *BuildingJobSnapshot         `json:"job,omitempty"`
}

// BuildingJobSnapshot preserves in-flight job state for snapshots.
type BuildingJobSnapshot struct {
	Type           model.BuildingJobType   `json:"type"`
	RemainingTicks int                     `json:"remaining_ticks"`
	TargetLevel    int                     `json:"target_level,omitempty"`
	RefundRate     float64                 `json:"refund_rate,omitempty"`
	PrevState      model.BuildingWorkState `json:"prev_state,omitempty"`
}

// CaptureWorld builds a world snapshot from runtime state.
func CaptureWorld(ws *model.WorldState) *WorldSnapshot {
	if ws == nil {
		return nil
	}
	ws.RLock()
	defer ws.RUnlock()

	snap := &WorldSnapshot{
		Tick:            ws.Tick,
		PlanetID:        ws.PlanetID,
		MapWidth:        ws.MapWidth,
		MapHeight:       ws.MapHeight,
		EntityCounter:   ws.EntityCounter,
		Players:         make(map[string]*model.PlayerState, len(ws.Players)),
		Buildings:       make(map[string]*BuildingSnapshot, len(ws.Buildings)),
		Units:           make(map[string]*model.Unit, len(ws.Units)),
		LogisticsDrones: make(map[string]*model.LogisticsDroneState, len(ws.LogisticsDrones)),
		LogisticsShips:  make(map[string]*model.LogisticsShipState, len(ws.LogisticsShips)),
		Resources:       make(map[string]*model.ResourceNodeState, len(ws.Resources)),
		Pipelines:       clonePipelineNetworkState(ws.Pipelines),
		Construction:    cloneConstructionQueue(ws.Construction),
		EnemyForces:     cloneEnemyForceState(ws.EnemyForces),
		SensorContacts:  model.CloneSensorContactStateMap(ws.SensorContacts),
		CombatRuntime:   model.CloneCombatRuntimeState(ws.CombatRuntime),
		Terrain:         cloneTerrain(ws.Grid, ws.MapWidth, ws.MapHeight),
	}

	for id, ps := range ws.Players {
		snap.Players[id] = clonePlayer(ps)
	}
	for id, b := range ws.Buildings {
		snap.Buildings[id] = cloneBuilding(b)
	}
	for id, u := range ws.Units {
		snap.Units[id] = cloneUnit(u)
	}
	for id, d := range ws.LogisticsDrones {
		snap.LogisticsDrones[id] = cloneLogisticsDrone(d)
	}
	for id, ship := range ws.LogisticsShips {
		snap.LogisticsShips[id] = cloneLogisticsShip(ship)
	}
	for id, r := range ws.Resources {
		snap.Resources[id] = cloneResource(r)
	}

	return snap
}

// Restore reconstructs a WorldState from the snapshot.
func (snap *WorldSnapshot) Restore() (*model.WorldState, error) {
	if snap == nil {
		return nil, errors.New("world snapshot is nil")
	}
	if snap.MapWidth <= 0 || snap.MapHeight <= 0 {
		return nil, fmt.Errorf("invalid map size %dx%d", snap.MapWidth, snap.MapHeight)
	}
	if err := validateTerrain(snap.Terrain, snap.MapWidth, snap.MapHeight); err != nil {
		return nil, err
	}

	ws := model.NewWorldState(snap.PlanetID, snap.MapWidth, snap.MapHeight)
	ws.Tick = snap.Tick
	ws.EntityCounter = snap.EntityCounter

	// Restore terrain.
	for y := 0; y < snap.MapHeight; y++ {
		for x := 0; x < snap.MapWidth; x++ {
			ws.Grid[y][x].Terrain = snap.Terrain[y][x]
			ws.Grid[y][x].ResourceNodeID = ""
			ws.Grid[y][x].BuildingID = ""
		}
	}

	// Restore players.
	ws.Players = make(map[string]*model.PlayerState, len(snap.Players))
	for id, ps := range snap.Players {
		if ps == nil {
			return nil, fmt.Errorf("player snapshot missing for %s", id)
		}
		player := clonePlayer(ps)
		if player != nil {
			player.SetPermissions(player.Permissions)
		}
		ws.Players[id] = player
	}

	// Restore buildings.
	ws.Buildings = make(map[string]*model.Building, len(snap.Buildings))
	for id, b := range snap.Buildings {
		building, err := restoreBuilding(id, b)
		if err != nil {
			return nil, err
		}
		ws.Buildings[building.ID] = building
	}
	model.RebuildLogisticsStations(ws)
	model.RebuildPowerGrid(ws)

	// Restore units.
	ws.Units = make(map[string]*model.Unit, len(snap.Units))
	for id, u := range snap.Units {
		if u == nil {
			return nil, fmt.Errorf("unit snapshot missing for %s", id)
		}
		ws.Units[id] = cloneUnit(u)
	}

	// Restore logistics drones.
	ws.LogisticsDrones = make(map[string]*model.LogisticsDroneState, len(snap.LogisticsDrones))
	for id, d := range snap.LogisticsDrones {
		if d == nil {
			return nil, fmt.Errorf("logistics drone snapshot missing for %s", id)
		}
		ws.LogisticsDrones[id] = cloneLogisticsDrone(d)
	}
	// Restore logistics ships.
	ws.LogisticsShips = make(map[string]*model.LogisticsShipState, len(snap.LogisticsShips))
	for id, ship := range snap.LogisticsShips {
		if ship == nil {
			return nil, fmt.Errorf("logistics ship snapshot missing for %s", id)
		}
		ws.LogisticsShips[id] = cloneLogisticsShip(ship)
	}

	// Restore resources.
	ws.Resources = make(map[string]*model.ResourceNodeState, len(snap.Resources))
	for id, r := range snap.Resources {
		if r == nil {
			return nil, fmt.Errorf("resource snapshot missing for %s", id)
		}
		ws.Resources[id] = cloneResource(r)
	}
	ws.Pipelines = clonePipelineNetworkState(snap.Pipelines)
	ws.Construction = cloneConstructionQueue(snap.Construction)
	ws.EnemyForces = cloneEnemyForceState(snap.EnemyForces)
	ws.SensorContacts = model.CloneSensorContactStateMap(snap.SensorContacts)
	ws.CombatRuntime = model.CloneCombatRuntimeState(snap.CombatRuntime)
	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
		ws.Construction.RebuildReservations()
	}

	// Rebuild tile occupancy and link tiles.
	ws.TileBuilding = make(map[string]string)
	ws.TileUnits = make(map[string][]string)

	for id, building := range ws.Buildings {
		if !ws.InBounds(building.Position.X, building.Position.Y) {
			return nil, fmt.Errorf("building %s out of bounds", id)
		}
		key := model.TileKey(building.Position.X, building.Position.Y)
		if _, exists := ws.TileBuilding[key]; exists {
			return nil, fmt.Errorf("duplicate building occupancy at %s", key)
		}
		ws.TileBuilding[key] = id
		ws.Grid[building.Position.Y][building.Position.X].BuildingID = id
	}

	for id, unit := range ws.Units {
		if !ws.InBounds(unit.Position.X, unit.Position.Y) {
			return nil, fmt.Errorf("unit %s out of bounds", id)
		}
		key := model.TileKey(unit.Position.X, unit.Position.Y)
		ws.TileUnits[key] = append(ws.TileUnits[key], id)
	}

	for id, res := range ws.Resources {
		if !ws.InBounds(res.Position.X, res.Position.Y) {
			return nil, fmt.Errorf("resource %s out of bounds", id)
		}
		cell := &ws.Grid[res.Position.Y][res.Position.X]
		if cell.ResourceNodeID != "" && cell.ResourceNodeID != id {
			return nil, fmt.Errorf("duplicate resource occupancy at %d,%d", res.Position.X, res.Position.Y)
		}
		cell.ResourceNodeID = id
	}

	return ws, nil
}

func cloneEnemyForceState(state *model.EnemyForceState) *model.EnemyForceState {
	if state == nil {
		return nil
	}
	out := *state
	out.Forces = append([]model.EnemyForce(nil), state.Forces...)
	return &out
}

func validateTerrain(terrainGrid [][]terrain.TileType, width, height int) error {
	if len(terrainGrid) != height {
		return fmt.Errorf("terrain height mismatch: %d != %d", len(terrainGrid), height)
	}
	for y := 0; y < height; y++ {
		if len(terrainGrid[y]) != width {
			return fmt.Errorf("terrain width mismatch at row %d: %d != %d", y, len(terrainGrid[y]), width)
		}
	}
	return nil
}

func cloneTerrain(grid [][]model.MapTile, width, height int) [][]terrain.TileType {
	if width <= 0 || height <= 0 {
		return nil
	}
	terrainGrid := make([][]terrain.TileType, height)
	for y := 0; y < height; y++ {
		row := make([]terrain.TileType, width)
		if y < len(grid) {
			srcRow := grid[y]
			for x := 0; x < width && x < len(srcRow); x++ {
				row[x] = srcRow[x].Terrain
			}
		}
		terrainGrid[y] = row
	}
	return terrainGrid
}
