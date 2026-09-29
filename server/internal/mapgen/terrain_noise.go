package mapgen

import (
	"math"
	"sort"
	"sync"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

// generateTerrain samples fractal noise on cube-sphere directions
// (normalize(N + tan(u)U + tan(v)V)) and classifies tiles by quantile so
// configured ratios are hit without atlas-space salt noise.
// The noise seed is drawn from planetRNG; coordinates are a pure function of that seed.
func generateTerrain(rng *rng, cfg mapconfig.TerrainConfig, width, height int) ([][]terrain.TileType, [][]float32) {
	water := valueOr(cfg.WaterRatio, 0.12)
	lava := valueOr(cfg.LavaRatio, 0.04)
	blocked := valueOr(cfg.BlockedRatio, 0.08)
	faceSize := width / 3
	if faceSize < 1 || width != 3*faceSize || height != 2*faceSize {
		return flatTerrain(width, height), flatElevation(width, height)
	}

	n := width * height
	elev := make([]float32, n)
	heat := make([]float32, n)
	seed := rng.next()
	heatSeed := seed ^ 0x9E3779B97F4A7C15
	fillSphereNoise(faceSize, width, elev, heat, seed, heatSeed)

	types := classifyTerrain(elev, heat, water, lava, blocked)
	grid := make([][]terrain.TileType, height)
	heightGrid := normalizeElevation(elev, width, height)
	for y := 0; y < height; y++ {
		row := make([]terrain.TileType, width)
		copy(row, types[y*width:(y+1)*width])
		grid[y] = row
	}
	return grid, heightGrid
}

func flatTerrain(width, height int) [][]terrain.TileType {
	grid := make([][]terrain.TileType, height)
	for y := 0; y < height; y++ {
		row := make([]terrain.TileType, width)
		for x := range row {
			row[x] = terrain.TileBuildable
		}
		grid[y] = row
	}
	return grid
}

func flatElevation(width, height int) [][]float32 {
	grid := make([][]float32, height)
	for y := 0; y < height; y++ {
		grid[y] = make([]float32, width)
	}
	return grid
}

func fillSphereNoise(faceSize, width int, elev, heat []float32, seed, heatSeed uint64) {
	grid := surface.Grid{Size: faceSize}
	var wg sync.WaitGroup
	for face := 0; face < 6; face++ {
		wg.Add(1)
		originX := (face % 3) * faceSize
		originY := (face / 3) * faceSize
		go func(originX, originY int) {
			defer wg.Done()
			for y := 0; y < faceSize; y++ {
				row := (originY + y) * width
				for x := 0; x < faceSize; x++ {
					dir := grid.Normal(surface.Tile{X: originX + x, Y: originY + y})
					i := row + originX + x
					elev[i] = float32(fbm3(dir[0], dir[1], dir[2], 1.25, seed))
					heat[i] = float32(fbm3(dir[0]+17.2, dir[1]-9.4, dir[2]+3.7, 4.6, heatSeed))
				}
			}
		}(originX, originY)
	}
	wg.Wait()
}

func classifyTerrain(elev, heat []float32, water, lava, blocked float64) []terrain.TileType {
	n := len(elev)
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	sort.Slice(order, func(i, j int) bool {
		if elev[order[i]] == elev[order[j]] {
			return order[i] < order[j]
		}
		return elev[order[i]] < elev[order[j]]
	})
	waterN := roundCount(water, n)
	lavaN := roundCount(lava, n)
	blockedN := roundCount(blocked, n)
	if waterN > n {
		waterN = n
	}
	if waterN+blockedN > n {
		blockedN = n - waterN
	}
	if waterN+blockedN+lavaN > n {
		lavaN = n - waterN - blockedN
	}

	types := make([]terrain.TileType, n)
	for i := range types {
		types[i] = terrain.TileBuildable
	}
	for i := 0; i < waterN; i++ {
		types[order[i]] = terrain.TileWater
	}
	for i, taken := n-1, 0; i >= waterN && taken < blockedN; i-- {
		types[order[i]] = terrain.TileBlocked
		taken++
	}
	heatOrder := make([]int, 0, n-waterN-blockedN)
	for i, kind := range types {
		if kind == terrain.TileBuildable {
			heatOrder = append(heatOrder, i)
		}
	}
	sort.Slice(heatOrder, func(i, j int) bool {
		if heat[heatOrder[i]] == heat[heatOrder[j]] {
			return heatOrder[i] < heatOrder[j]
		}
		return heat[heatOrder[i]] > heat[heatOrder[j]]
	})
	if lavaN > len(heatOrder) {
		lavaN = len(heatOrder)
	}
	for i := 0; i < lavaN; i++ {
		types[heatOrder[i]] = terrain.TileLava
	}
	return types
}

func roundCount(ratio float64, n int) int {
	if ratio <= 0 || n <= 0 {
		return 0
	}
	count := int(math.Round(ratio * float64(n)))
	if count < 0 {
		return 0
	}
	if count > n {
		return n
	}
	return count
}

func normalizeElevation(elev []float32, width, height int) [][]float32 {
	minV, maxV := elev[0], elev[0]
	for _, v := range elev {
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	span := maxV - minV
	if span < 1e-6 {
		span = 1
	}
	grid := make([][]float32, height)
	for y := 0; y < height; y++ {
		row := make([]float32, width)
		base := y * width
		for x := 0; x < width; x++ {
			row[x] = (elev[base+x] - minV) / span
		}
		grid[y] = row
	}
	return grid
}

func hash3(ix, iy, iz int32, seed uint64) float64 {
	h := seed
	h ^= uint64(uint32(ix)) * 0x9E3779B185EBCA87
	h ^= uint64(uint32(iy)) * 0xC2B2AE3D27D4EB4F
	h ^= uint64(uint32(iz)) * 0x165667B19E3779F9
	h ^= h >> 33
	h *= 0xFF51AFD7ED558CCD
	h ^= h >> 33
	return float64(h>>11) / (1 << 53)
}

func valueNoise3(x, y, z float64, seed uint64) float64 {
	x0 := math.Floor(x)
	y0 := math.Floor(y)
	z0 := math.Floor(z)
	tx := x - x0
	ty := y - y0
	tz := z - z0
	tx = tx * tx * (3 - 2*tx)
	ty = ty * ty * (3 - 2*ty)
	tz = tz * tz * (3 - 2*tz)
	ix, iy, iz := int32(x0), int32(y0), int32(z0)
	n := func(dx, dy, dz int32) float64 {
		return hash3(ix+dx, iy+dy, iz+dz, seed)
	}
	c00 := lerp(n(0, 0, 0), n(1, 0, 0), tx)
	c10 := lerp(n(0, 1, 0), n(1, 1, 0), tx)
	c01 := lerp(n(0, 0, 1), n(1, 0, 1), tx)
	c11 := lerp(n(0, 1, 1), n(1, 1, 1), tx)
	return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz)
}

func lerp(a, b, t float64) float64 {
	return a + (b-a)*t
}

// fbm3 is low-frequency dominant so level sets form continents, not salt.
func fbm3(x, y, z, freq float64, seed uint64) float64 {
	sum := 0.0
	amp := 1.0
	norm := 0.0
	f := freq
	for o := 0; o < 3; o++ {
		sum += amp * valueNoise3(x*f, y*f, z*f, seed+uint64(o)*0x9E3779B97F4A7C15)
		norm += amp
		amp *= 0.42
		f *= 2
	}
	return sum / norm
}
