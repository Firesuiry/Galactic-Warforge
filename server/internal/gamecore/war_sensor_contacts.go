package gamecore

import (
	"math"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

type positionedSensorSource struct {
	input      model.SensorContactSourceInput
	position   *model.Position
	rangeLimit float64
}

type anchoredSensorSource struct {
	input          model.SensorContactSourceInput
	anchorPlanetID string
}

type fleetSensorAggregate struct {
	domain            model.UnitDomain
	dominantBlueprint string
	totalCount        int
	profile           model.WarSensorProfile
}

func settlePlanetSensorContacts(ws *model.WorldState, currentTick int64) {
	if ws == nil {
		return
	}
	if ws.SensorContacts == nil {
		ws.SensorContacts = make(map[string]*model.SensorContactState)
	}
	for playerID := range ws.Players {
		state := &model.SensorContactState{
			PlayerID:  playerID,
			ScopeType: model.SensorContactScopePlanet,
			ScopeID:   ws.PlanetID,
			Contacts:  make(map[string]*model.SensorContact),
		}
		sources := collectPlanetSensorSources(ws, playerID)
		for _, force := range enemyForcesOrEmpty(ws) {
			eval := model.SensorContactEvaluation{
				ScopeType:       model.SensorContactScopePlanet,
				ScopeID:         ws.PlanetID,
				ContactKind:     model.SensorContactKindEnemyForce,
				EntityID:        force.ID,
				EntityType:      "enemy_force",
				Domain:          model.UnitDomainGround,
				PlanetID:        ws.PlanetID,
				Position:        clonePosition(force.Position),
				LastUpdated:     currentTick,
				DistancePenalty: planetDistancePenalty(sources, force.Position),
				Target:          enemyForceTargetProfile(force),
				Sources:         sourceInputsForPlanetTarget(sources, force.Position),
			}
			contact, ghost := model.EvaluateSensorContact(eval)
			if contact != nil {
				state.Contacts[contact.ID] = contact
			}
			if ghost != nil {
				state.Contacts[ghost.ID] = ghost
			}
		}
		if len(state.Contacts) == 0 {
			delete(ws.SensorContacts, playerID)
			continue
		}
		ws.SensorContacts[playerID] = state
	}
}

func settleSystemSensorContacts(
	worlds map[string]*model.WorldState,
	maps *mapmodel.Universe,
	spaceRuntime *model.SpaceRuntimeState,
	currentTick int64,
) {
	if spaceRuntime == nil || maps == nil {
		return
	}
	for observerID, playerRuntime := range spaceRuntime.Players {
		if playerRuntime == nil {
			continue
		}
		for systemID, systemRuntime := range playerRuntime.Systems {
			if systemRuntime == nil {
				continue
			}
			contacts := make(map[string]*model.SensorContact)
			sources := collectSystemSensorSources(worlds, maps, spaceRuntime, observerID, systemID)
			for targetOwnerID, targetRuntime := range spaceRuntime.Players {
				if targetRuntime == nil || targetOwnerID == observerID {
					continue
				}
				targetSystem := targetRuntime.Systems[systemID]
				if targetSystem == nil {
					continue
				}
				for _, fleet := range targetSystem.Fleets {
					if fleet == nil {
						continue
					}
					targetProfile := fleetTargetProfile(worlds, targetOwnerID, fleet)
					targetAnchor := fleetAnchorPlanetID(worlds, targetOwnerID, fleet)
					eval := model.SensorContactEvaluation{
						ScopeType:       model.SensorContactScopeSystem,
						ScopeID:         systemID,
						ContactKind:     model.SensorContactKindFleet,
						EntityID:        fleet.ID,
						EntityType:      "fleet",
						Domain:          targetProfile.domain,
						PlanetID:        targetAnchor,
						SystemID:        systemID,
						LastUpdated:     currentTick,
						DistancePenalty: systemDistancePenalty(sources, targetAnchor),
						Target:          targetProfile.profile,
						Sources:         sourceInputsForSystemTarget(sources, targetAnchor),
					}
					contact, ghost := model.EvaluateSensorContact(eval)
					if contact != nil {
						contacts[contact.ID] = contact
					}
					if ghost != nil {
						contacts[ghost.ID] = ghost
					}
				}
			}
			systemRuntime.SensorContacts = contacts
		}
	}
}

func collectPlanetSensorSources(ws *model.WorldState, playerID string) []positionedSensorSource {
	if ws == nil {
		return nil
	}
	sources := make([]positionedSensorSource, 0)
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID != playerID || building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		visionRange := float64(max(1, building.VisionRange))
		if visionRange > 0 {
			sources = append(sources, positionedSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourceVision,
					SourceID:   building.ID,
					SourceKind: "building",
					Strength:   2 + visionRange/6,
				},
				position:   clonePosition(building.Position),
				rangeLimit: visionRange,
			})
		}
		combatRange := visionRange
		if building.Runtime.Functions.Combat != nil && building.Runtime.Functions.Combat.Range > 0 {
			combatRange = float64(building.Runtime.Functions.Combat.Range)
		}
		switch building.Type {
		case model.BuildingTypeBattlefieldAnalysisBase:
			sources = append(sources,
				positionedSensorSource{
					input: model.SensorContactSourceInput{
						SourceType: model.SensorSourceActiveRadar,
						SourceID:   building.ID,
						SourceKind: "building",
						Strength:   5 + combatRange/5,
					},
					position:   clonePosition(building.Position),
					rangeLimit: maxFloat(8, combatRange),
				},
				positionedSensorSource{
					input: model.SensorContactSourceInput{
						SourceType: model.SensorSourcePassiveEM,
						SourceID:   building.ID,
						SourceKind: "building",
						Strength:   3 + combatRange/7,
					},
					position:   clonePosition(building.Position),
					rangeLimit: maxFloat(8, combatRange+2),
				},
			)
		case model.BuildingTypeSignalTower:
			sources = append(sources, positionedSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourceSignalTower,
					SourceID:   building.ID,
					SourceKind: "building",
					Strength:   4 + combatRange/6,
				},
				position:   clonePosition(building.Position),
				rangeLimit: maxFloat(10, combatRange+4),
			})
		}
	}

	player := ws.Players[playerID]
	for _, squad := range ws.CombatRuntime.Squads {
		if squad == nil || squad.OwnerID != playerID {
			continue
		}
		blueprint, ok := model.ResolveWarBlueprintForPlayer(player, squad.BlueprintID)
		if !ok {
			continue
		}
		profile := model.ResolveWarBlueprintSensorProfile(blueprint)
		taskForce := model.FindWarTaskForceByMember(player, model.WarTaskForceMemberKindSquad, squad.ID)
		anchor := squadAnchorPosition(ws, squad, taskForce)
		appendBlueprintSensorSources(&sources, clonePosition(anchor), 10+profile.SignalSignature/2, profile, "squad:"+squad.ID)
	}
	return sources
}

func collectSystemSensorSources(
	worlds map[string]*model.WorldState,
	maps *mapmodel.Universe,
	spaceRuntime *model.SpaceRuntimeState,
	playerID, systemID string,
) []anchoredSensorSource {
	sources := make([]anchoredSensorSource, 0)
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		planet, ok := maps.Planet(ws.PlanetID)
		if !ok || planet.SystemID != systemID {
			continue
		}
		for _, building := range ws.Buildings {
			if building == nil || building.OwnerID != playerID || building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
				continue
			}
			switch building.Type {
			case model.BuildingTypeBattlefieldAnalysisBase:
				sources = append(sources, anchoredSensorSource{
					input: model.SensorContactSourceInput{
						SourceType: model.SensorSourceActiveRadar,
						SourceID:   building.ID,
						SourceKind: "building",
						Strength:   5,
					},
					anchorPlanetID: ws.PlanetID,
				})
			case model.BuildingTypeSignalTower:
				sources = append(sources, anchoredSensorSource{
					input: model.SensorContactSourceInput{
						SourceType: model.SensorSourceSignalTower,
						SourceID:   building.ID,
						SourceKind: "building",
						Strength:   4,
					},
					anchorPlanetID: ws.PlanetID,
				})
			}
		}
	}

	playerSystem := spaceRuntime.PlayerSystem(playerID, systemID)
	if playerSystem == nil {
		return sources
	}
	player := playerStateFromWorlds(worlds, playerID)
	for _, fleet := range playerSystem.Fleets {
		if fleet == nil {
			continue
		}
		aggregate := fleetSensorAggregateFor(worlds, player, fleet)
		anchorPlanetID := fleetAnchorPlanetID(worlds, playerID, fleet)
		if aggregate.profile.ActiveRadar > 0 {
			sources = append(sources, anchoredSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourceActiveRadar,
					SourceID:   fleet.ID,
					SourceKind: "fleet",
					Strength:   aggregate.profile.ActiveRadar + 2,
				},
				anchorPlanetID: anchorPlanetID,
			})
		}
		if aggregate.profile.PassiveEM > 0 {
			sources = append(sources, anchoredSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourcePassiveEM,
					SourceID:   fleet.ID,
					SourceKind: "fleet",
					Strength:   aggregate.profile.PassiveEM + aggregate.profile.SignalSupport*0.5,
				},
				anchorPlanetID: anchorPlanetID,
			})
		}
		if aggregate.profile.Infrared > 0 {
			sources = append(sources, anchoredSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourceInfrared,
					SourceID:   fleet.ID,
					SourceKind: "fleet",
					Strength:   aggregate.profile.Infrared,
				},
				anchorPlanetID: anchorPlanetID,
			})
		}
		if aggregate.profile.ReconStrength > 0 {
			sources = append(sources, anchoredSensorSource{
				input: model.SensorContactSourceInput{
					SourceType: model.SensorSourceReconUnit,
					SourceID:   fleet.ID,
					SourceKind: "fleet",
					Strength:   aggregate.profile.ReconStrength,
				},
				anchorPlanetID: anchorPlanetID,
			})
		}
	}
	return sources
}

func appendBlueprintSensorSources(
	sources *[]positionedSensorSource,
	position *model.Position,
	rangeLimit float64,
	profile model.WarSensorProfile,
	sourceID string,
) {
	if position == nil || sourceID == "" {
		return
	}
	if profile.ActiveRadar > 0 {
		*sources = append(*sources, positionedSensorSource{
			input: model.SensorContactSourceInput{
				SourceType: model.SensorSourceActiveRadar,
				SourceID:   sourceID,
				SourceKind: "unit",
				Strength:   profile.ActiveRadar + 1.5,
			},
			position:   clonePosition(*position),
			rangeLimit: rangeLimit,
		})
	}
	if profile.PassiveEM > 0 {
		*sources = append(*sources, positionedSensorSource{
			input: model.SensorContactSourceInput{
				SourceType: model.SensorSourcePassiveEM,
				SourceID:   sourceID,
				SourceKind: "unit",
				Strength:   profile.PassiveEM,
			},
			position:   clonePosition(*position),
			rangeLimit: rangeLimit + 2,
		})
	}
	if profile.ReconStrength > 0 {
		*sources = append(*sources, positionedSensorSource{
			input: model.SensorContactSourceInput{
				SourceType: model.SensorSourceReconUnit,
				SourceID:   sourceID,
				SourceKind: "unit",
				Strength:   profile.ReconStrength,
			},
			position:   clonePosition(*position),
			rangeLimit: rangeLimit,
		})
	}
}

func sourceInputsForPlanetTarget(sources []positionedSensorSource, target model.Position) []model.SensorContactSourceInput {
	inputs := make([]model.SensorContactSourceInput, 0, len(sources))
	for _, source := range sources {
		if source.position == nil {
			continue
		}
		distance := model.CalculateDistance(*source.position, target)
		if source.rangeLimit > 0 && distance > source.rangeLimit {
			continue
		}
		inputs = append(inputs, source.input)
	}
	return inputs
}

func planetDistancePenalty(sources []positionedSensorSource, target model.Position) float64 {
	best := math.MaxFloat64
	for _, source := range sources {
		if source.position == nil {
			continue
		}
		distance := model.CalculateDistance(*source.position, target)
		if source.rangeLimit > 0 && distance > source.rangeLimit {
			continue
		}
		penalty := distance / maxFloat(1, source.rangeLimit) * 4
		if penalty < best {
			best = penalty
		}
	}
	if best == math.MaxFloat64 {
		return 99
	}
	return best
}

func sourceInputsForSystemTarget(sources []anchoredSensorSource, targetAnchor string) []model.SensorContactSourceInput {
	inputs := make([]model.SensorContactSourceInput, 0, len(sources))
	for _, source := range sources {
		if source.input.SourceID == "" {
			continue
		}
		if systemAnchorPenalty(source.anchorPlanetID, targetAnchor) >= 8 {
			continue
		}
		inputs = append(inputs, source.input)
	}
	return inputs
}

func systemDistancePenalty(sources []anchoredSensorSource, targetAnchor string) float64 {
	best := math.MaxFloat64
	for _, source := range sources {
		penalty := systemAnchorPenalty(source.anchorPlanetID, targetAnchor)
		if penalty < best {
			best = penalty
		}
	}
	if best == math.MaxFloat64 {
		return 99
	}
	return best
}

func systemAnchorPenalty(sourceAnchor, targetAnchor string) float64 {
	switch {
	case sourceAnchor == "" || targetAnchor == "":
		return 2.5
	case sourceAnchor == targetAnchor:
		return 0
	default:
		return 6
	}
}

func enemyForceTargetProfile(force model.EnemyForce) model.SensorContactTargetProfile {
	profile := model.SensorContactTargetProfile{
		Classification:   "ground_force",
		ResolvedType:     string(force.Type),
		StrengthEstimate: max(1, force.Strength/20),
		ThreatLevel:      float64(force.Strength) / 20,
	}
	switch force.Type {
	case model.EnemyForceTypeBeacon:
		profile.SignalSignature = 12 + float64(force.Strength)/18
		profile.HeatSignature = 7 + float64(force.Strength)/24
		profile.StealthRating = 3
		profile.JammingStrength = 4.5
	case model.EnemyForceTypeHive:
		profile.SignalSignature = 9 + float64(force.Strength)/20
		profile.HeatSignature = 6 + float64(force.Strength)/25
		profile.StealthRating = 1.5
		profile.JammingStrength = 1.5
	default:
		profile.SignalSignature = 7 + float64(force.Strength)/24
		profile.HeatSignature = 5 + float64(force.Strength)/28
		profile.StealthRating = 1
	}
	return profile
}

func fleetTargetProfile(worlds map[string]*model.WorldState, ownerID string, fleet *model.SpaceFleet) struct {
	domain  model.UnitDomain
	profile model.SensorContactTargetProfile
} {
	player := playerStateFromWorlds(worlds, ownerID)
	aggregate := fleetSensorAggregateFor(worlds, player, fleet)
	target := model.SensorContactTargetProfile{
		Classification:   "space_fleet",
		ResolvedType:     aggregate.dominantBlueprint,
		StrengthEstimate: max(1, aggregate.totalCount),
		SignalSignature:  aggregate.profile.SignalSignature + float64(aggregate.totalCount),
		HeatSignature:    aggregate.profile.HeatSignature + float64(aggregate.totalCount)/2,
		StealthRating:    aggregate.profile.StealthRating,
		JammingStrength:  aggregate.profile.JammingStrength,
		ThreatLevel:      float64(aggregate.totalCount) * 2,
	}
	if fleet.LastAttackTick > 0 || fleet.Weapon.LastFireTick > 0 {
		target.HeatSignature += 2
	}
	return struct {
		domain  model.UnitDomain
		profile model.SensorContactTargetProfile
	}{
		domain:  aggregate.domain,
		profile: target,
	}
}

func fleetSensorAggregateFor(worlds map[string]*model.WorldState, player *model.PlayerState, fleet *model.SpaceFleet) fleetSensorAggregate {
	aggregate := fleetSensorAggregate{}
	if fleet == nil {
		return aggregate
	}
	maxCount := 0
	for _, stack := range fleet.Units {
		if stack.Count <= 0 || stack.BlueprintID == "" {
			continue
		}
		blueprint, ok := model.ResolveWarBlueprintForPlayer(player, stack.BlueprintID)
		if !ok {
			continue
		}
		profile := model.ResolveWarBlueprintSensorProfile(blueprint)
		weight := float64(stack.Count)
		aggregate.totalCount += stack.Count
		aggregate.profile.ActiveRadar += profile.ActiveRadar * weight
		aggregate.profile.PassiveEM += profile.PassiveEM * weight
		aggregate.profile.Infrared += profile.Infrared * weight
		aggregate.profile.SignalSupport += profile.SignalSupport * weight
		aggregate.profile.ReconStrength += profile.ReconStrength * weight
		aggregate.profile.JammingStrength += profile.JammingStrength * weight
		aggregate.profile.StealthRating += profile.StealthRating * weight
		aggregate.profile.SignalSignature += profile.SignalSignature * weight
		aggregate.profile.HeatSignature += profile.HeatSignature * weight
		if stack.Count > maxCount {
			maxCount = stack.Count
			aggregate.dominantBlueprint = stack.BlueprintID
			aggregate.domain = blueprint.Domain
		}
	}
	if aggregate.totalCount <= 0 {
		return aggregate
	}
	scale := float64(aggregate.totalCount)
	aggregate.profile.ActiveRadar /= scale
	aggregate.profile.PassiveEM /= scale
	aggregate.profile.Infrared /= scale
	aggregate.profile.SignalSupport /= scale
	aggregate.profile.ReconStrength /= scale
	aggregate.profile.JammingStrength /= scale
	aggregate.profile.StealthRating /= scale
	aggregate.profile.SignalSignature /= scale
	aggregate.profile.HeatSignature /= scale
	return aggregate
}

func fleetAnchorPlanetID(worlds map[string]*model.WorldState, ownerID string, fleet *model.SpaceFleet) string {
	if fleet == nil {
		return ""
	}
	player := playerStateFromWorlds(worlds, ownerID)
	taskForce := model.FindWarTaskForceByMember(player, model.WarTaskForceMemberKindFleet, fleet.ID)
	if taskForce != nil && taskForce.Deployment != nil && taskForce.Deployment.PlanetID != "" {
		return taskForce.Deployment.PlanetID
	}
	if fleet.AnchorPlanetID != "" {
		return fleet.AnchorPlanetID
	}
	if fleet.SourceBuildingID == "" {
		return ""
	}
	for _, ws := range worlds {
		if ws == nil {
			continue
		}
		if ws.Buildings[fleet.SourceBuildingID] != nil {
			return ws.PlanetID
		}
	}
	return ""
}

func clonePosition(position model.Position) *model.Position {
	copy := position
	return &copy
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func enemyForcesOrEmpty(ws *model.WorldState) []model.EnemyForce {
	if ws == nil || ws.EnemyForces == nil {
		return nil
	}
	return ws.EnemyForces.Forces
}
