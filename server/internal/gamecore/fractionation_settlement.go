package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

func settleFractionation(ws *model.WorldState) []*model.GameEvent {
	if ws == nil {
		return nil
	}
	ids := make([]string, 0)
	for id, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeFractionator {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	for _, id := range ids {
		b := ws.Buildings[id]
		model.InitBuildingFractionation(b)
		s := b.Fractionation
		if b.Runtime.State != model.BuildingWorkRunning {
			s.State = string(b.Runtime.State)
			continue
		}
		s.State = "idle"
		exportMachineStacks(ws, b, s.HydrogenDirection, &s.HydrogenBuffer, s.Throughput)
		if sink := machineBelt(ws, b, s.DeuteriumDirection, false); sink != nil {
			count := min(s.Throughput, s.DeuteriumBuffer, sink.Conveyor.AvailableCapacity())
			if count > 0 {
				accepted, _, _ := sink.Conveyor.Insert(model.ItemDeuterium, count)
				s.DeuteriumBuffer -= accepted
			}
		}
		if stackBufferQuantity(s.HydrogenBuffer) >= s.BufferCapacity || s.DeuteriumBuffer >= s.BufferCapacity {
			s.State = "blocked"
			continue
		}
		importMachineStacks(ws, b, s.InputDirection, &s.InputBuffer, s.BufferCapacity, s.Throughput, model.ItemHydrogen)
		throughput := s.Throughput
		if ws.PowerSnapshot != nil && ws.PowerSnapshot.Tick == ws.Tick {
			if allocation, ok := ws.PowerSnapshot.Allocations.Buildings[b.ID]; ok {
				throughput = scaleByPowerRatio(throughput, allocation.Ratio)
			}
		}
		converted := 0
		for n := 0; n < throughput && len(s.InputBuffer) > 0; n++ {
			if stackBufferQuantity(s.HydrogenBuffer) >= s.BufferCapacity || s.DeuteriumBuffer >= s.BufferCapacity {
				s.State = "blocked"
				break
			}
			taken, rest := splitStacksByQty(s.InputBuffer, 1)
			probability, level, returned := model.FractionationProbability(taken[0])
			s.InputBuffer = rest
			if s.Draw(probability) {
				s.DeuteriumBuffer++
				s.Converted++
				converted++
			} else {
				s.HydrogenBuffer = append(s.HydrogenBuffer, returned)
				s.ReturnedHydrogen++
			}
			s.Attempts++
			s.LastProcessTick = ws.Tick
			s.LastProbability = probability
			s.LastSprayLevel = level
			s.State = "running"
		}
		if converted > 0 {
			snapshot := model.CurrentProductionSettlementSnapshot(ws)
			if snapshot == nil {
				snapshot = model.NewProductionSettlementSnapshot(ws.Tick)
				ws.ProductionSnapshot = snapshot
			}
			outputs := []model.ItemAmount{{ItemID: model.ItemDeuterium, Quantity: converted}}
			snapshot.RecordBuildingOutputs(b, outputs)
			events = append(events, &model.GameEvent{EventType: model.EvtResourceChanged, VisibilityScope: b.OwnerID, Payload: map[string]any{"building_id": b.ID, "outputs": outputs, "process": "fractionation"}})
		}
	}
	return events
}

// A directional machine port connects only to an adjacent active owned belt.
// Splitters arbitrate their own ports and cannot be accessed as a raw inventory.
func machineBelt(ws *model.WorldState, b *model.Building, direction model.ConveyorDirection, input bool) *model.Building {
	pos, forward := ws.SurfaceStep(b.Position, direction)
	belt := ws.Buildings[ws.TileBuilding[model.TileKey(pos.X, pos.Y)]]
	if !conveyorActive(belt) || belt.OwnerID != b.OwnerID || belt.Splitter != nil {
		return nil
	}
	if input {
		if belt.Conveyor.Output != forward.Opposite() && belt.Conveyor.Output != model.ConveyorAuto {
			return nil
		}
	} else if !allowsInput(conveyorAllowedInputs(belt), forward.Opposite()) {
		return nil
	}
	return belt
}

func stackBufferQuantity(stacks []model.ItemStack) int {
	total := 0
	for _, stack := range stacks {
		total += stack.Quantity
	}
	return total
}

func exportMachineStacks(ws *model.WorldState, b *model.Building, dir model.ConveyorDirection, buffer *[]model.ItemStack, throughput int) {
	sink := machineBelt(ws, b, dir, false)
	if sink == nil {
		return
	}
	count := min(throughput, sink.Conveyor.AvailableCapacity())
	taken, rest := splitStacksByQty(*buffer, count)
	sink.Conveyor.AppendStacks(taken)
	*buffer = rest
}

func importMachineStacks(ws *model.WorldState, b *model.Building, dir model.ConveyorDirection, buffer *[]model.ItemStack, capacity, throughput int, itemID string) {
	source := machineBelt(ws, b, dir, true)
	if source == nil {
		return
	}
	count := min(throughput, capacity-stackBufferQuantity(*buffer))
	for count > 0 && len(source.Conveyor.Buffer) > 0 {
		front := source.Conveyor.Buffer[0]
		if itemID != "" && front.ItemID != itemID {
			return
		}
		moved := source.Conveyor.Take(min(count, front.Quantity))
		recordConveyorDeparture(ws, source, stackBufferQuantity(moved))
		*buffer = append(*buffer, moved...)
		count -= stackBufferQuantity(moved)
	}
}
