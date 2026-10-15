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
		if !conveyorActive(building) || building.Splitter != nil {
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
		if building == nil || building.Storage == nil || building.Type == model.BuildingTypeSprayCoater {
			continue
		}
		// 只有 direct_belt_io 的建筑能直接和相邻传送带换货（第 16 轮契约 §3）：
		// 采集类、物流站、分流器 / 叠层器 / 流速监测器这类带上设备。其余建筑
		// （生产、研究、仓储、发电燃料口、HQ、兵营、炮塔……）一律经分拣器进出货。
		if !model.BuildingHasDirectBeltIO(building.Type) {
			continue
		}
		ports := sortedIOPorts(building.Runtime.Params.IOPorts)
		if len(ports) == 0 {
			continue
		}
		ring := buildingIORing(ws, building)
		if len(ring) == 0 {
			continue
		}
		for _, port := range ports {
			if port.Direction != model.PortInput && port.Direction != model.PortBoth {
				continue
			}
			settleBuildingPortInput(ws, conveyors, building, port, ring)
		}
		for _, port := range ports {
			if port.Direction != model.PortOutput && port.Direction != model.PortBoth {
				continue
			}
			settleBuildingPortOutput(ws, conveyors, building, port, ring)
		}
	}
}

// ioRingCell is one cell of the ring surrounding a building footprint, with
// the world direction pointing from that cell into the footprint.
type ioRingCell struct {
	pos    model.Position
	facing model.ConveyorDirection
}

// buildingIORing lists the cells around the building's footprint together with
// their facing direction. IO is a ring contract: any footprint-adjacent belt
// can be a port candidate, no matter which cell of a multi-cell building it
// touches, and the facing direction is derived by stepping the surface graph
// so cube-face seams need no special case.
func buildingIORing(ws *model.WorldState, building *model.Building) []ioRingCell {
	if ws == nil || building == nil {
		return nil
	}
	ring, err := ws.BuildingRingCells(building)
	if err != nil || len(ring) == 0 {
		return nil
	}
	tiles, err := ws.BuildingTiles(building)
	if err != nil {
		return nil
	}
	inside := make(map[model.Position]bool, len(tiles))
	for _, p := range tiles {
		inside[p] = true
	}
	out := make([]ioRingCell, 0, len(ring))
	for _, cell := range ring {
		for _, dir := range conveyorDirOrder {
			next, _ := ws.SurfaceStep(cell, dir)
			if inside[next] {
				out = append(out, ioRingCell{pos: cell, facing: dir})
				break
			}
		}
	}
	return out
}

func settleBuildingPortInput(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort, ring []ioRingCell) {
	if ws == nil || building == nil || building.Storage == nil {
		return
	}
	portRemaining := portCapacity(port)
	if portRemaining <= 0 {
		return
	}

	for portRemaining > 0 {
		candidate, ok := selectInputCandidate(ws, conveyors, building, port, ring)
		if !ok {
			return
		}
		limit := min(portRemaining, candidate.quantity)
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
		recordConveyorDeparture(ws, candidate.conveyor, inserted)
	}
}

func settleBuildingPortOutput(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort, ring []ioRingCell) {
	if ws == nil || building == nil || building.Storage == nil {
		return
	}
	portRemaining := portCapacity(port)
	if portRemaining <= 0 {
		return
	}

	for portRemaining > 0 {
		candidate, ok := selectOutputCandidate(ws, conveyors, building, port, ring)
		if !ok {
			return
		}
		available := candidate.conveyor.Conveyor.AvailableCapacity()
		if available <= 0 {
			return
		}
		limit := min(portRemaining, available)
		outputQty := building.ExportableItemQuantity(candidate.itemID)
		if outputQty <= 0 {
			return
		}
		take := min(limit, outputQty)
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
		removedFromOutput := min(beforeOut, provided)
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

// selectOutputCandidate scans the footprint ring: a belt on any ring cell is a
// valid output sink as long as it leaves the footprint edge (its own output
// direction continues away from the building, so it cannot feed the machine
// back into itself). Candidates are ranked by the port's preferred direction
// order first, then by ring-cell order.
func selectOutputCandidate(
	ws *model.WorldState,
	conveyors map[string]*model.Building,
	building *model.Building,
	port model.IOPort,
	ring []ioRingCell,
) (outputCandidate, bool) {
	if ws == nil || building == nil {
		return outputCandidate{}, false
	}
	order := outputDirectionOrder(building, port)
	rank := make(map[model.ConveyorDirection]int, len(order))
	for i, dir := range order {
		rank[dir] = i
	}
	candidates := make([]outputCandidate, 0, len(ring))
	for _, cell := range ring {
		neighborID := ws.TileBuilding[model.TileKey(cell.pos.X, cell.pos.Y)]
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
		// 只有"背离建筑"的传送带能收下产出：朝向建筑（或横穿）的带子会把
		// 产出又送回机器，属于输入侧。
		if neighbor.Conveyor.Output != cell.facing.Opposite() {
			continue
		}
		if neighbor.Conveyor.AvailableCapacity() <= 0 {
			continue
		}
		itemID := selectOutputItem(building, port, neighbor.Conveyor.Output)
		if itemID == "" {
			continue
		}
		if building.ExportableItemQuantity(itemID) <= 0 {
			continue
		}
		itemOrder := len(order)
		if r, ok := rank[neighbor.Conveyor.Output]; ok {
			itemOrder = r
		}
		candidates = append(candidates, outputCandidate{
			order:     itemOrder,
			dir:       neighbor.Conveyor.Output,
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
		if building.ExportableItemQuantity(itemID) > 0 {
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

// selectInputCandidate scans the footprint ring: any belt whose output points
// into the footprint (i.e. at the ring cell's facing direction) is an input
// source, regardless of which footprint cell it touches.
func selectInputCandidate(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building, port model.IOPort, ring []ioRingCell) (buildingInputCandidate, bool) {
	if ws == nil || building == nil {
		return buildingInputCandidate{}, false
	}
	needs := buildingRecipeInputNeeds(building)
	var best buildingInputCandidate
	found := false
	for idx, cell := range ring {
		neighborID := ws.TileBuilding[model.TileKey(cell.pos.X, cell.pos.Y)]
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
		if neighbor.Conveyor.Output != cell.facing {
			continue
		}
		candidate, ok := selectConveyorInputCandidate(building, neighbor, port, cell.facing, idx, needs)
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

func selectOutputItem(building *model.Building, port model.IOPort, dir model.ConveyorDirection) string {
	if building == nil || building.Storage == nil {
		return ""
	}
	allowed := buildingDirectionalOutputAllowList(building, &port, dir)
	if len(allowed) > 0 {
		for _, itemID := range allowed {
			if building.ExportableItemQuantity(itemID) > 0 {
				return itemID
			}
		}
		return ""
	}
	for _, itemID := range building.Storage.OutputCandidates() {
		if building.ExportableItemQuantity(itemID) > 0 {
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
	returnToOutput := min(removedFromOutput, qty)
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
