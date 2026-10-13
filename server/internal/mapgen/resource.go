package mapgen

import (
	"fmt"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/surface"
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
			mapmodel.ResourceSulfuricAcid,
			mapmodel.ResourceLog,
			mapmodel.ResourcePlantFuel,
		},
		rare: []mapmodel.ResourceKind{
			mapmodel.ResourceFractalSilicon,
			mapmodel.ResourceGratingCrystal,
			mapmodel.ResourceMonopoleMagnet,
			mapmodel.ResourceKimberliteOre,
			mapmodel.ResourceSpiniformStalagmiteCrystal,
			mapmodel.ResourceOrganicCrystal,
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
			mapmodel.ResourceKimberliteOre,
			mapmodel.ResourceSpiniformStalagmiteCrystal,
			mapmodel.ResourceOrganicCrystal,
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

	// 细分网格：矿脉按 cell 成簇，一个"资源格"= 3×3 cell（9 个 cell）。
	// 密度是"资源格占世界面积的比例"（与细分前的语义一致，单位随网格变成
	// cell），所以先按总面积算出基准格数，再除以成簇倍数 9——这样「矿脉
	// 个数/世界面积」「矿石 cell 占比」和「全图总储量」都保持细分网格之前的
	// 量级。否则世界边长 ×3 会让基准格数 ×9，再乘 3×3 成簇就是 81 倍：实测
	// 遭遇战地图从 4.4k 涨到 25.7 万个资源 cell（占地图 52%），每 tick 的
	// 资源结算与 bot 选矿扫描都被拖慢一个数量级（整局回归 88s → 3000s+）。
	totalNodes := (planet.Width * planet.Height * planet.ResourceDensity) / (100 * resourceClusterScale)
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

			// 细分网格：一个资源格 → 3×3 左右的一簇 cell（每格与旧单格等量等产速，
			// 世界尺度上的矿脉范围与采空时间不变）。
			node := buildResourceNode(rng, planet, kind, behavior, isRare, cfg)
			node.ID = fmt.Sprintf("%s-res-%d", planet.ID, nodeIndex)
			node.Position = mapmodel.GridPos{X: x, Y: y}
			node.ClusterID = clusterID
			nodes = append(nodes, node)
			placed++

			cellCount := 1
			for _, cell := range resourceClusterCells(rng, planet, x, y, used) {
				used[cell.Y][cell.X] = true
				cellCount++
				cellNode := node
				cellNode.ID = fmt.Sprintf("%s-res-%d-%d", planet.ID, nodeIndex, cellCount)
				cellNode.Position = mapmodel.GridPos{X: cell.X, Y: cell.Y}
				nodes = append(nodes, cellNode)
			}
		}
	}

	return nodes
}

// resourceClusterScale 是细分网格下「一个资源格 = 3×3 cell」的放大倍数。
const resourceClusterScale = 9

// resourceClusterCells 为 (x,y) 处的资源格挑选最多 8 个相邻空格组成 3×3 簇。
// 邻居按 4 邻接扩展（跨面用 surface.Grid.Step），确定性且不越界。
func resourceClusterCells(rng *rng, planet *mapmodel.Planet, x, y int, used [][]bool) []surface.Tile {
	faceSize := planet.FaceSize
	if faceSize <= 0 {
		// 测试行星直接给 Width/Height（Width = 3 × face_size）。
		faceSize = planet.Width / 3
	}
	if faceSize <= 0 {
		return nil
	}
	grid := surface.Grid{Size: faceSize}
	origin := surface.Tile{X: x, Y: y}
	candidates := make([]surface.Tile, 0, 8)
	seen := map[surface.Tile]bool{origin: true}
	frontier := []surface.Tile{origin}
	for ring := 0; ring < 2 && len(candidates) < 8; ring++ {
		next := make([]surface.Tile, 0, len(frontier)*4)
		for _, t := range frontier {
			for d := surface.North; d <= surface.West; d++ {
				n, _ := grid.Step(t, d)
				if !grid.Valid(n) || seen[n] {
					continue
				}
				seen[n] = true
				next = append(next, n)
				if !planet.Terrain[n.Y][n.X].Buildable() || used[n.Y][n.X] {
					continue
				}
				candidates = append(candidates, n)
			}
		}
		frontier = next
	}
	// 确定性洗牌：同一 seed 结果一致。
	for i := len(candidates) - 1; i > 0; i-- {
		j := rng.Intn(i + 1)
		candidates[i], candidates[j] = candidates[j], candidates[i]
	}
	if len(candidates) > 8 {
		candidates = candidates[:8]
	}
	return candidates
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
	case mapmodel.ResourceWater,
		mapmodel.ResourceSulfuricAcid,
		mapmodel.ResourceLog,
		mapmodel.ResourcePlantFuel:
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
	tiles := (surface.Grid{Size: width / 3}).Disc(surface.Tile{X: centerX, Y: centerY}, radius)
	for len(tiles) > 0 {
		i := rng.Intn(len(tiles))
		tile := tiles[i]
		tiles[i] = tiles[len(tiles)-1]
		tiles = tiles[:len(tiles)-1]
		if terrain[tile.Y][tile.X].Buildable() && !used[tile.Y][tile.X] {
			return tile.X, tile.Y, true
		}
	}
	return 0, 0, false
}
