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
// cycle_ticks × 两端点距离格数。没搬动就不推进周期，下一 tick 再试。
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
			continue
		}
		in, out := inputs[bestIn], outputs[bestOut]
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
		// 往返周期 = cycle_ticks × 端点距离格数（两端点落在不同格子上才计距离，
		// 两端同格时按 1 格算，避免零周期）。
		sorter.NextTripTick = ws.Tick + int64(sorter.CycleTicks*max(1, best))
	}
}

// sorterGrabOnce performs a single trip: up to maxStacks stacks from the front
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
		if len(cargo) == 0 {
			break
		}
		taken := 0
		for _, stack := range cargo {
			taken += stack.Quantity
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
				if taken <= 0 {
					break
				}
			}
		}
		if source.Conveyor != nil {
			recordConveyorDeparture(ws, source, taken)
		}
		moved += taken
		if firstItem == "" {
			firstItem = itemID
		}
	}
	return moved, firstItem
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
	for _, stack := range rest {
		if _, _, err := model.StoragePortInput(source, sourcePort, stack.ItemID, stack.Quantity); err != nil {
			log.Printf("[WARN] sorter rollback failed: source=%s port=%s item=%s qty=%d: %v", source.ID, sourcePort, stack.ItemID, stack.Quantity, err)
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
			// 取货端可以从任意路过的带格上取（不要求带尾正对分拣器）；
			// 放货端仍要求该格能接受这一侧插入。
			if forInput && !sorterCanTakeFromConveyor(target) {
				return sorterLink{}, false
			}
			if !forInput && !sorterCanInsertToConveyor(target, dir) {
				return sorterLink{}, false
			}
			return sorterLink{id: targetID, dir: dir, steps: step}, true
		}
		if target.Storage != nil {
			// 分拣器连到建筑占地内任一 cell 即算连上（多格建筑不再是"必须正中锚点"）：
			// 端口按方向取，offset 已统一收敛到锚点。
			if !ws.BuildingOccupies(target, pos) {
				return sorterLink{}, false
			}
			for _, port := range sortedIOPorts(target.Runtime.Params.IOPorts) {
				if (forInput && (port.Direction == model.PortOutput || port.Direction == model.PortBoth)) || (!forInput && (port.Direction == model.PortInput || port.Direction == model.PortBoth)) {
					return sorterLink{id: targetID, dir: dir, port: port.ID, steps: step}, true
				}
			}
		}
		return sorterLink{}, false
	}
	return sorterLink{}, false
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
