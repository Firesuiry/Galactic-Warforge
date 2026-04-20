package gamecore

import (
	"sort"

	"siliconworld/internal/mapmodel"
	"siliconworld/internal/model"
)

type planetaryTaskForceEval struct {
	taskForce    *model.WarTaskForce
	runtime      *model.GroundTaskForceRuntime
	frontline    *model.PlanetaryFrontline
	power        float64
	supportBonus float64
}

func settlePlanetaryWarfare(
	worlds map[string]*model.WorldState,
	maps *mapmodel.Universe,
	spaceRuntime *model.SpaceRuntimeState,
	currentTick int64,
) []*model.GameEvent {
	if len(worlds) == 0 {
		return nil
	}

	var events []*model.GameEvent
	worldIDs := make([]string, 0, len(worlds))
	for planetID := range worlds {
		worldIDs = append(worldIDs, planetID)
	}
	sort.Strings(worldIDs)
	for _, planetID := range worldIDs {
		ws := worlds[planetID]
		if ws == nil {
			continue
		}
		ensurePlanetaryWarfareRuntime(ws)
		syncLandingBridgeheadsToFrontlines(ws, currentTick)
		evals := collectPlanetaryTaskForceEvals(worlds, maps, ws, spaceRuntime, currentTick)
		applyPlanetaryTaskForceEvals(ws, evals, currentTick)
		syncBridgeheadsFromFrontlines(ws, currentTick)
	}
	return events
}

func ensurePlanetaryWarfareRuntime(ws *model.WorldState) {
	if ws == nil {
		return
	}
	if ws.CombatRuntime == nil {
		ws.CombatRuntime = model.NewCombatRuntimeState()
	}
	if ws.CombatRuntime.Frontlines == nil {
		ws.CombatRuntime.Frontlines = make(map[string]*model.PlanetaryFrontline)
	}
	if ws.CombatRuntime.GroundTaskForces == nil {
		ws.CombatRuntime.GroundTaskForces = make(map[string]*model.GroundTaskForceRuntime)
	}
	if ws.CombatRuntime.Bridgeheads == nil {
		ws.CombatRuntime.Bridgeheads = make(map[string]*model.LandingBridgehead)
	}
}

func syncLandingBridgeheadsToFrontlines(ws *model.WorldState, currentTick int64) {
	if ws == nil || ws.CombatRuntime == nil {
		return
	}
	bridgeheadIDs := make([]string, 0, len(ws.CombatRuntime.Bridgeheads))
	for id := range ws.CombatRuntime.Bridgeheads {
		bridgeheadIDs = append(bridgeheadIDs, id)
	}
	sort.Strings(bridgeheadIDs)
	for _, id := range bridgeheadIDs {
		bridgehead := ws.CombatRuntime.Bridgeheads[id]
		if bridgehead == nil {
			continue
		}
		if bridgehead.ExpansionLevel <= 0 {
			bridgehead.ExpansionLevel = 0.35
		}
		if bridgehead.FortificationLevel <= 0 {
			bridgehead.FortificationLevel = 0.25
		}
		if bridgehead.FrontlineID != "" {
			frontline := ws.CombatRuntime.Frontlines[bridgehead.FrontlineID]
			if frontline != nil {
				frontline.OwnerID = bridgehead.OwnerID
				frontline.BridgeheadID = bridgehead.ID
				frontline.Type = model.PlanetaryFrontlineTypeBridgehead
				frontline.UpdatedTick = currentTick
				continue
			}
		}
		frontlineID := ws.CombatRuntime.NextEntityID("frontline")
		frontline := &model.PlanetaryFrontline{
			ID:            frontlineID,
			PlanetID:      ws.PlanetID,
			OwnerID:       bridgehead.OwnerID,
			Type:          model.PlanetaryFrontlineTypeBridgehead,
			BridgeheadID:  bridgehead.ID,
			Status:        model.PlanetaryFrontlineStatusSecured,
			Control:       0.45,
			Fortification: bridgehead.FortificationLevel,
			ObstacleLevel: 0.4,
			SupplyFlow:    0.35,
			UpdatedTick:   currentTick,
		}
		ws.CombatRuntime.Frontlines[frontlineID] = frontline
		bridgehead.FrontlineID = frontlineID
	}
}

func collectPlanetaryTaskForceEvals(
	worlds map[string]*model.WorldState,
	maps *mapmodel.Universe,
	ws *model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	currentTick int64,
) map[string][]*planetaryTaskForceEval {
	if ws == nil || ws.CombatRuntime == nil {
		return nil
	}
	systemID := worldSystemID(maps, ws.PlanetID)
	out := make(map[string][]*planetaryTaskForceEval)
	activeTaskForces := make(map[string]struct{})

	playerIDs := make([]string, 0, len(ws.Players))
	for playerID := range ws.Players {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Strings(playerIDs)
	for _, playerID := range playerIDs {
		player := ws.Players[playerID]
		if player == nil || player.WarCoordination == nil {
			continue
		}
		taskForceIDs := make([]string, 0, len(player.WarCoordination.TaskForces))
		for taskForceID := range player.WarCoordination.TaskForces {
			taskForceIDs = append(taskForceIDs, taskForceID)
		}
		sort.Strings(taskForceIDs)
		for _, taskForceID := range taskForceIDs {
			taskForce := player.WarCoordination.TaskForces[taskForceID]
			if taskForce == nil || taskForce.Deployment == nil || taskForce.Deployment.PlanetID != ws.PlanetID {
				continue
			}
			frontline := resolveTaskForceFrontline(ws, taskForce, currentTick)
			runtime := ensureGroundTaskForceRuntime(ws, taskForce, currentTick)
			runtime.FrontlineID = ""
			runtime.BridgeheadID = ""
			runtime.OrbitalSupportBlockedReason = ""
			if runtime.OrbitalSupportCooldown > 0 {
				runtime.OrbitalSupportCooldown--
			}
			if frontline == nil {
				runtime.Status = model.GroundTaskForceStatusBlocked
				runtime.OrbitalSupportAvailable = false
				runtime.OrbitalSupportBlockedReason = "frontline_not_found"
				runtime.UpdatedTick = currentTick
				activeTaskForces[taskForceID] = struct{}{}
				continue
			}
			runtime.FrontlineID = frontline.ID
			runtime.BridgeheadID = frontline.BridgeheadID
			runtime.OrbitalSupportAvailable = false
			runtime.Pressure = resolveGroundTaskForcePressure(player, taskForce, ws, spaceRuntime)
			supportBonus := resolveGroundTaskForceOrbitalSupport(ws, spaceRuntime, systemID, runtime, currentTick)
			out[frontline.ID] = append(out[frontline.ID], &planetaryTaskForceEval{
				taskForce:    taskForce,
				runtime:      runtime,
				frontline:    frontline,
				power:        runtime.Pressure,
				supportBonus: supportBonus,
			})
			activeTaskForces[taskForceID] = struct{}{}
		}
	}

	for taskForceID := range ws.CombatRuntime.GroundTaskForces {
		if _, ok := activeTaskForces[taskForceID]; ok {
			continue
		}
		delete(ws.CombatRuntime.GroundTaskForces, taskForceID)
	}
	return out
}

func resolveTaskForceFrontline(ws *model.WorldState, taskForce *model.WarTaskForce, currentTick int64) *model.PlanetaryFrontline {
	if ws == nil || ws.CombatRuntime == nil || taskForce == nil || taskForce.Deployment == nil {
		return nil
	}
	if taskForce.Deployment.FrontlineID != "" {
		if frontline := ws.CombatRuntime.Frontlines[taskForce.Deployment.FrontlineID]; frontline != nil {
			return frontline
		}
	}
	for _, bridgehead := range ws.CombatRuntime.Bridgeheads {
		if bridgehead != nil && bridgehead.OwnerID == taskForce.OwnerID && bridgehead.FrontlineID != "" {
			if frontline := ws.CombatRuntime.Frontlines[bridgehead.FrontlineID]; frontline != nil {
				return frontline
			}
		}
	}
	if taskForce.Deployment.Position == nil {
		return nil
	}
	frontlineID := ws.CombatRuntime.NextEntityID("frontline")
	frontline := &model.PlanetaryFrontline{
		ID:            frontlineID,
		PlanetID:      ws.PlanetID,
		OwnerID:       taskForce.OwnerID,
		Type:          model.PlanetaryFrontlineTypeOutpost,
		Position:      taskForce.Deployment.Position,
		Status:        model.PlanetaryFrontlineStatusContested,
		Control:       0.35,
		Fortification: 0.2,
		ObstacleLevel: 0.3,
		SupplyFlow:    0.25,
		UpdatedTick:   currentTick,
	}
	ws.CombatRuntime.Frontlines[frontlineID] = frontline
	taskForce.Deployment.FrontlineID = frontlineID
	return frontline
}

func ensureGroundTaskForceRuntime(ws *model.WorldState, taskForce *model.WarTaskForce, currentTick int64) *model.GroundTaskForceRuntime {
	runtime := ws.CombatRuntime.GroundTaskForces[taskForce.ID]
	if runtime == nil {
		runtime = &model.GroundTaskForceRuntime{
			TaskForceID: taskForce.ID,
			OwnerID:     taskForce.OwnerID,
			PlanetID:    ws.PlanetID,
		}
		ws.CombatRuntime.GroundTaskForces[taskForce.ID] = runtime
	}
	runtime.OwnerID = taskForce.OwnerID
	runtime.PlanetID = ws.PlanetID
	runtime.GroundOrder = taskForce.Deployment.GroundOrder
	if runtime.GroundOrder == "" {
		runtime.GroundOrder = defaultGroundOrderForStance(taskForce.Stance)
	}
	runtime.OrbitalSupportMode = taskForce.Deployment.OrbitalSupportMode
	if runtime.OrbitalSupportMode == "" {
		runtime.OrbitalSupportMode = model.OrbitalSupportModeNone
	}
	runtime.Status = defaultGroundTaskForceStatus(runtime.GroundOrder)
	runtime.Progress = 0
	runtime.UpdatedTick = currentTick
	return runtime
}

func defaultGroundOrderForStance(stance model.WarTaskForceStance) model.GroundTaskForceOrder {
	switch stance {
	case model.WarTaskForceStanceSiege, model.WarTaskForceStanceBombard:
		return model.GroundTaskForceOrderAdvance
	case model.WarTaskForceStanceEscort:
		return model.GroundTaskForceOrderEscortSupply
	case model.WarTaskForceStanceHold:
		return model.GroundTaskForceOrderHold
	default:
		return model.GroundTaskForceOrderOccupy
	}
}

func defaultGroundTaskForceStatus(order model.GroundTaskForceOrder) model.GroundTaskForceStatus {
	switch order {
	case model.GroundTaskForceOrderHold:
		return model.GroundTaskForceStatusHolding
	case model.GroundTaskForceOrderClearObstacle:
		return model.GroundTaskForceStatusClearing
	case model.GroundTaskForceOrderEscortSupply:
		return model.GroundTaskForceStatusSupplying
	case model.GroundTaskForceOrderAdvance:
		return model.GroundTaskForceStatusSecuring
	default:
		return model.GroundTaskForceStatusStaging
	}
}

func resolveGroundTaskForcePressure(
	player *model.PlayerState,
	taskForce *model.WarTaskForce,
	ws *model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
) float64 {
	if player == nil || taskForce == nil || ws == nil || ws.CombatRuntime == nil {
		return 0
	}
	power := 0.0
	for _, member := range taskForce.Members {
		if member.Kind != model.WarTaskForceMemberKindSquad {
			continue
		}
		squad := ws.CombatRuntime.Squads[member.EntityID]
		if squad == nil || squad.State == model.CombatSquadStateDestroyed {
			continue
		}
		base := 1.2 + float64(max(1, squad.Count))
		base += float64(max(1, squad.Weapon.Damage)) / 18
		base += float64(max(1, squad.HP)) / float64(max(1, squad.MaxHP))
		switch squad.PlatformClass {
		case "drone":
			base += 0.4
		case "vehicle":
			base += 0.7
		default:
			base += 0.9
		}
		if squad.Sustainment.DamagePenalty > 0 {
			base *= 1 - min(0.7, squad.Sustainment.DamagePenalty*0.5)
		}
		power += base
	}
	status := model.EvaluateWarTaskForce(player, taskForce, map[string]*model.WorldState{ws.PlanetID: ws}, spaceRuntime)
	if status.CoordinationPenalty > 0 {
		power *= 1 - min(0.5, status.CoordinationPenalty*0.35)
	}
	if power < 0.5 {
		power = 0.5
	}
	switch taskForce.Deployment.GroundOrder {
	case model.GroundTaskForceOrderAdvance, model.GroundTaskForceOrderOccupy:
		power *= 1.15
	case model.GroundTaskForceOrderHold:
		power *= 1.05
	case model.GroundTaskForceOrderEscortSupply:
		power *= 0.9
	}
	return roundOrbitalFloat(power)
}

func resolveGroundTaskForceOrbitalSupport(
	ws *model.WorldState,
	spaceRuntime *model.SpaceRuntimeState,
	systemID string,
	runtime *model.GroundTaskForceRuntime,
	currentTick int64,
) float64 {
	if runtime == nil {
		return 0
	}
	if runtime.OrbitalSupportMode == model.OrbitalSupportModeNone {
		runtime.OrbitalSupportAvailable = false
		return 0
	}
	if runtime.OrbitalSupportCooldown > 0 {
		runtime.OrbitalSupportAvailable = false
		return 0
	}
	warfare := (*model.SystemWarfareRuntime)(nil)
	if spaceRuntime != nil {
		warfare = spaceRuntime.SystemWarfare(systemID)
	}
	if warfare == nil || warfare.OrbitalSuperiority == nil || warfare.OrbitalSuperiority.AdvantagePlayerID != runtime.OwnerID {
		runtime.OrbitalSupportBlockedReason = "no_orbital_superiority"
		runtime.OrbitalSupportAvailable = false
		return 0
	}

	defensePressure, shieldAbsorbed := enemyPlanetaryOrbitalDefense(ws, runtime.OwnerID)
	effectiveness := 1 - min(0.85, defensePressure/6)
	if shieldAbsorbed > 0 {
		effectiveness -= min(0.4, float64(shieldAbsorbed)/200)
	}
	if effectiveness <= 0.18 {
		runtime.OrbitalSupportBlockedReason = "planetary_defense_screen"
		runtime.OrbitalSupportAvailable = false
		return 0
	}

	multiplier := 1.0
	cooldown := 2
	if runtime.OrbitalSupportMode == model.OrbitalSupportModeStrike {
		multiplier = 1.25
		cooldown = 3
	}
	runtime.LastOrbitalSupportTick = currentTick
	runtime.OrbitalSupportCooldown = cooldown
	runtime.OrbitalSupportAvailable = false
	return roundOrbitalFloat(multiplier * (0.9 + effectiveness))
}

func enemyPlanetaryOrbitalDefense(ws *model.WorldState, attackerID string) (float64, int) {
	if ws == nil {
		return 0, 0
	}
	pressure := 0.0
	shieldAbsorbed := 0
	owners := make(map[string]struct{})
	for _, building := range ws.Buildings {
		if building == nil || building.OwnerID == "" || building.OwnerID == attackerID {
			continue
		}
		if building.HP <= 0 || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		owners[building.OwnerID] = struct{}{}
		switch building.Type {
		case model.BuildingTypePlanetaryShieldGenerator:
			pressure += 1.8
		case model.BuildingTypeMissileTurret, model.BuildingTypePlasmaTurret, model.BuildingTypeSRPlasmaTurret:
			pressure += 1.4
		case model.BuildingTypeImplosionCannon:
			pressure += 1.7
		case model.BuildingTypeLaserTurret, model.BuildingTypeGaussTurret:
			pressure += 0.9
		case model.BuildingTypeJammerTower:
			pressure += 1.1
		case model.BuildingTypeSignalTower:
			pressure += 0.4
		}
	}
	ownerIDs := make([]string, 0, len(owners))
	for ownerID := range owners {
		ownerIDs = append(ownerIDs, ownerID)
	}
	sort.Strings(ownerIDs)
	for _, ownerID := range ownerIDs {
		absorbed, _ := absorbPlanetaryShieldDamage(ws, ownerID, 40)
		shieldAbsorbed += absorbed
	}
	return pressure, shieldAbsorbed
}

func applyPlanetaryTaskForceEvals(ws *model.WorldState, evals map[string][]*planetaryTaskForceEval, currentTick int64) {
	if ws == nil || ws.CombatRuntime == nil {
		return
	}
	frontlineIDs := make([]string, 0, len(ws.CombatRuntime.Frontlines))
	for frontlineID := range ws.CombatRuntime.Frontlines {
		frontlineIDs = append(frontlineIDs, frontlineID)
	}
	sort.Strings(frontlineIDs)
	for _, frontlineID := range frontlineIDs {
		frontline := ws.CombatRuntime.Frontlines[frontlineID]
		if frontline == nil {
			continue
		}
		normalizePlanetaryFrontline(frontline)
		group := evals[frontlineID]
		if len(group) == 0 {
			if frontline.OwnerID != "" {
				frontline.Control = clampBattleFloat(frontline.Control+0.03, 0, 1)
				if frontline.Control >= 0.85 {
					frontline.Status = model.PlanetaryFrontlineStatusSecured
				}
			}
			frontline.UpdatedTick = currentTick
			continue
		}

		sides := make(map[string]float64)
		ownerOrders := make(map[string]model.GroundTaskForceOrder)
		for _, eval := range group {
			if eval == nil || eval.runtime == nil {
				continue
			}
			total := eval.power + eval.supportBonus
			sides[eval.runtime.OwnerID] += total
			ownerOrders[eval.runtime.OwnerID] = eval.runtime.GroundOrder

			switch eval.runtime.GroundOrder {
			case model.GroundTaskForceOrderHold:
				if frontline.OwnerID == eval.runtime.OwnerID {
					frontline.Fortification += 0.08
				}
				eval.runtime.Status = model.GroundTaskForceStatusHolding
				eval.runtime.Progress = roundOrbitalFloat(frontline.Fortification)
			case model.GroundTaskForceOrderClearObstacle:
				frontline.ObstacleLevel -= 0.14
				eval.runtime.Status = model.GroundTaskForceStatusClearing
				eval.runtime.Progress = roundOrbitalFloat(1 - clampBattleFloat(frontline.ObstacleLevel, 0, 1))
			case model.GroundTaskForceOrderEscortSupply:
				frontline.SupplyFlow += 0.12
				eval.runtime.Status = model.GroundTaskForceStatusSupplying
				eval.runtime.Progress = roundOrbitalFloat(frontline.SupplyFlow)
			}
			if eval.supportBonus > 0 && frontline.OwnerID != "" && frontline.OwnerID != eval.runtime.OwnerID {
				frontline.Fortification -= 0.12 + eval.supportBonus*0.04
				frontline.LastOrbitalSupportTick = currentTick
			}
		}

		topOwner, topPower, secondPower := dominantPlanetarySide(sides)
		ratio := 1.0
		if secondPower > 0 {
			ratio = topPower / secondPower
		}
		if ratio < 1 {
			ratio = 1
		}
		if frontline.OwnerID == "" && topOwner != "" {
			frontline.OwnerID = topOwner
			frontline.Control = 0.35
		}
		if topOwner != "" {
			if frontline.OwnerID == topOwner {
				frontline.Control += 0.08 * min(2, ratio)
			} else {
				frontline.Control -= 0.12 * min(2, ratio)
				if frontline.Control <= 0.15 {
					if frontline.BridgeheadID == "" && frontline.Fortification <= 0.05 {
						frontline.OwnerID = ""
						frontline.Control = 0
						frontline.Status = model.PlanetaryFrontlineStatusDestroyed
					} else {
						frontline.OwnerID = topOwner
						frontline.Control = 0.35
					}
				}
			}
		}

		frontline.Control = clampBattleFloat(frontline.Control, 0, 1)
		frontline.Fortification = clampBattleFloat(frontline.Fortification, 0, 1)
		frontline.ObstacleLevel = clampBattleFloat(frontline.ObstacleLevel, 0, 1)
		frontline.SupplyFlow = clampBattleFloat(frontline.SupplyFlow, 0, 1)
		if frontline.Status != model.PlanetaryFrontlineStatusDestroyed {
			if len(sides) > 1 || frontline.Control < 0.85 {
				frontline.Status = model.PlanetaryFrontlineStatusContested
			} else {
				frontline.Status = model.PlanetaryFrontlineStatusSecured
			}
		}
		frontline.UpdatedTick = currentTick

		for _, eval := range group {
			if eval == nil || eval.runtime == nil {
				continue
			}
			switch eval.runtime.GroundOrder {
			case model.GroundTaskForceOrderHold:
				eval.runtime.Status = model.GroundTaskForceStatusHolding
				eval.runtime.Progress = frontline.Fortification
			case model.GroundTaskForceOrderClearObstacle:
				eval.runtime.Status = model.GroundTaskForceStatusClearing
				eval.runtime.Progress = 1 - frontline.ObstacleLevel
			case model.GroundTaskForceOrderEscortSupply:
				eval.runtime.Status = model.GroundTaskForceStatusSupplying
				eval.runtime.Progress = frontline.SupplyFlow
			default:
				if frontline.OwnerID == eval.runtime.OwnerID && frontline.Control >= 0.85 {
					eval.runtime.Status = model.GroundTaskForceStatusSecuring
				} else {
					eval.runtime.Status = model.GroundTaskForceStatusContesting
				}
				eval.runtime.Progress = frontline.Control
			}
			eval.runtime.FrontlineID = frontline.ID
			eval.runtime.BridgeheadID = frontline.BridgeheadID
			eval.runtime.UpdatedTick = currentTick
		}

		if order, ok := ownerOrders[topOwner]; ok && topOwner == frontline.OwnerID && frontline.BridgeheadID != "" {
			if bridgehead := ws.CombatRuntime.Bridgeheads[frontline.BridgeheadID]; bridgehead != nil {
				switch order {
				case model.GroundTaskForceOrderAdvance, model.GroundTaskForceOrderOccupy:
					bridgehead.ExpansionLevel = clampBattleFloat(bridgehead.ExpansionLevel+0.08, 0, 1)
				case model.GroundTaskForceOrderHold, model.GroundTaskForceOrderEscortSupply:
					bridgehead.ExpansionLevel = clampBattleFloat(bridgehead.ExpansionLevel+0.05, 0, 1)
				}
			}
		}
	}
}

func dominantPlanetarySide(sides map[string]float64) (string, float64, float64) {
	type scoredSide struct {
		ownerID string
		score   float64
	}
	scores := make([]scoredSide, 0, len(sides))
	for ownerID, score := range sides {
		if ownerID == "" || score <= 0 {
			continue
		}
		scores = append(scores, scoredSide{ownerID: ownerID, score: score})
	}
	sort.Slice(scores, func(i, j int) bool {
		if scores[i].score == scores[j].score {
			return scores[i].ownerID < scores[j].ownerID
		}
		return scores[i].score > scores[j].score
	})
	if len(scores) == 0 {
		return "", 0, 0
	}
	second := 0.0
	if len(scores) > 1 {
		second = scores[1].score
	}
	return scores[0].ownerID, scores[0].score, second
}

func normalizePlanetaryFrontline(frontline *model.PlanetaryFrontline) {
	if frontline == nil {
		return
	}
	frontline.Fortification = clampBattleFloat(frontline.Fortification*0.98, 0, 1)
	frontline.SupplyFlow = clampBattleFloat(maxFloat(0.1, frontline.SupplyFlow*0.96), 0, 1)
	frontline.ObstacleLevel = clampBattleFloat(frontline.ObstacleLevel, 0, 1)
	frontline.Control = clampBattleFloat(frontline.Control, 0, 1)
	if frontline.Status == "" {
		frontline.Status = model.PlanetaryFrontlineStatusContested
	}
}

func syncBridgeheadsFromFrontlines(ws *model.WorldState, currentTick int64) {
	if ws == nil || ws.CombatRuntime == nil {
		return
	}
	for _, bridgehead := range ws.CombatRuntime.Bridgeheads {
		if bridgehead == nil || bridgehead.FrontlineID == "" {
			continue
		}
		frontline := ws.CombatRuntime.Frontlines[bridgehead.FrontlineID]
		if frontline == nil {
			continue
		}
		bridgehead.Contested = frontline.Status == model.PlanetaryFrontlineStatusContested
		bridgehead.FortificationLevel = frontline.Fortification
		if frontline.LastOrbitalSupportTick > bridgehead.LastSupportTick {
			bridgehead.LastSupportTick = frontline.LastOrbitalSupportTick
		}
		if frontline.OwnerID == bridgehead.OwnerID {
			bridgehead.ExpansionLevel = clampBattleFloat(maxFloat(bridgehead.ExpansionLevel, frontline.Control*0.9+frontline.SupplyFlow*0.1), 0, 1)
			bridgehead.Status = model.LandingBridgeheadStatusActive
		} else {
			bridgehead.ExpansionLevel = clampBattleFloat(bridgehead.ExpansionLevel-0.12, 0, 1)
			if bridgehead.ExpansionLevel <= 0.05 {
				bridgehead.Status = model.LandingBridgeheadStatusCollapsed
			}
		}
		if bridgehead.FortificationLevel <= 0 {
			bridgehead.FortificationLevel = 0.1
		}
		if bridgehead.LastSupportTick == 0 {
			bridgehead.LastSupportTick = currentTick
		}
	}
}
