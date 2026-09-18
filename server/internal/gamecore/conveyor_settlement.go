package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type conveyorLink struct {
	targetID string
	output   model.ConveyorDirection
	input    model.ConveyorDirection
}

type conveyorRequest struct {
	sourceID    string
	link        conveyorLink
	bufferIndex int
}

// pileHeightFor returns the pile height the automatic piler compresses loose
// items into: 2x by default, raised by the sorter_cargo_integration tech's
// catalog piler_pile_height effect (2 -> 4 once researched).
func pileHeightFor(ws *model.WorldState, ownerID string) int {
	if ws == nil {
		return 2
	}
	return 2 + int(model.TechEffectValue(ws.Players[ownerID], "piler_pile_height"))
}

func isAutomaticPiler(building *model.Building) bool {
	return building != nil && building.Type == model.BuildingTypeAutomaticPiler && building.Conveyor != nil
}

// pilerFreeCapacity counts piler capacity in pile slots: MaxStack slots each
// hold a full pile, so the item capacity scales with the pile height.
func pilerFreeCapacity(ws *model.WorldState, building *model.Building) int {
	if building == nil || building.Conveyor == nil {
		return 0
	}
	free := building.Conveyor.MaxStack*pileHeightFor(ws, building.OwnerID) - building.Conveyor.TotalItems()
	if free < 0 {
		return 0
	}
	return free
}

// conveyorInsertCapacity is the free item capacity a sorter or belt sees when
// inserting into the target segment.
func conveyorInsertCapacity(ws *model.WorldState, target *model.Building) int {
	if isAutomaticPiler(target) {
		return pilerFreeCapacity(ws, target)
	}
	if target == nil || target.Conveyor == nil {
		return 0
	}
	return target.Conveyor.AvailableCapacity()
}

// compressPilerBuffer regroups the buffer into piles of at most pileHeight
// items, merging separated stacks of the same kind while preserving order.
func compressPilerBuffer(conveyor *model.ConveyorState, pileHeight int) {
	if conveyor == nil || pileHeight <= 1 || len(conveyor.Buffer) == 0 {
		return
	}
	out := make([]model.ItemStack, 0, len(conveyor.Buffer))
	for _, stack := range conveyor.Buffer {
		qty := stack.Quantity
		for qty > 0 {
			open := -1
			for i := len(out) - 1; i >= 0; i-- {
				if out[i].Quantity < pileHeight && canMergeItemStacks(out[i], stack) {
					open = i
					break
				}
			}
			if open >= 0 {
				take := minInt(pileHeight-out[open].Quantity, qty)
				out[open].Quantity += take
				qty -= take
				continue
			}
			take := minInt(pileHeight, qty)
			out = append(out, model.ItemStack{ItemID: stack.ItemID, Quantity: take, Spray: cloneSpray(stack.Spray)})
			qty -= take
		}
	}
	conveyor.Buffer = out
}

func canMergeItemStacks(a, b model.ItemStack) bool {
	if a.ItemID != b.ItemID {
		return false
	}
	if (a.Spray == nil) != (b.Spray == nil) {
		return false
	}
	if a.Spray == nil {
		return true
	}
	return a.Spray.Level == b.Spray.Level && a.Spray.RemainingUses == b.Spray.RemainingUses
}

func cloneSpray(state *model.SprayState) *model.SprayState {
	if state == nil {
		return nil
	}
	clone := *state
	return &clone
}

// All belt-like transport uses one simultaneous inventory settlement. Requests
// reserve real stacks from the tick's initial buffers; receipts never move again
// in the same tick and no item can be offered to multiple outputs.
func settleConveyors(ws *model.WorldState) {
	if ws == nil {
		return
	}
	ensureConveyorTraffic(ws)
	conveyors := make(map[string]*model.Building)
	ids := make([]string, 0)
	for id, building := range ws.Buildings {
		if !conveyorActive(building) {
			continue
		}
		conveyors[id] = building
		ws.ConveyorTraffic.QueuedBefore[id] = building.Conveyor.TotalItems()
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) == 0 {
		return
	}
	allowedInputs := make(map[string]map[model.ConveyorDirection]struct{}, len(ids))
	for _, id := range ids {
		allowedInputs[id] = conveyorAllowedInputs(conveyors[id])
	}
	links := make(map[string][]conveyorLink, len(ids))
	for _, id := range ids {
		links[id] = conveyorOutputTargets(ws, conveyors, conveyors[id], conveyorIncomingDirs(ws, conveyors, conveyors[id]), allowedInputs)
	}
	remaining := make(map[string]*model.ConveyorState, len(ids))
	offers := make(map[string]int, len(ids))
	capacities := make(map[string]int, len(ids))
	receipts := make(map[string][]model.ItemStack, len(ids))
	grants := make(map[string]map[string]int, len(ids))
	for _, id := range ids {
		building := conveyors[id]
		remaining[id] = building.Conveyor.Clone()
		grants[id] = make(map[string]int)
		offers[id] = minInt(building.Conveyor.Throughput, building.Conveyor.TotalItems())
		capacities[id] = conveyorInsertCapacity(ws, building)
		if building.Splitter != nil {
			capacities[id] = minInt(capacities[id], building.Conveyor.Throughput)
		}
	}
	order := conveyorAllocationOrder(ids, ws.Tick)
	for {
		progress := false
		for _, diverse := range []bool{true, false} {
			requests := make(map[string][]conveyorRequest)
			for _, id := range order {
				if offers[id] <= 0 {
					continue
				}
				for _, link := range orderConveyorLinks(conveyors[id], links[id]) {
					if capacities[link.targetID] <= 0 {
						continue
					}
					index := conveyorRequestStack(conveyors[id], conveyors[link.targetID], remaining[id], link.output, diverse)
					if index < 0 {
						continue
					}
					requests[link.targetID] = append(requests[link.targetID], conveyorRequest{sourceID: id, link: link, bufferIndex: index})
					break
				}
			}
			for _, targetID := range ids {
				pending := requests[targetID]
				if len(pending) == 0 {
					continue
				}
				target := conveyors[targetID]
				if target.Splitter != nil {
					sort.SliceStable(pending, func(i, j int) bool {
						return splitterInputRank(target.Splitter, pending[i].link.input) < splitterInputRank(target.Splitter, pending[j].link.input)
					})
				} else {
					sort.SliceStable(pending, func(i, j int) bool {
						return grants[targetID][pending[i].sourceID] < grants[targetID][pending[j].sourceID]
					})
				}
				request := pending[0]
				source := conveyors[request.sourceID]
				moveQty := 1
				if isAutomaticPiler(source) {
					// The piler moves whole piles per throughput unit: one grant
					// carries a full pile instead of a single loose item.
					buf := remaining[request.sourceID].Buffer
					if request.bufferIndex < 0 || request.bufferIndex >= len(buf) || buf[request.bufferIndex].Quantity <= 0 {
						continue
					}
					moveQty = minInt(buf[request.bufferIndex].Quantity, pileHeightFor(ws, source.OwnerID))
					if moveQty > capacities[request.link.targetID] {
						moveQty = capacities[request.link.targetID]
					}
					if moveQty <= 0 {
						continue
					}
				}
				moved := remaining[request.sourceID].TakeAt(request.bufferIndex, moveQty)
				if len(moved) == 0 {
					continue
				}
				movedQty := 0
				for _, stack := range moved {
					movedQty += stack.Quantity
				}
				receipts[targetID] = append(receipts[targetID], moved...)
				offers[request.sourceID]--
				capacities[targetID] -= movedQty
				grants[targetID][request.sourceID]++
				recordConveyorDeparture(ws, source, movedQty)
				if source.Splitter != nil {
					source.Splitter.OutputCursor = nextSplitterCursor(source.Splitter.OutputDirections, request.link.output)
					source.Splitter.TransferredItems++
					source.Splitter.LastTransferTick = ws.Tick
				}
				if target.Splitter != nil {
					target.Splitter.InputCursor = nextSplitterCursor(target.Splitter.InputDirections, request.link.input)
				}
				progress = true
			}
		}
		if !progress {
			break
		}
	}
	for _, id := range ids {
		conveyors[id].Conveyor.Buffer = remaining[id].Buffer
	}
	for _, id := range ids {
		conveyors[id].Conveyor.AppendStacks(receipts[id])
	}
	for _, id := range ids {
		building := conveyors[id]
		if isAutomaticPiler(building) {
			compressPilerBuffer(building.Conveyor, pileHeightFor(ws, building.OwnerID))
		}
	}
}

func conveyorActive(building *model.Building) bool {
	return building != nil && building.Conveyor != nil && building.Runtime.State == model.BuildingWorkRunning
}

func conveyorAllocationOrder(ids []string, tick int64) []string {
	if len(ids) == 0 {
		return nil
	}
	offset := int(tick % int64(len(ids)))
	order := append([]string(nil), ids[offset:]...)
	return append(order, ids[:offset]...)
}

func nextSplitterCursor(directions []model.ConveyorDirection, used model.ConveyorDirection) int {
	for i, direction := range directions {
		if direction == used {
			return (i + 1) % len(directions)
		}
	}
	return 0
}

func splitterInputRank(splitter *model.SplitterState, direction model.ConveyorDirection) int {
	if direction == splitter.InputPriority {
		return -1
	}
	for i, port := range splitter.InputDirections {
		if direction == port {
			return (i - splitter.InputCursor + len(splitter.InputDirections)) % len(splitter.InputDirections)
		}
	}
	return 4
}

func orderConveyorLinks(building *model.Building, links []conveyorLink) []conveyorLink {
	if building.Splitter == nil {
		return links
	}
	s := building.Splitter
	ordered := append([]conveyorLink(nil), links...)
	rank := func(direction model.ConveyorDirection) int {
		if direction == s.OutputPriority {
			return -1
		}
		for i, port := range s.OutputDirections {
			if direction == port {
				return (i - s.OutputCursor + len(s.OutputDirections)) % len(s.OutputDirections)
			}
		}
		return 4
	}
	sort.SliceStable(ordered, func(i, j int) bool { return rank(ordered[i].output) < rank(ordered[j].output) })
	return ordered
}

func conveyorRequestStack(source, target *model.Building, remaining *model.ConveyorState, output model.ConveyorDirection, diverse bool) int {
	for i, stack := range remaining.Buffer {
		if stack.Quantity <= 0 || stack.ItemID == "" {
			continue
		}
		if source.Splitter != nil {
			if source.Splitter.AllowsOutput(output, stack.ItemID) {
				return i
			}
			continue
		}
		// Keep existing mixed-belt merge preference. Explicit splitter input
		// priority takes precedence over this ordinary-belt diversity heuristic.
		if diverse && target.Splitter == nil {
			if len(target.Conveyor.Buffer) == 0 || conveyorHasItem(target.Conveyor, stack.ItemID) {
				continue
			}
		}
		return i
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
		next, nextDir := ws.SurfaceStep(building.Position, dir)
		nx, ny := next.X, next.Y
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
		if neighbor.Splitter != nil {
			if neighbor.Splitter.IsOutput(nextDir.Opposite()) {
				incoming = append(incoming, dir)
			}
			continue
		}
		neighborOut := neighbor.Conveyor.Output
		if !neighborOut.Valid() || neighborOut == model.ConveyorAuto {
			continue
		}
		if neighborOut == nextDir.Opposite() {
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
	if !conveyorActive(building) {
		return allowed
	}
	if building.Splitter != nil {
		for _, direction := range building.Splitter.InputDirections {
			allowed[direction] = struct{}{}
		}
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
) []conveyorLink {
	if ws == nil || building == nil || building.Conveyor == nil {
		return nil
	}
	output := building.Conveyor.Output
	dirs := conveyorOutputPriority(output, incoming)
	if building.Splitter != nil {
		dirs = building.Splitter.OutputDirections
	}
	var targets []conveyorLink
	for _, dir := range dirs {
		if !dir.Valid() || dir == model.ConveyorAuto {
			continue
		}
		if building.Splitter == nil && output.Valid() && output != model.ConveyorAuto && dir != output {
			continue
		}
		if building.Splitter == nil && output == model.ConveyorAuto && containsDirection(incoming, dir) {
			continue
		}
		next, nextDir := ws.SurfaceStep(building.Position, dir)
		nx, ny := next.X, next.Y
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
		if !allowsInput(allowedInputs[targetID], nextDir.Opposite()) {
			continue
		}
		targets = append(targets, conveyorLink{targetID: targetID, output: dir, input: nextDir.Opposite()})
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
