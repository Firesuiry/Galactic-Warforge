package query

import (
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
	"siliconworld/internal/visibility"
)

// Layer provides read-only queries against the world state.
type Layer struct {
	vis       *visibility.Engine
	maps      *mapmodel.Universe
	discovery *mapstate.Discovery
}

func New(vis *visibility.Engine, maps *mapmodel.Universe, discovery *mapstate.Discovery) *Layer {
	return &Layer{vis: vis, maps: maps, discovery: discovery}
}

// StateSummary is the response for GET /state/summary.
type StateSummary struct {
	Tick           int64                         `json:"tick"`
	Players        map[string]*model.PlayerState `json:"players"`
	Winner         string                        `json:"winner,omitempty"`
	ActivePlanetID string                        `json:"active_planet_id"`
	MapWidth       int                           `json:"map_width"`
	MapHeight      int                           `json:"map_height"`
}

// Summary returns a high-level view of the world (no fog clipping for own resources).
func (ql *Layer) Summary(ws *model.WorldState, playerID string, winner string) *StateSummary {
	ws.RLock()
	defer ws.RUnlock()

	// Only expose the requesting player's own resources
	players := make(map[string]*model.PlayerState)
	for pid, ps := range ws.Players {
		if pid == playerID {
			cp := *ps
			cp.Inventory = ps.Inventory.Clone()
			players[pid] = &cp
		} else {
			// Expose non-sensitive identity fields
			players[pid] = &model.PlayerState{
				PlayerID: pid,
				TeamID:   ps.TeamID,
				Role:     ps.Role,
				IsAlive:  ps.IsAlive,
			}
		}
	}

	return &StateSummary{
		Tick:           ws.Tick,
		Players:        players,
		Winner:         winner,
		ActivePlanetID: ws.PlanetID,
		MapWidth:       ws.MapWidth,
		MapHeight:      ws.MapHeight,
	}
}

// GalaxyView is a galaxy overview.
type GalaxyView struct {
	GalaxyID       string      `json:"galaxy_id"`
	Name           string      `json:"name,omitempty"`
	Discovered     bool        `json:"discovered"`
	Width          float64     `json:"width,omitempty"`
	Height         float64     `json:"height,omitempty"`
	DistanceMatrix [][]float64 `json:"distance_matrix,omitempty"`
	Systems        []SystemRef `json:"systems,omitempty"`
}

type SystemRef struct {
	SystemID   string         `json:"system_id"`
	Name       string         `json:"name,omitempty"`
	Discovered bool           `json:"discovered"`
	Position   *mapmodel.Vec2 `json:"position,omitempty"`
	Star       *mapmodel.Star `json:"star,omitempty"`
}

// Galaxy returns galaxy overview.
func (ql *Layer) Galaxy(playerID string) *GalaxyView {
	galaxy := ql.maps.PrimaryGalaxy()
	if galaxy == nil {
		return &GalaxyView{Discovered: false}
	}
	discovered := ql.discovery.IsGalaxyDiscovered(playerID, galaxy.ID)
	name := ""
	if discovered {
		name = galaxy.Name
	}
	width := 0.0
	height := 0.0
	if discovered {
		width = galaxy.Width
		height = galaxy.Height
	}
	systems := make([]SystemRef, 0, len(galaxy.SystemIDs))
	for _, sysID := range galaxy.SystemIDs {
		sys := ql.maps.Systems[sysID]
		sysDiscovered := ql.discovery.IsSystemDiscovered(playerID, sysID)
		sysName := ""
		var pos *mapmodel.Vec2
		var star *mapmodel.Star
		if sysDiscovered && sys != nil {
			sysName = sys.Name
			p := sys.Position
			pos = &p
			s := sys.Star
			star = &s
		}
		systems = append(systems, SystemRef{
			SystemID:   sysID,
			Name:       sysName,
			Discovered: sysDiscovered,
			Position:   pos,
			Star:       star,
		})
	}

	return &GalaxyView{
		GalaxyID:       galaxy.ID,
		Name:           name,
		Discovered:     discovered,
		Width:          width,
		Height:         height,
		DistanceMatrix: maskedDistanceMatrix(galaxy.DistanceMatrix, systems, discovered),
		Systems:        systems,
	}
}

// SystemView is a stellar system view.
type SystemView struct {
	SystemID   string         `json:"system_id"`
	Name       string         `json:"name,omitempty"`
	Discovered bool           `json:"discovered"`
	Position   *mapmodel.Vec2 `json:"position,omitempty"`
	Star       *mapmodel.Star `json:"star,omitempty"`
	Planets    []PlanetRef    `json:"planets,omitempty"`
}

type PlanetRef struct {
	PlanetID   string              `json:"planet_id"`
	Name       string              `json:"name,omitempty"`
	Discovered bool                `json:"discovered"`
	Kind       mapmodel.PlanetKind `json:"kind,omitempty"`
	Orbit      *mapmodel.Orbit     `json:"orbit,omitempty"`
	MoonCount  int                 `json:"moon_count,omitempty"`
}

// System returns a single system overview.
func (ql *Layer) System(playerID, systemID string) (*SystemView, bool) {
	sys, ok := ql.maps.System(systemID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsSystemDiscovered(playerID, systemID)
	view := &SystemView{
		SystemID:   sys.ID,
		Discovered: discovered,
	}
	if !discovered {
		return view, true
	}
	view.Name = sys.Name
	pos := sys.Position
	view.Position = &pos
	star := sys.Star
	view.Star = &star
	planets := make([]PlanetRef, 0, len(sys.PlanetIDs))
	for _, pid := range sys.PlanetIDs {
		planet := ql.maps.Planets[pid]
		pDiscovered := ql.discovery.IsPlanetDiscovered(playerID, pid)
		pName := ""
		var orbit *mapmodel.Orbit
		kind := mapmodel.PlanetKind("")
		moonCount := 0
		if pDiscovered && planet != nil {
			pName = planet.Name
			o := planet.Orbit
			orbit = &o
			kind = planet.Kind
			moonCount = len(planet.Moons)
		}
		planets = append(planets, PlanetRef{
			PlanetID:   pid,
			Name:       pName,
			Discovered: pDiscovered,
			Kind:       kind,
			Orbit:      orbit,
			MoonCount:  moonCount,
		})
	}
	view.Planets = planets
	return view, true
}

// PlanetView is the detailed planet view including fog-clipped entities.
type PlanetView struct {
	PlanetID    string                      `json:"planet_id"`
	Name        string                      `json:"name,omitempty"`
	Discovered  bool                        `json:"discovered"`
	Kind        mapmodel.PlanetKind         `json:"kind,omitempty"`
	Orbit       *mapmodel.Orbit             `json:"orbit,omitempty"`
	Moons       []mapmodel.Moon             `json:"moons,omitempty"`
	MapWidth    int                         `json:"map_width"`
	MapHeight   int                         `json:"map_height"`
	Tick        int64                       `json:"tick"`
	Terrain     [][]terrain.TileType        `json:"terrain,omitempty"`
	Environment *mapmodel.PlanetEnvironment `json:"environment,omitempty"`
	Buildings   map[string]*model.Building  `json:"buildings,omitempty"`
	Units       map[string]*model.Unit      `json:"units,omitempty"`
	Resources   []*model.ResourceNodeState  `json:"resources,omitempty"`
}

const (
	defaultSceneWindowSize = 160
	maxSceneWindowSize     = 256
	defaultOverviewStep    = 100
)

type SceneBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type PlanetSceneRequest struct {
	X      int
	Y      int
	Width  int
	Height int
}

type PlanetSceneView struct {
	PlanetID      string                      `json:"planet_id"`
	Name          string                      `json:"name,omitempty"`
	Discovered    bool                        `json:"discovered"`
	Kind          mapmodel.PlanetKind         `json:"kind,omitempty"`
	MapWidth      int                         `json:"map_width"`
	MapHeight     int                         `json:"map_height"`
	Tick          int64                       `json:"tick"`
	Bounds        SceneBounds                 `json:"bounds"`
	Terrain       [][]terrain.TileType        `json:"terrain,omitempty"`
	Environment   *mapmodel.PlanetEnvironment `json:"environment,omitempty"`
	Visible       [][]bool                    `json:"visible,omitempty"`
	Explored      [][]bool                    `json:"explored,omitempty"`
	Buildings     map[string]*model.Building  `json:"buildings,omitempty"`
	Units         map[string]*model.Unit      `json:"units,omitempty"`
	Resources     []*model.ResourceNodeState  `json:"resources,omitempty"`
	BuildingCount int                         `json:"building_count,omitempty"`
	UnitCount     int                         `json:"unit_count,omitempty"`
	ResourceCount int                         `json:"resource_count,omitempty"`
}

type PlanetOverviewRequest struct {
	Step int
}

type PlanetOverviewView struct {
	PlanetID       string               `json:"planet_id"`
	Name           string               `json:"name,omitempty"`
	Discovered     bool                 `json:"discovered"`
	Kind           mapmodel.PlanetKind  `json:"kind,omitempty"`
	MapWidth       int                  `json:"map_width"`
	MapHeight      int                  `json:"map_height"`
	Tick           int64                `json:"tick"`
	Step           int                  `json:"step"`
	CellsWidth     int                  `json:"cells_width"`
	CellsHeight    int                  `json:"cells_height"`
	Terrain        [][]terrain.TileType `json:"terrain,omitempty"`
	Visible        [][]bool             `json:"visible,omitempty"`
	Explored       [][]bool             `json:"explored,omitempty"`
	ResourceCounts [][]int              `json:"resource_counts,omitempty"`
	BuildingCounts [][]int              `json:"building_counts,omitempty"`
	UnitCounts     [][]int              `json:"unit_counts,omitempty"`
	BuildingCount  int                  `json:"building_count,omitempty"`
	UnitCount      int                  `json:"unit_count,omitempty"`
	ResourceCount  int                  `json:"resource_count,omitempty"`
}

func clampSceneBounds(req PlanetSceneRequest, maxWidth, maxHeight int) SceneBounds {
	width := req.Width
	if width <= 0 {
		width = defaultSceneWindowSize
	}
	if width > maxSceneWindowSize {
		width = maxSceneWindowSize
	}
	if maxWidth > 0 && width > maxWidth {
		width = maxWidth
	}

	height := req.Height
	if height <= 0 {
		height = defaultSceneWindowSize
	}
	if height > maxSceneWindowSize {
		height = maxSceneWindowSize
	}
	if maxHeight > 0 && height > maxHeight {
		height = maxHeight
	}

	x := req.X
	y := req.Y
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	if maxWidth > 0 && x+width > maxWidth {
		x = maxWidth - width
	}
	if maxHeight > 0 && y+height > maxHeight {
		y = maxHeight - height
	}
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}

	return SceneBounds{
		X:      x,
		Y:      y,
		Width:  width,
		Height: height,
	}
}

func clampOverviewStep(req PlanetOverviewRequest, maxWidth, maxHeight int) int {
	step := req.Step
	if step <= 0 {
		step = defaultOverviewStep
	}
	maxDimension := maxWidth
	if maxHeight > maxDimension {
		maxDimension = maxHeight
	}
	if maxDimension > 0 && step > maxDimension {
		step = maxDimension
	}
	if step < 1 {
		step = 1
	}
	return step
}

func overviewDimensions(mapWidth, mapHeight, step int) (int, int) {
	if step <= 0 {
		return 0, 0
	}
	return (mapWidth + step - 1) / step, (mapHeight + step - 1) / step
}

func makeBoolGrid(width, height int) [][]bool {
	if width <= 0 || height <= 0 {
		return nil
	}
	grid := make([][]bool, height)
	for y := 0; y < height; y++ {
		grid[y] = make([]bool, width)
	}
	return grid
}

func makeCountGrid(width, height int) [][]int {
	if width <= 0 || height <= 0 {
		return nil
	}
	grid := make([][]int, height)
	for y := 0; y < height; y++ {
		grid[y] = make([]int, width)
	}
	return grid
}

func dominantTerrain(counts map[terrain.TileType]int) terrain.TileType {
	if len(counts) == 0 {
		return terrain.TileType("unknown")
	}
	priority := []terrain.TileType{
		terrain.TileBuildable,
		terrain.TileWater,
		terrain.TileLava,
		terrain.TileBlocked,
		terrain.TileType("unknown"),
	}
	best := terrain.TileType("unknown")
	bestCount := -1
	for _, candidate := range priority {
		if counts[candidate] > bestCount {
			best = candidate
			bestCount = counts[candidate]
		}
	}
	return best
}

func aggregateTerrainGrid(terrainGrid [][]terrain.TileType, mapWidth, mapHeight, step int) [][]terrain.TileType {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	if cellsWidth == 0 || cellsHeight == 0 {
		return nil
	}
	out := make([][]terrain.TileType, cellsHeight)
	for cellY := 0; cellY < cellsHeight; cellY++ {
		row := make([]terrain.TileType, cellsWidth)
		yStart := cellY * step
		yEnd := yStart + step
		if yEnd > mapHeight {
			yEnd = mapHeight
		}
		for cellX := 0; cellX < cellsWidth; cellX++ {
			xStart := cellX * step
			xEnd := xStart + step
			if xEnd > mapWidth {
				xEnd = mapWidth
			}
			counts := make(map[terrain.TileType]int)
			for y := yStart; y < yEnd && y < len(terrainGrid); y++ {
				sourceRow := terrainGrid[y]
				for x := xStart; x < xEnd && x < len(sourceRow); x++ {
					counts[sourceRow[x]] += 1
				}
			}
			row[cellX] = dominantTerrain(counts)
		}
		out[cellY] = row
	}
	return out
}

func aggregateBoolGrid(grid [][]bool, mapWidth, mapHeight, step int) [][]bool {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	out := makeBoolGrid(cellsWidth, cellsHeight)
	for cellY := 0; cellY < cellsHeight; cellY++ {
		yStart := cellY * step
		yEnd := yStart + step
		if yEnd > mapHeight {
			yEnd = mapHeight
		}
		for cellX := 0; cellX < cellsWidth; cellX++ {
			xStart := cellX * step
			xEnd := xStart + step
			if xEnd > mapWidth {
				xEnd = mapWidth
			}
			found := false
			for y := yStart; y < yEnd && y < len(grid) && !found; y++ {
				sourceRow := grid[y]
				for x := xStart; x < xEnd && x < len(sourceRow); x++ {
					if sourceRow[x] {
						out[cellY][cellX] = true
						found = true
						break
					}
				}
			}
		}
	}
	return out
}

func incrementCountCell(grid [][]int, step int, position model.Position) {
	if len(grid) == 0 || step <= 0 {
		return
	}
	cellX := position.X / step
	cellY := position.Y / step
	if cellY < 0 || cellY >= len(grid) {
		return
	}
	if cellX < 0 || cellX >= len(grid[cellY]) {
		return
	}
	grid[cellY][cellX] += 1
}

func aggregateBuildingCounts(buildings map[string]*model.Building, mapWidth, mapHeight, step int) [][]int {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	out := makeCountGrid(cellsWidth, cellsHeight)
	for _, building := range buildings {
		if building == nil {
			continue
		}
		incrementCountCell(out, step, building.Position)
	}
	return out
}

func aggregateUnitCounts(units map[string]*model.Unit, mapWidth, mapHeight, step int) [][]int {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	out := makeCountGrid(cellsWidth, cellsHeight)
	for _, unit := range units {
		if unit == nil {
			continue
		}
		incrementCountCell(out, step, unit.Position)
	}
	return out
}

func aggregateResourceSliceCounts(resources []*model.ResourceNodeState, mapWidth, mapHeight, step int) [][]int {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	out := makeCountGrid(cellsWidth, cellsHeight)
	for _, resource := range resources {
		if resource == nil {
			continue
		}
		incrementCountCell(out, step, resource.Position)
	}
	return out
}

func aggregateResourceMapCounts(resources map[string]*model.ResourceNodeState, mapWidth, mapHeight, step int) [][]int {
	cellsWidth, cellsHeight := overviewDimensions(mapWidth, mapHeight, step)
	out := makeCountGrid(cellsWidth, cellsHeight)
	for _, resource := range resources {
		if resource == nil {
			continue
		}
		incrementCountCell(out, step, resource.Position)
	}
	return out
}

func sliceTerrain(terrainGrid [][]terrain.TileType, bounds SceneBounds) [][]terrain.TileType {
	if bounds.Width <= 0 || bounds.Height <= 0 || len(terrainGrid) == 0 {
		return nil
	}
	out := make([][]terrain.TileType, 0, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		sourceY := bounds.Y + y
		if sourceY < 0 || sourceY >= len(terrainGrid) {
			break
		}
		row := terrainGrid[sourceY]
		if bounds.X < 0 || bounds.X >= len(row) {
			out = append(out, []terrain.TileType{})
			continue
		}
		endX := bounds.X + bounds.Width
		if endX > len(row) {
			endX = len(row)
		}
		out = append(out, append([]terrain.TileType(nil), row[bounds.X:endX]...))
	}
	return out
}

func sliceBoolGrid(grid [][]bool, bounds SceneBounds) [][]bool {
	if bounds.Width <= 0 || bounds.Height <= 0 || len(grid) == 0 {
		return blankFog(bounds.Width, bounds.Height)
	}
	out := make([][]bool, 0, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		sourceY := bounds.Y + y
		if sourceY < 0 || sourceY >= len(grid) {
			out = append(out, make([]bool, bounds.Width))
			continue
		}
		row := grid[sourceY]
		next := make([]bool, bounds.Width)
		for x := 0; x < bounds.Width; x++ {
			sourceX := bounds.X + x
			if sourceX < 0 || sourceX >= len(row) {
				continue
			}
			next[x] = row[sourceX]
		}
		out = append(out, next)
	}
	return out
}

func pointInBounds(position model.Position, bounds SceneBounds) bool {
	return position.X >= bounds.X &&
		position.X < bounds.X+bounds.Width &&
		position.Y >= bounds.Y &&
		position.Y < bounds.Y+bounds.Height
}

func filterBuildingsInBounds(buildings map[string]*model.Building, bounds SceneBounds) map[string]*model.Building {
	if len(buildings) == 0 {
		return map[string]*model.Building{}
	}
	out := make(map[string]*model.Building)
	for id, building := range buildings {
		if building == nil || !pointInBounds(building.Position, bounds) {
			continue
		}
		out[id] = building
	}
	return out
}

func filterUnitsInBounds(units map[string]*model.Unit, bounds SceneBounds) map[string]*model.Unit {
	if len(units) == 0 {
		return map[string]*model.Unit{}
	}
	out := make(map[string]*model.Unit)
	for id, unit := range units {
		if unit == nil || !pointInBounds(unit.Position, bounds) {
			continue
		}
		out[id] = unit
	}
	return out
}

func filterResourcesInBounds(resources []*model.ResourceNodeState, bounds SceneBounds) []*model.ResourceNodeState {
	if len(resources) == 0 {
		return []*model.ResourceNodeState{}
	}
	out := make([]*model.ResourceNodeState, 0, len(resources))
	for _, resource := range resources {
		if resource == nil || !pointInBounds(resource.Position, bounds) {
			continue
		}
		out = append(out, resource)
	}
	return out
}

func filterDynamicResourcesInBounds(resources map[string]*model.ResourceNodeState, bounds SceneBounds) []*model.ResourceNodeState {
	if len(resources) == 0 {
		return []*model.ResourceNodeState{}
	}
	ids := make([]string, 0)
	for id, resource := range resources {
		if resource == nil || !pointInBounds(resource.Position, bounds) {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]*model.ResourceNodeState, 0, len(ids))
	for _, id := range ids {
		out = append(out, resources[id])
	}
	return out
}

// Planet returns the detailed planet view filtered by player visibility.
func (ql *Layer) Planet(ws *model.WorldState, playerID, planetID string) (*PlanetView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetView{
		PlanetID:   planet.ID,
		Discovered: discovered,
	}
	if !discovered {
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()

	view.Name = planet.Name
	view.Kind = planet.Kind
	orbit := planet.Orbit
	view.Orbit = &orbit
	if len(planet.Moons) > 0 {
		view.Moons = append([]mapmodel.Moon(nil), planet.Moons...)
	}
	view.MapWidth = planet.Width
	view.MapHeight = planet.Height
	view.Tick = ws.Tick
	view.Terrain = planet.Terrain
	env := planet.Environment
	view.Environment = &env

	if ws.PlanetID == planetID {
		view.Buildings = ql.vis.FilterBuildings(ws, playerID)
		view.Units = ql.vis.FilterUnits(ws, playerID)
		view.Resources = sortedResources(ws)
	} else {
		view.Buildings = map[string]*model.Building{}
		view.Units = map[string]*model.Unit{}
		view.Resources = staticPlanetResources(planet)
	}

	return view, true
}

// PlanetScene returns a viewport-sized planet slice for large-map rendering.
func (ql *Layer) PlanetScene(ws *model.WorldState, playerID, planetID string, req PlanetSceneRequest) (*PlanetSceneView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}

	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	bounds := clampSceneBounds(req, planet.Width, planet.Height)
	view := &PlanetSceneView{
		PlanetID:   planet.ID,
		Discovered: discovered,
		MapWidth:   planet.Width,
		MapHeight:  planet.Height,
		Bounds:     bounds,
	}
	if !discovered {
		return view, true
	}

	view.Name = planet.Name
	view.Kind = planet.Kind
	env := planet.Environment
	view.Environment = &env
	view.Terrain = sliceTerrain(planet.Terrain, bounds)

	if ws == nil {
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()

	view.Tick = ws.Tick
	if ws.PlanetID == planetID {
		fog := ql.vis.FogState(ws, playerID)
		view.Visible = sliceBoolGrid(fog.Visible, bounds)
		view.Explored = sliceBoolGrid(fog.Explored, bounds)

		visibleBuildings := ql.vis.FilterBuildings(ws, playerID)
		visibleUnits := ql.vis.FilterUnits(ws, playerID)
		view.BuildingCount = len(visibleBuildings)
		view.UnitCount = len(visibleUnits)
		view.ResourceCount = len(ws.Resources)
		view.Buildings = filterBuildingsInBounds(visibleBuildings, bounds)
		view.Units = filterUnitsInBounds(visibleUnits, bounds)
		view.Resources = filterDynamicResourcesInBounds(ws.Resources, bounds)
		return view, true
	}

	view.Visible = blankFog(bounds.Width, bounds.Height)
	view.Explored = sliceBoolGrid(
		ql.vis.ExploredSnapshot(planet.ID, planet.Width, planet.Height, playerID),
		bounds,
	)
	view.Buildings = map[string]*model.Building{}
	view.Units = map[string]*model.Unit{}
	allResources := staticPlanetResources(planet)
	view.ResourceCount = len(allResources)
	view.Resources = filterResourcesInBounds(allResources, bounds)
	return view, true
}

// PlanetOverview returns a downsampled whole-planet view for global zoom rendering.
func (ql *Layer) PlanetOverview(ws *model.WorldState, playerID, planetID string, req PlanetOverviewRequest) (*PlanetOverviewView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}

	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	step := clampOverviewStep(req, planet.Width, planet.Height)
	cellsWidth, cellsHeight := overviewDimensions(planet.Width, planet.Height, step)
	view := &PlanetOverviewView{
		PlanetID:    planet.ID,
		Discovered:  discovered,
		MapWidth:    planet.Width,
		MapHeight:   planet.Height,
		Step:        step,
		CellsWidth:  cellsWidth,
		CellsHeight: cellsHeight,
	}
	if !discovered {
		return view, true
	}

	view.Name = planet.Name
	view.Kind = planet.Kind
	view.Terrain = aggregateTerrainGrid(planet.Terrain, planet.Width, planet.Height, step)
	view.BuildingCounts = makeCountGrid(cellsWidth, cellsHeight)
	view.UnitCounts = makeCountGrid(cellsWidth, cellsHeight)
	view.ResourceCounts = makeCountGrid(cellsWidth, cellsHeight)
	view.Visible = makeBoolGrid(cellsWidth, cellsHeight)
	view.Explored = makeBoolGrid(cellsWidth, cellsHeight)

	if ws == nil {
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()

	view.Tick = ws.Tick
	if ws.PlanetID == planetID {
		fog := ql.vis.FogState(ws, playerID)
		visibleBuildings := ql.vis.FilterBuildings(ws, playerID)
		visibleUnits := ql.vis.FilterUnits(ws, playerID)

		view.Visible = aggregateBoolGrid(fog.Visible, planet.Width, planet.Height, step)
		view.Explored = aggregateBoolGrid(fog.Explored, planet.Width, planet.Height, step)
		view.BuildingCount = len(visibleBuildings)
		view.UnitCount = len(visibleUnits)
		view.ResourceCount = len(ws.Resources)
		view.BuildingCounts = aggregateBuildingCounts(visibleBuildings, planet.Width, planet.Height, step)
		view.UnitCounts = aggregateUnitCounts(visibleUnits, planet.Width, planet.Height, step)
		view.ResourceCounts = aggregateResourceMapCounts(ws.Resources, planet.Width, planet.Height, step)
		return view, true
	}

	view.Explored = aggregateBoolGrid(
		ql.vis.ExploredSnapshot(planet.ID, planet.Width, planet.Height, playerID),
		planet.Width,
		planet.Height,
		step,
	)
	allResources := staticPlanetResources(planet)
	view.ResourceCount = len(allResources)
	view.ResourceCounts = aggregateResourceSliceCounts(allResources, planet.Width, planet.Height, step)
	return view, true
}

func maskedDistanceMatrix(matrix [][]float64, systems []SystemRef, discovered bool) [][]float64 {
	if !discovered || len(matrix) == 0 || len(systems) == 0 {
		return nil
	}
	size := len(matrix)
	masked := make([][]float64, size)
	for i := 0; i < size; i++ {
		rowSize := len(matrix[i])
		row := make([]float64, rowSize)
		for j := 0; j < rowSize; j++ {
			if i >= len(systems) || j >= len(systems) || !systems[i].Discovered || !systems[j].Discovered {
				row[j] = -1
			} else {
				row[j] = matrix[i][j]
			}
		}
		masked[i] = row
	}
	return masked
}

func sortedResources(ws *model.WorldState) []*model.ResourceNodeState {
	if ws == nil || len(ws.Resources) == 0 {
		return []*model.ResourceNodeState{}
	}
	ids := make([]string, 0, len(ws.Resources))
	for id := range ws.Resources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	res := make([]*model.ResourceNodeState, 0, len(ids))
	for _, id := range ids {
		res = append(res, ws.Resources[id])
	}
	return res
}

func staticPlanetResources(planet *mapmodel.Planet) []*model.ResourceNodeState {
	if planet == nil || len(planet.Resources) == 0 {
		return []*model.ResourceNodeState{}
	}
	res := make([]*model.ResourceNodeState, 0, len(planet.Resources))
	for i := range planet.Resources {
		node := planet.Resources[i]
		res = append(res, &model.ResourceNodeState{
			ID:           node.ID,
			PlanetID:     node.PlanetID,
			Kind:         string(node.Kind),
			Behavior:     string(node.Behavior),
			Position:     model.Position{X: node.Position.X, Y: node.Position.Y},
			ClusterID:    node.ClusterID,
			MaxAmount:    node.Total,
			Remaining:    node.Total,
			BaseYield:    node.BaseYield,
			CurrentYield: node.BaseYield,
			MinYield:     node.MinYield,
			RegenPerTick: node.RegenPerTick,
			DecayPerTick: node.DecayPerTick,
			IsRare:       node.IsRare,
		})
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].ID < res[j].ID
	})
	return res
}

// FogMapView is the fog-of-war grid.
type FogMapView struct {
	PlanetID   string   `json:"planet_id"`
	Discovered bool     `json:"discovered"`
	MapWidth   int      `json:"map_width"`
	MapHeight  int      `json:"map_height"`
	Visible    [][]bool `json:"visible,omitempty"`
	Explored   [][]bool `json:"explored,omitempty"`
}

// FogMap returns the visibility grid for a player.
func (ql *Layer) FogMap(ws *model.WorldState, playerID, planetID string) (*FogMapView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &FogMapView{
		PlanetID:   planet.ID,
		Discovered: discovered,
	}
	if !discovered {
		return view, true
	}

	view.MapWidth = planet.Width
	view.MapHeight = planet.Height

	if ws.PlanetID == planetID {
		ws.RLock()
		defer ws.RUnlock()
		fog := ql.vis.FogState(ws, playerID)
		view.Visible = fog.Visible
		view.Explored = fog.Explored
	} else {
		view.Visible = blankFog(planet.Width, planet.Height)
		view.Explored = ql.vis.ExploredSnapshot(planet.ID, planet.Width, planet.Height, playerID)
	}

	return view, true
}

func blankFog(w, h int) [][]bool {
	fog := make([][]bool, h)
	for y := range fog {
		fog[y] = make([]bool, w)
	}
	return fog
}
