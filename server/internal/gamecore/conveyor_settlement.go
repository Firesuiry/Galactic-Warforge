package gamecore

import (
	"sort"

	"siliconworld/internal/model"
)

type conveyorTransfer struct {
	sourceID string
	targetID string
	qty      int
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
	for _, sourceID := range ids {
		remaining := offers[sourceID]
		if remaining <= 0 {
			continue
		}
		for _, targetID := range outputTargets[sourceID] {
			if remaining <= 0 {
				break
			}
			available := capacities[targetID]
			if available <= 0 {
				continue
			}
			take := minInt(remaining, available)
			if take <= 0 {
				continue
			}
			allocations[sourceID] = append(allocations[sourceID], conveyorTransfer{
				sourceID: sourceID,
				targetID: targetID,
				qty:      take,
			})
			remaining -= take
			capacities[targetID] -= take
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
			moved := source.Conveyor.Take(tr.qty)
			target.Conveyor.AppendStacks(moved)
		}
	}
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
