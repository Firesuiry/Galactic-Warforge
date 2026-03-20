package gamecore

import (
	"fmt"

	"siliconworld/internal/model"
)

const (
	constructionRegionSize          = 8
	defaultConstructionDurationTick = 1
)

func constructionRegionKey(ws *model.WorldState, pos model.Position) string {
	if ws == nil {
		return ""
	}
	size := constructionRegionSize
	if size <= 0 {
		size = 1
	}
	rx := pos.X / size
	ry := pos.Y / size
	return fmt.Sprintf("%s:%d:%d", ws.PlanetID, rx, ry)
}

func (gc *GameCore) constructionRegionLimit() int {
	if gc == nil || gc.cfg == nil {
		return 1
	}
	limit := gc.cfg.Battlefield.ConstructionRegionConcurrentLimit
	if limit <= 0 {
		return 1
	}
	return limit
}

func executorConcurrentLimit(ws *model.WorldState, playerID string) int {
	if ws == nil {
		return 1
	}
	player := ws.Players[playerID]
	if player == nil || player.Executor == nil {
		return 1
	}
	if player.Executor.ConcurrentTasks <= 0 {
		return 1
	}
	return player.Executor.ConcurrentTasks
}

func countActiveConstructionByRegion(ws *model.WorldState) map[string]int {
	counts := make(map[string]int)
	if ws == nil || ws.Construction == nil {
		return counts
	}
	for _, task := range ws.Construction.Tasks {
		if task == nil || task.State != model.ConstructionInProgress {
			continue
		}
		counts[task.RegionID]++
	}
	return counts
}

func (gc *GameCore) settleConstructionQueue(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	if ws.Construction == nil {
		ws.Construction = model.NewConstructionQueue()
	} else {
		ws.Construction.EnsureInit()
	}

	currentTick := ws.Tick
	events := make([]*model.GameEvent, 0)

	activeByPlayer := countActiveExecutorUsage(ws)
	activeByRegion := countActiveConstructionByRegion(ws)
	regionLimit := gc.constructionRegionLimit()

	for _, id := range ws.Construction.Order {
		task := ws.Construction.Tasks[id]
		if task == nil || task.State != model.ConstructionPending {
			continue
		}
		playerLimit := executorConcurrentLimit(ws, task.PlayerID)
		if activeByPlayer[task.PlayerID] >= playerLimit {
			continue
		}
		if regionLimit > 0 && activeByRegion[task.RegionID] >= regionLimit {
			continue
		}
		if err := ws.Construction.Transition(task.ID, model.ConstructionInProgress); err != nil {
			continue
		}
		task.StartTick = currentTick
		task.UpdateTick = currentTick
		if task.TotalTicks <= 0 {
			task.TotalTicks = defaultConstructionDurationTick
		}
		if task.RemainingTicks <= 0 {
			task.RemainingTicks = task.TotalTicks
		}
		activeByPlayer[task.PlayerID]++
		activeByRegion[task.RegionID]++
	}

	var completed []string
	for id, task := range ws.Construction.Tasks {
		if task == nil || task.State != model.ConstructionInProgress {
			continue
		}
		if task.StartTick >= currentTick {
			continue
		}
		if task.RemainingTicks > 0 {
			task.RemainingTicks--
		}
		task.UpdateTick = currentTick
		if task.RemainingTicks > 0 {
			continue
		}
		evts, err := gc.completeConstructionTask(ws, task)
		if err != nil {
			task.Error = err.Error()
			_ = ws.Construction.Transition(task.ID, model.ConstructionCancelled)
			refundConstructionCost(ws, task)
			completed = append(completed, id)
			continue
		}
		_ = ws.Construction.Transition(task.ID, model.ConstructionCompleted)
		events = append(events, evts...)
		completed = append(completed, id)
	}

	for _, id := range completed {
		ws.Construction.Remove(id)
	}

	return events
}

func refundConstructionCost(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil {
		return
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return
	}
	player.Resources.Minerals += task.Cost.Minerals
	player.Resources.Energy += task.Cost.Energy
	player.AddItems(task.Cost.Items)
}

// refundConstructionRefund refunds a portion of the construction cost based on remaining progress.
// For pending tasks (not yet started): full refund.
// For in_progress tasks: refund proportional to remaining ticks / total ticks.
func refundConstructionRefund(ws *model.WorldState, task *model.ConstructionTask) {
	if ws == nil || task == nil {
		return
	}
	player := ws.Players[task.PlayerID]
	if player == nil {
		return
	}
	// Full refund for pending tasks
	if task.State == model.ConstructionPending {
		player.Resources.Minerals += task.Cost.Minerals
		player.Resources.Energy += task.Cost.Energy
		player.AddItems(task.Cost.Items)
		return
	}
	// Partial refund for in_progress tasks: remaining / total
	if task.TotalTicks <= 0 {
		player.Resources.Minerals += task.Cost.Minerals
		player.Resources.Energy += task.Cost.Energy
		player.AddItems(task.Cost.Items)
		return
	}
	ratio := float64(task.RemainingTicks) / float64(task.TotalTicks)
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	player.Resources.Minerals += int(float64(task.Cost.Minerals) * ratio)
	player.Resources.Energy += int(float64(task.Cost.Energy) * ratio)
	// Items: refund proportionally (round up to avoid losing items on small remainders)
	refundItems := make([]model.ItemAmount, 0, len(task.Cost.Items))
	for _, item := range task.Cost.Items {
		refundQty := int(float64(item.Quantity) * ratio)
		if refundQty > item.Quantity {
			refundQty = item.Quantity
		}
		if refundQty > 0 {
			refundItems = append(refundItems, model.ItemAmount{ItemID: item.ItemID, Quantity: refundQty})
		}
	}
	player.AddItems(refundItems)
}

func (gc *GameCore) completeConstructionTask(ws *model.WorldState, task *model.ConstructionTask) ([]*model.GameEvent, error) {
	if ws == nil || task == nil {
		return nil, fmt.Errorf("construction task missing")
	}
	pos := task.Position
	if !ws.InBounds(pos.X, pos.Y) {
		return nil, fmt.Errorf("construction position out of bounds")
	}
	tileKey := model.TileKey(pos.X, pos.Y)
	if _, occupied := ws.TileBuilding[tileKey]; occupied {
		return nil, fmt.Errorf("construction tile already occupied")
	}
	def, ok := model.BuildingDefinitionByID(task.BuildingType)
	if !ok {
		return nil, fmt.Errorf("unknown building type: %s", task.BuildingType)
	}
	if def.RequiresResourceNode && ws.Grid[pos.Y][pos.X].ResourceNodeID == "" {
		return nil, fmt.Errorf("resource node missing at construction site")
	}

	profile := model.BuildingProfileFor(task.BuildingType, 1)
	id := ws.NextEntityID("b")
	b := &model.Building{
		ID:          id,
		Type:        task.BuildingType,
		OwnerID:     task.PlayerID,
		Position:    pos,
		HP:          profile.MaxHP,
		MaxHP:       profile.MaxHP,
		Level:       1,
		VisionRange: profile.VisionRange,
		Runtime:     profile.Runtime,
	}
	model.InitBuildingStorage(b)
	model.InitBuildingEnergyStorage(b)
	model.InitBuildingConveyor(b)
	model.InitBuildingSorter(b)
	model.InitBuildingLogisticsStation(b)
	if b.Runtime.Functions.Production != nil {
		b.ProductionMonitor = model.NewProductionMonitorState()
	}
	model.RegisterLogisticsStation(ws, b)
	model.RegisterPowerGridBuilding(ws, b)
	if b.Conveyor != nil && task.ConveyorDirection.Valid() {
		b.Conveyor.Output = task.ConveyorDirection
		b.Conveyor.Input = task.ConveyorDirection.Opposite()
	}
	ws.Buildings[id] = b
	ws.TileBuilding[tileKey] = id
	ws.Grid[pos.Y][pos.X].BuildingID = id

	events := []*model.GameEvent{
		{
			EventType:       model.EvtEntityCreated,
			VisibilityScope: task.PlayerID,
			Payload: map[string]any{
				"entity_type": "building",
				"entity_id":   id,
				"building":    b,
			},
		},
	}
	return events, nil
}
