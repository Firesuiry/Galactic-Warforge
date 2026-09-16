package query

import (
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

// sliceWorldTerrain exposes authoritative terrain after foundation construction
// or demolition; generated map terrain remains the source for inactive worlds.
func sliceWorldTerrain(ws *model.WorldState, bounds SceneBounds) [][]terrain.TileType {
	out := make([][]terrain.TileType, bounds.Height)
	for y := 0; y < bounds.Height; y++ {
		out[y] = make([]terrain.TileType, bounds.Width)
		for x := 0; x < bounds.Width; x++ {
			out[y][x] = ws.Grid[bounds.Y+y][bounds.X+x].Terrain
		}
	}
	return out
}
