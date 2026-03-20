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

	for _, dir := range conveyorDirOrder {
		if portRemaining <= 0 {
			return
		}
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
		stack, ok := peekConveyorFront(neighbor.Conveyor)
		if !ok || stack.Quantity <= 0 {
			continue
		}
		limit := minInt(portRemaining, stack.Quantity)
		accepted, _, err := model.StoragePortPreviewInput(building, port.ID, stack.ItemID, limit)
		if err != nil || accepted <= 0 {
			continue
		}
		moved := neighbor.Conveyor.Take(accepted)
		inserted, _, err := model.StoragePortInput(building, port.ID, stack.ItemID, accepted)
		if err != nil {
			neighbor.Conveyor.PrependStacks(moved)
			continue
		}
		if inserted < accepted {
			_, rollback := splitStacksByQty(moved, inserted)
			neighbor.Conveyor.PrependStacks(rollback)
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

	for _, dir := range conveyorDirOrder {
		if portRemaining <= 0 {
			return
		}
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
		for portRemaining > 0 {
			available := neighbor.Conveyor.AvailableCapacity()
			if available <= 0 {
				break
			}
			limit := minInt(portRemaining, available)
			itemID := selectOutputItem(building.Storage, port)
			if itemID == "" {
				return
			}
			outputQty := building.Storage.OutputQuantity(itemID)
			if outputQty <= 0 {
				break
			}
			take := minInt(limit, outputQty)
			if take <= 0 {
				break
			}
			beforeOut := 0
			if building.Storage.OutputBuffer != nil {
				beforeOut = building.Storage.OutputBuffer[itemID]
			}
			provided, _, err := model.StoragePortOutput(building, port.ID, itemID, take)
			if err != nil || provided <= 0 {
				return
			}
			removedFromOutput := minInt(beforeOut, provided)
			removedFromInventory := provided - removedFromOutput
			accepted, remaining, err := neighbor.Conveyor.Insert(itemID, provided)
			if err != nil {
				rollbackStorageOutput(building.Storage, itemID, removedFromOutput, removedFromInventory, provided)
				return
			}
			if remaining > 0 {
				rollbackStorageOutput(building.Storage, itemID, removedFromOutput, removedFromInventory, remaining)
			}
			portRemaining -= accepted
			if remaining > 0 {
				return
			}
		}
	}
}

func portWorldPosition(building *model.Building, port model.IOPort) model.Position {
	return model.Position{
		X: building.Position.X + port.Offset.X,
		Y: building.Position.Y + port.Offset.Y,
	}
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

func selectOutputItem(storage *model.StorageState, port model.IOPort) string {
	if storage == nil {
		return ""
	}
	if len(port.AllowedItems) > 0 {
		for _, itemID := range port.AllowedItems {
			if storage.OutputQuantity(itemID) > 0 {
				return itemID
			}
		}
		return ""
	}
	for _, itemID := range storage.OutputCandidates() {
		if storage.OutputQuantity(itemID) > 0 {
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
