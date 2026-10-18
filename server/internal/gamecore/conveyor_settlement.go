package gamecore

import (
	"fmt"
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

// beltBlockedWarnTicks 是「带上有货却一件都动不出去」多久后报警的阈值。
// 按 tick 计，10 tps 下 30 秒；试玩里传送带堵死是几 tick 内就发生的事，
// 这个阈值只用来滤掉换配方/开机瞬间的正常停顿。
const beltBlockedWarnTicks = 300

// settleBeltBlockAlerts 统计每条带子「有货但连续不动」的 tick 数，超过阈值
// 就发一条 belt_blocked 告警（指向带格本身）。第二个返回值是本 tick 解除的
// 告警（带子恢复流动 / 清空 / 停机），由调用方写回告警历史标记 inactive。
//
// 为什么要有：带尾对着空地、或下游分拣器/建筑不收这个物品时，货会永久堆在
// 带上，上游矿机随后被自己的输出缓冲堵住——玩家在活动流里只看到「采矿机
// 产物阻塞」，会去查矿机而不是查带子（试玩 1016 报告 B1/U7）。
func settleBeltBlockAlerts(ws *model.WorldState) ([]*model.GameEvent, []alertResolution) {
	if ws == nil {
		return nil, nil
	}
	ids := make([]string, 0, len(ws.Buildings))
	for id, building := range ws.Buildings {
		if model.IsTrafficMonitorBelt(building) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	sort.Strings(ids)
	var events []*model.GameEvent
	var resolved []alertResolution
	for _, id := range ids {
		building := ws.Buildings[id]
		conveyor := building.Conveyor
		if conveyor == nil {
			continue
		}
		moved := 0
		if ws.ConveyorTraffic != nil && ws.ConveyorTraffic.Tick == ws.Tick {
			moved = ws.ConveyorTraffic.Departed[id]
		}
		// 停机的带子（断电、暂停）不算「被堵」：它本来就不动，报警只会误导玩家
		// 去查下游。清掉计数与既有告警。
		if conveyor.TotalItems() == 0 || moved > 0 || !conveyorActive(building) {
			conveyor.BlockedTicks = 0
			if building.ProductionMonitor != nil {
				if _, cleared := monitorAlert(building.ProductionMonitor, model.AlertTypeBeltBlocked, false, ws.Tick, 0); cleared {
					resolved = append(resolved, alertResolution{playerID: building.OwnerID, planetID: ws.PlanetID, buildingID: building.ID, alertType: model.AlertTypeBeltBlocked, tick: ws.Tick})
				}
			}
			continue
		}
		conveyor.BlockedTicks++
		if conveyor.BlockedTicks < beltBlockedWarnTicks {
			continue
		}
		if building.ProductionMonitor == nil {
			building.ProductionMonitor = model.NewProductionMonitorState()
		}
		if fired, _ := monitorAlert(building.ProductionMonitor, model.AlertTypeBeltBlocked, true, ws.Tick, beltBlockedWarnTicks); !fired {
			continue
		}
		alert := &model.ProductionAlert{
			AlertID:      fmt.Sprintf("alert-%d-%s-%s", ws.Tick, building.ID, model.AlertTypeBeltBlocked),
			Tick:         ws.Tick,
			Active:       true,
			PlayerID:     building.OwnerID,
			PlanetID:     ws.PlanetID,
			BuildingID:   building.ID,
			BuildingType: building.Type,
			AlertType:    model.AlertTypeBeltBlocked,
			Severity:     model.AlertSeverityWarning,
			Message:      model.AlertMessage(model.AlertTypeBeltBlocked, building.ID),
			Metrics:      building.ProductionMonitor.LastStats,
			Details: map[string]any{
				"position":      building.Position,
				"queued_items":  conveyor.TotalItems(),
				"blocked_ticks": conveyor.BlockedTicks,
			},
		}
		events = append(events, &model.GameEvent{
			EventType:       model.EvtProductionAlert,
			VisibilityScope: building.OwnerID,
			Payload:         map[string]any{"alert": alert},
		})
	}
	return events, resolved
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
				take := min(pileHeight-out[open].Quantity, qty)
				out[open].Quantity += take
				qty -= take
				continue
			}
			take := min(pileHeight, qty)
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
		links[id] = conveyorDownstreamTargets(ws, conveyors, conveyors[id], allowedInputs)
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
		offers[id] = min(building.Conveyor.Throughput, building.Conveyor.TotalItems())
		capacities[id] = conveyorInsertCapacity(ws, building)
		if building.Splitter != nil {
			capacities[id] = min(capacities[id], building.Conveyor.Throughput)
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
					moveQty = min(buf[request.bufferIndex].Quantity, pileHeightFor(ws, source.OwnerID))
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

// conveyorIncomingDirs 返回「哪些方向上的运输建筑把货送进本格」（世界方向，
// 即邻居在本格的方向）。第 19 轮起上游完全由下游链接反推（契约 §3.3）：
// 对四个方向逐个问「那个邻居会不会连到我」，不再单独按 TileBuilding 扫。
// 这样高架带/坡道/同层优先只有一套算法。
func conveyorIncomingDirs(ws *model.WorldState, conveyors map[string]*model.Building, building *model.Building) []model.ConveyorDirection {
	if ws == nil || building == nil {
		return nil
	}
	var incoming []model.ConveyorDirection
	for _, dir := range conveyorDirOrder {
		next, _ := ws.SurfaceStep(building.Position, dir)
		neighbor := conveyorAt(ws, conveyors, next, building.OwnerID)
		if neighbor == nil || neighbor.ID == building.ID {
			continue
		}
		if conveyorLinksTo(ws, conveyors, neighbor, building) {
			incoming = append(incoming, dir)
		}
	}
	return incoming
}

// conveyorLinksTo 回答「A 的下游算法会不会连到 B」。只展开 A 自己的候选方向，
// 不再递归求 A 的上游（那样 A、B 互指会无限递归）。
func conveyorLinksTo(ws *model.WorldState, conveyors map[string]*model.Building, from, to *model.Building) bool {
	if from == nil || to == nil || from.Conveyor == nil {
		return false
	}
	output := from.Conveyor.Output
	dirs := []model.ConveyorDirection{output}
	if from.Splitter != nil {
		dirs = from.Splitter.OutputDirections
	} else if !output.Valid() || output == model.ConveyorAuto {
		// auto 输出：候选方向 = 四向里非上游的那些（与 conveyorOutputPriority 同口径），
		// 只是这里不需要知道具体哪个方向是上游——任何能连上的都算。
		dirs = conveyorDirOrder
	}
	accepts := func(targetID string, dir model.ConveyorDirection) bool {
		return allowsInput(conveyorAllowedInputs(conveyors[targetID]), dir)
	}
	level := from.BeltElevation()
	for _, dir := range dirs {
		if !dir.Valid() || dir == model.ConveyorAuto {
			continue
		}
		if from.Splitter == nil && output.Valid() && output != model.ConveyorAuto && dir != output {
			continue
		}
		next, nextDir := ws.SurfaceStep(from.Position, dir)
		if next.X != to.Position.X || next.Y != to.Position.Y {
			continue
		}
		inputSide := nextDir.Opposite()
		target := conveyorDownstreamAt(ws, conveyors, from.OwnerID, next, level, inputSide, accepts)
		if target != nil && target.ID == to.ID {
			return true
		}
	}
	return false
}

// conveyorAt 返回 (x,y) 上属于 ownerID 的运输建筑：地面层优先，然后自下而上
// 找高架层。分拣器/建筑直连 IO 不用这个函数，它们只看 TileBuilding（只接地面层）。
func conveyorAt(ws *model.WorldState, conveyors map[string]*model.Building, pos model.Position, ownerID string) *model.Building {
	if ws == nil {
		return nil
	}
	if id := ws.TileBuilding[model.TileKey(pos.X, pos.Y)]; id != "" {
		if b := conveyors[id]; b != nil && b.Conveyor != nil && b.OwnerID == ownerID {
			return b
		}
	}
	for elevation := 1; elevation <= model.MaxBeltElevation; elevation++ {
		id := ws.BeltLayerAt(pos.X, pos.Y, elevation)
		if id == "" {
			continue
		}
		if b := conveyors[id]; b != nil && b.Conveyor != nil && b.OwnerID == ownerID {
			return b
		}
	}
	return nil
}

// conveyorDownstreamTargets 是第 19 轮契约 §3.3 的统一下游算法（服务端权威，
// 3D/2D 必须同口径）。带 A（高度 a，输出方向 d）沿 SurfaceStep 到邻格 N：
//
//  1. 同层优先：N 上高度 a 的运输建筑，若接受来自 opposite(d') 侧的输入 → 连；
//  2. 坡道（只在同层没连上时）：依次看 N 上高度 a−1、a+1（≥0）的纯传送带 B，
//     要求 B.output == d'（直行延续，坡道不许转弯/侧汇）且接受输入 → 连；
//  3. 都没有 → 无下游（死头）。
//
// 分流器保留原有的多输出方向逻辑（它们只在地面层）。
func conveyorDownstreamTargets(
	ws *model.WorldState,
	conveyors map[string]*model.Building,
	building *model.Building,
	allowedInputs map[string]map[model.ConveyorDirection]struct{},
) []conveyorLink {
	if ws == nil || building == nil || building.Conveyor == nil {
		return nil
	}
	output := building.Conveyor.Output
	dirs := conveyorOutputPriority(output, conveyorIncomingDirs(ws, conveyors, building))
	if building.Splitter != nil {
		dirs = building.Splitter.OutputDirections
	}
	accepts := func(targetID string, dir model.ConveyorDirection) bool {
		if allowedInputs != nil {
			return allowsInput(allowedInputs[targetID], dir)
		}
		return allowsInput(conveyorAllowedInputs(conveyors[targetID]), dir)
	}
	// 目标必须属于同一玩家（conveyorAt 已按 owner 过滤）。
	var targets []conveyorLink
	for _, dir := range dirs {
		if !dir.Valid() || dir == model.ConveyorAuto {
			continue
		}
		if building.Splitter == nil && output.Valid() && output != model.ConveyorAuto && dir != output {
			continue
		}
		next, nextDir := ws.SurfaceStep(building.Position, dir)
		inputSide := nextDir.Opposite()
		level := building.BeltElevation()
		link := conveyorDownstreamAt(ws, conveyors, building.OwnerID, next, level, inputSide, accepts)
		if link == nil {
			continue
		}
		targets = append(targets, conveyorLink{targetID: link.ID, output: dir, input: inputSide})
	}
	return targets
}

// conveyorDownstreamAt 按 §3.3 在邻格 N 上找下游：同层优先，其次坡道（±1 层、
// 只认直行延续的纯传送带）。返回 nil 表示死头。
func conveyorDownstreamAt(
	ws *model.WorldState,
	conveyors map[string]*model.Building,
	ownerID string,
	next model.Position,
	level int,
	inputSide model.ConveyorDirection,
	accepts func(string, model.ConveyorDirection) bool,
) *model.Building {
	sameLevel := conveyorAtLevel(ws, conveyors, next, ownerID, level)
	if sameLevel != nil && accepts(sameLevel.ID, inputSide) {
		return sameLevel
	}
	// 坡道：只对纯传送带（不是分流器/集装机/监测器），且必须直行延续。
	for _, ramp := range []int{level - 1, level + 1} {
		if ramp < 0 || ramp > model.MaxBeltElevation {
			continue
		}
		candidate := conveyorAtLevel(ws, conveyors, next, ownerID, ramp)
		if candidate == nil || candidate.Splitter != nil {
			continue
		}
		if !model.SupportsElevation(candidate.Type) {
			continue
		}
		// 坡道只认直行延续：B 自己的输出方向必须等于进入 N 后的前进方向 d'
		// （= opposite(inputSide)），不许转弯、不许侧汇。
		if candidate.Conveyor.Output != inputSide.Opposite() {
			continue
		}
		if accepts(candidate.ID, inputSide) {
			return candidate
		}
	}
	return nil
}

// conveyorAtLevel 返回 (x,y) 上恰好 height 层的运输建筑；height=0 走 TileBuilding。
func conveyorAtLevel(ws *model.WorldState, conveyors map[string]*model.Building, pos model.Position, ownerID string, height int) *model.Building {
	if ws == nil || height < 0 || height > model.MaxBeltElevation {
		return nil
	}
	var id string
	if height == 0 {
		id = ws.TileBuilding[model.TileKey(pos.X, pos.Y)]
	} else {
		id = ws.BeltLayerAt(pos.X, pos.Y, height)
	}
	if id == "" {
		return nil
	}
	b := conveyors[id]
	if b == nil || b.Conveyor == nil || b.OwnerID != ownerID {
		return nil
	}
	return b
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
