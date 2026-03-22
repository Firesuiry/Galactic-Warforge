package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// settleResearch processes research progress for all players
func settleResearch(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	for _, player := range ws.Players {
		if player == nil || !player.IsAlive {
			continue
		}

		// Initialize tech state if needed
		if player.Tech == nil {
			player.Tech = model.NewPlayerTechState(player.PlayerID)
		}

		// No active research, check queue
		if player.Tech.CurrentResearch == nil {
			if len(player.Tech.ResearchQueue) > 0 {
				// Start next research from queue
				player.Tech.CurrentResearch = player.Tech.ResearchQueue[0]
				player.Tech.ResearchQueue = player.Tech.ResearchQueue[1:]
				if player.Tech.CurrentResearch != nil {
					player.Tech.CurrentResearch.State = model.ResearchInProgress
					player.Tech.CurrentResearch.EnqueueTick = ws.Tick
				}
			}
			continue
		}

		research := player.Tech.CurrentResearch
		if research.State != model.ResearchInProgress {
			continue
		}

		// Get tech definition
		def, ok := model.TechDefinitionByID(research.TechID)
		if !ok {
			// Tech not found, cancel research
			research.State = model.ResearchCancelled
			player.Tech.CurrentResearch = nil
			continue
		}

		// Calculate research speed (base + lab throughput + executor boost).
		// Use a fixed-point approach with 1000-scale to preserve fractional progress.
		baseSpeed := int64(1000) // 1000 units = 1 progress point
		if labSpeed := playerResearchSpeed(ws, player.PlayerID); labSpeed > 0 {
			baseSpeed += int64(labSpeed) * 1000
		}
		if player.Executor != nil && player.Executor.ResearchBoost > 0 {
			// Apply boost: newSpeed = baseSpeed * (1 + boost)
			boostFactor := int64(1000 + player.Executor.ResearchBoost*1000)
			baseSpeed = baseSpeed * boostFactor / 1000
		}

		// Progress research
		research.Progress += baseSpeed

		// Check if research is complete
		if research.Progress >= research.TotalCost {
			completeResearch(player, research, def, ws.Tick, &events)
		}
	}

	return events
}

func playerResearchSpeed(ws *model.WorldState, playerID string) int {
	if ws == nil || playerID == "" {
		return 0
	}
	speed := 0
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != playerID {
			continue
		}
		if building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		if building.Runtime.Functions.Research == nil {
			continue
		}
		speed += building.Runtime.Functions.Research.ResearchPerTick
	}
	return speed
}

// completeResearch marks a research as completed and applies unlocks
func completeResearch(player *model.PlayerState, research *model.PlayerResearch, def *model.TechDefinition, tick int64, events *[]*model.GameEvent) {
	research.State = model.ResearchCompleted
	research.CompleteTick = tick

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
	if len(player.Tech.ResearchQueue) > 0 {
		player.Tech.CurrentResearch = player.Tech.ResearchQueue[0]
		player.Tech.ResearchQueue = player.Tech.ResearchQueue[1:]
		if player.Tech.CurrentResearch != nil {
			player.Tech.CurrentResearch.State = model.ResearchInProgress
			player.Tech.CurrentResearch.EnqueueTick = tick
		}
	}
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

	// Calculate total cost (for repeatable techs, could scale with level)
	// Scale by 1000 to match baseSpeed scale for fixed-point arithmetic
	totalCost := calculateTechCost(def) * 1000

	// Create research state
	research := &model.PlayerResearch{
		TechID:       techID,
		State:        model.ResearchPending,
		Progress:     0,
		TotalCost:    totalCost,
		CurrentLevel: player.Tech.CompletedTechs[techID],
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
		if len(player.Tech.ResearchQueue) > 0 {
			player.Tech.CurrentResearch = player.Tech.ResearchQueue[0]
			player.Tech.ResearchQueue = player.Tech.ResearchQueue[1:]
			if player.Tech.CurrentResearch != nil {
				player.Tech.CurrentResearch.State = model.ResearchInProgress
				player.Tech.CurrentResearch.EnqueueTick = ws.Tick
			}
		}

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
