package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type sorterLink struct {
	id   string
	dir  model.ConveyorDirection
	port string
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

		inputs := sorterInputEndpoints(ws, building, sorter)
		if len(inputs) == 0 {
			continue
		}
		outputs := sorterOutputEndpoints(ws, building, sorter)
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
			if target == nil {
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
				if source == nil {
					continue
				}
				moved := 0
				movedItemID := ""
				for remaining > 0 {
					qty, itemID := sorterGrabOnce(ws, source, target, in.port, out.port, sorter, grabStacks, pileGrab)
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
func sorterGrabOnce(ws *model.WorldState, source, target *model.Building, sourcePort, targetPort string, sorter *model.SorterState, maxStacks int, pileGrab bool) (int, string) {
	moved, firstItem := 0, ""
	for stacks := 0; stacks < maxStacks; stacks++ {
		itemID, available := "", 0
		if source.Conveyor != nil {
			front, ok := peekConveyorFront(source.Conveyor)
			if !ok {
				break
			}
			itemID, available = front.ItemID, front.Quantity
		} else {
			items := make([]string, 0)
			for id := range source.Storage.Inventory {
				items = append(items, id)
			}
			for id := range source.Storage.OutputBuffer {
				items = append(items, id)
			}
			sort.Strings(items)
			for _, id := range items {
				if source.ExportableItemQuantity(id) > 0 && sorter.Filter.Allows(id) {
					for _, port := range source.Runtime.Params.IOPorts {
						if port.ID == sourcePort && allowsItem(port.AllowedItems, id) {
							itemID, available = id, source.ExportableItemQuantity(id)
							break
						}
					}
				}
				if itemID != "" {
					break
				}
			}
		}
		if itemID == "" || available <= 0 || !sorter.Filter.Allows(itemID) {
			break
		}
		take := 1
		if pileGrab {
			take = available
		}
		if target.Conveyor != nil {
			take = min(take, conveyorInsertCapacity(ws, target))
		} else {
			accepted, _, err := model.StoragePortPreviewInput(target, targetPort, itemID, take)
			if err != nil {
				break
			}
			take = accepted
		}
		if take <= 0 {
			break
		}
		var cargo []model.ItemStack
		if source.Conveyor != nil {
			cargo = source.Conveyor.Take(take)
		} else {
			got, _, err := model.StoragePortOutput(source, sourcePort, itemID, take)
			if err != nil || got <= 0 {
				break
			}
			take = got
			cargo = []model.ItemStack{{ItemID: itemID, Quantity: take}}
		}
		if target.Conveyor != nil {
			target.Conveyor.AppendStacks(cargo)
		} else {
			// Preview and commit run serially within this tick; no other producer can fill the port between them.
			inserted, _, _ := model.StoragePortInput(target, targetPort, itemID, take)
			if inserted != take {
				panic("sorter storage preview/commit mismatch")
			}
		}
		if source.Conveyor != nil {
			recordConveyorDeparture(ws, source, take)
		}
		moved += take
		if firstItem == "" {
			firstItem = itemID
		}
	}
	return moved, firstItem
}

func allowsItem(items []string, item string) bool {
	if len(items) == 0 {
		return true
	}
	for _, id := range items {
		if id == item {
			return true
		}
	}
	return false
}

func sorterInputEndpoints(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	return sorterEndpoints(ws, sorter, state.InputDirections, state.Range, true)
}

func sorterOutputEndpoints(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	return sorterEndpoints(ws, sorter, state.OutputDirections, state.Range, false)
}

func sorterEndpoints(
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
		link, ok := sorterFindEndpoint(ws, sorter, dir, maxRange, forInput)
		if !ok {
			continue
		}
		links = append(links, link)
	}
	return links
}

func sorterFindEndpoint(ws *model.WorldState, sorter *model.Building, dir model.ConveyorDirection, maxRange int, forInput bool) (sorterLink, bool) {
	pos := sorter.Position
	for step := 1; step <= maxRange; step++ {
		pos, dir = ws.SurfaceStep(pos, dir)
		targetID := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]
		if targetID == "" {
			continue
		}
		target := ws.Buildings[targetID]
		if target == nil || target.OwnerID != sorter.OwnerID {
			return sorterLink{}, false
		}
		if target.Conveyor != nil {
			if !conveyorActive(target) || target.Splitter != nil {
				return sorterLink{}, false
			}
			if forInput && !sorterCanTakeFromConveyor(target, dir) || !forInput && !sorterCanInsertToConveyor(target, dir) {
				return sorterLink{}, false
			}
			return sorterLink{id: targetID, dir: dir}, true
		}
		if target.Storage != nil {
			for _, port := range sortedIOPorts(target.Runtime.Params.IOPorts) {
				portPos := portWorldPosition(ws, target, port)
				if portPos.X != pos.X || portPos.Y != pos.Y {
					continue
				}
				if (forInput && (port.Direction == model.PortOutput || port.Direction == model.PortBoth)) || (!forInput && (port.Direction == model.PortInput || port.Direction == model.PortBoth)) {
					return sorterLink{id: targetID, dir: dir, port: port.ID}, true
				}
			}
		}
		return sorterLink{}, false
	}
	return sorterLink{}, false
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
