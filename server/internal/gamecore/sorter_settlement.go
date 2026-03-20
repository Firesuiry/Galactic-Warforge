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
		if building == nil || building.Sorter == nil {
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
				stack, ok := peekConveyorFront(source.Conveyor)
				if !ok || stack.Quantity <= 0 {
					continue
				}
				if !sorter.Filter.Allows(stack.ItemID) {
					continue
				}
				available := target.Conveyor.AvailableCapacity()
				if available <= 0 {
					break
				}
				move := minInt(remaining, available)
				if stack.Quantity < move {
					move = stack.Quantity
				}
				if move <= 0 {
					continue
				}
				moved := source.Conveyor.Take(move)
				if len(moved) == 0 {
					continue
				}
				target.Conveyor.AppendStacks(moved)
				remaining -= move
			}
		}
	}
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
	dx, dy := dir.Delta()
	for step := 1; step <= maxRange; step++ {
		nx := sorter.Position.X + dx*step
		ny := sorter.Position.Y + dy*step
		if !ws.InBounds(nx, ny) {
			return "", false
		}
		targetID := ws.TileBuilding[model.TileKey(nx, ny)]
		if targetID == "" {
			continue
		}
		target := ws.Buildings[targetID]
		if target == nil || target.OwnerID != sorter.OwnerID {
			return "", false
		}
		if target.Conveyor == nil {
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
