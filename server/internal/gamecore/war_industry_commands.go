package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

func (gc *GameCore) execQueueMilitaryProduction(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = fmt.Sprintf("player %s not found", playerID)
		return res, nil
	}

	buildingID, err := payloadStrictString(cmd.Payload, "building_id")
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	deploymentHubID, err := payloadStrictString(cmd.Payload, "deployment_hub_id")
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

	factory := ws.Buildings[buildingID]
	if factory == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if factory.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if factory.Runtime.Functions.Production == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = "target building is not a military production facility"
		return res, nil
	}
	if ok, reason := buildingOperationalForCommand(ws, factory); !ok {
		res.Code = model.CodeInvalidTarget
		if reason == "" {
			reason = "not_operational"
		}
		res.Message = fmt.Sprintf("production facility is not operational: %s", reason)
		return res, nil
	}

	hub, deployment, hubErr := requireOwnedDeploymentHub(ws, playerID, deploymentHubID)
	if hubErr != nil {
		return *hubErr, nil
	}

	blueprint, visibleTechID, err := resolveIndustryBlueprint(player, blueprintID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if !deploymentAllowsBlueprint(deployment, blueprint) {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("building %s cannot deploy blueprint %s", hub.ID, blueprint.ID)
		return res, nil
	}

	industry := player.EnsureWarIndustry()
	line := ensureWarProductionLine(industry, buildingID)
	referenceBlueprintID := line.LastBlueprintID
	if line.ActiveOrderID != "" {
		if active := industry.ProductionOrders[line.ActiveOrderID]; active != nil {
			referenceBlueprintID = active.BlueprintID
		}
	}
	repeatBonusPercent := 0
	retoolTicks := int64(0)
	if referenceBlueprintID != "" {
		if referenceBlueprintID == blueprint.ID {
			runs := line.ConsecutiveRuns
			if runs <= 0 {
				runs = 1
			}
			repeatBonusPercent = minWarInt(20, runs*5)
		} else {
			retoolTicks = 45
		}
	}
	componentCost, assemblyCost := deriveMilitaryProductionCost(blueprint)
	totalCost := mergeItemAmounts(scaleItemAmounts(componentCost, count), scaleItemAmounts(assemblyCost, count))
	if !player.HasItems(totalCost) {
		res.Code = model.CodeInsufficientResource
		res.Message = "insufficient inventory for military production order"
		return res, nil
	}

	hubCapacity := deploymentHubCapacity(deployment)
	projectedLoad := readyPayloadTotal(industry, hub.ID)
	for _, order := range industry.ProductionOrders {
		if order == nil || order.DeploymentHubID != hub.ID || order.Status == model.WarOrderStatusCompleted {
			continue
		}
		projectedLoad += order.Count - order.CompletedCount
	}
	if hubCapacity > 0 && projectedLoad+count > hubCapacity {
		res.Code = model.CodeValidationFailed
		res.Message = fmt.Sprintf("deployment hub %s capacity %d would be exceeded", hub.ID, hubCapacity)
		return res, nil
	}

	player.DeductItems(totalCost)
	orderID := nextWarIndustryID(industry, "war-prod")
	componentTicks, assemblyTicks := deriveMilitaryProductionTicks(factory, blueprint, repeatBonusPercent)
	order := &model.WarProductionOrder{
		ID:                 orderID,
		FactoryBuildingID:  factory.ID,
		DeploymentHubID:    hub.ID,
		BlueprintID:        blueprint.ID,
		Domain:             blueprint.Domain,
		Count:              count,
		Status:             model.WarOrderStatusQueued,
		Stage:              model.WarProductionStageComponents,
		ComponentTicks:     componentTicks,
		AssemblyTicks:      assemblyTicks,
		RetoolTicks:        retoolTicks,
		RepeatBonusPercent: repeatBonusPercent,
		QueueIndex:         industry.NextOrderSeq,
		CreatedTick:        ws.Tick,
		UpdatedTick:        ws.Tick,
	}
	industry.ProductionOrders[orderID] = order
	ensureWarDeploymentHubState(industry, hub.ID, hubCapacity).UpdatedTick = ws.Tick

	if line.ActiveOrderID == "" {
		startWarProductionOrder(line, order, ws.Tick)
	}

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("military production order %s queued for %s x%d", order.ID, blueprint.ID, count)
	return res, []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: playerID,
		Payload: map[string]any{
			"entity_type": "war_production_order",
			"entity_id":   order.ID,
			"order":       order,
		},
	}}
}

func (gc *GameCore) execRefitUnit(ws *model.WorldState, playerID string, cmd model.Command) (model.CommandResult, []*model.GameEvent) {
	res := model.CommandResult{Status: model.StatusFailed}
	player := ws.Players[playerID]
	if player == nil {
		res.Code = model.CodeUnauthorized
		res.Message = fmt.Sprintf("player %s not found", playerID)
		return res, nil
	}

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

	building := ws.Buildings[buildingID]
	if building == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("building %s not found", buildingID)
		return res, nil
	}
	if building.OwnerID != playerID {
		res.Code = model.CodeNotOwner
		res.Message = "cannot use building owned by another player"
		return res, nil
	}
	if building.Runtime.Functions.Production == nil {
		res.Code = model.CodeInvalidTarget
		res.Message = "target building is not a refit facility"
		return res, nil
	}
	if ok, reason := buildingOperationalForCommand(ws, building); !ok {
		res.Code = model.CodeInvalidTarget
		if reason == "" {
			reason = "not_operational"
		}
		res.Message = fmt.Sprintf("refit facility is not operational: %s", reason)
		return res, nil
	}

	targetBlueprint, visibleTechID, err := resolveIndustryBlueprint(player, targetBlueprintID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if err := requireBlueprintTechUnlocked(ws, playerID, visibleTechID); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}

	industry := player.EnsureWarIndustry()

	if squad := ws.CombatRuntime.Squads[unitID]; squad != nil {
		if squad.OwnerID != playerID {
			res.Code = model.CodeNotOwner
			res.Message = "cannot refit squad owned by another player"
			return res, nil
		}
		sourceBlueprint, _, err := resolveIndustryBlueprint(player, squad.BlueprintID)
		if err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		if err := validateRefitBlueprintChange(sourceBlueprint, targetBlueprint); err != nil {
			res.Code = model.CodeValidationFailed
			res.Message = err.Error()
			return res, nil
		}
		cost := deriveRefitCost(sourceBlueprint, targetBlueprint, squad.Count)
		if !player.HasItems(cost) {
			res.Code = model.CodeInsufficientResource
			res.Message = "insufficient inventory for refit order"
			return res, nil
		}
		player.DeductItems(cost)
		delete(ws.CombatRuntime.Squads, unitID)

		order := &model.WarRefitOrder{
			ID:                nextWarIndustryID(industry, "war-refit"),
			BuildingID:        building.ID,
			UnitID:            squad.ID,
			UnitKind:          model.WarRefitUnitKindSquad,
			SourcePlanetID:    squad.PlanetID,
			SourceBuildingID:  squad.SourceBuildingID,
			SourceBlueprintID: squad.BlueprintID,
			TargetBlueprintID: targetBlueprint.ID,
			Count:             squad.Count,
			Status:            model.WarOrderStatusInProgress,
			TotalTicks:        deriveRefitTicks(building, sourceBlueprint, targetBlueprint),
			CreatedTick:       ws.Tick,
			UpdatedTick:       ws.Tick,
			QueueIndex:        industry.NextOrderSeq,
			RepairTier:        model.WarRepairTierOverhaul,
		}
		order.RemainingTicks = order.TotalTicks
		industry.RefitOrders[order.ID] = order

		res.Status = model.StatusExecuted
		res.Code = model.CodeOK
		res.Message = fmt.Sprintf("refit order %s started for squad %s", order.ID, squad.ID)
		return res, nil
	}

	systemRuntime, fleet := findOwnedFleet(gc.spaceRuntime, playerID, unitID)
	if fleet == nil || systemRuntime == nil {
		res.Code = model.CodeEntityNotFound
		res.Message = fmt.Sprintf("unit %s not found", unitID)
		return res, nil
	}
	if len(fleet.Units) != 1 {
		res.Code = model.CodeValidationFailed
		res.Message = "refit_unit currently requires a homogeneous fleet"
		return res, nil
	}
	sourceBlueprint, _, err := resolveIndustryBlueprint(player, fleet.Units[0].BlueprintID)
	if err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	if err := validateRefitBlueprintChange(sourceBlueprint, targetBlueprint); err != nil {
		res.Code = model.CodeValidationFailed
		res.Message = err.Error()
		return res, nil
	}
	cost := deriveRefitCost(sourceBlueprint, targetBlueprint, fleet.Units[0].Count)
	if !player.HasItems(cost) {
		res.Code = model.CodeInsufficientResource
		res.Message = "insufficient inventory for refit order"
		return res, nil
	}
	player.DeductItems(cost)
	delete(systemRuntime.Fleets, fleet.ID)

	order := &model.WarRefitOrder{
		ID:                nextWarIndustryID(industry, "war-refit"),
		BuildingID:        building.ID,
		UnitID:            fleet.ID,
		UnitKind:          model.WarRefitUnitKindFleet,
		SourceSystemID:    systemRuntime.SystemID,
		SourceBuildingID:  fleet.SourceBuildingID,
		SourceBlueprintID: fleet.Units[0].BlueprintID,
		TargetBlueprintID: targetBlueprint.ID,
		Count:             fleet.Units[0].Count,
		FleetFormation:    fleet.Formation,
		Status:            model.WarOrderStatusInProgress,
		TotalTicks:        deriveRefitTicks(building, sourceBlueprint, targetBlueprint),
		CreatedTick:       ws.Tick,
		UpdatedTick:       ws.Tick,
		QueueIndex:        industry.NextOrderSeq,
		RepairTier:        model.WarRepairTierOverhaul,
	}
	order.RemainingTicks = order.TotalTicks
	industry.RefitOrders[order.ID] = order

	res.Status = model.StatusExecuted
	res.Code = model.CodeOK
	res.Message = fmt.Sprintf("refit order %s started for fleet %s", order.ID, fleet.ID)
	return res, nil
}

func settleWarIndustry(ws *model.WorldState, spaceRuntime *model.SpaceRuntimeState, currentTick int64) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	playerIDs := make([]string, 0, len(ws.Players))
	for playerID := range ws.Players {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Strings(playerIDs)

	var events []*model.GameEvent
	for _, playerID := range playerIDs {
		player := ws.Players[playerID]
		if player == nil || player.WarIndustry == nil {
			continue
		}
		industry := player.WarIndustry

		lineIDs := make([]string, 0, len(industry.ProductionLines))
		for buildingID := range industry.ProductionLines {
			lineIDs = append(lineIDs, buildingID)
		}
		sort.Strings(lineIDs)
		for _, buildingID := range lineIDs {
			line := industry.ProductionLines[buildingID]
			if line == nil {
				continue
			}
			if line.ActiveOrderID == "" {
				if next := nextQueuedProductionOrder(industry, buildingID); next != nil {
					startWarProductionOrder(line, next, currentTick)
				}
			}
			if line.ActiveOrderID == "" {
				continue
			}
			order := industry.ProductionOrders[line.ActiveOrderID]
			if order == nil || order.Status != model.WarOrderStatusInProgress {
				line.ActiveOrderID = ""
				continue
			}
			if order.StageRemainingTicks > 0 {
				order.StageRemainingTicks--
				order.UpdatedTick = currentTick
			}
			if order.StageRemainingTicks > 0 {
				continue
			}

			switch order.Stage {
			case model.WarProductionStageComponents:
				order.Stage = model.WarProductionStageAssembly
				order.StageTotalTicks = order.AssemblyTicks
				order.StageRemainingTicks = order.AssemblyTicks
				order.RetoolTicks = 0
				order.UpdatedTick = currentTick
			case model.WarProductionStageAssembly:
				hub := ensureWarDeploymentHubState(industry, order.DeploymentHubID, 0)
				hub.ReadyPayloads[order.BlueprintID]++
				hub.UpdatedTick = currentTick
				order.CompletedCount++
				order.UpdatedTick = currentTick
				if order.CompletedCount >= order.Count {
					order.Stage = model.WarProductionStageReady
					order.Status = model.WarOrderStatusCompleted
					order.StageRemainingTicks = 0
					order.StageTotalTicks = 0
					line.ActiveOrderID = ""
					if line.LastBlueprintID == order.BlueprintID {
						line.ConsecutiveRuns++
					} else {
						line.LastBlueprintID = order.BlueprintID
						line.ConsecutiveRuns = 1
					}
					line.LastCompletedTick = currentTick
				} else {
					order.Stage = model.WarProductionStageComponents
					order.StageTotalTicks = order.ComponentTicks
					order.StageRemainingTicks = order.ComponentTicks
				}
			}
		}

		refitIDs := make([]string, 0, len(industry.RefitOrders))
		for orderID := range industry.RefitOrders {
			refitIDs = append(refitIDs, orderID)
		}
		sort.Strings(refitIDs)
		for _, orderID := range refitIDs {
			order := industry.RefitOrders[orderID]
			if order == nil || order.Status != model.WarOrderStatusInProgress {
				continue
			}
			if order.RemainingTicks > 0 {
				order.RemainingTicks--
				order.UpdatedTick = currentTick
			}
			if order.RemainingTicks > 0 {
				continue
			}

			targetBlueprint, _, err := resolveIndustryBlueprint(player, order.TargetBlueprintID)
			if err != nil {
				order.Status = model.WarOrderStatusBlocked
				continue
			}
			switch order.UnitKind {
			case model.WarRefitUnitKindSquad:
				if ws.CombatRuntime == nil {
					ws.CombatRuntime = model.NewCombatRuntimeState()
				}
				squad := newCombatSquad(ws, playerID, order.UnitID, order.SourcePlanetID, order.SourceBuildingID, targetBlueprint.ID, order.Count)
				ws.CombatRuntime.Squads[squad.ID] = squad
				events = append(events, &model.GameEvent{
					EventType:       model.EvtSquadDeployed,
					VisibilityScope: playerID,
					Payload: map[string]any{
						"squad_id": squad.ID,
						"squad":    squad,
						"source":   "refit",
					},
				})
			case model.WarRefitUnitKindFleet:
				if spaceRuntime == nil {
					continue
				}
				systemRuntime := spaceRuntime.EnsurePlayerSystem(playerID, order.SourceSystemID)
				if systemRuntime == nil {
					continue
				}
				fleet := &model.SpaceFleet{
					ID:               order.UnitID,
					OwnerID:          playerID,
					SystemID:         order.SourceSystemID,
					SourceBuildingID: order.SourceBuildingID,
					Formation:        order.FleetFormation,
					State:            model.FleetStateIdle,
					Units:            []model.FleetUnitStack{{BlueprintID: targetBlueprint.ID, Count: order.Count}},
				}
				rebuildFleetStats(ws, playerID, fleet)
				systemRuntime.Fleets[fleet.ID] = fleet
				events = append(events, &model.GameEvent{
					EventType:       model.EvtFleetCommissioned,
					VisibilityScope: playerID,
					Payload: map[string]any{
						"fleet_id": fleet.ID,
						"fleet":    fleet,
						"source":   "refit",
					},
				})
			}
			order.Status = model.WarOrderStatusCompleted
			order.UpdatedTick = currentTick
		}
	}
	return events
}

func resolveIndustryBlueprint(player *model.PlayerState, blueprintID string) (model.WarBlueprint, string, error) {
	if player == nil {
		return model.WarBlueprint{}, "", fmt.Errorf("player not found")
	}
	blueprint, ok := model.ResolveWarBlueprintForPlayer(player, blueprintID)
	if !ok {
		return model.WarBlueprint{}, "", fmt.Errorf("blueprint %s not found", blueprintID)
	}
	if blueprint.Source != model.WarBlueprintSourcePreset {
		switch blueprint.State {
		case model.WarBlueprintStatePrototype, model.WarBlueprintStateFieldTested, model.WarBlueprintStateAdopted:
		default:
			return model.WarBlueprint{}, "", fmt.Errorf("blueprint %s must be finalized before production or refit", blueprint.ID)
		}
	}
	return blueprint, blueprintVisibleTechID(blueprint), nil
}

func blueprintVisibleTechID(blueprint model.WarBlueprint) string {
	if entry, ok := model.PublicWarBlueprintByID(blueprint.ID); ok {
		return entry.VisibleTechID
	}
	if parent, ok := model.PublicWarBlueprintByID(blueprint.ParentBlueprintID); ok {
		return parent.VisibleTechID
	}
	index := model.PublicWarBlueprintCatalogIndex()
	if blueprint.BaseFrameID != "" {
		if frame, ok := index.BaseFrameByID(blueprint.BaseFrameID); ok {
			return frame.VisibleTechID
		}
	}
	if blueprint.BaseHullID != "" {
		if hull, ok := index.BaseHullByID(blueprint.BaseHullID); ok {
			return hull.VisibleTechID
		}
	}
	return ""
}

func deriveMilitaryProductionCost(blueprint model.WarBlueprint) ([]model.ItemAmount, []model.ItemAmount) {
	index := model.PublicWarBlueprintCatalogIndex()
	componentCost := map[string]int{}
	assemblyCost := map[string]int{}

	for _, slot := range blueprint.Components {
		component, ok := index.ComponentByID(slot.ComponentID)
		if !ok {
			continue
		}
		componentCost[model.ItemCircuitBoard]++
		switch component.Category {
		case model.WarComponentCategoryPower:
			componentCost[model.ItemProcessor]++
			componentCost[model.ItemTitaniumAlloy]++
		case model.WarComponentCategoryPropulsion:
			componentCost[model.ItemProcessor]++
			componentCost[model.ItemFrameMaterial]++
		case model.WarComponentCategoryDefense:
			componentCost[model.ItemTitaniumAlloy]++
			if hasComponentTag(component, "shield") {
				componentCost[model.ItemPhotonCombiner]++
			}
		case model.WarComponentCategorySensor:
			componentCost[model.ItemProcessor]++
			componentCost[model.ItemMicrocrystalline]++
		case model.WarComponentCategoryWeapon:
			componentCost[model.ItemProcessor]++
			componentCost[model.ItemEnergeticGraphite]++
			if hasComponentTag(component, "missile") {
				componentCost[model.ItemAmmoMissile]++
			}
		case model.WarComponentCategoryUtility:
			componentCost[model.ItemCircuitBoard]++
			if hasComponentTag(component, "repair") {
				componentCost[model.ItemGraphene]++
			}
		}
	}

	if blueprint.BaseHullID != "" {
		assemblyCost[model.ItemFrameMaterial] += 2
		assemblyCost[model.ItemTitaniumAlloy] += 2
		assemblyCost[model.ItemQuantumChip]++
		assemblyCost[model.ItemDeuteriumFuelRod]++
	} else {
		assemblyCost[model.ItemFrameMaterial]++
		assemblyCost[model.ItemTitaniumAlloy]++
		assemblyCost[model.ItemProcessor]++
	}

	return itemAmountsFromMap(componentCost), itemAmountsFromMap(assemblyCost)
}

func deriveMilitaryProductionTicks(factory *model.Building, blueprint model.WarBlueprint, repeatBonusPercent int) (int64, int64) {
	throughput := 1
	if factory != nil && factory.Runtime.Functions.Production != nil && factory.Runtime.Functions.Production.Throughput > 0 {
		throughput = factory.Runtime.Functions.Production.Throughput
	}
	componentTicks := int64(30 + len(blueprint.Components)*10)
	assemblyTicks := int64(40 + len(blueprint.Components)*12)
	if blueprint.BaseHullID != "" {
		componentTicks += 20
		assemblyTicks += 30
	}
	if repeatBonusPercent > 0 {
		componentTicks = componentTicks * int64(100-repeatBonusPercent) / 100
		assemblyTicks = assemblyTicks * int64(100-repeatBonusPercent) / 100
	}
	componentTicks = maxInt64(8, componentTicks/int64(throughput))
	assemblyTicks = maxInt64(12, assemblyTicks/int64(throughput))
	return componentTicks, assemblyTicks
}

func deriveRefitCost(source, target model.WarBlueprint, count int) []model.ItemAmount {
	costMap := map[string]int{
		model.ItemTitaniumAlloy: count,
		model.ItemFrameMaterial: count,
	}
	sourceComponents := source.ComponentsBySlot()
	targetComponents := target.ComponentsBySlot()
	for slotID, componentID := range targetComponents {
		if sourceComponents[slotID] == componentID {
			continue
		}
		costMap[model.ItemProcessor] += count
		costMap[model.ItemCircuitBoard] += count
	}
	return itemAmountsFromMap(costMap)
}

func deriveRefitTicks(building *model.Building, source, target model.WarBlueprint) int64 {
	changedSlots := 1
	sourceComponents := source.ComponentsBySlot()
	targetComponents := target.ComponentsBySlot()
	for slotID, componentID := range targetComponents {
		if sourceComponents[slotID] != componentID {
			changedSlots++
		}
	}
	throughput := 1
	if building != nil && building.Runtime.Functions.Production != nil && building.Runtime.Functions.Production.Throughput > 0 {
		throughput = building.Runtime.Functions.Production.Throughput
	}
	total := int64(40 + changedSlots*20)
	if target.BaseHullID != "" {
		total += 30
	}
	return maxInt64(12, total/int64(throughput))
}

func validateRefitBlueprintChange(source, target model.WarBlueprint) error {
	if source.Domain != target.Domain {
		return fmt.Errorf("refit target %s must stay in domain %s", target.ID, source.Domain)
	}
	if source.BaseFrameID != target.BaseFrameID || source.BaseHullID != target.BaseHullID {
		return fmt.Errorf("refit target %s must reuse the same base frame or hull", target.ID)
	}
	return nil
}

func ensureWarProductionLine(industry *model.WarIndustryState, buildingID string) *model.WarProductionLineState {
	if industry == nil {
		return nil
	}
	if industry.ProductionLines == nil {
		industry.ProductionLines = make(map[string]*model.WarProductionLineState)
	}
	line := industry.ProductionLines[buildingID]
	if line == nil {
		line = &model.WarProductionLineState{BuildingID: buildingID}
		industry.ProductionLines[buildingID] = line
	}
	return line
}

func ensureWarDeploymentHubState(industry *model.WarIndustryState, buildingID string, capacity int) *model.WarDeploymentHubState {
	if industry == nil {
		return nil
	}
	if industry.DeploymentHubs == nil {
		industry.DeploymentHubs = make(map[string]*model.WarDeploymentHubState)
	}
	hub := industry.DeploymentHubs[buildingID]
	if hub == nil {
		hub = &model.WarDeploymentHubState{
			BuildingID:    buildingID,
			ReadyPayloads: make(map[string]int),
		}
		industry.DeploymentHubs[buildingID] = hub
	}
	if hub.ReadyPayloads == nil {
		hub.ReadyPayloads = make(map[string]int)
	}
	if capacity > 0 {
		hub.Capacity = capacity
	}
	return hub
}

func startWarProductionOrder(line *model.WarProductionLineState, order *model.WarProductionOrder, tick int64) {
	if line == nil || order == nil {
		return
	}
	line.ActiveOrderID = order.ID
	order.Status = model.WarOrderStatusInProgress
	order.Stage = model.WarProductionStageComponents
	order.StageTotalTicks = order.ComponentTicks + order.RetoolTicks
	order.StageRemainingTicks = order.StageTotalTicks
	order.UpdatedTick = tick
}

func nextQueuedProductionOrder(industry *model.WarIndustryState, buildingID string) *model.WarProductionOrder {
	if industry == nil {
		return nil
	}
	var selected *model.WarProductionOrder
	for _, order := range industry.ProductionOrders {
		if order == nil || order.FactoryBuildingID != buildingID || order.Status != model.WarOrderStatusQueued {
			continue
		}
		if selected == nil || order.QueueIndex < selected.QueueIndex {
			selected = order
		}
	}
	return selected
}

func deploymentHubCapacity(module *model.DeploymentModule) int {
	if module == nil {
		return 0
	}
	return module.SquadCapacity*4 + module.FleetCapacity*2
}

func readyPayloadTotal(industry *model.WarIndustryState, hubID string) int {
	if industry == nil || industry.DeploymentHubs == nil {
		return 0
	}
	hub := industry.DeploymentHubs[hubID]
	if hub == nil {
		return 0
	}
	total := 0
	for _, count := range hub.ReadyPayloads {
		total += count
	}
	return total
}

func nextWarIndustryID(industry *model.WarIndustryState, prefix string) string {
	industry.NextOrderSeq++
	return fmt.Sprintf("%s-%d", prefix, industry.NextOrderSeq)
}

func scaleItemAmounts(items []model.ItemAmount, factor int) []model.ItemAmount {
	if factor <= 0 || len(items) == 0 {
		return nil
	}
	out := make([]model.ItemAmount, 0, len(items))
	for _, item := range items {
		if item.Quantity <= 0 {
			continue
		}
		out = append(out, model.ItemAmount{ItemID: item.ItemID, Quantity: item.Quantity * factor})
	}
	return out
}

func mergeItemAmounts(groups ...[]model.ItemAmount) []model.ItemAmount {
	merged := map[string]int{}
	for _, group := range groups {
		for _, item := range group {
			if item.Quantity <= 0 {
				continue
			}
			merged[item.ItemID] += item.Quantity
		}
	}
	return itemAmountsFromMap(merged)
}

func itemAmountsFromMap(items map[string]int) []model.ItemAmount {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for itemID, qty := range items {
		if qty > 0 {
			ids = append(ids, itemID)
		}
	}
	sort.Strings(ids)
	out := make([]model.ItemAmount, 0, len(ids))
	for _, itemID := range ids {
		out = append(out, model.ItemAmount{ItemID: itemID, Quantity: items[itemID]})
	}
	return out
}

func hasComponentTag(component model.WarComponentCatalogEntry, tag string) bool {
	for _, current := range component.Tags {
		if current == tag {
			return true
		}
	}
	return false
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func minWarInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
