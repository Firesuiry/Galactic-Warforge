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
//
// 吞吐模型（第 19 轮契约 §2 修订，2026-10-18）：
// 传送带是流水线，一个 tick 内「从队首推出 f 件」与「从队尾收进 f 件」是同时发生的，
// 推出腾出的空间当场就可以再收。所以每格的**可接收容量按「本 tick 送出后」的空位算**：
//   capacities[X] = MaxStack − (tick 初持有 + 本 tick 已收进 − 本 tick 已送出)
// 每成功送出一笔就把腾出的空位记回源格（capacities[source] += movedQty），
// 于是稳态吞吐只受 throughput 约束（不再被 stack_limit/2 卡住），并且永远不会超容量：
// 容量按「实际收进/送出」增量维护，等价于实时空位，只是把本 tick 收进的货记在 receipts
// （tick 末才 AppendStacks）——本 tick 收到的货不会再被送出去，所以一件物品在同一
// tick 里最多跨一格（receipts 里的货对 remaining[source] 不可见）。
//
// 分配顺序与收敛：目标格可能在源格之后才处理，所以空位是随着「送出」在循环里往回传播的；
// 外层 for 循环反复扫描直到没有新的搬运（每个目标每轮最多一笔），链长 N 的带子最多
// 需要 N 轮把尾端的空位传到链首。循环一定收敛：每笔搬运都消耗一个 offer，而 offer 总数
// 有界（每格每 tick ≤ throughput）。分流器的「每 tick 最多收进 throughput 件」是配额
// （splitterIntake），不随腾出的空间放宽。
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
	splitterIntake := make(map[string]int, len(ids))
	receipts := make(map[string][]model.ItemStack, len(ids))
	grants := make(map[string]map[string]int, len(ids))
	// canAccept 报告目标格本 tick 还能不能收进一件货：既要物理上有空位，也不能超过
	// 分流器的每 tick 入口配额（配额不因为自己送出了货而放宽）。
	canAccept := func(targetID string) bool {
		if capacities[targetID] <= 0 {
			return false
		}
		if quota, ok := splitterIntake[targetID]; ok && quota <= 0 {
			return false
		}
		return true
	}
	for _, id := range ids {
		building := conveyors[id]
		remaining[id] = building.Conveyor.Clone()
		grants[id] = make(map[string]int)
		offers[id] = min(building.Conveyor.Throughput, building.Conveyor.TotalItems())
		capacities[id] = conveyorInsertCapacity(ws, building)
		if building.Splitter != nil {
			splitterIntake[id] = building.Conveyor.Throughput
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
					if !canAccept(link.targetID) {
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
				if _, isSplitter := splitterIntake[targetID]; isSplitter {
					splitterIntake[targetID] -= movedQty
				}
				// 流水线口径：送出腾出的空位本 tick 立刻可以再收（见函数头注释）。
				capacities[request.sourceID] += movedQty
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
