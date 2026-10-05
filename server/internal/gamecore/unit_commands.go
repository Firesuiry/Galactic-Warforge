package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// resolveCommandUnits 解析命令的目标单位集合（entity_id / entity_ids），
// 校验存在性与归属；返回可指挥的单位列表与首个错误。
func resolveCommandUnits(ws *model.WorldState, playerID string, cmd model.Command) ([]*model.Unit, *model.CommandResult) {
	ids := make([]string, 0, 1+len(cmd.Target.EntityIDs))
	if cmd.Target.EntityID != "" {
		ids = append(ids, cmd.Target.EntityID)
	}
	seen := map[string]bool{}
	for _, id := range cmd.Target.EntityIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: "target.entity_id or target.entity_ids required"}
	}
	sort.Strings(ids)
	units := make([]*model.Unit, 0, len(ids))
	for _, id := range ids {
		unit, ok := ws.Units[id]
		if !ok || unit == nil || unit.HP <= 0 {
			return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: fmt.Sprintf("unit %s not found", id)}
		}
		if unit.OwnerID != playerID {
			return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeNotOwner, Message: fmt.Sprintf("cannot command unit %s owned by another player", id)}
		}
		units = append(units, unit)
	}
	return units, nil
}

// execMove handles the "move" command for a unit
func (gc *GameCore) execMove(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	units, cmdErr := resolveCommandUnits(ws, playerID, cmd)
	if cmdErr != nil {
		return *cmdErr, nil
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
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "destination tile is occupied by a building"
		return res, nil
	}

	var events []*model.GameEvent
	moved := 0
	for _, unit := range units {
		model.SyncMechaCapabilities(unit, ws.Players[playerID])
		if unit.Mecha != nil {
			// 执行体（玩家机甲）保持近距快速机动语义：范围内瞬移（飞行/真实移动见 I16）。
			dist := ws.SurfaceDistance(unit.Position, *pos)
			if dist > unit.MoveRange {
				res.Code = model.CodeOutOfRange
				res.Message = fmt.Sprintf("move distance %d exceeds unit move range %d", dist, unit.MoveRange)
				return res, nil
			}
			path, reachable := ws.SurfacePath(unit.Position, *pos, unit.MoveRange)
			if !reachable {
				res.Code = model.CodeOutOfRange
				res.Message = "destination has no walkable surface path within move range"
				return res, nil
			}
			if failure := spendMechaEnergy(unit, (len(path)-1)*unit.Mecha.MoveEnergyCost); failure != nil {
				return *failure, nil
			}
			oldKey := model.TileKey(unit.Position.X, unit.Position.Y)
			removeUnitFromTile(ws, oldKey, unit.ID)
			oldPos := unit.Position
			unit.Position = *pos
			unit.ClearMovement()
			unit.ClearEngagement()
			unit.Stance = model.UnitStanceIdle
			ws.TileUnits[tileKey] = append(ws.TileUnits[tileKey], unit.ID)
			events = append(events, &model.GameEvent{
				EventType:       model.EvtEntityMoved,
				VisibilityScope: playerID,
				Payload: map[string]any{
					"entity_id": unit.ID,
					"from":      oldPos,
					"to":        unit.Position,
				},
			}, mechaStateEvent(unit))
			moved++
			continue
		}
		// 普通单位：实时移动（R1）——只下达路径，由 settleUnitMovement 逐 tick 推进。
		path, ok := computeUnitPath(ws, unit.Position, *pos, unit.ID)
		if !ok {
			res.Code = model.CodeOutOfRange
			res.Message = fmt.Sprintf("unit %s has no walkable surface path to destination", unit.ID)
			return res, nil
		}
		oldPos := unit.Position
		unit.Path = path
		unit.PathIndex = 1
		unit.MoveProgress = 0
		unit.BlockedTicks = 0
		unit.Stance = model.UnitStanceMoving
		unit.OrderPos = nil
		unit.GuardTargetID = ""
		unit.ClearEngagement()
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityMoved,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_id":  unit.ID,
				"from":       oldPos,
				"to":         *pos,
				"path":       path,
				"move_speed": unit.MoveSpeed,
				"stance":     unit.Stance,
			},
		})
		moved++
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("%d unit(s) moving to (%d,%d)", moved, pos.X, pos.Y)
	return res, events
}

type attackPayload struct {
	TargetEntityID string `json:"target_entity_id" payload:"required"`
}

// execAttack handles the "attack" command
func (gc *GameCore) execAttack(ws *model.WorldState, playerID string, cmd model.Command, p attackPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	attackers, cmdErr := resolveCommandUnits(ws, playerID, cmd)
	if cmdErr != nil {
		return *cmdErr, nil
	}

	targetID := p.TargetEntityID

	target := resolveCombatTarget(ws, targetID)
	if target == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("target entity %s not found", targetID)
		return res, nil
	}
	if target.ownerID == playerID {
		res.Code = model.CodeInvalidTarget
		res.Message = "cannot attack own entity"
		return res, nil
	}
	if target.ownerID != "" && sameTeam(ws, playerID, target.ownerID) {
		res.Code = model.CodeInvalidTarget
		res.Message = "cannot attack allied entity"
		return res, nil
	}

	// R2：攻击命令只指定目标；单位追击至射程内按冷却开火（settleUnitCombat）。
	var events []*model.GameEvent
	engaged := 0
	for _, attacker := range attackers {
		model.SyncMechaCapabilities(attacker, ws.Players[playerID])
		if attacker.Mecha != nil {
			// 执行体（玩家机甲）保持手动攻击语义：射程校验 + 能量消耗 + 立即一击（I16 统一）。
			dist := ws.SurfaceDistance(attacker.Position, target.pos)
			if dist > attacker.AttackRange {
				res.Code = model.CodeOutOfRange
				res.Message = fmt.Sprintf("target distance %d exceeds attack range %d", dist, attacker.AttackRange)
				return res, nil
			}
			if !unitCanTarget(attacker, target) {
				return mechaJobFailed(model.CodeInvalidTarget, "weapon cannot engage this target")
			}
			attacker.AttackTarget = targetID
			engaged++
			if attacker.LastAttackTick > 0 && ws.Tick-attacker.LastAttackTick < attacker.AttackCooldownTick {
				continue
			}
			if attacker.AmmoClass != "" && attacker.Ammo <= 0 {
				attacker.CombatState = "no_ammunition"
				continue
			}
			if failure := spendMechaEnergy(attacker, attacker.Mecha.AttackEnergyCost); failure != nil {
				return *failure, nil
			}
			consumeUnitAmmunition(attacker)
			events = append(events, fireAtTarget(ws, attacker, target)...)
			attacker.LastAttackTick = ws.Tick
			attacker.AttackTarget = targetID // 后续按冷却自动开火（settleMechaAutoFire）
			events = append(events, mechaStateEvent(attacker))
			continue
		}
		attacker.AttackTarget = targetID
		attacker.CombatAnchor = nil // 显式攻击：不受守位范围约束
		attacker.LastAttackerID = ""
		if attacker.Stance == model.UnitStanceMoving || attacker.Stance == model.UnitStanceRetreat || attacker.Stance == model.UnitStanceAttackMove || attacker.Stance == model.UnitStancePatrol {
			attacker.Stance = model.UnitStanceIdle
		}
		attacker.ClearMovement()
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityUpdated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_id":   attacker.ID,
				"entity_kind": "unit",
				"order":       "attack",
				"target_id":   targetID,
			},
		})
		engaged++
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("%d unit(s) attacking %s", engaged, targetID)
	return res, events
}

type unitOrderPayload struct {
	Order          string `json:"order" payload:"required"`
	TargetEntityID string `json:"target_entity_id"`
}

// execUnitOrder handles the "unit_order" command（R5 指令集）：
// attack_move / patrol / guard / hold / follow / retreat / stop。
func (gc *GameCore) execUnitOrder(ws *model.WorldState, playerID string, cmd model.Command, p unitOrderPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	units, cmdErr := resolveCommandUnits(ws, playerID, cmd)
	if cmdErr != nil {
		return *cmdErr, nil
	}
	order := p.Order

	var events []*model.GameEvent
	ordered := 0
	for _, unit := range units {
		// 执行体（玩家机甲）不参与部队指令集。
		if unit.Mecha != nil {
			continue
		}
		switch order {
		case "stop":
			unit.ClearMovement()
			unit.ClearEngagement()
			unit.Stance = model.UnitStanceIdle
			unit.OrderPos = nil
			unit.GuardTargetID = ""
		case "hold":
			unit.ClearMovement()
			unit.ClearEngagement()
			unit.Stance = model.UnitStanceHold
		case "attack_move", "patrol", "retreat":
			pos := cmd.Target.Position
			if pos == nil {
				res.Code = model.CodeValidationFailed
				res.Message = fmt.Sprintf("target.position required for %s", order)
				return res, nil
			}
			if !ws.InBounds(pos.X, pos.Y) {
				res.Code = model.CodeInvalidTarget
				res.Message = fmt.Sprintf("position (%d,%d) out of map bounds", pos.X, pos.Y)
				return res, nil
			}
			path, pathOK := computeUnitPath(ws, unit.Position, *pos, unit.ID)
			if !pathOK {
				res.Code = model.CodeOutOfRange
				res.Message = fmt.Sprintf("unit %s has no walkable surface path to destination", unit.ID)
				return res, nil
			}
			unit.ClearEngagement()
			unit.Path = path
			unit.PathIndex = 1
			unit.MoveProgress = 0
			unit.BlockedTicks = 0
			unit.GuardTargetID = ""
			dest := *pos
			unit.OrderPos = &dest
			switch order {
			case "attack_move":
				unit.Stance = model.UnitStanceAttackMove
				unit.CombatAnchor = nil
			case "patrol":
				unit.Stance = model.UnitStancePatrol
				anchor := unit.Position
				unit.CombatAnchor = &anchor
			case "retreat":
				unit.Stance = model.UnitStanceRetreat
				unit.CombatAnchor = nil
			}
		case "guard", "follow":
			targetID := p.TargetEntityID
			if targetID == "" {
				res.Code = model.CodeValidationFailed
				res.Message = fmt.Sprintf("payload.target_entity_id required for %s", order)
				return res, nil
			}
			friendly := resolveFriendly(ws, targetID)
			if friendly == nil {
				res.Code = model.CodeEntityNotFound
				res.Message = fmt.Sprintf("target entity %s not found", targetID)
				return res, nil
			}
			if owner := friendlyOwner(ws, targetID); owner != playerID && !sameTeam(ws, playerID, owner) {
				res.Code = model.CodeInvalidTarget
				res.Message = "can only guard/follow own or allied entity"
				return res, nil
			}
			unit.ClearMovement()
			unit.ClearEngagement()
			unit.GuardTargetID = targetID
			unit.OrderPos = nil
			if order == "guard" {
				unit.Stance = model.UnitStanceGuard
			} else {
				unit.Stance = model.UnitStanceFollow
			}
		default:
			res.Code = model.CodeValidationFailed
			res.Message = fmt.Sprintf("unknown order %q", order)
			return res, nil
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityUpdated,
			VisibilityScope: playerID,
			Payload: map[string]any{
				"entity_id":   unit.ID,
				"entity_kind": "unit",
				"order":       order,
				"stance":      unit.Stance,
			},
		})
		ordered++
	}
	if ordered == 0 {
		res.Code = model.CodeInvalidTarget
		res.Message = "no commandable units (executors do not take squad orders)"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("%d unit(s) ordered %s", ordered, order)
	return res, events
}

// friendlyOwner 返回友方目标（单位/建筑）的归属玩家。
func friendlyOwner(ws *model.WorldState, id string) string {
	if u, ok := ws.Units[id]; ok && u != nil {
		return u.OwnerID
	}
	if b, ok := ws.Buildings[id]; ok && b != nil {
		return b.OwnerID
	}
	return ""
}

// Helper: find a free adjacent tile
func findAdjacentFree(ws *model.WorldState, center model.Position) *model.Position {
	for _, next := range ws.SurfaceNeighbors(center) {
		nx, ny := next.X, next.Y
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
