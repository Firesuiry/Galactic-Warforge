package gamecore

import (
	"fmt"
	"sort"

	"siliconworld/internal/model"
)

// 运输机器人（§2）：在玩家指定的两座建筑之间往返搬运单一物品。
//
// 与配送器（distributor）的区别：路线由玩家用 unit_order order=haul 显式指定，
// 不消耗能量、不占配送器槽位，运力必须远小于传送带（一趟 4 件、往返几十 tick）。
//
// 规则（设计文档 §2 固定路线 / §2.1 全局自动）：
//   - 起点/终点都是己方同行星建筑；起点要能取货，终点要能收货；
//   - 走到建筑**占地外圈的相邻空 cell** 才能装卸（细分网格后建筑是多格占地）；
//   - 装货走 ExportableItemQuantity（生产建筑只出输出缓冲；仓储类主库存可导出；
//     反馈料只算输出缓冲）；
//   - 卸货走与 transfer_item to_building 完全相同的接收规则（产出预留、
//     研究站只收矩阵、物流站需先配槽位）——本文件不复制那套判定，只复用；
//   - 起点无货在起点等（waiting_source），终点收不下在终点等（waiting_target）；
//   - 任一端建筑消失：清空路线、停下、发一条中文事件。
//
// 两种模式共用本文件的状态机，只有「任务从哪来 / 跑完一趟去哪」不同：
// route 模式的任务由玩家写死、跑完掉头回起点；auto 模式的任务由 auto_haul.go
// 每 10 tick 派单，跑完（或无处可送）释放认领、回到空闲等下一次派单。
//
// 移动本身由 settleUnitMovement 负责（机器人就是普通世界单位，按路径逐 tick
// 前进）；本文件只做「到没到外圈」的判定与装卸。

// haulCargoCapacity 每趟载量（件）：设计文档 §2「每趟 4 件、单一物品」。
const haulCargoCapacity = 4

// maxHaulPerPlayer 每玩家运输机器人上限（台）：设计文档 §2「每玩家 20 台」。
const maxHaulPerPlayer = 20

// haulRetryTicks 装卸/重试节流（tick）：建筑暂时没货或收不下时每 tick 重试
// 是纯开销（存储与生产结算每 tick 才推进一次）。
const haulRetryTicks = 5

// haulWaitPollTicks 等待状态（waiting_source / waiting_target）的轮询间隔（tick）。
const haulWaitPollTicks = 10

// haulIDs 列出世界上所有运输机器人（稳定顺序）。
func haulIDs(ws *model.WorldState) []string {
	ids := make([]string, 0, len(ws.Units))
	for id, u := range ws.Units {
		if u != nil && u.Type == model.UnitTypeTransportRobot {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// countTransportRobots 统计该玩家存活 + 在生产队列里的运输机器人（每玩家上限口径）。
func countTransportRobots(ws *model.WorldState, playerID string) (alive, queued int) {
	if ws == nil {
		return 0, 0
	}
	for _, u := range ws.Units {
		if u != nil && u.Type == model.UnitTypeTransportRobot && u.OwnerID == playerID && u.HP > 0 {
			alive++
		}
	}
	for _, b := range ws.Buildings {
		if b == nil || b.OwnerID != playerID {
			continue
		}
		for _, order := range b.UnitQueue {
			if order.UnitType == model.UnitTypeTransportRobot {
				queued++
			}
		}
	}
	return alive, queued
}

// settleTransportRobots 推进所有运输机器人的装卸与路线循环（含自动模式派单）。
// 第二个返回值是本 tick 解除的 haul_unreachable 告警（写回告警历史）。
func settleTransportRobots(ws *model.WorldState) ([]*model.GameEvent, []alertResolution) {
	if ws == nil || len(ws.Units) == 0 {
		return nil, nil
	}
	var events []*model.GameEvent
	robots := make([]*model.Unit, 0, len(ws.Units))
	for _, id := range haulIDs(ws) {
		robot := ws.Units[id]
		if robot == nil || robot.HP <= 0 || robot.Haul == nil {
			continue
		}
		robots = append(robots, robot)
	}
	// 自动模式：先按当前认领给空闲机器人派单，再逐台推进行程。
	events = append(events, settleAutoHaul(ws, robots)...)
	var resolved []alertResolution
	for _, robot := range robots {
		robotEvents, robotResolved := settleTransportRobot(ws, robot)
		events = append(events, robotEvents...)
		resolved = append(resolved, robotResolved...)
	}
	return events, resolved
}

// settleTransportRobot 结算一台运输机器人的一 tick。
func settleTransportRobot(ws *model.WorldState, robot *model.Unit) ([]*model.GameEvent, []alertResolution) {
	haul := robot.Haul
	// 待命（stop / 自动模式暂无需求）：没有任务，不移动、不装卸。
	if haul.Mode == model.HaulModeIdle || haul.FromBuildingID == "" && haul.ToBuildingID == "" {
		return nil, nil
	}
	// 终点是任务成立的必要条件；取货端可以为空（自动模式下货已在车上改派）。
	if haul.ToBuildingID == "" {
		return nil, nil
	}
	source := ws.Buildings[haul.FromBuildingID]
	target := ws.Buildings[haul.ToBuildingID]
	if reason := haulEndpointLost(source, haul.FromBuildingID, target, haul.ToBuildingID, robot.OwnerID); reason != "" {
		return abortHaul(ws, robot, reason), nil
	}

	switch haul.Phase {
	case model.HaulPhaseToSource:
		return haulTravelTo(ws, robot, source, model.HaulPhaseToSource, model.HaulPhaseLoading)
	case model.HaulPhaseToTarget:
		return haulTravelTo(ws, robot, target, model.HaulPhaseToTarget, model.HaulPhaseUnloading)
	case model.HaulPhaseLoading:
		if !ringHasBuilding(ws, source, robot.Position) {
			resolved := haulRecordArrival(ws, robot, nil)
			haul.Phase = model.HaulPhaseToSource
			return nil, resolved
		}
		if ws.Tick%haulRetryTicks != 0 {
			return nil, nil
		}
		return haulLoadAtSource(ws, robot), nil
	case model.HaulPhaseUnloading:
		if !ringHasBuilding(ws, target, robot.Position) {
			resolved := haulRecordArrival(ws, robot, nil)
			haul.Phase = model.HaulPhaseToTarget
			return nil, resolved
		}
		if ws.Tick%haulRetryTicks != 0 {
			return nil, nil
		}
		return haulUnloadAtTarget(ws, robot), nil
	case model.HaulPhaseWaitingSource:
		return haulResumeFromWait(ws, robot, source, model.HaulPhaseToSource, model.HaulPhaseLoading)
	case model.HaulPhaseWaitingTarget:
		return haulResumeFromWait(ws, robot, target, model.HaulPhaseToTarget, model.HaulPhaseUnloading)
	case model.HaulPhaseIdle, "":
		// 自动模式空闲：等下一次派单（派单在 settleAutoHaul 里）。
		// route 模式不该出现在这里（路线刚下达时下面的 default 分支会补阶段）。
		if haul.Mode == model.HaulModeAuto {
			haul.Phase = model.HaulPhaseIdle
			return nil, nil
		}
		if haul.CargoQuantity() > 0 {
			haul.Phase = model.HaulPhaseToTarget
		} else {
			haul.Phase = model.HaulPhaseToSource
		}
		return nil, nil
	default:
		// 路线刚下达（或阶段丢失）：车上还有货就先去终点，否则从起点开始。
		if haul.CargoQuantity() > 0 {
			haul.Phase = model.HaulPhaseToTarget
		} else {
			haul.Phase = model.HaulPhaseToSource
		}
		return nil, nil
	}
}

// haulEndpointLost 检查任务两端是否仍然可用，返回中文原因（空串表示正常）。
// sourceID 为空（自动模式下货已在车上、没有取货端）时跳过起点检查。
func haulEndpointLost(source *model.Building, sourceID string, target *model.Building, targetID, ownerID string) string {
	if sourceID != "" && source == nil {
		return "运输起点建筑已不存在（拆除或被摧毁），运输路线已清空"
	}
	if targetID == "" {
		return "运输终点建筑已不存在（拆除或被摧毁），运输路线已清空"
	}
	if target == nil {
		return "运输终点建筑已不存在（拆除或被摧毁），运输路线已清空"
	}
	if sourceID != "" && source.OwnerID != ownerID {
		return "运输路线的起点或终点已不属于本玩家，运输路线已清空"
	}
	if target.OwnerID != ownerID {
		return "运输路线的起点或终点已不属于本玩家，运输路线已清空"
	}
	if sourceID != "" && source.HP <= 0 {
		return "运输路线的起点或终点已被摧毁，运输路线已清空"
	}
	if target.HP <= 0 {
		return "运输路线的起点或终点已被摧毁，运输路线已清空"
	}
	if sourceID != "" && sourceID == targetID {
		return "运输起点与终点是同一座建筑，运输路线已清空"
	}
	return ""
}

// abortHaul 端点消失：清空路线、停下机器人并发一条中文事件。
//
// 车上的货留在车上（不凭空消失）：route 模式下玩家重新指定路线后继续用；
// auto 模式下立刻按「带在身上的货去哪」重新派单（另一台缺同种原料的建筑，
// 否则最近的仓储，都没有就带着货待命，见 §2.1）。
func abortHaul(ws *model.WorldState, robot *model.Unit, reason string) []*model.GameEvent {
	haul := robot.Haul
	cargoItem := ""
	if haul != nil {
		cargoItem = haul.Cargo.ItemID
	}
	if haul != nil && haul.Mode == model.HaulModeAuto {
		// 释放认领：本趟的供给/需求都不再算在途量，其它机器人可以接手。
		haul.ClearRoute()
		haul.Phase = model.HaulPhaseIdle
	} else if haul != nil {
		haul.ClearHaul()
	}
	robot.ClearMovement()
	robot.ClearEngagement()
	robot.Stance = model.UnitStanceIdle
	events := []*model.GameEvent{{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"order":       "haul_aborted",
			"reason":      reason,
			"message":     fmt.Sprintf("%s：%s", unitDisplayName(robot), reason),
		},
	}}
	// 自动模式：带着的货改送别处（车上的货不能凭空消失）。
	if haul != nil && haul.Mode == model.HaulModeAuto && cargoItem != "" && ws != nil {
		if claim := haulDeliveryFallback(ws, robot, cargoItem); claim != nil {
			haul.Claim = claim
			haul.ToBuildingID = claim.DemandBuildingID
			haul.ItemID = claim.ItemID
			haul.Phase = model.HaulPhaseToTarget
			events = append(events, haulTaskEvent(robot, "auto_haul_deliver"))
		}
	}
	return events
}

// haulTravelTo 行进阶段：到达建筑占地外圈即切到装卸阶段，否则按需重规划路径。
// 路径推进由 settleUnitMovement 完成，这里只在「没路可走」时重新规划。
func haulTravelTo(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase, arrivalPhase model.HaulPhase) ([]*model.GameEvent, []alertResolution) {
	if ringHasBuilding(ws, building, robot.Position) {
		robot.ClearMovement()
		robot.Stance = model.UnitStanceIdle
		robot.Haul.Phase = arrivalPhase
		return nil, haulRecordArrival(ws, robot, building)
	}
	if robot.HasPath() {
		return nil, nil
	}
	if ws.Tick%haulRetryTicks != 0 {
		return nil, nil
	}
	return haulRouteTo(ws, robot, building, travelPhase), nil
}

// haulRouteTo 让机器人前往建筑占地外圈的相邻空 cell。
//
// 自动模式下找不到落点或路径时，连续失败达到上限就放弃这一单（见
// auto_haul_unreachable.go）；route 模式维持原来的「原地等」语义。
func haulRouteTo(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase model.HaulPhase) []*model.GameEvent {
	dest, ok := haulApproachCell(ws, robot, building)
	if !ok {
		// 外圈一圈都被占满：停下等（waiting 阶段轮询重试）。
		return haulUnreachableFailure(ws, robot, building, travelPhase)
	}
	path, pathOK := computeUnitPath(ws, robot.Position, dest, robot.ID)
	if !pathOK || len(path) < 2 {
		return haulUnreachableFailure(ws, robot, building, travelPhase)
	}
	haulRecordRoutePlanned(robot)
	robot.ClearEngagement()
	robot.Path = path
	robot.PathIndex = 1
	robot.PathIntent = model.PathIntentTask
	robot.MoveProgress = 0
	robot.BlockedTicks = 0
	robot.OrderPos = nil
	robot.Stance = model.UnitStanceMoving
	return []*model.GameEvent{{
		EventType:       model.EvtEntityMoved,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":   robot.ID,
			"entity_kind": "unit",
			"from":        robot.Position,
			"to":          dest,
			"path":        path,
			"move_speed":  robot.MoveSpeed,
			"stance":      robot.Stance,
		},
	}}
}

func haulWaitingPhaseFor(phase model.HaulPhase) model.HaulPhase {
	if phase == model.HaulPhaseToTarget {
		return model.HaulPhaseWaitingTarget
	}
	return model.HaulPhaseWaitingSource
}

// haulResumeFromWait 等待状态的轮询：还在外圈就直接重试装卸，被挤开就重新走过去。
func haulResumeFromWait(ws *model.WorldState, robot *model.Unit, building *model.Building, travelPhase, workPhase model.HaulPhase) ([]*model.GameEvent, []alertResolution) {
	if ws.Tick%haulWaitPollTicks != 0 {
		return nil, nil
	}
	if !ringHasBuilding(ws, building, robot.Position) {
		robot.Haul.Phase = travelPhase
		return nil, nil
	}
	resolved := haulRecordArrival(ws, robot, building)
	robot.Haul.Phase = workPhase
	switch workPhase {
	case model.HaulPhaseLoading:
		return haulLoadAtSource(ws, robot), resolved
	case model.HaulPhaseUnloading:
		return haulUnloadAtTarget(ws, robot), resolved
	}
	return nil, resolved
}

// haulLoadAtSource 在起点装货：未指定物品时选「起点当前可取且终点当前能接收」的第一种。
func haulLoadAtSource(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	source := ws.Buildings[haul.FromBuildingID]
	if source == nil {
		return nil
	}
	capacity := haulCargoCapacity - haul.CargoQuantity()
	if capacity <= 0 {
		haul.Phase = model.HaulPhaseToTarget
		return nil
	}
	itemID := haul.ItemID
	if itemID == "" {
		itemID = selectHaulPickupItem(ws, robot)
	}
	if itemID == "" {
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	// 车上已有别的货：先于 Provide 拒绝——Load 只接受与车上同种（或空车）的货，
	// 先扣源再装不进去会让货凭空消失。
	if haul.CargoQuantity() > 0 && haul.Cargo.ItemID != itemID {
		if haul.Mode == model.HaulModeAuto {
			haulClearTask(robot)
			return nil
		}
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	available := haulPickupQuantity(source, itemID)
	if available <= 0 {
		// 自动模式：供给端已经取空（或被别的机器人抢空）→ 释放认领、等下一次派单。
		if haul.Mode == model.HaulModeAuto {
			haulClearTask(robot)
			return nil
		}
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	taken, _, err := source.Storage.Provide(itemID, min(capacity, available))
	if err != nil || taken <= 0 {
		if haul.Mode == model.HaulModeAuto {
			haulClearTask(robot)
			return nil
		}
		haul.Phase = model.HaulPhaseWaitingSource
		return nil
	}
	if loaded := haul.Load(itemID, taken); loaded < taken {
		// 兜底（正常已被上面的货种/容量校验挡住）：装不进的部分直接还回源的主库存，
		// 不经过 Load（槽位满时 Load 也收不下），绝不凭空消失。
		source.Storage.EnsureInventory()[itemID] += taken - loaded
		taken = loaded
		if taken <= 0 {
			if haul.Mode == model.HaulModeAuto {
				haulClearTask(robot)
				return nil
			}
			haul.Phase = model.HaulPhaseWaitingSource
			return nil
		}
	}
	// 自动模式：按实际取到量修正认领（取不到 4 件时不能继续占着供给的余量）。
	haulTrimClaim(haul, taken)
	haul.Phase = model.HaulPhaseToTarget
	return []*model.GameEvent{haulCargoEvent(robot, taken)}
}

// haulTrimClaim 按实际取到的件数修正自动模式的认领量（§2.1「按实际取到量修正认领」）。
func haulTrimClaim(haul *model.UnitHaulState, taken int) {
	if haul == nil || haul.Claim == nil || haul.Mode != model.HaulModeAuto {
		return
	}
	if taken <= 0 || taken >= haul.Claim.Quantity {
		return
	}
	haul.Claim.Quantity = taken
}

// haulUnloadAtTarget 在终点卸货：接收规则与 transfer_item to_building 完全一致。
func haulUnloadAtTarget(ws *model.WorldState, robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	target := ws.Buildings[haul.ToBuildingID]
	if target == nil {
		return nil
	}
	if haul.CargoQuantity() <= 0 {
		haulCompleteDelivery(robot)
		return nil
	}
	itemID := haul.Cargo.ItemID
	accepted, remaining := haulDepositIntoBuilding(target, itemID, haul.Cargo.Quantity)
	if accepted <= 0 {
		// 终点暂时收不下（满、产出预留顶住、槽位不符）：留在车上等。
		haul.Phase = model.HaulPhaseWaitingTarget
		return nil
	}
	haul.Unload(accepted)
	haul.DeliveredTotal += accepted
	events := []*model.GameEvent{haulCargoEvent(robot, accepted)}
	if remaining > 0 {
		// 卸不完的留在车上，等终点腾出空间后继续卸。
		haul.Phase = model.HaulPhaseWaitingTarget
		return events
	}
	events = append(events, haulCompleteDelivery(robot)...)
	return events
}

// haulCompleteDelivery 送达完成：释放认领，再决定去哪。
//   - route 模式：掉头回起点（原有往返语义）；
//   - auto 模式：回到空闲等下一次派单（§2.1「回到空闲等下一次派单」）。
func haulCompleteDelivery(robot *model.Unit) []*model.GameEvent {
	haul := robot.Haul
	if haul.Mode == model.HaulModeAuto {
		haulClearTask(robot)
		return []*model.GameEvent{haulTaskEvent(robot, "auto_haul_done")}
	}
	haul.Phase = model.HaulPhaseToSource
	return nil
}

// haulCargoEvent 装/卸一条事件（客户端据此更新车顶货物与进度）。
func haulCargoEvent(robot *model.Unit, quantity int) *model.GameEvent {
	return &model.GameEvent{
		EventType:       model.EvtEntityUpdated,
		VisibilityScope: robot.OwnerID,
		Payload: map[string]any{
			"entity_id":       robot.ID,
			"entity_kind":     "unit",
			"order":           "haul_cargo",
			"quantity":        quantity,
			"haul":            robot.Haul.Clone(),
			"delivered_total": robot.Haul.DeliveredTotal,
		},
	}
}

// selectHaulPickupItem 未指定物品时选起点第一种「可取且终点能收」的物品。
func selectHaulPickupItem(ws *model.WorldState, robot *model.Unit) string {
	haul := robot.Haul
	source := ws.Buildings[haul.FromBuildingID]
	target := ws.Buildings[haul.ToBuildingID]
	if source == nil || target == nil || source.Storage == nil {
		return ""
	}
	for _, itemID := range source.Storage.OutputCandidates() {
		if haulPickupQuantity(source, itemID) <= 0 {
			continue
		}
		if _, ok := model.Item(itemID); !ok {
			continue
		}
		if accepted, _ := haulDepositPreview(target, itemID, 1); accepted <= 0 {
			continue
		}
		return itemID
	}
	return ""
}

// haulPickupQuantity 起点当前可取出量（生产建筑只算输出缓冲，仓储类算主库存；
// 反馈料只算输出缓冲，见 model.Building.ExportableItemQuantity）。
func haulPickupQuantity(source *model.Building, itemID string) int {
	if source == nil || source.Storage == nil || itemID == "" {
		return 0
	}
	return source.ExportableItemQuantity(itemID)
}

// haulDepositPreview 终点当前能接收多少件（不落货）。
// 与 transfer_item to_building 同一套规则：研究站只收矩阵、喷涂机只收增产剂、
// 物流站先配槽位，产出预留由 StorageState 自己扣。
func haulDepositPreview(target *model.Building, itemID string, quantity int) (int, int) {
	if target == nil || quantity <= 0 {
		return 0, quantity
	}
	if target.Storage == nil {
		if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
			return target.LogisticsStation.AvailableItemCapacity(itemID), quantity
		}
		return 0, quantity
	}
	if target.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			return 0, quantity
		}
	}
	if researchLabIntakeRejection(target, itemID) != "" {
		return 0, quantity
	}
	if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
		return target.LogisticsStation.AvailableItemCapacity(itemID), quantity
	}
	accepted, remaining, err := target.Storage.PreviewReceive(itemID, quantity)
	if err != nil {
		return 0, quantity
	}
	return accepted, remaining
}

// haulDepositIntoBuilding 实际落货到终点建筑，返回「收下 / 剩余」。
func haulDepositIntoBuilding(target *model.Building, itemID string, quantity int) (int, int) {
	if target == nil || quantity <= 0 {
		return 0, quantity
	}
	if target.Storage == nil {
		if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
			accepted, remaining, _ := target.LogisticsStation.ReceiveItem(itemID, quantity)
			return accepted, remaining
		}
		return 0, quantity
	}
	if target.Type == model.BuildingTypeSprayCoater {
		if _, ok := model.SprayDefinitionByItem(itemID); !ok {
			return 0, quantity
		}
	}
	if researchLabIntakeRejection(target, itemID) != "" {
		return 0, quantity
	}
	if model.IsGroundLogisticsBuilding(target.Type) && target.LogisticsStation != nil {
		accepted, remaining, _ := target.LogisticsStation.ReceiveItem(itemID, quantity)
		return accepted, remaining
	}
	accepted, remaining, err := target.Storage.Load(itemID, quantity)
	if err != nil {
		return 0, quantity
	}
	return accepted, remaining
}

// ringHasBuilding 该格是否属于建筑占地外圈的相邻格。
func ringHasBuilding(ws *model.WorldState, building *model.Building, pos model.Position) bool {
	if building == nil || ws.BuildingOccupies(building, pos) {
		return false
	}
	for _, neighbor := range ws.SurfaceNeighbors(pos) {
		if ws.BuildingOccupies(building, neighbor) {
			return true
		}
	}
	return false
}

// haulApproachCell 选一个建筑外圈的相邻格作为落点：优先离机器人最近的
// 「无建筑、可通行、无同层单位」格（外圈格被别的建筑占着或站了人时换一个）。
func haulApproachCell(ws *model.WorldState, robot *model.Unit, building *model.Building) (model.Position, bool) {
	best := 0
	var dest model.Position
	found := false
	for _, cell := range ws.SurfaceDisc(building.Position, buildingRingSearchRadius(ws, building)) {
		if !ringHasBuilding(ws, building, cell) {
			continue
		}
		if !tileWalkableForUnit(ws, cell, robot.ID) {
			continue
		}
		distance := ws.SurfaceDistance(robot.Position, cell)
		if !found || distance < best {
			dest = cell
			best = distance
			found = true
		}
	}
	return dest, found
}

// buildingRingSearchRadius 覆盖整个占地外圈所需的搜索半径（图距离）。
func buildingRingSearchRadius(ws *model.WorldState, building *model.Building) int {
	tiles, err := ws.BuildingTiles(building)
	if err != nil || len(tiles) == 0 {
		return 1
	}
	radius := 1
	for _, tile := range tiles {
		if d := ws.SurfaceDistance(building.Position, tile); d > radius {
			radius = d
		}
	}
	return radius + 1
}
