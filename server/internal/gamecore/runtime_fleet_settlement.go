package gamecore

import "siliconworld/internal/model"

func settleCombatRuntime(ws *model.WorldState, currentTick int64) []*model.GameEvent {
	if ws == nil || ws.CombatRuntime == nil || ws.EnemyForces == nil {
		return nil
	}

	var events []*model.GameEvent
	for _, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.State == model.CombatSquadStateDestroyed {
			continue
		}
		target := findEnemyForceBySquadTarget(ws, squad.TargetEnemyID)
		if target == nil {
			target = findNearestEnemyForce(ws, model.Position{X: ws.MapWidth / 2, Y: ws.MapHeight / 2})
		}
		if target == nil {
			squad.State = model.CombatSquadStateIdle
			squad.TargetEnemyID = ""
			continue
		}

		damage := squad.Weapon.Damage * max(1, squad.Count)
		target.Strength -= max(1, damage/6)
		squad.TargetEnemyID = target.ID
		squad.State = model.CombatSquadStateEngaging
		squad.LastAttackTick = currentTick
		squad.Shield.ProcessShieldRecharge(currentTick)

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
				if fleet == nil {
					continue
				}
				taskForce := taskForceByMember(systemRuntime, model.RuntimeUnitKindFleet, fleet.ID)
				if taskForce != nil {
					taskForce.Behavior = model.DefaultTaskForceBehavior(taskForce.Stance)
				}
				if fleet.State != model.FleetStateAttacking || fleet.Target == nil {
					continue
				}
				targetWorld := worlds[fleet.Target.PlanetID]
				if targetWorld == nil || targetWorld.EnemyForces == nil {
					continue
				}
				if taskForce != nil && shouldRetreatFleet(taskForce, fleet) {
					taskForce.Status = model.TaskForceStatusRetreating
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					events = append(events, &model.GameEvent{
						EventType:       model.EvtEntityUpdated,
						VisibilityScope: fleet.OwnerID,
						Payload: map[string]any{
							"entity_type": "task_force",
							"entity_id":   taskForce.ID,
							"status":      taskForce.Status,
							"fleet_id":    fleet.ID,
						},
					})
					continue
				}
				target := findEnemyForceByID(targetWorld, fleet.Target.TargetID)
				if target == nil {
					target = selectFleetTarget(targetWorld, taskForce, fleet.Target)
				}
				if target == nil {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					continue
				}

				delayTicks := 0
				hitRateMultiplier := 1.0
				coordinationMultiplier := 1.0
				if taskForce != nil {
					delayTicks = taskForce.CommandCapacity.Penalty.DelayTicks
					hitRateMultiplier = taskForce.CommandCapacity.Penalty.HitRateMultiplier
					coordinationMultiplier = taskForce.CommandCapacity.Penalty.CoordinationMultiplier
					if taskForce.Behavior.PreserveStealth {
						hitRateMultiplier *= 0.9
					}
				}
				if currentTick-fleet.LastAttackTick < int64(fleet.Weapon.FireRate+delayTicks) {
					continue
				}
				damage := max(1, int(float64(fleet.Weapon.Damage/4)*hitRateMultiplier*coordinationMultiplier))
				target.Strength -= damage
				fleet.LastAttackTick = currentTick
				fleet.Weapon.LastFireTick = currentTick
				fleet.Shield.ProcessShieldRecharge(currentTick)
				if taskForce != nil {
					taskForce.Status = model.TaskForceStatusEngaging
				}

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
				if target.Strength > 0 && fleet.Shield.MaxLevel > 0 {
					counterDamage := max(1, damage/3)
					fleet.Shield.Level -= float64(counterDamage)
					if fleet.Shield.Level < 0 {
						fleet.Shield.Level = 0
					}
				}

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
					if taskForce == nil || !taskForce.Behavior.Pursue {
						fleet.State = model.FleetStateIdle
						fleet.Target = nil
					} else {
						nextTarget := selectFleetTarget(targetWorld, taskForce, fleet.Target)
						if nextTarget == nil {
							fleet.State = model.FleetStateIdle
							fleet.Target = nil
						} else {
							fleet.Target = &model.FleetTarget{PlanetID: targetWorld.PlanetID, TargetID: nextTarget.ID}
						}
					}
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

func taskForceByMember(systemRuntime *model.PlayerSystemRuntime, unitKind model.RuntimeUnitKind, unitID string) *model.TaskForce {
	if systemRuntime == nil {
		return nil
	}
	for _, taskForce := range systemRuntime.TaskForces {
		if taskForce == nil {
			continue
		}
		for _, member := range taskForce.Members {
			if member.UnitKind == unitKind && member.UnitID == unitID {
				return taskForce
			}
		}
	}
	return nil
}

func shouldRetreatFleet(taskForce *model.TaskForce, fleet *model.SpaceFleet) bool {
	if taskForce == nil || fleet == nil || taskForce.Behavior.RetreatLossThreshold <= 0 || fleet.Shield.MaxLevel <= 0 {
		return false
	}
	return fleet.Shield.Level/fleet.Shield.MaxLevel <= taskForce.Behavior.RetreatLossThreshold
}

func selectFleetTarget(targetWorld *model.WorldState, taskForce *model.TaskForce, fallback *model.FleetTarget) *model.EnemyForce {
	if targetWorld == nil || targetWorld.EnemyForces == nil {
		return nil
	}
	if fallback != nil {
		if target := findEnemyForceByID(targetWorld, fallback.TargetID); target != nil {
			return target
		}
	}
	if taskForce == nil {
		return findNearestEnemyForce(targetWorld, model.Position{X: targetWorld.MapWidth / 2, Y: targetWorld.MapHeight / 2})
	}
	return selectEnemyForceForTaskForce(targetWorld, taskForce.Behavior, taskForce.DeploymentTarget)
}
