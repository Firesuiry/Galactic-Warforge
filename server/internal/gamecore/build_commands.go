package gamecore

import (
	"fmt"

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
		res.Message = fmt.Sprintf("未知建筑类型：%s", btype)
		return res, nil
	}
	if !def.Buildable {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("该建筑类型不可建造：%s", btype)
		return res, nil
	}

	// Check tech unlock requirement
	player := ws.Players[playerID]
	if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("建筑类型 %s 需先研究解锁", btype)
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
			res.Message = fmt.Sprintf("未知配方：%s", recipeID)
			return res, nil
		}
		if def := model.BuildingProfileFor(btype, 1); def.Runtime.Functions.Production == nil {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("建筑类型 %s 不支持配方", btype)
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
			res.Message = fmt.Sprintf("配方 %s 不适用于建筑类型 %s", recipeID, btype)
			return res, nil
		}
		if !CanUseRecipeTech(player, recipeID) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("配方 %s 需先研究解锁", recipeID)
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
		res.Message = fmt.Sprintf("%s 必须建在熔岩上或紧邻熔岩", btype)
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
		res.Message = fmt.Sprintf("建造缺少 %d 个 %s", missing.Quantity, missing.ItemID)
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
	res.Message = fmt.Sprintf("施工任务 %s 已排队，位置 (%d,%d)", taskID, pos.X, pos.Y)
	return res, nil
}

// buildSiteTouchesLava reports whether the building footprint at pos or its
// 1-tile surrounding ring touches lava terrain (geothermal placement rule).
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
		res.Message = fmt.Sprintf("未找到施工任务 %s", taskID)
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
		res.Message = fmt.Sprintf("未找到施工任务 %s", taskID)
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
		res.Message = fmt.Sprintf("未找到建筑 %s", entityID)
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
		res.Message = fmt.Sprintf("升级缺少 %d 个 %s", missing.Quantity, missing.ItemID)
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
		res.Message = fmt.Sprintf("未找到建筑 %s", entityID)
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
