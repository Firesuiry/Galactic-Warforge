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

// PlanetSummaryView is a lightweight planet snapshot for list/overview usage.
type PlanetSummaryView struct {
	PlanetID      string              `json:"planet_id"`
	Name          string              `json:"name,omitempty"`
	Discovered    bool                `json:"discovered"`
	Kind          mapmodel.PlanetKind `json:"kind,omitempty"`
	MapWidth      int                 `json:"map_width"`
	MapHeight     int                 `json:"map_height"`
	Tick          int64               `json:"tick"`
	BuildingCount int                 `json:"building_count"`
	UnitCount     int                 `json:"unit_count"`
	ResourceCount int                 `json:"resource_count"`
}

// PlanetSummary returns a lightweight planet summary without heavy map payloads.
func (ql *Layer) PlanetSummary(ws *model.WorldState, playerID, planetID string) (*PlanetSummaryView, bool) {
	planet, ok := ql.maps.Planet(planetID)
	if !ok {
		return nil, false
	}
	discovered := ql.discovery.IsPlanetDiscovered(playerID, planetID)
	view := &PlanetSummaryView{
		PlanetID:   planet.ID,
		Discovered: discovered,
	}
	if !discovered {
		return view, true
	}

	view.Name = planet.Name
	view.Kind = planet.Kind
	view.MapWidth = planet.Width
	view.MapHeight = planet.Height

	if ws == nil {
		view.ResourceCount = len(planet.Resources)
		return view, true
	}

	ws.RLock()
	defer ws.RUnlock()
	view.Tick = ws.Tick

	if ws.PlanetID == planetID {
		view.BuildingCount = len(ws.Buildings)
		view.UnitCount = len(ws.Units)
		view.ResourceCount = len(sortedResources(ws))
		return view, true
	}

	view.ResourceCount = len(planet.Resources)
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
