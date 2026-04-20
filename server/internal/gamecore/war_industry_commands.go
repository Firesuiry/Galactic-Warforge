package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

func (gc *GameCore) execQueueMilitaryProduction(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	blueprintID, err := payloadStrictString(cmd.Payload, "blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	count, err := payloadStrictInt(cmd.Payload, "count")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if count <= 0 {
		res.Code = model.CodeValidationFailed
		res.Message = "payload.count must be positive"
		return res, nil
	}

	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, buildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	blueprint, ok := model.ResolveWarBlueprintDefinition(player, blueprintID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("blueprint %s not found", blueprintID)
		return res, nil
	}
	if !model.WarBlueprintProductionAllowed(blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("blueprint %s is not finalized for military production", blueprint.ID)
		return res, nil
	}
	if err := requireUnitTechUnlocked(ws, playerID, blueprint.VisibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot produce blueprint %s", building.ID, blueprint.ID)
		return res, nil
	}
	spec, err := model.WarBlueprintManufacturingSpecForDefinition(blueprint)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	totalCost := normalizeMilitaryCost(append(append([]model.ItemAmount(nil), spec.ComponentCost...), spec.AssemblyCost...), count)
	if err := consumeMilitaryInputs(building, player, totalCost); err != nil {
		res.Code = model.CodeInsufficientResource
		res.Message = err.Error()
		return res, nil
	}

	model.InitBuildingDeploymentState(building)
	state := building.DeploymentState
	lastBlueprintID, seriesStreak := queuedLinePreview(state)
	for i := 0; i < count; i++ {
		retoolTicks := 0
		seriesBonus := 0.0
		if lastBlueprintID != "" && lastBlueprintID != blueprint.ID {
			retoolTicks = militaryRetoolTicks(blueprint.Domain)
			seriesStreak = 0
		}
		if lastBlueprintID == blueprint.ID {
			seriesStreak++
			seriesBonus = militarySeriesBonus(seriesStreak)
		} else {
			lastBlueprintID = blueprint.ID
			seriesStreak = 1
		}
		state.ProductionQueue = append(state.ProductionQueue, &model.MilitaryProductionOrder{
			ID:                      ws.NextEntityID("mprod"),
			BlueprintID:             blueprint.ID,
			BlueprintName:           blueprint.Name,
			BaseID:                  blueprint.BaseID(),
			Domain:                  blueprint.Domain,
			RuntimeClass:            blueprint.RuntimeClass,
			Stage:                   model.MilitaryProductionStageComponent,
			Status:                  model.MilitaryOrderStatusQueued,
			ComponentTicksTotal:     spec.ComponentTicks,
			ComponentTicksRemaining: spec.ComponentTicks,
			AssemblyTicksTotal:      applySeriesBonus(spec.AssemblyTicks, seriesBonus),
			AssemblyTicksRemaining:  applySeriesBonus(spec.AssemblyTicks, seriesBonus),
			RetoolTicksTotal:        retoolTicks,
			RetoolTicksRemaining:    retoolTicks,
			SeriesBonusRatio:        seriesBonus,
			QueuedTick:              ws.Tick,
			LastUpdateTick:          ws.Tick,
			ComponentCost:           append([]model.ItemAmount(nil), spec.ComponentCost...),
			AssemblyCost:            append([]model.ItemAmount(nil), spec.AssemblyCost...),
		})
		lastBlueprintID = blueprint.ID
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("queued %d military production order(s) for %s", count, blueprint.ID)
	res.Details = map[string]any{
		"building_id":  building.ID,
		"blueprint_id": blueprint.ID,
		"count":        count,
	}
	return res, nil
}

func (gc *GameCore) execRefitUnit(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	unitID, err := payloadStrictString(cmd.Payload, "unit_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	targetBlueprintID, err := payloadStrictString(cmd.Payload, "target_blueprint_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	building, deployment, result := requireOwnedDeploymentHub(ws, playerID, buildingID)
	if result != nil {
		return *result, nil
	}
	player := ws.Players[playerID]
	targetBlueprint, ok := model.ResolveWarBlueprintDefinition(player, targetBlueprintID)
	if !ok {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("target blueprint %s not found", targetBlueprintID)
		return res, nil
	}
	if !model.WarBlueprintProductionAllowed(targetBlueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("target blueprint %s is not finalized for refit", targetBlueprint.ID)
		return res, nil
	}
	if err := requireUnitTechUnlocked(ws, playerID, targetBlueprint.VisibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, targetBlueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot refit blueprint %s", building.ID, targetBlueprint.ID)
		return res, nil
	}
	order, err := gc.createMilitaryRefitOrder(ws, playerID, building, targetBlueprint, unitID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if err := consumeMilitaryInputs(building, player, order.RefitCost); err != nil {
		res.Code = model.CodeInsufficientResource
		res.Message = err.Error()
		return res, nil
	}

	model.InitBuildingDeploymentState(building)
	building.DeploymentState.RefitQueue = append(building.DeploymentState.RefitQueue, order)

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("unit %s entered refit toward %s", unitID, targetBlueprint.ID)
	res.Details = map[string]any{
		"building_id":          building.ID,
		"unit_id":              unitID,
		"target_blueprint_id":  targetBlueprint.ID,
		"refit_order_id":       order.ID,
	}
	return res, nil
}

func (gc *GameCore) createMilitaryRefitOrder(
	ws *model.WorldState,
	playerID string,
	building *model.Building,
	targetBlueprint model.WarBlueprintDefinition,
	unitID string,
) (*model.MilitaryRefitOrder, error) {
	if ws != nil && ws.CombatRuntime != nil {
		if squad := ws.CombatRuntime.Squads[unitID]; squad != nil {
			if squad.OwnerID != playerID {
				return nil, fmt.Errorf("cannot refit unit owned by another player")
			}
			sourceBlueprint, ok := model.ResolveWarBlueprintDefinition(ws.Players[playerID], runtimeBlueprintIDForSquad(squad))
			if !ok {
				return nil, fmt.Errorf("source blueprint %s not found", runtimeBlueprintIDForSquad(squad))
			}
			if sourceBlueprint.BaseID() != targetBlueprint.BaseID() || sourceBlueprint.RuntimeClass != targetBlueprint.RuntimeClass {
				return nil, fmt.Errorf("refit target must share the same base chassis and runtime class")
			}
			refitCost, refitTicks, err := model.WarBlueprintRefitCost(sourceBlueprint, targetBlueprint)
			if err != nil {
				return nil, err
			}
			delete(ws.CombatRuntime.Squads, unitID)
			return &model.MilitaryRefitOrder{
				ID:                ws.NextEntityID("mrefit"),
				UnitID:            unitID,
				SourceBlueprintID: sourceBlueprint.ID,
				TargetBlueprintID: targetBlueprint.ID,
				TargetName:        targetBlueprint.Name,
				BaseID:            targetBlueprint.BaseID(),
				Domain:            targetBlueprint.Domain,
				RuntimeClass:      targetBlueprint.RuntimeClass,
				Count:             squad.Count,
				Status:            model.MilitaryOrderStatusQueued,
				QueuedTick:        ws.Tick,
				LastUpdateTick:    ws.Tick,
				TotalTicks:        refitTicks,
				RemainingTicks:    refitTicks,
				RefitCost:         refitCost,
				SourceBuildingID:  squad.SourceBuildingID,
				ReturnPlanetID:    squad.PlanetID,
			}, nil
		}
	}
	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, unitID)
	if fleet == nil || systemRuntime == nil {
		return nil, fmt.Errorf("unit %s not found", unitID)
	}
	if len(fleet.Units) != 1 {
		return nil, fmt.Errorf("fleet %s contains mixed stacks and cannot be refit as one unit", unitID)
	}
	stack := fleet.Units[0]
	sourceBlueprintID := stack.BlueprintID
	if sourceBlueprintID == "" {
		sourceBlueprintID = stack.UnitType
	}
	sourceBlueprint, ok := model.ResolveWarBlueprintDefinition(ws.Players[playerID], sourceBlueprintID)
	if !ok {
		return nil, fmt.Errorf("source blueprint %s not found", sourceBlueprintID)
	}
	if sourceBlueprint.BaseID() != targetBlueprint.BaseID() || sourceBlueprint.RuntimeClass != targetBlueprint.RuntimeClass {
		return nil, fmt.Errorf("refit target must share the same base chassis and runtime class")
	}
	refitCost, refitTicks, err := model.WarBlueprintRefitCost(sourceBlueprint, targetBlueprint)
	if err != nil {
		return nil, err
	}
	delete(systemRuntime.Fleets, fleet.ID)
	return &model.MilitaryRefitOrder{
		ID:                ws.NextEntityID("mrefit"),
		UnitID:            fleet.ID,
		SourceBlueprintID: sourceBlueprint.ID,
		TargetBlueprintID: targetBlueprint.ID,
		TargetName:        targetBlueprint.Name,
		BaseID:            targetBlueprint.BaseID(),
		Domain:            targetBlueprint.Domain,
		RuntimeClass:      targetBlueprint.RuntimeClass,
		Count:             stack.Count,
		Status:            model.MilitaryOrderStatusQueued,
		QueuedTick:        ws.Tick,
		LastUpdateTick:    ws.Tick,
		TotalTicks:        refitTicks,
		RemainingTicks:    refitTicks,
		RefitCost:         refitCost,
		SourceBuildingID:  fleet.SourceBuildingID,
		ReturnSystemID:    fleet.SystemID,
	}, nil
}

func (gc *GameCore) settleMilitaryIndustry(ws *model.WorldState) []*model.GameEvent {
	if ws == nil || len(ws.Buildings) == 0 {
		return nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if building == nil || building.Runtime.Functions.Deployment == nil {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var events []*model.GameEvent
	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil || building.Runtime.Functions.Deployment == nil {
			continue
		}
		model.InitBuildingDeploymentState(building)
		state := building.DeploymentState
		if state == nil {
			continue
		}
		operational, _ := buildingOperationalForCommand(ws, building)
		if len(state.ProductionQueue) > 0 {
			order := state.ProductionQueue[0]
			if !operational {
				order.Status = model.MilitaryOrderStatusPaused
			} else if settleProductionOrder(building, order) {
				state.LineState = advanceLineState(state.LineState, order.BlueprintID)
				addPayloadInventory(state.PayloadInventory, order.BlueprintID, 1)
				state.ProductionQueue = state.ProductionQueue[1:]
			}
			order.LastUpdateTick = ws.Tick
		}
		if len(state.RefitQueue) > 0 {
			order := state.RefitQueue[0]
			if !operational {
				order.Status = model.MilitaryOrderStatusPaused
			} else if settleRefitOrder(order) {
				if evt := gc.completeMilitaryRefitOrder(ws, building, order); evt != nil {
					events = append(events, evt...)
				}
				state.RefitQueue = state.RefitQueue[1:]
			}
			order.LastUpdateTick = ws.Tick
		}
	}
	return events
}

func settleProductionOrder(building *model.Building, order *model.MilitaryProductionOrder) bool {
	if building == nil || order == nil {
		return false
	}
	order.Status = model.MilitaryOrderStatusRunning
	module := building.Runtime.Functions.Deployment
	if order.RetoolTicksRemaining > 0 {
		order.RetoolTicksRemaining--
		return false
	}
	if order.Stage == model.MilitaryProductionStageComponent && order.ComponentTicksRemaining > 0 {
		order.ComponentTicksRemaining--
		if order.ComponentTicksRemaining == 0 {
			order.Stage = model.MilitaryProductionStageAssembly
		}
		return false
	}
	if order.Stage == model.MilitaryProductionStageAssembly && order.AssemblyTicksRemaining > 0 {
		if module != nil && module.PayloadCapacity > 0 && deploymentHubPayloadTotal(building.DeploymentState) >= module.PayloadCapacity {
			order.Status = model.MilitaryOrderStatusPaused
			return false
		}
		order.AssemblyTicksRemaining--
		if order.AssemblyTicksRemaining == 0 {
			order.Status = model.MilitaryOrderStatusCompleted
			return true
		}
	}
	return false
}

func settleRefitOrder(order *model.MilitaryRefitOrder) bool {
	if order == nil {
		return false
	}
	order.Status = model.MilitaryOrderStatusRunning
	if order.RemainingTicks > 0 {
		order.RemainingTicks--
	}
	if order.RemainingTicks == 0 {
		order.Status = model.MilitaryOrderStatusCompleted
		return true
	}
	return false
}

func (gc *GameCore) completeMilitaryRefitOrder(ws *model.WorldState, building *model.Building, order *model.MilitaryRefitOrder) []*model.GameEvent {
	if gc == nil || order == nil || building == nil {
		return nil
	}
	player := ws.Players[building.OwnerID]
	targetBlueprint, ok := model.ResolveWarBlueprintDefinition(player, order.TargetBlueprintID)
	if !ok {
		return nil
	}
	switch order.RuntimeClass {
	case model.UnitRuntimeClassCombatSquad:
		targetWorld := gc.WorldForPlanet(order.ReturnPlanetID)
		if targetWorld == nil {
			targetWorld = ws
		}
		if targetWorld.CombatRuntime == nil {
			targetWorld.CombatRuntime = model.NewCombatRuntimeState()
		}
		squad := newCombatSquad(order.UnitID, building.OwnerID, targetWorld.PlanetID, building.ID, targetBlueprint, order.Count)
		targetWorld.CombatRuntime.Squads[squad.ID] = squad
		return []*model.GameEvent{{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: building.OwnerID,
			Payload: map[string]any{
				"entity_type": "combat_squad",
				"entity_id":   squad.ID,
				"squad":       squad,
			},
		}}
	case model.UnitRuntimeClassFleet:
		if gc.spaceRuntime == nil {
			gc.spaceRuntime = model.NewSpaceRuntimeState()
		}
		systemRuntime := gc.spaceRuntime.EnsurePlayerSystem(building.OwnerID, order.ReturnSystemID)
		fleet := &model.SpaceFleet{
			ID:               order.UnitID,
			OwnerID:          building.OwnerID,
			SystemID:         order.ReturnSystemID,
			SourceBuildingID: building.ID,
			Formation:        model.FormationTypeLine,
			State:            model.FleetStateIdle,
		}
		addFleetUnits(fleet, targetBlueprint, order.Count)
		rebuildFleetStats(ws.Players[building.OwnerID], fleet)
		systemRuntime.Fleets[fleet.ID] = fleet
		return []*model.GameEvent{{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: building.OwnerID,
			Payload: map[string]any{
				"entity_type": "fleet",
				"entity_id":   fleet.ID,
				"fleet":       fleet,
			},
		}}
	default:
		return nil
	}
}

func consumeMilitaryInputs(building *model.Building, player *model.PlayerState, cost []model.ItemAmount) error {
	if len(cost) == 0 {
		return nil
	}
	if building == nil || player == nil {
		return fmt.Errorf("military production requires building and player state")
	}
	for _, item := range cost {
		required := item.Quantity
		if required <= 0 {
			continue
		}
		available := 0
		if building.Storage != nil {
			available += building.Storage.OutputQuantity(item.ItemID)
		}
		if player.Inventory != nil {
			available += player.Inventory[item.ItemID]
		}
		if available < required {
			return fmt.Errorf("need %d %s for military production", required, item.ItemID)
		}
	}
	for _, item := range cost {
		required := item.Quantity
		if required <= 0 {
			continue
		}
		if building.Storage != nil {
			provided, remaining, err := building.Storage.Provide(item.ItemID, required)
			if err != nil {
				return err
			}
			required = remaining
			_ = provided
		}
		if required > 0 {
			player.Inventory[item.ItemID] -= required
			if player.Inventory[item.ItemID] <= 0 {
				delete(player.Inventory, item.ItemID)
			}
		}
	}
	return nil
}

func normalizeMilitaryCost(items []model.ItemAmount, multiplier int) []model.ItemAmount {
	if multiplier <= 1 {
		return model.NormalizeWarIndustryCost(items)
	}
	scaled := make([]model.ItemAmount, 0, len(items))
	for _, item := range items {
		scaled = append(scaled, model.ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity * multiplier})
	}
	return model.NormalizeWarIndustryCost(scaled)
}

func queuedLinePreview(state *model.DeploymentHubState) (string, int) {
	if state == nil {
		return "", 0
	}
	lastBlueprintID := state.LineState.LastBlueprintID
	seriesStreak := state.LineState.SeriesStreak
	for _, order := range state.ProductionQueue {
		if order == nil {
			continue
		}
		if order.BlueprintID == lastBlueprintID {
			seriesStreak++
		} else {
			lastBlueprintID = order.BlueprintID
			seriesStreak = 1
		}
	}
	return lastBlueprintID, seriesStreak
}

func militarySeriesBonus(streak int) float64 {
	if streak <= 1 {
		return 0
	}
	bonus := float64(streak-1) * 0.08
	if bonus > 0.24 {
		bonus = 0.24
	}
	return bonus
}

func militaryRetoolTicks(domain model.UnitDomain) int {
	switch domain {
	case model.UnitDomainSpace:
		return 24
	case model.UnitDomainAir:
		return 18
	default:
		return 16
	}
}

func applySeriesBonus(total int, ratio float64) int {
	if total <= 1 || ratio <= 0 {
		return total
	}
	reduced := total - int(float64(total)*ratio+0.5)
	if reduced < 1 {
		return 1
	}
	return reduced
}

func advanceLineState(state model.DeploymentHubLineState, blueprintID string) model.DeploymentHubLineState {
	if blueprintID == "" {
		return state
	}
	if state.LastBlueprintID == blueprintID {
		state.SeriesStreak++
	} else {
		state.LastBlueprintID = blueprintID
		state.SeriesStreak = 1
	}
	return state
}

func deploymentAllowsBlueprint(module *model.DeploymentModule, blueprint model.WarBlueprintDefinition) bool {
	if module == nil {
		return false
	}
	if len(module.AllowedDomains) == 0 {
		return true
	}
	for _, domain := range module.AllowedDomains {
		if domain == blueprint.Domain {
			return true
		}
	}
	return false
}

func deploymentHubPayloadTotal(state *model.DeploymentHubState) int {
	if state == nil || len(state.PayloadInventory) == 0 {
		return 0
	}
	total := 0
	for _, qty := range state.PayloadInventory {
		if qty > 0 {
			total += qty
		}
	}
	return total
}

func addPayloadInventory(inv model.ItemInventory, blueprintID string, qty int) {
	if blueprintID == "" || qty <= 0 {
		return
	}
	if inv == nil {
		return
	}
	inv[blueprintID] += qty
}

func runtimeBlueprintIDForSquad(squad *model.CombatSquad) string {
	if squad == nil {
		return ""
	}
	if squad.BlueprintID != "" {
		return squad.BlueprintID
	}
	return squad.UnitType
}
