package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 自动交战结算（R2/R4）：世界单位按冷却开火、自动索敌、还击与追击。
// 目标统一为四类实体：世界单位、建筑、黑雾（EnemyForce）、编组小队（CombatSquad），
// 敌方玩家与黑雾均为合法目标（PvP 与 PvE 走同一套规则）。
//
// 追击节流：chaseRepathTicks 内不重复寻路；守位/追击范围由 CombatAnchor + 脱战距离约束。

const (
	// chaseRepathTicks 追击重寻路间隔。
	chaseRepathTicks = 8
	// leashSlack 脱战距离 = AggroRange + leashSlack（以接战锚点为基准）。
	leashSlack = 6
	// enemyForceStrikeRange 静态黑雾反击范围（格）。
	enemyForceStrikeRange = 6
	// enemyForceStrikeCooldown 静态黑雾反击冷却（tick）。
	enemyForceStrikeCooldown = 10
)

// unitCombatTarget 统一的目标引用。
type unitCombatTarget struct {
	kind     string // "unit" | "building" | "enemy_force" | "combat_squad"
	id       string
	pos      model.Position
	ownerID  string
	unit     *model.Unit
	building *model.Building
	force    *model.EnemyForce
	squad    *model.CombatSquad
}

// resolveCombatTarget 按实体 ID 解析四类目标；目标不存在或已死亡返回 nil。
func resolveCombatTarget(ws *model.WorldState, id string) *unitCombatTarget {
	if id == "" {
		return nil
	}
	if u, ok := ws.Units[id]; ok && u != nil && u.HP > 0 {
		return &unitCombatTarget{kind: "unit", id: id, pos: u.Position, ownerID: u.OwnerID, unit: u}
	}
	if b, ok := ws.Buildings[id]; ok && b != nil && b.HP > 0 {
		return &unitCombatTarget{kind: "building", id: id, pos: b.Position, ownerID: b.OwnerID, building: b}
	}
	if force := findEnemyForceByID(ws, id); force != nil && force.Strength > 0 {
		return &unitCombatTarget{kind: "enemy_force", id: id, pos: force.Position, force: force}
	}
	if ws.CombatRuntime != nil {
		if squad := ws.CombatRuntime.Squads[id]; squad != nil && squad.State != model.CombatSquadStateDestroyed && squad.HP > 0 {
			return &unitCombatTarget{kind: "combat_squad", id: id, pos: squad.Position, ownerID: squad.OwnerID, squad: squad}
		}
	}
	return nil
}

// hostile 判定目标归属对攻击方是否为敌对（含黑雾与全体玩家的互相敌对）。
func hostile(ws *model.WorldState, attackerOwner, targetOwner string) bool {
	if targetOwner == "" {
		// 黑雾巢穴（EnemyForce 无归属）对所有玩家敌对——但不包括黑雾自己的单位。
		return attackerOwner != model.DarkFogOwnerID
	}
	if attackerOwner == targetOwner {
		return false
	}
	return !sameTeam(ws, attackerOwner, targetOwner)
}

// normalizeUnitCombatStats 兼容旧存档：为缺失实时战斗字段的单位补默认值。
func normalizeUnitCombatStats(u *model.Unit) {
	if u.MoveSpeed <= 0 || u.AttackCooldownTick <= 0 || u.AggroRange <= 0 || u.Stance == "" {
		base := model.UnitStats(u.Type)
		if u.MoveSpeed <= 0 {
			u.MoveSpeed = base.MoveSpeed
		}
		if u.AttackCooldownTick <= 0 {
			u.AttackCooldownTick = base.AttackCooldownTick
		}
		if u.AggroRange <= 0 {
			u.AggroRange = u.VisionRange
			if u.AggroRange <= 0 {
				u.AggroRange = base.AggroRange
			}
		}
		if u.Stance == "" {
			u.Stance = model.UnitStanceIdle
		}
		if u.ArmorClass == "" {
			u.ArmorClass = model.ArmorClassForUnitType(u.Type)
		}
		if u.WeaponClass == "" {
			u.WeaponClass = model.WeaponClassForUnitType(u.Type)
		}
	}
}

// settleUnitCombat 每 tick 结算一次世界单位交战。
func settleUnitCombat(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || len(ws.Units) == 0 {
		return nil
	}
	ids := make([]string, 0, len(ws.Units))
	for id := range ws.Units {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var events []*model.GameEvent
	for _, id := range ids {
		unit := ws.Units[id]
		if unit == nil || unit.HP <= 0 {
			continue
		}
		normalizeUnitCombatStats(unit)
		if unit.Mecha != nil {
			model.SyncMechaCapabilities(unit, ws.Players[unit.OwnerID])
		}
		events = append(events, settleOneUnitCombat(ws, unit)...)
	}

	// 静态黑雾反击（实体化黑雾单位由 E1 引入后与此并存：巢穴等静态强度点仍会还手）。
	events = append(events, settleEnemyForceRetaliation(ws)...)
	return events
}

// settleOneUnitCombat 结算单个单位的索敌、追击与开火。
func settleOneUnitCombat(ws *model.WorldState, unit *model.Unit) []*model.GameEvent {
	if unit.Mecha != nil {
		// 执行体（玩家机甲）是英雄单位：不自动索敌不还击，只对显式目标持续开火，
		// 保持玩家对能量经济的掌控（I16 前沿用此边界）。
		return settleMechaAutoFire(ws, unit)
	}
	var events []*model.GameEvent

	target := resolveCombatTarget(ws, unit.AttackTarget)
	if target != nil && !hostile(ws, unit.OwnerID, target.ownerID) {
		target = nil
		unit.AttackTarget = ""
	}
	if target == nil && unit.AttackTarget != "" {
		unit.AttackTarget = ""
	}

	if target == nil {
		// 还击：最近攻击者仍存活且敌对时优先反打。
		if unit.LastAttackerID != "" && unit.Stance != model.UnitStanceRetreat && unit.Stance != model.UnitStanceMoving {
			if counter := resolveCombatTarget(ws, unit.LastAttackerID); counter != nil && hostile(ws, unit.OwnerID, counter.ownerID) {
				if unit.Stance != model.UnitStanceHold || ws.SurfaceDistance(unit.Position, counter.pos) <= unit.AttackRange {
					target = counter
					unit.AttackTarget = counter.id
					if unit.CombatAnchor == nil {
						anchor := unit.Position
						unit.CombatAnchor = &anchor
					}
				}
			} else {
				unit.LastAttackerID = ""
			}
		}
	}
	if target == nil {
		target = autoAcquireTarget(ws, unit)
		if target != nil {
			unit.AttackTarget = target.id
			if unit.CombatAnchor == nil {
				anchor := unit.Position
				unit.CombatAnchor = &anchor
			}
		}
	}

	if target == nil {
		// 无目标：按姿态恢复队形（攻击移动/巡逻继续赶路，守卫/跟随贴近目标）。
		events = append(events, resumeFormation(ws, unit)...)
		return events
	}

	// 脱战：以接战锚点为基准的守位/追击范围。
	if unit.CombatAnchor != nil && unit.Stance != model.UnitStanceHold {
		leash := unit.AggroRange + leashSlack
		anchor := *unit.CombatAnchor
		if unit.Stance == model.UnitStanceGuard {
			if gt := resolveFriendly(ws, unit.GuardTargetID); gt != nil {
				anchor = gt.pos
			}
		}
		if ws.SurfaceDistance(unit.Position, anchor) > leash || ws.SurfaceDistance(target.pos, anchor) > leash*2 {
			unit.AttackTarget = ""
			unit.LastAttackerID = ""
			events = append(events, resumeFormation(ws, unit)...)
			return events
		}
	}

	dist := ws.SurfaceDistance(unit.Position, target.pos)
	if dist > unit.AttackRange {
		if unit.Stance == model.UnitStanceHold {
			// 原地坚守：不追击，等目标进入射程。
			return events
		}
		// 免费换目标：射程内已有其他敌对目标时原地开火，不再追远。
		if closer := nearestHostileInRange(ws, unit, unit.AttackRange, unit.Stance == model.UnitStanceAttackMove); closer != nil && closer.id != target.id {
			unit.AttackTarget = closer.id
			unit.ChaseGoalPos = nil
			target = closer
			dist = ws.SurfaceDistance(unit.Position, target.pos)
		} else {
			chaseTarget(ws, unit, target)
			return events
		}
	}

	// 进入射程：停下追击，按冷却开火（LastAttackTick==0 视为就绪）。
	if unit.HasPath() && (unit.AttackTarget == target.id) {
		unit.ClearMovement()
	}
	if unit.LastAttackTick > 0 && ws.Tick-unit.LastAttackTick < unit.AttackCooldownTick {
		return events
	}
	if unit.Mecha != nil {
		if failure := spendMechaEnergy(unit, unit.Mecha.AttackEnergyCost); failure != nil {
			return events
		}
	}
	events = append(events, fireAtTarget(ws, unit, target)...)
	unit.LastAttackTick = ws.Tick
	return events
}

// chaseTarget 向目标寻路追击（节流）。
func chaseTarget(ws *model.WorldState, unit *model.Unit, target *unitCombatTarget) {
	if unit.HasPath() && ws.Tick-unit.RepathTick < chaseRepathTicks {
		return
	}
	path, ok := computeUnitPath(ws, unit.Position, target.pos, unit.ID)
	if !ok {
		return
	}
	unit.Path = path
	unit.PathIndex = 1
	unit.MoveProgress = 0
	unit.RepathTick = ws.Tick
}

// resumeFormation 无目标时的姿态恢复：攻击移动/巡逻继续赶路，守卫/跟随贴近目标，脱战回锚点。
func resumeFormation(ws *model.WorldState, unit *model.Unit) []*model.GameEvent {
	switch unit.Stance {
	case model.UnitStanceAttackMove:
		if unit.OrderPos != nil && !unit.HasPath() && ws.SurfaceDistance(unit.Position, *unit.OrderPos) > 0 {
			if path, ok := computeUnitPath(ws, unit.Position, *unit.OrderPos, unit.ID); ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
				unit.MoveProgress = 0
			} else {
				unit.Stance = model.UnitStanceIdle
				unit.ClearMovement()
			}
		}
	case model.UnitStancePatrol:
		if unit.OrderPos != nil && !unit.HasPath() && ws.SurfaceDistance(unit.Position, *unit.OrderPos) > 0 {
			if path, ok := computeUnitPath(ws, unit.Position, *unit.OrderPos, unit.ID); ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
				unit.MoveProgress = 0
			}
		}
	case model.UnitStanceGuard, model.UnitStanceFollow:
		gt := resolveFriendly(ws, unit.GuardTargetID)
		if gt == nil {
			unit.Stance = model.UnitStanceIdle
			unit.GuardTargetID = ""
			unit.ClearMovement()
			return nil
		}
		keep := 3
		if unit.Stance == model.UnitStanceFollow {
			keep = 2
		}
		if ws.SurfaceDistance(unit.Position, gt.pos) > keep && (!unit.HasPath() || ws.Tick-unit.RepathTick >= chaseRepathTicks) {
			if path, ok := computeUnitPath(ws, unit.Position, gt.pos, unit.ID); ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
				unit.MoveProgress = 0
				unit.RepathTick = ws.Tick
			}
		}
	case model.UnitStanceIdle:
		// 脱战后返回接战锚点。
		if unit.CombatAnchor != nil && !unit.HasPath() && ws.SurfaceDistance(unit.Position, *unit.CombatAnchor) > 2 {
			if path, ok := computeUnitPath(ws, unit.Position, *unit.CombatAnchor, unit.ID); ok && len(path) > 1 {
				unit.Path = path
				unit.PathIndex = 1
				unit.MoveProgress = 0
			}
			unit.CombatAnchor = nil
		} else if unit.CombatAnchor != nil && ws.SurfaceDistance(unit.Position, *unit.CombatAnchor) <= 2 {
			unit.CombatAnchor = nil
		}
	}
	return nil
}

// friendlyTargetRef 友方目标引用（守卫/跟随）。
type friendlyTargetRef struct {
	pos model.Position
}

// resolveFriendly 解析友方单位或建筑；黑雾巢穴（EnemyForce）也可作为锚点——
// 巢穴守军（E4）以 guard 姿态把 GuardTargetID 锚在巢位上。
func resolveFriendly(ws *model.WorldState, id string) *friendlyTargetRef {
	if id == "" {
		return nil
	}
	if u, ok := ws.Units[id]; ok && u != nil && u.HP > 0 {
		return &friendlyTargetRef{pos: u.Position}
	}
	if b, ok := ws.Buildings[id]; ok && b != nil && b.HP > 0 {
		return &friendlyTargetRef{pos: b.Position}
	}
	if force := findEnemyForceByID(ws, id); force != nil && force.Strength > 0 {
		return &friendlyTargetRef{pos: force.Position}
	}
	return nil
}

// autoAcquireTarget 按姿态自动索敌：单位/小队优先，其次黑雾，最后建筑（仅攻击移动）。
func autoAcquireTarget(ws *model.WorldState, unit *model.Unit) *unitCombatTarget {
	switch unit.Stance {
	case model.UnitStanceRetreat, model.UnitStanceMoving:
		return nil
	case model.UnitStanceHold:
		// 坚守只打射程内目标。
		return nearestHostileInRange(ws, unit, unit.AttackRange, false)
	}
	return nearestHostileInRange(ws, unit, unit.AggroRange, unit.Stance == model.UnitStanceAttackMove)
}

// nearestHostileInRange 扫描范围内最近的敌对目标。
// 性能：SurfaceDisc 按 BFS 环带（= 图距离序）枚举候选，每个优先级命中的
// 第一个候选即最近者，全程不做跨面 A* 距离计算——大军对垒时这是数量级差异。
func nearestHostileInRange(ws *model.WorldState, unit *model.Unit, maxDist int, includeBuildings bool) *unitCombatTarget {
	var best *unitCombatTarget
	bestRank := 99

	adopt := func(t *unitCombatTarget, rank int) bool {
		if rank >= bestRank {
			return false
		}
		best = t
		bestRank = rank
		return true
	}

	for _, tile := range ws.SurfaceDisc(unit.Position, maxDist) {
		key := model.TileKey(tile.X, tile.Y)
		for _, otherID := range ws.TileUnits[key] {
			other := ws.Units[otherID]
			if other == nil || other.HP <= 0 || other.ID == unit.ID {
				continue
			}
			if !hostile(ws, unit.OwnerID, other.OwnerID) {
				continue
			}
			adopt(&unitCombatTarget{kind: "unit", id: other.ID, pos: other.Position, ownerID: other.OwnerID, unit: other}, 0)
		}
		if bestRank == 0 {
			break // 已找到最近的最高优先级目标
		}
		if includeBuildings {
			if buildingID := ws.TileBuilding[key]; buildingID != "" {
				if b := ws.Buildings[buildingID]; b != nil && b.HP > 0 && hostile(ws, unit.OwnerID, b.OwnerID) {
					adopt(&unitCombatTarget{kind: "building", id: b.ID, pos: b.Position, ownerID: b.OwnerID, building: b}, 2)
				}
			}
		}
		if ws.CombatRuntime != nil {
			for _, squad := range ws.CombatRuntime.Squads {
				if squad == nil || squad.State == model.CombatSquadStateDestroyed || squad.HP <= 0 {
					continue
				}
				if squad.Position.X == tile.X && squad.Position.Y == tile.Y && hostile(ws, unit.OwnerID, squad.OwnerID) {
					adopt(&unitCombatTarget{kind: "combat_squad", id: squad.ID, pos: squad.Position, ownerID: squad.OwnerID, squad: squad}, 0)
				}
			}
		}
	}
	if bestRank == 0 {
		return best
	}
	// 黑雾强度点不在瓦片索引中，线性扫描（巢穴数量少，此处可以做精确距离比较）。
	// 黑雾单位不以自家巢穴为目标。
	if ws.EnemyForces != nil && unit.OwnerID != model.DarkFogOwnerID {
		bestForceDist := maxInt32
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}
			d := ws.SurfaceDistance(unit.Position, force.Position)
			if d <= maxDist && d < bestForceDist && bestRank > 1 {
				best = &unitCombatTarget{kind: "enemy_force", id: force.ID, pos: force.Position, force: force}
				bestRank = 1
				bestForceDist = d
			}
		}
	}
	return best
}

const maxInt32 = int(^uint32(0) >> 1)

// squadArmorClass 小队护甲，委托 model.BlueprintCombatClasses（与目录同源）。
func squadArmorClass(squad *model.CombatSquad) model.ArmorClass {
	if squad == nil {
		return model.ArmorHeavy
	}
	armor, _ := model.BlueprintCombatClasses(
		model.UnitRuntimeClassCombatSquad,
		squad.Domain,
		squad.PlatformClass,
		squad.BlueprintID,
	)
	if armor == "" {
		return model.ArmorHeavy
	}
	return armor
}

// settleMechaAutoFire 执行体对显式攻击目标的持续开火（不索敌、不追击、不还击）。
func settleMechaAutoFire(ws *model.WorldState, unit *model.Unit) []*model.GameEvent {
	if unit.AttackTarget == "" {
		return nil
	}
	target := resolveCombatTarget(ws, unit.AttackTarget)
	if target == nil || (target.ownerID != "" && !hostile(ws, unit.OwnerID, target.ownerID)) {
		unit.AttackTarget = ""
		return nil
	}
	if ws.SurfaceDistance(unit.Position, target.pos) > unit.AttackRange {
		return nil
	}
	if unit.LastAttackTick > 0 && ws.Tick-unit.LastAttackTick < unit.AttackCooldownTick {
		return nil
	}
	if failure := spendMechaEnergy(unit, unit.Mecha.AttackEnergyCost); failure != nil {
		return nil
	}
	events := fireAtTarget(ws, unit, target)
	unit.LastAttackTick = ws.Tick
	events = append(events, mechaStateEvent(unit))
	return events
}

// fireAtTarget 对目标开火并结算伤害（含死亡处理与事件）。
func fireAtTarget(ws *model.WorldState, unit *model.Unit, target *unitCombatTarget) []*model.GameEvent {
	var events []*model.GameEvent
	switch target.kind {
	case "unit":
		victim := target.unit
		model.SyncMechaCapabilities(victim, ws.Players[victim.OwnerID])
		normalizeUnitCombatStats(victim)
		raw := max(1, unit.Attack-victim.Defense)
		raw = max(1, int(float64(raw)*model.ResolveDamageCoefficient(unit.WeaponClass, victim.ArmorClass)))
		damage, absorbed := model.ApplyUnitDamage(victim, raw, ws.Tick)
		victim.LastAttackerID = unit.ID
		if victim.Mecha != nil {
			events = append(events, mechaStateEvent(victim))
		}
		for _, scope := range []string{unit.OwnerID, victim.OwnerID} {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: scope,
				Payload: map[string]any{
					"attacker_id":     unit.ID,
					"attacker_type":   "unit",
					"target_id":       victim.ID,
					"target_type":     "unit",
					"damage":          damage,
					"target_hp":       victim.HP,
					"shield_absorbed": absorbed,
				},
			})
		}
		if victim.HP <= 0 {
			events = append(events, killUnit(ws, victim, unit.ID, unit.OwnerID, "unit")...)
		}
	case "building":
		b := target.building
		damage := max(1, int(float64(max(1, unit.Attack-2))*model.ResolveDamageCoefficient(unit.WeaponClass, model.ArmorStructure)))
		// 行星护盾吸收外部伤害（含黑雾与 PvP，U4 方向）。
		shieldAbsorbed, remaining := absorbPlanetaryShieldDamage(ws, b.OwnerID, damage)
		shieldRemaining := totalPlanetaryShieldCharge(ws, b.OwnerID)
		damage = remaining
		b.HP -= damage
		for _, scope := range []string{unit.OwnerID, b.OwnerID} {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: scope,
				Payload: map[string]any{
					"attacker_id":      unit.ID,
					"attacker_type":    "unit",
					"target_id":        b.ID,
					"target_type":      "building",
					"damage":           damage,
					"target_hp":        b.HP,
					"shield_absorbed":  shieldAbsorbed,
					"shield_remaining": shieldRemaining,
				},
			})
		}
		if b.HP <= 0 {
			events = append(events, destroyBuildingCombat(ws, b, unit.ID, unit.OwnerID, "unit"))
		}
	case "enemy_force":
		force := target.force
		strengthBefore := force.Strength
		damage := max(1, unit.Attack/6)
		force.Strength -= damage
		if force.Strength < 0 {
			force.Strength = 0
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: unit.OwnerID,
			Payload: map[string]any{
				"attacker_id":        unit.ID,
				"attacker_type":      "unit",
				"target_id":          force.ID,
				"target_type":        "enemy_force",
				"damage":             damage,
				"remaining_strength": force.Strength,
			},
		})
		if force.Strength <= 0 {
			events = append(events, destroyEnemyForce(ws, force, strengthBefore, unit.ID, unit.OwnerID, "unit", nil)...)
			unit.AttackTarget = ""
		}
	case "combat_squad":
		squad := target.squad
		damage := max(1, int(float64(unit.Attack)*model.ResolveDamageCoefficient(unit.WeaponClass, squadArmorClass(squad))))
		if squad.Shield.Level > 0 {
			damage = squad.Shield.ApplyShieldDamage(damage)
			squad.Shield.LastHitTick = ws.Tick
		}
		losses := squad.ApplySquadDamage(max(1, damage))
		for _, scope := range []string{unit.OwnerID, squad.OwnerID} {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: scope,
				Payload: map[string]any{
					"attacker_id":   unit.ID,
					"attacker_type": "unit",
					"target_id":     squad.ID,
					"target_type":   "combat_squad",
					"damage":        damage,
					"target_hp":     squad.HP,
					"squad_count":   squad.Count,
					"squad_losses":  losses,
				},
			})
		}
		if squad.HP <= 0 {
			events = append(events, destroySquad(ws, squad, unit.ID, unit.OwnerID, "unit")...)
			unit.AttackTarget = ""
		}
	}
	return events
}

// settleEnemyForceRetaliation 静态黑雾对附近玩家单位/小队的反击。
func settleEnemyForceRetaliation(ws *model.WorldState) []*model.GameEvent {
	if ws.EnemyForces == nil || len(ws.EnemyForces.Forces) == 0 {
		return nil
	}
	var events []*model.GameEvent
	for i := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[i]
		if force.Strength <= 0 {
			continue
		}
		if ws.Tick-force.LastAttackTick < enemyForceStrikeCooldown {
			continue
		}
		var victim *model.Unit
		for _, tile := range ws.SurfaceDisc(force.Position, enemyForceStrikeRange) {
			for _, unitID := range ws.TileUnits[model.TileKey(tile.X, tile.Y)] {
				u := ws.Units[unitID]
				if u == nil || u.HP <= 0 || u.OwnerID == model.DarkFogOwnerID {
					continue
				}
				victim = u
				break
			}
			if victim != nil {
				break
			}
		}
		if victim != nil {
			force.LastAttackTick = ws.Tick
			damage := max(1, force.Strength/4)
			model.SyncMechaCapabilities(victim, ws.Players[victim.OwnerID])
			hpDamage, absorbed := model.ApplyUnitDamage(victim, max(1, damage-victim.Defense), ws.Tick)
			victim.LastAttackerID = force.ID
			if victim.Mecha != nil {
				events = append(events, mechaStateEvent(victim))
			}
			events = append(events, &model.GameEvent{
				EventType:       model.EvtDamageApplied,
				VisibilityScope: victim.OwnerID,
				Payload: map[string]any{
					"attacker_id":     force.ID,
					"attacker_type":   "enemy_force",
					"target_id":       victim.ID,
					"target_type":     "unit",
					"damage":          hpDamage,
					"target_hp":       victim.HP,
					"shield_absorbed": absorbed,
				},
			})
			if victim.HP <= 0 {
				events = append(events, killUnit(ws, victim, force.ID, model.DarkFogOwnerID, "enemy_force")...)
			}
			continue
		}
		// 无单位目标时打小队。
		if ws.CombatRuntime != nil {
			var targetSquad *model.CombatSquad
			squadDist := maxInt32
			for _, squad := range ws.CombatRuntime.Squads {
				if squad == nil || squad.State == model.CombatSquadStateDestroyed || squad.HP <= 0 {
					continue
				}
				d := ws.SurfaceDistance(force.Position, squad.Position)
				if d <= enemyForceStrikeRange && d < squadDist {
					targetSquad = squad
					squadDist = d
				}
			}
			if targetSquad != nil {
				force.LastAttackTick = ws.Tick
				damage := max(1, force.Strength/4)
				if targetSquad.Shield.Level > 0 {
					damage = targetSquad.Shield.ApplyShieldDamage(damage)
					targetSquad.Shield.LastHitTick = ws.Tick
				}
				losses := targetSquad.ApplySquadDamage(max(1, damage))
				events = append(events, &model.GameEvent{
					EventType:       model.EvtDamageApplied,
					VisibilityScope: targetSquad.OwnerID,
					Payload: map[string]any{
						"attacker_id":   force.ID,
						"attacker_type": "enemy_force",
						"target_id":     targetSquad.ID,
						"target_type":   "combat_squad",
						"damage":        damage,
						"target_hp":     targetSquad.HP,
						"squad_count":   targetSquad.Count,
						"squad_losses":  losses,
					},
				})
				if targetSquad.HP <= 0 {
					events = append(events, destroySquad(ws, targetSquad, force.ID, model.DarkFogOwnerID, "enemy_force")...)
				}
			}
		}
	}
	return events
}

// killUnit 统一单位死亡处理：双边战损计数（F2）、从世界移除并发阵亡事件。
func killUnit(ws *model.WorldState, unit *model.Unit, killerID, killerOwnerID, source string) []*model.GameEvent {
	recordCombatUnitKill(ws, unit.OwnerID, killerOwnerID)
	refundMechaJob(ws, unit)
	delete(ws.Units, unit.ID)
	tileKey := model.TileKey(unit.Position.X, unit.Position.Y)
	removeUnitFromTile(ws, tileKey, unit.ID)
	return []*model.GameEvent{{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_id":   unit.ID,
			"entity_type": "unit",
			"owner_id":    unit.OwnerID,
			"killed_by":   killerID,
			"source":      source,
		},
	}}
}

// destroyBuildingCombat 统一战斗拆毁建筑的处理（含双边战损计数，F2）。
func destroyBuildingCombat(ws *model.WorldState, b *model.Building, killerID, killerOwnerID, source string) *model.GameEvent {
	recordCombatBuildingKill(ws, b.OwnerID, killerOwnerID)
	delete(ws.Buildings, b.ID)
	ws.UnindexBuilding(b)
	detachStationFleet(ws, b.ID)
	model.UnregisterLogisticsStation(ws, b.ID)
	model.UnregisterPowerGridBuilding(ws, b.ID)
	return &model.GameEvent{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_id":   b.ID,
			"entity_type": "building",
			"owner_id":    b.OwnerID,
			"killed_by":   killerID,
			"source":      source,
		},
	}
}

// destroySquad 小队全灭：双边战损计数（整编计 1 个单位，F2）、从运行时移除并发事件（R3）。
func destroySquad(ws *model.WorldState, squad *model.CombatSquad, killerID, killerOwnerID, source string) []*model.GameEvent {
	recordCombatUnitKill(ws, squad.OwnerID, killerOwnerID)
	squad.State = model.CombatSquadStateDestroyed
	squad.Count = 0
	if ws.CombatRuntime != nil {
		delete(ws.CombatRuntime.Squads, squad.ID)
	}
	return []*model.GameEvent{{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_id":   squad.ID,
			"entity_type": "combat_squad",
			"owner_id":    squad.OwnerID,
			"killed_by":   killerID,
			"source":      source,
		},
	}}
}
