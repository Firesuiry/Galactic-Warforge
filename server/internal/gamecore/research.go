package gamecore

import (
	"fmt"
	"math"
	"sort"

	"siliconworld/internal/model"
)

// stackSharedStorage resolves the effective storage of a research lab:
// vertically stacked layers (Z>0) share the ground layer's storage, DSP-style.
// The ground building is the one registered in TileBuilding for (x, y).
func stackSharedStorage(ws *model.WorldState, building *model.Building) *model.StorageState {
	if ws == nil || building == nil {
		return nil
	}
	if building.Position.Z <= 0 {
		return building.Storage
	}
	base := ws.Buildings[ws.TileBuilding[model.TileKey(building.Position.X, building.Position.Y)]]
	if base == nil || base.Type != building.Type || base.OwnerID != building.OwnerID || base.Storage == nil {
		return building.Storage
	}
	return base.Storage
}

// researchLabStorageResolver returns a lookup of each lab's effective
// (stack-shared) storage, keyed by lab building ID.
func researchLabStorageResolver(worlds map[string]*model.WorldState, labs []*model.Building) func(*model.Building) *model.StorageState {
	worldByBuilding := make(map[string]*model.WorldState, len(labs))
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for id := range ws.Buildings {
			worldByBuilding[id] = ws
		}
	}
	return func(building *model.Building) *model.StorageState {
		if building == nil {
			return nil
		}
		if ws, ok := worldByBuilding[building.ID]; ok {
			return stackSharedStorage(ws, building)
		}
		return building.Storage
	}
}

// hiddenTechDiscovered reports whether a hidden tech has become visible to the
// player. DSP semantics: hidden Dark Fog techs reveal themselves once the
// player holds the trigger item (e.g. dark_fog_matrix loot); here the trigger
// is holding at least one of every item in the tech's next-level cost, either
// in the player inventory or in a research lab's storage.
func hiddenTechDiscovered(player *model.PlayerState, labs []*model.Building, cost []model.ItemAmount, storageOf func(*model.Building) *model.StorageState) bool {
	for _, c := range cost {
		if c.ItemID == "" || c.Quantity <= 0 {
			continue
		}
		total := 0
		if player != nil && player.Inventory != nil {
			total += player.Inventory[c.ItemID]
		}
		for _, lab := range labs {
			storage := storageOf(lab)
			if storage == nil {
				continue
			}
			total += storage.OutputQuantity(c.ItemID)
		}
		if total <= 0 {
			return false
		}
	}
	return true
}

// settleResearch processes research progress for all players using real matrix items.
func settleResearch(worlds map[string]*model.WorldState, pace float64) []*model.GameEvent {
	var events []*model.GameEvent

	for _, player := range researchPlayers(worlds) {
		if player == nil || !player.IsAlive {
			continue
		}
		if player.Tech == nil {
			player.Tech = model.NewPlayerTechState(player.PlayerID)
		}
		// 镜像本局研究倍率，保证查询层（/catalog、agent briefing）与结算同源。
		player.Tech.ResearchPace = paceOrOne(pace)
		if player.Tech.CurrentResearch == nil {
			advanceQueuedResearch(player, currentResearchTick(worlds))
			continue
		}

		research := player.Tech.CurrentResearch
		if research.State != model.ResearchInProgress {
			continue
		}

		def, ok := model.TechDefinitionByID(research.TechID)
		if !ok {
			research.State = model.ResearchCancelled
			research.BlockedReason = "invalid_tech"
			player.Tech.CurrentResearch = nil
			advanceQueuedResearch(player, currentResearchTick(worlds))
			continue
		}

		labs := runningResearchLabs(worlds, player.PlayerID)
		if len(labs) == 0 {
			research.SpeedMultiplier = 0
			research.EstimatedTicksRemaining = 0
			if hasUnpoweredResearchLab(worlds, player.PlayerID) {
				research.BlockedReason = "low_power"
			} else {
				research.BlockedReason = "waiting_lab"
			}
			continue
		}

		throughput, powerMultiplier := researchThroughput(player, labs, researchPowerRatios(worlds))
		research.SpeedMultiplier = powerMultiplier
		if throughput <= 0 {
			research.BlockedReason = "low_power"
			research.EstimatedTicksRemaining = 0
			continue
		}

		progressed := consumeResearchProgress(labs, research, throughput, researchLabStorageResolver(worlds, labs))
		if progressed <= 0 {
			research.BlockedReason = "waiting_matrix"
			research.EstimatedTicksRemaining = 0
			continue
		}
		if powerMultiplier < 1 {
			research.BlockedReason = "low_power"
		} else {
			research.BlockedReason = ""
		}
		research.EstimatedTicksRemaining = estimateResearchTicksRemaining(research, throughput)

		if research.Progress >= research.TotalCost {
			completeResearch(player, research, def, currentResearchTick(worlds), &events)
		}
	}

	return events
}

func researchPlayers(worlds map[string]*model.WorldState) map[string]*model.PlayerState {
	if len(worlds) == 0 {
		return nil
	}
	planetIDs := make([]string, 0, len(worlds))
	for planetID := range worlds {
		planetIDs = append(planetIDs, planetID)
	}
	sort.Strings(planetIDs)
	for _, planetID := range planetIDs {
		if ws := worlds[planetID]; ws != nil && ws.Players != nil {
			return ws.Players
		}
	}
	return nil
}

func currentResearchTick(worlds map[string]*model.WorldState) int64 {
	var tick int64
	for _, ws := range worlds {
		if ws != nil && ws.Tick > tick {
			tick = ws.Tick
		}
	}
	return tick
}

func advanceQueuedResearch(player *model.PlayerState, tick int64) {
	if player == nil || player.Tech == nil || len(player.Tech.ResearchQueue) == 0 {
		return
	}
	player.Tech.CurrentResearch = player.Tech.ResearchQueue[0]
	player.Tech.ResearchQueue = player.Tech.ResearchQueue[1:]
	if player.Tech.CurrentResearch != nil {
		player.Tech.CurrentResearch.State = model.ResearchInProgress
		player.Tech.CurrentResearch.EnqueueTick = tick
		player.Tech.CurrentResearch.BlockedReason = ""
	}
}

func isResearchLab(building *model.Building) bool {
	if building == nil || building.Runtime.Functions.Research == nil {
		return false
	}
	if building.Production == nil {
		return true
	}
	return building.Production.RecipeID == ""
}

// researchLabIntakeRejection 报告「研究模式的研究站不该收下这件物品」，
// 空字符串表示可以照常装入。
//
// 研究模式（isResearchLab，即未设配方）的研究站只把库存里的矩阵当作研究
// 耗材；其它物品（电路板、磁线圈、铁块……）装进去既不会被消耗，也不会被
// 产出，只会占住站的库存格、把机甲背包里的料锁死。与其收下，不如拒绝并
// 说清它真正需要什么（试玩报告 1013：把电路板/磁线圈直接装进研究站时，
// 回执只说「已传输」，玩家以为这就够了）。
func researchLabIntakeRejection(building *model.Building, itemID string) string {
	if building == nil || building.Runtime.Functions.Research == nil || !isResearchLab(building) {
		return ""
	}
	if def, ok := model.Item(itemID); ok && def.Category == model.ItemCategoryMatrix {
		return ""
	}
	return fmt.Sprintf("%s处于研究模式，只接受矩阵（研究耗材）；「%s」请送到制造台或仓库，需要研究材料时把矩阵装入本建筑",
		buildingDisplayName(building), itemDisplayName(itemID))
}

// researchLabBlockReason 解释「为什么没有一台可用的研究站」，供 start_research 的
// 回执使用；玩家一台研究类建筑都没有时返回 ok=false（此时才是真的没建）。
//
// 试玩报告 1013 B：玩家明明有矩阵研究站，却因为两种完全不同的原因被同一句
// 「需要至少一台运行中的研究站（matrix_lab 或 self_evolution_lab）」拒掉：
//  1. 研究站设了生产配方 —— 它按 DSP 语义不再算研究站，界面上没有任何提示；
//  2. 研究站不在供电范围内 —— 整局 state=no_power。
//
// 两种原因的可操作修复完全不同，所以分开说：配方问题点名建筑与当前配方、
// 指明要切回「无配方（研究模式）」；断电问题直接说断电并提示接电。
func researchLabBlockReason(worlds map[string]*model.WorldState, playerID string) (string, bool) {
	planetIDs := make([]string, 0, len(worlds))
	for id := range worlds {
		planetIDs = append(planetIDs, id)
	}
	sort.Strings(planetIDs)

	type researchLab struct {
		building *model.Building
		recipe   string
	}
	var labs []researchLab
	for _, planetID := range planetIDs {
		ws := worlds[planetID]
		if ws == nil {
			continue
		}
		ids := make([]string, 0, len(ws.Buildings))
		for id := range ws.Buildings {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			building := ws.Buildings[id]
			if building == nil || building.OwnerID != playerID || building.HP <= 0 || building.Runtime.Functions.Research == nil {
				continue
			}
			recipe := ""
			if building.Production != nil {
				recipe = building.Production.RecipeID
			}
			labs = append(labs, researchLab{building: building, recipe: recipe})
		}
	}
	if len(labs) == 0 {
		return "", false
	}

	// 1) 研究模式下不在运行：断电最常见，直接说断电与修法。
	for _, lab := range labs {
		if lab.recipe != "" {
			continue
		}
		if lab.building.Runtime.State == model.BuildingWorkNoPower {
			return fmt.Sprintf("%s（%d,%d）已断电，无法研究：先把它接进电网（电塔或无线输电塔的无线覆盖范围内）",
				buildingDisplayName(lab.building), lab.building.Position.X, lab.building.Position.Y), true
		}
	}
	// 2) 研究模式但停在其它非运行状态（停工/空闲/出错）。
	for _, lab := range labs {
		if lab.recipe != "" {
			continue
		}
		if lab.building.Runtime.State != model.BuildingWorkRunning {
			return fmt.Sprintf("%s（%d,%d）当前状态为 %s，不在运行：先让它恢复运行再开始研究",
				buildingDisplayName(lab.building), lab.building.Position.X, lab.building.Position.Y, lab.building.Runtime.State), true
		}
	}
	// 3) 有研究站，但全部被设成了生产建筑。
	for _, lab := range labs {
		if lab.recipe == "" {
			continue
		}
		return fmt.Sprintf("%s（%d,%d）当前设为生产「%s」，不算研究站：把它的配方切换为「无配方（研究模式）」后才能研究",
			buildingDisplayName(lab.building), lab.building.Position.X, lab.building.Position.Y, recipeDisplayName(lab.recipe)), true
	}
	return "", false
}

func runningResearchLabs(worlds map[string]*model.WorldState, playerID string) []*model.Building {
	var labs []*model.Building
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, building := range ws.Buildings {
			if building == nil || building.OwnerID != playerID {
				continue
			}
			if building.Runtime.State != model.BuildingWorkRunning {
				continue
			}
			if !isResearchLab(building) {
				continue
			}
			labs = append(labs, building)
		}
	}
	return labs
}

// researchPowerRatios returns the current power allocation ratio (0..1) for
// every research-capable building that participates in a power network,
// sourced from the same power settlement snapshot used by resource
// settlement. Buildings outside any network have no entry; they are flipped
// to the no-power state by resource settlement within the same tick, so
// research treats them at full ratio until that state transition lands.
func researchPowerRatios(worlds map[string]*model.WorldState) map[string]float64 {
	ratios := make(map[string]float64)
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		var allocations model.PowerAllocationState
		if snapshot := model.CurrentPowerSettlementSnapshot(ws); snapshot != nil {
			allocations = snapshot.Allocations
		}
		for id, building := range ws.Buildings {
			if building == nil || building.Runtime.Functions.Research == nil {
				continue
			}
			if alloc, ok := allocations.Buildings[id]; ok {
				ratios[id] = alloc.Ratio
			}
		}
	}
	return ratios
}

// hasUnpoweredResearchLab reports whether the player owns a research lab that
// is stalled specifically because it has no power.
func hasUnpoweredResearchLab(worlds map[string]*model.WorldState, playerID string) bool {
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		for _, building := range ws.Buildings {
			if building == nil || building.OwnerID != playerID {
				continue
			}
			if !isResearchLab(building) {
				continue
			}
			if building.Runtime.State == model.BuildingWorkNoPower {
				return true
			}
		}
	}
	return false
}

// researchThroughput returns the effective research speed (matrix items per
// tick) and the power multiplier across all running labs. The multiplier is
// the per-lab power allocation ratio weighted by ResearchPerTick; 1 means
// every lab is fully powered.
func researchThroughput(player *model.PlayerState, labs []*model.Building, powerRatios map[string]float64) (int, float64) {
	baseSpeed := 0
	effectiveSpeed := 0.0
	for _, building := range labs {
		if building == nil || building.Runtime.Functions.Research == nil {
			continue
		}
		perTick := building.Runtime.Functions.Research.ResearchPerTick
		if perTick <= 0 {
			continue
		}
		ratio := 1.0
		if model.PowerDemandForBuilding(building) > 0 {
			if allocRatio, ok := powerRatios[building.ID]; ok {
				ratio = allocRatio
			}
		}
		baseSpeed += perTick
		effectiveSpeed += float64(perTick) * ratio
	}
	if baseSpeed <= 0 {
		return 0, 0
	}
	multiplier := effectiveSpeed / float64(baseSpeed)
	boost := 0.0
	if player != nil {
		for _, exec := range player.Executors {
			if exec != nil && exec.ResearchBoost > boost {
				boost = exec.ResearchBoost
			}
		}
	}
	boost += model.TechEffectValue(player, "research_speed")
	if boost > 0 {
		effectiveSpeed *= 1 + boost
	}
	speed := int(math.Ceil(effectiveSpeed))
	if effectiveSpeed > 0 && speed < 1 {
		speed = 1
	}
	return speed, multiplier
}

// estimateResearchTicksRemaining estimates how many ticks the current research
// still needs at the given effective throughput.
func estimateResearchTicksRemaining(research *model.PlayerResearch, throughput int) int64 {
	if research == nil || throughput <= 0 {
		return 0
	}
	remaining := research.TotalCost - research.Progress
	if remaining <= 0 {
		return 0
	}
	perTick := int64(throughput)
	return (remaining + perTick - 1) / perTick
}

// completeResearch marks a research as completed and applies unlocks
func completeResearch(player *model.PlayerState, research *model.PlayerResearch, def *model.TechDefinition, tick int64, events *[]*model.GameEvent) {
	research.State = model.ResearchCompleted
	research.CompleteTick = tick
	research.BlockedReason = ""

	// Record completed tech
	if player.Tech.CompletedTechs == nil {
		player.Tech.CompletedTechs = make(map[string]int)
	}

	// Increment level for repeatable techs
	currentLevel := player.Tech.CompletedTechs[research.TechID]
	player.Tech.CompletedTechs[research.TechID] = currentLevel + 1

	// Update total researched
	player.Tech.TotalResearched += research.TotalCost

	// Emit research completed event
	*events = append(*events, &model.GameEvent{
		EventType:       "research_completed",
		VisibilityScope: player.PlayerID,
		Payload: map[string]any{
			"tech_id":       research.TechID,
			"tech_name":     def.Name,
			"level":         currentLevel + 1,
			"unlocks":       def.Unlocks,
			"complete_tick": tick,
		},
	})

	// Clear current research and start next from queue
	player.Tech.CurrentResearch = nil
	advanceQueuedResearch(player, tick)
}

type researchPayload struct {
	TechID string `json:"tech_id" payload:"required"`
}

// execStartResearch handles the "start_research" command
func (gc *GameCore) execStartResearch(ws *model.WorldState, playerID string, cmd model.Command, p researchPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	techID := p.TechID

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "未找到玩家"
		return res, nil
	}

	// Initialize tech state if needed
	if player.Tech == nil {
		player.Tech = model.NewPlayerTechState(playerID)
	}

	// Check if already researching or queued
	for _, r := range player.Tech.ResearchQueue {
		if r.TechID == techID && r.State == model.ResearchPending {
			res.Code = model.CodeDuplicate
			res.Message = "科技已在研究队列中"
			return res, nil
		}
	}
	if player.Tech.CurrentResearch != nil && player.Tech.CurrentResearch.TechID == techID {
		res.Code = model.CodeDuplicate
		res.Message = "科技正在研究中"
		return res, nil
	}

	// Get tech definition
	def, ok := model.TechDefinitionByID(techID)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("未知科技：%s", techID)
		return res, nil
	}

	// Check prerequisites
	if !player.Tech.HasPrerequisites(def) {
		res.Code = model.CodeValidationFailed
		res.Message = "前置科技未满足"
		return res, nil
	}

	// Check if already completed (for non-repeatable techs)
	if def.MaxLevel == 0 {
		if player.Tech.HasTech(techID) {
			res.Code = model.CodeValidationFailed
			res.Message = "科技已完成"
			return res, nil
		}
	} else {
		// For repeatable techs, check max level
		currentLevel := 0
		if lvl, ok := player.Tech.CompletedTechs[techID]; ok {
			currentLevel = lvl
		}
		if def.MaxLevel > 0 && currentLevel >= def.MaxLevel {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("科技已达最高等级 %d", def.MaxLevel)
			return res, nil
		}
	}

	labs := runningResearchLabs(gc.worlds, playerID)
	if len(labs) == 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "需要至少一台运行中的研究站"
		if detail, ok := researchLabBlockReason(gc.worlds, playerID); ok {
			res.Message = detail
		}
		return res, nil
	}
	storageOf := researchLabStorageResolver(gc.worlds, labs)

	// Hidden techs (Dark Fog chain) become researchable once the player holds
	// the trigger items; before that they stay invisible.
	if def.Hidden && !hiddenTechDiscovered(player, labs, def.CostForLevel(player.Tech.CompletedTechs[techID]+1), storageOf) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("科技 %s 尚未显现，需先获得其触发物品", techID)
		return res, nil
	}

	// The cost of the level being researched (1-based); repeatable techs with
	// CostPerLevel pay per-level prices, everything else pays def.Cost.
	nextLevel := player.Tech.CompletedTechs[techID] + 1
	levelCost := def.CostForLevel(nextLevel)
	for _, cost := range levelCost {
		if cost.ItemID == "" || cost.Quantity <= 0 {
			continue
		}
		total := 0
		for _, lab := range labs {
			storage := storageOf(lab)
			if storage == nil {
				continue
			}
			total += storage.OutputQuantity(cost.ItemID)
		}
		if total <= 0 {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("研究站中缺少「%s」", itemDisplayName(cost.ItemID))
			return res, nil
		}
	}

	scaledCost := scaleResearchCost(levelCost, gc.researchPace())
	totalCost := calculateTechCost(scaledCost)
	if len(levelCost) == 0 {
		totalCost = int64(scaleTicks(int(totalCost), gc.researchPace()))
	}

	// Create research state
	research := &model.PlayerResearch{
		TechID:        techID,
		State:         model.ResearchPending,
		Progress:      0,
		TotalCost:     totalCost,
		CurrentLevel:  player.Tech.CompletedTechs[techID],
		RequiredCost:  scaledCost,
		ConsumedCost:  make(map[string]int, len(levelCost)),
		BlockedReason: "",
	}

	// Add to queue (research starts immediately if nothing is being researched)
	if player.Tech.CurrentResearch == nil {
		research.State = model.ResearchInProgress
		research.EnqueueTick = ws.Tick
		player.Tech.CurrentResearch = research
	} else {
		player.Tech.ResearchQueue = append(player.Tech.ResearchQueue, research)
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("研究 %s 已加入队列（消耗：%d）", def.Name, totalCost)
	return res, nil
}

// execCancelResearch handles the "cancel_research" command
func (gc *GameCore) execCancelResearch(ws *model.WorldState, playerID string, cmd model.Command, p researchPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	techID := p.TechID

	player := ws.Players[playerID]
	if player == nil || player.Tech == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "当前没有进行中的研究"
		return res, nil
	}

	// Check current research
	if player.Tech.CurrentResearch != nil && player.Tech.CurrentResearch.TechID == techID {
		player.Tech.CurrentResearch.State = model.ResearchCancelled
		player.Tech.CurrentResearch = nil

		// Start next from queue
		advanceQueuedResearch(player, ws.Tick)

		res.Status = model.StatusExecuted
		res.Code = model.CodeOK
		res.Message = fmt.Sprintf("研究 %s 已取消", techID)
		return res, nil
	}

	// Check queue
	for i, r := range player.Tech.ResearchQueue {
		if r.TechID == techID {
			player.Tech.ResearchQueue = append(player.Tech.ResearchQueue[:i], player.Tech.ResearchQueue[i+1:]...)
			res.Status = model.StatusExecuted
			res.Code = model.CodeOK
			res.Message = fmt.Sprintf("研究 %s 已移出队列", techID)
			return res, nil
		}
	}

	res.Code = model.CodeValidationFailed
	res.Message = "未找到该研究"
	return res, nil
}

// calculateTechCost calculates the total cost for a tech from its effective
// item cost list (already resolved for the level being researched).
func calculateTechCost(cost []model.ItemAmount) int64 {
	// Cost is in matrix items, but we track as "research points"
	// For simplicity, each matrix item counts as 1 point
	// In practice, higher-level techs require multiple matrix types
	total := int64(0)
	for _, c := range cost {
		total += int64(c.Quantity)
	}
	if total == 0 {
		// Default cost if no explicit cost defined
		return 100
	}
	return total
}

func consumeResearchProgress(labs []*model.Building, research *model.PlayerResearch, budget int, storageOf func(*model.Building) *model.StorageState) int {
	if research == nil || budget <= 0 || len(research.RequiredCost) == 0 || len(labs) == 0 {
		return 0
	}
	if research.ConsumedCost == nil {
		research.ConsumedCost = make(map[string]int, len(research.RequiredCost))
	}
	if storageOf == nil {
		storageOf = func(b *model.Building) *model.StorageState { return b.Storage }
	}

	progressed := 0
	for _, cost := range research.RequiredCost {
		remaining := cost.Quantity - research.ConsumedCost[cost.ItemID]
		for remaining > 0 && budget > 0 {
			consumedThisRound := false
			for _, lab := range labs {
				var storage *model.StorageState
				if lab != nil {
					storage = storageOf(lab)
				}
				if storage == nil {
					continue
				}
				available := storage.OutputQuantity(cost.ItemID)
				if available <= 0 {
					continue
				}
				take := min(min(available, remaining), budget)
				if take <= 0 {
					continue
				}
				provided, _, err := storage.Provide(cost.ItemID, take)
				if err != nil || provided <= 0 {
					continue
				}
				research.ConsumedCost[cost.ItemID] += provided
				research.Progress += int64(provided)
				progressed += provided
				budget -= provided
				remaining -= provided
				consumedThisRound = true
				if budget <= 0 {
					break
				}
			}
			if !consumedThisRound {
				break
			}
		}
		if budget <= 0 {
			break
		}
	}
	return progressed
}

// CanBuildTech checks if a player can build something that requires a tech unlock
func CanBuildTech(player *model.PlayerState, unlockType model.TechUnlockType, unlockID string) bool {
	if player == nil || player.Tech == nil {
		return false
	}

	// Iterate through all techs and check if any completed tech unlocks this
	for techID := range player.Tech.CompletedTechs {
		def, ok := model.TechDefinitionByID(techID)
		if !ok {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type == unlockType && unlock.ID == unlockID {
				return true
			}
		}
	}
	return false
}

// CanUseRecipeTech checks whether a player has unlocked the given recipe.
// A recipe is gated when at least one tech lists it in its recipe unlocks or
// the recipe itself declares tech gates via RecipeDefinition.TechUnlock; a
// gated recipe becomes usable once any of those techs is completed. Recipes
// with no gate at all are basic recipes and stay usable from the start.
// CanUseRecipeTech 配方是否可用：玩家已完成任一"解锁该配方的科技"即可。
// 性能：按配方 ID 缓存"哪些科技解锁了它"，避免每次调用都遍历全部科技定义
// （settleUnitCombat/bot 备料每 tick 调用上千次，是 tick p95 的热点）。
func CanUseRecipeTech(player *model.PlayerState, recipeID string) bool {
	if recipeID == "" {
		return false
	}
	if player == nil || player.Tech == nil {
		return false
	}
	recipe, known := model.Recipe(recipeID)
	if !known {
		return false
	}
	gated := false
	for _, techID := range model.TechsUnlockingRecipe(recipeID) {
		if player.Tech.HasTech(techID) {
			return true
		}
		gated = true
	}
	for _, techID := range recipe.TechUnlock {
		if player.Tech.HasTech(techID) {
			return true
		}
		gated = true
	}
	return !gated
}

// ValidateStartResearchLocked is the RLock-free variant called by the gateway
// pre-validator, which already holds ws.RLock().  Returns issues synchronously.
func (gc *GameCore) ValidateStartResearchLocked(playerID string, techID string, ws *model.WorldState) []model.CommandIssue {
	if gc == nil || ws == nil {
		return nil
	}
	def, ok := model.TechDefinitionByID(techID)
	if !ok {
		return []model.CommandIssue{{Field: "payload.tech_id", Code: "unknown_tech", Message: fmt.Sprintf("未知科技：%s", techID)}}
	}

	// 收集该玩家所有运行中研究站
	var labs []*model.Building
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID {
			continue
		}
		if b.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if !isResearchLab(b) {
			continue
		}
		labs = append(labs, b)
	}
	if len(labs) == 0 {
		message := "需要至少一台运行中的研究站（matrix_lab 或 self_evolution_lab）"
		if detail, ok := researchLabBlockReason(gc.worlds, playerID); ok {
			message = detail
		}
		return []model.CommandIssue{{Field: "lab", Code: "no_running_lab", Message: message}}
	}

	var issues []model.CommandIssue
	level := 1
	pace := 1.0
	if player := ws.Players[playerID]; player != nil && player.Tech != nil {
		level = player.Tech.CompletedTechs[def.ID] + 1
		pace = player.Tech.ResearchPace
	}
	for _, cost := range model.ScaledResearchCost(def.CostForLevel(level), pace) {
		if cost.ItemID == "" || cost.Quantity <= 0 {
			continue
		}
		total := 0
		for _, lab := range labs {
			storage := stackSharedStorage(ws, lab)
			if storage == nil {
				continue
			}
			total += storage.OutputQuantity(cost.ItemID)
		}
		if total <= 0 {
			issues = append(issues, model.CommandIssue{
				Field:   "lab.storage",
				Code:    "missing_research_material",
				Message: fmt.Sprintf("研究站库存中缺少「%s」（当前：0，需要：≥1）", itemDisplayName(cost.ItemID)),
			})
		}
	}
	return issues
}
