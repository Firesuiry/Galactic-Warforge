package terrain

// TileType represents the static terrain classification of a map tile.
type TileType string

const (
	TileBuildable TileType = "buildable"
	TileBlocked   TileType = "blocked"
	TileWater     TileType = "water"
	TileLava      TileType = "lava"
)

// Buildable reports whether a tile can host buildings.
func (t TileType) Buildable() bool {
	return t == TileBuildable
}
