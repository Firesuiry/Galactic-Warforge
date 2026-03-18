package query

import (
	"siliconworld/internal/model"
	"siliconworld/internal/visibility"
)

// Layer provides read-only queries against the world state
type Layer struct {
	vis *visibility.Engine
}

func New(vis *visibility.Engine) *Layer {
	return &Layer{vis: vis}
}

// StateSummary is the response for GET /state/summary
type StateSummary struct {
	Tick      int64                      `json:"tick"`
	Players   map[string]*model.PlayerState `json:"players"`
	Winner    string                     `json:"winner,omitempty"`
	MapWidth  int                        `json:"map_width"`
	MapHeight int                        `json:"map_height"`
}

// Summary returns a high-level view of the world (no fog clipping for own resources)
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
		Tick:      ws.Tick,
		Players:   players,
		Winner:    winner,
		MapWidth:  ws.MapWidth,
		MapHeight: ws.MapHeight,
	}
}

// GalaxyView is a simplified galaxy overview
type GalaxyView struct {
	Name    string      `json:"name"`
	Systems []SystemRef `json:"systems"`
}

type SystemRef struct {
	SystemID string `json:"system_id"`
	Name     string `json:"name"`
}

// Galaxy returns galaxy overview (MVP: single system)
func (ql *Layer) Galaxy() *GalaxyView {
	return &GalaxyView{
		Name: "Silicon Galaxy",
		Systems: []SystemRef{
			{SystemID: "sys-1", Name: "Alpha System"},
		},
	}
}

// SystemView is a stellar system view
type SystemView struct {
	SystemID string      `json:"system_id"`
	Name     string      `json:"name"`
	Planets  []PlanetRef `json:"planets"`
}

type PlanetRef struct {
	PlanetID string `json:"planet_id"`
	Name     string `json:"name"`
}

// System returns a single system overview (MVP: single planet)
func (ql *Layer) System(systemID string) *SystemView {
	return &SystemView{
		SystemID: systemID,
		Name:     "Alpha System",
		Planets: []PlanetRef{
			{PlanetID: "planet-1", Name: "Silicon Prime"},
		},
	}
}

// PlanetView is the detailed planet view including fog-clipped entities
type PlanetView struct {
	PlanetID  string                     `json:"planet_id"`
	MapWidth  int                        `json:"map_width"`
	MapHeight int                        `json:"map_height"`
	Tick      int64                      `json:"tick"`
	Buildings map[string]*model.Building `json:"buildings"`
	Units     map[string]*model.Unit     `json:"units"`
}

// Planet returns the detailed planet view filtered by player visibility
func (ql *Layer) Planet(ws *model.WorldState, playerID string) *PlanetView {
	ws.RLock()
	defer ws.RUnlock()

	buildings := ql.vis.FilterBuildings(ws, playerID)
	units := ql.vis.FilterUnits(ws, playerID)

	return &PlanetView{
		PlanetID:  "planet-1",
		MapWidth:  ws.MapWidth,
		MapHeight: ws.MapHeight,
		Tick:      ws.Tick,
		Buildings: buildings,
		Units:     units,
	}
}

// FogMapView is the fog-of-war grid
type FogMapView struct {
	PlanetID  string   `json:"planet_id"`
	MapWidth  int      `json:"map_width"`
	MapHeight int      `json:"map_height"`
	Visible   [][]bool `json:"visible"`
}

// FogMap returns the visibility grid for a player
func (ql *Layer) FogMap(ws *model.WorldState, playerID string) *FogMapView {
	ws.RLock()
	defer ws.RUnlock()

	return &FogMapView{
		PlanetID:  "planet-1",
		MapWidth:  ws.MapWidth,
		MapHeight: ws.MapHeight,
		Visible:   ql.vis.FogMap(ws, playerID),
	}
}
