package snapshot

import (
	"fmt"

	"siliconworld/internal/model"
)

func clonePlayer(ps *model.PlayerState) *model.PlayerState {
	if ps == nil {
		return nil
	}
	cp := &model.PlayerState{
		PlayerID:      ps.PlayerID,
		TeamID:        ps.TeamID,
		Role:          ps.Role,
		Resources:     ps.Resources,
		Inventory:     ps.Inventory.Clone(),
		IsAlive:       ps.IsAlive,
		Tech:          clonePlayerTechState(ps.Tech),
		CombatTech:    clonePlayerCombatTechState(ps.CombatTech),
		Stats:         clonePlayerStats(ps.Stats),
		WarBlueprints: cloneWarBlueprintMap(ps.WarBlueprints),
		WarIndustry:   cloneWarIndustryState(ps.WarIndustry),
	}
	if len(ps.Permissions) > 0 {
		cp.Permissions = append([]string(nil), ps.Permissions...)
	}
	if ps.Executor != nil {
		exec := *ps.Executor
		cp.Executor = &exec
	}
	if len(ps.Executors) > 0 {
		cp.Executors = make(map[string]*model.ExecutorState, len(ps.Executors))
		for planetID, exec := range ps.Executors {
			if exec == nil {
				continue
			}
			copyExec := *exec
			cp.Executors[planetID] = &copyExec
		}
	}
	return cp
}

func cloneWarBlueprintMap(blueprints map[string]*model.WarBlueprint) map[string]*model.WarBlueprint {
	if len(blueprints) == 0 {
		return nil
	}
	out := make(map[string]*model.WarBlueprint, len(blueprints))
	for id, blueprint := range blueprints {
		out[id] = cloneWarBlueprint(blueprint)
	}
	return out
}

func cloneWarBlueprint(blueprint *model.WarBlueprint) *model.WarBlueprint {
	if blueprint == nil {
		return nil
	}
	return blueprint.Clone()
}

func cloneWarIndustryState(state *model.WarIndustryState) *model.WarIndustryState {
	if state == nil {
		return nil
	}
	return state.Clone()
}

func clonePlayerResearch(research *model.PlayerResearch) *model.PlayerResearch {
	if research == nil {
		return nil
	}
	cp := *research
	cp.RequiredCost = append([]model.ItemAmount(nil), research.RequiredCost...)
	if len(research.ConsumedCost) > 0 {
		cp.ConsumedCost = make(map[string]int, len(research.ConsumedCost))
		for itemID, qty := range research.ConsumedCost {
			cp.ConsumedCost[itemID] = qty
		}
	}
	return &cp
}

func clonePlayerTechState(tech *model.PlayerTechState) *model.PlayerTechState {
	if tech == nil {
		return nil
	}
	cp := &model.PlayerTechState{
		PlayerID:        tech.PlayerID,
		CompletedTechs:  make(map[string]int, len(tech.CompletedTechs)),
		CurrentResearch: clonePlayerResearch(tech.CurrentResearch),
		ResearchQueue:   make([]*model.PlayerResearch, 0, len(tech.ResearchQueue)),
		TotalResearched: tech.TotalResearched,
	}
	for techID, level := range tech.CompletedTechs {
		cp.CompletedTechs[techID] = level
	}
	for _, queued := range tech.ResearchQueue {
		cp.ResearchQueue = append(cp.ResearchQueue, clonePlayerResearch(queued))
	}
	return cp
}

func clonePlayerCombatTechState(state *model.PlayerCombatTechState) *model.PlayerCombatTechState {
	if state == nil {
		return nil
	}
	cp := &model.PlayerCombatTechState{
		PlayerID:         state.PlayerID,
		UnlockedTechs:    make(map[string]*model.CombatTech, len(state.UnlockedTechs)),
		CurrentResearch:  nil,
		ResearchProgress: state.ResearchProgress,
	}
	for id, tech := range state.UnlockedTechs {
		if tech == nil {
			continue
		}
		copyTech := *tech
		cp.UnlockedTechs[id] = &copyTech
	}
	if state.CurrentResearch != nil {
		copyTech := *state.CurrentResearch
		cp.CurrentResearch = &copyTech
	}
	return cp
}

func clonePlayerStats(stats *model.PlayerStats) *model.PlayerStats {
	if stats == nil {
		return nil
	}
	cp := *stats
	cp.ProductionStats.ByBuildingType = make(map[string]int, len(stats.ProductionStats.ByBuildingType))
	for key, value := range stats.ProductionStats.ByBuildingType {
		cp.ProductionStats.ByBuildingType[key] = value
	}
	cp.ProductionStats.ByItem = make(map[string]int, len(stats.ProductionStats.ByItem))
	for key, value := range stats.ProductionStats.ByItem {
		cp.ProductionStats.ByItem[key] = value
	}
	return &cp
}

func cloneUnit(unit *model.Unit) *model.Unit {
	if unit == nil {
		return nil
	}
	cp := *unit
	if unit.TargetPos != nil {
		pos := *unit.TargetPos
		cp.TargetPos = &pos
	}
	return &cp
}

func cloneResource(res *model.ResourceNodeState) *model.ResourceNodeState {
	if res == nil {
		return nil
	}
	cp := *res
	return &cp
}

func clonePipelineNetworkState(state *model.PipelineNetworkState) *model.PipelineNetworkState {
	if state == nil {
		return nil
	}
	return state.Clone()
}

func cloneBlueprintParams(params model.BlueprintParams) model.BlueprintParams {
	if len(params) == 0 {
		return nil
	}
	out := make(model.BlueprintParams, len(params))
	for k, v := range params {
		out[k] = v
	}
	return out
}

func cloneConstructionQueue(q *model.ConstructionQueue) *model.ConstructionQueue {
	if q == nil {
		return nil
	}
	out := &model.ConstructionQueue{
		NextSeq:       q.NextSeq,
		Tasks:         make(map[string]*model.ConstructionTask, len(q.Tasks)),
		Order:         append([]string(nil), q.Order...),
		ReservedTiles: make(map[string]string, len(q.ReservedTiles)),
	}
	for id, task := range q.Tasks {
		if task == nil {
			continue
		}
		cp := *task
		cp.BlueprintParams = cloneBlueprintParams(task.BlueprintParams)
		out.Tasks[id] = &cp
	}
	for key, id := range q.ReservedTiles {
		out.ReservedTiles[key] = id
	}
	return out
}

func cloneBuilding(b *model.Building) *BuildingSnapshot {
	if b == nil {
		return nil
	}
	bs := &BuildingSnapshot{
		ID:               b.ID,
		Type:             b.Type,
		OwnerID:          b.OwnerID,
		Position:         b.Position,
		HP:               b.HP,
		MaxHP:            b.MaxHP,
		Level:            b.Level,
		VisionRange:      b.VisionRange,
		Runtime:          cloneRuntime(b.Runtime),
		Storage:          cloneStorage(b.Storage),
		EnergyStorage:    cloneEnergyStorage(b.EnergyStorage),
		Conveyor:         cloneConveyor(b.Conveyor),
		Sorter:           cloneSorter(b.Sorter),
		LogisticsStation: cloneLogisticsStation(b.LogisticsStation),
	}
	if b.Job != nil {
		bs.Job = &BuildingJobSnapshot{
			Type:           b.Job.Type,
			RemainingTicks: b.Job.RemainingTicks,
			TargetLevel:    b.Job.TargetLevel,
			RefundRate:     b.Job.RefundRate,
			PrevState:      b.Job.PrevState,
		}
	}
	return bs
}

func restoreBuilding(id string, snap *BuildingSnapshot) (*model.Building, error) {
	if snap == nil {
		return nil, fmt.Errorf("building snapshot missing for %s", id)
	}
	if snap.ID != "" && id != "" && snap.ID != id {
		return nil, fmt.Errorf("building id mismatch: %s != %s", snap.ID, id)
	}
	buildingID := snap.ID
	if buildingID == "" {
		buildingID = id
	}
	if buildingID == "" {
		return nil, fmt.Errorf("building id missing")
	}
	mb := &model.Building{
		ID:          buildingID,
		Type:        snap.Type,
		OwnerID:     snap.OwnerID,
		Position:    snap.Position,
		HP:          snap.HP,
		MaxHP:       snap.MaxHP,
		Level:       snap.Level,
		VisionRange: snap.VisionRange,
		Runtime:     cloneRuntime(snap.Runtime),
	}
	if snap.Storage != nil {
		mb.Storage = cloneStorage(snap.Storage)
	} else if mb.Runtime.Functions.Storage != nil {
		return nil, fmt.Errorf("storage snapshot missing for %s", buildingID)
	}
	if snap.EnergyStorage != nil {
		mb.EnergyStorage = cloneEnergyStorage(snap.EnergyStorage)
	} else if mb.Runtime.Functions.EnergyStorage != nil {
		return nil, fmt.Errorf("energy storage snapshot missing for %s", buildingID)
	}
	if snap.Conveyor != nil {
		mb.Conveyor = cloneConveyor(snap.Conveyor)
	} else if model.IsConveyorBuilding(mb.Type) {
		return nil, fmt.Errorf("conveyor snapshot missing for %s", buildingID)
	}
	if snap.Sorter != nil {
		mb.Sorter = cloneSorter(snap.Sorter)
	} else if model.IsSorterBuilding(mb.Type) {
		return nil, fmt.Errorf("sorter snapshot missing for %s", buildingID)
	}
	if snap.LogisticsStation != nil {
		mb.LogisticsStation = cloneLogisticsStation(snap.LogisticsStation)
	} else if model.IsLogisticsStationBuilding(mb.Type) {
		return nil, fmt.Errorf("logistics station snapshot missing for %s", buildingID)
	}
	model.SyncBuildingConveyor(mb)
	model.SyncBuildingSorter(mb)
	model.SyncBuildingLogisticsStation(mb)
	if snap.Job != nil {
		mb.Job = &model.BuildingJob{
			Type:           snap.Job.Type,
			RemainingTicks: snap.Job.RemainingTicks,
			TargetLevel:    snap.Job.TargetLevel,
			RefundRate:     snap.Job.RefundRate,
			PrevState:      snap.Job.PrevState,
		}
	}
	return mb, nil
}

func cloneRuntime(rt model.BuildingRuntime) model.BuildingRuntime {
	clone := rt
	clone.Params.ConnectionPoints = cloneConnectionPoints(rt.Params.ConnectionPoints)
	clone.Params.IOPorts = cloneIOPorts(rt.Params.IOPorts)
	clone.Functions = cloneFunctions(rt.Functions)
	return clone
}

func cloneStorage(storage *model.StorageState) *model.StorageState {
	if storage == nil {
		return nil
	}
	return storage.Clone()
}

func cloneEnergyStorage(storage *model.EnergyStorageState) *model.EnergyStorageState {
	if storage == nil {
		return nil
	}
	return storage.Clone()
}

func cloneConveyor(conveyor *model.ConveyorState) *model.ConveyorState {
	if conveyor == nil {
		return nil
	}
	clone := *conveyor
	if len(conveyor.Buffer) > 0 {
		clone.Buffer = make([]model.ItemStack, len(conveyor.Buffer))
		for i, stack := range conveyor.Buffer {
			clone.Buffer[i] = stack
			if stack.Spray != nil {
				spray := *stack.Spray
				clone.Buffer[i].Spray = &spray
			}
		}
	}
	return &clone
}

func cloneSorter(sorter *model.SorterState) *model.SorterState {
	if sorter == nil {
		return nil
	}
	clone := *sorter
	if len(sorter.InputDirections) > 0 {
		clone.InputDirections = append([]model.ConveyorDirection(nil), sorter.InputDirections...)
	}
	if len(sorter.OutputDirections) > 0 {
		clone.OutputDirections = append([]model.ConveyorDirection(nil), sorter.OutputDirections...)
	}
	if len(sorter.Filter.Items) > 0 {
		clone.Filter.Items = append([]string(nil), sorter.Filter.Items...)
	}
	if len(sorter.Filter.Tags) > 0 {
		clone.Filter.Tags = append([]string(nil), sorter.Filter.Tags...)
	}
	return &clone
}

func cloneLogisticsStation(station *model.LogisticsStationState) *model.LogisticsStationState {
	if station == nil {
		return nil
	}
	return station.Clone()
}

func cloneLogisticsDrone(drone *model.LogisticsDroneState) *model.LogisticsDroneState {
	if drone == nil {
		return nil
	}
	return drone.Clone()
}

func cloneLogisticsShip(ship *model.LogisticsShipState) *model.LogisticsShipState {
	if ship == nil {
		return nil
	}
	return ship.Clone()
}

func cloneConnectionPoints(points []model.ConnectionPoint) []model.ConnectionPoint {
	if len(points) == 0 {
		return nil
	}
	clone := make([]model.ConnectionPoint, len(points))
	copy(clone, points)
	return clone
}

func cloneIOPorts(ports []model.IOPort) []model.IOPort {
	if len(ports) == 0 {
		return nil
	}
	clone := make([]model.IOPort, len(ports))
	for i, port := range ports {
		clone[i] = port
		if len(port.AllowedItems) > 0 {
			clone[i].AllowedItems = append([]string(nil), port.AllowedItems...)
		} else {
			clone[i].AllowedItems = nil
		}
	}
	return clone
}

func cloneFunctions(f model.BuildingFunctionModules) model.BuildingFunctionModules {
	clone := f
	if f.Production != nil {
		mod := *f.Production
		clone.Production = &mod
	}
	if f.Collect != nil {
		mod := *f.Collect
		clone.Collect = &mod
	}
	if f.Transport != nil {
		mod := *f.Transport
		clone.Transport = &mod
	}
	if f.Sorter != nil {
		mod := *f.Sorter
		clone.Sorter = &mod
	}
	if f.Spray != nil {
		mod := *f.Spray
		clone.Spray = &mod
	}
	if f.Storage != nil {
		mod := *f.Storage
		clone.Storage = &mod
	}
	if f.RayReceiver != nil {
		mod := *f.RayReceiver
		clone.RayReceiver = &mod
	}
	if f.EnergyStorage != nil {
		mod := *f.EnergyStorage
		clone.EnergyStorage = &mod
	}
	if f.Energy != nil {
		mod := *f.Energy
		clone.Energy = &mod
	}
	if f.Research != nil {
		mod := *f.Research
		clone.Research = &mod
	}
	if f.Combat != nil {
		mod := *f.Combat
		clone.Combat = &mod
	}
	return clone
}
