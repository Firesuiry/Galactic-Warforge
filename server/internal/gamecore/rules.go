package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

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

	// Check tile is unoccupied
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "tile is already occupied by a building"
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
	switch btype {
	case model.BuildingTypeMine, model.BuildingTypeSolarPlant, model.BuildingTypeFactory, model.BuildingTypeTurret:
	default:
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("unknown building type: %s", btype)
		return res, nil
	}

	// Check resource cost
	mCost, eCost := model.BuildingCost(btype)
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

	// Deduct resources
	player.Resources.Minerals -= mCost
	player.Resources.Energy -= eCost

	// Create building
	stats := model.BuildingStats(btype, 1)
	id := ws.NextEntityID("b")
	b := &model.Building{
		ID:            id,
		Type:          btype,
		OwnerID:       playerID,
		Position:      *pos,
		HP:            stats.HP,
		MaxHP:         stats.MaxHP,
		Level:         1,
		VisionRange:   stats.VisionRange,
		MineralRate:   stats.MineralRate,
		EnergyRate:    stats.EnergyRate,
		EnergyConsume: stats.EnergyConsume,
		Attack:        stats.Attack,
		AttackRange:   stats.AttackRange,
		IsActive:      true,
	}
	ws.Buildings[id] = b
	ws.TileBuilding[tileKey] = id
	ws.Grid[pos.Y][pos.X].BuildingID = id

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_type": "building",
				"entity_id":   id,
				"building":    b,
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("building %s created at (%d,%d)", id, pos.X, pos.Y)
	return res, events
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

// execProduce handles the "produce" command to create units at a factory
func (gc *GameCore) execProduce(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	factoryID := cmd.Target.EntityID
	if factoryID == "" {
		res.Code = model.CodeValidationFailed
		res.Message = "target.entity_id (factory) required"
		return res, nil
	}

	building, ok := ws.Buildings[factoryID]
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", factoryID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if building.Type != model.BuildingTypeFactory {
		res.Code = model.CodeInvalidTarget
		res.Message = "can only produce units at a factory"
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

	// Find a free adjacent tile near factory
	spawnPos := findAdjacentFree(ws, building.Position)
	if spawnPos == nil {
		res.Code = model.CodePositionOccupied
		res.Message = "no free tile adjacent to factory"
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

	mCost, eCost := model.BuildingCost(building.Type)
	upgradeCostM := mCost * building.Level
	upgradeCostE := eCost * building.Level

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

	player.Resources.Minerals -= upgradeCostM
	player.Resources.Energy -= upgradeCostE
	building.Level++

	newStats := model.BuildingStats(building.Type, building.Level)
	building.MaxHP = newStats.MaxHP
	if building.HP > building.MaxHP {
		building.HP = building.MaxHP
	}
	building.MineralRate = newStats.MineralRate
	building.EnergyRate = newStats.EnergyRate
	building.EnergyConsume = newStats.EnergyConsume
	building.Attack = newStats.Attack
	building.AttackRange = newStats.AttackRange
	building.VisionRange = newStats.VisionRange

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("building %s upgraded to level %d", entityID, building.Level)
	return res, nil
}

// execDemolish handles demolishing a building
func (gc *GameCore) execDemolish(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

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
	if building.Type == model.BuildingTypeBase {
		res.Code = model.CodeInvalidTarget
		res.Message = "cannot demolish your own base"
		return res, nil
	}

	// Refund 50% of resources
	mCost, eCost := model.BuildingCost(building.Type)
	player := ws.Players[playerID]
	player.Resources.Minerals += mCost / 2 * building.Level
	player.Resources.Energy += eCost / 2 * building.Level

	delete(ws.Buildings, entityID)
	tileKey := model.TileKey(building.Position.X, building.Position.Y)
	delete(ws.TileBuilding, tileKey)
	ws.Grid[building.Position.Y][building.Position.X].BuildingID = ""

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityDestroyed,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_id":   entityID,
				"entity_type": "building",
				"owner_id":    playerID,
				"reason":      "demolish",
			},
		},
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("building %s demolished", entityID)
	return res, events
}

// settleResources produces/consumes resources for all buildings each tick
func settleResources(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	for _, b := range ws.Buildings {
		player := ws.Players[b.OwnerID]
		if player == nil || !player.IsAlive {
			continue
		}

		if !b.IsActive {
			continue
		}

		// Check energy availability for energy-consuming buildings
		if b.EnergyConsume > 0 && player.Resources.Energy < b.EnergyConsume {
			b.IsActive = false
			continue
		}

		oldM := player.Resources.Minerals
		oldE := player.Resources.Energy

		player.Resources.Energy -= b.EnergyConsume
		player.Resources.Minerals += b.MineralRate
		player.Resources.Energy += b.EnergyRate

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

	return events
}

// settleTurrets - turrets auto-attack enemies in range
func settleTurrets(ws *model.WorldState) []*model.GameEvent {
	var events []*model.GameEvent

	for _, turret := range ws.Buildings {
		if turret.Type != model.BuildingTypeTurret || !turret.IsActive {
			continue
		}
		// Find enemy units in range
		for _, unit := range ws.Units {
			if unit.OwnerID == turret.OwnerID {
				continue
			}
			dist := model.ManhattanDist(turret.Position, unit.Position)
			if dist > turret.AttackRange {
				continue
			}
			damage := max(1, turret.Attack-unit.Defense)
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
			break // one attack per turret per tick
		}
	}

	return events
}

// checkVictory determines if a player has won (elimination: opponent lost base)
func checkVictory(ws *model.WorldState) string {
	playerBases := make(map[string]bool)
	for _, b := range ws.Buildings {
		if b.Type == model.BuildingTypeBase {
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

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
