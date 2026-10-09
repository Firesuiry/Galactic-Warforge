package mapgen

import (
	"container/heap"
	"fmt"
	"sort"

	"siliconworld/internal/mapconfig"
	"siliconworld/internal/mapmodel"
	"siliconworld/internal/surface"
	"siliconworld/internal/terrain"
)

// 遭遇战地图的结构性可玩性保证（试玩报告 tmp/playtest-1009 阻断 A）：
// 出生点被 145 格孤岛围住、石矿在 20 格外隔水、争夺中心与对手在别的连通区，
// 整条科技链从 tick 0 就断。这里在生成管线末尾一次性保证：
//  1. 所有出生点与争夺中心落在同一块地面连通区里（必要时开一条走廊）；
//  2. 每个出生点地面路径 24 格内有开局科技链必需的原矿（铁/铜/煤/石）；
//  3. 小于 smallLandmassTiles 的孤立陆地不留资源、不放单位，地形改为阻挡，
//     单位走不进去也就不会被困（试玩报告 D：bot 执行体困在 11 格孤岛）。
//
// 通行判定与 gamecore.tileWalkableForUnit / pathFlood 同一口径：只有
// terrain.TileType.Buildable() 的格子可通行（水/岩浆/blocked 都不可通行）。
// 邻居一律用 surface.Grid.Step 取，跨面相邻正确。
const (
	// smallLandmassTiles 孤立陆地阈值（格）。小于它的连通区会被封成阻挡地形。
	smallLandmassTiles = 200
	// spawnResourcePathRange 出生点到开局必需原矿的地面路径上限（格）。
	spawnResourcePathRange = 24
	// 补矿簇优先选在这个距离带内。不能太远：开局矿机是「矿机 + 紧挨着它的一座
	// 电塔」配着建的，电塔要落在基地电塔的无线覆盖（4 格）里才接得上电网；把补的
	// 矿放到 12–20 格会让基地那 4 座矿机里 3 座落在供电范围外（实测
	// `TestSkirmishPlayerKitRunsPowerMiningSmeltingBy1500` 失败），5–8 格才稳定。
	openingClusterMinRange = 5
	openingClusterMaxRange = 8
	// carveCost 走廊 Dijkstra 里每抹平一格挡路地形的代价（陆地代价为 0）。
	carveCost = 1
)

// openingResourceKinds 是开局科技链必需的原矿：铁→磁铁/磁线圈，铜→电路板，
// 煤→机甲燃料，石→玻璃/石砖（研究站建造成本）。与 gamecore.starterResourceKinds
// （运行时兜底注入 iron/copper/coal）同向且多一个石矿，因为玻璃只能由石矿出。
var openingResourceKinds = []mapmodel.ResourceKind{
	mapmodel.ResourceIronOre,
	mapmodel.ResourceCopperOre,
	mapmodel.ResourceCoal,
	mapmodel.ResourceStoneOre,
}

// ensurePlayableConnectivity 只在行星有显式 spawn_points 时生效（普通地图
// map.yaml 没有出生点，行为完全不变）。
func ensurePlayableConnectivity(planet *mapmodel.Planet, cfg *mapconfig.Config) {
	if planet == nil || cfg == nil || planet.FaceSize < 1 || len(planet.SpawnPoints) < 2 {
		return
	}
	grid := surface.Grid{Size: planet.FaceSize}
	spawns := make([]surface.Tile, 0, len(planet.SpawnPoints))
	for _, sp := range planet.SpawnPoints {
		tile := surface.Tile{X: sp.X, Y: sp.Y}
		if grid.Valid(tile) {
			spawns = append(spawns, tile)
		}
	}
	if len(spawns) < 2 {
		return
	}
	home := spawns[0]

	// 出生点自己站在小岛上时，先把它接到最大的陆地上，否则后面「封小陆地」会把
	// 主分量之外的大陆也封掉。
	components := floodLandComponents(planet, grid)
	if main := components.componentOf(home); main != nil && len(main) < smallLandmassTiles {
		if largest := largestComponentOtherThan(components, home); largest != nil {
			carveCorridor(planet, grid, home, largest[0])
		}
	}

	// 其余出生点与争夺中心都要和第一个出生点同区。每接进一个就重算分量（走廊可能
	// 顺带连上别的目标，重算避免重复开路）。
	center := contestedCenterTile(planet)
	targets := append([]surface.Tile{}, spawns[1:]...)
	if grid.Valid(center) {
		targets = append(targets, center)
	}
	for _, target := range targets {
		components := floodLandComponents(planet, grid)
		main := components.labelOf(home)
		if main < 0 {
			return // 出生点自身不可通行（spawn pad 已保证可建，理论上不会发生）
		}
		if components.labelOf(target) == main {
			continue
		}
		// 目标落在水/岩浆/阻挡上（争夺中心可能在海面）时先把它铺成平地。
		if !landWalkable(planet, target) {
			markBuildablePad(planet, target)
		}
		carveCorridor(planet, grid, home, target)
	}

	// 封掉所有小陆地：先抹掉资源，再改成不可通行地形。
	components = floodLandComponents(planet, grid)
	main := components.labelOf(home)
	if main >= 0 && len(components.members[main]) >= smallLandmassTiles {
		for id, members := range components.members {
			if int32(id) == main || len(members) >= smallLandmassTiles {
				continue
			}
			removeResourcesOn(planet, members)
			for _, tile := range members {
				planet.Terrain[tile.Y][tile.X] = terrain.TileBlocked
			}
		}
	}

	// 开局原矿保证。
	for _, spawn := range spawns {
		ensureOpeningResources(planet, grid, spawn, cfg)
	}
}

// landWalkable 与 gamecore 的通行口径一致：只有可建地形能走。
func landWalkable(planet *mapmodel.Planet, tile surface.Tile) bool {
	if tile.Y < 0 || tile.Y >= len(planet.Terrain) || tile.X < 0 || tile.X >= len(planet.Terrain[tile.Y]) {
		return false
	}
	return planet.Terrain[tile.Y][tile.X].Buildable()
}

// landComponents 是地面连通分量的划分结果，label 为扁平数组便于 O(1) 查询。
type landComponents struct {
	grid    surface.Grid
	label   []int32
	members [][]surface.Tile
}

func (c *landComponents) labelOf(tile surface.Tile) int32 {
	if c == nil || !c.grid.Valid(tile) {
		return -1
	}
	return c.label[tile.Y*c.grid.Width()+tile.X]
}

// componentOf 返回该格所在的连通区格子列表，不可通行或越界返回 nil。
func (c *landComponents) componentOf(tile surface.Tile) []surface.Tile {
	id := c.labelOf(tile)
	if id < 0 {
		return nil
	}
	return c.members[id]
}

// floodLandComponents 按 4 邻接洪泛所有陆地连通分量（跨面用 Grid.Step）。
func floodLandComponents(planet *mapmodel.Planet, grid surface.Grid) *landComponents {
	width, height := grid.Width(), grid.Height()
	result := &landComponents{grid: grid, label: make([]int32, width*height)}
	for i := range result.label {
		result.label[i] = -1
	}
	queue := make([]surface.Tile, 0, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			start := surface.Tile{X: x, Y: y}
			if result.label[y*width+x] != -1 || !landWalkable(planet, start) {
				continue
			}
			id := int32(len(result.members))
			result.label[y*width+x] = id
			queue = append(queue[:0], start)
			members := make([]surface.Tile, 0, 64)
			members = append(members, start)
			for head := 0; head < len(queue); head++ {
				cur := queue[head]
				for dir := surface.North; dir <= surface.West; dir++ {
					next, _ := grid.Step(cur, dir)
					if !grid.Valid(next) {
						continue
					}
					index := next.Y*width + next.X
					if result.label[index] != -1 || !landWalkable(planet, next) {
						continue
					}
					result.label[index] = id
					members = append(members, next)
					queue = append(queue, next)
				}
			}
			result.members = append(result.members, members)
		}
	}
	return result
}

// largestComponentOtherThan 返回除 origin 所在连通区外最大的连通区（同大小时取
// 代表格字典序最前的那个，保证确定性）。
func largestComponentOtherThan(components *landComponents, origin surface.Tile) []surface.Tile {
	skip := components.labelOf(origin)
	var best []surface.Tile
	for id, members := range components.members {
		if int32(id) == skip || len(members) == 0 {
			continue
		}
		if best == nil || len(members) > len(best) || len(members) == len(best) && tileLess(members[0], best[0]) {
			best = members
		}
	}
	return best
}

func tileLess(a, b surface.Tile) bool {
	if a.Y != b.Y {
		return a.Y < b.Y
	}
	return a.X < b.X
}

type carveItem struct {
	cost  int
	steps int
	index int32
}

type carveQueue []carveItem

func (q carveQueue) Len() int { return len(q) }
func (q carveQueue) Less(i, j int) bool {
	if q[i].cost != q[j].cost {
		return q[i].cost < q[j].cost
	}
	if q[i].steps != q[j].steps {
		return q[i].steps < q[j].steps
	}
	return q[i].index < q[j].index
}
func (q carveQueue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *carveQueue) Push(x any)   { *q = append(*q, x.(carveItem)) }
func (q *carveQueue) Pop() any {
	old := *q
	n := len(old)
	item := old[n-1]
	*q = old[:n-1]
	return item
}

// carveCorridor 在 from 与 to 之间开一条地表走廊：以「要抹平的格子数」为代价做
// Dijkstra（陆地 0 代价、水/岩浆/阻挡 carveCost 代价，同代价取更短路径），只把路径
// 上真正挡路的格子改成可通行平地。因为陆地免费，路径会尽量沿既有陆地绕，只在绕不
// 过去的地方穿水，不会把大陆整片抹平。返回抹平的格子数。
func carveCorridor(planet *mapmodel.Planet, grid surface.Grid, from, to surface.Tile) int {
	if !grid.Valid(from) || !grid.Valid(to) {
		return 0
	}
	width := grid.Width()
	size := width * grid.Height()
	dist := make([]int32, size)
	steps := make([]int32, size)
	parent := make([]int32, size)
	for i := range dist {
		dist[i] = -1
	}
	fromIndex := int32(from.Y*width + from.X)
	toIndex := int32(to.Y*width + to.X)
	dist[fromIndex] = 0
	steps[fromIndex] = 0
	parent[fromIndex] = fromIndex
	queue := &carveQueue{{cost: 0, steps: 0, index: fromIndex}}
	for queue.Len() > 0 {
		cur := heap.Pop(queue).(carveItem)
		if cur.index == toIndex {
			break
		}
		if int32(cur.cost) != dist[cur.index] || int32(cur.steps) != steps[cur.index] {
			continue
		}
		tile := surface.Tile{X: int(cur.index) % width, Y: int(cur.index) / width}
		for dir := surface.North; dir <= surface.West; dir++ {
			next, _ := grid.Step(tile, dir)
			if !grid.Valid(next) {
				continue
			}
			nextIndex := int32(next.Y*width + next.X)
			cost := cur.cost
			if !landWalkable(planet, next) {
				cost += carveCost
			}
			nextSteps := cur.steps + 1
			if dist[nextIndex] >= 0 && (dist[nextIndex] < int32(cost) || dist[nextIndex] == int32(cost) && steps[nextIndex] <= int32(nextSteps)) {
				continue
			}
			dist[nextIndex] = int32(cost)
			steps[nextIndex] = int32(nextSteps)
			parent[nextIndex] = cur.index
			heap.Push(queue, carveItem{cost: cost, steps: nextSteps, index: nextIndex})
		}
	}
	if dist[toIndex] < 0 {
		return 0
	}
	carved := 0
	for index := toIndex; ; index = parent[index] {
		tile := surface.Tile{X: int(index) % width, Y: int(index) / width}
		if !landWalkable(planet, tile) {
			markBuildablePad(planet, tile)
			carved++
		}
		if index == fromIndex {
			break
		}
	}
	return carved
}

// removeResourcesOn 删除落在给定格子上的资源节点（保留切片容量，原地过滤）。
func removeResourcesOn(planet *mapmodel.Planet, tiles []surface.Tile) {
	if len(planet.Resources) == 0 || len(tiles) == 0 {
		return
	}
	on := make(map[mapmodel.GridPos]bool, len(tiles))
	for _, tile := range tiles {
		on[gridPos(tile)] = true
	}
	kept := planet.Resources[:0]
	for _, node := range planet.Resources {
		if on[node.Position] {
			continue
		}
		kept = append(kept, node)
	}
	planet.Resources = kept
}

// ensureOpeningResources 保证出生点地面路径 spawnResourcePathRange 格内四种
// 开局原矿齐全，缺哪种就在出生点附近补一小簇（簇大小见 openingClusterSize）。
func ensureOpeningResources(planet *mapmodel.Planet, grid surface.Grid, spawn surface.Tile, cfg *mapconfig.Config) {
	dist := landDistances(planet, grid, spawn, spawnResourcePathRange)
	present := make(map[mapmodel.ResourceKind]bool, len(openingResourceKinds))
	for _, node := range planet.Resources {
		if d, ok := dist[surface.Tile{X: node.Position.X, Y: node.Position.Y}]; ok && d <= spawnResourcePathRange {
			present[node.Kind] = true
		}
	}
	for _, kind := range openingResourceKinds {
		if present[kind] {
			continue
		}
		placeOpeningCluster(planet, grid, spawn, kind, cfg, dist)
	}
}

// openingClusterSize 是补矿簇的大小：取 cfg 的 cluster_min（现有资源簇参数的下限），
// 且不超过「附近可用空地上限」。这里刻意不取 cluster_min..cluster_max 的随机整簇：
// 出生点近旁是基地的建造环，塞一簇 3–8 格的矿会占掉风机/矿机的可建位，bot 的基地
// 扩张随之卡死（实测：随机整簇时 bot 到 tick 12000 还没建出研究站，取 cluster_min
// 则与无补矿时一致）。补矿只承诺「有这种矿」，不承诺满簇。
func openingClusterSize(res mapconfig.ResourceConfig, maxAvailable int) int {
	if maxAvailable <= 0 {
		return 0
	}
	size := max(1, res.ClusterMin)
	if size > maxAvailable {
		size = maxAvailable
	}
	return size
}

// landDistances 从 from 出发对陆地做限深 BFS，返回每格的地面路径长度。
func landDistances(planet *mapmodel.Planet, grid surface.Grid, from surface.Tile, maxDist int) map[surface.Tile]int {
	dist := map[surface.Tile]int{from: 0}
	queue := []surface.Tile{from}
	for head := 0; head < len(queue); head++ {
		cur := queue[head]
		depth := dist[cur]
		if depth >= maxDist {
			continue
		}
		for dir := surface.North; dir <= surface.West; dir++ {
			next, _ := grid.Step(cur, dir)
			if !grid.Valid(next) || !landWalkable(planet, next) {
				continue
			}
			if _, seen := dist[next]; seen {
				continue
			}
			dist[next] = depth + 1
			queue = append(queue, next)
		}
	}
	return dist
}

// placeOpeningCluster 在出生点附近选一块空地补一小簇指定原矿。
func placeOpeningCluster(planet *mapmodel.Planet, grid surface.Grid, spawn surface.Tile, kind mapmodel.ResourceKind, cfg *mapconfig.Config, dist map[surface.Tile]int) {
	res := cfg.Planet.Resources
	radius := max(0, res.ClusterRadius)
	clusterMin := max(1, res.ClusterMin)
	rng := newRNG(fmt.Sprintf("opening:%d:%s:%d,%d", planet.Seed, kind, spawn.X, spawn.Y))

	occupied := make(map[mapmodel.GridPos]bool, len(planet.Resources))
	for _, node := range planet.Resources {
		occupied[node.Position] = true
	}
	center, available, ok := pickOpeningClusterCenter(planet, grid, spawn, radius, clusterMin, dist, occupied)
	if !ok {
		return
	}
	size := openingClusterSize(res, available)

	placed := 0
	clusterID := fmt.Sprintf("%s-opening-%s-%d,%d", planet.ID, kind, spawn.X, spawn.Y)
	for _, tile := range shuffledDisc(grid, rng, center, radius) {
		if placed >= size {
			break
		}
		if !landWalkable(planet, tile) || occupied[gridPos(tile)] {
			continue
		}
		if d, ok := dist[tile]; !ok || d > spawnResourcePathRange {
			continue
		}
		node := buildResourceNode(rng, planet, kind, resourceBehavior(kind), false, res)
		node.ID = fmt.Sprintf("%s-%d", clusterID, placed+1)
		node.Position = gridPos(tile)
		node.ClusterID = clusterID
		planet.Resources = append(planet.Resources, node)
		occupied[gridPos(tile)] = true
		placed++
	}
}

// pickOpeningClusterCenter 选一个离出生点 openingClusterMinRange..MaxRange 格、
// 至少能放下 clusterMin 格的最近格子（次选带放宽到 2..spawnResourcePathRange），
// 同时返回该处可用空地数——补矿簇按它收缩，不硬塞满整簇。找不到任何可用空地才
// 返回 ok=false。候选按「距离近 → 坐标字典序」排序，保证确定性。
func pickOpeningClusterCenter(planet *mapmodel.Planet, grid surface.Grid, spawn surface.Tile, radius, minSize int, dist map[surface.Tile]int, occupied map[mapmodel.GridPos]bool) (surface.Tile, int, bool) {
	candidates := make([]surface.Tile, 0, len(dist))
	for tile := range dist {
		candidates = append(candidates, tile)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if dist[candidates[i]] != dist[candidates[j]] {
			return dist[candidates[i]] < dist[candidates[j]]
		}
		return tileLess(candidates[i], candidates[j])
	})
	for _, band := range [][2]int{{openingClusterMinRange, openingClusterMaxRange}, {2, spawnResourcePathRange}} {
		for _, center := range candidates {
			d := dist[center]
			if d < band[0] || d > band[1] {
				continue
			}
			free := openingClusterFreeTiles(planet, grid, center, radius, occupied)
			if free >= minSize {
				return center, free, true
			}
		}
	}
	return surface.Tile{}, 0, false
}

// openingClusterFreeTiles 统计圆盘内可放矿、未被占用的格子数（跳过出生点格本身）。
func openingClusterFreeTiles(planet *mapmodel.Planet, grid surface.Grid, center surface.Tile, radius int, occupied map[mapmodel.GridPos]bool) int {
	free := 0
	for _, tile := range grid.Disc(center, radius) {
		if tile == center || !landWalkable(planet, tile) || occupied[gridPos(tile)] {
			continue
		}
		free++
	}
	return free
}

// shuffledDisc 按确定性 rng 打乱圆盘内格子顺序，保证同一 seed 结果一致。
func shuffledDisc(grid surface.Grid, rng *rng, center surface.Tile, radius int) []surface.Tile {
	tiles := grid.Disc(center, radius)
	for i := len(tiles) - 1; i > 0; i-- {
		j := rng.Intn(i + 1)
		tiles[i], tiles[j] = tiles[j], tiles[i]
	}
	return tiles
}

func gridPos(tile surface.Tile) mapmodel.GridPos {
	return mapmodel.GridPos{X: tile.X, Y: tile.Y}
}
