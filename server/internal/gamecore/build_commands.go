package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
)

func missingItem(inv model.ItemInventory, cost []model.ItemAmount) (model.ItemAmount, bool) {
	for _, item := range cost {
		if item.Quantity <= 0 {
			continue
		}
		if inv == nil || inv[item.ItemID] < item.Quantity {
			return item, true
		}
	}
	return model.ItemAmount{}, false
}

type buildPayload struct {
	BuildingType model.BuildingType `json:"building_type" payload:"required"`
	RecipeID     string             `json:"recipe_id"`
	Direction    *string            `json:"direction"`
	Rotation     *int               `json:"rotation"`
	AutoApproach bool               `json:"auto_approach"`
}

// execBuild handles the "build" command
func (gc *GameCore) execBuild(ws *model.WorldState, playerID string, cmd model.Command, p buildPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	pos := cmd.Target.Position
	if pos == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "build 命令缺少 position"
		return res, nil
	}

	if !ws.InBounds(pos.X, pos.Y) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("位置 (%d,%d) 超出地图范围", pos.X, pos.Y)
		return res, nil
	}

	btype := p.BuildingType
	if btype == model.BuildingTypeLogisticsDistributor {
		if _, err := model.DistributorPlacementHost(ws, playerID, *pos, ""); err != nil {
			return mechaJobFailed(model.CodeInvalidTarget, err.Error())
		}
		mounted := *pos
		mounted.Z = 1
		pos = &mounted
	}
	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() && btype != model.BuildingTypeFoundation {
		// Geothermal power stations may sit on lava itself; every other
		// building still requires buildable ground.
		if !(model.RequiresLavaProximity(btype) && ws.Grid[pos.Y][pos.X].Terrain == terrain.TileLava) {
			res.Code = model.CodeInvalidTarget
			res.Message = "目标地块不可建造"
			return res, nil
		}
	}

	// Check tile is unoccupied; an occupied tile may still accept a vertically
	// stacked layer of the same building type (vertical_construction tech).
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied && btype != model.BuildingTypeLogisticsDistributor {
		stackedPos, stackErr := resolveVerticalPlacement(ws, ws.Players[playerID], btype, *pos)
		if stackErr != nil {
			res.Code = model.CodePositionOccupied
			res.Message = stackErr.Error()
			return res, nil
		}
		pos = &stackedPos
	}
	if ws.Construction != nil && ws.Construction.IsTileReserved(tileKey) && pos.Z == 0 {
		res.Code = model.CodePositionOccupied
		res.Message = "地块已被施工预留"
		return res, nil
	}

	// Validate building type
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("未知建筑类型：%s", buildingTypeDisplayName(btype))
		return res, nil
	}
	if !def.Buildable {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("该建筑类型不可建造：%s", buildingTypeDisplayName(btype))
		return res, nil
	}

	// Check tech unlock requirement
	player := ws.Players[playerID]
	if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("%s需先研究解锁", buildingTypeDisplayName(btype))
		return res, nil
	}

	recipeID := p.RecipeID
	if recipeID == "" && def.DefaultRecipeID != "" {
		recipeID = def.DefaultRecipeID
	}
	if recipeID != "" {
		recipe, ok := model.Recipe(recipeID)
		if !ok {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("未知配方：%s", recipeDisplayName(recipeID))
			return res, nil
		}
		if def := model.BuildingProfileFor(btype, 1); def.Runtime.Functions.Production == nil {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("%s不支持配方", buildingTypeDisplayName(btype))
			return res, nil
		}
		supportsRecipe := false
		for _, allowed := range recipe.BuildingTypes {
			if allowed == btype {
				supportsRecipe = true
				break
			}
		}
		if !supportsRecipe {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("配方「%s」不适用于%s", recipeDisplayName(recipeID), buildingTypeDisplayName(btype))
			return res, nil
		}
		if !CanUseRecipeTech(player, recipeID) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("配方「%s」需先研究解锁", recipeDisplayName(recipeID))
			return res, nil
		}
	}
	if err := model.ValidateCollectorSite(ws, btype, *pos); err != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = err.Error()
		return res, nil
	}
	if btype == model.BuildingTypeOrbitalCollector {
		planet, ok := gc.maps.Planet(ws.PlanetID)
		if !ok || planet == nil || planet.Kind != mapmodel.PlanetKindGasGiant {
			res.Code = model.CodeInvalidTarget
			res.Message = "轨道采集器必须建在气态巨行星上"
			return res, nil
		}
	}
	if model.RequiresLavaProximity(btype) && !buildSiteTouchesLava(ws, btype, *pos) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("%s必须建在熔岩上或紧邻熔岩", buildingTypeDisplayName(btype))
		return res, nil
	}

	var conveyorDir model.ConveyorDirection
	if model.IsConveyorBuilding(btype) {
		conveyorDir = model.ConveyorEast
		if p.Direction != nil {
			dir := model.ConveyorDirection(*p.Direction)
			if !dir.Valid() {
				res.Code = model.CodeValidationFailed
				res.Message = fmt.Sprintf("无效的传送带方向：%v", *p.Direction)
				return res, nil
			}
			conveyorDir = dir
		}
	}

	rotation := model.PlanRotation0
	if p.Rotation != nil {
		degrees := *p.Rotation
		if degrees < 0 || degrees > 270 || degrees%90 != 0 {
			return mechaJobFailed(model.CodeValidationFailed, "rotation 必须为 0、90、180 或 270")
		}
		rotation = model.PlanRotation(fmt.Sprint(degrees))
	}
	autoApproach := p.AutoApproach
	var approachUnit *model.Unit
	var approachPath []model.Position
	// Check resource cost (availability validation)
	mCost, eCost := def.BuildCost.Minerals, def.BuildCost.Energy
	player = ws.Players[playerID]
	if player.Resources.Minerals < mCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("矿物不足：需要 %d，当前 %d", mCost, player.Resources.Minerals)
		return res, nil
	}
	if player.Resources.Energy < eCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("能量不足：需要 %d，当前 %d", eCost, player.Resources.Energy)
		return res, nil
	}
	if missing, ok := missingItem(player.Inventory, def.BuildCost.Items); ok {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("建造缺少 %d 个「%s」", missing.Quantity, itemDisplayName(missing.ItemID))
		return res, nil
	}

	if rangeRes := gc.requireBuildRange(ws, playerID, *pos); rangeRes != nil {
		if !autoApproach {
			return *rangeRes, nil
		}
		approachUnit, approachPath = planBuildApproach(ws, playerID, *pos)
		if approachUnit == nil {
			return mechaJobFailed(model.CodeOutOfRange, "没有可到达的施工位置")
		}
	}

	// 建造不能把任何地面单位（含己方机甲）关进死角：否则玩家只能拆家自救
	// （试玩报告 #5：机甲被自家建筑围死），bot 也会用自家建筑把军团圈死
	// （试玩报告 B）。占位按整个占地范围计算，回执写明单位名/坐标与最后出口。
	if enclosed := buildingEnclosure(ws, btype, rotation, *pos); enclosed != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = enclosureMessage(enclosed)
		return res, nil
	}

	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
	}

	taskID := ws.NextEntityID("c")
	task := &model.ConstructionTask{
		ID:                taskID,
		Rotation:          rotation,
		AutoApproach:      autoApproach,
		PlayerID:          playerID,
		RegionID:          constructionRegionKey(ws, *pos),
		BuildingType:      btype,
		Position:          *pos,
		ConveyorDirection: conveyorDir,
		RecipeID:          recipeID,
		Cost:              def.BuildCost,
		State:             model.ConstructionPending,
		EnqueueTick:       ws.Tick,
	}
	if err := ws.Construction.Enqueue(ws, task); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	// Reserve materials (validates availability and locks/deducts resources)
	if _, err := reserveConstructionMaterials(ws, task); err != nil {
		ws.Construction.Remove(taskID)
		res.Code = model.CodeInsufficientResource
		res.Message = err.Error()
		return res, nil
	}

	if approachUnit != nil {
		startBuildApproach(approachUnit, approachPath)
	}
	task.TotalTicks = gc.scaledConstructionDuration()
	task.RemainingTicks = task.TotalTicks

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	// 并发上限（执行体 concurrent_tasks / 区域 construction_region_concurrent_limit）
	// 只影响开工顺序，不影响命令成功；具体排队原因由任务视图的 wait_reason 下发。
	res.Message = fmt.Sprintf("施工任务已排队（位置 %d,%d）", pos.X, pos.Y)
	return res, nil
}

// buildingEnclosure 在 pos 放置 btype 后，某个地面单位是否会被关进死角。
// 返回被围单位的名称/坐标与最后被堵死的那个出口（供回执写明细节）。
//
// 两种形态都算围死：
//  1. 四邻全堵死——它一格都走不出去（试玩报告 #5：机甲被自家建筑围死）；
//  2. 口袋（连通区）被切断——该单位本可以走到自家基地，建造后走不到了。
//     这一条正是试玩报告 D 的根因：bot 用一圈建筑把自家基地（连同 6 个单位）
//     封成 11 格口袋，执行体被隔在外面再也回不了家（"执行体不会把自己困死"）。
//
// 判定只看"本建筑自身占地"的增量：与其它单位相邻关系无关。
// 口袋判定是增量检查（建造前能到家、建造后不能才拒绝），因此已经存在的封闭
// 区域不会反复触发（长跑 soak 里机甲本来就挤在密集基地中，只要它还摸得到基地
// 就不会被拒）。
type buildingEnclosureInfo struct {
	unitName string
	unitPos  model.Position
	lastExit model.Position // 建造前最后一个仍可通行的邻格（建造后即被堵死）
	pocket   bool           // true = 口袋形态（能到基地，但被切断）
}

// enclosureMessage 围死回执：点名单位、坐标与最后出口。
func enclosureMessage(info *buildingEnclosureInfo) string {
	if info.pocket {
		return fmt.Sprintf("会把%s（%d,%d）与基地之间的通路切断（最后通道 %d,%d），单位会困死在封闭区域里",
			info.unitName, info.unitPos.X, info.unitPos.Y, info.lastExit.X, info.lastExit.Y)
	}
	return fmt.Sprintf("会把%s（%d,%d）四周完全堵死，最后一个出口（%d,%d）",
		info.unitName, info.unitPos.X, info.unitPos.Y, info.lastExit.X, info.lastExit.Y)
}

// pocketCheckRadius 口袋判定的关注半径：单座建筑只可能切断它自己边界处的通路，
// 因此只需检查建造点附近的单位（外加主人的执行体）。
const pocketCheckRadius = 16

// pocketFloodBudget 口袋判定的洪泛预算（格），与单位寻路 maxPathBudget 同一量级：
// 立方球面图距离的三角不等式对"实际路径长度"并不成立（跨面绕行可能远长于
// SurfaceDistance），所以预算必须在直线距离之外留足余量，否则会把连通误判成
// 不可达（bot 测试图面 48、基地到玩家基地直线 93，实际路径 ~240）。
const pocketFloodBudget = 2000

func buildingEnclosure(ws *model.WorldState, btype model.BuildingType, rotation model.PlanRotation, pos model.Position) *buildingEnclosureInfo {
	if ws == nil {
		return nil
	}
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		return nil
	}
	tiles, err := ws.FootprintTiles(pos, model.RotatedFootprint(def.Footprint, rotation))
	if err != nil || len(tiles) == 0 {
		return nil
	}
	occupied := make(map[model.Position]bool, len(tiles))
	for _, tile := range tiles {
		tile.Z = 0
		occupied[tile] = true
	}
	unitIDs := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		unitIDs = append(unitIDs, id)
	}
	sort.Strings(unitIDs)
	// 第一遍：四邻全堵死（回执能点名"最后一个出口"）。
	for _, id := range unitIDs {
		unit := ws.Units[id]
		if unit == nil || unit.HP <= 0 || unitIsAir(ws, id) || occupied[unit.Position] {
			continue
		}
		blocked := 0
		exitsBefore := 0
		var lastExit model.Position
		neighbors := ws.SurfaceNeighbors(unit.Position)
		for _, n := range neighbors {
			if unitTileBlockedAfterBuild(ws, n, occupied) {
				blocked++
				// 建造前可通行、建造后被堵死的格子：就是"最后一个出口"。
				if !unitTileBlockedBeforeBuild(ws, n) {
					lastExit = n
				}
				continue
			}
			exitsBefore++
		}
		if len(neighbors) > 0 && blocked == len(neighbors) && exitsBefore == 0 {
			return &buildingEnclosureInfo{unitName: unitDisplayName(unit), unitPos: unit.Position, lastExit: lastExit}
		}
	}
	// 第二遍：口袋判定——建造点附近的己方地面单位是否会因此走不到自家基地。
	// 先用廉价的"是否可能是割点"预筛：开阔地里一次小半径洪泛就能证明邻格
	// 仍然互通，直接放行；只有真的可能切断时才做（较贵的）两次连通区检查。
	if !buildMayCutRegion(ws, occupied) {
		return nil
	}
	owner := pocketEnclosureOwner(ws, pos)
	if owner == "" {
		return nil
	}
	home, ok := botHomePosition(ws, owner)
	if !ok {
		return nil
	}
	var suspects []*model.Unit
	targets := make([]int32, 0, 4)
	for _, id := range unitIDs {
		unit := ws.Units[id]
		if unit == nil || unit.HP <= 0 || unitIsAir(ws, id) || unit.OwnerID != owner || occupied[unit.Position] {
			continue
		}
		if ws.SurfaceDistance(unit.Position, pos) > pocketCheckRadius {
			continue
		}
		suspects = append(suspects, unit)
		targets = append(targets, int32(unit.Position.Y*ws.MapWidth+unit.Position.X))
	}
	if len(suspects) == 0 {
		return nil
	}
	// 两次洪泛都从基地出发（一个连通区 = 一次洪泛，比逐单位洪泛省得多）：
	// 建造前到得了、建造后到不了的，就是这次建造切断的。命中目标即提前结束，
	// 因此"没切断"时洪泛很快就停；只有真的切断时才走满预算。
	budget := pocketFloodBudget
	before := reachableFrom(ws, home, nil, targets, budget)
	after := reachableFrom(ws, home, occupied, targets, budget)
	for i, unit := range suspects {
		if before[targets[i]] && !after[targets[i]] {
			return &buildingEnclosureInfo{unitName: unitDisplayName(unit), unitPos: unit.Position, lastExit: pos, pocket: true}
		}
	}
	return nil
}

// buildMayCutRegion 预筛：本次建造的占地是否可能切断任何连通区。
// 把占地当作障碍后，占地自己的所有可通行邻格是否还能在小半径内互相连通——
// 能，则它绝不是割点（证明无切断，直接放行）；不能，则结果不确定，交给完整判定。
// 预筛只可能"漏报为不确定"，不会把真正的切断判成安全。
func buildMayCutRegion(ws *model.WorldState, occupied map[model.Position]bool) bool {
	neighbors := make([]model.Position, 0, 8)
	seen := make(map[int32]bool, 8)
	for tile := range occupied {
		for _, n := range ws.SurfaceNeighbors(tile) {
			if occupied[n] || !ws.InBounds(n.X, n.Y) {
				continue
			}
			if !unitTileBlockedAfterBuild(ws, n, occupied) {
				// 可通行邻格
			} else {
				continue
			}
			idx := int32(n.Y*ws.MapWidth + n.X)
			if seen[idx] {
				continue
			}
			seen[idx] = true
			neighbors = append(neighbors, n)
		}
	}
	if len(neighbors) <= 1 {
		return false // 只有一个出口（或没有）：不构成"切断两块区域"
	}
	targets := make([]int32, 0, len(neighbors))
	for _, n := range neighbors {
		targets = append(targets, int32(n.Y*ws.MapWidth+n.X))
	}
	// 从第一个邻格出发小半径洪泛，看其余邻格是否都能摸到。
	budget := 4*len(neighbors) + 24
	res := reachableFrom(ws, neighbors[0], occupied, targets, budget)
	return len(res) < len(neighbors)
}

// pocketEnclosureOwner 口袋判定的归属玩家：建造点附近的执行体主人（没有则取附近单位）。
func pocketEnclosureOwner(ws *model.WorldState, pos model.Position) string {
	best := ""
	bestDist := -1
	for id, unit := range ws.Units {
		if unit == nil || unit.HP <= 0 || unit.Mecha == nil || unitIsAir(ws, id) {
			continue
		}
		d := ws.SurfaceDistance(unit.Position, pos)
		if d > pocketCheckRadius {
			continue
		}
		if bestDist < 0 || d < bestDist {
			best, bestDist = unit.OwnerID, d
		}
	}
	if best != "" {
		return best
	}
	for id, unit := range ws.Units {
		if unit == nil || unit.HP <= 0 || unitIsAir(ws, id) {
			continue
		}
		d := ws.SurfaceDistance(unit.Position, pos)
		if d > pocketCheckRadius {
			continue
		}
		if bestDist < 0 || d < bestDist {
			best, bestDist = unit.OwnerID, d
		}
	}
	return best
}

// botHomePosition 玩家主基地（战地分析基站）坐标。
func botHomePosition(ws *model.WorldState, playerID string) (model.Position, bool) {
	bestID := ""
	var best model.Position
	for id, b := range ws.Buildings {
		if b == nil || b.HP <= 0 || b.OwnerID != playerID || b.Type != model.BuildingTypeBattlefieldAnalysisBase {
			continue
		}
		if bestID == "" || id < bestID {
			bestID, best = id, b.Position
		}
	}
	if bestID == "" {
		return model.Position{}, false
	}
	return best, true
}

// reachableFrom 从 start 做一次深度受限的连通区洪泛，返回所有命中的 target（结果集）。
// 通行口径与 unitTileBlockedBeforeBuild 一致：地形不可建、已有建筑、施工预留
// 以及本次建造的占地（occupied）都算障碍。深度超过 budget 即停（不再扩展），
// 因此"超预算"等于"不可达"（与单位寻路 maxPathBudget 的口径一致）。
func reachableFrom(ws *model.WorldState, start model.Position, occupied map[model.Position]bool, targets []int32, budget int) map[int32]bool {
	out := make(map[int32]bool, len(targets))
	if !ws.InBounds(start.X, start.Y) || budget < 0 {
		return out
	}
	pending := make(map[int32]bool, len(targets))
	for _, t := range targets {
		pending[t] = true
	}
	seen := map[int32]bool{}
	queue := []int32{int32(start.Y*ws.MapWidth + start.X)}
	depth := map[int32]int{queue[0]: 0}
	seen[queue[0]] = true
	if pending[queue[0]] {
		out[queue[0]] = true
		delete(pending, queue[0])
	}
	for head := 0; head < len(queue) && len(pending) > 0; head++ {
		cur := queue[head]
		if depth[cur] >= budget {
			continue
		}
		tile := model.Position{X: int(cur) % ws.MapWidth, Y: int(cur) / ws.MapWidth}
		for _, n := range ws.SurfaceNeighbors(tile) {
			if !ws.InBounds(n.X, n.Y) {
				continue
			}
			idx := int32(n.Y*ws.MapWidth + n.X)
			if seen[idx] {
				continue
			}
			if pending[idx] {
				out[idx] = true
				delete(pending, idx)
				if len(pending) == 0 {
					return out
				}
			}
			if occupied[n] || ws.TileBuilding[model.TileKey(n.X, n.Y)] != "" || !ws.Grid[n.Y][n.X].Terrain.Buildable() {
				continue
			}
			if ws.Construction != nil && ws.Construction.ReservedTiles[model.TileKey(n.X, n.Y)] != "" {
				continue
			}
			seen[idx] = true
			depth[idx] = depth[cur] + 1
			queue = append(queue, idx)
		}
	}
	return out
}

// pocketReach 从 from 出发的连通区洪泛：能否走到 home（occupied 额外视为障碍）。
// 通行口径与 unitTileBlockedBeforeBuild 一致：地形不可建、已有建筑、施工队列已
// 预留的格都算障碍（否则"正在排队的一圈建筑"看不出已经把单位围住）。
// 预算用 pocketFloodBudget（与单位寻路同一量级）：立方球面图上"实际路径长度"
// 可能远大于 SurfaceDistance（跨面绕行），按直线距离给预算会把连通误判为不可达。
// 命中目标即提前返回，因此可达时开销 ≈ 路径长度。
func pocketReach(ws *model.WorldState, from, home model.Position, occupied map[model.Position]bool) bool {
	if !ws.InBounds(from.X, from.Y) || !ws.InBounds(home.X, home.Y) {
		return false
	}
	startIdx := int32(from.Y*ws.MapWidth + from.X)
	goalIdx := int32(home.Y*ws.MapWidth + home.X)
	if startIdx == goalIdx {
		return true
	}
	seen := map[int32]bool{startIdx: true}
	depth := map[int32]int{startIdx: 0}
	queue := []int32{startIdx}
	for head := 0; head < len(queue); head++ {
		cur := queue[head]
		if depth[cur] >= pocketFloodBudget {
			continue
		}
		tile := model.Position{X: int(cur) % ws.MapWidth, Y: int(cur) / ws.MapWidth}
		for _, n := range ws.SurfaceNeighbors(tile) {
			if !ws.InBounds(n.X, n.Y) {
				continue
			}
			idx := int32(n.Y*ws.MapWidth + n.X)
			if seen[idx] {
				continue
			}
			if idx == goalIdx {
				return true // 基地本身被建筑占着，但"走得到基地格"就是走得到家
			}
			if occupied[n] || ws.TileBuilding[model.TileKey(n.X, n.Y)] != "" || !ws.Grid[n.Y][n.X].Terrain.Buildable() {
				continue
			}
			if ws.Construction != nil && ws.Construction.ReservedTiles[model.TileKey(n.X, n.Y)] != "" {
				continue
			}
			seen[idx] = true
			depth[idx] = depth[cur] + 1
			queue = append(queue, idx)
		}
	}
	return false
}

// unitTileBlockedBeforeBuild 单格在本次建造之前是否已不可通行（建筑/地形/界外/施工预留）。
func unitTileBlockedBeforeBuild(ws *model.WorldState, pos model.Position) bool {
	if !ws.InBounds(pos.X, pos.Y) {
		return true
	}
	if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
		return true
	}
	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return true
	}
	if ws.Construction != nil && ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] != "" {
		return true
	}
	return false
}

// unitTileBlockedAfterBuild 单格在本次建造之后是否不可通行（建筑/地形/界外/施工预留）。
func unitTileBlockedAfterBuild(ws *model.WorldState, pos model.Position, occupied map[model.Position]bool) bool {
	if !ws.InBounds(pos.X, pos.Y) {
		return true
	}
	tile := pos
	tile.Z = 0
	if occupied[tile] {
		return true
	}
	if ws.TileBuilding[model.TileKey(pos.X, pos.Y)] != "" {
		return true
	}
	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		return true
	}
	if ws.Construction != nil && ws.Construction.ReservedTiles[model.TileKey(pos.X, pos.Y)] != "" {
		return true
	}
	return false
}

// buildSiteTouchesLava reports whether the building footprint at pos or its
func buildSiteTouchesLava(ws *model.WorldState, btype model.BuildingType, pos model.Position) bool {
	footprint := model.BuildingProfileFor(btype, 1).Runtime.Params.Footprint
	isLava := func(x, y int) bool {
		if y < 0 || y >= len(ws.Grid) || x < 0 || x >= len(ws.Grid[y]) {
			return false
		}
		return ws.Grid[y][x].Terrain == terrain.TileLava
	}
	return model.LavaProximityOk(isLava, pos.X, pos.Y, footprint.Width, footprint.Height)
}

// constructionTaskPayload 的 task_id 同时是行星路由引用。
type constructionTaskPayload struct {
	TaskID string `json:"task_id" payload:"required"`
}

func (p constructionTaskPayload) entityRefs() entityRefs {
	return entityRefs{tasks: []string{p.TaskID}}
}

// execCancelConstruction handles the "cancel_construction" command
func (gc *GameCore) execCancelConstruction(ws *model.WorldState, playerID string, cmd model.Command, p constructionTaskPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	taskID := p.TaskID

	if ws.Construction == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到施工队列"
		return res, nil
	}
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到施工任务（可能已完成或已取消）"
		return res, nil
	}
	if task.PlayerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能取消其他玩家的施工任务"
		return res, nil
	}
	if task.State != model.ConstructionPending && task.State != model.ConstructionInProgress {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("施工任务处于 %s 状态，无法取消", task.State)
		return res, nil
	}

	// Release material reservation and refund based on remaining progress
	releaseConstructionReservation(ws, task)

	if err := ws.Construction.Transition(taskID, model.ConstructionCancelled); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	// Remove from queue (releases tile reservation)
	ws.Construction.Remove(taskID)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("施工任务 %s 已取消", taskID)
	return res, nil
}

// execRestoreConstruction handles the "restore_construction" command
func (gc *GameCore) execRestoreConstruction(ws *model.WorldState, playerID string, cmd model.Command, p constructionTaskPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	taskID := p.TaskID

	if ws.Construction == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到施工队列"
		return res, nil
	}
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到施工任务（可能已完成或已取消）"
		return res, nil
	}
	if task.PlayerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能恢复其他玩家的施工任务"
		return res, nil
	}
	if task.State != model.ConstructionCancelled && task.State != model.ConstructionPaused {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("施工任务处于 %s 状态，无法恢复", task.State)
		return res, nil
	}

	tiles, err := ws.ConstructionTiles(task)
	if err != nil {
		res.Code = model.CodeInvalidTarget
		res.Message = err.Error()
		return res, nil
	}
	for _, p := range tiles {
		key := model.TileKey(p.X, p.Y)
		lavaSite := model.RequiresLavaProximity(task.BuildingType) && ws.Grid[p.Y][p.X].Terrain == terrain.TileLava
		if ws.TileBuilding[key] != "" || (!ws.Grid[p.Y][p.X].Terrain.Buildable() && task.BuildingType != model.BuildingTypeFoundation && !lavaSite) || (ws.Construction.ReservedTiles[key] != "" && ws.Construction.ReservedTiles[key] != taskID) {
			res.Code = model.CodePositionOccupied
			res.Message = "施工占地不可用"
			return res, nil
		}
		if foundation := ws.FoundationAt(p); foundation != nil && (task.BuildingType == model.BuildingTypeFoundation || (foundation.Job != nil && foundation.Job.Type == model.BuildingJobDemolish)) {
			res.Code = model.CodePositionOccupied
			res.Message = "施工地基不可用"
			return res, nil
		}
	}

	// For cancelled tasks, re-reserve materials (they were refunded on cancel)
	// For paused tasks, materials remain reserved (handled by pause logic in T079)
	if task.State == model.ConstructionCancelled {
		if _, err := reserveConstructionMaterials(ws, task); err != nil {
			res.Code = model.CodeInsufficientResource
			res.Message = "资源不足，无法恢复施工：" + err.Error()
			return res, nil
		}
	}

	// Restore: move back to pending, re-reserve tile and requeue
	task.State = model.ConstructionPending
	task.UpdateTick = ws.Tick

	// Re-reserve tile
	if ws.Construction.ReservedTiles == nil {
		ws.Construction.ReservedTiles = make(map[string]string)
	}
	for _, p := range tiles {
		ws.Construction.ReservedTiles[model.TileKey(p.X, p.Y)] = taskID
	}

	// Re-add to order if not present
	inOrder := false
	for _, id := range ws.Construction.Order {
		if id == taskID {
			inOrder = true
			break
		}
	}
	if !inOrder {
		ws.Construction.Order = append(ws.Construction.Order, taskID)
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("施工任务 %s 已恢复为 pending", taskID)
	return res, nil
}

// execUpgrade handles upgrading a building
func (gc *GameCore) execUpgrade(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	var events []*model.GameEvent

	entityID := cmd.Target.EntityID
	if entityID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "缺少 target.entity_id"
		return res, nil
	}

	building, ok := ws.Buildings[entityID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到建筑（可能已被拆除）"
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能升级其他玩家的建筑"
		return res, nil
	}
	if building.Job != nil {
		res.Code = model.CodeDuplicate
		res.Message = "建筑已有进行中的作业"
		return res, nil
	}

	rule := model.BuildingUpgradeRuleFor(building.Type)
	if !rule.Allow {
		res.Code = model.CodeInvalidTarget
		res.Message = "该建筑不允许升级"
		return res, nil
	}
	if building.Level >= rule.MaxLevel {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("建筑已达最高等级 %d", rule.MaxLevel)
		return res, nil
	}
	if rule.RequireIdle && building.Runtime.State != model.BuildingWorkIdle {
		res.Code = model.CodeInvalidTarget
		res.Message = "建筑须处于 idle 状态才能升级"
		return res, nil
	}

	cost := model.BuildingUpgradeCost(building.Type, building.Level)
	upgradeCostM := cost.Minerals
	upgradeCostE := cost.Energy

	player := ws.Players[playerID]
	if player.Resources.Minerals < upgradeCostM {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("升级需要 %d 矿物", upgradeCostM)
		return res, nil
	}
	if player.Resources.Energy < upgradeCostE {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("升级需要 %d 能量", upgradeCostE)
		return res, nil
	}
	if missing, ok := missingItem(player.Inventory, cost.Items); ok {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("升级缺少 %d 个「%s」", missing.Quantity, itemDisplayName(missing.ItemID))
		return res, nil
	}

	if rangeRes := gc.requireBuildRange(ws, playerID, building.Position); rangeRes != nil {
		return *rangeRes, nil
	}
	playerState := ws.Players[playerID]
	if execState := playerState.ExecutorForPlanet(ws.PlanetID); execState != nil && !gc.reserveExecutorSlot(playerID, execState.ConcurrentTasks) {
		res.Code = model.CodeExecutorBusy
		res.Message = "机甲正忙"
		return res, nil
	}

	player.Resources.Minerals -= upgradeCostM
	player.Resources.Energy -= upgradeCostE
	if !player.DeductItems(cost.Items) {
		player.Resources.Minerals += upgradeCostM
		player.Resources.Energy += upgradeCostE
		res.Code = model.CodeInsufficientResource
		res.Message = "升级所需物品不足"
		return res, nil
	}

	nextLevel := building.Level + 1
	if rule.DurationTicks > 0 {
		building.Job = &model.BuildingJob{
			Type:           model.BuildingJobUpgrade,
			RemainingTicks: rule.DurationTicks,
			TargetLevel:    nextLevel,
			PrevState:      building.Runtime.State,
		}
		if evt := applyBuildingState(building, model.BuildingWorkPaused, stateReasonPause); evt != nil {
			events = append(events, evt)
		}
		res.Status = model.StatusExecuted
		res.Code = model.CodeOK
		res.Message = fmt.Sprintf("建筑 %s 开始升级（等级 %d -> %d，%d tick）", entityID, building.Level, nextLevel, rule.DurationTicks)
		return res, events
	}

	applyUpgrade(building, nextLevel, building.Runtime.State)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("建筑 %s 已升级到 %d 级", entityID, building.Level)
	return res, events
}

// execDemolish handles demolishing a building
func (gc *GameCore) execDemolish(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	var events []*model.GameEvent

	entityID := cmd.Target.EntityID
	if entityID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "缺少 target.entity_id"
		return res, nil
	}

	building, ok := ws.Buildings[entityID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = "未找到建筑（可能已被拆除）"
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "不能拆除其他玩家的建筑"
		return res, nil
	}
	if model.DistributorOnHost(ws, building.ID) != nil || model.DistributorBotCount(ws, building.ID) > 0 {
		return mechaJobFailed(model.CodeInvalidTarget, "拆除前需先移除仓库上的配送器并卸下其机器人")
	}
	if building.Type == model.BuildingTypeBattlefieldAnalysisBase {
		res.Code = model.CodeInvalidTarget
		res.Message = "不能拆除自己的基地"
		return res, nil
	}
	if building.Type == model.BuildingTypeFoundation {
		foundationTiles, _ := ws.BuildingTiles(building)
		occupied := make(map[string]struct{}, len(foundationTiles))
		for _, tile := range foundationTiles {
			key := model.TileKey(tile.X, tile.Y)
			if ws.Construction != nil && ws.Construction.ReservedTiles[key] != "" {
				res.Code = model.CodeInvalidTarget
				res.Message = "地基上有施工预留，无法拆除"
				return res, nil
			}
			occupied[key] = struct{}{}
		}
		for otherID, other := range ws.Buildings {
			if otherID == entityID || other == nil {
				continue
			}
			otherTiles, _ := ws.BuildingTiles(other)
			for _, tile := range otherTiles {
				if _, overlaps := occupied[model.TileKey(tile.X, tile.Y)]; overlaps {
					res.Code = model.CodeInvalidTarget
					res.Message = "地基上有其他建筑，无法拆除"
					return res, nil
				}
			}
		}
	}
	if building.Job != nil {
		res.Code = model.CodeDuplicate
		res.Message = "建筑已有进行中的作业"
		return res, nil
	}
	rule := model.BuildingDemolishRuleFor(building.Type)
	if !rule.Allow {
		res.Code = model.CodeInvalidTarget
		res.Message = "该建筑不允许拆除"
		return res, nil
	}
	if rule.RequireIdle && building.Runtime.State != model.BuildingWorkIdle {
		res.Code = model.CodeInvalidTarget
		res.Message = "建筑须处于 idle 状态才能拆除"
		return res, nil
	}

	if rangeRes := gc.requireBuildRange(ws, playerID, building.Position); rangeRes != nil {
		return *rangeRes, nil
	}
	playerState := ws.Players[playerID]
	if execState := playerState.ExecutorForPlanet(ws.PlanetID); execState != nil && !gc.reserveExecutorSlot(playerID, execState.ConcurrentTasks) {
		res.Code = model.CodeExecutorBusy
		res.Message = "机甲正忙"
		return res, nil
	}

	if rule.DurationTicks > 0 {
		building.Job = &model.BuildingJob{
			Type:           model.BuildingJobDemolish,
			RemainingTicks: rule.DurationTicks,
			RefundRate:     rule.RefundRate,
			PrevState:      building.Runtime.State,
		}
		if evt := applyBuildingState(building, model.BuildingWorkPaused, stateReasonPause); evt != nil {
			events = append(events, evt)
		}
		res.Status = model.StatusExecuted
		res.Code = model.CodeOK
		res.Message = fmt.Sprintf("建筑 %s 开始拆除（%d tick）", entityID, rule.DurationTicks)
		return res, events
	}

	events = demolishBuilding(ws, building, rule.RefundRate)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("建筑 %s 已拆除", entityID)
	return res, events
}
