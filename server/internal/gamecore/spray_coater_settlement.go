package gamecore

import (
	"siliconworld/internal/model"
	"sort"
)

func settleSprayCoaters(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ids := make([]string, 0)
	for id, b := range ws.Buildings {
		if b != nil && b.Type == model.BuildingTypeSprayCoater {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		b := ws.Buildings[id]
		model.InitBuildingSprayCoater(b)
		model.InitBuildingStorage(b)
		s := b.SprayCoater
		if b.Runtime.State != model.BuildingWorkRunning {
			s.State = string(b.Runtime.State)
			continue
		}
		s.State = "idle"
		exportMachineStacks(ws, b, s.OutputDirection, &s.OutputBuffer, s.Throughput)
		if stackBufferQuantity(s.OutputBuffer) >= s.BufferCapacity {
			s.State = "blocked"
			continue
		}
		// Reagent has count-only storage; the west/east material path never enters it.
		if source := machineBelt(ws, b, s.ReagentDirection, true); source != nil && len(source.Conveyor.Buffer) > 0 {
			stack := source.Conveyor.Buffer[0]
			if _, ok := model.SprayDefinitionByItem(stack.ItemID); ok {
				accepted, _, err := b.Storage.Receive(stack.ItemID, min(6, stack.Quantity))
				if err == nil && accepted > 0 {
					source.Conveyor.Take(accepted)
				}
			}
		}
		importMachineStacks(ws, b, s.InputDirection, &s.InputBuffer, s.BufferCapacity, s.Throughput, "")
		throughput := s.Throughput
		if ws.PowerSnapshot != nil && ws.PowerSnapshot.Tick == ws.Tick {
			if a, ok := ws.PowerSnapshot.Allocations.Buildings[b.ID]; ok {
				throughput = scaleByPowerRatio(throughput, a.Ratio)
			}
		}
		for n := 0; n < throughput && len(s.InputBuffer) > 0; n++ {
			if stackBufferQuantity(s.OutputBuffer) >= s.BufferCapacity {
				s.State = "blocked"
				break
			}
			taken, rest := splitStacksByQty(s.InputBuffer, 1)
			stack := taken[0]
			if stack.Spray == nil || stack.Spray.RemainingUses <= 0 {
				coated := false
				units := model.CurrentProductionBonusConfig().SprayUnitsPerTarget
				if s.SprayUnits >= units && s.SprayEffect != nil {
					effect := *s.SprayEffect
					stack.Spray = &effect
					s.SprayUnits -= units
					coated = true
				} else if s.SprayUnits == 0 {
					for _, item := range []string{model.ItemProliferatorMk3, model.ItemProliferatorMk2, model.ItemProliferatorMk1} {
						if availableStorageItem(b.Storage, item)+b.Storage.OutputBuffer[item] < 1 {
							continue
						}
						application, err := model.ApplySprayToStack(stack, model.ItemStack{ItemID: item, Quantity: 1})
						if err != nil || !application.Applied {
							continue
						}
						remaining := application.SprayConsumed.Quantity
						for _, inventory := range []model.ItemInventory{b.Storage.InputBuffer, b.Storage.Inventory, b.Storage.OutputBuffer} {
							remaining -= removeStorageItem(inventory, item, remaining)
						}
						definition, _ := model.SprayDefinitionByItem(item)
						s.SprayItemID = item
						s.SprayUnits = application.SprayConsumed.Quantity*definition.UnitYield - units
						effect := *application.Sprayed.Spray
						s.SprayEffect = &effect
						stack = application.Sprayed
						s.ConsumedProliferator += int64(application.SprayConsumed.Quantity)
						coated = true
						break
					}
				}
				if coated {
					s.CoatedItems++
					s.LastSprayTick = ws.Tick
					s.State = "running"
				} else {
					s.State = "no_proliferator"
				}
			}
			s.InputBuffer = rest
			s.OutputBuffer = append(s.OutputBuffer, stack)
		}
	}
}
