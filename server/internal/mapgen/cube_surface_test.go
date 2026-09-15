package mapgen

import (
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
	"testing"
)

func TestResourceClusterCrossesFaceSeam(t *testing.T) {
	grid := surface.Grid{Size: 4}
	center := surface.Tile{X: 0, Y: 2}
	neighbor, _ := grid.Step(center, surface.West)
	tiles := make([][]terrain.TileType, grid.Height())
	used := make([][]bool, grid.Height())
	for y := range tiles {
		tiles[y] = make([]terrain.TileType, grid.Width())
		used[y] = make([]bool, grid.Width())
		for x := range tiles[y] {
			tiles[y][x] = terrain.TileBlocked
		}
	}
	tiles[neighbor.Y][neighbor.X] = terrain.TileBuildable
	x, y, ok := pickClusterTile(newRNG("seam"), center.X, center.Y, 1, grid.Width(), grid.Height(), tiles, used)
	if !ok || x != neighbor.X || y != neighbor.Y {
		t.Fatalf("cluster cannot cross seam: %d,%d %v", x, y, ok)
	}
}
