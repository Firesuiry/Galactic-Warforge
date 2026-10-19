package gamecore

import (
	"log"
	"sort"

	"siliconworld/internal/model"
)

type sorterLink struct {
	id    string
	dir   model.ConveyorDirection
	port  string
	steps int
}

// settleSorters 结算全部分拣器（第 16 轮契约 §2，DSP 口径）。
//
// 分拣器有朝向：背面取货、正面放货，沿朝向轴前后各扫 Range 格。
// 节拍：一次往返搬 1 件（集装 / 叠层科技提高每次件数），往返周期 =
// cycle_ticks × max(1, 取端步数 + 放端步数 − 1)（DSP 口径：最短布局
// 「带 | 分拣器 | 机器」两端各 1 步算长度 1）。没搬动就不推进周期，下一 tick 再试。
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
		if sorter.CycleTicks <= 0 || sorter.Range <= 0 {
			continue
		}
		if sorter.NextTripTick > ws.Tick {
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

		// 一次往返搬的件数：普通分拣器剥 maxStacks 个栈各 1 件，集装分拣器整堆抬。
		// sorter_cargo_stacking 科技通过目录里的 sorter_grab_stacks 效果提高每趟栈数。
		grabStacks := 1 + int(model.TechEffectValue(ws.Players[building.OwnerID], "sorter_grab_stacks"))
		pileGrab := building.Type == model.BuildingTypePileSorter

		// 一次往返只选一条「取货端 → 放货端」路线：近的优先（DSP 里长臂就是慢）。
		// 停工告警（sorter_stall_alert.go）复用同一选路函数，保证 reason/target
		// 与实际尝试搬运的那条路线一致。
		in, out, ok := sorterBestRoute(ws, inputs, outputs)
		if !ok {
			continue
		}
		source, target := ws.Buildings[in.id], ws.Buildings[out.id]

		qty, itemID := sorterGrabOnce(ws, source, target, in.port, out.port, sorter, grabStacks, pileGrab)
		if qty <= 0 {
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
			ItemID: itemID, Quantity: qty,
		}
		// 往返周期 = cycle_ticks × max(1, 取端步数 + 放端步数 − 1)：两端各 1 步的
		// 最短布局算 1 个长度单位；两端同格（steps 都是 0）也按 1 算，避免零周期。
		sorter.NextTripTick = ws.Tick + int64(sorter.CycleTicks*max(1, in.steps+out.steps-1))
	}
}

// sorterGrabOnce performs a single trip: up to maxStacks stacks from the source.
// Ordinary sorters take one item per stack; pile sorters lift each stack whole.
// Returns items moved and the first item ID.
//
// 取货端是传送带时按 DSP 口径**扫描整段带子**（不只是队首）：跳过本分拣器
// 过滤掉的、以及放货端收不下的物品，取第一个既过筛又能落地的栈（见
// conveyorGrabIndex）。旧实现只看队首：队首是下游不要的矿种时直接放弃，
// 后面的货永远取不到；配上「带尾对着分拣器、下游不收」的布局就是整线死锁
// （试玩 1016 报告 B1）。
func sorterGrabOnce(ws *model.WorldState, source, target *model.Building, sourcePort, targetPort string, sorter *model.SorterState, maxStacks int, pileGrab bool) (int, string) {
	if source == nil || target == nil || sorter == nil {
		return 0, ""
	}
	moved, firstItem := 0, ""
	for stacks := 0; stacks < maxStacks; stacks++ {
		itemID := ""
		take := 1
		var cargo []model.ItemStack
		if source.Conveyor != nil {
			index := conveyorGrabIndex(ws, source, target, targetPort, sorter)
			if index < 0 {
				break
			}
			itemID = source.Conveyor.Buffer[index].ItemID
			if pileGrab {
				take = source.Conveyor.Buffer[index].Quantity
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
			cargo = source.Conveyor.TakeAt(index, take)
		} else {
			itemID = sorterPickStorageItem(source, sourcePort, sorter)
			if itemID == "" {
				break
			}
			if pileGrab {
				take = source.ExportableItemQuantity(itemID)
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
			got, _, err := model.StoragePortOutput(source, sourcePort, itemID, take)
			if err != nil || got <= 0 {
				break
			}
			cargo = []model.ItemStack{{ItemID: itemID, Quantity: got}}
		}
		if len(cargo) == 0 {
			break
		}
		moved += sorterDeliverCargo(ws, source, target, sourcePort, targetPort, itemID, cargo)
		if firstItem == "" {
			firstItem = itemID
		}
	}
	return moved, firstItem
}

// sorterPickStorageItem 从建筑存储里挑本趟要取的物品：取第一个「过滤允许 +
// 来源端口放行」的（物品 ID 字典序，与旧实现同口径）。
func sorterPickStorageItem(source *model.Building, sourcePort string, sorter *model.SorterState) string {
	if source == nil || source.Storage == nil || sorter == nil {
		return ""
	}
	items := make([]string, 0, len(source.Storage.Inventory)+len(source.Storage.OutputBuffer))
	for id := range source.Storage.Inventory {
		items = append(items, id)
	}
	for id := range source.Storage.OutputBuffer {
		items = append(items, id)
	}
	sort.Strings(items)
	for _, id := range items {
		if source.ExportableItemQuantity(id) <= 0 || !sorter.Filter.Allows(id) {
			continue
		}
		for _, port := range source.Runtime.Params.IOPorts {
			if port.ID == sourcePort && allowsItem(port.AllowedItems, id) {
				return id
			}
		}
	}
	return ""
}

// conveyorGrabIndex 在带格缓冲里挑本趟要取的栈：按顺序取第一个「过滤允许 +
// 放货端收得下」的栈，实现 DSP「分拣器从经过的物品里挑自己认的」口径。
// 返回 -1 表示本趟没有可取之物（带空、全部被过滤、或放货端都收不下）。
func conveyorGrabIndex(ws *model.WorldState, source, target *model.Building, targetPort string, sorter *model.SorterState) int {
	if source == nil || source.Conveyor == nil || sorter == nil {
		return -1
	}
	capacity := -1
	if target.Conveyor != nil {
		capacity = conveyorInsertCapacity(ws, target)
		if capacity <= 0 {
			return -1
		}
	}
	for i, stack := range source.Conveyor.Buffer {
		if stack.Quantity <= 0 || stack.ItemID == "" {
			continue
		}
		if !sorter.Filter.Allows(stack.ItemID) {
			continue
		}
		if capacity >= 0 {
			return i
		}
		if accepted, _, err := model.StoragePortPreviewInput(target, targetPort, stack.ItemID, 1); err != nil || accepted <= 0 {
			continue
		}
		return i
	}
	return -1
}

// sorterDeliverCargo 把一趟取到的货投进放货端，返回实际投出的件数（放不下时
// 余货退回来源）。分拣器取货与投货都走这里，保证「预览 → 提交 → 退差」只有一处。
func sorterDeliverCargo(ws *model.WorldState, source, target *model.Building, sourcePort, targetPort, itemID string, cargo []model.ItemStack) int {
	taken := 0
	for _, stack := range cargo {
		taken += stack.Quantity
	}
	if taken <= 0 {
		return 0
	}
	if target.Conveyor != nil {
		target.Conveyor.AppendStacks(cargo)
	} else {
		// 预览与提交在本 tick 内串行，中间没有别的生产者；万一仍对不上
		// （端口被别的路径改过），跳过本次搬运并把货退回来源，不再 panic。
		inserted, _, _ := model.StoragePortInput(target, targetPort, itemID, taken)
		if inserted != taken {
			log.Printf("[WARN] sorter storage preview/commit mismatch: target=%s port=%s item=%s want=%d got=%d", target.ID, targetPort, itemID, taken, inserted)
			returnSourceItems(source, sourcePort, cargo, taken-inserted)
			taken = inserted
		}
	}
	if taken > 0 && source.Conveyor != nil {
		recordConveyorDeparture(ws, source, taken)
	}
	return taken
}

// returnSourceItems puts the surplus back where it came from after a partial
// commit, so a mismatch never destroys cargo.
func returnSourceItems(source *model.Building, sourcePort string, cargo []model.ItemStack, surplus int) {
	if source == nil || surplus <= 0 {
		return
	}
	rest := make([]model.ItemStack, 0, len(cargo))
	remaining := surplus
	for i := len(cargo) - 1; i >= 0 && remaining > 0; i-- {
		stack := cargo[i]
		if stack.Quantity <= 0 {
			continue
		}
		give := min(stack.Quantity, remaining)
		stack.Quantity = give
		rest = append(rest, stack)
		remaining -= give
	}
	if len(rest) == 0 {
		return
	}
	if source.Conveyor != nil {
		source.Conveyor.PrependStacks(rest)
		return
	}
	returnStorageItems(source.Storage, rest)
}

// returnStorageItems 把货退回建筑存储：先回输出缓冲、再回主库存，与 Provide
// 的取货顺序对称（取货也是先输出缓冲后主库存），所以原样回退能还原取货前的状态。
// 来源端口是「输出口」，不能走 StoragePortInput（它只认输入口），否则退货直接
// 失败、货就丢了。
func returnStorageItems(storage *model.StorageState, stacks []model.ItemStack) {
	if storage == nil {
		return
	}
	for _, stack := range stacks {
		remaining := stack.Quantity
		if remaining <= 0 {
			continue
		}
		if space := storage.OutputBufferSpace(); space > 0 {
			give := min(space, remaining)
			storage.EnsureOutputBuffer()[stack.ItemID] += give
			remaining -= give
		}
		if remaining > 0 {
			if room := storage.Capacity - storage.UsedInventory(); room > 0 {
				give := min(room, remaining)
				storage.EnsureInventory()[stack.ItemID] += give
				remaining -= give
			}
		}
		if remaining > 0 {
			log.Printf("[WARN] sorter rollback dropped %d x %s: storage full", remaining, stack.ItemID)
		}
	}
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

// sorterBestRoute 选一次往返的「取货端 → 放货端」路线：两端距离和最小者优先
// （DSP 里长臂就是慢）。距离相同时取先枚举到的组合——outputs 外层、inputs 内层，
// 两者都按 sorterEndpoints 的确定性顺序生成，所以结果可复现。
//
// settleSorters 与停工告警（sorterStallSampleFor）共用这一函数：告警的
// reason / target 必须针对实际尝试搬运的那条路线，否则 range 3 的分拣器
// 会报出「另一个端点」的停工原因。
func sorterBestRoute(ws *model.WorldState, inputs, outputs []sorterLink) (in, out sorterLink, ok bool) {
	if ws == nil {
		return sorterLink{}, sorterLink{}, false
	}
	best := -1
	bestIn, bestOut := -1, -1
	for oi := range outputs {
		target := ws.Buildings[outputs[oi].id]
		if target == nil {
			continue
		}
		for ii := range inputs {
			if inputs[ii].id == outputs[oi].id {
				continue
			}
			if ws.Buildings[inputs[ii].id] == nil {
				continue
			}
			span := inputs[ii].steps + outputs[oi].steps
			if best >= 0 && span >= best {
				continue
			}
			best, bestIn, bestOut = span, ii, oi
		}
	}
	if best < 0 {
		return sorterLink{}, sorterLink{}, false
	}
	return inputs[bestIn], outputs[bestOut], true
}

// sorterInputEndpoints 是取货端：背面（朝向的反方向）沿轴扫 Range 格。
func sorterInputEndpoints(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	back, _ := model.SorterFacingAxis(sorter.Rotation)
	return sorterEndpoints(ws, sorter, []model.ConveyorDirection{back}, state.Range, true)
}

// sorterOutputEndpoints 是放货端：正面沿轴扫 Range 格。
func sorterOutputEndpoints(ws *model.WorldState, sorter *model.Building, state *model.SorterState) []sorterLink {
	_, front := model.SorterFacingAxis(sorter.Rotation)
	return sorterEndpoints(ws, sorter, []model.ConveyorDirection{front}, state.Range, false)
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

// sorterFindEndpoint 是端点判定的薄包装：规则（扫描、归属、端口、传送带
// 插入方向）只在 sorterProbeEndpoint 一处，诊断视图与建造回执预判复用同一份。
func sorterFindEndpoint(ws *model.WorldState, sorter *model.Building, dir model.ConveyorDirection, maxRange int, forInput bool) (sorterLink, bool) {
	probe := sorterProbeEndpoint(ws, sorter, dir, maxRange, forInput, nil)
	return probe.Link, probe.OK
}

// sorterCanTakeFromConveyor：运行中的传送带格都能被取货（DSP 口径：带子上
// 任何路过的物品都能被分拣器取走，不要求带尾朝向分拣器）。
func sorterCanTakeFromConveyor(conveyorBuilding *model.Building) bool {
	return conveyorActive(conveyorBuilding) && conveyorBuilding.Conveyor != nil
}

func sorterCanInsertToConveyor(conveyorBuilding *model.Building, dir model.ConveyorDirection) bool {
	if conveyorBuilding == nil || conveyorBuilding.Conveyor == nil {
		return false
	}
	allowed := conveyorAllowedInputs(conveyorBuilding)
	return allowsInput(allowed, dir.Opposite())
}
