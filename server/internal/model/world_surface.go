package model

import "siliconworld/internal/surface"

// Surface is the authoritative cube-sphere topology of this planet.
func (ws *WorldState) Surface() surface.Grid { return surface.Grid{Size: ws.MapWidth / 3} }
func (ws *WorldState) SurfaceDistance(a, b Position) int {
	return ws.Surface().Distance(surface.Tile{X: a.X, Y: a.Y}, surface.Tile{X: b.X, Y: b.Y})
}
func (ws *WorldState) SurfaceStep(pos Position, dir ConveyorDirection) (Position, ConveyorDirection) {
	dirs := [...]ConveyorDirection{ConveyorNorth, ConveyorEast, ConveyorSouth, ConveyorWest}
	for d, candidate := range dirs {
		if candidate == dir {
			tile, next := ws.Surface().Step(surface.Tile{X: pos.X, Y: pos.Y}, surface.Direction(d))
			return Position{X: tile.X, Y: tile.Y, Z: pos.Z}, dirs[int(next)]
		}
	}
	panic("surface step requires a cardinal direction")
}
func (ws *WorldState) SurfaceNeighbors(pos Position) []Position {
	tiles := ws.Surface().Neighbors(surface.Tile{X: pos.X, Y: pos.Y})
	out := make([]Position, len(tiles))
	for i, t := range tiles {
		out[i] = Position{X: t.X, Y: t.Y, Z: pos.Z}
	}
	return out
}
func (ws *WorldState) SurfaceDisc(pos Position, radius int) []Position {
	tiles := ws.Surface().Disc(surface.Tile{X: pos.X, Y: pos.Y}, radius)
	out := make([]Position, len(tiles))
	for i, t := range tiles {
		out[i] = Position{X: t.X, Y: t.Y, Z: pos.Z}
	}
	return out
}

// SurfaceOffset transports a local offset across face seams, first along X,
// then along the transported Y axis.
func (ws *WorldState) SurfaceOffset(pos Position, dx, dy int) Position {
	t := ws.Surface().Offset(surface.Tile{X: pos.X, Y: pos.Y}, dx, dy)
	return Position{X: t.X, Y: t.Y, Z: pos.Z}
}

// SurfacePath finds a shortest walkable route within the movement budget.
// The start may contain a building (newly deployed units); all subsequent
// tiles must be free of buildings and impassable terrain.
func (ws *WorldState) SurfacePath(start, target Position, budget int) ([]Position, bool) {
	if !ws.InBounds(start.X, start.Y) || !ws.InBounds(target.X, target.Y) || budget < 0 {
		return nil, false
	}
	start.Z = 0
	target.Z = 0
	queue := []Position{start}
	parents := map[Position]Position{start: start}
	depths := map[Position]int{start: 0}
	for head := 0; head < len(queue); head++ {
		p := queue[head]
		if p == target {
			path := []Position{p}
			for p != start {
				p = parents[p]
				path = append(path, p)
			}
			for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
				path[i], path[j] = path[j], path[i]
			}
			return path, true
		}
		if depths[p] >= budget {
			continue
		}
		for _, n := range ws.SurfaceNeighbors(p) {
			if _, seen := parents[n]; seen {
				continue
			}
			if ws.TileBuilding[TileKey(n.X, n.Y)] != "" {
				continue
			}
			if !ws.Grid[n.Y][n.X].Terrain.Buildable() {
				continue
			}
			parents[n] = p
			depths[n] = depths[p] + 1
			queue = append(queue, n)
		}
	}
	return nil, false
}

// SurfaceBoundsSingleFace checks whether an atlas rectangle is a single local
// chart, as required by blueprint rotation and rectangular selection.
func (ws *WorldState) SurfaceBoundsSingleFace(b BlueprintBounds) bool {
	return ws.Surface().SingleFace(surface.Tile{X: b.MinX, Y: b.MinY}, surface.Tile{X: b.MaxX, Y: b.MaxY})
}

func (ws *WorldState) SurfaceWithin(a, b Position, r int) bool {
	return ws.Surface().Within(surface.Tile{X: a.X, Y: a.Y}, surface.Tile{X: b.X, Y: b.Y}, r)
}

// SurfaceOffsetDirection transports a building-local direction into the frame
// of its offset port, following the same path as SurfaceOffset.
func (ws *WorldState) SurfaceOffsetDirection(pos Position, dx, dy int, dir ConveyorDirection) ConveyorDirection {
	xd, yd := ConveyorEast, ConveyorSouth
	if dx < 0 {
		xd = ConveyorWest
		dx = -dx
	}
	if dy < 0 {
		yd = ConveyorNorth
		dy = -dy
	}
	for i := 0; i < dx; i++ {
		var forward ConveyorDirection
		pos, forward = ws.SurfaceStep(pos, xd)
		for xd != forward {
			xd = xd.Right()
			yd = yd.Right()
			dir = dir.Right()
		}
	}
	for i := 0; i < dy; i++ {
		var forward ConveyorDirection
		pos, forward = ws.SurfaceStep(pos, yd)
		for yd != forward {
			yd = yd.Right()
			dir = dir.Right()
		}
	}
	return dir
}
