package gamecore

import (
	"math"
	"sort"

	"siliconworld/internal/model"
)

const (
	// FleetTransitTicks is the fixed tick cost of an inter-system jump (tunable).
	FleetTransitTicks int64 = 10
	// fleetLaneNeighborCount mirrors the starmap lane rule (k nearest neighbors).
	fleetLaneNeighborCount = 2
)

// settleFleetTransit advances in-flight fleet jumps: each tick decrements the
// remaining counter; on zero the fleet relocates to its target system bucket,
// transit clears, and fleet_arrived fires. Transit fleets keep State idle and
// stay in their origin system bucket until arrival, but are excluded from
// orbital-superiority scoring (mid-jump fleets fight in no system's battle).
func settleFleetTransit(spaceRuntime *model.SpaceRuntimeState) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}

	var events []*model.GameEvent
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			var arrived []*model.SpaceFleet
			for _, fleet := range systemRuntime.Fleets {
				if fleet == nil || fleet.Transit == nil {
					continue
				}
				fleet.Transit.RemainingTicks--
				if fleet.Transit.RemainingTicks > 0 {
					continue
				}
				arrived = append(arrived, fleet)
			}
			for _, fleet := range arrived {
				transit := fleet.Transit
				delete(systemRuntime.Fleets, fleet.ID)
				targetRuntime := spaceRuntime.EnsurePlayerSystem(fleet.OwnerID, transit.TargetSystemID)
				if targetRuntime == nil {
					continue
				}
				fleet.SystemID = transit.TargetSystemID
				fleet.Transit = nil
				targetRuntime.Fleets[fleet.ID] = fleet
				events = append(events, &model.GameEvent{
					EventType:       model.EvtFleetArrived,
					VisibilityScope: fleet.OwnerID,
					Payload: map[string]any{
						"fleet_id":       fleet.ID,
						"system_id":      fleet.SystemID,
						"from_system_id": transit.FromSystemID,
					},
				})
			}
		}
	}
	return events
}

func settleCombatRuntime(ws *model.WorldState, currentTick int64) []*model.GameEvent {
	if ws == nil || ws.CombatRuntime == nil {
		return nil
	}

	var events []*model.GameEvent
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	squadIDs := make([]string, 0, len(ws.CombatRuntime.Squads))
	for id := range ws.CombatRuntime.Squads {
		squadIDs = append(squadIDs, id)
	}
	sort.Strings(squadIDs)
	for _, id := range squadIDs {
		squad := ws.CombatRuntime.Squads[id]
		if squad == nil || squad.State == model.CombatSquadStateDestroyed {
			continue
		}
		normalizeSquadCombatStats(ws, squad)
		player := ws.Players[squad.OwnerID]
		taskForce := model.FindWarTaskForceByMember(player, model.WarTaskForceMemberKindSquad, squad.ID)
		profile := defaultSquadTaskForceProfile(taskForce)
		status := model.WarCommandCapacityStatus{}
		if taskForce != nil {
			status = model.EvaluateWarTaskForce(player, taskForce, worlds, nil)
		}
		if squad.Sustainment.RetreatRecommended || shouldRetreatSquad(squad, profile) {
			squad.State = model.CombatSquadStateIdle
			squad.TargetEnemyID = ""
			continue
		}

		// 移动指令：特遣队部署位置即目的地（R3/R5 编组移动）。
		if taskForce != nil && taskForce.Deployment != nil && taskForce.Deployment.Position != nil {
			dest := *taskForce.Deployment.Position
			if ws.SurfaceDistance(squad.Position, dest) > 2 && (!squad.HasPath() || currentTick-squad.RepathTick >= chaseRepathTicks) {
				if path, ok := computeSurfacePath(ws, squad.Position, dest); ok && len(path) > 1 {
					squad.Path = path
					squad.PathIndex = 1
					squad.MoveProgress = 0
					squad.RepathTick = currentTick
				}
			}
		}

		anchor := squad.Position
		maxDistance := penalizedEngagementDistance(profile.MaxEngagementDistance, status)
		target := selectSquadCombatTarget(ws, squad, anchor, profile, maxDistance)
		if target == nil {
			squad.State = model.CombatSquadStateIdle
			squad.TargetEnemyID = ""
			continue
		}
		if attackDelayed(currentTick, squad.LastAttackTick, status.DelayPenalty) {
			continue
		}
		if attackBlockedBySustainment(&squad.Sustainment) {
			squad.State = model.CombatSquadStateIdle
			continue
		}

		// 射程约束（R3）：超出武器射程时按追击策略逼近或放弃。
		if dist := ws.SurfaceDistance(squad.Position, target.pos); dist > int(squad.Weapon.Range) {
			if profile.Pursue {
				squad.TargetEnemyID = target.id
				squad.State = model.CombatSquadStateEngaging
				if !squad.HasPath() || currentTick-squad.RepathTick >= chaseRepathTicks {
					if path, ok := computeSurfacePath(ws, squad.Position, target.pos); ok && len(path) > 1 {
						squad.Path = path
						squad.PathIndex = 1
						squad.MoveProgress = 0
						squad.RepathTick = currentTick
					}
				}
			}
			if !profile.Pursue {
				squad.State = model.CombatSquadStateIdle
				squad.TargetEnemyID = ""
			}
			continue
		}

		damage := squad.Weapon.Damage * max(1, squad.AliveCount())
		damage = applyTaskForceDamagePenalty(damage, profile, status)
		damage = int(float64(damage) * sustainmentDamageMultiplier(&squad.Sustainment))
		if damage <= 0 {
			continue
		}
		squad.TargetEnemyID = target.id
		squad.State = model.CombatSquadStateEngaging
		squad.LastAttackTick = currentTick
		settleAttackConsumption(&squad.Sustainment, squad.Weapon, currentTick)
		rechargeShieldWithSustainment(&squad.Shield, &squad.Sustainment, currentTick)

		events = append(events, applySquadDamageToTarget(ws, squad, target, damage, currentTick)...)
		if target.kind == "enemy_force" && (target.force == nil || target.force.Strength <= 0) {
			squad.TargetEnemyID = ""
			squad.State = model.CombatSquadStateIdle
		}
	}

	// 阵亡小队清理（被单位/炮塔/黑雾击杀的在本 tick 已移除；此处兜底）。
	for id, squad := range ws.CombatRuntime.Squads {
		if squad != nil && squad.HP <= 0 && squad.State != model.CombatSquadStateDestroyed {
			events = append(events, destroySquad(ws, squad, "", "attrition")...)
		}
		_ = id
	}
	return events
}

// normalizeSquadCombatStats 兼容旧存档：补齐实体化字段（坐标/移速/单员HP）。
func normalizeSquadCombatStats(ws *model.WorldState, squad *model.CombatSquad) {
	if squad.MoveSpeed <= 0 {
		squad.MoveSpeed = 0.2
	}
	if squad.MemberMaxHP <= 0 && squad.Count > 0 && squad.MaxHP > 0 {
		squad.MemberMaxHP = max(1, squad.MaxHP/squad.Count)
	}
	if squad.Position == (model.Position{}) {
		if building := ws.Buildings[squad.SourceBuildingID]; building != nil {
			squad.Position = building.Position
			if free := findAdjacentFree(ws, building.Position); free != nil {
				squad.Position = *free
			}
		} else {
			squad.Position = model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
		}
	}
}

// selectSquadCombatTarget 统一选取小队目标：敌对单位/小队/黑雾/建筑（R4）。
func selectSquadCombatTarget(ws *model.WorldState, squad *model.CombatSquad, anchor model.Position, profile model.WarTaskForceStanceProfile, maxDistance int) *unitCombatTarget {
	// 显式目标优先（沿用 TargetEnemyID 语义：现在泛指四类实体）。
	if preferred := resolveCombatTarget(ws, squad.TargetEnemyID); preferred != nil && hostile(ws, squad.OwnerID, preferred.ownerID) {
		if profile.Pursue || ws.SurfaceDistance(anchor, preferred.pos) <= maxDistance {
			return preferred
		}
	}

	var best *unitCombatTarget
	bestDistance := math.MaxFloat64
	bestStrength := -1
	bestWeakness := math.MaxInt

	consider := func(t *unitCombatTarget, strength int) {
		if t == nil || strength <= 0 {
			return
		}
		distance := float64(ws.SurfaceDistance(anchor, t.pos))
		if !profile.Pursue && distance > float64(maxDistance) {
			return
		}
		switch profile.TargetPriority {
		case "strongest":
			if strength > bestStrength || (strength == bestStrength && distance < bestDistance) {
				best, bestStrength, bestDistance = t, strength, distance
			}
		case "weakest":
			if strength < bestWeakness || (strength == bestWeakness && distance < bestDistance) {
				best, bestWeakness, bestDistance = t, strength, distance
			}
		default:
			if distance < bestDistance {
				best, bestDistance = t, distance
			}
		}
	}

	for _, u := range ws.Units {
		if u == nil || u.HP <= 0 || !hostile(ws, squad.OwnerID, u.OwnerID) {
			continue
		}
		consider(&unitCombatTarget{kind: "unit", id: u.ID, pos: u.Position, ownerID: u.OwnerID, unit: u}, u.HP)
	}
	if ws.CombatRuntime != nil {
		for _, other := range ws.CombatRuntime.Squads {
			if other == nil || other.ID == squad.ID || other.State == model.CombatSquadStateDestroyed || other.HP <= 0 {
				continue
			}
			if !hostile(ws, squad.OwnerID, other.OwnerID) {
				continue
			}
			consider(&unitCombatTarget{kind: "combat_squad", id: other.ID, pos: other.Position, ownerID: other.OwnerID, squad: other}, other.HP)
		}
	}
	if ws.EnemyForces != nil {
		for i := range ws.EnemyForces.Forces {
			force := &ws.EnemyForces.Forces[i]
			if force.Strength <= 0 {
				continue
			}
			consider(&unitCombatTarget{kind: "enemy_force", id: force.ID, pos: force.Position, force: force}, force.Strength*10)
		}
	}
	for _, b := range ws.Buildings {
		if b == nil || b.HP <= 0 || !hostile(ws, squad.OwnerID, b.OwnerID) {
			continue
		}
		// 建筑仅在有明确攻击意图（追击姿态或显式目标）时成为候选，避免巡逻误拆。
		if !profile.Pursue {
			continue
		}
		consider(&unitCombatTarget{kind: "building", id: b.ID, pos: b.Position, ownerID: b.OwnerID, building: b}, b.HP)
	}
	return best
}

// applySquadDamageToTarget 小队开火结算（按目标类型分派）。
func applySquadDamageToTarget(ws *model.WorldState, squad *model.CombatSquad, target *unitCombatTarget, damage int, currentTick int64) []*model.GameEvent {
	var events []*model.GameEvent
	basePayload := func() map[string]any {
		return map[string]any{
			"attacker_id":   squad.ID,
			"attacker_type": "combat_squad",
			"target_id":     target.id,
			"target_type":   target.kind,
		}
	}
	switch target.kind {
	case "enemy_force":
		force := target.force
		loss := max(1, damage/6)
		force.Strength -= loss
		if force.Strength < 0 {
			force.Strength = 0
		}
		payload := basePayload()
		payload["damage"] = loss
		events = append(events, &model.GameEvent{EventType: model.EvtDamageApplied, VisibilityScope: squad.OwnerID, Payload: payload})
		if force.Strength <= 0 {
			drops := darkFogLootDrops(force, force.Strength+loss, currentTick)
			grants := grantDarkFogLoot(ws, squad.OwnerID, nil, drops)
			events = append(events, darkFogLootEvents(ws, force, squad.ID, squad.OwnerID, grants)...)
			events = append(events, &model.GameEvent{
				EventType:       model.EvtEntityDestroyed,
				VisibilityScope: "all",
				Payload: map[string]any{
					"entity_id":   force.ID,
					"entity_type": "enemy_force",
					"killed_by":   squad.ID,
					"source":      "combat_squad",
				},
			})
			removeEnemyForce(ws, force.ID)
		}
	case "unit":
		victim := target.unit
		model.SyncMechaCapabilities(victim, ws.Players[victim.OwnerID])
		normalizeUnitCombatStats(victim)
		eff := max(1, int(float64(max(1, damage/2-victim.Defense))*model.ResolveDamageCoefficient(squad.Weapon.Type, victim.ArmorClass)))
		hpDamage, absorbed := model.ApplyUnitDamage(victim, eff, currentTick)
		victim.LastAttackerID = squad.ID
		if victim.Mecha != nil {
			events = append(events, mechaStateEvent(victim))
		}
		for _, scope := range []string{squad.OwnerID, victim.OwnerID} {
			payload := basePayload()
			payload["damage"] = hpDamage
			payload["target_hp"] = victim.HP
			payload["shield_absorbed"] = absorbed
			events = append(events, &model.GameEvent{EventType: model.EvtDamageApplied, VisibilityScope: scope, Payload: payload})
		}
		if victim.HP <= 0 {
			events = append(events, killUnit(ws, victim, squad.ID, "combat_squad")...)
		}
	case "combat_squad":
		victim := target.squad
		eff := max(1, int(float64(damage/2)*model.ResolveDamageCoefficient(squad.Weapon.Type, squadArmorClass(victim))))
		if victim.Shield.Level > 0 {
			eff = victim.Shield.ApplyShieldDamage(eff)
			victim.Shield.LastHitTick = currentTick
		}
		losses := victim.ApplySquadDamage(max(1, eff))
		for _, scope := range []string{squad.OwnerID, victim.OwnerID} {
			payload := basePayload()
			payload["damage"] = eff
			payload["target_hp"] = victim.HP
			payload["squad_count"] = victim.Count
			payload["squad_losses"] = losses
			events = append(events, &model.GameEvent{EventType: model.EvtDamageApplied, VisibilityScope: scope, Payload: payload})
		}
		if victim.HP <= 0 {
			events = append(events, destroySquad(ws, victim, squad.ID, "combat_squad")...)
		}
	case "building":
		b := target.building
		eff := max(1, int(float64(max(1, damage/2-2))*model.ResolveDamageCoefficient(squad.Weapon.Type, model.ArmorStructure)))
		shieldAbsorbed, remaining := absorbPlanetaryShieldDamage(ws, b.OwnerID, eff)
		eff = remaining
		b.HP -= eff
		for _, scope := range []string{squad.OwnerID, b.OwnerID} {
			payload := basePayload()
			payload["damage"] = eff
			payload["target_hp"] = b.HP
			payload["shield_absorbed"] = shieldAbsorbed
			payload["shield_remaining"] = totalPlanetaryShieldCharge(ws, b.OwnerID)
			events = append(events, &model.GameEvent{EventType: model.EvtDamageApplied, VisibilityScope: scope, Payload: payload})
		}
		if b.HP <= 0 {
			events = append(events, destroyBuildingCombat(ws, b, squad.ID, "combat_squad"))
		}
	}
	return events
}

func settleSpaceFleets(worlds map[string]*model.WorldState, _ any, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}

	var events []*model.GameEvent
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for _, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, fleet := range systemRuntime.Fleets {
				if fleet == nil || fleet.State != model.FleetStateAttacking || fleet.Target == nil {
					continue
				}
				targetWorld := worlds[fleet.Target.PlanetID]
				if targetWorld == nil || targetWorld.EnemyForces == nil {
					continue
				}
				player := playerStateFromWorlds(worlds, fleet.OwnerID)
				taskForce := model.FindWarTaskForceByMember(player, model.WarTaskForceMemberKindFleet, fleet.ID)
				profile := defaultFleetTaskForceProfile(taskForce)
				status := model.WarCommandCapacityStatus{}
				if taskForce != nil {
					status = model.EvaluateWarTaskForce(player, taskForce, worlds, spaceRuntime)
				}
				if fleet.Sustainment.RetreatRecommended || shouldRetreatFleet(fleet, profile) {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					continue
				}
				anchor := fleetAnchorPosition(targetWorld, taskForce)
				maxDistance := penalizedEngagementDistance(profile.MaxEngagementDistance, status)
				target := selectEnemyForceByTaskForceProfile(targetWorld, fleet.Target.TargetID, anchor, profile, maxDistance)
				if target == nil {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					continue
				}
				if attackDelayed(currentTick, fleet.LastAttackTick, status.DelayPenalty) {
					continue
				}
				if attackBlockedBySustainment(&fleet.Sustainment) {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					continue
				}
				lockQuality, jammingPenalty, driftRisk := resolveFleetBattleContactModifiers(targetWorld, fleet.OwnerID, target)
				fleetDamageScale := fleetAttackScale(fleet, lockQuality)
				enemyFirepower := enemyForceSpaceFirepower(target)
				enemyPD := effectiveEnemyPointDefense(enemyFirepower, jammingPenalty)

				directDamage := max(0, int(float64(fleet.Weapons.DirectFire)*fleetDamageScale/18))
				directDamage = applyTaskForceDamagePenalty(directDamage, profile, status)
				if directDamage > 0 && directDamage < 1 {
					directDamage = 1
				}

				fleetMissilesFired, fleetMissilesIntercepted, fleetMissilesDrifted, fleetMissileDamage := 0, 0, 0, 0
				if fleet.Sustainment.Current.Missiles > 0 {
					fleetMissilesFired, fleetMissilesIntercepted, fleetMissilesDrifted, fleetMissileDamage = settleFleetMissileSalvo(
						fleet.Weapons,
						enemyPD,
						lockQuality,
						driftRisk,
					)
				}
				targetStrengthLoss := max(1, directDamage+fleetMissileDamage/6)
				target.Strength -= targetStrengthLoss
				fleet.LastAttackTick = currentTick
				fleet.Weapon.LastFireTick = currentTick
				settleAttackConsumption(&fleet.Sustainment, fleet.Weapon, currentTick)

				events = append(events, &model.GameEvent{
					EventType:       model.EvtDamageApplied,
					VisibilityScope: fleet.OwnerID,
					Payload: map[string]any{
						"attacker_id":   fleet.ID,
						"attacker_type": "fleet",
						"target_id":     target.ID,
						"target_type":   "enemy_force",
						"damage":        targetStrengthLoss,
					},
				})
				if fleetMissilesFired > 0 {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtMissileSalvoFired,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"fleet_id":        fleet.ID,
							"target_id":       target.ID,
							"target_type":     "enemy_force",
							"launched":        fleetMissilesFired,
							"intercepted":     fleetMissilesIntercepted,
							"drifted":         fleetMissilesDrifted,
							"lock_quality":    lockQuality,
							"jamming_penalty": jammingPenalty,
						},
					})
				}
				if fleetMissilesIntercepted > 0 {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtPointDefenseIntercept,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"fleet_id":    fleet.ID,
							"target_id":   target.ID,
							"target_type": "enemy_force",
							"intercepted": fleetMissilesIntercepted,
							"remaining":   max(0, fleetMissilesFired-fleetMissilesIntercepted-fleetMissilesDrifted),
						},
					})
				}

				enemyLockQuality := enemyAttackScale(fleet)
				enemyDirectDamage := max(0, int(float64(enemyFirepower.DirectFire)*enemyLockQuality/14))
				enemyMissilesFired, enemyMissilesIntercepted, enemyMissilesDrifted, enemyMissileDamage := settleEnemyMissileSalvo(
					fleet,
					enemyFirepower,
					enemyLockQuality,
				)
				fleetDamage, subsystemHits := applySpaceFleetLayeredDamage(
					fleet,
					enemyDirectDamage+enemyMissileDamage,
					enemyFirepower.ElectronicWarfare,
					currentTick,
				)
				if enemyMissilesFired > 0 {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtMissileSalvoFired,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"fleet_id":        fleet.ID,
							"source":          "enemy_force",
							"target_id":       fleet.ID,
							"target_type":     "fleet",
							"launched":        enemyMissilesFired,
							"intercepted":     enemyMissilesIntercepted,
							"drifted":         enemyMissilesDrifted,
							"lock_quality":    enemyLockQuality,
							"jamming_penalty": float64(fleet.Weapons.ElectronicWarfare) / 20,
						},
					})
				}
				if enemyMissilesIntercepted > 0 {
					events = append(events, &model.GameEvent{
						EventType:       model.EvtPointDefenseIntercept,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"fleet_id":    fleet.ID,
							"source":      "fleet",
							"target_id":   fleet.ID,
							"target_type": "fleet",
							"intercepted": enemyMissilesIntercepted,
							"remaining":   max(0, enemyMissilesFired-enemyMissilesIntercepted-enemyMissilesDrifted),
						},
					})
				}

				report := &model.SpaceBattleReport{
					BattleID:           spaceRuntime.NextEntityID("battle"),
					Tick:               currentTick,
					SystemID:           systemRuntime.SystemID,
					PlanetID:           targetWorld.PlanetID,
					FleetID:            fleet.ID,
					OwnerID:            fleet.OwnerID,
					TargetID:           target.ID,
					TargetType:         "enemy_force",
					FleetFirepower:     fleet.Weapons,
					EnemyFirepower:     enemyFirepower,
					FleetMissileSalvo:  model.SpaceMissileSalvoReport{Fired: fleetMissilesFired, Intercepted: fleetMissilesIntercepted, Penetrated: max(0, fleetMissilesFired-fleetMissilesIntercepted-fleetMissilesDrifted), Drifted: fleetMissilesDrifted, Damage: fleetMissileDamage},
					EnemyMissileSalvo:  model.SpaceMissileSalvoReport{Fired: enemyMissilesFired, Intercepted: enemyMissilesIntercepted, Penetrated: max(0, enemyMissilesFired-enemyMissilesIntercepted-enemyMissilesDrifted), Drifted: enemyMissilesDrifted, Damage: enemyMissileDamage},
					FleetDamage:        fleetDamage,
					TargetStrengthLoss: targetStrengthLoss,
					SubsystemHits:      subsystemHits,
					LockQuality:        lockQuality,
					JammingPenalty:     jammingPenalty,
				}

				rechargeShieldWithSustainment(&fleet.Shield, &fleet.Sustainment, currentTick)

				if target.Strength <= 0 {
					report.TargetDestroyed = true
					events = append(events, &model.GameEvent{
						EventType:       model.EvtEntityDestroyed,
						VisibilityScope: "all",
						Payload: map[string]any{
							"entity_id":   target.ID,
							"entity_type": "enemy_force",
							"killed_by":   fleet.ID,
							"source":      "fleet",
						},
					})
					removeEnemyForce(targetWorld, target.ID)
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					systemRuntime.AppendBattleReport(report)
					fleet.LastBattleReportID = report.BattleID
					events = append(events, &model.GameEvent{
						EventType:       model.EvtBattleReportGenerated,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"battle_id": report.BattleID,
							"fleet_id":  fleet.ID,
							"report":    report,
						},
					})
					continue
				}
				if fleet.Sustainment.RetreatRecommended || shouldRetreatFleet(fleet, profile) {
					report.RetreatTriggered = true
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
				}
				systemRuntime.AppendBattleReport(report)
				fleet.LastBattleReportID = report.BattleID
				events = append(events, &model.GameEvent{
					EventType:       model.EvtBattleReportGenerated,
					VisibilityScope: fleet.OwnerID,
					Payload: map[string]any{
						"battle_id": report.BattleID,
						"fleet_id":  fleet.ID,
						"report":    report,
					},
				})
			}
		}
	}
	return events
}

func defaultSquadTaskForceProfile(taskForce *model.WarTaskForce) model.WarTaskForceStanceProfile {
	if taskForce == nil {
		profile := model.WarTaskForceProfile(model.WarTaskForceStancePatrol)
		profile.MaxEngagementDistance = 1 << 30
		profile.Pursue = true
		profile.RetreatLossThreshold = 0
		return profile
	}
	return model.WarTaskForceProfile(taskForce.Stance)
}

func defaultFleetTaskForceProfile(taskForce *model.WarTaskForce) model.WarTaskForceStanceProfile {
	if taskForce == nil {
		profile := model.WarTaskForceProfile(model.WarTaskForceStanceIntercept)
		profile.MaxEngagementDistance = 1 << 30
		profile.Pursue = true
		profile.RetreatLossThreshold = 0
		return profile
	}
	return model.WarTaskForceProfile(taskForce.Stance)
}

func shouldRetreatSquad(squad *model.CombatSquad, profile model.WarTaskForceStanceProfile) bool {
	if squad == nil || profile.RetreatLossThreshold <= 0 || squad.MaxHP <= 0 {
		return false
	}
	return float64(squad.HP)/float64(squad.MaxHP) <= profile.RetreatLossThreshold
}

func shouldRetreatFleet(fleet *model.SpaceFleet, profile model.WarTaskForceStanceProfile) bool {
	if fleet == nil || profile.RetreatLossThreshold <= 0 {
		return false
	}
	if fleet.Structure.MaxLevel > 0 {
		return float64(fleet.Structure.Level)/float64(fleet.Structure.MaxLevel) <= profile.RetreatLossThreshold
	}
	if fleet.Shield.MaxLevel <= 0 {
		return false
	}
	return fleet.Shield.Level/fleet.Shield.MaxLevel <= profile.RetreatLossThreshold
}

func fleetAnchorPosition(targetWorld *model.WorldState, taskForce *model.WarTaskForce) model.Position {
	if taskForce != nil && taskForce.Deployment != nil && taskForce.Deployment.Position != nil {
		return *taskForce.Deployment.Position
	}
	if targetWorld != nil {
		return model.Position{X: targetWorld.MapWidth / 2, Y: targetWorld.MapHeight / 2}
	}
	return model.Position{}
}

func selectEnemyForceByTaskForceProfile(
	ws *model.WorldState,
	preferredTargetID string,
	anchor model.Position,
	profile model.WarTaskForceStanceProfile,
	maxDistance int,
) *model.EnemyForce {
	if ws == nil || ws.EnemyForces == nil || len(ws.EnemyForces.Forces) == 0 {
		return nil
	}
	if preferred := findEnemyForceByID(ws, preferredTargetID); preferred != nil {
		if profile.Pursue || float64(ws.SurfaceDistance(anchor, preferred.Position)) <= float64(maxDistance) {
			return preferred
		}
	}

	var best *model.EnemyForce
	bestDistance := math.MaxFloat64
	bestStrength := -1
	bestWeakness := math.MaxInt

	for index := range ws.EnemyForces.Forces {
		force := &ws.EnemyForces.Forces[index]
		if force == nil || force.Strength <= 0 {
			continue
		}
		distance := float64(ws.SurfaceDistance(anchor, force.Position))
		if !profile.Pursue && distance > float64(maxDistance) {
			continue
		}
		switch profile.TargetPriority {
		case "strongest":
			if force.Strength > bestStrength || (force.Strength == bestStrength && distance < bestDistance) {
				best = force
				bestStrength = force.Strength
				bestDistance = distance
			}
		case "weakest":
			if force.Strength < bestWeakness || (force.Strength == bestWeakness && distance < bestDistance) {
				best = force
				bestWeakness = force.Strength
				bestDistance = distance
			}
		default:
			if distance < bestDistance {
				best = force
				bestDistance = distance
			}
		}
	}
	return best
}

func penalizedEngagementDistance(base int, status model.WarCommandCapacityStatus) int {
	if base <= 0 {
		return 0
	}
	multiplier := 1 - status.FormationPenalty*0.5
	if multiplier < 0.3 {
		multiplier = 0.3
	}
	return max(1, int(math.Round(float64(base)*multiplier)))
}

func applyTaskForceDamagePenalty(damage int, profile model.WarTaskForceStanceProfile, status model.WarCommandCapacityStatus) int {
	if damage <= 0 {
		return 0
	}
	multiplier := 1 - status.HitPenalty
	multiplier *= 1 - status.CoordinationPenalty/2
	if profile.PreferStealth {
		multiplier *= 0.8
	}
	if multiplier < 0.2 {
		multiplier = 0.2
	}
	return max(1, int(math.Round(float64(damage)*multiplier)))
}

func attackDelayed(currentTick, lastAttackTick int64, penalty float64) bool {
	if penalty <= 0 || lastAttackTick == 0 {
		return false
	}
	delayTicks := int64(math.Ceil(penalty * 4))
	if delayTicks <= 0 {
		return false
	}
	return currentTick-lastAttackTick <= delayTicks
}

func resolveFleetBattleContactModifiers(ws *model.WorldState, playerID string, target *model.EnemyForce) (lockQuality, jammingPenalty, driftRisk float64) {
	lockQuality = 0.6
	jammingPenalty = 0
	driftRisk = 0.15
	if target == nil {
		return lockQuality, jammingPenalty, driftRisk
	}
	if ws != nil && ws.SensorContacts != nil {
		if state := ws.SensorContacts[playerID]; state != nil && state.Contacts != nil {
			if contact := state.Contacts[target.ID]; contact != nil {
				if contact.LockQuality > 0 {
					lockQuality = contact.LockQuality
				}
				jammingPenalty = contact.JammingPenalty
				driftRisk = contact.MissileDriftRisk
				return clampBattleFloat(lockQuality, 0.15, 1), clampBattleFloat(jammingPenalty, 0, 99), clampBattleFloat(driftRisk, 0, 0.95)
			}
		}
	}
	profile := enemyForceTargetProfile(*target)
	jammingPenalty = profile.JammingStrength
	driftRisk = clampBattleFloat(profile.JammingStrength/12, 0, 0.8)
	return clampBattleFloat(lockQuality, 0.15, 1), clampBattleFloat(jammingPenalty, 0, 99), clampBattleFloat(driftRisk, 0, 0.95)
}

func enemyForceSpaceFirepower(force *model.EnemyForce) model.SpaceWeaponMix {
	if force == nil {
		return model.SpaceWeaponMix{}
	}
	switch force.Type {
	case model.EnemyForceTypeBeacon:
		return model.SpaceWeaponMix{
			DirectFire:        max(12, force.Strength/7),
			Missile:           max(24, force.Strength/3),
			PointDefense:      max(8, force.Strength/18),
			ElectronicWarfare: max(10, force.Strength/20),
		}
	case model.EnemyForceTypeHive:
		return model.SpaceWeaponMix{
			DirectFire:        max(18, force.Strength/5),
			Missile:           max(12, force.Strength/6),
			PointDefense:      max(4, force.Strength/24),
			ElectronicWarfare: max(4, force.Strength/30),
		}
	default:
		return model.SpaceWeaponMix{
			DirectFire:        max(14, force.Strength/6),
			Missile:           max(10, force.Strength/8),
			PointDefense:      max(3, force.Strength/30),
			ElectronicWarfare: max(2, force.Strength/36),
		}
	}
}

func effectiveEnemyPointDefense(firepower model.SpaceWeaponMix, jammingPenalty float64) int {
	value := float64(firepower.PointDefense) + jammingPenalty*0.3
	if value < 0 {
		value = 0
	}
	return int(math.Round(value))
}

func fleetAttackScale(fleet *model.SpaceFleet, lockQuality float64) float64 {
	if fleet == nil {
		return clampBattleFloat(lockQuality, 0.15, 1)
	}
	multiplier := sustainmentDamageMultiplier(&fleet.Sustainment)
	multiplier *= 0.45 + 0.55*subsystemIntegrity(fleet.Subsystems.FireControl)
	multiplier *= 0.55 + 0.45*subsystemIntegrity(fleet.Subsystems.Sensors)
	multiplier *= clampBattleFloat(lockQuality, 0.15, 1)
	return clampBattleFloat(multiplier, 0.1, 1.4)
}

func enemyAttackScale(fleet *model.SpaceFleet) float64 {
	if fleet == nil {
		return 1
	}
	multiplier := 0.85
	multiplier -= float64(fleet.Weapons.ElectronicWarfare) / 220
	multiplier -= (1 - subsystemIntegrity(fleet.Subsystems.Sensors)) * 0.15
	return clampBattleFloat(multiplier, 0.25, 1)
}

func settleFleetMissileSalvo(weapons model.SpaceWeaponMix, enemyPointDefense int, lockQuality, driftRisk float64) (fired, intercepted, drifted, damage int) {
	if weapons.Missile <= 0 {
		return 0, 0, 0, 0
	}
	fired = max(1, weapons.Missile/26)
	intercepted = min(fired, int(math.Round(float64(fired)*float64(enemyPointDefense)/float64(enemyPointDefense+weapons.Missile+12))))
	remaining := max(0, fired-intercepted)
	drifted = min(remaining, int(math.Round(float64(remaining)*clampBattleFloat(driftRisk, 0, 0.95))))
	penetrated := max(0, remaining-drifted)
	damage = int(math.Round(float64(penetrated*(12+weapons.Missile/10)) * clampBattleFloat(lockQuality, 0.15, 1)))
	return fired, intercepted, drifted, damage
}

func settleEnemyMissileSalvo(fleet *model.SpaceFleet, firepower model.SpaceWeaponMix, attackScale float64) (fired, intercepted, drifted, damage int) {
	if firepower.Missile <= 0 {
		return 0, 0, 0, 0
	}
	fired = max(1, firepower.Missile/24)
	pointDefense := int(math.Round(float64(fleet.Weapons.PointDefense) * subsystemIntegrity(fleet.Subsystems.PointDefense)))
	intercepted = min(fired, int(math.Round(float64(fired)*float64(pointDefense)/float64(pointDefense+firepower.Missile+10))))
	remaining := max(0, fired-intercepted)
	driftResistance := clampBattleFloat(float64(fleet.Weapons.ElectronicWarfare)/float64(max(1, firepower.Missile+fleet.Weapons.ElectronicWarfare)), 0, 0.75)
	drifted = min(remaining, int(math.Round(float64(remaining)*driftResistance)))
	penetrated := max(0, remaining-drifted)
	damage = int(math.Round(float64(penetrated*(10+firepower.Missile/12)) * clampBattleFloat(attackScale, 0.25, 1)))
	return fired, intercepted, drifted, damage
}

func applySpaceFleetLayeredDamage(
	fleet *model.SpaceFleet,
	damage int,
	electronicWarfare int,
	currentTick int64,
) (model.SpaceBattleDamageSummary, []model.SpaceBattleSubsystemHit) {
	summary := model.SpaceBattleDamageSummary{}
	if fleet == nil || damage <= 0 {
		return summary, nil
	}
	remaining := damage
	if fleet.Shield.Level > 0 {
		absorbed := min(remaining, int(math.Ceil(fleet.Shield.Level)))
		fleet.Shield.Level -= float64(absorbed)
		fleet.Shield.LastHitTick = currentTick
		summary.Shield = float64(absorbed)
		remaining -= absorbed
	}
	if remaining > 0 && fleet.Armor.Level > 0 {
		absorbed := min(remaining, fleet.Armor.Level)
		fleet.Armor.Level -= absorbed
		summary.Armor = absorbed
		remaining -= absorbed
	}
	if remaining > 0 && fleet.Structure.Level > 0 {
		absorbed := min(remaining, fleet.Structure.Level)
		fleet.Structure.Level -= absorbed
		summary.Structure = absorbed
		remaining -= absorbed
	}
	pressure := summary.Structure + summary.Armor/2 + int(summary.Shield/4) + electronicWarfare/3
	hits := degradeFleetSubsystems(&fleet.Subsystems, pressure)
	summary.Subsystem = len(hits)
	return summary, hits
}

func degradeFleetSubsystems(subsystems *model.SpaceFleetSubsystemState, pressure int) []model.SpaceBattleSubsystemHit {
	if subsystems == nil || pressure <= 0 {
		return nil
	}
	type subsystemEntry struct {
		name   string
		status *model.SpaceFleetSubsystemStatus
	}
	order := []subsystemEntry{
		{name: "point_defense", status: &subsystems.PointDefense},
		{name: "sensors", status: &subsystems.Sensors},
		{name: "fire_control", status: &subsystems.FireControl},
		{name: "engine", status: &subsystems.Engine},
	}
	hitCount := 1
	switch {
	case pressure >= 120:
		hitCount = 3
	case pressure >= 70:
		hitCount = 2
	}
	baseLoss := clampBattleFloat(0.16+float64(pressure)/220, 0.16, 0.65)
	hits := make([]model.SpaceBattleSubsystemHit, 0, hitCount)
	for i := 0; i < hitCount && i < len(order); i++ {
		status := order[i].status
		status.Integrity -= baseLoss + float64(i)*0.06
		if status.Integrity < 0 {
			status.Integrity = 0
		}
		updateFleetSubsystemStatus(order[i].name, status)
		hits = append(hits, model.SpaceBattleSubsystemHit{
			Subsystem: order[i].name,
			State:     status.State,
			Effect:    status.Effect,
		})
	}
	return hits
}

func updateFleetSubsystemStatus(name string, status *model.SpaceFleetSubsystemStatus) {
	if status == nil {
		return
	}
	switch {
	case status.Integrity <= 0.35:
		status.State = model.SpaceFleetSubsystemDisabled
	case status.Integrity <= 0.75:
		status.State = model.SpaceFleetSubsystemDegraded
	default:
		status.State = model.SpaceFleetSubsystemOperational
	}
	switch name {
	case "engine":
		switch status.State {
		case model.SpaceFleetSubsystemDisabled:
			status.Effect = "drive blackout"
		case model.SpaceFleetSubsystemDegraded:
			status.Effect = "reduced thrust"
		default:
			status.Effect = "normal thrust"
		}
	case "fire_control":
		switch status.State {
		case model.SpaceFleetSubsystemDisabled:
			status.Effect = "weapon coordination lost"
		case model.SpaceFleetSubsystemDegraded:
			status.Effect = "hit chance reduced"
		default:
			status.Effect = "stable firing solution"
		}
	case "sensors":
		switch status.State {
		case model.SpaceFleetSubsystemDisabled:
			status.Effect = "sensor picture lost"
		case model.SpaceFleetSubsystemDegraded:
			status.Effect = "lock quality degraded"
		default:
			status.Effect = "full lock resolution"
		}
	case "point_defense":
		switch status.State {
		case model.SpaceFleetSubsystemDisabled:
			status.Effect = "intercept grid offline"
		case model.SpaceFleetSubsystemDegraded:
			status.Effect = "intercept grid saturated"
		default:
			status.Effect = "intercept grid online"
		}
	}
}

func subsystemIntegrity(status model.SpaceFleetSubsystemStatus) float64 {
	if status.Integrity <= 0 {
		if status.State == "" {
			return 1
		}
		return 0
	}
	return clampBattleFloat(status.Integrity, 0, 1)
}

func clampBattleFloat(value, minValue, maxValue float64) float64 {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func playerStateFromWorlds(worlds map[string]*model.WorldState, playerID string) *model.PlayerState {
	for _, world := range worlds {
		if world == nil {
			continue
		}
		if player := world.Players[playerID]; player != nil {
			return player
		}
	}
	return nil
}

// fleetRefLike 舰队交战引用的（所属, 星系运行时, 舰队）三元组。
type fleetRefLike struct {
	owner  string
	system *model.PlayerSystemRuntime
	fleet  *model.SpaceFleet
}

// settleFleetVsFleet 同星系敌对舰队交战（R4 舰队最小版）：
// 同一恒星系内分属敌对玩家的舰队自动交火，直瞄火力集火对方最弱舰队，
// 结构归零即摧毁并移出战场。跃迁中的舰队不参战（与轨道优势口径一致）。
func settleFleetVsFleet(worlds map[string]*model.WorldState, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if spaceRuntime == nil {
		return nil
	}
	bySystem := make(map[string][]fleetRefLike)
	for _, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for systemID, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			for _, fleet := range systemRuntime.Fleets {
				if fleet == nil || fleet.Transit != nil || fleet.Structure.Level <= 0 {
					continue
				}
				bySystem[systemID] = append(bySystem[systemID], fleetRefLike{owner: fleet.OwnerID, system: systemRuntime, fleet: fleet})
			}
		}
	}

	var events []*model.GameEvent
	systemIDs := make([]string, 0, len(bySystem))
	for systemID := range bySystem {
		systemIDs = append(systemIDs, systemID)
	}
	sort.Strings(systemIDs)
	for _, systemID := range systemIDs {
		fleets := bySystem[systemID]
		owners := make(map[string]bool)
		for _, ref := range fleets {
			owners[ref.owner] = true
		}
		ownerIDs := make([]string, 0, len(owners))
		for owner := range owners {
			ownerIDs = append(ownerIDs, owner)
		}
		sort.Strings(ownerIDs)
		if len(ownerIDs) < 2 {
			continue
		}
		for i, attacker := range ownerIDs {
			for _, defender := range ownerIDs[i+1:] {
				if !spaceOwnersHostile(worlds, attacker, defender) {
					continue
				}
				events = append(events, fleetPairExchange(fleets, attacker, defender, currentTick)...)
				events = append(events, fleetPairExchange(fleets, defender, attacker, currentTick)...)
			}
		}
	}
	return events
}

// spaceOwnersHostile 太空层敌对判定：不同玩家且无共同队伍。
func spaceOwnersHostile(worlds map[string]*model.WorldState, a, b string) bool {
	if a == b {
		return false
	}
	worldIDs := make([]string, 0, len(worlds))
	for id := range worlds {
		worldIDs = append(worldIDs, id)
	}
	sort.Strings(worldIDs)
	for _, id := range worldIDs {
		ws := worlds[id]
		if ws == nil {
			continue
		}
		pa, pb := ws.Players[a], ws.Players[b]
		if pa == nil || pb == nil {
			continue
		}
		if pa.TeamID != "" && pa.TeamID == pb.TeamID {
			return false
		}
		return true
	}
	return true
}

// fleetPairExchange 一方对另一方的集火：冷却就绪的舰队直瞄火力集火对方最弱舰队。
func fleetPairExchange(fleets []fleetRefLike, attackerOwner, defenderOwner string, currentTick int64) []*model.GameEvent {
	firepower := 0
	var shooters []*model.SpaceFleet
	var target *model.SpaceFleet
	var targetSystem *model.PlayerSystemRuntime
	for _, ref := range fleets {
		if ref.owner == attackerOwner {
			if ref.fleet.Weapons.DirectFire <= 0 {
				continue
			}
			if ref.fleet.LastAttackTick > 0 && currentTick-ref.fleet.LastAttackTick < int64(max(5, ref.fleet.Weapon.FireRate)) {
				continue
			}
			firepower += ref.fleet.Weapons.DirectFire
			shooters = append(shooters, ref.fleet)
		}
		if ref.owner == defenderOwner {
			if target == nil || ref.fleet.Structure.Level < target.Structure.Level {
				target = ref.fleet
				targetSystem = ref.system
			}
		}
	}
	if firepower <= 0 || target == nil {
		return nil
	}
	damage := max(1, firepower/8)
	summary, subsystemHits := applySpaceFleetLayeredDamage(target, damage, 0, currentTick)
	for _, shooter := range shooters {
		shooter.LastAttackTick = currentTick
	}
	totalDamage := int(summary.Shield) + summary.Armor + summary.Structure
	events := []*model.GameEvent{}
	for _, scope := range []string{attackerOwner, defenderOwner} {
		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: scope,
			Payload: map[string]any{
				"attacker_id":     shooters[0].ID,
				"attacker_type":   "fleet",
				"attacker_owner":  attackerOwner,
				"target_id":       target.ID,
				"target_type":     "fleet",
				"target_owner":    defenderOwner,
				"damage":          totalDamage,
				"target_hp":       target.Structure.Level,
				"subsystem_hits":  len(subsystemHits),
				"fleet_vs_fleet":  true,
			},
		})
	}
	if target.Structure.Level <= 0 {
		delete(targetSystem.Fleets, target.ID)
		events = append(events, &model.GameEvent{
			EventType:       model.EvtEntityDestroyed,
			VisibilityScope: "all",
			Payload: map[string]any{
				"entity_id":   target.ID,
				"entity_type": "fleet",
				"owner_id":    defenderOwner,
				"killed_by":   shooters[0].ID,
				"source":      "fleet",
			},
		})
	}
	return events
}
