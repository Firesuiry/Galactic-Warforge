package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 单位命令（move / attack / unit_order）与单位解析。

// maxMoveRouteTiles 单次 move 的路径格数上限：远距离移动一条命令下达完整路径，
// 由 settleUnitMovement 逐 tick 推进，玩家不必自己按 5–8 格分段点。
const maxMoveRouteTiles = 800

// resolveCommandUnits 解析命令的目标单位集合（entity_id / entity_ids），
// 校验存在性与归属；返回可指挥的单位列表与首个错误。
// 单位已阵亡（不在世界里）时给出明确提示，而不是裸报「未找到单位 u-7」。
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
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeValidationFailed, Message: "缺少 target.entity_id 或 target.entity_ids"}
	}
	sort.Strings(ids)
	units := make([]*model.Unit, 0, len(ids))
	for _, id := range ids {
		unit, ok := ws.Units[id]
		if !ok || unit == nil || unit.HP <= 0 {
			if msg := deadCommandTargetMessage(ws, playerID, id); msg != "" {
				return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: msg}
			}
			return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeEntityNotFound, Message: fmt.Sprintf("未找到单位（%s）", id)}
		}
		if unit.OwnerID != playerID {
			return nil, &model.CommandResult{Status: model.StatusFailed, Code: model.CodeNotOwner, Message: "不能指挥其他玩家的单位"}
		}
		units = append(units, unit)
	}
	return units, nil
}

// deadCommandTargetMessage 识别「已阵亡的己方机甲」：机甲死亡后单位从世界移除，
// 但玩家仍会继续对它下命令，这里回一句明确的复活提示。
func deadCommandTargetMessage(ws *model.WorldState, playerID, unitID string) string {
	player := ws.Players[playerID]
	if player == nil {
		return ""
	}
	exec := player.ExecutorForPlanet(ws.PlanetID)
	if exec == nil || exec.UnitID != unitID {
		return ""
	}
	if exec.RespawnAtTick > ws.Tick {
		return fmt.Sprintf("机甲已阵亡，将在 %d tick 后复活", exec.RespawnAtTick)
	}
	return "机甲已阵亡，等待复活"
}

// execMove 处理 move 命令：
//   - 目标格无需已探索（服务端是权威，按真实地形寻路）；
//   - 不再受单次移动范围限制，一条命令下达整条路径，由实时移动结算推进；
//   - 失败回执写明中文原因（不可达、目标格被占、能量不足等）。
func (gc *GameCore) execMove(ws *model.WorldState, playerID string, cmd model.Command, p noPayload) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	units, cmdErr := resolveCommandUnits(ws, playerID, cmd)
	if cmdErr != nil {
		return *cmdErr, nil
	}

	pos := cmd.Target.Position
	if pos == nil {
		res.Code = model.CodeValidationFailed
		res.Message = "move 指令缺少 target.position"
		return res, nil
	}
	if !ws.InBounds(pos.X, pos.Y) {
		res.Code = model.CodeInvalidTarget
		res.Message = fmt.Sprintf("位置 (%d,%d) 超出地图范围", pos.X, pos.Y)
		return res, nil
	}
	if _, occupied := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]; occupied {
		res.Code = model.CodePositionOccupied
		res.Message = "目标格已被建筑占用"
		return res, nil
	}

	var events []*model.GameEvent
	moved := 0
	for _, unit := range units {
		model.SyncMechaCapabilities(unit, ws.Players[playerID])
		if unit.Mecha != nil {
			mechaEvents, failure := moveMecha(ws, unit, *pos)
			if failure != nil {
				return *failure, nil
			}
			events = append(events, mechaEvents...)
			moved++
			continue
		}
		// 普通单位：实时移动（R1）——下达完整路径，由 settleUnitMovement 逐 tick 推进。
		path, ok := computeUnitPath(ws, unit.Position, *pos, unit.ID)
		if !ok {
			res.Code = model.CodeOutOfRange
			res.Message = fmt.Sprintf("%s没有通往目标的地表路径（可能有地形阻挡）", unitDisplayName(unit))
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
	res.Message = fmt.Sprintf("%d 个单位正前往 (%d,%d)", moved, pos.X, pos.Y)
	return res, events
}

// moveMecha 下达机甲（执行体）移动：机甲按实时路径逐 tick 推进，
// 不再瞬移、也不再受单次移动范围限制；起步时按整条路径一次性扣能，
// 能量不足则整条拒绝（原有语义：不允许走到一半没电）。
func moveMecha(ws *model.WorldState, unit *model.Unit, pos model.Position) ([]*model.GameEvent, *model.CommandResult) {
	fail := func(code model.ResultCode, message string) ([]*model.GameEvent, *model.CommandResult) {
		return nil, &model.CommandResult{Status: model.StatusFailed, Code: code, Message: message}
	}
	if pos == unit.Position {
		unit.ClearMovement()
		unit.Stance = model.UnitStanceIdle
		return nil, nil
	}
	if tileKey := model.TileKey(pos.X, pos.Y); ws.TileBuilding[tileKey] != "" {
		return fail(model.CodePositionOccupied, "目标格已被建筑占用")
	}
	path, ok := computeUnitPath(ws, unit.Position, pos, unit.ID)
	if !ok || len(path) < 2 {
		return fail(model.CodeOutOfRange, "没有通往目标的地表路径（可能有地形阻挡）")
	}
	if len(path) > maxMoveRouteTiles {
		return fail(model.CodeOutOfRange, fmt.Sprintf("目标过远（%d 格，单次最多 %d 格），请分几次移动", len(path)-1, maxMoveRouteTiles))
	}
	if failure := spendMechaEnergy(unit, (len(path)-1)*unit.Mecha.MoveEnergyCost); failure != nil {
		return fail(failure.Code, fmt.Sprintf("%s（本次需 %d）", failure.Message, (len(path)-1)*unit.Mecha.MoveEnergyCost))
	}
	from := unit.Position
	// 清交战但不碰 AttackTarget：moveMecha 也被「显式攻击射程外目标」复用，
	// 清掉目标会让机甲走到位后忘记要打谁（settleMechaAutoFire 靠它开火）。
	unit.AttackTarget = ""
	unit.ClearEngagement()
	unit.Path = path
	unit.PathIndex = 1
	unit.MoveProgress = 0
	unit.BlockedTicks = 0
	unit.OrderPos = nil
	unit.GuardTargetID = ""
	unit.Stance = model.UnitStanceMoving
	return []*model.GameEvent{
		{
			EventType:       model.EvtEntityMoved,
			VisibilityScope: unit.OwnerID,
			Payload: map[string]any{
				"entity_id":   unit.ID,
				"entity_kind": "unit",
				"from":        from,
				"to":          pos,
				"path":        path,
				"move_speed":  unit.MoveSpeed,
				"stance":      unit.Stance,
			},
		},
		mechaStateEvent(unit),
	}, nil
}

type attackPayload struct {
	TargetEntityID string `json:"target_entity_id" payload:"required"`
}

// execAttack 处理 attack 命令：指定攻击目标（单位 / 建筑 / 黑雾）。
// 目标在射程外时自动靠近（机甲与普通单位同一语义），进入射程后按冷却开火。
// 目标可以是敌方建筑（resolveCombatTarget 支持 unit / building / enemy_force 三类）。
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
		res.Message = "未找到攻击目标（可能已被摧毁）"
		return res, nil
	}
	if target.ownerID == playerID {
		res.Code = model.CodeInvalidTarget
		res.Message = "不能攻击己方实体"
		return res, nil
	}
	if target.ownerID != "" && sameTeam(ws, playerID, target.ownerID) {
		res.Code = model.CodeInvalidTarget
		res.Message = "不能攻击盟友实体"
		return res, nil
	}

	// 攻击命令只指定目标；单位（含机甲）追击至射程内按冷却开火（settleUnitCombat）。
	var events []*model.GameEvent
	engaged := 0
	approaching := 0
	for _, attacker := range attackers {
		model.SyncMechaCapabilities(attacker, ws.Players[playerID])
		if !unitCanTarget(attacker, target) {
			return mechaJobFailed(model.CodeInvalidTarget, "武器无法攻击该目标")
		}
		attacker.AttackTarget = targetID
		attacker.CombatAnchor = nil // 显式攻击：不受守位范围约束
		attacker.LastAttackerID = ""
		dist := ws.SurfaceDistance(attacker.Position, target.pos)

		if attacker.Mecha != nil {
			if dist > attacker.AttackRange {
				// 超出射程：机甲自动靠近（路径逐 tick 推进），进入射程后按冷却开火。
				mechaEvents, failure := moveMecha(ws, attacker, target.pos)
				if failure != nil {
					// 目标格被占/能量不足等无法直达：退化为逐 tick 的追击寻路，
					// 由 settleMechaAutoFire 在射程内开火；只有完全无路可走才报错。
					path, ok := computeUnitPath(ws, attacker.Position, target.pos, attacker.ID)
					if !ok || len(path) < 2 {
						return *failure, nil
					}
					attacker.Path, attacker.PathIndex, attacker.MoveProgress = path, 1, 0
					attacker.BlockedTicks = 0
					// 兜底路径是「逐 tick 追击」，不能沿用 moveMecha 的清交战语义：
					// 必须保留 AttackTarget，settleMechaAutoFire 才会在射程内开火。
					attacker.Stance = model.UnitStanceMoving
					mechaEvents = []*model.GameEvent{mechaStateEvent(attacker)}
				}
				events = append(events, mechaEvents...)
				approaching++
				engaged++
				continue
			}
			// 射程内：立即一击（保留原有手动攻击手感），随后按冷却自动开火。
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
			events = append(events, mechaStateEvent(attacker))
			continue
		}

		// 普通单位：射程外先追击靠近（settleUnitMovement 推进），射程内停下开火。
		// hold 姿态例外：坚守单位不接受自动靠近，只在射程内开火。
		if dist > attacker.AttackRange {
			if attacker.Stance != model.UnitStanceHold {
				chaseTarget(ws, attacker, target)
				approaching++
			}
		} else {
			attacker.ClearMovement()
		}
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
	switch {
	case engaged == 0:
		res.Message = "没有单位接受攻击指令"
	case approaching > 0:
		res.Message = fmt.Sprintf("%d 个单位正前往攻击%s", engaged, targetDisplayName(ws, target))
	default:
		res.Message = fmt.Sprintf("%d 个单位正在攻击%s", engaged, targetDisplayName(ws, target))
	}
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
				res.Message = fmt.Sprintf("%s 指令缺少 target.position", order)
				return res, nil
			}
			if !ws.InBounds(pos.X, pos.Y) {
				res.Code = model.CodeInvalidTarget
				res.Message = fmt.Sprintf("位置 (%d,%d) 超出地图范围", pos.X, pos.Y)
				return res, nil
			}
			path, pathOK := computeUnitPath(ws, unit.Position, *pos, unit.ID)
			if !pathOK {
				res.Code = model.CodeOutOfRange
				res.Message = fmt.Sprintf("%s没有通往目标的地表路径（可能有地形阻挡）", unitDisplayName(unit))
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
				res.Message = fmt.Sprintf("%s 指令缺少 payload.target_entity_id", order)
				return res, nil
			}
			friendly := resolveFriendly(ws, targetID)
			if friendly == nil {
				res.Code = model.CodeEntityNotFound
				res.Message = "未找到目标实体（可能已被摧毁）"
				return res, nil
			}
			if owner := friendlyOwner(ws, targetID); owner != playerID && !sameTeam(ws, playerID, owner) {
				res.Code = model.CodeInvalidTarget
				res.Message = "只能 guard/follow 己方或盟友实体"
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
			res.Message = fmt.Sprintf("未知指令 %q", order)
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
		res.Message = "没有可指挥的单位（机甲不接受小队指令）"
		return res, nil
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("%d 个单位已执行 %s 指令", ordered, order)
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
//
// unitSpawnRadius 生成单位时向外扩展的搜索半径：先看相邻一圈，全被占就往外扩。
// 出生点必须避开已有同层（地面/空中）单位，否则批量出厂的单位会全部落在同一格，
// 互相堵死（试玩报告 C：p2 的 22 个地面单位只占 8 格，最多 15 个挤在一格）。
const unitSpawnRadius = 8

// findUnitSpawnTile 从 center 向外逐圈找一格可站立、且没有同层存活单位的格子。
// air 为 true 时只要求界内（空中单位不受地形/建筑限制），但同样不与同层单位重叠。
// 找不到返回 nil：调用方应放弃本次生成（例如让单位留在生产队列里等下一 tick）。
func findUnitSpawnTile(ws *model.WorldState, center model.Position, air bool, maxRadius int) *model.Position {
	if ws == nil || maxRadius < 1 {
		return nil
	}
	// SurfaceDisc 按图距从内向外枚举：先相邻一圈，全占满再向外扩。
	for _, candidate := range ws.SurfaceDisc(center, maxRadius) {
		if candidate == center || !ws.InBounds(candidate.X, candidate.Y) {
			continue
		}
		if !air {
			if ws.Grid[candidate.Y][candidate.X].BuildingID != "" {
				continue
			}
			if ws.TileBuilding[model.TileKey(candidate.X, candidate.Y)] != "" {
				continue
			}
			if !ws.Grid[candidate.Y][candidate.X].Terrain.Buildable() {
				continue
			}
		}
		if tileHasLiveUnit(ws, candidate, air) {
			continue
		}
		c := candidate
		return &c
	}
	return nil
}

// tileHasLiveUnit 该格是否已有同层存活单位（空中与地面互不阻挡）。
func tileHasLiveUnit(ws *model.WorldState, pos model.Position, air bool) bool {
	for _, otherID := range ws.TileUnits[model.TileKey(pos.X, pos.Y)] {
		other := ws.Units[otherID]
		if other == nil || other.HP <= 0 {
			continue
		}
		if (other.Domain == model.UnitDomainAir) == air {
			return true
		}
	}
	return false
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
