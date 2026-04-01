package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type conveyorTransfer struct {
	sourceID string
	targetID string
	qty      int
	itemID   string
}

func settleConveyors(ws *model.WorldState) {
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
	if len(conveyors) == 0 {
		return
	}

	ids := make([]string, 0, len(conveyors))
	for id := range conveyors {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	incomingDirs := make(map[string][]model.ConveyorDirection, len(conveyors))
	for _, id := range ids {
		incomingDirs[id] = conveyorIncomingDirs(ws, conveyors, conveyors[id])
	}

	allowedInputs := make(map[string]map[model.ConveyorDirection]struct{}, len(conveyors))
	for _, id := range ids {
		allowedInputs[id] = conveyorAllowedInputs(conveyors[id])
	}

	outputTargets := make(map[string][]string, len(conveyors))
	for _, id := range ids {
		outputTargets[id] = conveyorOutputTargets(ws, conveyors, conveyors[id], incomingDirs[id], allowedInputs)
	}

	offers := make(map[string]int, len(conveyors))
	capacities := make(map[string]int, len(conveyors))
	for _, id := range ids {
		belt := conveyors[id].Conveyor
		offers[id] = minInt(belt.Throughput, belt.TotalItems())
		capacities[id] = belt.AvailableCapacity()
	}

	allocations := make(map[string][]conveyorTransfer, len(conveyors))
	remainingOffers := make(map[string]int, len(offers))
	for _, sourceID := range ids {
		remainingOffers[sourceID] = offers[sourceID]
	}
	allocationOrder := conveyorAllocationOrder(ids, ws.Tick)
	for {
		progress := allocateConveyorRound(allocationOrder, outputTargets, remainingOffers, capacities, allocations, conveyors, true)
		progress = allocateConveyorRound(allocationOrder, outputTargets, remainingOffers, capacities, allocations, conveyors, false) || progress
		if !progress {
			break
		}
	}

	for _, sourceID := range ids {
		transfers := allocations[sourceID]
		if len(transfers) == 0 {
			continue
		}
		source := conveyors[sourceID]
		if source == nil || source.Conveyor == nil {
			continue
		}
		for _, tr := range transfers {
			if tr.qty <= 0 {
				continue
			}
			target := conveyors[tr.targetID]
			if target == nil || target.Conveyor == nil {
				continue
			}
			moved := takeConveyorTransferItems(source.Conveyor, tr.itemID, tr.qty)
			target.Conveyor.AppendStacks(moved)
		}
	}
}

func conveyorAllocationOrder(ids []string, tick int64) []string {
	if len(ids) == 0 {
		return nil
	}
	offset := int(tick % int64(len(ids)))
	if offset == 0 {
		return append([]string(nil), ids...)
	}
	order := make([]string, 0, len(ids))
	order = append(order, ids[offset:]...)
	order = append(order, ids[:offset]...)
	return order
}

func allocateConveyorRound(
	order []string,
	outputTargets map[string][]string,
	remainingOffers map[string]int,
	capacities map[string]int,
	allocations map[string][]conveyorTransfer,
	conveyors map[string]*model.Building,
	preferDiversity bool,
) bool {
	progress := false
	for _, sourceID := range order {
		if remainingOffers[sourceID] <= 0 {
			continue
		}
		source := conveyors[sourceID]
		if source == nil || source.Conveyor == nil {
			continue
		}
		for _, targetID := range outputTargets[sourceID] {
			if capacities[targetID] <= 0 {
				continue
			}
			target := conveyors[targetID]
			if target == nil || target.Conveyor == nil {
				continue
			}
			itemID, ok := conveyorTransferItem(target.Conveyor, source.Conveyor, preferDiversity)
			if !ok {
				continue
			}
			allocations[sourceID] = append(allocations[sourceID], conveyorTransfer{
				sourceID: sourceID,
				targetID: targetID,
				qty:      1,
				itemID:   itemID,
			})
			remainingOffers[sourceID]--
			capacities[targetID]--
			progress = true
			break
		}
	}
	return progress
}

func conveyorTransferItem(target, source *model.ConveyorState, preferDiversity bool) (string, bool) {
	if source == nil || len(source.Buffer) == 0 {
		return "", false
	}
	if !preferDiversity {
		itemID := source.Buffer[0].ItemID
		return itemID, itemID != ""
	}
	if target == nil || len(target.Buffer) == 0 {
		return "", false
	}
	existing := make(map[string]struct{}, len(target.Buffer))
	for _, stack := range target.Buffer {
		if stack.ItemID == "" {
			continue
		}
		existing[stack.ItemID] = struct{}{}
	}
	for _, stack := range source.Buffer {
		if stack.ItemID == "" {
			continue
		}
		if _, ok := existing[stack.ItemID]; ok {
			continue
		}
		return stack.ItemID, true
	}
	return "", false
}

func takeConveyorTransferItems(conveyor *model.ConveyorState, itemID string, qty int) []model.ItemStack {
	if conveyor == nil || qty <= 0 {
		return nil
	}
	if itemID == "" {
		return conveyor.Take(qty)
	}
	remaining := qty
	var taken []model.ItemStack
	for remaining > 0 {
		index := firstConveyorStackIndex(conveyor, itemID)
		if index < 0 {
			break
		}
		partial := conveyor.TakeAt(index, remaining)
		if len(partial) == 0 {
			break
		}
		taken = append(taken, partial...)
		for _, stack := range partial {
			remaining -= stack.Quantity
		}
	}
	return taken
}

func firstConveyorStackIndex(conveyor *model.ConveyorState, itemID string) int {
	if conveyor == nil || itemID == "" {
		return -1
	}
	for index, stack := range conveyor.Buffer {
		if stack.ItemID == itemID && stack.Quantity > 0 {
			return index
		}
	}
	return -1
}

var conveyorDirOrder = []model.ConveyorDirection{
	model.ConveyorNorth,
	model.ConveyorEast,
	model.ConveyorSouth,
	model.ConveyorWest,
}

func conveyorIncomingDirs(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building) []model.ConveyorDirection {
	if ws == nil || building == nil {
		return nil
	}
	var incoming []model.ConveyorDirection
	for _, dir := range conveyorDirOrder {
		dx, dy := dir.Delta()
		nx := building.Position.X + dx
		ny := building.Position.Y + dy
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
		neighborOut := neighbor.Conveyor.Output
		if !neighborOut.Valid() || neighborOut == model.ConveyorAuto {
			continue
		}
		if neighborOut == dir.Opposite() {
			incoming = append(incoming, dir)
		}
	}
	return incoming
}

func conveyorAllowedInputs(building *model.Building) map[model.ConveyorDirection]struct{} {
	allowed := make(map[model.ConveyorDirection]struct{})
	if building == nil || building.Conveyor == nil {
		return allowed
	}
	output := building.Conveyor.Output
	input := building.Conveyor.Input

	restricted := model.ConveyorAuto
	if input.Valid() && input != model.ConveyorAuto && input != output && input != output.Opposite() {
		restricted = input
	}

	if restricted != model.ConveyorAuto {
		allowed[restricted] = struct{}{}
		return allowed
	}

	for _, dir := range conveyorDirOrder {
		if output.Valid() && output != model.ConveyorAuto && dir == output {
			continue
		}
		allowed[dir] = struct{}{}
	}
	return allowed
}

func conveyorOutputTargets(
	ws *model.WorldState,
	conveyors map[string]*model.Building,
	building *model.Building,
	incoming []model.ConveyorDirection,
	allowedInputs map[string]map[model.ConveyorDirection]struct{},
) []string {
	if ws == nil || building == nil || building.Conveyor == nil {
		return nil
	}
	output := building.Conveyor.Output
	dirs := conveyorOutputPriority(output, incoming)
	var targets []string
	for _, dir := range dirs {
		if !dir.Valid() || dir == model.ConveyorAuto {
			continue
		}
		if output.Valid() && output != model.ConveyorAuto && dir != output {
			continue
		}
		if output == model.ConveyorAuto && containsDirection(incoming, dir) {
			continue
		}
		dx, dy := dir.Delta()
		nx := building.Position.X + dx
		ny := building.Position.Y + dy
		if !ws.InBounds(nx, ny) {
			continue
		}
		targetID := ws.TileBuilding[model.TileKey(nx, ny)]
		if targetID == "" {
			continue
		}
		target := conveyors[targetID]
		if target == nil || target.Conveyor == nil {
			continue
		}
		if target.OwnerID != building.OwnerID {
			continue
		}
		if !allowsInput(allowedInputs[targetID], dir.Opposite()) {
			continue
		}
		targets = append(targets, targetID)
	}
	return targets
}

func conveyorOutputPriority(output model.ConveyorDirection, incoming []model.ConveyorDirection) []model.ConveyorDirection {
	if output.Valid() && output != model.ConveyorAuto {
		return []model.ConveyorDirection{output}
	}
	base := model.ConveyorAuto
	if len(incoming) == 1 {
		base = incoming[0].Opposite()
	}
	if !base.Valid() || base == model.ConveyorAuto {
		return conveyorDirOrder
	}
	return uniqueDirections([]model.ConveyorDirection{base, base.Left(), base.Right(), base.Opposite()})
}

func uniqueDirections(dirs []model.ConveyorDirection) []model.ConveyorDirection {
	seen := make(map[model.ConveyorDirection]struct{}, len(dirs))
	unique := make([]model.ConveyorDirection, 0, len(dirs))
	for _, dir := range dirs {
		if _, ok := seen[dir]; ok {
			continue
		}
		seen[dir] = struct{}{}
		unique = append(unique, dir)
	}
	return unique
}

func containsDirection(dirs []model.ConveyorDirection, target model.ConveyorDirection) bool {
	for _, dir := range dirs {
		if dir == target {
			return true
		}
	}
	return false
}

func allowsInput(allowed map[model.ConveyorDirection]struct{}, dir model.ConveyorDirection) bool {
	if len(allowed) == 0 {
		return false
	}
	_, ok := allowed[dir]
	return ok
}
