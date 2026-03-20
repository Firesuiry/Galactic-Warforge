package mapgen

import (
	"fmt"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/terrain"
)

type resourcePalette struct {
	common []mapmodel.ResourceKind
	rare   []mapmodel.ResourceKind
}

var resourcePalettes = map[mapmodel.PlanetKind]resourcePalette{
	mapmodel.PlanetKindRocky: {
		common: []mapmodel.ResourceKind{
			mapmodel.ResourceIronOre,
			mapmodel.ResourceCopperOre,
			mapmodel.ResourceStoneOre,
			mapmodel.ResourceCoal,
			mapmodel.ResourceSiliconOre,
			mapmodel.ResourceTitaniumOre,
			mapmodel.ResourceCrudeOil,
			mapmodel.ResourceWater,
		},
		rare: []mapmodel.ResourceKind{
			mapmodel.ResourceFractalSilicon,
			mapmodel.ResourceGratingCrystal,
			mapmodel.ResourceMonopoleMagnet,
		},
	},
	mapmodel.PlanetKindIce: {
		common: []mapmodel.ResourceKind{
			mapmodel.ResourceIronOre,
			mapmodel.ResourceCopperOre,
			mapmodel.ResourceStoneOre,
			mapmodel.ResourceCoal,
			mapmodel.ResourceSiliconOre,
			mapmodel.ResourceWater,
			mapmodel.ResourceCrudeOil,
		},
		rare: []mapmodel.ResourceKind{
			mapmodel.ResourceFireIce,
			mapmodel.ResourceFractalSilicon,
			mapmodel.ResourceGratingCrystal,
		},
	},
	mapmodel.PlanetKindGasGiant: {
		common: []mapmodel.ResourceKind{
			mapmodel.ResourceFireIce,
			mapmodel.ResourceCrudeOil,
			mapmodel.ResourceWater,
		},
		rare: []mapmodel.ResourceKind{
			mapmodel.ResourceMonopoleMagnet,
		},
	},
}

func generateResources(rng *rng, planet *mapmodel.Planet, cfg mapconfig.ResourceConfig) []mapmodel.ResourceNode {
	if planet == nil || planet.Width == 0 || planet.Height == 0 || planet.ResourceDensity <= 0 {
		return nil
	}
	if len(planet.Terrain) == 0 {
		return nil
	}

	totalNodes := (planet.Width * planet.Height * planet.ResourceDensity) / 100
	if totalNodes <= 0 {
		return nil
	}

	palette, ok := resourcePalettes[planet.Kind]
	if !ok {
		palette = resourcePalettes[mapmodel.PlanetKindRocky]
	}

	clusterMin := max(1, cfg.ClusterMin)
	clusterMax := max(clusterMin, cfg.ClusterMax)
	clusterRadius := max(0, cfg.ClusterRadius)
	avgCluster := (clusterMin + clusterMax) / 2
	clusterCount := totalNodes / max(1, avgCluster)
	if clusterCount < 1 {
		clusterCount = 1
	}

	used := make([][]bool, planet.Height)
	for y := 0; y < planet.Height; y++ {
		used[y] = make([]bool, planet.Width)
	}

	nodes := make([]mapmodel.ResourceNode, 0, totalNodes)
	nodeIndex := 0
	for c := 0; c < clusterCount && nodeIndex < totalNodes; c++ {
		clusterSize := rng.RangeInt(clusterMin, clusterMax)
		remaining := totalNodes - nodeIndex
		if clusterSize > remaining {
			clusterSize = remaining
		}
		centerX, centerY, ok := findFreeBuildableTile(rng, planet.Terrain, used)
		if !ok {
			break
		}
		kind, isRare := chooseResourceKind(rng, palette, cfg.RareChance)
		behavior := resourceBehavior(kind)
		clusterID := fmt.Sprintf("%s-cluster-%d", planet.ID, c+1)

		placed := 0
		for placed < clusterSize && nodeIndex < totalNodes {
			x, y, ok := pickClusterTile(rng, centerX, centerY, clusterRadius, planet.Width, planet.Height, planet.Terrain, used)
			if !ok {
				break
			}
			nodeIndex++
			used[y][x] = true

			node := buildResourceNode(rng, planet, kind, behavior, isRare, cfg)
			node.ID = fmt.Sprintf("%s-res-%d", planet.ID, nodeIndex)
			node.Position = mapmodel.GridPos{X: x, Y: y}
			node.ClusterID = clusterID
			nodes = append(nodes, node)
			placed++
		}
	}

	return nodes
}

func chooseResourceKind(rng *rng, palette resourcePalette, rareChance float64) (mapmodel.ResourceKind, bool) {
	if len(palette.common) == 0 && len(palette.rare) == 0 {
		return mapmodel.ResourceIronOre, false
	}
	if len(palette.rare) > 0 && rng.Float64() < rareChance {
		return palette.rare[rng.Intn(len(palette.rare))], true
	}
	if len(palette.common) == 0 {
		return palette.rare[rng.Intn(len(palette.rare))], true
	}
	return palette.common[rng.Intn(len(palette.common))], false
}

func resourceBehavior(kind mapmodel.ResourceKind) mapmodel.ResourceBehavior {
	switch kind {
	case mapmodel.ResourceCrudeOil:
		return mapmodel.ResourceDecay
	case mapmodel.ResourceWater:
		return mapmodel.ResourceRenewable
	default:
		return mapmodel.ResourceFinite
	}
}

func buildResourceNode(rng *rng, planet *mapmodel.Planet, kind mapmodel.ResourceKind, behavior mapmodel.ResourceBehavior, isRare bool, cfg mapconfig.ResourceConfig) mapmodel.ResourceNode {
	node := mapmodel.ResourceNode{
		PlanetID: planet.ID,
		Kind:     kind,
		Behavior: behavior,
		IsRare:   isRare,
	}

	switch behavior {
	case mapmodel.ResourceDecay:
		node.BaseYield = rng.RangeInt(cfg.OilYieldMin, cfg.OilYieldMax)
		node.MinYield = cfg.OilMinYield
		node.DecayPerTick = cfg.OilDecayPerTick
	case mapmodel.ResourceRenewable:
		node.Total = rng.RangeInt(cfg.VeinAmountMin, cfg.VeinAmountMax)
		node.BaseYield = rng.RangeInt(cfg.VeinYieldMin, cfg.VeinYieldMax)
		node.RegenPerTick = cfg.RenewableRegenPerTick
	default:
		node.Total = rng.RangeInt(cfg.VeinAmountMin, cfg.VeinAmountMax)
		node.BaseYield = rng.RangeInt(cfg.VeinYieldMin, cfg.VeinYieldMax)
	}

	if isRare {
		node.Total = max(1, int(float64(node.Total)*0.7))
		node.BaseYield = max(1, node.BaseYield+1)
	}

	return node
}

func findFreeBuildableTile(rng *rng, terrain [][]terrain.TileType, used [][]bool) (int, int, bool) {
	height := len(terrain)
	if height == 0 {
		return 0, 0, false
	}
	width := len(terrain[0])
	attempts := width * height * 2
	for i := 0; i < attempts; i++ {
		x := rng.Intn(width)
		y := rng.Intn(height)
		if !terrain[y][x].Buildable() || used[y][x] {
			continue
		}
		return x, y, true
	}
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			if terrain[y][x].Buildable() && !used[y][x] {
				return x, y, true
			}
		}
	}
	return 0, 0, false
}

func pickClusterTile(rng *rng, centerX, centerY, radius, width, height int, terrain [][]terrain.TileType, used [][]bool) (int, int, bool) {
	if radius == 0 {
		if centerX >= 0 && centerX < width && centerY >= 0 && centerY < height && terrain[centerY][centerX].Buildable() && !used[centerY][centerX] {
			return centerX, centerY, true
		}
		return 0, 0, false
	}
	attempts := radius*radius*6 + 6
	for i := 0; i < attempts; i++ {
		dx := rng.RangeInt(-radius, radius)
		dy := rng.RangeInt(-radius, radius)
		x := centerX + dx
		y := centerY + dy
		if x < 0 || x >= width || y < 0 || y >= height {
			continue
		}
		if !terrain[y][x].Buildable() || used[y][x] {
			continue
		}
		return x, y, true
	}
	return 0, 0, false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
