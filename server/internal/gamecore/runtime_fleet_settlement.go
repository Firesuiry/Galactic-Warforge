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
				if fleet == nil || fleet.State != model.FleetStateAttacking || fleet.Target == nil {
					continue
				}
				targetWorld := worlds[fleet.Target.PlanetID]
				if targetWorld == nil || targetWorld.EnemyForces == nil {
					continue
				}
				target := findEnemyForceByID(targetWorld, fleet.Target.TargetID)
				if target == nil {
					target = findNearestEnemyForce(targetWorld, model.Position{X: targetWorld.MapWidth / 2, Y: targetWorld.MapHeight / 2})
				}
				if target == nil {
					fleet.State = model.FleetStateIdle
					fleet.Target = nil
					continue
				}

				damage := max(1, fleet.Weapon.Damage/4)
				target.Strength -= damage
				fleet.LastAttackTick = currentTick
				fleet.Weapon.LastFireTick = currentTick
				fleet.Shield.ProcessShieldRecharge(currentTick)

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
