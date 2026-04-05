package gamecore

import (
	"fmt"
	"math"
	"sort"

	"siliconworld/internal/model"
)

// settleResearch processes research progress for all players using real matrix items.
func settleResearch(worlds map[string]*model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	for _, player := range researchPlayers(worlds) {
		if player == nil || !player.IsAlive {
			continue
		}
		if player.Tech == nil {
			player.Tech = model.NewPlayerTechState(player.PlayerID)
		}
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
			research.BlockedReason = "waiting_lab"
			continue
		}

		progressed := consumeResearchProgress(labs, research, researchThroughput(player, labs))
		if progressed <= 0 {
			research.BlockedReason = "waiting_matrix"
			continue
		}
		research.BlockedReason = ""

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

func researchThroughput(player *model.PlayerState, labs []*model.Building) int {
	speed := 0
	for _, building := range labs {
		if building == nil || building.Runtime.Functions.Research == nil {
			continue
		}
		speed += building.Runtime.Functions.Research.ResearchPerTick
	}
	if speed <= 0 {
		return 0
	}
	boost := 0.0
	if player != nil {
		if len(player.Executors) > 0 {
			for _, exec := range player.Executors {
				if exec != nil && exec.ResearchBoost > boost {
					boost = exec.ResearchBoost
				}
			}
		} else if player.Executor != nil {
			boost = player.Executor.ResearchBoost
		}
	}
	if boost > 0 {
		speed = int(math.Ceil(float64(speed) * (1 + boost)))
	}
	if speed < 1 {
		speed = 1
	}
	return speed
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

	// Process unlocks
	applyTechUnlocks(player, def)

	// Clear current research and start next from queue
	player.Tech.CurrentResearch = nil
	advanceQueuedResearch(player, tick)
}

// applyTechUnlocks applies the effects of a completed tech
func applyTechUnlocks(player *model.PlayerState, def *model.TechDefinition) {
	// For now, tech unlocks are tracked in the tech state.
	// Building/recipe unlock checking is done at build/use time by checking:
	// 1. If the tech that unlocks the building/recipe is in CompletedTechs
	// 2. If the current level of that tech is sufficient

	// Effects are applied as bonuses (e.g., research speed, build speed)
	// These are tracked separately and applied during relevant calculations
	for _, effect := range def.Effects {
		switch effect.Type {
		case "research_speed":
			// Handled via Executor.ResearchBoost
		case "build_speed":
			// Handled via Executor.BuildEfficiency
		case "core_capacity":
			// Handled via Executor cap increase
		case "move_speed":
			// Handled via unit move calculations
		}
	}
}

// execStartResearch handles the "start_research" command
func (gc *GameCore) execStartResearch(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	techIDRaw, ok := cmd.Payload["tech_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.tech_id required"
		return res, nil
	}
	techID := fmt.Sprintf("%v", techIDRaw)

	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found"
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
			res.Message = "tech already in research queue"
			return res, nil
		}
	}
	if player.Tech.CurrentResearch != nil && player.Tech.CurrentResearch.TechID == techID {
		res.Code = model.CodeDuplicate
		res.Message = "tech already being researched"
		return res, nil
	}

	// Get tech definition
	def, ok := model.TechDefinitionByID(techID)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown tech: %s", techID)
		return res, nil
	}
	if def.Hidden {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("tech %s is hidden and cannot be researched directly", techID)
		return res, nil
	}

	// Check prerequisites
	if !player.Tech.HasPrerequisites(def) {
		res.Code = model.CodeValidationFailed
		res.Message = "prerequisites not met"
		return res, nil
	}

	// Check if already completed (for non-repeatable techs)
	if def.MaxLevel == 0 {
		if player.Tech.HasTech(techID) {
			res.Code = model.CodeValidationFailed
			res.Message = "tech already completed"
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
			res.Message = fmt.Sprintf("tech at max level %d", def.MaxLevel)
			return res, nil
		}
	}

	labs := runningResearchLabs(gc.worlds, playerID)
	if len(labs) == 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "at least one running research lab is required"
		return res, nil
	}
	for _, cost := range def.Cost {
		if cost.ItemID == "" || cost.Quantity <= 0 {
			continue
		}
		total := 0
		for _, lab := range labs {
			if lab == nil || lab.Storage == nil {
				continue
			}
			total += lab.Storage.OutputQuantity(cost.ItemID)
		}
		if total <= 0 {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("missing %s in research labs", cost.ItemID)
			return res, nil
		}
	}

	totalCost := calculateTechCost(def)

	// Create research state
	research := &model.PlayerResearch{
		TechID:        techID,
		State:         model.ResearchPending,
		Progress:      0,
		TotalCost:     totalCost,
		CurrentLevel:  player.Tech.CompletedTechs[techID],
		RequiredCost:  append([]model.ItemAmount(nil), def.Cost...),
		ConsumedCost:  make(map[string]int, len(def.Cost)),
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
	res.Message = fmt.Sprintf("research %s queued (cost: %d)", def.Name, totalCost)
	return res, nil
}

// execCancelResearch handles the "cancel_research" command
func (gc *GameCore) execCancelResearch(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	techIDRaw, ok := cmd.Payload["tech_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.tech_id required"
		return res, nil
	}
	techID := fmt.Sprintf("%v", techIDRaw)

	player := ws.Players[playerID]
	if player == nil || player.Tech == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "no active research"
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
		res.Message = fmt.Sprintf("research %s cancelled", techID)
		return res, nil
	}

	// Check queue
	for i, r := range player.Tech.ResearchQueue {
		if r.TechID == techID {
			player.Tech.ResearchQueue = append(player.Tech.ResearchQueue[:i], player.Tech.ResearchQueue[i+1:]...)
			res.Status = model.StatusExecuted
			res.Code = model.CodeOK
			res.Message = fmt.Sprintf("research %s removed from queue", techID)
			return res, nil
		}
	}

	res.Code = model.CodeValidationFailed
	res.Message = "research not found"
	return res, nil
}

// calculateTechCost calculates the total cost for a tech
func calculateTechCost(def *model.TechDefinition) int64 {
	if def == nil {
		return 0
	}
	// Cost is in matrix items, but we track as "research points"
	// For simplicity, each matrix item counts as 1 point
	// In practice, higher-level techs require multiple matrix types
	total := int64(0)
	for _, cost := range def.Cost {
		total += int64(cost.Quantity)
	}
	if total == 0 {
		// Default cost if no explicit cost defined
		return 100
	}
	return total
}

func consumeResearchProgress(labs []*model.Building, research *model.PlayerResearch, budget int) int {
	if research == nil || budget <= 0 || len(research.RequiredCost) == 0 || len(labs) == 0 {
		return 0
	}
	if research.ConsumedCost == nil {
		research.ConsumedCost = make(map[string]int, len(research.RequiredCost))
	}

	progressed := 0
	for _, cost := range research.RequiredCost {
		remaining := cost.Quantity - research.ConsumedCost[cost.ItemID]
		for remaining > 0 && budget > 0 {
			consumedThisRound := false
			for _, lab := range labs {
				if lab == nil || lab.Storage == nil {
					continue
				}
				available := lab.Storage.OutputQuantity(cost.ItemID)
				if available <= 0 {
					continue
				}
				take := minInt(minInt(available, remaining), budget)
				if take <= 0 {
					continue
				}
				provided, _, err := lab.Storage.Provide(cost.ItemID, take)
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
func CanUseRecipeTech(player *model.PlayerState, recipeID string) bool {
	if recipeID == "" {
		return false
	}
	if player == nil || player.Tech == nil {
		return false
	}
	if CanBuildTech(player, model.TechUnlockRecipe, recipeID) {
		return true
	}
	for _, def := range model.AllTechDefinitions() {
		if def == nil {
			continue
		}
		for _, unlock := range def.Unlocks {
			if unlock.Type == model.TechUnlockRecipe && unlock.ID == recipeID {
				return false
			}
		}
	}
	return true
}

// TechCostForPlayer returns the cost breakdown for a tech based on player's current state
func TechCostForPlayer(player *model.PlayerState, techID string) (cost []model.ItemAmount, ok bool) {
	def, ok := model.TechDefinitionByID(techID)
	if !ok {
		return nil, false
	}

	if !player.Tech.HasPrerequisites(def) {
		return nil, false
	}

	// Return the cost items (matrix type items)
	return def.Cost, true
}
