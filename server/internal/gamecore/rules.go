package gamecore

import (
	"fmt"
	"math/rand"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
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

// execBuild handles the "build" command
func (gc *GameCore) execBuild(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	pos := cmd.Target.Position
	if pos == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "position required for build command"
		return res, nil
	}

	if !ws.InBounds(pos.X, pos.Y) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("position (%d,%d) out of map bounds", pos.X, pos.Y)
		return res, nil
	}

	if !ws.Grid[pos.Y][pos.X].Terrain.Buildable() {
		res.Code = model.CodeInvalidTarget
		res.Message = "target tile is not buildable"
		return res, nil
	}

	// Check tile is unoccupied
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "tile is already occupied by a building"
		return res, nil
	}
	if ws.Construction != nil && ws.Construction.IsTileReserved(tileKey) {
		res.Code = model.CodePositionOccupied
		res.Message = "tile is reserved for construction"
		return res, nil
	}

	// Get building type from payload
	btypeRaw, ok := cmd.Payload["building_type"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.building_type required"
		return res, nil
	}
	btype := model.BuildingType(fmt.Sprintf("%v", btypeRaw))

	// Validate building type
	def, ok := model.BuildingDefinitionByID(btype)
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown building type: %s", btype)
		return res, nil
	}
	if !def.Buildable {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building type not buildable: %s", btype)
		return res, nil
	}
	if def.RequiresResourceNode && ws.Grid[pos.Y][pos.X].ResourceNodeID == "" {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("%s must be built on a resource node", btype)
		return res, nil
	}
	if btype == model.BuildingTypeOrbitalCollector {
		planet, ok := gc.maps.Planet(ws.PlanetID)
		if !ok || planet == nil || planet.Kind != mapmodel.PlanetKindGasGiant {
			res.Code = model.CodeInvalidTarget
			res.Message = "orbital collector must be built on a gas giant"
			return res, nil
		}
	}

	var conveyorDir model.ConveyorDirection
	if model.IsConveyorBuilding(btype) {
		conveyorDir = model.ConveyorEast
		if dirRaw, ok := cmd.Payload["direction"]; ok {
			dir := model.ConveyorDirection(fmt.Sprintf("%v", dirRaw))
			if !dir.Valid() {
				res.Code = model.CodeValidationFailed
				res.Message = fmt.Sprintf("invalid conveyor direction: %v", dirRaw)
				return res, nil
			}
			conveyorDir = dir
		}
	}

	// Check resource cost (availability validation)
	mCost, eCost := def.BuildCost.Minerals, def.BuildCost.Energy
	player := ws.Players[playerID]
	if player.Resources.Minerals < mCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d minerals, have %d", mCost, player.Resources.Minerals)
		return res, nil
	}
	if player.Resources.Energy < eCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d energy, have %d", eCost, player.Resources.Energy)
		return res, nil
	}
	if missing, ok := missingItem(player.Inventory, def.BuildCost.Items); ok {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s for build", missing.Quantity, missing.ItemID)
		return res, nil
	}

	_, _, execRes := gc.requireExecutor(ws, playerID, *pos)
	if execRes != nil {
		return *execRes, nil
	}

	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
	}

	taskID := ws.NextEntityID("c")
	task := &model.ConstructionTask{
		ID:                taskID,
		PlayerID:          playerID,
		RegionID:          constructionRegionKey(ws, *pos),
		BuildingType:      btype,
		Position:          *pos,
		ConveyorDirection: conveyorDir,
		Cost:              def.BuildCost,
		State:             model.ConstructionPending,
		EnqueueTick:       ws.Tick,
	}
	if err := ws.Construction.Enqueue(task); err != nil {
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

	task.TotalTicks = max(1, defaultConstructionDurationTick)
	task.RemainingTicks = task.TotalTicks

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("construction task %s queued at (%d,%d)", taskID, pos.X, pos.Y)
	return res, nil
}

// execCancelConstruction handles the "cancel_construction" command
func (gc *GameCore) execCancelConstruction(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	taskIDRaw, ok := cmd.Payload["task_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.task_id required"
		return res, nil
	}
	taskID := fmt.Sprintf("%v", taskIDRaw)

	if ws.Construction == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "construction queue not found"
		return res, nil
	}
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("construction task %s not found", taskID)
		return res, nil
	}
	if task.PlayerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot cancel construction task owned by another player"
		return res, nil
	}
	if task.State != model.ConstructionPending && task.State != model.ConstructionInProgress {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("construction task cannot be cancelled in state %s", task.State)
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
	res.Message = fmt.Sprintf("construction task %s cancelled", taskID)
	return res, nil
}

// execRestoreConstruction handles the "restore_construction" command
func (gc *GameCore) execRestoreConstruction(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	taskIDRaw, ok := cmd.Payload["task_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.task_id required"
		return res, nil
	}
	taskID := fmt.Sprintf("%v", taskIDRaw)

	if ws.Construction == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = "construction queue not found"
		return res, nil
	}
	task := ws.Construction.Tasks[taskID]
	if task == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("construction task %s not found", taskID)
		return res, nil
	}
	if task.PlayerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot restore construction task owned by another player"
		return res, nil
	}
	if task.State != model.ConstructionCancelled && task.State != model.ConstructionPaused {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("construction task cannot be restored in state %s", task.State)
		return res, nil
	}

	// Check tile is still available for restore
	tileKey := model.TileKey(task.Position.X, task.Position.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "construction tile is now occupied by another building"
		return res, nil
	}
	if ws.Construction.IsTileReserved(tileKey) && ws.Construction.ReservedTiles[tileKey] != taskID {
		res.Code = model.CodePositionOccupied
		res.Message = "construction tile is reserved by another construction task"
		return res, nil
	}

	// For cancelled tasks, re-reserve materials (they were refunded on cancel)
	// For paused tasks, materials remain reserved (handled by pause logic in T079)
	if task.State == model.ConstructionCancelled {
		if _, err := reserveConstructionMaterials(ws, task); err != nil {
			res.Code = model.CodeInsufficientResource
			res.Message = "insufficient resources to restore construction: " + err.Error()
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
	ws.Construction.ReservedTiles[tileKey] = taskID

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
	res.Message = fmt.Sprintf("construction task %s restored to pending", taskID)
	return res, nil
}

// execMove handles the "move" command for a unit
func (gc *GameCore) execMove(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	entityID := cmd.Target.EntityID
	if entityID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id required for move command"
		return res, nil
	}

	unit, ok := ws.Units[entityID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("unit %s not found", entityID)
		return res, nil
	}

	if unit.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot move unit owned by another player"
		return res, nil
	}

	pos := cmd.Target.Position
	if pos == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target.position required for move command"
		return res, nil
	}

	if !ws.InBounds(pos.X, pos.Y) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("position (%d,%d) out of map bounds", pos.X, pos.Y)
		return res, nil
	}

	dist := model.ManhattanDist(unit.Position, *pos)
	if dist > unit.MoveRange {
		res.Code = model.CodeOutOfRange
		res.Message = fmt.Sprintf("move distance %d exceeds unit move range %d", dist, unit.MoveRange)
		return res, nil
	}

	// Check destination not occupied by another building
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "destination tile is occupied by a building"
		return res, nil
	}

	// Remove unit from old tile
	oldKey := model.TileKey(unit.Position.X, unit.Position.Y)
	removeUnitFromTile(ws, oldKey, entityID)

	// Move unit
	oldPos := unit.Position
	unit.Position = *pos

	// Add unit to new tile
	ws.TileUnits[tileKey] = append(ws.TileUnits[tileKey], entityID)

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityMoved,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_id": entityID,
				"from":      oldPos,
				"to":        unit.Position,
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("unit %s moved to (%d,%d)", entityID, pos.X, pos.Y)
	return res, events
}

// execAttack handles the "attack" command
func (gc *GameCore) execAttack(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	attackerID := cmd.Target.EntityID
	if attackerID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id (attacker) required"
		return res, nil
	}

	// Resolve attacker (unit)
	attacker, ok := ws.Units[attackerID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("attacker unit %s not found", attackerID)
		return res, nil
	}
	if attacker.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot order attack with unit owned by another player"
		return res, nil
	}

	// Get target entity ID from payload
	targetIDRaw, ok := cmd.Payload["target_entity_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.target_entity_id required"
		return res, nil
	}
	targetID := fmt.Sprintf("%v", targetIDRaw)

	// Resolve target HP and position (unit or building)
	var targetPos model.Position
	var targetOwner string
	var events []*model.GameEvent

	if targetUnit, ok := ws.Units[targetID]; ok {
		if targetUnit.OwnerID == playerID {
			res.Code = model.CodeInvalidTarget
			res.Message = "cannot attack own unit"
			return res, nil
		}
		targetPos = targetUnit.Position
		targetOwner = targetUnit.OwnerID
		if sameTeam(ws, playerID, targetOwner) {
			res.Code = model.CodeInvalidTarget
			res.Message = "cannot attack allied unit"
			return res, nil
		}

		dist := model.ManhattanDist(attacker.Position, targetPos)
		if dist > attacker.AttackRange {
			res.Code = model.CodeOutOfRange
			res.Message = fmt.Sprintf("target distance %d exceeds attack range %d", dist, attacker.AttackRange)
			return res, nil
		}

		damage := max(1, attacker.Attack-targetUnit.Defense)
		targetUnit.HP -= damage

		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"attacker_id": attackerID,
				"target_id":   targetID,
				"damage":      damage,
				"target_hp":   targetUnit.HP,
			},
		})
		// Broadcast damage to target owner as well
		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: targetOwner,
			Payload: map[string]any{
				"attacker_id": attackerID,
				"target_id":   targetID,
				"damage":      damage,
				"target_hp":   targetUnit.HP,
			},
		})

		if targetUnit.HP <= 0 {
			delete(ws.Units, targetID)
			tileKey := model.TileKey(targetUnit.Position.X, targetUnit.Position.Y)
			removeUnitFromTile(ws, tileKey, targetID)
			destroyEvt := &model.GameEvent{
				EventType:       model.EvtEntityDestroyed,
				VisibilityScope: "all",
				Payload: map[string]any{
					"entity_id":   targetID,
					"entity_type": "unit",
					"owner_id":    targetOwner,
				},
			}
			events = append(events, destroyEvt)
		}

	} else if targetBuilding, ok := ws.Buildings[targetID]; ok {
		if targetBuilding.OwnerID == playerID {
			res.Code = model.CodeInvalidTarget
			res.Message = "cannot attack own building"
			return res, nil
		}
		targetPos = targetBuilding.Position
		targetOwner = targetBuilding.OwnerID
		if sameTeam(ws, playerID, targetOwner) {
			res.Code = model.CodeInvalidTarget
			res.Message = "cannot attack allied building"
			return res, nil
		}

		dist := model.ManhattanDist(attacker.Position, targetPos)
		if dist > attacker.AttackRange {
			res.Code = model.CodeOutOfRange
			res.Message = fmt.Sprintf("target distance %d exceeds attack range %d", dist, attacker.AttackRange)
			return res, nil
		}

		damage := max(1, attacker.Attack-2) // buildings have inherent defense
		targetBuilding.HP -= damage

		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"attacker_id": attackerID,
				"target_id":   targetID,
				"damage":      damage,
				"target_hp":   targetBuilding.HP,
			},
		})
		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: targetOwner,
			Payload: map[string]any{
				"attacker_id": attackerID,
				"target_id":   targetID,
				"damage":      damage,
				"target_hp":   targetBuilding.HP,
			},
		})

		if targetBuilding.HP <= 0 {
			delete(ws.Buildings, targetID)
			tileKey := model.TileKey(targetBuilding.Position.X, targetBuilding.Position.Y)
			delete(ws.TileBuilding, tileKey)
			ws.Grid[targetBuilding.Position.Y][targetBuilding.Position.X].BuildingID = ""
			events = append(events, &model.GameEvent{
				EventType:       model.EvtEntityDestroyed,
				VisibilityScope: "all",
				Payload: map[string]any{
					"entity_id":   targetID,
					"entity_type": "building",
					"owner_id":    targetOwner,
				},
			})
		}
	} else {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("target entity %s not found", targetID)
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("unit %s attacked %s", attackerID, targetID)
	return res, events
}

// execProduce handles the "produce" command to create units at a production building
func (gc *GameCore) execProduce(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	producerID := cmd.Target.EntityID
	if producerID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id (production building) required"
		return res, nil
	}

	building, ok := ws.Buildings[producerID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", producerID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	def, ok := model.BuildingDefinitionByID(building.Type)
	if !ok || !def.CanProduceUnits {
		res.Code = model.CodeInvalidTarget
		res.Message = "can only produce units at a production building"
		return res, nil
	}

	utypeRaw, ok := cmd.Payload["unit_type"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.unit_type required"
		return res, nil
	}
	utype := model.UnitType(fmt.Sprintf("%v", utypeRaw))

	switch utype {
	case model.UnitTypeWorker, model.UnitTypeSoldier:
	default:
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown unit type: %s", utype)
		return res, nil
	}

	// Check cost
	mCost, eCost := model.UnitCost(utype)
	player := ws.Players[playerID]
	if player.Resources.Minerals < mCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d minerals, have %d", mCost, player.Resources.Minerals)
		return res, nil
	}
	if player.Resources.Energy < eCost {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d energy, have %d", eCost, player.Resources.Energy)
		return res, nil
	}

	execState, _, execRes := gc.requireExecutor(ws, playerID, building.Position)
	if execRes != nil {
		return *execRes, nil
	}
	if !gc.reserveExecutorSlot(playerID, execState.ConcurrentTasks) {
		res.Code = model.CodeExecutorBusy
		res.Message = "executor is busy"
		return res, nil
	}

	// Find a free adjacent tile near production building
	spawnPos := findAdjacentFree(ws, building.Position)
	if spawnPos == nil {
		res.Code = model.CodePositionOccupied
		res.Message = "no free tile adjacent to production building"
		return res, nil
	}

	player.Resources.Minerals -= mCost
	player.Resources.Energy -= eCost

	stats := model.UnitStats(utype)
	id := ws.NextEntityID("u")
	u := &model.Unit{
		ID:          id,
		Type:        utype,
		OwnerID:     playerID,
		Position:    *spawnPos,
		HP:          stats.HP,
		MaxHP:       stats.MaxHP,
		Attack:      stats.Attack,
		Defense:     stats.Defense,
		AttackRange: stats.AttackRange,
		MoveRange:   stats.MoveRange,
		VisionRange: stats.VisionRange,
	}
	ws.Units[id] = u
	tileKey := model.TileKey(spawnPos.X, spawnPos.Y)
	ws.TileUnits[tileKey] = append(ws.TileUnits[tileKey], id)

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "unit",
				"entity_id":   id,
				"unit":        u,
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("unit %s produced at (%d,%d)", id, spawnPos.X, spawnPos.Y)
	return res, events
}

// execUpgrade handles upgrading a building
func (gc *GameCore) execUpgrade(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	var events []*model.GameEvent

	entityID := cmd.Target.EntityID
	if entityID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id required"
		return res, nil
	}

	building, ok := ws.Buildings[entityID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", entityID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot upgrade building owned by another player"
		return res, nil
	}
	if building.Job != nil {
		res.Code = model.CodeDuplicate
		res.Message = "building already has a job"
		return res, nil
	}

	rule := model.BuildingUpgradeRuleFor(building.Type)
	if !rule.Allow {
		res.Code = model.CodeInvalidTarget
		res.Message = "building upgrade not allowed"
		return res, nil
	}
	if building.Level >= rule.MaxLevel {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("building already at max level %d", rule.MaxLevel)
		return res, nil
	}
	if rule.RequireIdle && building.Runtime.State != model.BuildingWorkIdle {
		res.Code = model.CodeInvalidTarget
		res.Message = "building must be idle to upgrade"
		return res, nil
	}

	cost := model.BuildingUpgradeCost(building.Type, building.Level)
	upgradeCostM := cost.Minerals
	upgradeCostE := cost.Energy

	player := ws.Players[playerID]
	if player.Resources.Minerals < upgradeCostM {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d minerals for upgrade", upgradeCostM)
		return res, nil
	}
	if player.Resources.Energy < upgradeCostE {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d energy for upgrade", upgradeCostE)
		return res, nil
	}
	if missing, ok := missingItem(player.Inventory, cost.Items); ok {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s for upgrade", missing.Quantity, missing.ItemID)
		return res, nil
	}

	execState, _, execRes := gc.requireExecutor(ws, playerID, building.Position)
	if execRes != nil {
		return *execRes, nil
	}
	if !gc.reserveExecutorSlot(playerID, execState.ConcurrentTasks) {
		res.Code = model.CodeExecutorBusy
		res.Message = "executor is busy"
		return res, nil
	}

	player.Resources.Minerals -= upgradeCostM
	player.Resources.Energy -= upgradeCostE
	if !player.DeductItems(cost.Items) {
		player.Resources.Minerals += upgradeCostM
		player.Resources.Energy += upgradeCostE
		res.Code = model.CodeInsufficientResource
		res.Message = "insufficient items for upgrade"
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
		res.Message = fmt.Sprintf("building %s upgrade started (level %d -> %d, %d ticks)", entityID, building.Level, nextLevel, rule.DurationTicks)
		return res, events
	}

	applyUpgrade(building, nextLevel, building.Runtime.State)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("building %s upgraded to level %d", entityID, building.Level)
	return res, events
}

// execDemolish handles demolishing a building
func (gc *GameCore) execDemolish(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	var events []*model.GameEvent

	entityID := cmd.Target.EntityID
	if entityID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id required"
		return res, nil
	}

	building, ok := ws.Buildings[entityID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", entityID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot demolish building owned by another player"
		return res, nil
	}
	if building.Type == model.BuildingTypeBattlefieldAnalysisBase {
		res.Code = model.CodeInvalidTarget
		res.Message = "cannot demolish your own base"
		return res, nil
	}
	if building.Job != nil {
		res.Code = model.CodeDuplicate
		res.Message = "building already has a job"
		return res, nil
	}
	rule := model.BuildingDemolishRuleFor(building.Type)
	if !rule.Allow {
		res.Code = model.CodeInvalidTarget
		res.Message = "building demolish not allowed"
		return res, nil
	}
	if rule.RequireIdle && building.Runtime.State != model.BuildingWorkIdle {
		res.Code = model.CodeInvalidTarget
		res.Message = "building must be idle to demolish"
		return res, nil
	}

	execState, _, execRes := gc.requireExecutor(ws, playerID, building.Position)
	if execRes != nil {
		return *execRes, nil
	}
	if !gc.reserveExecutorSlot(playerID, execState.ConcurrentTasks) {
		res.Code = model.CodeExecutorBusy
		res.Message = "executor is busy"
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
		res.Message = fmt.Sprintf("building %s demolish started (%d ticks)", entityID, rule.DurationTicks)
		return res, events
	}

	events = demolishBuilding(ws, building, rule.RefundRate)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("building %s demolished", entityID)
	return res, events
}

// settleResources produces/consumes resources for all buildings each tick
func settleResources(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent
	settleEnergyStorage(ws)
	coverage := model.ResolvePowerCoverage(ws)
	allocations := model.ResolvePowerAllocations(ws, coverage)

	for _, b := range ws.Buildings {
		player := ws.Players[b.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}

		if b.Runtime.State == model.BuildingWorkPaused || b.Runtime.State == model.BuildingWorkIdle {
			continue
		}

		maintenance := b.Runtime.Params.MaintenanceCost
		totalEnergyCost := model.PowerDemandForBuilding(b)
		effectiveEnergyCost := totalEnergyCost
		powerRatio := 1.0

		if maintenance.Minerals > 0 && player.Resources.Minerals < maintenance.Minerals {
			if evt := applyBuildingState(b, model.BuildingWorkError, stateReasonFault); evt != nil {
				evt.Payload["cause"] = "maintenance_insufficient"
				events = append(events, evt)
			}
			continue
		}

		if totalEnergyCost > 0 {
			cov, ok := coverage[b.ID]
			if !ok || !cov.Connected {
				reason := powerCoverageReasonToStateReason(cov.Reason)
				if !ok {
					reason = powerCoverageReasonToStateReason(model.PowerCoverageNoConnector)
				}
				if evt := applyBuildingState(b, model.BuildingWorkNoPower, reason); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			alloc, ok := allocations.Buildings[b.ID]
			if !ok || alloc.Allocated <= 0 {
				if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonUnderPower); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			powerRatio = alloc.Ratio
			effectiveEnergyCost = alloc.Allocated
		}

		// Check energy availability for energy-consuming buildings
		if totalEnergyCost > 0 && player.Resources.Energy < effectiveEnergyCost {
			if evt := applyBuildingState(b, model.BuildingWorkNoPower, stateReasonUnderPower); evt != nil {
				events = append(events, evt)
			}
			continue
		}

		if evt := applyBuildingState(b, model.BuildingWorkRunning, ""); evt != nil {
			events = append(events, evt)
		}

		oldM := player.Resources.Minerals
		oldE := player.Resources.Energy

		player.Resources.Minerals -= maintenance.Minerals
		player.Resources.Energy -= effectiveEnergyCost

		minerals := 0
		if b.Runtime.Functions.Collect != nil {
			minerals = b.Runtime.Functions.Collect.YieldPerTick
			if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.RequiresResourceNode {
				minerals = mineResource(ws, b, minerals)
			}
		}
		minerals = scaleByPowerRatio(minerals, powerRatio)
		player.Resources.Minerals += minerals
		if !model.IsPowerGeneratorModule(b.Runtime.Functions.Energy) {
			energyGenerate := b.Runtime.Params.EnergyGenerate
			if module := b.Runtime.Functions.Energy; module != nil && module.OutputPerTick > energyGenerate {
				energyGenerate = module.OutputPerTick
			}
			energyGenerate = scaleByPowerRatio(energyGenerate, powerRatio)
			player.Resources.Energy += energyGenerate
		}

		// Cap resources to avoid integer overflow
		if player.Resources.Minerals > 10000 {
			player.Resources.Minerals = 10000
		}
		if player.Resources.Energy > 10000 {
			player.Resources.Energy = 10000
		}
		if player.Resources.Minerals < 0 {
			player.Resources.Minerals = 0
		}
		if player.Resources.Energy < 0 {
			player.Resources.Energy = 0
		}

		if oldM != player.Resources.Minerals || oldE != player.Resources.Energy {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtResourceChanged,
				VisibilityScope: b.OwnerID,
				Payload: map[string]any{
					"player_id": b.OwnerID,
					"minerals":  player.Resources.Minerals,
					"energy":    player.Resources.Energy,
				},
			})
		}
	}

	regenResourceNodes(ws)

	return events
}

func scaleByPowerRatio(value int, ratio float64) int {
	if value <= 0 {
		return 0
	}
	if ratio >= 1 {
		return value
	}
	if ratio <= 0 {
		return 0
	}
	scaled := int(float64(value) * ratio)
	if scaled < 0 {
		return 0
	}
	if scaled > value {
		return value
	}
	return scaled
}

func powerCoverageReasonToStateReason(reason model.PowerCoverageFailureReason) string {
	switch reason {
	case model.PowerCoverageNoConnector:
		return "power_no_connector"
	case model.PowerCoverageNoProvider:
		return "power_no_provider"
	case model.PowerCoverageOutOfRange:
		return "power_out_of_range"
	case model.PowerCoverageCapacityFull:
		return "power_capacity_full"
	default:
		return stateReasonUnderPower
	}
}

func mineResource(ws *model.WorldState, building *model.Building, yieldPerTick int) int {
	if ws == nil || building == nil {
		return 0
	}
	if yieldPerTick <= 0 {
		return 0
	}
	if !ws.InBounds(building.Position.X, building.Position.Y) {
		return 0
	}
	tile := ws.Grid[building.Position.Y][building.Position.X]
	if tile.ResourceNodeID == "" {
		return 0
	}
	node := ws.Resources[tile.ResourceNodeID]
	if node == nil {
		return 0
	}

	switch node.Behavior {
	case "finite":
		if node.Remaining <= 0 || node.CurrentYield <= 0 {
			return 0
		}
		extracted := minInt(yieldPerTick, node.CurrentYield)
		extracted = minInt(extracted, node.Remaining)
		node.Remaining -= extracted
		if node.Remaining == 0 {
			node.CurrentYield = 0
		}
		return extracted
	case "renewable":
		if node.Remaining <= 0 || node.CurrentYield <= 0 {
			return 0
		}
		extracted := minInt(yieldPerTick, node.CurrentYield)
		extracted = minInt(extracted, node.Remaining)
		node.Remaining -= extracted
		return extracted
	case "decay":
		if node.CurrentYield <= 0 {
			return 0
		}
		extracted := minInt(yieldPerTick, node.CurrentYield)
		if node.DecayPerTick > 0 {
			node.CurrentYield -= node.DecayPerTick
			if node.CurrentYield < node.MinYield {
				node.CurrentYield = node.MinYield
			}
		}
		return extracted
	default:
		return 0
	}
}

func regenResourceNodes(ws *model.WorldState) {
	if ws == nil {
		return
	}
	for _, node := range ws.Resources {
		if node == nil {
			continue
		}
		if node.Behavior != "renewable" || node.RegenPerTick <= 0 {
			continue
		}
		if node.Remaining < node.MaxAmount {
			node.Remaining += node.RegenPerTick
			if node.Remaining > node.MaxAmount {
				node.Remaining = node.MaxAmount
			}
		}
	}
}

// settleTurrets - turrets auto-attack enemies in range (both units and enemy forces)
func settleTurrets(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	for _, turret := range ws.Buildings {
		if turret.HP <= 0 || turret.Runtime.State != model.BuildingWorkRunning {
			continue
		}

		combat := turret.Runtime.Functions.Combat
		if combat == nil || combat.Attack <= 0 || combat.Range <= 0 {
			continue
		}

		// Check if turret type is a defense building
		isDefenseTurret := model.IsDefenseBuilding(turret.Type)
		if !isDefenseTurret && turret.Type != model.BuildingTypeGaussTurret {
			continue
		}

		// Try to find a target - prioritize enemy forces, then enemy units
		targetedForce := -1
		targetedUnit := ""

		// Find enemy forces in range
		if ws.EnemyForces != nil {
			for i, force := range ws.EnemyForces.Forces {
				dist := manhattanDistTurret(turret.Position, force.Position)
				if dist <= combat.Range {
					targetedForce = i
					break // one attack per turret per tick
				}
			}
		}

		// If no enemy force target, find enemy unit target
		if targetedForce < 0 {
			for _, unit := range ws.Units {
				if unit.OwnerID == turret.OwnerID {
					continue
				}
				if sameTeam(ws, unit.OwnerID, turret.OwnerID) {
					continue
				}
				dist := model.ManhattanDist(turret.Position, unit.Position)
				if dist > combat.Range {
					continue
				}
				targetedUnit = unit.ID
				break
			}
		}

		// Apply damage to the target
		if targetedForce >= 0 {
			// Attack enemy force
			force := &ws.EnemyForces.Forces[targetedForce]
			damage := combat.Attack
			// Shield mitigation (30% damage to shield, 70% to HP)
			if force.SpreadRadius > 0 { // using spreadRadius as shield proxy
				shieldDamage := float64(damage) * 0.3
				force.SpreadRadius -= shieldDamage * 0.01
				if force.SpreadRadius < 0.1 {
					force.SpreadRadius = 0.1
				}
				damage = int(float64(damage) * 0.7)
			}

			// Reduce force strength based on damage
			force.Strength -= damage / 10
			if force.Strength < 0 {
				force.Strength = 0
			}

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: "all",
				Payload: map[string]any{
					"attacker_id": turret.ID,
					"target_id":   force.ID,
					"damage":      damage,
					"target_type": "enemy_force",
					"remaining_strength": force.Strength,
				},
			})

			// Remove destroyed enemy forces
			if force.Strength <= 0 {
				lastIdx := len(ws.EnemyForces.Forces) - 1
				ws.EnemyForces.Forces[targetedForce] = ws.EnemyForces.Forces[lastIdx]
				ws.EnemyForces.Forces = ws.EnemyForces.Forces[:lastIdx]
			}
		} else if targetedUnit != "" {
			// Attack enemy unit
			unit := ws.Units[targetedUnit]
			damage := max(1, combat.Attack-unit.Defense)
			unit.HP -= damage

			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: unit.OwnerID,
				Payload: map[string]any{
					"attacker_id": turret.ID,
					"target_id":   unit.ID,
					"damage":      damage,
					"target_hp":   unit.HP,
				},
			})

			if unit.HP <= 0 {
				delete(ws.Units, unit.ID)
				tileKey := model.TileKey(unit.Position.X, unit.Position.Y)
				removeUnitFromTile(ws, tileKey, unit.ID)
				events = append(events, &model.GameEvent{
					EventType:       model.EvtEntityDestroyed,
					VisibilityScope: "all",
					Payload: map[string]any{
						"entity_id":   unit.ID,
						"entity_type": "unit",
						"owner_id":    unit.OwnerID,
					},
				})
			}
		}
	}

	return events
}

// manhattanDistTurret 计算炮塔到位置的距离
func manhattanDistTurret(a, b model.Position) int {
	dx := a.X - b.X
	if dx < 0 {
		dx = -dx
	}
	dy := a.Y - b.Y
	if dy < 0 {
		dy = -dy
	}
	return dx + dy
}

// checkVictory determines if a player has won (elimination: opponent lost base)
func checkVictory(ws *model.WorldState) string {
	playerBases := make(map[string]bool)
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeBattlefieldAnalysisBase {
			playerBases[b.OwnerID] = true
		}
	}
	for pid, p := range ws.Players {
		if p.IsAlive && !playerBases[pid] {
			p.IsAlive = false
		}
	}

	var alive []string
	for pid, p := range ws.Players {
		if p.IsAlive {
			alive = append(alive, pid)
		}
	}
	if len(alive) == 1 {
		return alive[0]
	}
	return ""
}

// Helper: find a free adjacent tile
func findAdjacentFree(ws *model.WorldState, center model.Position) *model.Position {
	dirs := []model.Position{{X: 0, Y: 1}, {X: 0, Y: -1}, {X: 1, Y: 0}, {X: -1, Y: 0},
		{X: 1, Y: 1}, {X: -1, Y: 1}, {X: 1, Y: -1}, {X: -1, Y: -1}}
	for _, d := range dirs {
		nx, ny := center.X+d.X, center.Y+d.Y
		if !ws.InBounds(nx, ny) {
			continue
		}
		tileKey := model.TileKey(nx, ny)
		if _, occupied := ws.TileBuilding[tileKey]; occupied {
			continue
		}
		p := model.Position{X: nx, Y: ny}
		return &p
	}
	return nil
}

func removeUnitFromTile(ws *model.WorldState, tileKey, unitID string) {
	units := ws.TileUnits[tileKey]
	for i, uid := range units {
		if uid == unitID {
			ws.TileUnits[tileKey] = append(units[:i], units[i+1:]...)
			return
		}
	}
}

// execLaunchSolarSail handles the "launch_solar_sail" command.
// Payload: {
//   "building_id": "id of EM rail ejector or vertical launching silo",
//   "orbit_radius": 1.0,  // optional, default 1.0 AU
//   "inclination": 0.0,   // optional, default 0.0 degrees
// }
func (gc *GameCore) execLaunchSolarSail(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, ok := cmd.Payload["building_id"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.building_id required"
		return res, nil
	}
	bid, ok := buildingID.(string)
	if !ok || bid == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.building_id must be a non-empty string"
		return res, nil
	}

	building, ok := ws.Buildings[bid]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", bid)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}

	// Only EM Rail Ejector and Vertical Launching Silo can launch solar sails
	if building.Type != model.BuildingTypeEMRailEjector && building.Type != model.BuildingTypeVerticalLaunchingSilo {
		res.Code = model.CodeInvalidTarget
		res.Message = "only EM Rail Ejector or Vertical Launching Silo can launch solar sails"
		return res, nil
	}

	// Check building is running
	if building.Runtime.State != model.BuildingWorkRunning {
		res.Code = model.CodeValidationFailed
		res.Message = "building is not operational"
		return res, nil
	}

	// Check player has solar sails
	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found or not alive"
		return res, nil
	}

	sailCount := 1
	if countRaw, ok := cmd.Payload["count"]; ok {
		if count, ok := countRaw.(float64); ok {
			sailCount = int(count)
			if sailCount <= 0 {
				sailCount = 1
			}
			if sailCount > 10 {
				sailCount = 10 // cap at 10 per launch
			}
		}
	}

	// Check inventory has enough solar sails
	if player.Inventory == nil {
		res.Code = model.CodeInsufficientResource
		res.Message = "no solar sails in inventory"
		return res, nil
	}
	if player.Inventory[model.ItemSolarSail] < sailCount {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d solar sails, have %d", sailCount, player.Inventory[model.ItemSolarSail])
		return res, nil
	}

	// Get orbit parameters
	orbitRadius := 1.0
	if radiusRaw, ok := cmd.Payload["orbit_radius"]; ok {
		if radius, ok := radiusRaw.(float64); ok && radius > 0 {
			orbitRadius = radius
		}
	}
	inclination := 0.0
	if inclRaw, ok := cmd.Payload["inclination"]; ok {
		if incl, ok := inclRaw.(float64); ok {
			inclination = incl
		}
	}

	// Validate orbit parameters against building's launch constraints
	if building.Runtime.Functions.Launch != nil {
		lm := building.Runtime.Functions.Launch
		if orbitRadius < lm.OrbitRadiusMin {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("orbit_radius %.2f is below minimum %.2f", orbitRadius, lm.OrbitRadiusMin)
			return res, nil
		}
		if orbitRadius > lm.OrbitRadiusMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("orbit_radius %.2f exceeds maximum %.2f", orbitRadius, lm.OrbitRadiusMax)
			return res, nil
		}
		if inclination < -lm.InclinationMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("inclination %.2f is below minimum %.2f", inclination, -lm.InclinationMax)
			return res, nil
		}
		if inclination > lm.InclinationMax {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("inclination %.2f exceeds maximum %.2f", inclination, lm.InclinationMax)
			return res, nil
		}
	}

	// Check launch success rate
	launchSuccessRate := 1.0
	if building.Runtime.Functions.Launch != nil {
		launchSuccessRate = building.Runtime.Functions.Launch.SuccessRate
	}
	if rand.Float64() > launchSuccessRate {
		// Launch failed, consume sails but no orbit entry
		player.Inventory[model.ItemSolarSail] -= sailCount
		if player.Inventory[model.ItemSolarSail] <= 0 {
			delete(player.Inventory, model.ItemSolarSail)
		}
		res.Status = model.StatusFailed
		res.Code = model.CodeValidationFailed
		res.Message = "launch failed due to equipment malfunction"
		return res, nil
	}

	// Consume solar sails from inventory
	player.Inventory[model.ItemSolarSail] -= sailCount
	if player.Inventory[model.ItemSolarSail] <= 0 {
		delete(player.Inventory, model.ItemSolarSail)
	}

	// Get system ID from maps
	systemID := ""
	if gc.maps != nil {
		planet, _ := gc.maps.Planet(ws.PlanetID)
		if planet != nil {
			systemID = planet.SystemID
		}
	}

	// Launch solar sails
	var events []*model.GameEvent
	for i := 0; i < sailCount; i++ {
		sail := LaunchSolarSail(playerID, systemID, orbitRadius, inclination, ws.Tick)
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "solar_sail",
				"entity_id":   sail.ID,
				"sail":        sail,
			},
		})
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("launched %d solar sail(s) into orbit", sailCount)
	return res, events
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
