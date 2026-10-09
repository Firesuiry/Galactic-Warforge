package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

// 自动交战结算（R2/R4）：世界单位按冷却开火、自动索敌、还击与追击。
// 目标统一为四类实体：世界单位、建筑、黑雾（EnemyForce），
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
	kind     string // "unit" | "building" | "enemy_force"
	id       string
	pos      model.Position
	ownerID  string
	unit     *model.Unit
	building *model.Building
	force    *model.EnemyForce
}

// resolveCombatTarget 按实体 ID 解析三类目标；目标不存在或已死亡返回 nil。
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
		return &unitCombatTarget{kind: "enemy_force", id: id, pos: force.Position, ownerID: model.DarkFogOwnerID, force: force}
	}
	return nil
}

// hostile 判定双方是否处于敌对（自动索敌/自动还击的口径）。
// 玩家之间按队伍敌对；黑雾与某玩家只在黑雾被该玩家激怒期间互相敌对。
func hostile(ws *model.WorldState, attackerOwner, targetOwner string) bool {
	if attackerOwner == targetOwner {
		return false
	}
	if attackerOwner == model.DarkFogOwnerID {
		return model.DarkFogHostileTo(ws, targetOwner)
	}
	if targetOwner == model.DarkFogOwnerID {
		return model.DarkFogHostileTo(ws, attackerOwner)
	}
	if targetOwner == "" {
		return false
	}
	return !sameTeam(ws, attackerOwner, targetOwner)
}

// canAttack 显式攻击口径：玩家可以随时主动攻击中立黑雾（攻击即激怒），其余同 hostile。
func canAttack(ws *model.WorldState, attackerOwner, targetOwner string) bool {
	if targetOwner == model.DarkFogOwnerID && attackerOwner != model.DarkFogOwnerID {
		return true
	}
	return hostile(ws, attackerOwner, targetOwner)
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
	if unit.Attack <= 0 {
		return resumeFormation(ws, unit)
	}
	if unit.Mecha != nil {
		// 执行体（玩家机甲）是英雄单位：不追击，空闲时只在射程内自动还击/索敌。
		return settleMechaAutoFire(ws, unit)
	}
	var events []*model.GameEvent

	target := resolveCombatTarget(ws, unit.AttackTarget)
	if target != nil && (!canAttack(ws, unit.OwnerID, target.ownerID) || !unitCanTarget(unit, target)) {
		target = nil
		unit.AttackTarget = ""
	}
	if target == nil && unit.AttackTarget != "" {
		unit.AttackTarget = ""
	}

	if target == nil {
		// 还击：最近攻击者仍存活且敌对时优先反打。
		if unit.LastAttackerID != "" && unit.Stance != model.UnitStanceRetreat && unit.Stance != model.UnitStanceMoving {
			if counter := resolveCombatTarget(ws, unit.LastAttackerID); counter != nil && unitCanTarget(unit, counter) && hostile(ws, unit.OwnerID, counter.ownerID) {
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

	if dist < unit.MinAttackRange {
		return events
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
	if !consumeUnitAmmunition(unit) {
		return events
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
		if includeBuildings && (t.unit != nil && t.unit.Type == model.UnitTypeSupplyTruck || t.building != nil && militarySupplyTarget(t.building)) {
			rank = 0
		} else {
			rank++
		}
		if !unitCanTarget(unit, t) || ws.SurfaceDistance(unit.Position, t.pos) < unit.MinAttackRange {
			return false
		}
		if rank >= bestRank {
			return false
		}
		best = t
		bestRank = rank
		return true
	}

	for _, tile := range ws.SurfaceDisc(unit.Position, maxDist) {
		for _, otherID := range ws.TileUnits[model.TileKey(tile.X, tile.Y)] {
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
			if buildingID := ws.TileBuilding[model.TileKey(tile.X, tile.Y)]; buildingID != "" {
				if b := ws.Buildings[buildingID]; b != nil && b.HP > 0 && hostile(ws, unit.OwnerID, b.OwnerID) {
					adopt(&unitCombatTarget{kind: "building", id: b.ID, pos: b.Position, ownerID: b.OwnerID, building: b}, 2)
				}
			}
		}
	}
	if bestRank == 0 {
		return best
	}
	// 黑雾强度点不在瓦片索引中，线性扫描（巢穴数量少，此处可以做精确距离比较）。
	// 只在黑雾对该玩家敌对时自动索敌巢穴（黑雾单位不以自家巢穴为目标）。
	if ws.EnemyForces != nil && hostile(ws, unit.OwnerID, model.DarkFogOwnerID) {
		bestForceDist := maxInt32
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}
			d := ws.SurfaceDistance(unit.Position, force.Position)
			if d <= maxDist && d < bestForceDist && bestRank > 1 {
				best = &unitCombatTarget{kind: "enemy_force", id: force.ID, pos: force.Position, ownerID: model.DarkFogOwnerID, force: force}
				bestRank = 1
				bestForceDist = d
			}
		}
	}
	return best
}

const maxInt32 = int(^uint32(0) >> 1)

// settleMechaAutoFire 执行体（玩家机甲）交战：
//   - 显式攻击目标：射程内持续开火（不追击）；
//   - 空闲时（无移动路径）：先还击射程内的最近攻击者，再打范围内最近的敌对目标。
//     无作业的机甲只在射程内开火、不追击（英雄单位能量经济）；
//     **手搓中的机甲会被自动防御打断**：敌对单位/建筑进入 aggro_range 就暂停手搓、
//     靠近到射程内还手，威胁消失后自动从原进度恢复手搓（试玩报告 E：手搓 30 铜块期间
//     敌军在 5 格外拆家，机甲全程不还手）。采集（mine）作业不打断——离开矿点即失效。
//     自动开火不写 AttackTarget，并保留两发的能量，避免把机甲打到无法行动。
func settleMechaAutoFire(ws *model.WorldState, unit *model.Unit) []*model.GameEvent {
	explicit := unit.AttackTarget != ""
	var target *unitCombatTarget
	if explicit {
		target = resolveCombatTarget(ws, unit.AttackTarget)
		if target == nil || !unitCanTarget(unit, target) || !canAttack(ws, unit.OwnerID, target.ownerID) {
			unit.AttackTarget = ""
			return nil
		}
		if ws.SurfaceDistance(unit.Position, target.pos) > unit.AttackRange {
			return nil
		}
	} else {
		job := unit.Mecha.Job
		// 手搓会被自动防御打断（可以靠近、暂停作业）；采集不打断（离开矿点作业即失效），
		// 但采集中的机甲仍在射程内还手。
		defending := job != nil && job.Kind == "craft"
		if !defending {
			// 只有手搓防御会占用机甲的交战锚点：作业结束/换成采集时清掉。
			unit.CombatAnchor = nil
		}
		// 防御锚点 = 第一次被打断时的位置：机甲只在这个范围内主动靠近敌人，
		// 追得太远就放弃这一目标、回去手搓（否则会被敌人一路钓走）。
		// 必须在 HasPath 早退之前判断，否则追击中的机甲永远走不到这一支。
		if defending && unit.CombatAnchor != nil &&
			ws.SurfaceDistance(unit.Position, *unit.CombatAnchor) > unit.AggroRange+leashSlack {
			unit.LastAttackerID = ""
			unit.ClearMovement()
			return resumeMechaJobAfterDefense(unit)
		}
		if unit.HasPath() {
			return nil
		}
		// 低能量时不主动交火，但必须先把被打断的手搓恢复掉，否则机甲会
		// 一直停在"暂停手搓 + 不还手"的死状态（能量耗尽后永远恢复不了）。
		if unit.Mecha.Energy < 2*unit.Mecha.AttackEnergyCost {
			return resumeMechaJobAfterDefense(unit)
		}
		scan := unit.AttackRange
		if defending {
			// 手搓被打断时按 aggro 索敌（含敌方建筑）：手搓通常发生在基地里，
			// 敌人多半在拆建筑而不是贴身，只按射程索敌等于不还手。
			scan = max(unit.AttackRange, unit.AggroRange)
		}
		if unit.LastAttackerID != "" {
			counter := resolveCombatTarget(ws, unit.LastAttackerID)
			if counter != nil && unitCanTarget(unit, counter) && hostile(ws, unit.OwnerID, counter.ownerID) &&
				ws.SurfaceDistance(unit.Position, counter.pos) <= scan {
				target = counter
			} else {
				unit.LastAttackerID = ""
			}
		}
		if target == nil {
			target = nearestHostileInRange(ws, unit, scan, defending)
		}
		if target == nil {
			return resumeMechaJobAfterDefense(unit)
		}
		dist := ws.SurfaceDistance(unit.Position, target.pos)
		if dist > unit.AttackRange {
			if !defending {
				return nil // 无作业/采集中的机甲不追击
			}
			if unit.CombatAnchor == nil {
				anchor := unit.Position
				unit.CombatAnchor = &anchor
			}
			events := pauseMechaJobForDefense(unit)
			chaseTarget(ws, unit, target)
			return events
		}
		if defending {
			// 进入射程：停下开火（保留路径会让机甲一直贴着敌人走不动）。
			unit.ClearMovement()
			if events := pauseMechaJobForDefense(unit); len(events) > 0 {
				// 本 tick 只暂停，下一 tick 起按冷却开火（暂停本身已是状态变化）。
				return events
			}
		}
	}
	if unit.LastAttackTick > 0 && ws.Tick-unit.LastAttackTick < unit.AttackCooldownTick {
		return nil
	}
	if unit.AmmoClass != "" && unit.Ammo <= 0 {
		unit.CombatState = "no_ammunition"
		return nil
	}
	if failure := spendMechaEnergy(unit, unit.Mecha.AttackEnergyCost); failure != nil {
		return nil
	}
	consumeUnitAmmunition(unit)
	events := fireAtTarget(ws, unit, target)
	unit.LastAttackTick = ws.Tick
	events = append(events, mechaStateEvent(unit))
	return events
}

// pauseMechaJobForDefense 手搓中的机甲进入自动防御时暂停手搓（保留进度与预留原料）。
// 返回状态事件（仅首次暂停时非空），让调用方知道本 tick 的状态变化。
func pauseMechaJobForDefense(unit *model.Unit) []*model.GameEvent {
	if unit == nil || unit.Mecha == nil || unit.Mecha.Job == nil || unit.Mecha.Job.Kind != "craft" {
		return nil
	}
	if unit.Mecha.Job.Paused {
		return nil
	}
	unit.Mecha.Job.Paused = true
	unit.Mecha.Job.State = "paused_defense"
	return []*model.GameEvent{mechaStateEvent(unit)}
}

// resumeMechaJobAfterDefense 威胁消失后恢复被自动防御暂停的手搓：
// 清掉防御时的追击路径与锚点，机甲回到原地继续手搓。
func resumeMechaJobAfterDefense(unit *model.Unit) []*model.GameEvent {
	if unit == nil || unit.Mecha == nil || unit.Mecha.Job == nil || !unit.Mecha.Job.Paused {
		return nil
	}
	unit.Mecha.Job.Paused = false
	unit.Mecha.Job.State = "running"
	unit.ClearMovement()
	unit.CombatAnchor = nil
	unit.ChaseGoalPos = nil
	return []*model.GameEvent{mechaStateEvent(unit)}
}

// fireAtTarget 对目标开火并结算伤害（含死亡处理与事件）。
func fireAtTarget(ws *model.WorldState, unit *model.Unit, target *unitCombatTarget) []*model.GameEvent {
	var events []*model.GameEvent
	if target.ownerID == model.DarkFogOwnerID {
		events = append(events, provokeDarkFog(ws, unit.OwnerID)...)
	}
	attack := int(float64(unit.Attack) * model.UnitAmmoDamageMultiplier(unit))
	switch target.kind {
	case "unit":
		victim := target.unit
		model.SyncMechaCapabilities(victim, ws.Players[victim.OwnerID])
		raw := max(1, attack-victim.Defense)
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
		damage := max(1, int(float64(max(1, attack-2))*model.ResolveDamageCoefficient(unit.WeaponClass, model.ArmorStructure)))
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
		damage := max(1, attack/6)
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
	}
	return events
}

// settleEnemyForceRetaliation 静态黑雾对附近玩家单位的反击。
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
				if u == nil || u.HP <= 0 || !hostile(ws, model.DarkFogOwnerID, u.OwnerID) {
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
		}
	}
	return events
}

// killUnit 统一单位死亡处理：双边战损计数（F2）、从世界移除并发阵亡事件。
func killUnit(ws *model.WorldState, unit *model.Unit, killerID, killerOwnerID, source string) []*model.GameEvent {
	recordCombatUnitKill(ws, unit.OwnerID, killerOwnerID)
	if unit.Type == model.UnitTypeExecutor {
		if player := ws.Players[unit.OwnerID]; player != nil {
			if exec := player.ExecutorForPlanet(ws.PlanetID); exec != nil && exec.UnitID == unit.ID {
				exec.RespawnAtTick = ws.Tick + model.ExecutorRespawnTicks()
				player.SetPlanetExecutor(ws.PlanetID, exec)
			}
		}
	}
	refundMechaJob(ws, unit)
	delete(ws.Units, unit.ID)
	tileKey := model.TileKey(unit.Position.X, unit.Position.Y)
	removeUnitFromTile(ws, tileKey, unit.ID)
	return []*model.GameEvent{{
		EventType:       model.EvtEntityDestroyed,
		VisibilityScope: "all",
		Payload: map[string]any{
			"entity_id":   unit.ID,
			"entity_kind": "unit",
			"entity_type": string(unit.Type),
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
			"entity_kind": "building",
			"entity_type": string(b.Type),
			"owner_id":    b.OwnerID,
			"killed_by":   killerID,
			"source":      source,
		},
	}
}

func unitCanTarget(u *model.Unit, t *unitCombatTarget) bool {
	return t.unit == nil || t.unit.Domain != model.UnitDomainAir || u.WeaponClass == model.WeaponTypeMissile
}

func militarySupplyTarget(b *model.Building) bool {
	if def, ok := model.BuildingDefinitionByID(b.Type); ok && def.SupplyRadius > 0 {
		return true
	}
	if b.Production != nil {
		if recipe, ok := model.Recipe(b.Production.RecipeID); ok {
			for _, out := range recipe.Outputs {
				if _, ok := model.AmmunitionByItem(out.ItemID); ok {
					return true
				}
			}
		}
	}
	return false
}
