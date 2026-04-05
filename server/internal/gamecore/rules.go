package gamecore

import (
	"fmt"
	"math"
	"math/rand"
	"sort"

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

	// Check tech unlock requirement
	player := ws.Players[playerID]
	if !CanBuildTech(player, model.TechUnlockBuilding, string(btype)) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building type %s requires research to unlock", btype)
		return res, nil
	}

	recipeID := ""
	if recipeRaw, ok := cmd.Payload["recipe_id"]; ok {
		recipeID = fmt.Sprintf("%v", recipeRaw)
	}
	if recipeID == "" && def.DefaultRecipeID != "" {
		recipeID = def.DefaultRecipeID
	}
	if recipeID != "" {
		recipe, ok := model.Recipe(recipeID)
		if !ok {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("unknown recipe: %s", recipeID)
			return res, nil
		}
		if def := model.BuildingProfileFor(btype, 1); def.Runtime.Functions.Production == nil {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("building type %s does not support recipes", btype)
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
			res.Message = fmt.Sprintf("recipe %s not supported by building type %s", recipeID, btype)
			return res, nil
		}
		if !CanUseRecipeTech(player, recipeID) {
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("recipe %s requires research to unlock", recipeID)
			return res, nil
		}
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
	player = ws.Players[playerID]
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
		RecipeID:          recipeID,
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
	if ok, reason := buildingOperationalForCommand(ws, building); !ok {
		res.Code = model.CodeInvalidTarget
		if reason == "" {
			reason = "not_operational"
		}
		res.Message = fmt.Sprintf("production building is not operational: %s", reason)
		return res, nil
	}

	utypeRaw, ok := cmd.Payload["unit_type"]
	if !ok {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.unit_type required"
		return res, nil
	}
	utypeID := fmt.Sprintf("%v", utypeRaw)
	unitEntry, ok := model.PublicWorldProduceUnitByID(utypeID)
	if !ok {
		if entry, exists := model.PublicUnitCatalogEntryByID(utypeID); exists {
			res.Code = model.CodeValidationFailed
			switch entry.DeployCommand {
			case string(model.CmdDeploySquad):
				res.Message = fmt.Sprintf("unit %s is not produced via produce; use deploy_squad", utypeID)
			case string(model.CmdCommissionFleet):
				res.Message = fmt.Sprintf("unit %s is not produced via produce; use commission_fleet", utypeID)
			default:
				res.Message = fmt.Sprintf("unit %s is not produced via produce", utypeID)
			}
			return res, nil
		}
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unit %s is not publicly available", utypeID)
		return res, nil
	}
	utype := model.UnitType(unitEntry.ID)

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
	snapshot := model.CurrentPowerSettlementSnapshot(ws)
	coverage := map[string]model.PowerCoverageResult{}
	allocations := model.PowerAllocationState{}
	if snapshot != nil {
		coverage = snapshot.Coverage
		allocations = snapshot.Allocations
	}
	productionSnapshot := model.CurrentProductionSettlementSnapshot(ws)

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
		powerRatio := 1.0

		if maintenance.Minerals > 0 && player.Resources.Minerals < maintenance.Minerals {
			if evt := applyBuildingState(b, model.BuildingWorkError, stateReasonFault); evt != nil {
				evt.Payload["cause"] = "maintenance_insufficient"
				events = append(events, evt)
			}
			continue
		}

		if totalEnergyCost > 0 {
			powered, reason, alloc := buildingPowerAvailability(ws, b, coverage, allocations)
			if !powered {
				if evt := applyBuildingState(b, model.BuildingWorkNoPower, reason); evt != nil {
					events = append(events, evt)
				}
				continue
			}
			powerRatio = alloc.Ratio
		}

		if module := b.Runtime.Functions.Energy; module != nil && model.IsFuelBasedPowerSource(module.SourceKind) {
			if b.Runtime.State == model.BuildingWorkNoPower && b.Runtime.StateReason == stateReasonNoFuel {
				continue
			}
		}

		if evt := applyBuildingState(b, model.BuildingWorkRunning, ""); evt != nil {
			events = append(events, evt)
		}

		oldM := player.Resources.Minerals

		player.Resources.Minerals -= maintenance.Minerals

		minerals := 0
		if b.Runtime.Functions.Collect != nil {
			syncCollectorResourceKind(ws, b)
			collectYield := b.Runtime.Functions.Collect.YieldPerTick
			if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.RequiresResourceNode {
				collectYield = scaleByPowerRatio(collectYield, powerRatio)
				if itemID := collectorOutputItemID(ws, b); itemID != "" && b.Storage != nil {
					accepted, _, err := b.Storage.PreviewReceive(itemID, collectYield)
					if err == nil && accepted > 0 {
						mined := mineResource(ws, b, accepted)
						if mined > 0 {
							stored, _, err := b.Storage.Receive(itemID, mined)
							if err == nil && stored > 0 && productionSnapshot != nil {
								productionSnapshot.RecordBuildingOutputs(b, []model.ItemAmount{{
									ItemID:   itemID,
									Quantity: stored,
								}})
							}
						}
					}
					collectYield = 0
				} else {
					minerals = mineResource(ws, b, collectYield)
				}
			} else {
				minerals = scaleByPowerRatio(collectYield, powerRatio)
			}
		}
		player.Resources.Minerals += minerals
		if minerals > 0 && productionSnapshot != nil {
			productionSnapshot.RecordBuildingOutputs(b, []model.ItemAmount{{
				ItemID:   model.ProductionStatMinerals,
				Quantity: minerals,
			}})
		}

		// Cap resources to avoid integer overflow
		if player.Resources.Minerals > 10000 {
			player.Resources.Minerals = 10000
		}
		if player.Resources.Minerals < 0 {
			player.Resources.Minerals = 0
		}

		if oldM != player.Resources.Minerals {
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

func buildingPowerAvailability(
	ws *model.WorldState,
	building *model.Building,
	coverage map[string]model.PowerCoverageResult,
	allocations model.PowerAllocationState,
) (bool, string, model.PowerAllocation) {
	if building == nil {
		return false, "", model.PowerAllocation{}
	}
	demand := model.PowerDemandForBuilding(building)
	if demand <= 0 {
		return true, "", model.PowerAllocation{}
	}

	cov, ok := coverage[building.ID]
	if !ok || !cov.Connected {
		reason := model.PowerCoverageNoConnector
		if ok {
			reason = cov.Reason
		}
		return false, powerCoverageReasonToStateReason(reason), model.PowerAllocation{}
	}

	alloc, ok := allocations.Buildings[building.ID]
	if !ok || alloc.Allocated <= 0 {
		return false, stateReasonUnderPower, model.PowerAllocation{}
	}
	return true, "", alloc
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

func buildingOperationalForCommand(ws *model.WorldState, building *model.Building) (bool, string) {
	if ws == nil || building == nil {
		return false, ""
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkError:
		return false, building.Runtime.StateReason
	}

	demand := model.PowerDemandForBuilding(building)
	if demand <= 0 {
		return true, ""
	}

	coverage := model.ResolvePowerCoverage(ws)
	allocations := model.ResolvePowerAllocations(ws, coverage)
	if ws.PowerSnapshot == nil || ws.PowerSnapshot.Tick != ws.Tick {
		allocations = resolveCommandPowerAllocations(ws, coverage)
	}
	powered, reason, _ := buildingPowerAvailability(ws, building, coverage, allocations)
	if !powered {
		return false, reason
	}
	return true, ""
}

type commandPowerConsumer struct {
	id       string
	demand   int
	priority int
}

func resolveCommandPowerAllocations(ws *model.WorldState, coverage map[string]model.PowerCoverageResult) model.PowerAllocationState {
	state := model.PowerAllocationState{
		Networks:  make(map[string]*model.PowerAllocationNetwork),
		Buildings: make(map[string]model.PowerAllocation),
	}
	if ws == nil {
		return state
	}
	networks := model.ResolvePowerNetworks(ws)
	if len(networks.Networks) == 0 {
		return state
	}
	powerInputs := commandPowerInputsByBuilding(ws.PowerInputs)
	useFallback := ws.PowerSnapshot == nil || ws.PowerSnapshot.Tick != ws.Tick

	for _, network := range networks.Networks {
		if network == nil {
			continue
		}
		consumers := make([]commandPowerConsumer, 0)
		supply := 0
		for _, id := range network.NodeIDs {
			building := ws.Buildings[id]
			if building == nil {
				continue
			}
			if commandPowerSupplyActive(building) {
				supply += commandPowerSupplyForBuilding(building, powerInputs, useFallback)
			}
			if !commandPowerDemandActive(building) {
				continue
			}
			demand := model.PowerDemandForBuilding(building)
			if demand <= 0 {
				continue
			}
			cov := coverage[id]
			if !cov.Connected {
				continue
			}
			consumers = append(consumers, commandPowerConsumer{
				id:       id,
				demand:   demand,
				priority: commandPowerPriorityForBuilding(building),
			})
		}

		if len(consumers) == 0 {
			state.Networks[network.ID] = &model.PowerAllocationNetwork{
				ID:        network.ID,
				OwnerID:   network.OwnerID,
				Supply:    supply,
				Demand:    0,
				Allocated: 0,
				Net:       supply,
				Shortage:  false,
			}
			continue
		}

		sort.Slice(consumers, func(i, j int) bool {
			if consumers[i].priority != consumers[j].priority {
				return consumers[i].priority > consumers[j].priority
			}
			return consumers[i].id < consumers[j].id
		})

		demandTotal := 0
		allocations := make(map[string]int, len(consumers))
		for _, consumer := range consumers {
			demandTotal += consumer.demand
			allocations[consumer.id] = 0
		}

		remaining := supply
		for i := 0; i < len(consumers) && remaining > 0; {
			priority := consumers[i].priority
			j := i + 1
			groupDemand := consumers[i].demand
			for j < len(consumers) && consumers[j].priority == priority {
				groupDemand += consumers[j].demand
				j++
			}
			if groupDemand <= 0 {
				i = j
				continue
			}

			if remaining >= groupDemand {
				for k := i; k < j; k++ {
					allocations[consumers[k].id] = consumers[k].demand
				}
				remaining -= groupDemand
				i = j
				continue
			}

			ratio := float64(remaining) / float64(groupDemand)
			allocatedSum := 0
			for k := i; k < j; k++ {
				alloc := int(float64(consumers[k].demand) * ratio)
				if alloc < 0 {
					alloc = 0
				}
				if alloc > consumers[k].demand {
					alloc = consumers[k].demand
				}
				allocations[consumers[k].id] = alloc
				allocatedSum += alloc
			}
			leftover := remaining - allocatedSum
			for k := i; k < j && leftover > 0; k++ {
				allocations[consumers[k].id]++
				leftover--
			}
			remaining = 0
			break
		}

		allocatedTotal := 0
		for _, consumer := range consumers {
			alloc := allocations[consumer.id]
			allocatedTotal += alloc
			ratio := 0.0
			if consumer.demand > 0 && alloc > 0 {
				ratio = float64(alloc) / float64(consumer.demand)
				if ratio > 1 {
					ratio = 1
				}
			}
			state.Buildings[consumer.id] = model.PowerAllocation{
				NetworkID: network.ID,
				Demand:    consumer.demand,
				Allocated: alloc,
				Ratio:     ratio,
				Priority:  consumer.priority,
			}
		}

		state.Networks[network.ID] = &model.PowerAllocationNetwork{
			ID:        network.ID,
			OwnerID:   network.OwnerID,
			Supply:    supply,
			Demand:    demandTotal,
			Allocated: allocatedTotal,
			Net:       supply - demandTotal,
			Shortage:  supply < demandTotal,
		}
	}

	return state
}

func commandPowerInputsByBuilding(inputs []model.PowerInput) map[string]int {
	if len(inputs) == 0 {
		return nil
	}
	result := make(map[string]int)
	for _, input := range inputs {
		if input.BuildingID == "" || input.Output <= 0 {
			continue
		}
		result[input.BuildingID] += input.Output
	}
	return result
}

func commandPowerSupplyForBuilding(building *model.Building, powerInputs map[string]int, useFallback bool) int {
	if building == nil {
		return 0
	}
	module := building.Runtime.Functions.Energy
	if model.IsPowerGeneratorModule(module) {
		if powerInputs != nil {
			if output := powerInputs[building.ID]; output > 0 {
				return output
			}
		}
		if useFallback {
			return estimatedCommandGeneratorOutput(building, module)
		}
		return 0
	}
	if powerInputs != nil {
		if output := powerInputs[building.ID]; output > 0 {
			return output
		}
	}
	output := building.Runtime.Params.EnergyGenerate
	if module != nil && module.OutputPerTick > output {
		output = module.OutputPerTick
	}
	if output < 0 {
		return 0
	}
	return output
}

func estimatedCommandGeneratorOutput(building *model.Building, module *model.EnergyModule) int {
	if building == nil || module == nil {
		return 0
	}
	switch module.SourceKind {
	case model.PowerSourceRayReceiver:
		return 0
	case model.PowerSourceThermal, model.PowerSourceFusion, model.PowerSourceArtificialStar:
		return estimateFuelBasedCommandGeneratorOutput(building, module)
	default:
		return commandGeneratorBaseOutput(building, module)
	}
}

func estimateFuelBasedCommandGeneratorOutput(building *model.Building, module *model.EnergyModule) int {
	base := commandGeneratorBaseOutput(building, module)
	if base <= 0 || module == nil || len(module.FuelRules) == 0 {
		return 0
	}
	for i := range module.FuelRules {
		rule := module.FuelRules[i]
		if rule.ItemID == "" || rule.ConsumePerTick <= 0 {
			continue
		}
		available := commandStorageItemQuantity(building.Storage, rule.ItemID)
		if available <= 0 {
			continue
		}
		ratio := 1.0
		if available < rule.ConsumePerTick {
			ratio = float64(available) / float64(rule.ConsumePerTick)
		}
		multiplier := 1.0
		if rule.OutputMultiplier > 0 {
			multiplier = rule.OutputMultiplier
		}
		output := int(math.Round(float64(base) * multiplier * ratio))
		if output < 0 {
			return 0
		}
		return output
	}
	return 0
}

func commandGeneratorBaseOutput(building *model.Building, module *model.EnergyModule) int {
	output := 0
	if building != nil {
		output = building.Runtime.Params.EnergyGenerate
	}
	if module != nil && module.OutputPerTick > output {
		output = module.OutputPerTick
	}
	if output < 0 {
		return 0
	}
	return output
}

func commandStorageItemQuantity(storage *model.StorageState, itemID string) int {
	if storage == nil || itemID == "" {
		return 0
	}
	total := 0
	if storage.InputBuffer != nil {
		total += storage.InputBuffer[itemID]
	}
	if storage.Inventory != nil {
		total += storage.Inventory[itemID]
	}
	return total
}

func commandPowerDemandActive(building *model.Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkIdle:
		return false
	default:
		return true
	}
}

func commandPowerSupplyActive(building *model.Building) bool {
	if building == nil {
		return false
	}
	switch building.Runtime.State {
	case model.BuildingWorkPaused, model.BuildingWorkIdle, model.BuildingWorkError, model.BuildingWorkNoPower:
		return false
	default:
		return true
	}
}

func commandPowerPriorityForBuilding(building *model.Building) int {
	if building == nil {
		return 1
	}
	if building.Runtime.Params.PowerPriority > 0 {
		return building.Runtime.Params.PowerPriority
	}
	def, ok := model.BuildingDefinitionByID(building.Type)
	if !ok {
		return 1
	}
	switch def.Category {
	case model.BuildingCategoryCommandSignal:
		return 100
	case model.BuildingCategoryPowerGrid:
		return 90
	case model.BuildingCategoryPower:
		return 80
	case model.BuildingCategoryDyson:
		return 70
	case model.BuildingCategoryLogisticsHub:
		return 60
	case model.BuildingCategoryResearch:
		return 50
	case model.BuildingCategoryProduction:
		return 45
	case model.BuildingCategoryChemical, model.BuildingCategoryRefining:
		return 40
	case model.BuildingCategoryCollect:
		return 35
	case model.BuildingCategoryTransport, model.BuildingCategoryStorage:
		return 30
	default:
		return 1
	}
}

func syncCollectorResourceKind(ws *model.WorldState, building *model.Building) {
	if ws == nil || building == nil || building.Runtime.Functions.Collect == nil {
		return
	}
	building.Runtime.Functions.Collect.ResourceKind = collectorResourceKind(ws, building)
}

func collectorOutputItemID(ws *model.WorldState, building *model.Building) string {
	node := resourceNodeForBuilding(ws, building)
	if node == nil {
		return ""
	}
	switch node.Kind {
	case string(mapmodel.ResourceIronOre):
		return model.ItemIronOre
	case string(mapmodel.ResourceCopperOre):
		return model.ItemCopperOre
	case string(mapmodel.ResourceStoneOre):
		return model.ItemStoneOre
	case string(mapmodel.ResourceSiliconOre):
		return model.ItemSiliconOre
	case string(mapmodel.ResourceTitaniumOre):
		return model.ItemTitaniumOre
	case string(mapmodel.ResourceCoal):
		return model.ItemCoal
	case string(mapmodel.ResourceCrudeOil):
		return model.ItemCrudeOil
	case string(mapmodel.ResourceWater):
		return model.ItemWater
	case string(mapmodel.ResourceFireIce):
		return model.ItemFireIce
	case string(mapmodel.ResourceFractalSilicon):
		return model.ItemFractalSilicon
	case string(mapmodel.ResourceGratingCrystal):
		return model.ItemGratingCrystal
	case string(mapmodel.ResourceMonopoleMagnet):
		return model.ItemMonopoleMagnet
	default:
		return ""
	}
}

func collectorResourceKind(ws *model.WorldState, building *model.Building) string {
	node := resourceNodeForBuilding(ws, building)
	if node == nil {
		return ""
	}
	return node.Kind
}

func resourceNodeForBuilding(ws *model.WorldState, building *model.Building) *model.ResourceNodeState {
	if ws == nil || building == nil {
		return nil
	}
	if !ws.InBounds(building.Position.X, building.Position.Y) {
		return nil
	}
	nodeID := ws.Grid[building.Position.Y][building.Position.X].ResourceNodeID
	if nodeID == "" {
		return nil
	}
	return ws.Resources[nodeID]
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
					"attacker_id":        turret.ID,
					"target_id":          force.ID,
					"damage":             damage,
					"target_type":        "enemy_force",
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

func resolveVictory(rule string, worlds map[string]*model.WorldState, activeWorld *model.WorldState) model.VictoryState {
	rule = model.NormalizeVictoryRule(rule)
	if model.VictoryRuleAllowsMissionComplete(rule) {
		if victory := resolveMissionCompleteVictory(worlds, rule); victory.Declared() {
			return victory
		}
	}
	if model.VictoryRuleAllowsElimination(rule) {
		return resolveEliminationVictory(activeWorld, rule)
	}
	return model.VictoryState{}
}

func resolveMissionCompleteVictory(worlds map[string]*model.WorldState, rule string) model.VictoryState {
	players := researchPlayers(worlds)
	if len(players) == 0 {
		return model.VictoryState{}
	}
	winners := make([]string, 0, len(players))
	for playerID, player := range players {
		if player == nil || !player.IsAlive || player.Tech == nil || !player.Tech.HasTech("mission_complete") {
			continue
		}
		winners = append(winners, playerID)
	}
	if len(winners) == 0 {
		return model.VictoryState{}
	}
	sort.Strings(winners)
	return model.VictoryState{
		WinnerID:    winners[0],
		Reason:      model.VictoryReasonGameWin,
		VictoryRule: rule,
		TechID:      "mission_complete",
	}
}

func resolveEliminationVictory(ws *model.WorldState, rule string) model.VictoryState {
	winner := checkVictory(ws)
	if winner == "" {
		return model.VictoryState{}
	}
	return model.VictoryState{
		WinnerID:    winner,
		Reason:      model.VictoryReasonElimination,
		VictoryRule: rule,
	}
}

// checkVictory determines if a player has won by elimination (opponent lost base).
func checkVictory(ws *model.WorldState) string {
	if ws == nil {
		return ""
	}
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

func victoryDeclaredEvent(victory model.VictoryState) *model.GameEvent {
	if !victory.Declared() {
		return nil
	}
	payload := map[string]any{
		"winner_id":    victory.WinnerID,
		"reason":       victory.Reason,
		"victory_rule": victory.VictoryRule,
	}
	if victory.TechID != "" {
		payload["tech_id"] = victory.TechID
	}
	return &model.GameEvent{
		EventType:       model.EvtVictoryDeclared,
		VisibilityScope: "all",
		Payload:         payload,
	}
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
//
//	Payload: {
//	  "building_id": "id of EM rail ejector or vertical launching silo",
//	  "orbit_radius": 1.0,  // optional, default 1.0 AU
//	  "inclination": 0.0,   // optional, default 0.0 degrees
//	}
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

	// Solar sails are launched by the EM Rail Ejector. Vertical silos are reserved for rockets.
	if building.Type != model.BuildingTypeEMRailEjector {
		res.Code = model.CodeInvalidTarget
		res.Message = "only EM Rail Ejector can launch solar sails"
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

	// Check launch building has enough loaded solar sails.
	if building.Storage == nil {
		res.Code = model.CodeInsufficientResource
		res.Message = "launch building has no solar sail storage"
		return res, nil
	}
	loadedSails := building.Storage.OutputQuantity(model.ItemSolarSail)
	if loadedSails < sailCount {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d solar sails loaded, have %d", sailCount, loadedSails)
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
		provided, _, err := building.Storage.Provide(model.ItemSolarSail, sailCount)
		if err != nil || provided != sailCount {
			res.Code = model.CodeInsufficientResource
			res.Message = "failed to consume loaded solar sails"
			return res, nil
		}
		res.Status = model.StatusFailed
		res.Code = model.CodeValidationFailed
		res.Message = "launch failed due to equipment malfunction"
		return res, nil
	}

	// Consume solar sails from the ejector's local storage.
	provided, _, err := building.Storage.Provide(model.ItemSolarSail, sailCount)
	if err != nil || provided != sailCount {
		res.Code = model.CodeInsufficientResource
		res.Message = "failed to consume loaded solar sails"
		return res, nil
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
	if gc.spaceRuntime == nil {
		gc.spaceRuntime = model.NewSpaceRuntimeState()
	}
	for i := 0; i < sailCount; i++ {
		sail := LaunchSolarSail(gc.spaceRuntime, playerID, systemID, orbitRadius, inclination, ws.Tick)
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

func (gc *GameCore) execTransferItem(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	itemID, err := payloadStrictString(cmd.Payload, "item_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	quantity, err := payloadStrictInt(cmd.Payload, "quantity")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if quantity <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.quantity must be positive"
		return res, nil
	}
	if _, ok := model.Item(itemID); !ok {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown item: %s", itemID)
		return res, nil
	}

	building, ok := ws.Buildings[buildingID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if building.Storage == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target building has no storage"
		return res, nil
	}

	player := ws.Players[playerID]
	if player == nil || !player.IsAlive {
		res.Code = model.CodeValidationFailed
		res.Message = "player not found or not alive"
		return res, nil
	}
	if player.Inventory[itemID] < quantity {
		res.Code = model.CodeInsufficientResource
		res.Message = fmt.Sprintf("need %d %s in inventory, have %d", quantity, itemID, player.Inventory[itemID])
		return res, nil
	}

	accepted, remaining, err := building.Storage.Load(itemID, quantity)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if accepted <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot accept %s", buildingID, itemID)
		return res, nil
	}

	inv := player.EnsureInventory()
	inv[itemID] -= accepted
	if inv[itemID] <= 0 {
		delete(inv, itemID)
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	if remaining > 0 {
		res.Message = fmt.Sprintf("transferred %d %s into %s (%d remaining)", accepted, itemID, buildingID, remaining)
	} else {
		res.Message = fmt.Sprintf("transferred %d %s into %s", accepted, itemID, buildingID)
	}

	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"building_id":   buildingID,
			"item_id":       itemID,
			"transferred":   accepted,
			"source":        "player_inventory",
			"remaining":     remaining,
			"inventory_qty": inv[itemID],
		},
	}}
}

func (gc *GameCore) execConfigureLogisticsStation(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	building, station, execRes := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if execRes != nil {
		return *execRes, nil
	}

	previousDroneCapacity := station.DroneCapacityValue()
	droneCapacityUpdated := false
	staged := station.Clone()

	if raw, ok := cmd.Payload["drone_capacity"]; ok {
		droneCapacity, err := payloadValueInt(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.drone_capacity must be numeric"
			return res, nil
		}
		staged.DroneCapacity = droneCapacity
		droneCapacityUpdated = true
	}
	if raw, ok := cmd.Payload["input_priority"]; ok {
		inputPriority, err := payloadValueInt(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.input_priority must be numeric"
			return res, nil
		}
		staged.Priority.Input = inputPriority
	}
	if raw, ok := cmd.Payload["output_priority"]; ok {
		outputPriority, err := payloadValueInt(raw)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.output_priority must be numeric"
			return res, nil
		}
		staged.Priority.Output = outputPriority
	}

	if raw, ok := cmd.Payload["interstellar"]; ok {
		if !supportsInterstellarConfigCommand(building) {
			res.Code = model.CodeValidationFailed
			res.Message = "planetary logistics station does not support interstellar config"
			return res, nil
		}
		payload, ok := raw.(map[string]any)
		if !ok {
			res.Code = model.CodeValidationFailed
			res.Message = "payload.interstellar must be an object"
			return res, nil
		}
		if err := applyMinimalInterstellarConfig(&staged.Interstellar, payload); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	}

	staged.Normalize()

	if droneCapacityUpdated && staged.DroneCapacityValue() > previousDroneCapacity {
		originalStation := station.Clone()
		registryHadEntry := false
		var originalRegistryStation *model.LogisticsStationState
		if ws.LogisticsStations != nil {
			originalRegistryStation, registryHadEntry = ws.LogisticsStations[building.ID]
			if registryHadEntry {
				ws.LogisticsStations[building.ID] = station
			}
		}

		*station = *staged
		createdDroneIDs, err := ensureStationDronesToCapacityTracking(ws, building)
		if err != nil {
			*station = *originalStation
			if ws.LogisticsStations != nil {
				if registryHadEntry {
					ws.LogisticsStations[building.ID] = originalRegistryStation
				} else {
					delete(ws.LogisticsStations, building.ID)
				}
			}
			unregisterLogisticsDrones(ws, createdDroneIDs)
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
	} else {
		*station = *staged
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("logistics station %s configured", building.ID)
	return res, nil
}

func (gc *GameCore) execConfigureLogisticsSlot(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	building, station, execRes := requireOwnedLogisticsStation(ws, playerID, cmd.Target.EntityID)
	if execRes != nil {
		return *execRes, nil
	}

	scope, err := payloadStrictString(cmd.Payload, "scope")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	itemID, err := payloadStrictString(cmd.Payload, "item_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	modeRaw, err := payloadStrictString(cmd.Payload, "mode")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	mode := model.LogisticsStationMode(modeRaw)
	if !mode.Valid() {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.mode must be one of none|supply|demand|both"
		return res, nil
	}
	localStorage, err := payloadStrictInt(cmd.Payload, "local_storage")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	setting := model.LogisticsStationItemSetting{
		ItemID:       itemID,
		Mode:         mode,
		LocalStorage: localStorage,
	}

	switch scope {
	case "planetary":
		err = station.UpsertSetting(setting)
	case "interstellar":
		if !supportsInterstellarConfigCommand(building) {
			res.Code = model.CodeValidationFailed
			res.Message = "planetary logistics station does not support interstellar scope"
			return res, nil
		}
		err = station.UpsertInterstellarSetting(setting)
	default:
		res.Code = model.CodeValidationFailed
		res.Message = "payload.scope must be planetary or interstellar"
		return res, nil
	}
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	station.Normalize()
	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("logistics slot configured for %s", itemID)
	return res, nil
}

func supportsInterstellarConfigCommand(building *model.Building) bool {
	return building != nil && building.Type == model.BuildingTypeInterstellarLogisticsStation
}

func isConfigurableLogisticsStationType(buildingType model.BuildingType) bool {
	return buildingType == model.BuildingTypePlanetaryLogisticsStation || buildingType == model.BuildingTypeInterstellarLogisticsStation
}

func requireOwnedLogisticsStation(ws *model.WorldState, playerID, buildingID string) (*model.Building, *model.LogisticsStationState, *model.CommandResult) {
	res := model.CommandResult{Status: model.StatusFailed}
	if buildingID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id required"
		return nil, nil, &res
	}

	building, ok := ws.Buildings[buildingID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return nil, nil, &res
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot configure building owned by another player"
		return nil, nil, &res
	}
	if !isConfigurableLogisticsStationType(building.Type) || building.LogisticsStation == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "target building is not a logistics station"
		return nil, nil, &res
	}
	return building, building.LogisticsStation, nil
}

func payloadStrictString(payload map[string]any, key string) (string, error) {
	raw, ok := payload[key]
	if !ok {
		return "", fmt.Errorf("payload.%s required", key)
	}
	value, ok := raw.(string)
	if !ok || value == "" {
		return "", fmt.Errorf("payload.%s must be a non-empty string", key)
	}
	return value, nil
}

func payloadStrictInt(payload map[string]any, key string) (int, error) {
	raw, ok := payload[key]
	if !ok {
		return 0, fmt.Errorf("payload.%s required", key)
	}
	value, err := payloadValueInt(raw)
	if err != nil {
		return 0, fmt.Errorf("payload.%s must be integer", key)
	}
	return value, nil
}

func applyMinimalInterstellarConfig(cfg *model.LogisticsStationInterstellarConfig, payload map[string]any) error {
	if cfg == nil {
		return fmt.Errorf("interstellar config required")
	}
	if raw, ok := payload["enabled"]; ok {
		enabled, err := payloadValueBool(raw)
		if err != nil {
			return fmt.Errorf("payload.interstellar.enabled must be boolean")
		}
		cfg.Enabled = enabled
	}
	if raw, ok := payload["warp_enabled"]; ok {
		warpEnabled, err := payloadValueBool(raw)
		if err != nil {
			return fmt.Errorf("payload.interstellar.warp_enabled must be boolean")
		}
		cfg.WarpEnabled = warpEnabled
	}
	if raw, ok := payload["ship_slots"]; ok {
		shipSlots, err := payloadValueInt(raw)
		if err != nil {
			return fmt.Errorf("payload.interstellar.ship_slots must be numeric")
		}
		cfg.ShipSlots = shipSlots
	}
	return nil
}

func payloadValueInt(raw any) (int, error) {
	switch value := raw.(type) {
	case int:
		return value, nil
	case int32:
		return int(value), nil
	case int64:
		return int(value), nil
	case float64:
		if math.Trunc(value) != value {
			return 0, fmt.Errorf("fractional number not allowed")
		}
		return int(value), nil
	case float32:
		if math.Trunc(float64(value)) != float64(value) {
			return 0, fmt.Errorf("fractional number not allowed")
		}
		return int(value), nil
	default:
		return 0, fmt.Errorf("integer required")
	}
}

func payloadValueBool(raw any) (bool, error) {
	value, ok := raw.(bool)
	if !ok {
		return false, fmt.Errorf("boolean required")
	}
	return value, nil
}

func ensureStationDronesToCapacity(ws *model.WorldState, building *model.Building) error {
	_, err := ensureStationDronesToCapacityTracking(ws, building)
	return err
}

func ensureStationDronesToCapacityTracking(ws *model.WorldState, building *model.Building) ([]string, error) {
	if ws == nil || building == nil || building.LogisticsStation == nil {
		return nil, nil
	}
	target := building.LogisticsStation.DroneCapacityValue()
	createdDroneIDs := make([]string, 0)
	for model.StationDroneCount(ws, building.ID) < target {
		droneID := ws.NextEntityID("drone")
		drone := model.NewLogisticsDroneState(droneID, building.ID, building.Position)
		if err := model.RegisterLogisticsDrone(ws, drone); err != nil {
			return createdDroneIDs, err
		}
		createdDroneIDs = append(createdDroneIDs, droneID)
	}
	return createdDroneIDs, nil
}

func unregisterLogisticsDrones(ws *model.WorldState, droneIDs []string) {
	for _, droneID := range droneIDs {
		model.UnregisterLogisticsDrone(ws, droneID)
	}
}
