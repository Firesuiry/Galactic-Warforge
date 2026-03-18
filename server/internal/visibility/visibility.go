package visibility

import (
	"siliconworld/internal/model"
)

// Engine computes per-player visibility (fog of war)
type Engine struct{}

func New() *Engine { return &Engine{} }

// VisibleTiles returns the set of tile keys visible to a player
func (e *Engine) VisibleTiles(ws *model.WorldState, playerID string) map[string]bool {
	visible := make(map[string]bool)

	for _, b := range ws.Buildings {
		if b.OwnerID != playerID {
			continue
		}
		e.addCircle(visible, ws, b.Position, b.VisionRange)
	}
	for _, u := range ws.Units {
		if u.OwnerID != playerID {
			continue
		}
		e.addCircle(visible, ws, u.Position, u.VisionRange)
	}
	return visible
}

func (e *Engine) addCircle(visible map[string]bool, ws *model.WorldState, center model.Position, radius int) {
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			if dx*dx+dy*dy > radius*radius {
				continue
			}
			x, y := center.X+dx, center.Y+dy
			if ws.InBounds(x, y) {
				visible[model.TileKey(x, y)] = true
			}
		}
	}
}

// FilterBuildings returns buildings visible to a player
func (e *Engine) FilterBuildings(ws *model.WorldState, playerID string) map[string]*model.Building {
	visible := e.VisibleTiles(ws, playerID)
	result := make(map[string]*model.Building)
	for id, b := range ws.Buildings {
		key := model.TileKey(b.Position.X, b.Position.Y)
		if visible[key] || b.OwnerID == playerID {
			result[id] = b
		}
	}
	return result
}

// FilterUnits returns units visible to a player
func (e *Engine) FilterUnits(ws *model.WorldState, playerID string) map[string]*model.Unit {
	visible := e.VisibleTiles(ws, playerID)
	result := make(map[string]*model.Unit)
	for id, u := range ws.Units {
		key := model.TileKey(u.Position.X, u.Position.Y)
		if visible[key] || u.OwnerID == playerID {
			result[id] = u
		}
	}
	return result
}

// FilterEvent returns true if the event should be delivered to a given player
func (e *Engine) FilterEvent(ws *model.WorldState, evt *model.GameEvent, playerID string) bool {
	if evt.VisibilityScope == "all" {
		return true
	}
	if evt.VisibilityScope == playerID {
		return true
	}
	return false
}

// FogMap returns a 2D visibility grid for a player (true = visible)
func (e *Engine) FogMap(ws *model.WorldState, playerID string) [][]bool {
	visible := e.VisibleTiles(ws, playerID)
	fog := make([][]bool, ws.MapHeight)
	for y := range fog {
		fog[y] = make([]bool, ws.MapWidth)
		for x := range fog[y] {
			fog[y][x] = visible[model.TileKey(x, y)]
		}
	}
	return fog
}
