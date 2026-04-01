package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

const maxPortCapacity = int(^uint(0) >> 1)

func settleBuildingIO(ws *model.WorldState) {
	if ws == nil {
		return
	}
	conveyors := make(map[string]*model.Building)
	for id, building := range ws.Buildings {
		if building == nil || building.Conveyor == nil {
			continue
		}
		conveyors[id] = building
	}

	ids := make([]string, 0, len(ws.Buildings))
	for id := range ws.Buildings {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		building := ws.Buildings[id]
		if building == nil || building.Storage == nil {
			continue
		}
		ports := sortedIOPorts(building.Runtime.Params.IOPorts)
		if len(ports) == 0 {
			continue
		}
		for _, port := range ports {
			if port.Direction != model.PortInput && port.Direction != model.PortBoth {
				continue
			}
			settleBuildingPortInput(ws, conveyors, building, port)
		}
		for _, port := range ports {
			if port.Direction != model.PortOutput && port.Direction != model.PortBoth {
				continue
			}
			settleBuildingPortOutput(ws, conveyors, building, port)
		}
	}
}

func settleBuildingPortInput(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort) {
	if ws == nil || building == nil || building.Storage == nil {
		return
	}
	portRemaining := portCapacity(port)
	if portRemaining <= 0 {
		return
	}
	portPos := portWorldPosition(building, port)

	for portRemaining > 0 {
		candidate, ok := selectInputCandidate(ws, conveyors, building, port, portPos)
		if !ok {
			return
		}
		limit := minInt(portRemaining, candidate.quantity)
		accepted, _, err := model.StoragePortPreviewInput(building, port.ID, candidate.itemID, limit)
		if err != nil || accepted <= 0 {
			return
		}
		moved := candidate.conveyor.Conveyor.TakeAt(candidate.buffer, accepted)
		if len(moved) == 0 {
			return
		}
		inserted, _, err := model.StoragePortInput(building, port.ID, candidate.itemID, accepted)
		if err != nil {
			candidate.conveyor.Conveyor.InsertAt(candidate.buffer, moved)
			return
		}
		if inserted < accepted {
			_, rollback := splitStacksByQty(moved, inserted)
			candidate.conveyor.Conveyor.InsertAt(candidate.buffer, rollback)
		}
		portRemaining -= inserted
	}
}

func settleBuildingPortOutput(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort) {
	if ws == nil || building == nil || building.Storage == nil {
		return
	}
	portRemaining := portCapacity(port)
	if portRemaining <= 0 {
		return
	}
	portPos := portWorldPosition(building, port)

	for portRemaining > 0 {
		candidate, ok := selectOutputCandidate(ws, conveyors, building, port, portPos)
		if !ok {
			return
		}
		available := candidate.conveyor.Conveyor.AvailableCapacity()
		if available <= 0 {
			return
		}
		limit := minInt(portRemaining, available)
		outputQty := building.Storage.OutputQuantity(candidate.itemID)
		if outputQty <= 0 {
			return
		}
		take := minInt(limit, outputQty)
		if take <= 0 {
			return
		}
		beforeOut := 0
		if building.Storage.OutputBuffer != nil {
			beforeOut = building.Storage.OutputBuffer[candidate.itemID]
		}
		provided, _, err := model.StoragePortOutput(building, port.ID, candidate.itemID, take)
		if err != nil || provided <= 0 {
			return
		}
		removedFromOutput := minInt(beforeOut, provided)
		removedFromInventory := provided - removedFromOutput
		accepted, remaining, err := candidate.conveyor.Conveyor.Insert(candidate.itemID, provided)
		if err != nil {
			rollbackStorageOutput(building.Storage, candidate.itemID, removedFromOutput, removedFromInventory, provided)
			return
		}
		if remaining > 0 {
			rollbackStorageOutput(building.Storage, candidate.itemID, removedFromOutput, removedFromInventory, remaining)
		}
		portRemaining -= accepted
		if remaining > 0 {
			return
		}
	}
}

type outputCandidate struct {
	order     int
	dir       model.ConveyorDirection
	itemID    string
	conveyor  *model.Building
	duplicate bool
}

func selectOutputCandidate(
	ws *model.WorldState,
	conveyors map[string]*model.Building,
	building *model.Building,
	port model.IOPort,
	portPos model.Position,
) (outputCandidate, bool) {
	if ws == nil || building == nil {
		return outputCandidate{}, false
	}
	baseOrder := outputDirectionOrder(building, port)
	candidates := make([]outputCandidate, 0, len(baseOrder))
	for idx, dir := range baseOrder {
		dx, dy := dir.Delta()
		nx := portPos.X + dx
		ny := portPos.Y + dy
		if !ws.InBounds(nx, ny) {
			continue
		}
		neighborID := ws.TileBuilding[model.TileKey(nx, ny)]
		if neighborID == "" {
			continue
		}
		neighbor := conveyors[neighborID]
		if neighbor == nil || neighbor.Conveyor == nil {
			continue
		}
		if neighbor.OwnerID != building.OwnerID {
			continue
		}
		if !allowsInput(conveyorAllowedInputs(neighbor), dir.Opposite()) {
			continue
		}
		if neighbor.Conveyor.AvailableCapacity() <= 0 {
			continue
		}
		itemID := selectOutputItem(building, port, dir)
		if itemID == "" {
			continue
		}
		if building.Storage.OutputQuantity(itemID) <= 0 {
			continue
		}
		candidates = append(candidates, outputCandidate{
			order:     idx,
			dir:       dir,
			itemID:    itemID,
			conveyor:  neighbor,
			duplicate: conveyorHasItem(neighbor.Conveyor, itemID),
		})
	}
	if len(candidates) == 0 {
		return outputCandidate{}, false
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].duplicate != candidates[j].duplicate {
			return !candidates[i].duplicate
		}
		return candidates[i].order < candidates[j].order
	})
	return candidates[0], true
}

func conveyorHasItem(conveyor *model.ConveyorState, itemID string) bool {
	if conveyor == nil || itemID == "" {
		return false
	}
	for _, stack := range conveyor.Buffer {
		if stack.ItemID == itemID && stack.Quantity > 0 {
			return true
		}
	}
	return false
}

func portWorldPosition(building *model.Building, port model.IOPort) model.Position {
	return model.Position{
		X: building.Position.X + port.Offset.X,
		Y: building.Position.Y + port.Offset.Y,
	}
}

func outputDirectionOrder(building *model.Building, port model.IOPort) []model.ConveyorDirection {
	if building == nil || building.Storage == nil {
		return conveyorDirOrder
	}
	if isByproductOutputPort(&port) {
		return []model.ConveyorDirection{
			model.ConveyorWest,
			model.ConveyorEast,
			model.ConveyorSouth,
			model.ConveyorNorth,
		}
	}
	if isMainOutputPort(&port) {
		return conveyorDirOrder
	}
	byproducts := buildingRecipeByproductItems(building)
	if len(byproducts) == 0 {
		return conveyorDirOrder
	}
	for _, itemID := range byproducts {
		if building.Storage.OutputQuantity(itemID) > 0 {
			return []model.ConveyorDirection{
				model.ConveyorWest,
				model.ConveyorEast,
				model.ConveyorSouth,
				model.ConveyorNorth,
			}
		}
	}
	return conveyorDirOrder
}

func portCapacity(port model.IOPort) int {
	if port.Capacity <= 0 {
		return maxPortCapacity
	}
	return port.Capacity
}

func sortedIOPorts(ports []model.IOPort) []model.IOPort {
	if len(ports) == 0 {
		return nil
	}
	out := append([]model.IOPort(nil), ports...)
	sort.Slice(out, func(i, j int) bool {
		return out[i].ID < out[j].ID
	})
	return out
}

func selectInputCandidate(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort, portPos model.Position) (buildingInputCandidate, bool) {
	if ws == nil || building == nil {
		return buildingInputCandidate{}, false
	}
	needs := buildingRecipeInputNeeds(building)
	var best buildingInputCandidate
	found := false
	for idx, dir := range conveyorDirOrder {
		dx, dy := dir.Delta()
		nx := portPos.X + dx
		ny := portPos.Y + dy
		if !ws.InBounds(nx, ny) {
			continue
		}
		neighborID := ws.TileBuilding[model.TileKey(nx, ny)]
		if neighborID == "" {
			continue
		}
		neighbor := conveyors[neighborID]
		if neighbor == nil || neighbor.Conveyor == nil {
			continue
		}
		if neighbor.OwnerID != building.OwnerID {
			continue
		}
		if neighbor.Conveyor.Output != dir.Opposite() {
			continue
		}
		candidate, ok := selectConveyorInputCandidate(building, neighbor, port, dir, idx, needs)
		if !ok {
			continue
		}
		if !found || compareInputCandidates(building, candidate, best) {
			best = candidate
			found = true
		}
	}
	return best, found
}

func selectConveyorInputCandidate(
	building *model.Building,
	conveyor *model.Building,
	port model.IOPort,
	dir model.ConveyorDirection,
	order int,
	needs map[string]int,
) (buildingInputCandidate, bool) {
	if conveyor == nil || conveyor.Conveyor == nil || len(conveyor.Conveyor.Buffer) == 0 {
		return buildingInputCandidate{}, false
	}
	if len(needs) == 0 {
		stack, ok := peekConveyorFront(conveyor.Conveyor)
		if !ok || !ioPortAllowsItem(port, stack.ItemID) {
			return buildingInputCandidate{}, false
		}
		return buildingInputCandidate{
			order:    order,
			buffer:   0,
			dir:      dir,
			conveyor: conveyor,
			itemID:   stack.ItemID,
			quantity: stack.Quantity,
		}, true
	}

	var best buildingInputCandidate
	found := false
	for idx, stack := range conveyor.Conveyor.Buffer {
		if stack.Quantity <= 0 {
			continue
		}
		if !ioPortAllowsItem(port, stack.ItemID) {
			continue
		}
		if _, ok := needs[stack.ItemID]; !ok {
			continue
		}
		candidate := buildingInputCandidate{
			order:    order,
			buffer:   idx,
			dir:      dir,
			conveyor: conveyor,
			itemID:   stack.ItemID,
			quantity: stack.Quantity,
		}
		if !found || compareInputCandidates(building, candidate, best) {
			best = candidate
			found = true
		}
	}
	if !found {
		return buildingInputCandidate{}, false
	}
	return best, true
}

func selectConveyorInputStack(
	conveyor *model.ConveyorState,
	port model.IOPort,
	needs map[string]int,
) (model.ItemStack, int, bool) {
	if conveyor == nil || len(conveyor.Buffer) == 0 {
		return model.ItemStack{}, 0, false
	}
	if len(needs) == 0 {
		stack, ok := peekConveyorFront(conveyor)
		if !ok || !ioPortAllowsItem(port, stack.ItemID) {
			return model.ItemStack{}, 0, false
		}
		return stack, 0, true
	}
	for idx, stack := range conveyor.Buffer {
		if stack.Quantity <= 0 {
			continue
		}
		if !ioPortAllowsItem(port, stack.ItemID) {
			continue
		}
		if _, ok := needs[stack.ItemID]; !ok {
			continue
		}
		return stack, idx, true
	}
	return model.ItemStack{}, 0, false
}

func selectOutputItem(building *model.Building, port model.IOPort, dir model.ConveyorDirection) string {
	if building == nil || building.Storage == nil {
		return ""
	}
	allowed := buildingDirectionalOutputAllowList(building, &port, dir)
	if len(allowed) > 0 {
		for _, itemID := range allowed {
			if building.Storage.OutputQuantity(itemID) > 0 {
				return itemID
			}
		}
		return ""
	}
	for _, itemID := range building.Storage.OutputCandidates() {
		if building.Storage.OutputQuantity(itemID) > 0 {
			return itemID
		}
	}
	return ""
}

func rollbackStorageOutput(storage *model.StorageState, itemID string, removedFromOutput, removedFromInventory, qty int) {
	if storage == nil || itemID == "" || qty <= 0 {
		return
	}
	if removedFromOutput < 0 {
		removedFromOutput = 0
	}
	if removedFromInventory < 0 {
		removedFromInventory = 0
	}
	if removedFromOutput+removedFromInventory == 0 {
		return
	}
	returnToOutput := minInt(removedFromOutput, qty)
	remaining := qty - returnToOutput
	if returnToOutput > 0 {
		buf := storage.EnsureOutputBuffer()
		buf[itemID] += returnToOutput
	}
	if remaining > 0 {
		if remaining > removedFromInventory {
			remaining = removedFromInventory
		}
		if remaining > 0 {
			inv := storage.EnsureInventory()
			inv[itemID] += remaining
		}
	}
}

func splitStacksByQty(stacks []model.ItemStack, qty int) ([]model.ItemStack, []model.ItemStack) {
	if qty <= 0 {
		return nil, stacks
	}
	remaining := qty
	taken := make([]model.ItemStack, 0, len(stacks))
	rest := make([]model.ItemStack, 0, len(stacks))
	for _, stack := range stacks {
		if stack.Quantity <= 0 {
			continue
		}
		if remaining <= 0 {
			rest = append(rest, stack)
			continue
		}
		if stack.Quantity <= remaining {
			taken = append(taken, stack)
			remaining -= stack.Quantity
			continue
		}
		taken = append(taken, model.ItemStack{
			ItemID:   stack.ItemID,
			Quantity: remaining,
			Spray:    stack.Spray,
		})
		stack.Quantity -= remaining
		remaining = 0
		rest = append(rest, stack)
	}
	return taken, rest
}
