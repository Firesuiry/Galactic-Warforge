package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type sorterLink struct {
	id  string
	dir model.ConveyorDirection
}

func settleSorters(ws *model.WorldState) {
	if ws == nil {
		return
	}
	sorters := make(map[string]*model.Building)
	for id, building := range ws.Buildings {
		if building == nil || building.Sorter == nil || building.Runtime.State != model.BuildingWorkRunning {
			continue
		}
		sorters[id] = building
	}
	if len(sorters) == 0 {
		return
	}

	ids := make([]string, 0, len(sorters))
	for id := range sorters {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		building := sorters[id]
		if building == nil || building.Sorter == nil {
			continue
		}
		sorter := building.Sorter
		if sorter.Speed <= 0 || sorter.Range <= 0 {
			continue
		}

		inputs := sorterInputConveyors(ws, building, sorter)
		if len(inputs) == 0 {
			continue
		}
		outputs := sorterOutputConveyors(ws, building, sorter)
		if len(outputs) == 0 {
			continue
		}

		// Each grab lifts up to grabStacks stacks: ordinary sorters peel one
		// item per stack while the pile sorter lifts whole piles. The
		// sorter_cargo_stacking tech raises the stacks per grab via its
		// catalog sorter_grab_stacks effect.
		grabStacks := 1 + int(model.TechEffectValue(ws.Players[building.OwnerID], "sorter_grab_stacks"))
		pileGrab := building.Type == model.BuildingTypePileSorter
		remaining := sorter.Speed
		for _, out := range outputs {
			if remaining <= 0 {
				break
			}
			target := ws.Buildings[out.id]
			if target == nil || target.Conveyor == nil {
				continue
			}
			for _, in := range inputs {
				if remaining <= 0 {
					break
				}
				if in.id == out.id {
					continue
				}
				source := ws.Buildings[in.id]
				if source == nil || source.Conveyor == nil {
					continue
				}
				moved := 0
				movedItemID := ""
				for remaining > 0 {
					qty, itemID := sorterGrabOnce(ws, source, target, sorter, grabStacks, pileGrab)
					if qty <= 0 {
						break
					}
					if movedItemID == "" {
						movedItemID = itemID
					}
					moved += qty
					remaining--
				}
				if moved <= 0 {
					continue
				}
				sequence := int64(1)
				if sorter.LastTransfer != nil {
					sequence = sorter.LastTransfer.Sequence + 1
				}
				sorter.LastTransfer = &model.SorterTransfer{
					Tick: ws.Tick, Sequence: sequence,
					SourceID: source.ID, TargetID: target.ID,
					SourcePosition: source.Position, TargetPosition: target.Position,
					ItemID: movedItemID, Quantity: moved,
				}
			}
		}
	}
}

// sorterGrabOnce performs a single grab: up to maxStacks stacks from the front
// of the source buffer. Ordinary sorters take one item per stack; pile
// sorters lift each stack whole. Returns items moved and the first item ID.
func sorterGrabOnce(
	ws *model.WorldState,
	source, target *model.Building,
	sorter *model.SorterState,
	maxStacks int,
	pileGrab bool,
) (int, string) {
	available := conveyorInsertCapacity(ws, target)
	if available <= 0 {
		return 0, ""
	}
	moved := 0
	itemID := ""
	for stacks := 0; stacks < maxStacks && available > 0; stacks++ {
		if len(source.Conveyor.Buffer) == 0 {
			break
		}
		front := source.Conveyor.Buffer[0]
		if front.Quantity <= 0 {
			break
		}
		if !sorter.Filter.Allows(front.ItemID) {
			break
		}
		take := 1
		if pileGrab {
			take = front.Quantity
		}
		if take > available {
			take = available
		}
		if take <= 0 {
			break
		}
		got := source.Conveyor.Take(take)
		qty := 0
		for _, stack := range got {
			qty += stack.Quantity
		}
		if qty == 0 {
			break
		}
		target.Conveyor.AppendStacks(got)
		recordConveyorDeparture(ws, source, qty)
		if itemID == "" {
			itemID = front.ItemID
		}
		moved += qty
		available -= qty
	}
	return moved, itemID
}

func sorterInputConveyors(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	return sorterConveyors(ws, sorter, state.InputDirections, state.Range, true)
}

func sorterOutputConveyors(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	return sorterConveyors(ws, sorter, state.OutputDirections, state.Range, false)
}

func sorterConveyors(
	ws *model.WorldState,
	sorter *model.Building,
	dirs []model.ConveyorDirection,
	maxRange int,
	forInput bool,
) []sorterLink {
	if ws == nil || sorter == nil || maxRange <= 0 {
		return nil
	}
	links := make([]sorterLink, 0, len(dirs))
	for _, dir := range dirs {
		if !dir.Valid() || dir == model.ConveyorAuto {
			continue
		}
		id, ok := sorterFindConveyor(ws, sorter, dir, maxRange, forInput)
		if !ok {
			continue
		}
		links = append(links, sorterLink{id: id, dir: dir})
	}
	return links
}

func sorterFindConveyor(
	ws *model.WorldState,
	sorter *model.Building,
	dir model.ConveyorDirection,
	maxRange int,
	forInput bool,
) (string, bool) {
	pos := sorter.Position
	for step := 1; step <= maxRange; step++ {
		pos, dir = ws.SurfaceStep(pos, dir)
		nx, ny := pos.X, pos.Y
		targetID := ws.TileBuilding[model.TileKey(nx, ny)]
		if targetID == "" {
			continue
		}
		target := ws.Buildings[targetID]
		if target == nil || target.OwnerID != sorter.OwnerID {
			return "", false
		}
		if !conveyorActive(target) || target.Splitter != nil {
			return "", false
		}
		if forInput {
			if !sorterCanTakeFromConveyor(target, dir) {
				return "", false
			}
		} else {
			if !sorterCanInsertToConveyor(target, dir) {
				return "", false
			}
		}
		return targetID, true
	}
	return "", false
}

func sorterCanTakeFromConveyor(conveyorBuilding *model.Building, dir model.ConveyorDirection) bool {
	if conveyorBuilding == nil || conveyorBuilding.Conveyor == nil {
		return false
	}
	output := conveyorBuilding.Conveyor.Output
	if !output.Valid() || output == model.ConveyorAuto {
		return false
	}
	return output == dir.Opposite()
}

func sorterCanInsertToConveyor(conveyorBuilding *model.Building, dir model.ConveyorDirection) bool {
	if conveyorBuilding == nil || conveyorBuilding.Conveyor == nil {
		return false
	}
	allowed := conveyorAllowedInputs(conveyorBuilding)
	return allowsInput(allowed, dir.Opposite())
}

func peekConveyorFront(conveyor *model.ConveyorState) (model.ItemStack, bool) {
	if conveyor == nil || len(conveyor.Buffer) == 0 {
		return model.ItemStack{}, false
	}
	stack := conveyor.Buffer[0]
	if stack.Quantity <= 0 {
		return model.ItemStack{}, false
	}
	return stack, true
}
