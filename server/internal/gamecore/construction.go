package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
	"siliconworld/internal/terrain"
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

// maxVerticalStackHeight returns how many layers a player may stack for
// vertically stackable buildings: the ground layer plus one extra layer per
// completed vertical_construction tech level.
func maxVerticalStackHeight(player *model.PlayerState) int {
	height := 1
	if player != nil && player.Tech != nil {
		height += player.Tech.CompletedTechs["vertical_construction"]
	}
	return height
}

// isVerticallyStackable reports whether a building type supports DSP-style
// vertical stacking: research labs and production buildings stack above a
// ground building of the same type, sharing its footprint.
func isVerticallyStackable(btype model.BuildingType) bool {
	if btype == model.BuildingTypeLogisticsDistributor || btype == model.BuildingTypeFoundation {
		return false
	}
	profile := model.BuildingProfileFor(btype, 1)
	return profile.Runtime.Functions.Research != nil || profile.Runtime.Functions.Production != nil
}

// stackLayersAt returns the highest stack layer index (0-based Z) of the same
// building type at (x, y), or -1 when no such building exists. The ground
// building (Z=0) is layer 0.
func stackLayersAt(ws *model.WorldState, btype model.BuildingType, x, y int) int {
	top := -1
	if ws == nil {
		return top
	}
	for _, b := range ws.Buildings {
		if b == nil || b.Type != btype {
			continue
		}
		if b.Position.X == x && b.Position.Y == y && b.Position.Z > top {
			top = b.Position.Z
		}
	}
	return top
}

// stackedLayersAbove returns every building stacked strictly above the given
// one on the same surface tile (same X/Y, greater Z), ordered lowest layer
// first. Demolishing a lower layer cascades through these.
func stackedLayersAbove(ws *model.WorldState, building *model.Building) []*model.Building {
	if ws == nil || building == nil {
		return nil
	}
	var layers []*model.Building
	for _, b := range ws.Buildings {
		if b == nil || b.ID == building.ID {
			continue
		}
		if b.Position.X == building.Position.X && b.Position.Y == building.Position.Y && b.Position.Z > building.Position.Z {
			layers = append(layers, b)
		}
	}
	sort.Slice(layers, func(i, j int) bool { return layers[i].Position.Z < layers[j].Position.Z })
	return layers
}

// stackReservedLayers counts queued construction tasks that will add layers of
// the same building type at (x, y), so concurrent build commands cannot
// overshoot the stack limit.
func stackReservedLayers(ws *model.WorldState, btype model.BuildingType, x, y int) int {
	if ws == nil || ws.Construction == nil {
		return 0
	}
	count := 0
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.BuildingType != btype {
			continue
		}
		if task.State != model.ConstructionPending && task.State != model.ConstructionInProgress && task.State != model.ConstructionPaused {
			continue
		}
		if task.Position.X == x && task.Position.Y == y {
			count++
		}
	}
	return count
}

// resolveVerticalPlacement computes the stacked position (Z = next layer) for
// a build command whose target tile is already occupied. It fails when the
// building type cannot stack, when the occupying building is of a different
// type, or when the player's vertical_construction level does not allow
// another layer.
func resolveVerticalPlacement(ws *model.WorldState, player *model.PlayerState, btype model.BuildingType, pos model.Position) (model.Position, error) {
	if !isVerticallyStackable(btype) {
		return pos, fmt.Errorf("tile is already occupied by a building")
	}
	top := stackLayersAt(ws, btype, pos.X, pos.Y)
	if top < 0 {
		return pos, fmt.Errorf("tile is already occupied by a different building type")
	}
	next := top + 1 + stackReservedLayers(ws, btype, pos.X, pos.Y)
	limit := maxVerticalStackHeight(player)
	if next+1 > limit {
		return pos, fmt.Errorf("vertical stack layer %d exceeds unlocked height %d (research vertical_construction)", next+1, limit)
	}
	stacked := pos
	stacked.Z = next
	return stacked, nil
}

// validateStackCompletion re-checks a stacked construction task at completion
// time: the ground-layer base of the same type must still exist and the target
// layer must still be free.
func validateStackCompletion(ws *model.WorldState, task *model.ConstructionTask) error {
	baseID := ws.TileBuilding[model.TileKey(task.Position.X, task.Position.Y)]
	base := ws.Buildings[baseID]
	if base == nil || base.Type != task.BuildingType || base.Position.Z != 0 {
		return fmt.Errorf("stack base building missing at construction site")
	}
	if base.OwnerID != task.PlayerID {
		return fmt.Errorf("stack base building owned by another player")
	}
	for _, b := range ws.Buildings {
		if b == nil {
			continue
		}
		if b.Position.X == task.Position.X && b.Position.Y == task.Position.Y && b.Position.Z == task.Position.Z {
			return fmt.Errorf("stack layer already occupied")
		}
	}
	return nil
}

// constructionRegionLimitFor returns the per-region concurrent construction
// limit for a player: the configured base limit plus one extra concurrent task
// per completed mass_construction tech level.
func (gc *GameCore) constructionRegionLimitFor(ws *model.WorldState, playerID string) int {
	limit := gc.constructionRegionLimit()
	if ws == nil {
		return limit
	}
	if player := ws.Players[playerID]; player != nil {
		limit += int(model.TechEffectValue(player, "construction_region_limit"))
	}
	return limit
}

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
	if player == nil {
		return 1
	}
	exec := player.ExecutorForPlanet(ws.PlanetID)
	if exec == nil {
		return 1
	}
	if exec.ConcurrentTasks <= 0 {
		return 1
	}
	return exec.ConcurrentTasks
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
		// mass_construction tech levels raise the owner's region concurrent limit.
		regionLimit := gc.constructionRegionLimitFor(ws, task.PlayerID)
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

func rollbackConstructionDeduction(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil || !task.MaterialsDeducted {
		return
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return
	}
	player.Resources.Minerals += task.Cost.Minerals
	player.Resources.Energy += task.Cost.Energy
	player.AddItems(task.Cost.Items)
	task.MaterialsDeducted = false
}

func (gc *GameCore) completeConstructionTask(ws *model.WorldState, task *model.ConstructionTask) ([]*model.GameEvent, error) {
	if ws == nil || task == nil {
		return nil, fmt.Errorf("construction task missing")
	}

	pos := task.Position
	if !ws.InBounds(pos.X, pos.Y) {
		return nil, fmt.Errorf("construction position out of bounds")
	}
	tileKey := model.TileKey(pos.X, pos.Y)
	stacked := pos.Z > 0 && task.BuildingType != model.BuildingTypeLogisticsDistributor
	if stacked {
		// Stacked layers share the ground building's tile; re-validate the
		// stack instead of the empty-tile invariant.
		if err := validateStackCompletion(ws, task); err != nil {
			return nil, err
		}
	} else if _, occupied := ws.TileBuilding[tileKey]; occupied && task.BuildingType != model.BuildingTypeLogisticsDistributor {
		return nil, fmt.Errorf("construction tile already occupied")
	}
	def, ok := model.BuildingDefinitionByID(task.BuildingType)
	if !ok {
		return nil, fmt.Errorf("unknown building type: %s", task.BuildingType)
	}
	if def.RequiresResourceNode && ws.Grid[pos.Y][pos.X].ResourceNodeID == "" {
		return nil, fmt.Errorf("resource node missing at construction site")
	}

	tiles, err := ws.ConstructionTiles(task)
	if err != nil {
		return nil, err
	}
	for _, p := range tiles {
		if stacked {
			// Footprint tiles of a stacked layer are occupied by the base
			// building by definition; the stack was validated above.
			continue
		}
		if task.BuildingType != model.BuildingTypeLogisticsDistributor && (ws.TileBuilding[model.TileKey(p.X, p.Y)] != "" || (!ws.Grid[p.Y][p.X].Terrain.Buildable() && task.BuildingType != model.BuildingTypeFoundation)) {
			return nil, fmt.Errorf("construction footprint tile unavailable")
		}
		if task.BuildingType == model.BuildingTypeFoundation && ws.FoundationAt(p) != nil {
			return nil, fmt.Errorf("construction footprint already has a foundation")
		}
		if foundation := ws.FoundationAt(p); foundation != nil && foundation.Job != nil && foundation.Job.Type == model.BuildingJobDemolish {
			return nil, fmt.Errorf("construction footprint foundation is being demolished")
		}
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
	if task.BuildingType == model.BuildingTypeFoundation {
		b.FoundationTerrain = make([]string, len(tiles))
		for i, p := range tiles {
			b.FoundationTerrain[i] = string(ws.Grid[p.Y][p.X].Terrain)
		}
	}
	model.InitBuildingStorage(b)
	model.InitBuildingProduction(b)
	model.InitBuildingFractionation(b)
	model.InitBuildingSprayCoater(b)
	model.InitBuildingEnergyStorage(b)
	model.InitBuildingConveyor(b)
	model.InitBuildingTrafficMonitor(b)
	model.InitBuildingSorter(b)
	model.InitBuildingLogisticsStation(b)
	if task.BuildingType == model.BuildingTypeLogisticsDistributor {
		// A distributor is an attachment and must bind to the depot at the same
		// surface origin. The host is checked again at completion to avoid stale
		// construction reservations creating free-floating logistics devices.
		host, hostErr := model.DistributorPlacementHost(ws, task.PlayerID, model.Position{X: pos.X, Y: pos.Y, Z: 0}, "")
		if hostErr != nil {
			rollbackConstructionDeduction(ws, task)
			return nil, hostErr
		}
		b.Position.Z = 1
		b.Distributor = model.NewDistributorState(host.ID)
	}
	syncCollectorResourceKind(ws, b)
	if b.Production != nil {
		recipeID := task.RecipeID
		if recipeID == "" {
			if def, ok := model.BuildingDefinitionByID(task.BuildingType); ok {
				recipeID = def.DefaultRecipeID
			}
		}
		b.Production.RecipeID = recipeID
	}
	if b.Runtime.Functions.Production != nil || b.Runtime.Functions.Collect != nil {
		b.ProductionMonitor = model.NewProductionMonitorState()
	}

	// T078: Deduct locked materials at completion time (not at enqueue time).
	// After this point, any failure must fully roll back spent materials and staged world state.
	if err := deductLockedMaterials(ws, task); err != nil {
		return nil, fmt.Errorf("failed to deduct materials: %w", err)
	}
	if task.BuildingType == model.BuildingTypeFoundation {
		for _, p := range tiles {
			ws.Grid[p.Y][p.X].Terrain = terrain.TileBuildable
		}
	}
	if b.Conveyor != nil && b.Splitter == nil && task.ConveyorDirection.Valid() {
		b.Conveyor.Output = task.ConveyorDirection
		b.Conveyor.Input = task.ConveyorDirection.Opposite()
	}
	ws.Buildings[id] = b
	if err := ws.IndexBuilding(b); err != nil {
		delete(ws.Buildings, id)
		if task.BuildingType == model.BuildingTypeFoundation {
			for i, p := range tiles {
				ws.Grid[p.Y][p.X].Terrain = terrain.TileType(b.FoundationTerrain[i])
			}
		}
		rollbackConstructionDeduction(ws, task)
		return nil, err
	}

	if b.LogisticsStation != nil {
		model.RegisterLogisticsStation(ws, b)
	}
	model.RegisterPowerGridBuilding(ws, b)

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

// execSetRecipe handles the "set_recipe" command: switch a production building
// (or a research lab between research mode and matrix production mode) to a
// new recipe in place, without demolishing and rebuilding.
//
// DSP semantics applied on switch:
//   - production progress is reset (RemainingTicks/ProgressFraction/pending
//     outputs cleared);
//   - storage contents are kept;
//   - an empty recipe_id switches a research-capable building back to research
//     mode (or simply idles a pure production building).
//
// The switch is atomic: every validation runs before any state is mutated, so
// an illegal switch leaves the building untouched.
func (gc *GameCore) execSetRecipe(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID := cmd.Target.EntityID
	if buildingID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id (building) required"
		return res, nil
	}
	building, ok := ws.Buildings[buildingID]
	if !ok || building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot reconfigure building owned by another player"
		return res, nil
	}
	if building.Runtime.Functions.Production == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("building type %s does not support recipes", building.Type)
		return res, nil
	}

	recipeID := ""
	if recipeRaw, ok := cmd.Payload["recipe_id"]; ok && recipeRaw != nil {
		recipeID = fmt.Sprintf("%v", recipeRaw)
	}

	player := ws.Players[playerID]
	if recipeID != "" {
		recipe, ok := model.Recipe(recipeID)
		if !ok {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("unknown recipe: %s", recipeID)
			return res, nil
		}
		supportsRecipe := false
		for _, allowed := range recipe.BuildingTypes {
			if allowed == building.Type {
				supportsRecipe = true
				break
			}
		}
		if !supportsRecipe {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("recipe %s not supported by building type %s", recipeID, building.Type)
			return res, nil
		}
		if !CanUseRecipeTech(player, recipeID) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("recipe %s requires research to unlock", recipeID)
			return res, nil
		}
	}

	// All validation passed: apply the switch atomically.
	model.InitBuildingProduction(building)
	building.Production.RecipeID = recipeID
	building.Production.RemainingTicks = 0
	building.Production.ProgressFraction = 0
	building.Production.PendingOutputs = nil
	building.Production.PendingByproducts = nil

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	if recipeID == "" {
		if building.Runtime.Functions.Research != nil {
			res.Message = fmt.Sprintf("building %s switched to research mode", buildingID)
		} else {
			res.Message = fmt.Sprintf("building %s recipe cleared (idle)", buildingID)
		}
	} else {
		res.Message = fmt.Sprintf("building %s recipe set to %s", buildingID, recipeID)
	}
	return res, nil
}
