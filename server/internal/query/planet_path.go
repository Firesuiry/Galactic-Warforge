package query

import (
	"fmt"
	"siliconworld/internal/model"
	"siliconworld/internal/surface"
)

// PlanetPathView is a bounded route over explored surface tiles. Commands
// revalidate each waypoint against the current authoritative world.
type PlanetPathView struct {
	PlanetID  string           `json:"planet_id"`
	Surface   surface.Metadata `json:"surface"`
	Reachable bool             `json:"reachable"`
	Distance  int              `json:"distance"`
	Path      []model.Position `json:"path"`
	Waypoints []model.Position `json:"waypoints"`
}

func (ql *Layer) PlanetPath(ws *model.WorldState, playerID, unitID string, target model.Position, stopRange int) (*PlanetPathView, error) {
	if ws == nil {
		return nil, fmt.Errorf("planet runtime not found")
	}
	ws.RLock()
	defer ws.RUnlock()
	unit := ws.Units[unitID]
	if unit == nil || unit.OwnerID != playerID {
		return nil, fmt.Errorf("own unit required")
	}
	if !ws.InBounds(target.X, target.Y) || stopRange < 0 || stopRange > 128 {
		return nil, fmt.Errorf("invalid target or stop_range (0..128)")
	}
	view := &PlanetPathView{PlanetID: ws.PlanetID, Surface: ws.Surface().Metadata(), Distance: -1, Path: []model.Position{}, Waypoints: []model.Position{}}
	explored := ql.vis.ExploredMask(ws, playerID)
	if !explored[target.Y*ws.MapWidth+target.X] {
		return view, nil
	}
	blocked := map[model.Position]bool{}
	for _, b := range ql.vis.FilterBuildings(ws, playerID) {
		tiles, err := ws.BuildingTiles(b)
		if err != nil {
			return nil, fmt.Errorf("building %s has invalid surface footprint: %w", b.ID, err)
		}
		for _, p := range tiles {
			p.Z = 0
			blocked[p] = true
		}
	}
	start := unit.Position
	start.Z = 0
	target.Z = 0
	goals := map[model.Position]bool{}
	for _, p := range ws.SurfaceDisc(target, stopRange) {
		goals[p] = true
	}
	queue := []model.Position{start}
	parents := map[model.Position]model.Position{start: start}
	depth := map[model.Position]int{start: 0}
	for head := 0; head < len(queue); head++ {
		p := queue[head]
		if goals[p] {
			path := []model.Position{p}
			for p != start {
				p = parents[p]
				path = append(path, p)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			view.Reachable = true
			view.Path = path
			view.Distance = len(path) - 1
			moveRange := max(1, unit.MoveRange)
			for i := moveRange; i < len(path); i += moveRange {
				view.Waypoints = append(view.Waypoints, path[i])
			}
			if len(path) > 1 && (len(view.Waypoints) == 0 || view.Waypoints[len(view.Waypoints)-1] != path[len(path)-1]) {
				view.Waypoints = append(view.Waypoints, path[len(path)-1])
			}
			return view, nil
		}
		if depth[p] >= 512 {
			continue
		}
		for _, n := range ws.SurfaceNeighbors(p) {
			if _, seen := parents[n]; seen {
				continue
			}
			if !explored[n.Y*ws.MapWidth+n.X] || blocked[n] || !ws.Grid[n.Y][n.X].Terrain.Buildable() {
				continue
			}
			parents[n] = p
			depth[n] = depth[p] + 1
			queue = append(queue, n)
		}
	}
	return view, nil
}
