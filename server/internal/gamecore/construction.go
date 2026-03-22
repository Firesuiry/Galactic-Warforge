package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

// MaterialSourcePriority defines the priority order for material sources.
// Lower number = higher priority.
const (
	MaterialPriorityLocal     = 0
	MaterialPriorityLogistics = 1
)

// reserveConstructionMaterials validates and locks materials for a construction task.
// It does NOT deduct materials - that happens at completion time via deductLockedMaterials.
// Returns the reservation tracking what was locked and from which source.
func reserveConstructionMaterials(ws *model.WorldState, task *model.ConstructionTask) (*model.MaterialReservation, error) {
	if ws == nil || task == nil {
		return nil, fmt.Errorf("world state or task is nil")
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return nil, fmt.Errorf("player %s not found", task.PlayerID)
	}

	// Validate availability (check but don't deduct)
	if player.Resources.Minerals < task.Cost.Minerals {
		return nil, fmt.Errorf("insufficient minerals: need %d, have %d", task.Cost.Minerals, player.Resources.Minerals)
	}
	if player.Resources.Energy < task.Cost.Energy {
		return nil, fmt.Errorf("insufficient energy: need %d, have %d", task.Cost.Energy, player.Resources.Energy)
	}
	if missing, ok := missingItem(player.Inventory, task.Cost.Items); ok {
		return nil, fmt.Errorf("insufficient items: need %d %s", missing.Quantity, missing.ItemID)
	}

	// Create reservation record (locking without deduction)
	reservation := &model.MaterialReservation{
		TaskID:   task.ID,
		PlayerID: task.PlayerID,
		Minerals: task.Cost.Minerals,
		Energy:   task.Cost.Energy,
		Items:    task.Cost.Items,
		Source: model.MaterialSource{
			Type:       model.MaterialSourceLocal,
			BuildingID: "",
			Priority:   MaterialPriorityLocal,
		},
	}

	// Add reservation to queue's material reservation tracker
	if ws.Construction == nil || ws.Construction.MaterialRes == nil {
		return reservation, nil
	}
	if err := ws.Construction.MaterialRes.AddReservation(reservation); err != nil {
		return nil, fmt.Errorf("failed to add material reservation: %w", err)
	}

	return reservation, nil
}

// deductLockedMaterials deducts the locked materials for a construction task.
// This is called when construction completes successfully.
// Returns error if deduction fails (which should cause task completion to fail).
func deductLockedMaterials(ws *model.WorldState, task *model.ConstructionTask) error {
	if ws == nil || task == nil {
		return fmt.Errorf("world state or task is nil")
	}
	if task.MaterialsDeducted {
		// Already deducted, nothing to do
		return nil
	}

	player := ws.Players[task.PlayerID]
	if player == nil {
		return fmt.Errorf("player %s not found", task.PlayerID)
	}

	// Deduct minerals
	player.Resources.Minerals -= task.Cost.Minerals
	if player.Resources.Minerals < 0 {
		// This shouldn't happen if reservation was correct, but handle it
		player.Resources.Minerals = 0
	}

	// Deduct energy
	player.Resources.Energy -= task.Cost.Energy
	if player.Resources.Energy < 0 {
		player.Resources.Energy = 0
	}

	// Deduct items
	if !player.DeductItems(task.Cost.Items) {
		// This shouldn't happen if reservation was correct, but handle it
		// Rollback mineral and energy deduction
		player.Resources.Minerals += task.Cost.Minerals
		player.Resources.Energy += task.Cost.Energy
		return fmt.Errorf("failed to deduct items for task %s", task.ID)
	}

	// Mark as deducted
	task.MaterialsDeducted = true

	// Remove the reservation (materials are now spent)
	if ws.Construction != nil && ws.Construction.MaterialRes != nil {
		ws.Construction.MaterialRes.RemoveReservation(task.ID)
	}

	return nil
}

// releaseConstructionReservation releases reserved materials back to the player.
// This is called when a construction task is cancelled.
// With T078 deduction-at-completion timing:
// - If materials not yet deducted (MaterialsDeducted=false), just release the lock (no refund needed)
// - If materials already deducted (MaterialsDeducted=true), refund based on remaining progress
func releaseConstructionReservation(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil {
		return
	}

	// Remove the reservation from tracking
	if ws.Construction != nil && ws.Construction.MaterialRes != nil {
		ws.Construction.MaterialRes.RemoveReservation(task.ID)
	}

	// With T078 deduction-at-completion timing:
	// - If MaterialsDeducted is false, we never deducted anything, so no refund needed
	// - If MaterialsDeducted is true, we deducted at completion, so refund based on remaining progress
	if !task.MaterialsDeducted {
		// Materials were never deducted, nothing to refund
		return
	}

	// Materials were deducted at completion, so refund based on remaining progress
	refundConstructionRefund(ws, task)
}

// getAvailableConstructionMaterials returns available materials from all sources.
// Currently only returns local player inventory; logistics integration is for future.
func getAvailableConstructionMaterials(ws *model.WorldState, playerID string) (minerals, energy int, items model.ItemInventory) {
	if ws == nil || playerID == "" {
		return 0, 0, nil
	}
	player := ws.Players[playerID]
	if player == nil {
		return 0, 0, nil
	}
	return player.Resources.Minerals, player.Resources.Energy, player.Inventory
}

const (
	constructionRegionSize          = 8
	defaultConstructionDurationTick = 1
)

// calculateConstructionSpeedBonus calculates the construction speed multiplier for a player.
// This combines bonuses from buildings, tech, and environment.
// Returns 1.0 if no bonuses apply (minimum speed).
func calculateConstructionSpeedBonus(ws *model.WorldState, playerID string, buildingType model.BuildingType) float64 {
	if ws == nil || playerID == "" {
		return 1.0
	}

	bonus := 1.0

	// Construction speed bonuses will be added here as they are implemented:
	// - Tech bonuses from research tree (T008)
	// - Building bonuses (e.g., Vertical Assembly building)
	// - Environment/planet type bonuses
	// For now, return base bonus of 1.0

	return bonus
}

func constructionRegionKey(ws *model.WorldState, pos model.Position) string {
	if ws == nil {
		return ""
	}
	size := constructionRegionSize
	if size <= 0 {
		size = 1
	}
	rx := pos.X / size
	ry := pos.Y / size
	return fmt.Sprintf("%s:%d:%d", ws.PlanetID, rx, ry)
}

func (gc *GameCore) constructionRegionLimit() int {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	limit := gc.cfg.Battlefield.ConstructionRegionConcurrentLimit
	if limit <= 0 {
		return 1
	}
	return limit
}

func executorConcurrentLimit(ws *model.WorldState, playerID string) int {
	if ws == nil {
		return 1
	}
	player := ws.Players[playerID]
	if player == nil || player.Executor == nil {
		return 1
	}
	if player.Executor.ConcurrentTasks <= 0 {
		return 1
	}
	return player.Executor.ConcurrentTasks
}

// checkMaterialsAvailable checks if a player has enough materials for a construction task.
// T079: This is used to determine if construction should pause (insufficient materials)
// or resume (materials now available).
func checkMaterialsAvailable(ws *model.WorldState, task *model.ConstructionTask) bool {
	if ws == nil || task == nil {
		return false
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return false
	}

	// Check minerals
	if player.Resources.Minerals < task.Cost.Minerals {
		return false
	}
	// Check energy
	if player.Resources.Energy < task.Cost.Energy {
		return false
	}
	// Check items
	if _, ok := missingItem(player.Inventory, task.Cost.Items); ok {
		return false
	}
	return true
}

// createConstructionPauseEvent creates a pause event for a construction task.
// T079: Emitted when construction pauses due to insufficient materials.
func createConstructionPauseEvent(task *model.ConstructionTask) *model.GameEvent {
	if task == nil {
		return nil
	}
	return &model.GameEvent{
		EventType:       model.EvtConstructionPaused,
		VisibilityScope: task.PlayerID,
		Payload: map[string]any{
			"task_id":   task.ID,
			"reason":    "insufficient_materials",
			"building":  task.BuildingType,
			"position":  task.Position,
			"remaining": task.RemainingTicks,
			"total":     task.TotalTicks,
		},
	}
}

// createConstructionResumeEvent creates a resume event for a construction task.
// T079: Emitted when construction resumes after materials become available.
func createConstructionResumeEvent(task *model.ConstructionTask) *model.GameEvent {
	if task == nil {
		return nil
	}
	return &model.GameEvent{
		EventType:       model.EvtConstructionResumed,
		VisibilityScope: task.PlayerID,
		Payload: map[string]any{
			"task_id":   task.ID,
			"reason":    "materials_available",
			"building":  task.BuildingType,
			"position":  task.Position,
			"remaining": task.RemainingTicks,
			"total":     task.TotalTicks,
		},
	}
}

func countActiveConstructionByRegion(ws *model.WorldState) map[string]int {
	counts := make(map[string]int)
	if ws == nil || ws.Construction == nil {
		return counts
	}
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.State != model.ConstructionInProgress {
			continue
		}
		counts[task.RegionID]++
	}
	return counts
}

func (gc *GameCore) settleConstructionQueue(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
	}

	currentTick := ws.Tick
	events := make([]*model.GameEvent, 0)

	activeByPlayer := countActiveExecutorUsage(ws)
	activeByRegion := countActiveConstructionByRegion(ws)
	regionLimit := gc.constructionRegionLimit()

	// T079: First pass - pause in-progress tasks that no longer have materials available
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.State != model.ConstructionInProgress {
			continue
		}
		if !checkMaterialsAvailable(ws, task) {
			// Materials no longer available - pause the task
			if err := ws.Construction.Transition(task.ID, model.ConstructionPaused); err == nil {
				task.UpdateTick = currentTick
				events = append(events, createConstructionPauseEvent(task))
			}
		}
	}

	// T079: Second pass - try to resume paused tasks if materials are now available
	// and start new pending tasks
	for _, id := range ws.Construction.Order {
		task := ws.Construction.Tasks[id]
		if task == nil {
			continue
		}

		if task.State == model.ConstructionPaused {
			// T079: Check if materials are now available to resume
			if checkMaterialsAvailable(ws, task) {
				if err := ws.Construction.Transition(task.ID, model.ConstructionInProgress); err == nil {
					task.UpdateTick = currentTick
					events = append(events, createConstructionResumeEvent(task))
					// Don't count towards active limits - it was already counted when it was first started
					continue
				}
			}
			// Still no materials, skip this paused task
			continue
		}

		if task.State != model.ConstructionPending {
			continue
		}

		// T079: Before starting a pending task, verify materials are available
		if !checkMaterialsAvailable(ws, task) {
			// Materials not available, skip starting this task
			continue
		}

		playerLimit := executorConcurrentLimit(ws, task.PlayerID)
		if activeByPlayer[task.PlayerID] >= playerLimit {
			continue
		}
		if regionLimit > 0 && activeByRegion[task.RegionID] >= regionLimit {
			continue
		}
		if err := ws.Construction.Transition(task.ID, model.ConstructionInProgress); err != nil {
			continue
		}
		task.StartTick = currentTick
		task.UpdateTick = currentTick
		if task.TotalTicks <= 0 {
			task.TotalTicks = defaultConstructionDurationTick
		}
		if task.RemainingTicks <= 0 {
			task.RemainingTicks = task.TotalTicks
		}
		// Calculate speed bonus only if not already set (preserves bonus on pause/resume)
		if task.SpeedBonus == 0 {
			task.SpeedBonus = calculateConstructionSpeedBonus(ws, task.PlayerID, task.BuildingType)
		}
		activeByPlayer[task.PlayerID]++
		activeByRegion[task.RegionID]++
	}

	var completed []string
	for id, task := range ws.Construction.Tasks {
		if task == nil || task.State != model.ConstructionInProgress {
			continue
		}
		if task.StartTick >= currentTick {
			continue
		}
		// T079: Check materials before processing tick - if insufficient, skip deduction
		if !checkMaterialsAvailable(ws, task) {
			// This shouldn't happen since we pause in the first pass, but handle it
			if err := ws.Construction.Transition(task.ID, model.ConstructionPaused); err == nil {
				task.UpdateTick = currentTick
				events = append(events, createConstructionPauseEvent(task))
			}
			continue
		}
		if task.RemainingTicks > 0 {
			ticksToDeduct := 1
			if task.SpeedBonus > 1.0 {
				ticksToDeduct = int(task.SpeedBonus)
				if ticksToDeduct < 1 {
					ticksToDeduct = 1
				}
			}
			if ticksToDeduct > task.RemainingTicks {
				ticksToDeduct = task.RemainingTicks
			}
			task.RemainingTicks -= ticksToDeduct
		}
		task.UpdateTick = currentTick
		if task.RemainingTicks > 0 {
			continue
		}
		evts, err := gc.completeConstructionTask(ws, task)
		if err != nil {
			task.Error = err.Error()
			_ = ws.Construction.Transition(task.ID, model.ConstructionCancelled)
			// T078: Only refund if materials were deducted. If MaterialsDeducted is true,
			// it means deduction succeeded before the failure, so we refund based on remaining progress.
			// If MaterialsDeducted is false, deduction never happened, so no refund.
			if task.MaterialsDeducted {
				refundConstructionRefund(ws, task)
			}
			completed = append(completed, id)
			continue
		}
		_ = ws.Construction.Transition(task.ID, model.ConstructionCompleted)
		events = append(events, evts...)
		completed = append(completed, id)
	}

	for _, id := range completed {
		ws.Construction.Remove(id)
	}

	return events
}

func refundConstructionCost(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil {
		return
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return
	}
	player.Resources.Minerals += task.Cost.Minerals
	player.Resources.Energy += task.Cost.Energy
	player.AddItems(task.Cost.Items)
}

// refundConstructionRefund refunds a portion of the construction cost based on remaining progress.
// For pending tasks (not yet started): full refund.
// For in_progress tasks: refund proportional to remaining ticks / total ticks.
func refundConstructionRefund(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil {
		return
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return
	}
	// Full refund for pending tasks
	if task.State == model.ConstructionPending {
		player.Resources.Minerals += task.Cost.Minerals
		player.Resources.Energy += task.Cost.Energy
		player.AddItems(task.Cost.Items)
		return
	}
	// Partial refund for in_progress tasks: remaining / total
	if task.TotalTicks <= 0 {
		player.Resources.Minerals += task.Cost.Minerals
		player.Resources.Energy += task.Cost.Energy
		player.AddItems(task.Cost.Items)
		return
	}
	ratio := float64(task.RemainingTicks) / float64(task.TotalTicks)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	player.Resources.Minerals += int(float64(task.Cost.Minerals) * ratio)
	player.Resources.Energy += int(float64(task.Cost.Energy) * ratio)
	// Items: refund proportionally (round up to avoid losing items on small remainders)
	refundItems := make([]model.ItemAmount, 0, len(task.Cost.Items))
	for _, item := range task.Cost.Items {
		refundQty := int(float64(item.Quantity) * ratio)
		if refundQty > item.Quantity {
			refundQty = item.Quantity
		}
		if refundQty > 0 {
			refundItems = append(refundItems, model.ItemAmount{ItemID: item.ItemID, Quantity: refundQty})
		}
	}
	player.AddItems(refundItems)
}

func (gc *GameCore) completeConstructionTask(ws *model.WorldState, task *model.ConstructionTask) ([]*model.GameEvent, error) {
	if ws == nil || task == nil {
		return nil, fmt.Errorf("construction task missing")
	}

	// T078: Deduct locked materials at completion time (not at enqueue time)
	if err := deductLockedMaterials(ws, task); err != nil {
		return nil, fmt.Errorf("failed to deduct materials: %w", err)
	}

	pos := task.Position
	if !ws.InBounds(pos.X, pos.Y) {
		return nil, fmt.Errorf("construction position out of bounds")
	}
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		return nil, fmt.Errorf("construction tile already occupied")
	}
	def, ok := model.BuildingDefinitionByID(task.BuildingType)
	if !ok {
		return nil, fmt.Errorf("unknown building type: %s", task.BuildingType)
	}
	if def.RequiresResourceNode && ws.Grid[pos.Y][pos.X].ResourceNodeID == "" {
		return nil, fmt.Errorf("resource node missing at construction site")
	}

	profile := model.BuildingProfileFor(task.BuildingType, 1)
	id := ws.NextEntityID("b")
	b := &model.Building{
		ID:          id,
		Type:        task.BuildingType,
		OwnerID:     task.PlayerID,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingStorage(b)
	model.InitBuildingProduction(b)
	model.InitBuildingEnergyStorage(b)
	model.InitBuildingConveyor(b)
	model.InitBuildingSorter(b)
	model.InitBuildingLogisticsStation(b)
	syncCollectorResourceKind(ws, b)
	if b.Production != nil {
		b.Production.RecipeID = task.RecipeID
	}
	if b.Runtime.Functions.Production != nil {
		b.ProductionMonitor = model.NewProductionMonitorState()
	}
	model.RegisterLogisticsStation(ws, b)
	model.RegisterPowerGridBuilding(ws, b)
	if b.Conveyor != nil && task.ConveyorDirection.Valid() {
		b.Conveyor.Output = task.ConveyorDirection
		b.Conveyor.Input = task.ConveyorDirection.Opposite()
	}
	ws.Buildings[id] = b
	ws.TileBuilding[tileKey] = id
	ws.Grid[pos.Y][pos.X].BuildingID = id

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: task.PlayerID,
			Payload: map[string]any{
				"entity_type": "building",
				"entity_id":   id,
				"building":    b,
			},
		},
	}
	return events, nil
}
