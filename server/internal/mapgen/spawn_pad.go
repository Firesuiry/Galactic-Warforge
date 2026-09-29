package mapgen

import (
	"fmt"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

// spawnPadElevation lifts ocean/low pads so a corrected spawn is not a pit.
const spawnPadElevation float32 = 0.4

// ensureSpawnPads makes each explicit spawn tile and its sphere neighbors buildable.
// Only those tiles are rewritten; continents are not flattened.
func ensureSpawnPads(u *mapmodel.Universe) {
	if u == nil {
		return
	}
	planet := u.PrimaryPlanet()
	if planet == nil || planet.FaceSize < 1 || len(planet.SpawnPoints) == 0 {
		return
	}
	grid := surface.Grid{Size: planet.FaceSize}
	for _, sp := range planet.SpawnPoints {
		tile := surface.Tile{X: sp.X, Y: sp.Y}
		if !grid.Valid(tile) {
			continue
		}
		markBuildablePad(planet, tile)
		for _, neighbor := range grid.Neighbors(tile) {
			markBuildablePad(planet, neighbor)
		}
	}
}

func markBuildablePad(planet *mapmodel.Planet, tile surface.Tile) {
	if planet == nil || tile.Y < 0 || tile.Y >= len(planet.Terrain) || tile.X < 0 || tile.X >= len(planet.Terrain[tile.Y]) {
		return
	}
	planet.Terrain[tile.Y][tile.X] = terrain.TileBuildable
	if tile.Y < len(planet.Elevation) && tile.X < len(planet.Elevation[tile.Y]) && planet.Elevation[tile.Y][tile.X] < spawnPadElevation {
		planet.Elevation[tile.Y][tile.X] = spawnPadElevation
	}
}

// contestedCenterTile is the spherical midpoint of the first two spawn points.
func contestedCenterTile(planet *mapmodel.Planet) surface.Tile {
	grid := surface.Grid{Size: planet.FaceSize}
	a := surface.Tile{X: planet.SpawnPoints[0].X, Y: planet.SpawnPoints[0].Y}
	b := surface.Tile{X: planet.SpawnPoints[1].X, Y: planet.SpawnPoints[1].Y}
	na := grid.Normal(a)
	nb := grid.Normal(b)
	sx, sy, sz := na[0]+nb[0], na[1]+nb[1], na[2]+nb[2]
	if sx*sx+sy*sy+sz*sz < 1e-12 {
		return a
	}
	return grid.FromVector(sx, sy, sz)
}

// placeContestedCenter drops a small iron/copper cluster at the spawn midpoint.
func placeContestedCenter(planet *mapmodel.Planet, cfg mapconfig.ResourceConfig) {
	if planet == nil || !cfg.ContestedCenter || len(planet.SpawnPoints) < 2 || planet.FaceSize < 1 {
		return
	}
	grid := surface.Grid{Size: planet.FaceSize}
	center := contestedCenterTile(planet)
	if !grid.Valid(center) {
		return
	}
	occupied := make(map[mapmodel.GridPos]bool, len(planet.Resources))
	for _, node := range planet.Resources {
		occupied[node.Position] = true
	}
	rng := newRNG(fmt.Sprintf("contested:%d", planet.Seed))
	kinds := []mapmodel.ResourceKind{
		mapmodel.ResourceIronOre,
		mapmodel.ResourceCopperOre,
		mapmodel.ResourceIronOre,
		mapmodel.ResourceCopperOre,
	}
	placed := 0
	for _, tile := range grid.Disc(center, 3) {
		if placed >= len(kinds) {
			break
		}
		pos := mapmodel.GridPos{X: tile.X, Y: tile.Y}
		if occupied[pos] {
			continue
		}
		markBuildablePad(planet, tile)
		kind := kinds[placed]
		node := buildResourceNode(rng, planet, kind, mapmodel.ResourceFinite, false, cfg)
		placed++
		node.ID = fmt.Sprintf("%s-contest-%d", planet.ID, placed)
		node.Position = pos
		node.ClusterID = planet.ID + "-contested"
		planet.Resources = append(planet.Resources, node)
		occupied[pos] = true
	}
}
