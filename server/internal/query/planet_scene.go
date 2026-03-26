package query

import (
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

const (
	maxTileSceneSpan = 256
	sceneSectorSize  = 32
)

type PlanetSceneRequest struct {
	DetailLevel string `json:"detail_level"`
	MinX        int    `json:"min_x"`
	MinY        int    `json:"min_y"`
	MaxX        int    `json:"max_x"`
	MaxY        int    `json:"max_y"`
}

type PlanetSceneBounds struct {
	MinX int `json:"min_x"`
	MinY int `json:"min_y"`
	MaxX int `json:"max_x"`
	MaxY int `json:"max_y"`
}

type PlanetSceneFogView struct {
	Visible  [][]bool `json:"visible,omitempty"`
	Explored [][]bool `json:"explored,omitempty"`
}

type PlanetSectorView struct {
	SectorX       int `json:"sector_x"`
	SectorY       int `json:"sector_y"`
	BuildingCount int `json:"building_count"`
	UnitCount     int `json:"unit_count"`
	ResourceCount int `json:"resource_count"`
	VisibleTiles  int `json:"visible_tiles"`
	ExploredTiles int `json:"explored_tiles"`
}

type PlanetSceneView struct {
	PlanetID    string                     `json:"planet_id"`
	Discovered  bool                       `json:"discovered"`
	DetailLevel string                     `json:"detail_level"`
	MapWidth    int                        `json:"map_width"`
	MapHeight   int                        `json:"map_height"`
	Tick        int64                      `json:"tick"`
	Bounds      PlanetSceneBounds          `json:"bounds"`
	Terrain     [][]terrain.TileType       `json:"terrain,omitempty"`
	Fog         PlanetSceneFogView         `json:"fog,omitempty"`
	Buildings   map[string]*model.Building `json:"buildings,omitempty"`
	Units       map[string]*model.Unit     `json:"units,omitempty"`
	Resources   []*model.ResourceNodeState `json:"resources,omitempty"`
	Sectors     []PlanetSectorView         `json:"sectors,omitempty"`
}

func (ql *Layer) PlanetScene(ws *model.WorldState, playerID, planetID string, req PlanetSceneRequest) (*PlanetSceneView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetSceneView{
		PlanetID:    planet.ID,
		Discovered:  discovered,
		DetailLevel: normalizeSceneDetailLevel(req.DetailLevel),
		MapWidth:    planet.Width,
		MapHeight:   planet.Height,
		Bounds:      clampSceneBounds(req, planet.Width, planet.Height, maxTileSceneSpan),
	}
	if !discovered {
		return view, true
	}

	var visible [][]bool
	var explored [][]bool
	var buildings map[string]*model.Building
	var units map[string]*model.Unit
	var resources []*model.ResourceNodeState

	if ws != nil && ws.PlanetID == planetID {
		ws.RLock()
		defer ws.RUnlock()
		view.Tick = ws.Tick
		fog := ql.vis.FogState(ws, playerID)
		visible = fog.Visible
		explored = fog.Explored
		buildings = ql.vis.FilterBuildings(ws, playerID)
		units = ql.vis.FilterUnits(ws, playerID)
		resources = sortedResources(ws)
	} else {
		visible = blankFog(planet.Width, planet.Height)
		explored = ql.vis.ExploredSnapshot(planet.ID, planet.Width, planet.Height, playerID)
		buildings = map[string]*model.Building{}
		units = map[string]*model.Unit{}
		resources = staticPlanetResources(planet)
	}

	if view.DetailLevel == "sector" {
		view.Sectors = aggregateSceneSectors(view.Bounds, visible, explored, buildings, units, resources)
		return view, true
	}

	view.Terrain = cropTerrain(planet.Terrain, view.Bounds)
	view.Fog = PlanetSceneFogView{
		Visible:  cropBoolGrid(visible, view.Bounds),
		Explored: cropBoolGrid(explored, view.Bounds),
	}
	view.Buildings = filterBuildingsByBounds(buildings, view.Bounds)
	view.Units = filterUnitsByBounds(units, view.Bounds)
	view.Resources = filterResourcesByBounds(resources, view.Bounds)
	return view, true
}

func normalizeSceneDetailLevel(level string) string {
	if level == "sector" {
		return "sector"
	}
	return "tile"
}

func clampSceneBounds(req PlanetSceneRequest, mapWidth, mapHeight, maxSpan int) PlanetSceneBounds {
	if mapWidth <= 0 || mapHeight <= 0 {
		return PlanetSceneBounds{}
	}
	minX, maxX := req.MinX, req.MaxX
	if maxX < minX {
		minX, maxX = maxX, minX
	}
	minY, maxY := req.MinY, req.MaxY
	if maxY < minY {
		minY, maxY = maxY, minY
	}
	minX = clampInt(minX, 0, mapWidth-1)
	maxX = clampInt(maxX, 0, mapWidth-1)
	minY = clampInt(minY, 0, mapHeight-1)
	maxY = clampInt(maxY, 0, mapHeight-1)

	if maxX-minX+1 > maxSpan {
		maxX = minX + maxSpan - 1
	}
	if maxY-minY+1 > maxSpan {
		maxY = minY + maxSpan - 1
	}
	if maxX >= mapWidth {
		maxX = mapWidth - 1
	}
	if maxY >= mapHeight {
		maxY = mapHeight - 1
	}
	return PlanetSceneBounds{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func inSceneBounds(pos model.Position, bounds PlanetSceneBounds) bool {
	return pos.X >= bounds.MinX && pos.X <= bounds.MaxX && pos.Y >= bounds.MinY && pos.Y <= bounds.MaxY
}

func cropTerrain(src [][]terrain.TileType, bounds PlanetSceneBounds) [][]terrain.TileType {
	height := bounds.MaxY - bounds.MinY + 1
	if height <= 0 {
		return [][]terrain.TileType{}
	}
	out := make([][]terrain.TileType, 0, height)
	for y := bounds.MinY; y <= bounds.MaxY && y < len(src); y++ {
		row := src[y]
		if len(row) == 0 {
			out = append(out, []terrain.TileType{})
			continue
		}
		maxX := bounds.MaxX
		if maxX >= len(row) {
			maxX = len(row) - 1
		}
		clipped := append([]terrain.TileType(nil), row[bounds.MinX:maxX+1]...)
		out = append(out, clipped)
	}
	return out
}

func cropBoolGrid(src [][]bool, bounds PlanetSceneBounds) [][]bool {
	height := bounds.MaxY - bounds.MinY + 1
	if height <= 0 {
		return [][]bool{}
	}
	out := make([][]bool, 0, height)
	for y := bounds.MinY; y <= bounds.MaxY && y < len(src); y++ {
		row := src[y]
		if len(row) == 0 {
			out = append(out, []bool{})
			continue
		}
		maxX := bounds.MaxX
		if maxX >= len(row) {
			maxX = len(row) - 1
		}
		clipped := append([]bool(nil), row[bounds.MinX:maxX+1]...)
		out = append(out, clipped)
	}
	return out
}

func filterBuildingsByBounds(src map[string]*model.Building, bounds PlanetSceneBounds) map[string]*model.Building {
	if len(src) == 0 {
		return map[string]*model.Building{}
	}
	out := make(map[string]*model.Building)
	for id, building := range src {
		if building != nil && inSceneBounds(building.Position, bounds) {
			out[id] = building
		}
	}
	return out
}

func filterUnitsByBounds(src map[string]*model.Unit, bounds PlanetSceneBounds) map[string]*model.Unit {
	if len(src) == 0 {
		return map[string]*model.Unit{}
	}
	out := make(map[string]*model.Unit)
	for id, unit := range src {
		if unit != nil && inSceneBounds(unit.Position, bounds) {
			out[id] = unit
		}
	}
	return out
}

func filterResourcesByBounds(src []*model.ResourceNodeState, bounds PlanetSceneBounds) []*model.ResourceNodeState {
	if len(src) == 0 {
		return []*model.ResourceNodeState{}
	}
	out := make([]*model.ResourceNodeState, 0, len(src))
	for _, resource := range src {
		if resource != nil && inSceneBounds(resource.Position, bounds) {
			out = append(out, resource)
		}
	}
	return out
}

func aggregateSceneSectors(bounds PlanetSceneBounds, visible, explored [][]bool, buildings map[string]*model.Building, units map[string]*model.Unit, resources []*model.ResourceNodeState) []PlanetSectorView {
	type key struct {
		x int
		y int
	}
	agg := make(map[key]*PlanetSectorView)
	get := func(sx, sy int) *PlanetSectorView {
		k := key{x: sx, y: sy}
		item := agg[k]
		if item == nil {
			item = &PlanetSectorView{SectorX: sx, SectorY: sy}
			agg[k] = item
		}
		return item
	}

	for id := range buildings {
		b := buildings[id]
		if b == nil || !inSceneBounds(b.Position, bounds) {
			continue
		}
		get(b.Position.X/sceneSectorSize, b.Position.Y/sceneSectorSize).BuildingCount++
	}
	for id := range units {
		u := units[id]
		if u == nil || !inSceneBounds(u.Position, bounds) {
			continue
		}
		get(u.Position.X/sceneSectorSize, u.Position.Y/sceneSectorSize).UnitCount++
	}
	for i := range resources {
		r := resources[i]
		if r == nil || !inSceneBounds(r.Position, bounds) {
			continue
		}
		get(r.Position.X/sceneSectorSize, r.Position.Y/sceneSectorSize).ResourceCount++
	}

	for y := bounds.MinY; y <= bounds.MaxY && y < len(visible) && y < len(explored); y++ {
		vRow := visible[y]
		eRow := explored[y]
		for x := bounds.MinX; x <= bounds.MaxX && x < len(vRow) && x < len(eRow); x++ {
			sector := get(x/sceneSectorSize, y/sceneSectorSize)
			if vRow[x] {
				sector.VisibleTiles++
			}
			if eRow[x] {
				sector.ExploredTiles++
			}
		}
	}

	result := make([]PlanetSectorView, 0, len(agg))
	for _, item := range agg {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].SectorY != result[j].SectorY {
			return result[i].SectorY < result[j].SectorY
		}
		return result[i].SectorX < result[j].SectorX
	})
	return result
}
