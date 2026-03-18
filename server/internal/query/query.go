package query

import (
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/mapstate"
	"siliconworld/internal/model"
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
	Tick            int64                      `json:"tick"`
	Players         map[string]*model.PlayerState `json:"players"`
	Winner          string                     `json:"winner,omitempty"`
	ActivePlanetID  string                     `json:"active_planet_id"`
	MapWidth        int                        `json:"map_width"`
	MapHeight       int                        `json:"map_height"`
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
			players[pid] = &cp
		} else {
			// Expose only alive status
			players[pid] = &model.PlayerState{PlayerID: pid, IsAlive: ps.IsAlive}
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
	GalaxyID   string      `json:"galaxy_id"`
	Name       string      `json:"name,omitempty"`
	Discovered bool        `json:"discovered"`
	Systems    []SystemRef `json:"systems,omitempty"`
}

type SystemRef struct {
	SystemID   string `json:"system_id"`
	Name       string `json:"name,omitempty"`
	Discovered bool   `json:"discovered"`
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
	systems := make([]SystemRef, 0, len(galaxy.SystemIDs))
	for _, sysID := range galaxy.SystemIDs {
		sys := ql.maps.Systems[sysID]
		sysDiscovered := ql.discovery.IsSystemDiscovered(playerID, sysID)
		sysName := ""
		if sysDiscovered && sys != nil {
			sysName = sys.Name
		}
		systems = append(systems, SystemRef{
			SystemID:   sysID,
			Name:       sysName,
			Discovered: sysDiscovered,
		})
	}

	return &GalaxyView{
		GalaxyID:   galaxy.ID,
		Name:       name,
		Discovered: discovered,
		Systems:    systems,
	}
}

// SystemView is a stellar system view.
type SystemView struct {
	SystemID   string      `json:"system_id"`
	Name       string      `json:"name,omitempty"`
	Discovered bool        `json:"discovered"`
	Planets    []PlanetRef `json:"planets,omitempty"`
}

type PlanetRef struct {
	PlanetID   string `json:"planet_id"`
	Name       string `json:"name,omitempty"`
	Discovered bool   `json:"discovered"`
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
	planets := make([]PlanetRef, 0, len(sys.PlanetIDs))
	for _, pid := range sys.PlanetIDs {
		planet := ql.maps.Planets[pid]
		pDiscovered := ql.discovery.IsPlanetDiscovered(playerID, pid)
		pName := ""
		if pDiscovered && planet != nil {
			pName = planet.Name
		}
		planets = append(planets, PlanetRef{
			PlanetID:   pid,
			Name:       pName,
			Discovered: pDiscovered,
		})
	}
	view.Planets = planets
	return view, true
}

// PlanetView is the detailed planet view including fog-clipped entities.
type PlanetView struct {
	PlanetID   string                     `json:"planet_id"`
	Name       string                     `json:"name,omitempty"`
	Discovered bool                       `json:"discovered"`
	MapWidth   int                        `json:"map_width"`
	MapHeight  int                        `json:"map_height"`
	Tick       int64                      `json:"tick"`
	Buildings  map[string]*model.Building `json:"buildings,omitempty"`
	Units      map[string]*model.Unit     `json:"units,omitempty"`
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
	view.MapWidth = planet.Width
	view.MapHeight = planet.Height
	view.Tick = ws.Tick

	if ws.PlanetID == planetID {
		view.Buildings = ql.vis.FilterBuildings(ws, playerID)
		view.Units = ql.vis.FilterUnits(ws, playerID)
	} else {
		view.Buildings = map[string]*model.Building{}
		view.Units = map[string]*model.Unit{}
	}

	return view, true
}

// FogMapView is the fog-of-war grid.
type FogMapView struct {
	PlanetID   string   `json:"planet_id"`
	Discovered bool     `json:"discovered"`
	MapWidth   int      `json:"map_width"`
	MapHeight  int      `json:"map_height"`
	Visible    [][]bool `json:"visible,omitempty"`
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
		view.Visible = ql.vis.FogMap(ws, playerID)
	} else {
		view.Visible = blankFog(planet.Width, planet.Height)
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
