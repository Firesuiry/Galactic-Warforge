package gamecore

import (
	"math"

	"siliconworld/internal/model"
)

func settleCombatRuntime(ws *model.WorldState, currentTick int64) []*model.GameEvent {
	if ws == nil || ws.CombatRuntime == nil || ws.EnemyForces == nil {
		return nil
	}

	var events []*model.GameEvent
	worlds := map[string]*model.WorldState{ws.PlanetID: ws}
	for _, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.State == model.CombatSquadStateDestroyed {
			continue
		}
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
		anchor := squadAnchorPosition(ws, squad, taskForce)
		maxDistance := penalizedEngagementDistance(profile.MaxEngagementDistance, status)
		target := selectEnemyForceByTaskForceProfile(ws, squad.TargetEnemyID, anchor, profile, maxDistance)
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

		damage := squad.Weapon.Damage * max(1, squad.Count)
		damage = applyTaskForceDamagePenalty(damage, profile, status)
		damage = int(float64(damage) * sustainmentDamageMultiplier(&squad.Sustainment))
		if damage <= 0 {
			continue
		}
		target.Strength -= max(1, damage/6)
		squad.TargetEnemyID = target.ID
		squad.State = model.CombatSquadStateEngaging
		squad.LastAttackTick = currentTick
		settleAttackConsumption(&squad.Sustainment, squad.Weapon, currentTick)
		rechargeShieldWithSustainment(&squad.Shield, &squad.Sustainment, currentTick)

		events = append(events, &model.GameEvent{
			EventType:       model.EvtDamageApplied,
			VisibilityScope: squad.OwnerID,
			Payload: map[string]any{
				"attacker_id":   squad.ID,
				"attacker_type": "combat_squad",
				"target_id":     target.ID,
				"target_type":   "enemy_force",
				"damage":        max(1, damage/6),
			},
		})

		if target.Strength <= 0 {
			events = append(events, &model.GameEvent{
				EventType:       model.EvtEntityDestroyed,
				VisibilityScope: "all",
				Payload: map[string]any{
					"entity_id":   target.ID,
					"entity_type": "enemy_force",
					"killed_by":   squad.ID,
					"source":      "combat_squad",
				},
			})
			removeEnemyForce(ws, target.ID)
			squad.TargetEnemyID = ""
			squad.State = model.CombatSquadStateIdle
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

				damage := max(1, fleet.Weapon.Damage/4)
				damage = applyTaskForceDamagePenalty(damage, profile, status)
				damage = int(float64(damage) * sustainmentDamageMultiplier(&fleet.Sustainment))
				if damage <= 0 {
					continue
				}
				target.Strength -= damage
				fleet.LastAttackTick = currentTick
				fleet.Weapon.LastFireTick = currentTick
				settleAttackConsumption(&fleet.Sustainment, fleet.Weapon, currentTick)
				rechargeShieldWithSustainment(&fleet.Shield, &fleet.Sustainment, currentTick)

				events = append(events, &model.GameEvent{
					EventType:       model.EvtDamageApplied,
					VisibilityScope: fleet.OwnerID,
					Payload: map[string]any{
						"attacker_id":   fleet.ID,
						"attacker_type": "fleet",
						"target_id":     target.ID,
						"target_type":   "enemy_force",
						"damage":        damage,
					},
				})

				if target.Strength <= 0 {
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
				}
			}
		}
	}
	return events
}

func findEnemyForceBySquadTarget(ws *model.WorldState, targetID string) *model.EnemyForce {
	if targetID == "" {
		return nil
	}
	return findEnemyForceByID(ws, targetID)
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
	if fleet == nil || profile.RetreatLossThreshold <= 0 || fleet.Shield.MaxLevel <= 0 {
		return false
	}
	return fleet.Shield.Level/fleet.Shield.MaxLevel <= profile.RetreatLossThreshold
}

func squadAnchorPosition(ws *model.WorldState, squad *model.CombatSquad, taskForce *model.WarTaskForce) model.Position {
	if taskForce != nil && taskForce.Deployment != nil && taskForce.Deployment.Position != nil {
		return *taskForce.Deployment.Position
	}
	if ws != nil {
		if building := ws.Buildings[squad.SourceBuildingID]; building != nil {
			return building.Position
		}
		return model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2}
	}
	return model.Position{}
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
		if profile.Pursue || model.CalculateDistance(anchor, preferred.Position) <= float64(maxDistance) {
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
		distance := model.CalculateDistance(anchor, force.Position)
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
