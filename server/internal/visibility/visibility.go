package visibility

import (
	"sync"

	"siliconworld/internal/model"
)

// Engine caches per-player visibility and explored state, updating incrementally.
type Engine struct {
	mu      sync.Mutex
	planets map[string]*planetState
}

type planetState struct {
	width   int
	height  int
	players map[string]*playerState
}

type playerState struct {
	width    int
	height   int
	lastTick int64
	sources  map[string]visionSource
	coverage []int
	visible  []bool
	explored []bool
}

type visionSource struct {
	x int
	y int
	r int
}

// FogState is the visibility snapshot for a player.
type FogState struct {
	Visible  [][]bool `json:"visible"`
	Explored [][]bool `json:"explored"`
}

func New() *Engine {
	return &Engine{
		planets: make(map[string]*planetState),
	}
}

// FilterEvent returns true if the event should be delivered to a given player.
func (e *Engine) FilterEvent(evt *model.GameEvent, playerID string) bool {
	if evt.VisibilityScope == "all" {
		return true
	}
	if evt.VisibilityScope == playerID {
		return true
	}
	return false
}

// IsVisible checks whether a position is currently visible to a player.
func (e *Engine) IsVisible(ws *model.WorldState, playerID string, pos model.Position) bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	ps := e.ensurePlayerLocked(ws, playerID)
	e.syncPlayerLocked(ws, playerID, ps)
	if pos.X < 0 || pos.Y < 0 || pos.X >= ps.width || pos.Y >= ps.height {
		return false
	}
	return ps.visible[pos.Y*ps.width+pos.X]
}

// FilterBuildings returns buildings visible to a player (own buildings always visible).
func (e *Engine) FilterBuildings(ws *model.WorldState, playerID string) map[string]*model.Building {
	e.mu.Lock()
	defer e.mu.Unlock()

	ps := e.ensurePlayerLocked(ws, playerID)
	e.syncPlayerLocked(ws, playerID, ps)

	result := make(map[string]*model.Building)
	for id, b := range ws.Buildings {
		if b.OwnerID == playerID || ps.isVisible(b.Position) {
			result[id] = b
		}
	}
	return result
}

// FilterUnits returns units visible to a player (own units always visible).
func (e *Engine) FilterUnits(ws *model.WorldState, playerID string) map[string]*model.Unit {
	e.mu.Lock()
	defer e.mu.Unlock()

	ps := e.ensurePlayerLocked(ws, playerID)
	e.syncPlayerLocked(ws, playerID, ps)

	result := make(map[string]*model.Unit)
	for id, u := range ws.Units {
		if u.OwnerID == playerID || ps.isVisible(u.Position) {
			result[id] = u
		}
	}
	return result
}

// FogState returns the current visible/explored grids for a player.
func (e *Engine) FogState(ws *model.WorldState, playerID string) FogState {
	e.mu.Lock()
	defer e.mu.Unlock()

	ps := e.ensurePlayerLocked(ws, playerID)
	e.syncPlayerLocked(ws, playerID, ps)

	return FogState{
		Visible:  copyGrid(ps.visible, ps.width, ps.height),
		Explored: copyGrid(ps.explored, ps.width, ps.height),
	}
}

// ExploredSnapshot returns the explored grid for a player on a planet without recomputing visibility.
func (e *Engine) ExploredSnapshot(planetID string, width, height int, playerID string) [][]bool {
	e.mu.Lock()
	defer e.mu.Unlock()

	planet, ok := e.planets[planetID]
	if !ok || planet.width != width || planet.height != height {
		return blankGrid(width, height)
	}
	ps := planet.players[playerID]
	if ps == nil {
		return blankGrid(width, height)
	}
	return copyGrid(ps.explored, ps.width, ps.height)
}

func (e *Engine) ensurePlayerLocked(ws *model.WorldState, playerID string) *playerState {
	planet := e.ensurePlanetLocked(ws.PlanetID, ws.MapWidth, ws.MapHeight)
	ps := planet.players[playerID]
	if ps == nil {
		ps = newPlayerState(ws.MapWidth, ws.MapHeight)
		planet.players[playerID] = ps
	}
	return ps
}

func (e *Engine) ensurePlanetLocked(planetID string, width, height int) *planetState {
	planet := e.planets[planetID]
	if planet == nil || planet.width != width || planet.height != height {
		planet = &planetState{
			width:   width,
			height:  height,
			players: make(map[string]*playerState),
		}
		e.planets[planetID] = planet
	}
	return planet
}

func newPlayerState(width, height int) *playerState {
	size := width * height
	return &playerState{
		width:    width,
		height:   height,
		lastTick: -1,
		sources:  make(map[string]visionSource),
		coverage: make([]int, size),
		visible:  make([]bool, size),
		explored: make([]bool, size),
	}
}

func (ps *playerState) isVisible(pos model.Position) bool {
	if pos.X < 0 || pos.Y < 0 || pos.X >= ps.width || pos.Y >= ps.height {
		return false
	}
	return ps.visible[pos.Y*ps.width+pos.X]
}

func (e *Engine) syncPlayerLocked(ws *model.WorldState, playerID string, ps *playerState) {
	if ps.lastTick == ws.Tick {
		return
	}

	current := make(map[string]visionSource, len(ws.Buildings)+len(ws.Units))
	for id, b := range ws.Buildings {
		if b.OwnerID != playerID {
			continue
		}
		current[id] = visionSource{x: b.Position.X, y: b.Position.Y, r: b.VisionRange}
	}
	for id, u := range ws.Units {
		if u.OwnerID != playerID {
			continue
		}
		current[id] = visionSource{x: u.Position.X, y: u.Position.Y, r: u.VisionRange}
	}

	for id, src := range current {
		if prev, ok := ps.sources[id]; ok {
			if prev != src {
				ps.applySource(prev, -1)
				ps.applySource(src, 1)
				ps.sources[id] = src
			}
			continue
		}
		ps.applySource(src, 1)
		ps.sources[id] = src
	}

	for id, prev := range ps.sources {
		if _, ok := current[id]; !ok {
			ps.applySource(prev, -1)
			delete(ps.sources, id)
		}
	}

	ps.lastTick = ws.Tick
}

func (ps *playerState) applySource(src visionSource, delta int) {
	if delta == 0 {
		return
	}
	r := src.r
	if r < 0 {
		return
	}
	r2 := r * r
	for dy := -r; dy <= r; dy++ {
		for dx := -r; dx <= r; dx++ {
			if dx*dx+dy*dy > r2 {
				continue
			}
			x := src.x + dx
			y := src.y + dy
			if x < 0 || y < 0 || x >= ps.width || y >= ps.height {
				continue
			}
			idx := y*ps.width + x
			old := ps.coverage[idx]
			newVal := old + delta
			if newVal < 0 {
				newVal = 0
			}
			ps.coverage[idx] = newVal
			if old == 0 && newVal > 0 {
				ps.visible[idx] = true
				ps.explored[idx] = true
			} else if old > 0 && newVal == 0 {
				ps.visible[idx] = false
			}
		}
	}
}

func copyGrid(flat []bool, width, height int) [][]bool {
	if width <= 0 || height <= 0 {
		return [][]bool{}
	}
	grid := make([][]bool, height)
	for y := 0; y < height; y++ {
		row := make([]bool, width)
		copy(row, flat[y*width:(y+1)*width])
		grid[y] = row
	}
	return grid
}

func blankGrid(width, height int) [][]bool {
	if width <= 0 || height <= 0 {
		return [][]bool{}
	}
	grid := make([][]bool, height)
	for y := 0; y < height; y++ {
		grid[y] = make([]bool, width)
	}
	return grid
}
